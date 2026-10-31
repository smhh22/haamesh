use rusqlite::params_from_iter;
use rusqlite::types::ValueRef;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};

mod sftp;
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

/// Resolve a relative path below a trusted base. Absolute paths, parent
/// traversal, and prefixes are rejected, and existing path components must not
/// be symlinks, so a link planted inside the data directory cannot redirect
/// reads, writes, or removals elsewhere.
fn resolve_beneath(base: &Path, relative: &str) -> Result<PathBuf, String> {
    // An empty path resolves to the base itself; removing it would wipe the
    // database, books, and covers.
    if relative.trim().is_empty() {
        return Err("invalid data path".into());
    }
    let mut resolved = base.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(name) = component else {
            return Err("invalid data path".into());
        };
        resolved.push(name);
        match fs::symlink_metadata(&resolved) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("data path must not contain symlinks".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(resolved)
}

fn resolve_data_path(app: &tauri::AppHandle, relative: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    resolve_beneath(&base, relative)
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
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    if path == base {
        return Err("refusing to remove the data root".into());
    }
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
    if relative.trim().is_empty() {
        return Err("invalid sync path".into());
    }
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

const SYNC_ROOT_FILE: &str = "sync_root";

/// Persist the chosen sync root next to the app's data so a restart can
/// restore it without the webview ever supplying a path.
fn persist_sync_root(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let config = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&config).map_err(|error| error.to_string())?;
    fs::write(
        config.join(SYNC_ROOT_FILE),
        path.to_string_lossy().as_bytes(),
    )
    .map_err(|error| error.to_string())
}

fn read_persisted_sync_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    let config = app.path().app_config_dir().ok()?;
    let raw = fs::read_to_string(config.join(SYNC_ROOT_FILE)).ok()?;
    let path = PathBuf::from(raw.trim());
    if path.is_dir() { Some(path) } else { None }
}

/// Pick the sync folder with the native dialog and set the root in Rust. The
/// webview never supplies the path, so an injected script cannot widen the
/// filesystem scope of the sync_fs_* commands.
#[tauri::command]
async fn sync_pick_root(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncRootState>,
) -> Result<Option<String>, String> {
    // The dialog plugin only offers folder picking on desktop; mobile builds
    // must still compile, and local-folder sync is a desktop feature.
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        let picked = app.dialog().file().blocking_pick_folder();
        let Some(file_path) = picked else {
            return Ok(None);
        };
        let candidate = file_path
            .into_path()
            .map_err(|error| error.to_string())?
            .canonicalize()
            .map_err(|error| format!("cannot open folder: {error}"))?;
        if !candidate.is_dir() {
            return Err("not a directory".into());
        }
        persist_sync_root(&app, &candidate)?;
        let display = candidate.to_string_lossy().into_owned();
        *state.0.lock().map_err(|error| error.to_string())? = Some(candidate);
        return Ok(Some(display));
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, state);
        Err("choosing a sync folder is not supported on this platform".into())
    }
}

/// One-time migration: adopt the folder saved by an older build that stored
/// its path in the webview config. Refuses once a root is persisted, and only
/// accepts an existing directory that is not a filesystem root.
#[tauri::command]
fn sync_adopt_root(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncRootState>,
    path: String,
) -> Result<Option<String>, String> {
    if read_persisted_sync_root(&app).is_some() {
        return Err("a sync folder is already configured".into());
    }
    let candidate = PathBuf::from(path.trim())
        .canonicalize()
        .map_err(|error| format!("cannot open folder: {error}"))?;
    if !candidate.is_dir() || candidate.parent().is_none() {
        return Err("not a directory".into());
    }
    persist_sync_root(&app, &candidate)?;
    let display = candidate.to_string_lossy().into_owned();
    *state.0.lock().map_err(|error| error.to_string())? = Some(candidate);
    Ok(Some(display))
}

