use rusqlite::params_from_iter;
use rusqlite::types::ValueRef;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

struct DbState(Mutex<rusqlite::Connection>);

/// User-chosen sync folder root. All sync fs commands resolve strictly below
/// it; set only through the native folder picker flow.
struct SyncRootState(std::sync::Mutex<Option<PathBuf>>);

fn to_sql_value(value: &Value) -> rusqlite::types::Value {
    match value {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(boolean) => rusqlite::types::Value::Integer(i64::from(*boolean)),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                rusqlite::types::Value::Integer(integer)
            } else if let Some(real) = number.as_f64() {
                rusqlite::types::Value::Real(real)
            } else {
                rusqlite::types::Value::Null
            }
        }
        Value::String(string) => rusqlite::types::Value::Text(string.clone()),
        Value::Array(items) => rusqlite::types::Value::Blob(
            items
                .iter()
                .filter_map(|item| item.as_u64().map(|byte| byte as u8))
                .collect(),
        ),
        Value::Object(_) => rusqlite::types::Value::Text(value.to_string()),
    }
}

/// Resolve a relative path below the app data directory. Absolute paths,
/// parent traversal, and prefixes are rejected so the frontend cannot escape
/// its own storage subtree.
fn resolve_data_path(app: &tauri::AppHandle, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("invalid data path".into());
    }

    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(base.join(relative_path))
}

