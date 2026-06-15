# 📡 Streaming System / Потоковая система

Alloy uses a streaming architecture to display real-time command output from the Rust backend to the React frontend.

## Overview / Обзор

```
Rust Command → mpsc channel → tokio forwarder → app.emit() → Frontend listen()
```

## How It Works / Как это работает

### 1. Frontend Initiates / Фронтенд инициирует

```typescript
const cmdId = `upgrade-${Date.now()}`

// Register listener BEFORE invoking the command
const unlisten = await listen(`stream-${cmdId}`, (event) => {
  const p = event.payload
  if (p.kind === 'stdout') appendLine(p.line)
  if (p.kind === 'progress') updateProgress(p.pct)
  if (p.kind === 'exit') finish(p.code)
})

// Start the command
await invoke('yay_upgrade_combined', { cmdId })
```

### 2. Rust Creates Channel / Rust создаёт канал

```rust
let (tx, mut rx) = mpsc::channel::<StreamEvent>(512);
let tag = format!("stream-{cmd_id}");

// Spawn task to forward events
let app_fwd = app.clone();
tokio::spawn(async move {
    while let Some(ev) = rx.recv().await {
        let _ = app_fwd.emit(&tag, ev);
    }
});

// Execute the command
fish::exec_streaming(&script, pkexec, tx).await
```

### 3. Command Execution / Выполнение команды

The `exec_streaming` function spawns a blocking task:

```rust
tokio::task::spawn_blocking(move || {
    // Spawn child process
    let mut child = Command::new(FISH)
        .arg("-c").arg(&script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Read stdout in a thread
    let h1 = thread::spawn(|| {
        for line in BufReader::new(stdout).lines() {
            tx.try_send(StreamEvent::Stdout { line })
        }
    });

    // Read stderr in another thread
    let h2 = thread::spawn(|| {
        for line in BufReader::new(stderr).lines() {
            tx.try_send(StreamEvent::Stdout { line })
        }
    });

    // Wait for all output
    h1.join();
    h2.join();

    // Get exit code
    let status = child.wait()?;

    // Send exit event (using blocking_send for reliability)
    tx_exit.blocking_send(StreamEvent::Exit { code: status.code() });
})
```

### 4. Frontend Receives Events / Фронтенд получает события

The listener callback processes each event:

```typescript
listen(`stream-${cmdId}`, (event) => {
  const p = event.payload

  switch (p.kind) {
    case 'stdout':
      // Append line to terminal
      setTerminalLines(prev => [...prev, p.line])
      break

    case 'progress':
      // Update progress bar
      setBarPct(p.pct)
      break

    case 'exit':
      // Command finished
      resolve(p.code === 0)
      break
  }
})
```

## Event Types / Типы событий

| Event | Fields | Description |
|-------|--------|-------------|
| `stdout` | `{ line: string }` | A line of standard output |
| `stderr` | `{ line: string }` | A line of standard error |
| `progress` | `{ pkgName, pkgNum, pkgTotal, pct }` | Package progress bar |
| `transactionSummary` | `{ totalPackages, packageNames }` | Package list before install |
| `exit` | `{ code: number }` | Command finished with exit code |
| `error` | `{ message: string }` | Fatal error |

## Channel Capacity / Ёмкость канала

- **Buffer size:** 512 events
- **Strategy:** `try_send` for stdout/stderr (non-blocking, drops if full)
- **Exit event:** `blocking_send` (guaranteed delivery, waits for space)

## Privilege Modes / Режимы привилегий

### pkexec Mode (Root Commands) / Режим pkexec (команды root)

For `pacman` commands that need root:

```
pkexec fish -c "pacman -Syu --noconfirm"
```

- Authenticated via polkit GUI dialog
- Runs as root
- Piped stdout/stderr (not PTY)

### Askpass Mode (User Commands) / Режим askpass (команды пользователя)

For `yay` commands that run as user:

```
fish -c "yay -Syu --noconfirm"
// with SUDO_ASKPASS=/tmp/alloy-askpass.sh
```

- Authenticated via zenity/kdialog/rofi
- Runs as current user
- yay handles its own sudo internally

## Tauri 2 Capabilities / Возможности Tauri 2

For `app.emit()` and `listen()` to work, Tauri 2 requires explicit permission grants:

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "core:event:default",
    "core:event:allow-listen",
    "core:event:allow-emit",
    "core:event:allow-emit-to",
    "dialog:default",
    "fs:default"
  ]
}
```

Without these capabilities, events are silently blocked.

## Error Handling / Обработка ошибries

| Scenario | Behavior |
|----------|----------|
| Command not found | `spawn` returns error → `StreamEvent::Error` sent |
| Command fails (non-zero exit) | Exit code sent → frontend shows error state |
| Channel buffer full | `try_send` drops the event (OK for stdout, not for exit) |
| spawn_blocking panics | Caught by tokio JoinHandle → error message sent |
| Frontend unmounts | Listener auto-unregistered by Tauri |
