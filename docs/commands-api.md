# 📖 Commands API Reference / Справочник команд API

All commands are invoked from the frontend via Tauri's `invoke()` function.

**Syntax:**
```typescript
import { invoke } from '@tauri-apps/api/core'

const result = await invoke<ReturnType>('command_name', { param: value })
```

**Tauri 2 naming:** Rust `snake_case` parameters become `camelCase` in JavaScript.
Example: Rust `cmd_id` → JS `cmdId`.

---

## System Readiness / Готовность системы

### `check_system_deps`

Checks which system tools are installed.

```typescript
const deps = await invoke<SystemDeps>('check_system_deps')
// deps.pacman.installed → boolean
// deps.yay.installed → boolean
// deps.fish.installed → boolean
// deps.pkexec.installed → boolean
// deps.debtap.installed → boolean
// deps.makepkg.installed → boolean
```

---

## Shell Execution / Выполнение команд

### `fish_shot`

Execute a one-shot fish shell command. Returns stdout, stderr, and exit code.

```typescript
const [stdout, stderr, code] = await invoke<[string, string, number]>('fish_shot', {
  script: 'echo hello'
})
```

### `fish_stream`

Execute a streaming fish shell command. Events are emitted via `listen('stream-{cmdId}')`.

```typescript
await invoke('fish_stream', {
  cmdId: 'unique-id-123',
  script: 'echo streaming',
  pkexec: false  // true for root commands
})
```

---

## Package Analysis / Анализ пакетов

### `analyze_package`

Analyzes a package file. Format detection:

| Format | Detection | Parsing |
|--------|-----------|---------|
| `.deb` | Extension | `ar` extracts `control.tar.*`, `awk` parses control file |
| `.rpm` | Extension | `rpm -qip` (requires `rpm-tools`) |
| `.tar.*` | Extension | Lists contents, checks for PKGBUILD |
| `.pkg.tar` | Filename contains `.pkg.tar` | Direct install — no build needed |
| `.AppImage` | Filename ends with `.AppImage` | `file -b` verification |

```typescript
const analysis = await invoke<PackageAnalysis>('analyze_package', {
  path: '/home/user/package.deb'
})
// analysis.format → 'deb' | 'rpm' | 'tar' | 'pkg-tar' | 'appimage'
// analysis.packageName → string
// analysis.version → string
// analysis.description → string
// analysis.dependencies → string[]
// analysis.arch → string
```

### `execute_installation`

Full pipeline: analyze → build (if needed) → install. Streams progress via events.

```typescript
const cmdId = `install-${Date.now()}`
const unlisten = await listen(`stream-${cmdId}`, (ev) => {
  // ev.payload.kind: 'stdout' | 'exit' | 'error'
})
const result = await invoke<InstallResult>('execute_installation', {
  cmdId,
  path: '/home/user/package.deb'
})
// result.success → boolean
// result.packageName → string
// result.desktopFile → string | null
```

---

## Pacman Operations / Операции pacman

### `pacman_sync`

Synchronizes the package database.

```typescript
const [stdout, stderr, code] = await invoke<[string, string, number]>('pacman_sync')
```

### `pacman_search`

Search for packages in official repos.

```typescript
const [stdout] = await invoke<[string, string, number]>('pacman_search', {
  query: 'firefox'
})
```

### `pacman_info`

Get detailed info about a package.

```typescript
const [stdout] = await invoke<[string, string, number]>('pacman_info', {
  name: 'firefox'
})
```

### `pacman_list_installed`

List all installed packages.

```typescript
const [stdout] = await invoke<[string, string, number]>('pacman_list_installed')
```

### `pacman_install`

Install packages (streaming).

```typescript
await invoke('pacman_install', {
  cmdId: `install-${Date.now()}`,
  packages: ['firefox', 'vim']
})
```

### `pacman_remove`

Remove packages (streaming).

```typescript
await invoke('pacman_remove', {
  cmdId: `remove-${Date.now()}`,
  packages: ['firefox']
})
```

### `pacman_upgrade`

Full system upgrade via pacman (streaming, requires pkexec).

```typescript
await invoke('pacman_upgrade', {
  cmdId: `upgrade-${Date.now()}`
})
```

---

## Yay Operations / Операции yay

### `yay_search`

Search for packages including AUR.

```typescript
const [stdout] = await invoke<[string, string, number]>('yay_search', {
  query: 'spotify'
})
```

### `yay_install`

Install AUR packages (streaming, uses SUDO_ASKPASS).

```typescript
await invoke('yay_install', {
  cmdId: `install-${Date.now()}`,
  packages: ['spotify', 'visual-studio-code-bin']
})
```

### `yay_upgrade_combined`

Combined upgrade of official + AUR packages (streaming, uses SUDO_ASKPASS).

```typescript
await invoke('yay_upgrade_combined', {
  cmdId: `upgrade-${Date.now()}`
})
```

### `yay_clean_orphans`

Remove orphaned packages (streaming, uses SUDO_ASKPASS).

```typescript
await invoke('yay_clean_orphans', {
  cmdId: `orphans-${Date.now()}`
})
```

### `yay_fetch_pkgbuild`

Fetch and display the PKGBUILD for an AUR package.

```typescript
const review = await invoke<PkgbuildReview>('yay_fetch_pkgbuild', {
  package: 'spotify'
})
// review.packageName → string
// review.content → string (PKGBUILD source)
```

---

## Dependency Tree / Дерево зависимостей

### `pactree_forward`

