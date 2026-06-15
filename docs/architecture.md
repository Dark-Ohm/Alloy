# 🏗️ Architecture / Архитектура

## Project Structure / Структура проекта

```
alloy/
├── src-tauri/                    # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── lib.rs                # App entry point, command registration
│   │   ├── commands.rs           # 35+ Tauri command handlers
│   │   ├── services.rs           # System operations, app scan/icon/category (~920 lines)
│   │   ├── fish.rs               # Shell execution engine
│   │   └── models.rs             # Data structures & config
│   ├── capabilities/
│   │   └── default.json          # Tauri 2 permissions (event:allow-emit, etc.)
│   ├── policies/
│   │   └── com.github.alloy.fish.policy  # Polkit policy for fish
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri configuration
├── src/                          # React frontend
│   ├── App.tsx                   # Root component, page routing
│   ├── store.ts                  # Zustand global state
│   ├── pages/
│   │   ├── SystemUpdatePage.tsx  # System upgrade with progress bars
│   │   ├── PackagesPage.tsx      # Search, install, remove packages
│   │   ├── MaintenancePage.tsx   # Cache cleanup, orphans, keys
│   │   ├── ApplicationsPage.tsx  # Categorized app launcher (icons, filters, search)
│   │   ├── ConfigPage.tsx        # PKGBUILD review, AUR config
│   │   └── SettingsPage.tsx      # App settings
│   ├── components/
│   │   ├── DropZone.tsx          # Drag & drop package installer
│   │   ├── Sidebar.tsx           # Navigation sidebar
│   │   └── ui.tsx                # Shared UI components (Card, Button, etc.)
│   └── types/
│       └── index.ts              # TypeScript interfaces
├── install.sh                    # One-command installer
└── docs/                         # This documentation
```

## Tech Stack / Технический стек

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Desktop framework | [Tauri 2](https://tauri.app) | Native desktop app with web frontend |
| Backend | Rust (2021 edition) | System operations, privilege escalation |
| Frontend | React 18 + TypeScript | UI rendering |
| Styling | Tailwind CSS | Utility-first CSS |
| State | Zustand | Lightweight state management |
| Routing | Custom (no router lib) | Page switching via store |
| Shell | fish | All commands execute through fish |
| Auth | pkexec + zenity | Privilege escalation via polkit |

## Data Flow / Поток данных

### Command Execution Flow / Поток выполнения команды

```
Frontend (React)
    │
    ├── invoke('command_name', { cmdId: id })
    │
    ▼
Tauri IPC Layer
    │
    ▼
Rust Command Handler (commands.rs)
    │
    ├── Creates mpsc channel (tx, rx)
    │
    ├── Spawns tokio task: forwards rx → app.emit('stream-{id}', event)
    │
    └── Calls fish::exec_streaming(script, pkexec, tx)
            │
            ▼
        fish.rs (spawn_blocking)
            │
            ├── pkexec mode: std::process::Command → pkexec fish -c "script"
            │   (piped stdout/stderr → line reader threads → tx)
            │
            └── askpass mode: fish -c "script" with SUDO_ASKPASS
                (piped stdout/stderr → line reader threads → tx)
                    │
                    ▼
                mpsc channel (tx)
                    │
                    ▼
                tokio::spawn task → app.emit('stream-{id}', event)
                    │
                    ▼
                Frontend listen('stream-{id}', callback)
                    │
                    ▼
                UI updates (terminal lines, progress bars, spinners)
```

### Streaming Events / Потоковые события

| Event | Direction | Purpose |
|-------|-----------|---------|
| `Stdout` | Rust → Frontend | Standard output line |
| `StdoutRedraw` | Rust → Frontend | In-place progress bar update (`\r`) |
| `Progress` | Rust → Frontend | Parsed progress: package name, percentage |
| `TransactionSummary` | Rust → Frontend | Package list before install |
| `Exit` | Rust → Frontend | Command finished (exit code) |
| `Error` | Rust → Frontend | Fatal error message |

## Privilege Model / Модель привилегий

Alloy handles two types of privileged operations:

### 1. Pacman Operations (Root Required) / Операции pacman (требуется root)

Uses `pkexec` with a polkit policy:

```rust
pkexec fish -c "pacman -Syu --noconfirm"
```

The polkit policy (`com.github.alloy.fish.policy`) authorizes fish to run as root.

### 2. Yay Operations (User with sudo) / Операции yay (пользователь с sudo)

yay **refuses to run as root**. Instead:

```rust
// Script: yay -Syu --noconfirm
// Environment: SUDO_ASKPASS=/tmp/alloy-askpass.sh
// When yay calls sudo, it uses zenity to prompt for password
```

The askpass script at `/tmp/alloy-askpass.sh` tries:
1. `zenity --password` (GTK)
2. `kdialog --password` (KDE)
3. `rofi -dmenu -password` (通用)

## Configuration / Конфигурация

Stored at `~/.config/alloy/config.json`:

```json
{
  "installed": {
    "tuxguitar": {"version": "2.0.1_linux_swt", "kind": "deb"},
    "spotify-launcher": {"version": "0.6.6-1", "kind": "pkg-tar"},
    "micclient-x86_64": {"version": "", "kind": "appimage"}
  },
  "section": {
    "key": "value"
  }
}
```

The `installed` section tracks packages installed through Alloy with their version and format kind (`deb`, `rpm`, `pkg-tar`, `appimage`). Managed via `track_install()`, `track_remove()`, `list_tracked_installs()` in `models.rs`.

## Security Considerations / Соображения безопасности

1. **Polkit policy** only authorizes `/usr/bin/fish` — not arbitrary commands
2. **SUDO_ASKPASS** uses system GUI dialogs — no passwords in terminal output
3. **No password storage** — credentials are never saved to disk
4. **Tauri capabilities** — explicit permission grants for events and dialogs
5. **fish shell** — prevents command injection via shell metacharacters
