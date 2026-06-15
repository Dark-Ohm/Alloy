# 🚀 Getting Started / Начало работы

## System Requirements / Системные требования

| Component | Required | Purpose |
|-----------|----------|---------|
| Arch Linux | ✅ | The only supported OS |
| fish shell | ✅ | Command execution engine |
| yay | ⭐ Recommended | AUR helper for community packages |
| pkexec + zenity | ✅ | Privilege escalation with GUI prompts |
| rpm-tools | ⭐ Recommended | RPM package analysis (`rpm -qip`) |
| Node.js + npm | 🔧 Build only | Frontend compilation |
| Rust + cargo | 🔧 Build only | Backend compilation |

## Installation / Установка

### Method 1: Install Script (Recommended) / Способ 1: Скрипт установки (Рекомендуется)

```bash
git clone https://github.com/YOUR_USERNAME/alloy.git
cd alloy
./install.sh
```

The script will:
1. Check that all build tools are installed
2. Install the polkit policy for fish
3. Build the frontend (npm) and backend (cargo)
4. Copy the binary to `/usr/local/bin/alloy`
5. Create a desktop entry in your application menu

### Method 2: Manual Installation / Способ 2: Ручная установка

```bash
# Clone the repository / Клонировать репозиторий
git clone https://github.com/YOUR_USERNAME/alloy.git
cd alloy

# Install dependencies / Установить зависимости
npm install

# Build frontend / Собрать фронтенд
npm run build

# Build the Tauri app / Собрать Tauri приложение
cargo tauri build -- --release

# Install the binary / Установить бинарный файл
sudo cp src-tauri/target/release/alloy /usr/local/bin/alloy
```

### Method 3: Development Mode / Способ 3: Режим разработки

```bash
npm install
cargo tauri dev
```

This starts Alloy in development mode with hot-reload for the frontend.

## First Run / Первый запуск

After installation, run Alloy from your terminal or application menu:

```bash
alloy
```

On first launch, Alloy will:
1. ✅ Check system dependencies (pacman, yay, fish, pkexec)
2. ✅ Install the polkit policy if missing (requires password)
3. ✅ Display the main interface

## Verifying Installation / Проверка установки

Run in terminal:

```bash
which alloy
# Should output: /usr/local/bin/alloy

alloy --version  # (if supported)
```

Check system deps in the sidebar — all green indicators mean Alloy is ready.

## Uninstallation / Удаление

```bash
sudo rm /usr/local/bin/alloy
sudo rm /usr/share/applications/alloy.desktop
sudo rm /usr/share/polkit-1/actions/com.github.alloy.fish.policy
rm -rf ~/.config/alloy/
```
