use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            data_read,
            data_write,
            data_remove,
            data_list
        ])
        .setup(|app| {
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