/// Restore the previously picked sync root (path comes from disk, not IPC).
#[tauri::command]
fn sync_restore_root(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncRootState>,
) -> Result<Option<String>, String> {
    let Some(candidate) = read_persisted_sync_root(&app) else {
        return Ok(None);
    };
    let display = candidate.to_string_lossy().into_owned();
    *state.0.lock().map_err(|error| error.to_string())? = Some(candidate);
    Ok(Some(display))
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
    // Temp file in the same directory, then rename: an interrupted write must
    // not truncate the existing index or book metadata.
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let temp = path.with_file_name(format!(
        ".{name}.tmp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    ));
    fs::write(&temp, &data).map_err(|error| error.to_string())?;
    fs::rename(&temp, &path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        error.to_string()
    })
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
fn sync_fs_mkdir(state: tauri::State<'_, SyncRootState>, relative: String) -> Result<(), String> {
    let path = resolve_sync_path(&state, &relative)?;
    fs::create_dir_all(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn sync_fs_remove(state: tauri::State<'_, SyncRootState>, relative: String) -> Result<(), String> {
    let path = resolve_sync_path(&state, &relative)?;
    let root = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
        .ok_or_else(|| "no sync folder selected".to_string())?;
    if path == root {
        return Err("refusing to remove the sync root".into());
    }
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

/// Which package kind is running: AppImage, deb, rpm-family, Windows, or unknown.
#[tauri::command]
fn install_kind() -> String {
    if std::env::var_os("APPIMAGE").is_some() {
        return "appimage".into();
    }
    if cfg!(target_os = "windows") {
        return "windows".into();
    }
    if Path::new("/usr/bin/hamesh").exists() {
        // deb and rpm both install this binary; only Debian-family systems can
        // use the apt one-click path.
        if Path::new("/usr/bin/apt-get").exists() {
            return "deb".into();
        }
        return "package".into();
    }
    "unknown".into()
}

/// Download a .deb from our own GitHub release and install it via
/// `pkexec apt-get install`, which resolves dependencies and asks for the
/// admin password in a system dialog. The caller relaunches afterwards.
fn base64_to_string(value: &str) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|error| format!("invalid base64: {error}"))?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

/// Verify a Tauri updater signature (minisign) against the embedded public
/// key before letting a downloaded package reach pkexec. Mirrors the updater
/// plugin: both the key and the signature are base64-wrapped, and the signed
/// trusted comment must name this version (a tampered manifest could
/// otherwise pair a new version with an older signed artifact).
fn verify_update_signature(
    data: &[u8],
    signature_b64: &str,
    pubkey_b64: &str,
    version: &str,
) -> Result<(), String> {
    let public_key_text = base64_to_string(pubkey_b64)?;
    let signature_text = base64_to_string(signature_b64)?;
    let public_key = minisign_verify::PublicKey::decode(&public_key_text)
        .map_err(|error| format!("invalid updater public key: {error}"))?;
    let signature = minisign_verify::Signature::decode(&signature_text)
        .map_err(|error| format!("invalid update signature: {error}"))?;
    public_key
        .verify(data, &signature, true)
        .map_err(|error| format!("update signature does not match: {error}"))?;
    if !signature
        .trusted_comment()
        .contains(&format!("version:{version}"))
    {
        return Err("update signature is for a different version".into());
    }
    Ok(())
}

#[tauri::command]
async fn install_deb_update(
    app: tauri::AppHandle,
    url: String,
    version: String,
) -> Result<(), String> {
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
    // A private, unpredictable temp dir: a predictable path under /tmp can be
    // pre-created by another local user (symlink/TOCTOU).
    let unique = format!(
        "hamesh-update-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    );
    let dir = std::env::temp_dir().join(unique);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    let file = dir.join(format!("hamesh_{version}_amd64.deb"));

    let response = reqwest::get(&url)
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;

    // The deb path bypasses the Tauri updater, so it must verify the published
    // signature itself; apt installs whatever file it is given.
    let pubkey = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|plugin| plugin.get("pubkey"))
        .and_then(|value| value.as_str())
        .ok_or_else(|| "updater signing key is not configured".to_string())?
        .to_string();
    let signature_url = format!("{url}.sig");
    let signature_response = reqwest::get(&signature_url)
        .await
        .map_err(|error| format!("signature download failed: {error}"))?;
    if !signature_response.status().is_success() {
        return Err(format!(
            "signature download failed: HTTP {}",
            signature_response.status()
        ));
    }
    let signature_text = signature_response
        .text()
        .await
        .map_err(|error| format!("signature download failed: {error}"))?;
    verify_update_signature(&bytes, &signature_text, &pubkey, &version)?;

    fs::write(&file, &bytes).map_err(|error| error.to_string())?;

    let status = std::process::Command::new("pkexec")
        .args(["apt-get", "install", "-y"])
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
    // Bounded total time, bounded redirects, and a hard response cap: this
    // bridge handles book-sized payloads, so 1 GiB is generous while keeping
    // a hostile or broken endpoint from hanging or exhausting memory.
    const MAX_RESPONSE_BYTES: u64 = 1024 * 1024 * 1024;
    let mut builder = reqwest::Client::builder()
        // Book transfers can be large and links slow; 10 minutes bounds a
        // hung request without cutting off a legitimate upload/download.
        .timeout(std::time::Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::limited(5));
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
    if response.content_length().unwrap_or(0) > MAX_RESPONSE_BYTES {
        return Err("response too large".into());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("response too large".into());
    }
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
            sync_pick_root,
            sync_restore_root,
            sync_adopt_root,
            sftp::sftp_connect,
            sftp::sftp_read,
            sftp::sftp_write,
            sftp::sftp_mkdir,
            sftp::sftp_exists,
            sftp::sftp_remove,
            sftp::sftp_list,
            sftp::sftp_disconnect,
            sync_root,
            sync_fs_read,
            sync_fs_write,
            sync_fs_exists,
            sync_fs_mkdir,
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
            app.manage(sftp::SftpSessions(Mutex::new(
                std::collections::HashMap::new(),
            )));

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

#[cfg(test)]
mod tests {
    use super::{resolve_beneath, verify_update_signature};
    use std::fs;
    use std::path::{Path, PathBuf};

    fn temp_dir(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("hamesh-path-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn rejects_empty_absolute_and_parent_paths() {
        let base = temp_dir("invalid");
        let absolute = base.join("outside");
        let cases = [
            "".to_string(),
            "   ".to_string(),
            absolute.to_string_lossy().into_owned(),
            "../outside".to_string(),
            "books/../../outside".to_string(),
        ];
        for case in cases {
            assert!(
                resolve_beneath(&base, &case).is_err(),
                "accepted invalid path {case:?}"
            );
        }
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn resolves_missing_nested_paths() {
        let base = temp_dir("nested");
        let resolved = resolve_beneath(&base, "books/abc.epub").unwrap();
        assert_eq!(resolved, base.join("books").join("abc.epub"));
        let _ = fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_components() {
        let base = temp_dir("symlink");
        let outside = temp_dir("outside");
        std::os::unix::fs::symlink(&outside, base.join("books")).unwrap();
        let error = resolve_beneath(&base, "books/book.epub").unwrap_err();
        assert!(error.contains("symlink"), "unexpected error: {error}");
        let _ = fs::remove_dir_all(base);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn rejects_malformed_update_signatures() {
        assert!(verify_update_signature(b"payload", "not-base64!", "also-not!", "1.0.0").is_err());
    }

    /// Verifies the real release artifacts when the paths are supplied:
    /// HAMESH_UPDATE_DEB, HAMESH_UPDATE_SIG, HAMESH_UPDATE_PUBKEY and
    /// HAMESH_UPDATE_VERSION. No-op on CI where they are absent.
    #[test]
    fn verifies_a_real_release_when_artifacts_are_provided() {
        let (Ok(deb_path), Ok(sig_path), Ok(pubkey_path)) = (
            std::env::var("HAMESH_UPDATE_DEB"),
            std::env::var("HAMESH_UPDATE_SIG"),
            std::env::var("HAMESH_UPDATE_PUBKEY"),
        ) else {
            return;
        };
        let version = std::env::var("HAMESH_UPDATE_VERSION").unwrap_or_default();
        let data = fs::read(deb_path).unwrap();
        let signature = fs::read_to_string(sig_path).unwrap();
        let pubkey = fs::read_to_string(pubkey_path).unwrap();

        verify_update_signature(&data, &signature, &pubkey, &version)
            .expect("a published signature must verify");

        let mut tampered = data.clone();
        tampered[0] ^= 0xff;
        assert!(verify_update_signature(&tampered, &signature, &pubkey, &version).is_err());
        assert!(verify_update_signature(&data, &signature, &pubkey, "0.0.1").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn allows_a_symlinked_base() {
        let real = temp_dir("real-base");
        let link = temp_dir("link-parent").join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let resolved = resolve_beneath(&link, "books/book.epub").unwrap();
        assert_eq!(resolved, Path::new(&link).join("books").join("book.epub"));
        let _ = fs::remove_dir_all(real);
        let _ = fs::remove_dir_all(link.parent().unwrap());
    }
}
