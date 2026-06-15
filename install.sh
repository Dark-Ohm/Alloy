#!/usr/bin/env bash
# Alloy Installer with GUI dialogs
# No terminal required - uses zenity for user interaction

set -euo pipefail

APP_NAME="alloy"
INSTALL_DIR="/usr/local/bin"
POLICY_DIR="/usr/share/polkit-1/actions"
POLICY_FILE="com.github.alloy.fish.policy"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors for console output (fallback)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# --- Check for zenity ---
if ! command -v zenity &>/dev/null; then
    warn "zenity not found - installing..."
    if command -v pkexec &>/dev/null; then
        pkexec pacman -S --noconfirm zenity
    else
        error "Cannot install zenity - please run: sudo pacman -S zenity"
    fi
fi

# --- Pre-flight check ---
zenity --info \
    --title="Alloy — Arch Package Dropper" \
    --text="This will install Alloy on your Arch Linux system.\n\n• Build the frontend and backend\n• Install the binary to /usr/local/bin\n• Install polkit policy for privilege escalation\n• Create desktop entry in your application menu\n\nContinue?" \
    --ok-label="Start Installation" \
    --cancel-label="Cancel" 2>/dev/null || exit 0

# --- Check build tools ---
missing_tools=()
for cmd in node npm cargo rustc fish; do
    if ! command -v "$cmd" &>/dev/null; then
        missing_tools+=("$cmd")
    fi
done

if (( ${#missing_tools[@]} )); then
    error "Missing required tools: ${missing_tools[*]}\nInstall with: sudo pacman -S --needed base-devel nodejs npm rust fish"
fi
info "All build tools found"

# --- Install polkit policy ---
zenity --info \
    --title="Polkit Policy" \
    --text="Alloy needs to install a polkit policy for privilege escalation.\n\nThis will prompt for your password." \
    --ok-label="Continue" 2>/dev/null || true

if [[ -f "$POLICY_DIR/$POLICY_FILE" ]]; then
    info "Polkit policy already installed"
else
    if pkexec cp "$SCRIPT_DIR/src-tauri/policies/$POLICY_FILE" "$POLICY_DIR/" 2>/dev/null; then
        info "Polkit policy installed"
    else
        warn "Polkit policy installation failed - you may need to install it manually later"
    fi
fi

# --- Build ---
(
    echo "20"
    echo "# Installing npm dependencies..."
    cd "$SCRIPT_DIR"
    npm install --prefer-offline 2>&1 | tail -1
    echo "50"
    echo "# Building frontend..."
    npm run build 2>&1 | tail -1
    echo "80"
    echo "# Building Tauri app..."
    cargo tauri build -- --release 2>&1 | tail -1
    echo "100"
    echo "# Done!"
) | zenity --progress \
    --title="Building Alloy" \
    --text="Installing dependencies..." \
    --percentage=0 \
    --auto-close \
    --no-cancel \
    2>/dev/null || error "Build cancelled or failed"

# --- Install binary ---
BINARY="$SCRIPT_DIR/src-tauri/target/release/$APP_NAME"
if [[ -f "$BINARY" ]]; then
    sudo cp "$BINARY" "$INSTALL_DIR/$APP_NAME"
    sudo chmod +x "$INSTALL_DIR/$APP_NAME"
    info "Binary installed to $INSTALL_DIR/$APP_NAME"
else
    error "Build failed - binary not found at $BINARY"
fi

# --- Create desktop entry ---
if zenity --question \
    --title="Desktop Entry" \
    --text="Create desktop entry in your application menu?\n\nYou'll be able to launch Alloy from your app launcher." \
    --ok-label="Create" \
    --cancel-label="Skip" 2>/dev/null; then
    
    if "$INSTALL_DIR/$APP_NAME" --create-desktop-entry 2>/dev/null || \
       invoke_args=("create_alloy_desktop_entry") npm run invoke 2>/dev/null; then
        info "Desktop entry created"
    else
        # Manual creation
        DESK_DIR="$HOME/.local/share/applications"
        mkdir -p "$DESK_DIR"
        cat > "$DESK_DIR/alloy.desktop" << EOF
[Desktop Entry]
Type=Application
Name=Alloy
Comment=Arch Package Dropper
Exec=alloy
Icon=alloy
Terminal=false
Categories=System;PackageManager;
EOF
        info "Desktop entry created manually"
    fi
fi

zenity --info \
    --title="Installation Complete" \
    --text="Alloy has been installed successfully!\n\nLaunch it from your application menu or run:\n  $APP_NAME" \
    --ok-label="Launch Alloy" 2>/dev/null && \
    "$INSTALL_DIR/$APP_NAME" &

info "Installation complete! Run '$APP_NAME' to start."
