#!/usr/bin/env bash
set -euo pipefail

APP_NAME="alloy"
INSTALL_DIR="/usr/local/bin"
POLICY_DIR="/usr/share/polkit-1/actions"
POLICY_FILE="com.github.alloy.fish.policy"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# --- Pre-flight checks ---
check_deps() {
    local missing=()
    for cmd in node npm cargo rustc fish; do
        command -v "$cmd" &>/dev/null || missing+=("$cmd")
    done
    if (( ${#missing[@]} )); then
        error "Missing required tools: ${missing[*]}"
    fi
    info "All build dependencies found"
}

# --- Install polkit policy ---
install_policy() {
    if [[ -f "$POLICY_DIR/$POLICY_FILE" ]]; then
        info "Polkit policy already installed"
        return
    fi
    warn "Installing polkit policy (requires authentication)..."
    cp "$SCRIPT_DIR/src-tauri/policies/$POLICY_FILE" "/tmp/$POLICY_FILE"
    pkexec cp "/tmp/$POLICY_FILE" "$POLICY_DIR/$POLICY_FILE"
    rm -f "/tmp/$POLICY_FILE"
    info "Polkit policy installed"
}

# --- Build ---
build_app() {
    info "Installing npm dependencies..."
    cd "$SCRIPT_DIR"
    npm install --prefer-offline 2>&1 | tail -1

    info "Building frontend..."
    npm run build 2>&1 | tail -3

    info "Building Tauri app (this may take a few minutes)..."
    cd "$SCRIPT_DIR"
    cargo tauri build -- --quiet 2>&1 | grep -v "linuxdeploy" || true
    info "Build complete"
}

# --- Install binary ---
install_binary() {
    local src="$SCRIPT_DIR/src-tauri/target/release/$APP_NAME"
    if [[ ! -f "$src" ]]; then
        error "Binary not found at $src — build may have failed"
    fi
    sudo cp "$src" "$INSTALL_DIR/$APP_NAME"
    chmod +x "$INSTALL_DIR/$APP_NAME"
    info "Installed $APP_NAME to $INSTALL_DIR/$APP_NAME"
}

# --- Create desktop entry ---
install_desktop_entry() {
    local icon_dir="$SCRIPT_DIR/src-tauri/icons"
    local icon_src="$icon_dir/icon.png"
    local icon_dest="/usr/share/pixmaps/alloy.png"
    local desktop_dir="/usr/share/applications"
    local desktop_file="$desktop_dir/alloy.desktop"

    if [[ -f "$icon_src" ]]; then
        sudo cp "$icon_src" "$icon_dest"
        info "Icon installed"
    fi

    sudo tee "$desktop_file" > /dev/null <<EOF
[Desktop Entry]
Name=Alloy
Comment=Arch Package Dropper
Exec=$INSTALL_DIR/$APP_NAME
Icon=$icon_dest
Type=Application
Categories=System;Utility;
Terminal=false
StartupWMClass=alloy
EOF
    info "Desktop entry created"
}

# --- Main ---
main() {
    echo "════════════════════════════════════════"
    echo "  Alloy — Arch Package Dropper Installer"
    echo "════════════════════════════════════════"
    echo

    check_deps
    install_policy
    build_app
    install_binary
    install_desktop_entry

    echo
    info "Installation complete! Run 'alloy' from anywhere."
}

main "$@"
