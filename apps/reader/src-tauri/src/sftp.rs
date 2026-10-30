//! SFTP access for the sync provider. The user's own server and credentials;
//! no vendor service. Host keys are trusted on first use and pinned per
//! host:port in the app config, so a changed server key fails the connection
//! instead of silently accepting a man-in-the-middle.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use russh::client::{self, AuthResult, Handle};
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh_sftp::client::SftpSession;
use tauri::Manager;

const KNOWN_HOSTS_FILE: &str = "sftp_known_hosts.json";

pub struct SftpSessions(pub Mutex<HashMap<String, Arc<SftpSession>>>);

struct ClientHandler {
    expected: Option<String>,
    observed: Arc<Mutex<Option<String>>>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key
            .public_key()
            .fingerprint(HashAlg::Sha256)
            .to_string();
        if let Ok(mut slot) = self.observed.lock() {
            *slot = Some(fingerprint.clone());
        }
        Ok(match &self.expected {
            Some(expected) => expected == &fingerprint,
            // Trust on first use: accept and pin after a successful auth.
            None => true,
        })
    }
}

fn known_hosts_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&config).map_err(|error| error.to_string())?;
    Ok(config.join(KNOWN_HOSTS_FILE))
}

fn read_known_hosts(app: &tauri::AppHandle) -> HashMap<String, String> {
    let Ok(path) = known_hosts_path(app) else {
        return HashMap::new();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn host_key(host: &str, port: u16) -> String {
    format!("{host}:{port}")
}

/// Reject `..` segments: sync paths stay below whatever base the user chose.
fn validate_remote_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("empty remote path".into());
    }
    for component in path.split('/') {
        if component == ".." {
            return Err("remote path must not contain '..'".into());
        }
    }
    Ok(())
}

fn is_missing(error: &russh_sftp::client::error::Error) -> bool {
    let text = error.to_string().to_lowercase();
    text.contains("no such file") || text.contains("not found") || text.contains("enoent")
}

fn is_exists(error: &russh_sftp::client::error::Error) -> bool {
    let text = error.to_string().to_lowercase();
    text.contains("already exists") || text.contains("failure") || text.contains("exists")
}

