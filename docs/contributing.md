# 🤝 Contributing / Участие в разработке

Welcome to Alloy! This guide will help you get started with contributing.

## Development Setup / Настройка разработки

### Prerequisites / Предварительные требования

- Arch Linux
- Node.js ≥18
- Rust (via rustup)
- fish shell
- yay (AUR helper)

### Getting Started / Начало работы

```bash
# Fork and clone / Форк и клонирование
git clone https://github.com/YOUR_USERNAME/alloy.git
cd alloy

# Install dependencies / Установить зависимости
npm install

# Start dev mode / Запустить режим разработки
cargo tauri dev
```

## Code Style / Стиль кода

### Rust / Руст

- Follow standard `rustfmt` formatting
- Use `anyhow` for error handling in services
- Use `shlex` for shell argument escaping
- Functions that produce streaming output use `mpsc::Sender<StreamEvent>`
- Commands are in `commands.rs`, business logic in `services.rs`

### TypeScript / Тайпскрипт

- Functional components with hooks
- Zustand for state management (no Redux)
- Tauri API via `@tauri-apps/api/core` and `@tauri-apps/api/event`
- Tailwind CSS for styling (no CSS modules)
- lucide-react for icons

### Naming Conventions / Соглашения об именовании

| Context | Convention | Example |
|---------|-----------|---------|
| Rust commands | `snake_case` | `yay_upgrade_combined` |
| JS invoke calls | `camelCase` | `invoke('yay_upgrade_combined', { cmdId })` |
| React components | `PascalCase` | `SystemUpdatePage` |
| CSS classes | Tailwind utilities | `bg-dark-900 text-accent-blue` |
| Zustand state | `camelCase` | `store.currentPage` |

## Project Architecture / Архитектура проекта

```
src-tauri/src/
├── lib.rs          → Entry point, command registration
├── commands.rs     → Tauri command handlers (thin wrappers)
├── services.rs     → Business logic, shell scripts
├── fish.rs         → Shell execution engine
└── models.rs       → Data structures

src/
├── App.tsx         → Root component, page routing
├── store.ts        → Zustand global state
├── pages/          → Page components (one per feature)
├── components/     → Shared UI components
└── types/          → TypeScript interfaces
```

## Adding a New Command / Добавление новой команды

### 1. Rust Side / Руст-сторона

Add the command to `commands.rs`:

```rust
#[tauri::command]
pub async fn my_new_command(param: String) -> Result<String, String> {
    // Implementation
    Ok("result".into())
}
```

Register in `lib.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    commands::my_new_command,
])
```

### 2. Frontend Side / Фронтенд-сторона

Call from any component:

```typescript
import { invoke } from '@tauri-apps/api/core'

const result = await invoke<string>('my_new_command', { param: 'value' })
```

### 3. For Streaming Commands / Для потоковых команд

```rust
#[tauri::command]
pub async fn my_streaming_command(app: AppHandle, cmd_id: String) -> Result<(), String> {
    stream_cmd!(app, cmd_id, "echo streaming command")
    // Or for user commands (no pkexec):
    // stream_cmd!(app, cmd_id, "yay command", false)
}
```

## Adding a New Page / Добавление новой страницы

1. Create `src/pages/MyPage.tsx`
2. Add a route in `App.tsx`:

```typescript
{currentPage === 'mypage' && <MyPage />}
```

3. Add a sidebar entry in `Sidebar.tsx`
4. Add the page key to the store in `store.ts`

## Fish Shell Constraints / Ограничения fish shell

All shell scripts in Alloy run through fish. Fish has different syntax from bash:

| Bash | Fish | Notes |
|------|------|-------|
| `$(command)` | `(command)` | Command substitution |
| `if ...; then ... fi` | `if ...; ... end` | No `then`/`fi` keywords |
| `var=$(cmd)` | `set var (cmd)` | Variable assignment |
| `cat << 'EOF'` | Not supported | No heredocs — use `printf` |
| `\|\|` / `&&` after pipes | `; or` / `; and` | Checks pipeline exit code |
| `$0` in awk | Write awk to temp file | Fish mangles `$0` in inline awk |

**Rule of thumb:** If you need complex shell logic, write it to a temp file with `std::fs::write` and reference it with `awk -f` or `fish -f`.

---

## Pull Request Guidelines / Рекомендации по PR

### Before Submitting / Перед отправкой

1. ✅ Run `npm run build` — no TypeScript errors
2. ✅ Run `cargo build --release` — no Rust errors
3. ✅ Test all affected features manually
4. ✅ Follow existing code style

### PR Title Format / Формат заголовка PR

```
feat: Add new feature
fix: Fix bug in upgrade
docs: Update README
refactor: Clean up services.rs
```

### What to Include / Что включить

- Clear description of what changed and why
- Screenshots for UI changes
- Test results for bug fixes
- Breaking changes called out explicitly

## Architecture Decisions / Архитектурные решения

Key decisions documented in `MEMORY.md`:

1. **All commands use fish shell** — prevents injection attacks, consistent behavior
2. **pkexec for root, SUDO_ASKPASS for user** — yay must not run as root
3. **Piped stdout/stderr (not PTY)** — more reliable for streaming
4. **Exit event via blocking_send inside spawn_blocking** — prevents lost events
5. **Tauri 2 capabilities** — explicit permission grants for events

## Getting Help / Получить помощь

- Open an issue on GitHub
- Check [Troubleshooting](troubleshooting.md) first
- Read the [Architecture](architecture.md) docs
