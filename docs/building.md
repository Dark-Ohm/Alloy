# 🔧 Build Guide / Руководство по сборке

## Prerequisites / Предварительные требования

### System Packages / Системные пакеты

```bash
# Build tools / Инструменты сборки
sudo pacman -S base-devel rust npm nodejs fish

# AUR helper (if not installed) / Помощник AUR (если не установлен)
git clone https://aur.archlinux.org/yay.git
cd yay && makepkg -si
```

### Rust Toolchain / Инструментарий Rust

```bash
# Install rustup if not present / Установить rustup если нет
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

### Node.js / npm

```bash
# Should be ≥18 / Должно быть ≥18
node --version
npm --version
```

## Development Mode / Режим разработки

```bash
cd alloy

# Install npm dependencies / Установить npm зависимости
npm install

# Start dev mode (frontend hot-reload + Rust backend) / Запустить режим разработки
cargo tauri dev
```

This opens Alloy with:
- Frontend: Vite dev server with hot-reload on port 1420
- Backend: Rust with debug symbols, auto-recompiles on change

## Production Build / Промышленная сборка

```bash
cd alloy

# Install dependencies / Установить зависимости
npm install

# Build everything / Собрать всё
npm run build                    # Frontend → dist/
cargo tauri build -- --release   # Tauri → src-tauri/target/release/alloy
```

Output:
- Binary: `src-tauri/target/release/alloy`
- Frontend assets embedded in the binary

## Build Script Details / Детали скрипта сборки

### Frontend Build / Сборка фронтента

```bash
npm run build
# Runs: tsc -b && vite build
# Output: dist/index.html + dist/assets/
```

### Backend Build / Сборка бэкенда

```bash
cargo tauri build -- --release
# Compiles Rust code with optimizations
# Embeds frontend assets from dist/
# Produces: src-tauri/target/release/alloy
```

### Build Script (build.rs) / Скрипт сборки

The Rust `build.rs` generates PNG icons if they don't exist:

```rust
// Generates 512x512, 256x256, 128x128, 32x32 icons
// Uses miniz_oxide for PNG compression
```

## AppImage Bundling / Сборка AppImage

Requires `linuxdeploy` (not installed by default):

```bash
# Install linuxdeploy / Установить linuxdeploy
yay -S linuxdeploy

# Build with bundling / Собрать с упаковкой
cargo tauri build -- --bundles appimage
```

Output: `src-tauri/target/release/bundle/appimage/Alloy_1.0.0_amd64.AppImage`

## Install to System / Установка в систему

```bash
# Copy binary / Скопировать бинарник
sudo cp src-tauri/target/release/alloy /usr/local/bin/alloy

# Create desktop entry (optional) / Создать запись меню (опционально)
sudo tee /usr/share/applications/alloy.desktop <<EOF
[Desktop Entry]
Name=Alloy
Comment=Arch Package Dropper
Exec=/usr/local/bin/alloy
Icon=alloy
Type=Application
Categories=System;Utility;
Terminal=false
EOF
```

## Polkit Policy / Политика polkit

For privilege escalation, Alloy requires a polkit policy for fish:

```bash
# Auto-installed on first run / Автоматически устанавливается при первом запуске
# Manual install / Ручная установка:
sudo cp src-tauri/policies/com.github.alloy.fish.policy \
  /usr/share/polkit-1/actions/
```

## Clean Build / Чистая сборка

```bash
# Remove build artifacts / Удалить артефакты сборки
rm -rf src-tauri/target/
rm -rf dist/
rm -rf node_modules/

# Rebuild / Пересобрать
npm install
npm run build
cargo tauri build -- --release
```

## Troubleshooting Build Problems / Решение проблем сборки

| Problem | Solution |
|---------|----------|
| `cargo: command not found` | Install rustup: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `npm: command not found` | Install nodejs: `sudo pacman -S nodejs npm` |
| `fish: command not found` | Install fish: `sudo pacman -S fish` |
| `failed to bundle appimage` | Install linuxdeploy: `yay -S linuxdeploy` |
| `permission denied` on polkit | Run `sudo cp ...` for the policy file |