async fn lookup_session(
    sessions: &tauri::State<'_, SftpSessions>,
    id: &str,
) -> Result<Arc<SftpSession>, String> {
    sessions
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .get(id)
        .cloned()
        .ok_or_else(|| "sftp session not connected".to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn sftp_connect(
    app: tauri::AppHandle,
    sessions: tauri::State<'_, SftpSessions>,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    key_path: Option<String>,
    key_passphrase: Option<String>,
) -> Result<String, String> {
    let host = host.trim().to_string();
    if host.is_empty() || host.contains('/') || host.contains(' ') {
        return Err("invalid host".into());
    }
    if username.trim().is_empty() {
        return Err("username required".into());
    }
    let key = host_key(&host, port);
    let known = read_known_hosts(&app);
    let expected = known.get(&key).cloned();
    let observed = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        expected: expected.clone(),
        observed: observed.clone(),
    };
    let config = Arc::new(client::Config::default());
    let mut handle: Handle<ClientHandler> = client::connect(config, (host.as_str(), port), handler)
        .await
        .map_err(|error| format!("connect failed: {error}"))?;

    let auth = match (password.as_deref(), key_path.as_deref()) {
        (Some(password), _) if !password.is_empty() => handle
            .authenticate_password(username.clone(), password)
            .await
            .map_err(|error| error.to_string())?,
        (_, Some(path)) if !path.is_empty() => {
            let secret = load_secret_key(PathBuf::from(path), key_passphrase.as_deref())
                .map_err(|error| format!("cannot read private key: {error}"))?;
            handle
                .authenticate_publickey(
                    username.clone(),
                    PrivateKeyWithHashAlg::new(Arc::new(secret), Some(HashAlg::Sha256)),
                )
                .await
                .map_err(|error| error.to_string())?
        }
        _ => return Err("password or private key required".into()),
    };
    if !matches!(auth, AuthResult::Success) {
        return Err("authentication failed".into());
    }

    // Pin the host key only after successful authentication.
    if expected.is_none() {
        if let Some(fingerprint) = observed.lock().ok().and_then(|slot| slot.clone()) {
            let mut map = read_known_hosts(&app);
            map.insert(key, fingerprint);
            if let Ok(path) = known_hosts_path(&app) {
                let _ = std::fs::write(
                    path,
                    serde_json::to_string_pretty(&map).unwrap_or_default(),
                );
            }
        }
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|error| error.to_string())?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|error| format!("sftp handshake failed: {error}"))?;
    let id = format!(
        "sftp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    );
    sessions
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(id.clone(), Arc::new(sftp));
    Ok(id)
}

#[tauri::command]
pub async fn sftp_read(
    sessions: tauri::State<'_, SftpSessions>,
    session: String,
    path: String,
) -> Result<Option<Vec<u8>>, String> {
    validate_remote_path(&path)?;
    let sftp = lookup_session(&sessions, &session).await?;
    match sftp.read(path).await {
        Ok(data) => Ok(Some(data)),
        Err(error) if is_missing(&error) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn sftp_write(
    sessions: tauri::State<'_, SftpSessions>,
    session: String,
    path: String,
    data: Vec<u8>,
) -> Result<(), String> {
    validate_remote_path(&path)?;
    let sftp = lookup_session(&sessions, &session).await?;
    // Create parents implicitly, like the local-folder provider.
    let mut prefix = String::new();
    let parts: Vec<&str> = path.split('/').collect();
    for part in &parts[..parts.len().saturating_sub(1)] {
        if part.is_empty() {
            continue;
        }
        prefix = format!("{prefix}/{part}");
        if let Err(error) = sftp.create_dir(prefix.clone()).await {
            if !is_exists(&error) {
                return Err(format!("mkdir {prefix}: {error}"));
            }
        }
    }
    sftp.write(path, &data)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    sessions: tauri::State<'_, SftpSessions>,
    session: String,
    path: String,
) -> Result<(), String> {
    validate_remote_path(&path)?;
    let sftp = lookup_session(&sessions, &session).await?;
    let mut prefix = String::new();
    for part in path.split('/') {
        if part.is_empty() {
            continue;
        }
        prefix = format!("{prefix}/{part}");
        if let Err(error) = sftp.create_dir(prefix.clone()).await {
            if !is_exists(&error) {
                return Err(format!("mkdir {prefix}: {error}"));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn sftp_exists(
    sessions: tauri::State<'_, SftpSessions>,
    session: String,
    path: String,
) -> Result<bool, String> {
    validate_remote_path(&path)?;
    let sftp = lookup_session(&sessions, &session).await?;
    sftp.try_exists(path).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sftp_remove(
    sessions: tauri::State<'_, SftpSessions>,
    session: String,
    path: String,
) -> Result<(), String> {
    validate_remote_path(&path)?;
    let sftp = lookup_session(&sessions, &session).await?;
    remove_tree(&sftp, &path).await
}

async fn remove_tree(sftp: &SftpSession, path: &str) -> Result<(), String> {
    match sftp.metadata(path).await {
        Err(error) if is_missing(&error) => return Ok(()),
        Err(error) => return Err(error.to_string()),
        Ok(metadata) => {
            if metadata.is_dir() {
                let entries = sftp
                    .read_dir(path)
                    .await
                    .map_err(|error| error.to_string())?;
                let children: Vec<String> = entries
                    .filter(|entry| entry.file_name() != "." && entry.file_name() != "..")
                    .map(|entry| format!("{path}/{}", entry.file_name()))
                    .collect();
                for child in children {
                    Box::pin(remove_tree(sftp, &child)).await?;
                }
                sftp.remove_dir(path)
                    .await
                    .map_err(|error| error.to_string())
            } else {
                sftp.remove_file(path)
                    .await
                    .map_err(|error| error.to_string())
            }
        }
    }
}

#[tauri::command]
pub async fn sftp_list(
    sessions: tauri::State<'_, SftpSessions>,
    session: String,
    path: String,
) -> Result<Vec<String>, String> {
    validate_remote_path(&path)?;
    let sftp = lookup_session(&sessions, &session).await?;
    let entries = match sftp.read_dir(path).await {
        Ok(entries) => entries,
        Err(error) if is_missing(&error) => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut names: Vec<String> = entries
        .filter(|entry| entry.file_name() != "." && entry.file_name() != "..")
        .map(|entry| entry.file_name())
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn sftp_disconnect(
    sessions: tauri::State<'_, SftpSessions>,
    session: String,
) -> Result<(), String> {
    sessions
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&session);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_segments_and_empty_paths() {
        assert!(validate_remote_path("Hamesh/books/x/meta.json").is_ok());
        assert!(validate_remote_path("/home/user/Hamesh").is_ok());
        assert!(validate_remote_path("Hamesh/../../etc/passwd").is_err());
        assert!(validate_remote_path("").is_err());
    }

    #[test]
    fn host_keys_are_scoped_by_port() {
        assert_eq!(host_key("example.com", 22), "example.com:22");
        assert_ne!(host_key("example.com", 22), host_key("example.com", 2222));
    }
}
