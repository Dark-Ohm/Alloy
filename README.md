# Alloy — Arch Package Dropper

A modern GUI package manager for Arch Linux. Install .deb, .rpm, .pkg.tar.zst, and AppImage files with drag-and-drop. Manage AUR packages, system updates, and maintenance from one app.

## Features

- **Drop Zone** — Drag and drop .deb, .rpm, .pkg.tar.zst, or .AppImage files for one-click install
- **Packages** — Search, install, and remove packages from official repos and AUR
- **System Update** — Full system upgrade with safety preview, downgrade warnings, and kernel detection
- **Applications** — Steam library-style launcher for all installed desktop apps
- **Maintenance** — Cache cleanup, orphan removal, config conflicts, PGP keyring, and AUR malware security scan
- **PKGBUILD Review** — User-friendly AUR package review with security checks

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, first run, system requirements |
| [Features Guide](docs/features.md) | Detailed walkthrough of every feature |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and how to fix them |
| [Architecture](docs/architecture.md) | Project structure, data flow, design decisions |
| [Build Guide](docs/building.md) | Build from source, development mode, packaging |
| [Commands API](docs/commands-api.md) | Complete reference of all Tauri commands |
| [Streaming System](docs/streaming.md) | How real-time command output works |
| [Contributing](docs/contributing.md) | Code style, PR guidelines, development workflow |

## Quick Start

```bash
# Install dependencies
npm install

# Development mode
npm run tauri:dev

# Build for production
npm run tauri:build
```

## License

MIT
