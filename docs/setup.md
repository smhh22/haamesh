# Development setup

## Current machine status

As of 2026-10-29:

- Node.js 22, pnpm 12, Rust 1.99, and WebKitGTK 4.1 (2.52.6) are installed.
- `apps/reader/src-tauri` is scaffolded; the debug binary builds and opens a
  window.
- Windows builds have not been exercised on this machine yet.

## Web shell

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The app imports EPUBs into the library and opens
them in the reader. The Vite port is strict so Tauri can rely on it.

## Desktop shell (Tauri v2)

From the repository root:

```bash
pnpm tauri:dev     # starts Vite, builds Rust, opens the desktop window
pnpm tauri:build   # production desktop bundle
```

`beforeDevCommand` runs `pnpm dev`, so stop any standalone Vite server first;
the strict port would otherwise conflict.

Configuration lives in `apps/reader/src-tauri/tauri.conf.json`:

- product name `Hamesh`, identifier `app.hamesh.reader`;
- window title `Hāmesh`, 1200×800;
- `frontendDist` is `../dist` (Vite output);
- dev URL is `http://localhost:5173`.

Keep Tauri commands thin: filesystem, SQLite, keychain, and native parsers. No
business logic in Rust that belongs in `packages/*`.

## Fresh machine prerequisites

### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y \
  build-essential curl wget file libssl-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev
```

Install Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version
cargo --version
pkg-config --modversion webkit2gtk-4.1
```

References: Tauri v2 prerequisites,
<https://v2.tauri.app/start/prerequisites/>.

### Windows

- Install Visual Studio 2022 Build Tools with the "Desktop development with C++"
  workload.
- Install Rust from <https://rustup.rs>.
- WebView2 is preinstalled on Windows 10/11; the Evergreen runtime is required.

### Disk

Budget roughly 10 GB free for Rust targets plus `node_modules`. Check with
`df -h`.

## Checks

```bash
pnpm lint       # biome + typecheck + boundaries + logical properties
pnpm test
pnpm test:e2e
pnpm build
```
