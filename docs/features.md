# ✨ Features Guide / Руководство по функциям

Alloy has 6 main sections, each accessible from the sidebar.

---

## 1. 📥 Drop Zone / Зона перетаскивания

The Drop Zone is Alloy's signature feature. Drag and drop package files directly onto the app window, or click to browse using the native file dialog.

### Supported Formats / Поддерживаемые форматы

| Format | Extension | Source | Action |
|--------|-----------|--------|--------|
| Debian package | `.deb` | Ubuntu/Debian | Parses natively with `ar`+`tar`+`awk`, converts to Arch package |
| RPM package | `.rpm` | Fedora/RHEL | Parses with `rpm -qip`, converts to Arch package |
| Arch tarball | `.tar.*.zst` | Arch Linux | Installs directly via `pacman -U` |
| Pre-built Arch package | `.pkg.tar` | Arch Linux | Installs directly via `pacman -U` (no conversion needed) |
| AppImage | `.AppImage` | Any Linux | Copies to `~/.local/share/appimages/`, extracts icon, creates desktop entry |

### How it Works / Как это работает

1. **Analyze** — Alloy reads the package metadata (name, version, dependencies, description)
2. **Review** — You see the analysis before confirming installation
3. **Build** — For .deb/.rpm: creates a PKGBUILD with sanitized version, extracts data to `src/`, runs `makepkg -e`
4. **Install** — Installs the package with `pacman -U`
5. **Desktop Entry** — Automatically finds and installs `.desktop` files if present

### Package Tracking / Отслеживание пакетов

All packages installed through Alloy are tracked in `~/.config/alloy/config.json`. The Drop Zone shows a list of installed packages with remove buttons — only packages installed via Alloy, not all foreign packages.

---

## 2. 📦 Packages / Пакеты

Search, install, and remove packages from both official repositories and AUR.

### Search / Поиск

- **Official repos** — Uses `pacman -Ss`
- **AUR** — Uses `yay -Ss`
- Toggle between modes with the AUR switch

### Package Operations / Операции с пакетами

| Action | Command | Description |
|--------|---------|-------------|
| Install | `pacman -S` / `yay -S` | Install selected packages |
| Remove | `pacman -Rns` | Remove packages and unused dependencies |
| Info | `pacman -Qi` | Show detailed package information |
| List Installed | `pacman -Q` | Show all installed packages |

### Dependency Tree / Дерево зависимостей

- **Forward** (`pactree <pkg>`) — Shows what this package depends on
- **Reverse** (`pactree -r <pkg>`) — Shows what depends on this package

### PKGBUILD Review / Просмотр PKGBUILD

For AUR packages, Alloy can fetch and display the PKGBUILD file before installation so you can review the build script.

---

## 3. 🔄 System Update / Обновление системы

Two upgrade modes:

### Full System Upgrade / Полное обновление

```bash
pacman -Syu --noconfirm
```

Updates only official repository packages.

### Combined Upgrade / Комбинированное обновление

```bash
yay -Syu --noconfirm
```

Updates both official repos AND AUR packages in one operation.

### Breaking Update Protection / Защита от критических обновлений

If `informant` is installed, Alloy checks Arch Linux news before allowing upgrades. Unread breaking news will block the upgrade until you read and acknowledge them.

---

## 4. 🚀 Applications / Приложения

A "Steam library"-style launcher for every installed desktop application, organized into
user-friendly categories with real app icons.

- Lists all `.desktop` files from standard XDG directories
- **Real icons** — each app's `Icon=` entry is resolved against the system icon themes
  (`hicolor`, `Papirus`, `breeze`, `Adwaita`, …), `~/.local/share/icons`, and
  `/usr/share/pixmaps`, then delivered to the UI as an inline base64 `data:` URI. Apps with
  no resolvable icon fall back to a colored letter-avatar.
- **Categories** — apps are auto-sorted into **Productivity**, **Gaming**, **Tools**,
  **Media**, and an **Other** catch-all, derived from the freedesktop `Categories=` field in
  each `.desktop` file. Each category renders as its own labeled section with an icon header
  and a live count.
- **Filtering & search** — filter pills (All + each non-empty category, with counts) and a
  name search box narrow the grid instantly, with a fade transition between views.
- One-click launch using `dex` or `gtk-launch`

### Category mapping / Сопоставление категорий

Buckets are matched by **priority** (Gaming → Media → Productivity → Tools), not by tag
order — so Steam (`Network;FileTransfer;Game`) lands in **Gaming**, not Productivity.

| Bucket | Freedesktop categories matched |
|--------|--------------------------------|
| Gaming | `Game` |
| Media | `AudioVideo`, `Audio`, `Video`, `Graphics`, `Player`, `Photography`, `Music`, `Recorder`, `TV` |
| Productivity | `Office`, `Development`, `IDE`, `TextEditor`, `WebBrowser`, `Network`, `Email`, `Finance`, `Calendar`, `Spreadsheet`, `WordProcessor`, `Presentation`, `Chat`, `InstantMessaging` |
| Tools | `Utility`, `System`, `Settings`, `Accessibility`, `Security`, `Archiving`, `Compression`, `FileManager`, `TerminalEmulator`, `PackageManager`, `Monitor`, `HardwareSettings` |
| Other | anything unmatched (or no `Categories=`) |

Icon resolution prefers scalable SVG, then PNG at 128 → 96 → 64 → 48 → 256 → 32 px; files
larger than 256 KB are skipped to keep the payload small. Implemented in
`src-tauri/src/services.rs` (`categorize`, `resolve_icon_data_uri`).

---

## 5. 🧹 Maintenance / Обслуживание

### Package Cache Cleanup / Очистка кэша пакетов

```bash
paccache -rk <N>     # Keep N versions of each package
paccache -ruk0        # Remove ALL cached versions of uninstalled packages
```

### Orphan Packages / Пакеты-сироты

Remove packages that were installed as dependencies but are no longer needed:

```bash
yay -Yc --noconfirm
```

### .pacnew / .pacsave Files / Файлы .pacnew / .pacsave

Scans the entire system for configuration file backups created during package upgrades. These may need manual review.

### PGP Key Management / Управление ключами PGP

- **Initialize** — `pacman-key --init`
- **Populate** — `pacman-key --populate archlinux`
- **Refresh** — `pacman-key --refresh-keys`

### Disk Usage / Использование диска

Shows the size of the pacman package cache.

---

## 6. ⚙️ Settings / Настройки

Configure Alloy preferences. Settings are stored in `~/.config/alloy/config.json`.

---

## Terminal Output / Вывод в терминал

Every streaming operation shows live output in the terminal panel at the bottom of the screen. The terminal:

- Displays color-coded output (errors in red, warnings in yellow, progress in green)
- Shows real-time progress bars for package downloads/installs
- Auto-scrolls to the latest output
- Keeps the last 2000 lines to prevent memory issues