#[tauri::command]
fn data_read(app: tauri::AppHandle, relative: String) -> Result<Option<Vec<u8>>, String> {
    let path = resolve_data_path(&app, &relative)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read(path).map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
fn data_write(app: tauri::AppHandle, relative: String, data: Vec<u8>) -> Result<(), String> {
    let path = resolve_data_path(&app, &relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, data).map_err(|error| error.to_string())
}

#[tauri::command]
fn data_remove(app: tauri::AppHandle, relative: String) -> Result<(), String> {
    let path = resolve_data_path(&app, &relative)?;
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn data_list(app: tauri::AppHandle, relative: String) -> Result<Vec<String>, String> {
    let path = resolve_data_path(&app, &relative)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(path).map_err(|error| error.to_string())?;
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
fn initial_book_path() -> Option<String> {
    std::env::args().skip(1).find(|arg| {
        let lower = arg.to_lowercase();
        lower.ends_with(".epub") || lower.ends_with(".pdf")
    })
}

#[tauri::command]
fn read_external_file(path: String) -> Result<Vec<u8>, String> {
    const MAX_BOOK_BYTES: u64 = 512 * 1024 * 1024;
    let lower = path.to_lowercase();
    if !lower.ends_with(".epub") && !lower.ends_with(".pdf") {
        return Err("only epub and pdf files are supported".into());
    }
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("not a file".into());
    }
    if metadata.len() > MAX_BOOK_BYTES {
        return Err("file is too large".into());
    }
    fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn db_execute(
    state: tauri::State<'_, DbState>,
    sql: String,
    params: Vec<Value>,
) -> Result<(), String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let values: Vec<rusqlite::types::Value> = params.iter().map(to_sql_value).collect();
    connection
        .execute(&sql, params_from_iter(values))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_execute_batch(state: tauri::State<'_, DbState>, sql: String) -> Result<(), String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    connection
        .execute_batch(&sql)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn db_select(
    state: tauri::State<'_, DbState>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let columns: Vec<String> = statement
        .column_names()
        .map(|name| name.to_string())
        .collect();
    let values: Vec<rusqlite::types::Value> = params.iter().map(to_sql_value).collect();
    let mut rows = statement
        .query(params_from_iter(values))
        .map_err(|error| error.to_string())?;
    let mut output = Vec::new();

    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let mut object = Map::new();
        for (index, name) in columns.iter().enumerate() {
            let value = match row.get_ref(index).map_err(|error| error.to_string())? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(integer) => Value::from(integer),
                ValueRef::Real(real) => Value::from(real),
                ValueRef::Text(text) => Value::from(String::from_utf8_lossy(text).into_owned()),
                ValueRef::Blob(blob) => {
                    Value::Array(blob.iter().map(|byte| Value::from(*byte)).collect())
                }
            };
            object.insert(name.clone(), value);
        }
        output.push(object);
    }

    Ok(output)
}

/// Resolve a sync path below the stored root. Absolute paths and non-normal
/// components are rejected, and existing path components must not be symlinks,
/// so a link inside the sync folder cannot redirect reads or writes elsewhere.
fn resolve_sync_path(root_state: &SyncRootState, relative: &str) -> Result<PathBuf, String> {
    let root = root_state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
        .ok_or_else(|| "no sync folder selected".to_string())?;
    let relative_path = Path::new(relative);
    let mut resolved = root;
    for component in relative_path.components() {
        let Component::Normal(name) = component else {
            return Err("invalid sync path".into());
        };
        resolved.push(name);
        match fs::symlink_metadata(&resolved) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("sync path must not contain symlinks".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(resolved)
}

#[tauri::command]
fn sync_set_root(state: tauri::State<'_, SyncRootState>, path: String) -> Result<String, String> {
    let candidate = PathBuf::from(&path)
        .canonicalize()
        .map_err(|error| format!("cannot open folder: {error}"))?;
    if !candidate.is_dir() {
        return Err("not a directory".into());
    }
    let display = candidate.to_string_lossy().into_owned();
    *state.0.lock().map_err(|error| error.to_string())? = Some(candidate);
    Ok(display)
}

#[tauri::command]
fn sync_root(state: tauri::State<'_, SyncRootState>) -> Option<String> {
    state
        .0
        .lock()
        .ok()
        .and_then(|root| root.clone())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn sync_fs_read(
    state: tauri::State<'_, SyncRootState>,
    relative: String,
) -> Result<Option<Vec<u8>>, String> {
    let path = resolve_sync_path(&state, &relative)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read(path).map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
fn sync_fs_write(
    state: tauri::State<'_, SyncRootState>,
    relative: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let path = resolve_sync_path(&state, &relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, data).map_err(|error| error.to_string())
}

#[tauri::command]
fn sync_fs_exists(
    state: tauri::State<'_, SyncRootState>,
    relative: String,
) -> Result<bool, String> {
    let path = resolve_sync_path(&state, &relative)?;
    Ok(path.exists())
}

#[tauri::command]
fn sync_fs_remove(state: tauri::State<'_, SyncRootState>, relative: String) -> Result<(), String> {
    let path = resolve_sync_path(&state, &relative)?;
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn sync_fs_list(
    state: tauri::State<'_, SyncRootState>,
    relative: String,
) -> Result<Vec<String>, String> {
    let path = resolve_sync_path(&state, &relative)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(path).map_err(|error| error.to_string())?;
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    names.sort();
    Ok(names)
}

const KEYCHAIN_SERVICE: &str = "app.hamesh.reader";

#[tauri::command]
fn keychain_set(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(|error| error.to_string())?;
    entry
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn keychain_get(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn keychain_delete(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(|error| error.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Which package kind is running: AppImage, deb/rpm, or unknown.
#[tauri::command]
fn install_kind() -> String {
    if std::env::var_os("APPIMAGE").is_some() {
        return "appimage".into();
    }
    if Path::new("/usr/bin/hamesh").exists() {
        return "deb".into();
    }
    "unknown".into()
}

/// Download a .deb from our own GitHub release and install it via
/// `pkexec apt-get install`, which resolves dependencies and asks for the
/// admin password in a system dialog. The caller relaunches afterwards.
#[tauri::command]
async fn install_deb_update(url: String, version: String) -> Result<(), String> {
    const PREFIX: &str = "https://github.com/smhh22/haamesh/releases/download/";
    if version.is_empty()
        || version.len() > 32
        || !version.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+' | '_')
        })
    {
        return Err("invalid version".into());
    }
    let expected = format!("/v{version}/Hamesh_{version}_amd64.deb");
    if !url.starts_with(PREFIX) || !url.ends_with(&expected) {
        return Err("unexpected update URL".into());
    }
    let dir = std::env::temp_dir().join("hamesh-update");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let file = dir.join(format!("hamesh_{version}_amd64.deb"));

    let response = reqwest::get(&url)
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    fs::write(&file, &bytes).map_err(|error| error.to_string())?;

    let status = std::process::Command::new("pkexec")
        .args(["apt-get", "install", "-y", "--allow-downgrades"])
        .arg(&file)
        .status()
        .map_err(|error| format!("pkexec unavailable: {error}"))?;
    if !status.success() {
        return Err(format!(
            "installer exited with {status}; install manually: sudo apt install {}",
            file.display()
        ));
    }
    Ok(())
}

/// Response envelope for the Rust-side HTTP bridge.
#[derive(serde::Serialize)]
struct HttpResult {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

/// Perform an HTTP(S) request for the sync providers, optionally through an
/// HTTP or SOCKS5 proxy (sanctioned networks). Restricted to http/https so the
/// bridge cannot be used for other schemes.
#[tauri::command]
async fn http_request(
    method: String,
    url: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<Vec<u8>>,
    proxy: Option<String>,
) -> Result<HttpResult, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("only http(s) URLs are supported".into());
    }
    let mut builder = reqwest::Client::builder();
    if let Some(proxy_url) = proxy.filter(|value| !value.is_empty()) {
        builder =
            builder.proxy(reqwest::Proxy::all(&proxy_url).map_err(|error| error.to_string())?);
    }
    let client = builder.build().map_err(|error| error.to_string())?;

    let request_method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())?;
    let mut request = client.request(request_method, &url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    if let Some(bytes) = body {
        request = request.body(bytes);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;

    let status = response.status().as_u16();
    let response_headers = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_string(),
                value.to_str().unwrap_or_default().to_string(),
            )
        })
        .collect();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    Ok(HttpResult {
        status,
        headers: response_headers,
        body: bytes.to_vec(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            data_read,
            data_write,
            data_remove,
            data_list,
            initial_book_path,
            read_external_file,
            db_execute,
            db_execute_batch,
            db_select,
            sync_set_root,
            sync_root,
            sync_fs_read,
            sync_fs_write,
            sync_fs_exists,
            sync_fs_remove,
            sync_fs_list,
            keychain_set,
            keychain_get,
            keychain_delete,
            install_kind,
            install_deb_update,
            http_request
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let connection = rusqlite::Connection::open(data_dir.join("hamesh.db"))?;
            app.manage(DbState(Mutex::new(connection)));
            app.manage(SyncRootState(Mutex::new(None)));

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hāmesh");
}
