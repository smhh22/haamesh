use rusqlite::params_from_iter;
use rusqlite::types::ValueRef;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

struct DbState(Mutex<rusqlite::Connection>);

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
fn initial_epub_path() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|arg| arg.to_lowercase().ends_with(".epub"))
}

#[tauri::command]
fn read_external_file(path: String) -> Result<Vec<u8>, String> {
    if !path.to_lowercase().ends_with(".epub") {
        return Err("only epub files are supported".into());
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            data_read,
            data_write,
            data_remove,
            data_list,
            initial_epub_path,
            read_external_file,
            db_execute,
            db_execute_batch,
            db_select
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let connection = rusqlite::Connection::open(data_dir.join("hamesh.db"))?;
            app.manage(DbState(Mutex::new(connection)));

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