Show what a package depends on.

```typescript
const tree = await invoke<string>('pactree_forward', {
  package: 'firefox'
})
```

### `pactree_reverse`

Show what depends on a package.

```typescript
const tree = await invoke<string>('pactree_reverse', {
  package: 'glibc'
})
```

---

## Breaking Update Protection / Защита от критических обновлений

### `check_informant`

Check for unread Arch Linux news items.

```typescript
const result = await invoke<InformantResult>('check_informant')
// result.informantAvailable → boolean
// result.hasUnread → boolean
// result.entries → string[]
// result.message → string
```

### `informant_read_all`

Mark all news items as read.

```typescript
await invoke('informant_read_all')
```

---

## Maintenance / Обслуживание

### `paccache_clean`

Clean old package cache versions.

```typescript
const [stdout] = await invoke<[string, string, number]>('paccache_clean', {
  keep: 3  // Keep last N versions
})
```

### `paccache_clean_uninstalled`

Remove cache for uninstalled packages.

```typescript
const [stdout] = await invoke<[string, string, number]>('paccache_clean_uninstalled')
```

### `pacman_key_init`

Initialize the pacman keyring.

```typescript
await invoke<[string, string, number]>('pacman_key_init')
```

### `pacman_key_populate`

Populate the pacman keyring with Arch Linux keys.

```typescript
await invoke<[string, string, number]>('pacman_key_populate')
```

### `pacman_key_refresh`

Refresh all pacman keys.

```typescript
await invoke<[string, string, number]>('pacman_key_refresh')
```

### `scan_pacnew`

Scan for .pacnew and .pacsave files.

```typescript
const files = await invoke<string[]>('scan_pacnew')
// files → ['/etc/pacman.conf.pacnew', ...]
```

### `disk_usage`

Get pacman cache disk usage.

```typescript
const usage = await invoke<string>('disk_usage')
// usage → '1.2G'
```

---

## Configuration / Конфигурация

### `get_config`

Read the Alloy configuration.

```typescript
const config = await invoke<Record<string, Record<string, unknown>>>('get_config')
```

### `set_config`

Write a configuration value.

```typescript
await invoke('set_config', {
  section: 'ui',
  key: 'theme',
  value: 'dark'
})
```

---

## AppImage Management / Управление AppImage

### `install_appimage`

Install an AppImage file. Extracts icon via `unsquashash`, registers it as a hicolor theme icon, copies the AppImage to `~/.local/share/appimages/`, and creates a desktop entry.

```typescript
const result = await invoke<InstallResult>('install_appimage', {
  cmdId: `appimage-${Date.now()}`,
  path: '/home/user/app.AppImage'
})
```

### `list_appimages`

List installed AppImages.

```typescript
const images = await invoke<AppImageEntry[]>('list_appimages')
// images[].name, images[].execPath, images[].desktopPath
```

### `remove_appimage`

Remove an installed AppImage.

```typescript
await invoke('remove_appimage', {
  name: 'my-app'
})
```

---

## Applications / Приложения

### `list_apps`

List all installed desktop applications. Each entry is resolved to a real icon (as a base64
`data:` URI) and auto-classified into a category, server-side in Rust.

```typescript
const apps = await invoke<AppEntry[]>('list_apps')

interface AppEntry {
  name: string          // Name= from the .desktop file
  desktopPath: string   // absolute path to the .desktop file
  execPath: string      // Exec= line
  icon: string          // raw Icon= value (theme name or path)
  iconDataUri?: string  // resolved icon as data:<mime>;base64,… (undefined if none found)
  category: string      // "Productivity" | "Gaming" | "Tools" | "Media" | "Other"
}
```

`iconDataUri` is resolved from the icon themes / pixmaps (prefers SVG, then 128→32 px PNG,
skipping files > 256 KB). `category` is derived from the freedesktop `Categories=` field by
priority (Gaming → Media → Productivity → Tools → Other). See `categorize` and
`resolve_icon_data_uri` in `src-tauri/src/services.rs`.

### `launch_app`

Launch a desktop application.

```typescript
await invoke('launch_app', {
  desktopPath: '/usr/share/applications/firefox.desktop'
})
```

---

## Package Tracking / Отслеживание пакетов

### `list_tracked_packages`

List all packages installed through Alloy (from `~/.config/alloy/config.json`).

```typescript
const packages = await invoke<Array<[string, string, string]>>('list_tracked_packages')
// packages → [['tuxguitar', '2.0.1_linux_swt', 'deb'], ['spotify', '1.2.0', 'pkg-tar'], ...]
```

### `remove_tracked_package`

Remove a package and untrack it. Handles both pacman packages and AppImages.

```typescript
await invoke('remove_tracked_package', {
  cmdId: `remove-${Date.now()}`,
  name: 'tuxguitar'
})
```

---

## Debtap / Преобразование Debian пакетов

### `debtap_needs_init`

Check if debtap needs initialization.

```typescript
const needsInit = await invoke<boolean>('debtap_needs_init')
```

### `debtap_init`

Initialize debtap (streaming).

```typescript
await invoke('debtap_init', {
  cmdId: `debtap-${Date.now()}`
})
```

---

## Utilities / Утилиты

### `cleanup_tmp`

Clean up temporary Alloy files.

```typescript
await invoke('cleanup_tmp')
```

### `create_alloy_desktop_entry`

Create a desktop entry for Alloy itself.

```typescript
const path = await invoke<string>('create_alloy_desktop_entry')
```
