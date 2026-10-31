//! Manual SFTP handshake probe (dev tool, not shipped).
//!
//! Verifies the exact connect → auth → subsystem → session path the provider
//! uses, against any server, without involving the app:
//!
//! ```bash
//! SFTP_HOST=test.rebex.net SFTP_USER=demo SFTP_PASS=password \
//!   cargo run --example sftp_probe --manifest-path apps/reader/src-tauri/Cargo.toml
//! ```
use std::sync::{Arc, Mutex};

use russh::client::{self, AuthResult, Handle};
use russh::keys::{HashAlg, PublicKeyOrCertificate};
use russh_sftp::client::SftpSession;

struct AcceptAll {
    seen: Arc<Mutex<Option<String>>>,
}

impl client::Handler for AcceptAll {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        if let Ok(mut slot) = self.seen.lock() {
            *slot = Some(key.public_key().fingerprint(HashAlg::Sha256).to_string());
        }
        // Probe only: the real provider pins on first use.
        Ok(true)
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host = std::env::var("SFTP_HOST")?;
    let port: u16 = std::env::var("SFTP_PORT")
        .unwrap_or_else(|_| "22".into())
        .parse()?;
    let user = std::env::var("SFTP_USER")?;
    let password = std::env::var("SFTP_PASS")?;
    let seen = Arc::new(Mutex::new(None));
    let handler = AcceptAll { seen: seen.clone() };
    let config = Arc::new(client::Config::default());
    let mut session: Handle<AcceptAll> =
        client::connect(config, (host.as_str(), port), handler).await?;
    let auth = session
        .authenticate_password(user.clone(), password)
        .await?;
    if !matches!(auth, AuthResult::Success) {
        return Err("authentication failed".into());
    }
    println!("auth ok, host key {:?}", seen.lock().unwrap());
    let channel = session.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;
    println!("sftp handshake ok");
    let entries = sftp.read_dir("/").await?;
    let mut names: Vec<String> = entries.map(|entry| entry.file_name()).collect();
    names.sort();
    println!("root entries: {:?}", names);
    Ok(())
}
