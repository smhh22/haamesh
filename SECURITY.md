# Security policy

## Supported versions

Security fixes land in the latest 1.x release. Older releases are not patched;
please update through the app (Settings → Updates) or from the
[releases page](https://github.com/smhh22/haamesh/releases/latest).

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through GitHub's security
advisories so a fix and a release can be prepared before details are public:

<https://github.com/smhh22/haamesh/security/advisories/new>

Please include:

- The Hāmesh version (Settings → Updates) and how it was installed
  (deb, rpm, AppImage, Windows installer, Android APK, web build, or source).
- Affected OS and version.
- Impact: what an attacker could do, and what they need (a malicious book file,
  a compromised sync server, network access, local access, …).
- Reproduction steps or a proof of concept, with any book file trimmed to the
  minimum that triggers the issue.
- Relevant logs with book content, server addresses, and credentials redacted.

## Scope

In scope:

- The desktop shell and its Tauri commands (file access, SQLite bridge, keychain,
  update installer).
- The reading pipeline: EPUB sanitizing and the content CSP, PDF/Markdown import,
  book file handling.
- Sync providers (WebDAV, S3-compatible, Dropbox, SFTP, local folder), the wire
  format, and credential storage.
- Release artifacts and the auto-updater (signing, manifest handling).

Out of scope:

- Vulnerabilities in third-party services (a user's WebDAV/S3/SFTP server,
  Dropbox, an LLM or translation provider).
- Social engineering and physical access.
- Issues that require an already-compromised OS, rooted device, or malicious
  browser extension with access to the app's storage.

## Our process

- We aim to acknowledge reports within a few days and to keep you informed while
  a fix is prepared.
- Fixes are released with the next patch/minor release; the advisory is
  published after users can update.
- Credit is given in the advisory unless you prefer to stay anonymous.
- There is no bug bounty.

## Security model, briefly

Hāmesh has no accounts, no telemetry, and no vendor servers. Secrets (sync
credentials, provider API keys) live in the OS keychain on desktop. Book
documents are sanitized (scripts and handlers removed, restrictive CSP always
injected) before they enter the reader. Updates are signed and verified. Sync
traffic goes only to storage the user configures. Reports that rely on changing
these guarantees are especially welcome.
