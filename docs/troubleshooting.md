# 🔧 Troubleshooting / Решение проблем

## Installation Issues / Проблемы установки

### "alloy: command not found" / alloy не найдена

```bash
# Check if installed / Проверить установку
which alloy

# If not found, reinstall / Если не найдено, переустановить
sudo cp /path/to/alloy /usr/local/bin/alloy
```

### Polkit policy not found / Политика polkit не найдена

```bash
# Check if policy exists / Проверить наличие политики
ls /usr/share/polkit-1/actions/com.github.alloy.fish.policy

# If missing, install manually / Если отсутствует, установить вручную
sudo cp src-tauri/policies/com.github.alloy.fish.policy \
  /usr/share/polkit-1/actions/
```

---

## Runtime Issues / Проблемы во время работы

### Combined Upgrade shows "Operation finished with errors" / Комбинированное обновление показывает ошибку

**Cause:** `yay` is being run as root or with wrong flags.

**Fix:** Ensure yay commands use `use_askpass: true` (runs as user, not root).

```rust
// Correct / Правильно
stream_cmd!(app, cmd_id, services::upgrade_stream_script(), false)

// Wrong — yay refuses to run as root / Неправильно — yay отказывается работать от root
stream_cmd!(app, cmd_id, services::upgrade_stream_script(), true)
```

### No zenity/kdialog dialog appears / Не появляется диалог пароля

**Cause:** No GUI dialog tool installed.

```bash
# Install zenity (GTK) or kdialog (KDE) / Установить zenity или kdialog
sudo pacman -S zenity
# or
sudo pacman -S kdialog
```

### Terminal shows no output / Терминал не показывает вывод

**Cause:** Tauri 2 capabilities not configured.

**Fix:** Ensure `src-tauri/capabilities/default.json` exists with event permissions:

```json
{
  "identifier": "default",
  "description": "Default capability for Alloy",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:event:allow-listen",
    "core:event:allow-emit",
    "core:event:allow-emit-to"
  ]
}
```

### Spinner stuck after operation / Спиннер зависает после операции

**Cause:** Exit event not reaching the frontend.

**Fix:** Ensure `tx_exit.blocking_send(StreamEvent::Exit { code })` is called inside the `spawn_blocking` closure, not after it.

### Package install succeeds but UI stays in loading state / Установка проходит, но интерфейс зависает

**Cause:** Same as above — Exit event lost.

**Fix:** Check that `exec_streaming_piped` sends Exit via `blocking_send` from inside the closure:

```rust
// Inside spawn_blocking / Внутри spawn_blocking
let _ = tx_exit.blocking_send(StreamEvent::Exit { code });

// NOT after the closure / НЕ после замыкания
// let _ = tx.send(StreamEvent::Exit { code }).await; // ← can miss!
```

---

## Build Issues / Проблемы сборки

### "failed to bundle project: failed to run linuxdeploy" / Ошибка сборки AppImage

**Cause:** `linuxdeploy` is not installed (only needed for AppImage bundling).

```bash
yay -S linuxdeploy
```

This only affects AppImage bundling. The raw binary at `src-tauri/target/release/alloy` works fine.

### Cargo build fails with unused variable warnings / Ошибки компиляции

```bash
# Fix warnings automatically / Исправить автоматически
cargo fix --lib -p alloy
```

### Frontend build fails / Сборка фронтенда не удаётся

```bash
# Clean and rebuild / Очистить и пересобрать
rm -rf dist/ node_modules/
npm install
npm run build
```

---

## Debugging / Отладка

### Enable Rust logging / Включить логирование Rust

Add to `lib.rs`:

```rust
env_logger::init();
```

Add to `Cargo.toml`:

```toml
[dependencies]
env_logger = "0.11"
```

### Check events in browser console / Проверить события в консоли браузера

Right-click → Inspect → Console tab. Look for `[Alloy]` log entries.

### File-based debug logging / Файловое логирование

Add to any Rust function:

```rust
use std::io::Write;
if let Ok(mut f) = std::fs::OpenOptions::new()
    .create(true).append(true)
    .open("/tmp/alloy-debug.log")
{
    let _ = writeln!(f, "[debug] message here");
}
```

Then: `tail -f /tmp/alloy-debug.log`

---

## Common Error Messages / Типичные сообщения об ошибках

| Error | Meaning | Fix |
|-------|---------|-----|
| `Command not found: fish` | fish shell not installed | `sudo pacman -S fish` |
| `polkit-agent-helper-1: not found` | polkit not installed | `sudo pacman -S polkit` |
| `yay: not found` | yay not installed | `yay -S yay` |
| `pkexec: not authorized` | No polkit policy | Install the policy file |
| `SUDO_ASKPASS` error | No zenity/kdialog | Install zenity |
| `Combined-upgrade: invalid flag` | Old yay version | Remove `--combined-upgrade` flag |
| AppImage shows "unknown image" | Icon extraction failed | Install `squashfs-tools` for `unsquashash` |
| .deb shows "unknown" / v0.0 | `dpkg-deb` not available | No fix needed — Alloy uses `ar`+`awk` natively |
| .deb size shows 0.0 MiB | `Installed-Size` missing from control file | Falls back to file size automatically |
| .rpm shows "unknown" / v0.0 | `rpm-tools` not installed | `sudo pacman -S rpm-tools` |
| debtap hangs during install | debtap no longer used for .deb | Alloy creates its own PKGBUILD now |
| "arch variable must not be empty" | makepkg warning (non-fatal) | Package still installs correctly |
