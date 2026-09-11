# Chronos-AUR — Alloy Tauri→GPUI Port, Phase 1 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or executing-plans, task-by-task. Steps use `- [ ]`. This is a **port**: the
> existing code IS the spec — do not redesign behavior, translate it.

**Goal:** Turn Alloy (Tauri 2 + React AUR/package manager) into **Chronos-AUR**, a
standalone native GPUI application in the chronos-ecosystem, reusing the Rust
backend and porting the React frontend to `gpui-rsx`. It runs *alongside* the
ChronOS shell (Path 2 — its own binary/process, cooperates via optional IPC), not
inside it.

**Architecture:** Cargo workspace, two crates. `aur-core` = the pure package
engine (ported from `src-tauri/src/services/*` + `models.rs`, all `#[tauri::command]`
stripped, calls a `ShellExec` abstraction). `aur-app` = the GPUI binary (window,
sidebar nav, pages ported from React → `rsx!` + GPUI entities, calls `aur-core`).
Tauri/React/Vite/node are deleted. Uses our gpui fork via git dep, like the rest of
the ecosystem.

**Tech Stack:** Rust, GPUI (`Dark-Ohm/Chronos-GPUI @99cab5e` git dep), `gpui-rsx`,
`gpui-animation`, `portable-pty 0.9`, `tokio`, `serde`/`serde_json`, `anyhow`,
`shlex`, `thiserror`.

## Global Constraints

- **Port, do not rewrite.** `malware_check.rs`, `pkg_analyze.rs`, `pkg_build.rs`
  are safety-critical — port **byte-faithful** (only mechanical Tauri-stripping /
  `ShellExec` swap), no logic changes, keep their tests.
- Every `#[tauri::command]` fn → plain `pub async fn` in `aur-core`; the Tauri
  `commands.rs` binding layer is deleted (55 commands become the core's public API).
- `[lints] workspace = true` on every crate: `unsafe_code = deny`,
  `unwrap_used`/`expect_used = warn`. Never `let _ = fallible()` — `?` / `.log_err()`
  / explicit `match`.
- Bleeding-edge deps: newest versions, do not inherit Alloy's old pins blindly;
  bump on port, note any API drift.
- **UI = `rsx!` for markup** (JSX→rsx structural translation from the React
  source), **logic/state in GPUI** (entities, `Context`, `cx.listener`, signals) —
  React hooks/`useStore`/`safeInvoke` do NOT translate, they are reimplemented in
  Rust. Colours: **Catppuccin Mocha** to match ChronOS (`#181825` bg, `#89dceb`/
  `#89b4fa`/`#f9e2af` accents, `#a6e3a1` green, `#f38ba8` red, `#cdd6f4` text).
- Frontend→backend contract today is `safeInvoke<T>(cmd,args) -> AlloyResult<T>`
  (`src/lib/safeInvoke.ts`) over 55 commands; in GPUI these become direct
  `aur_core::…().await` calls, errors via `anyhow`/`AlloyError`.
- Commit inside the Chronos-AUR git repo (MIT, own repo). Small named commits.
- Shell↔Chronos-AUR IPC and the shell-side permission card are **NOT in this plan**
  (separate shell-side track once the app emits events). Auth stays as today
  (`pkexec` → whatever polkit agent the session runs) until then.

---

## Repo target structure

**Delete (Tauri/web):** `src/` (React), `index.html`, `vite.config.ts`,
`tailwind.config.js`, `postcss.config.js`, `eslint.config.js`, `tsconfig.json`,
`package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
`src-tauri/src/main.rs`, `src-tauri/src/commands.rs`, `src-tauri/build.rs`.
(Do the deletion **last**, once the port is green — the React source is the visual
spec for the rsx port; keep it until pages are ported.)

**New layout:**
```
Chronos-AUR/
  Cargo.toml                 # [workspace] members = ["crates/aur-core","crates/aur-app"]
  crates/aur-core/           # engine lib (ported backend)
    src/{lib,models,shell}.rs
    src/services/{aur_ops,pacman_ops,pkg_build,pkg_analyze,pkg_tar,appimage,deb,rpm,tar,system_info,malware_check}.rs
    src/{updater,fish→(removed, folded into shell)}.rs
  crates/aur-app/            # GPUI binary
    src/{main,app,theme,router}.rs
    src/pages/{packages,system_update,…}.rs
    src/components/{sidebar,…}.rs
```

Ported backend sources live under `src-tauri/src/` **today** — move (not copy) into
`crates/aur-core/src/` during Track A.

---

## Load-bearing interfaces (CONTRACTS — do not change alone; all 4 tracks code against these)

### 1. `StreamEvent` (from `models.rs:79`) — command-output event
Ported verbatim from `models.rs`. Engine ops that stream (`exec_streaming`) emit
these; the app renders them. Keep the existing variants (`Stdout`,
`StdoutRedraw`, `TransactionSummary`, `Progress`, …).

### 2. `ShellExec` (Track B produces, Track A consumes)
```rust
// aur-core/src/shell.rs
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Shell { #[default] Fish, Zsh, Bash }

/// One-shot: run `script` in `shell`, capture (stdout, stderr, exit).
pub async fn exec_one(shell: Shell, script: &str) -> anyhow::Result<(String, String, i32)>;

/// Streaming: run `script`, parse output into StreamEvents on `tx`, return exit.
pub async fn exec_streaming(
    shell: Shell,
    script: &str,
    tx: tokio::sync::mpsc::Sender<crate::models::StreamEvent>,
) -> anyhow::Result<i32>;

/// Detect the user's login shell (`$SHELL` basename → Shell, fallback Fish).
pub fn detect_shell() -> Shell;
```
Same signatures as Alloy's `fish::exec_one` / `exec_streaming` **plus** a `Shell`
param. The parser (`fish.rs` frame/StreamEvent logic) is shell-agnostic — keep it;
only the spawn (`portable-pty` command + shell binary + per-shell script wrapping)
branches on `Shell`.

### 3. `aur-core` public API (Track A produces, Track C/D consume)
The 55 Tauri commands, de-`#[command]`'d, grouped by module. Signatures unchanged
except: return `anyhow::Result<T>`/`AlloyResult<T>` (not Tauri’s `Result<T,String>`
where trivial), take `Shell` where they exec. Examples (already present):
`pacman_search(q) -> (String,String,i32)`, `yay_search(q)`, `fetch_pkgbuild(pkg)
-> Result<PkgbuildReview>`, `build_arch_pkg(…)`, `analyze_package(path) ->
Result<PackageAnalysis>`, `install_script(&[String]) -> String`, etc.

### 4. Page slot (Track C produces, Track D consumes)
```rust
// aur-app/src/router.rs
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Page { Packages, SystemUpdate, Applications, Maintenance, News, Config, Settings }
// The app shell renders a sidebar of Page buttons + a content area that calls
// `render_page(page, cx)`; each page is a GPUI view/entity with its own state.
```

---

## Phase 1 — the 4 expert tracks

### TRACK A — `aur-core` engine (expert: Arch/pacman/yay/makepkg)

**Files:** create `crates/aur-core/` (Cargo.toml + `[lints] workspace`), **move**
`src-tauri/src/{models.rs,updater.rs}` and `src-tauri/src/services/*` into
`crates/aur-core/src/`; delete `#[tauri::command]`/`tauri::` uses; route every
exec through `crate::shell::exec_one/exec_streaming` (Track B) instead of `fish::`.

- [ ] Scaffold workspace `Cargo.toml` + `crates/aur-core/Cargo.toml` (deps:
  serde/serde_json/anyhow/shlex/thiserror/tokio/portable-pty), `[lints] workspace`.
- [ ] Move `models.rs` → `aur-core/src/models.rs`; it defines `StreamEvent`,
  `AlloyError`, `PackageAnalysis`, `InstallResult`, `PkgbuildReview`, … — keep as is.
- [ ] Move each `services/*.rs`; per file: drop `use tauri…`, drop `#[tauri::command]`,
  change `fish::exec_*` → `crate::shell::exec_*(shell, …)` (thread a `Shell` param
  down from callers — default `Shell::detect_shell()` at the app boundary).
- [ ] `malware_check.rs`/`pkg_analyze.rs`/`pkg_build.rs`: **only** the mechanical
  swap above; diff must show no logic change. Keep every existing `#[cfg(test)]`.
- [ ] `cargo test -p aur-core` — all ported unit tests green (record count).
- [ ] `cargo build -p aur-core` — clean. Commit `core : port Alloy backend engine
  (Tauri stripped, ShellExec)`.

**Verify:** `cargo test -p aur-core` green; `grep -rn "tauri" crates/aur-core/src`
empty; the 55-command surface callable as plain async fns.

### TRACK B — `ShellExec` multi-shell fish/zsh/bash (expert: shells/PTY)

**Files:** create `crates/aur-core/src/shell.rs` (port `src-tauri/src/fish.rs`).
Coordinates with Track A on the trait above — **define `shell.rs`’s public
signatures first** so A compiles against them.

- [ ] Port `fish.rs`’s StreamEvent parser (frame/`on_frame`/`finish`/progress
  parsing) verbatim into `shell.rs` — it is shell-agnostic, keep it.
- [ ] Add `enum Shell {Fish,Zsh,Bash}` + `detect_shell()` (`$SHELL` basename).
- [ ] Generalise spawn: `exec_one`/`exec_streaming` take `Shell`, pick the binary
  (`fish`/`zsh`/`bash`) and wrap `script` per shell. Handle syntax deltas: posix
  (`zsh`/`bash`) run `script` as-is via `-c`; `fish` via `fish -c` (existing path).
  Most scripts are posix pacman/yay/makepkg one-liners — the risk is fish-specific
  syntax in Alloy scripts; **audit `services/*` scripts for fish-isms** (`set x`,
  `; and`, `$status`) and either keep them posix or branch per shell.
- [ ] Tests: `detect_shell` from a mocked `$SHELL`; `exec_one(Bash,"echo hi")` →
  `("hi\n","",0)`; `exec_one(Zsh,…)`; parser test on a captured `pacman -Sy`
  transcript → expected `StreamEvent`s (fixture from **live** `pacman -Sy` output,
  mark speculative if not captured live).
- [ ] `cargo test -p aur-core --lib shell` green; commit `core : shell-exec
  fish/zsh/bash over portable-pty`.

**Verify:** all three shells run a trivial script live (`echo`, `pacman -Q | head`);
parser emits identical events for fish vs bash on the same pacman transcript.

### TRACK C — `aur-app` GPUI shell (expert: GPUI/windowing)

**Files:** create `crates/aur-app/` bin: `main.rs` (gpui `Application::new().run`,
open a normal `WindowKind::Normal` window ~1100×720), `theme.rs` (Catppuccin
tokens), `app.rs` (root view: sidebar + content), `router.rs` (`Page` enum +
`render_page` dispatch), `components/sidebar.rs` (port `src/components/Sidebar.tsx`
structure → `rsx!`). Root `Cargo.toml` gets gpui fork + gpui-rsx + gpui-animation
git deps (`Dark-Ohm/Chronos-GPUI @99cab5e`).

- [ ] `aur-app/Cargo.toml`: gpui/gpui_platform/gpui-rsx/gpui-animation git deps +
  `aur-core` path dep + `[lints] workspace`.
- [ ] `main.rs`: minimal gpui app that opens a window rendering `App` root; smoke:
  `cargo run -p aur-app` shows an empty Catppuccin window.
- [ ] `theme.rs`: Catppuccin token struct (mirror ChronOS palette above).
- [ ] `sidebar.rs`: port `Sidebar.tsx` (7 nav items → `Page`) to `rsx!`, active
  state via a `selected: Page` field, `cx.listener` sets it. Report where rsx fit
  1:1 vs where div was needed (rsx-verdict data).
- [ ] `router.rs` + `app.rs`: sidebar on left, content area calls `render_page`;
  every `Page` renders a stub (`"<name> — WIP"`) except the one Track D fills.
- [ ] Build + `grim`/run smoke: window with working sidebar nav switching stub
  pages. Commit `app : GPUI shell — window + Catppuccin theme + sidebar router`.

**Verify:** `cargo run -p aur-app` opens a window; clicking sidebar items switches
the content stub; no crash; matches Catppuccin.

### TRACK D — first pages port React→rsx (expert: GPUI/rsx UI)

**Files:** create `crates/aur-app/src/pages/{packages,system_update}.rs`, porting
`src/pages/PackagesPage.tsx` (263 lines) and `src/pages/SystemUpdatePage.tsx`
(471). Depends on Track C’s `Page`/`render_page` slot and Track A’s core API.

- [ ] Port `PackagesPage`: read the TSX for structure → `rsx!` markup; state (search
  query, results list, selection) → a GPUI view entity; `safeInvoke("pacman_search",
  …)` → `aur_core::pacman_search(shell,q).await` in a `cx.spawn`; retheme Catppuccin.
- [ ] Port `SystemUpdatePage`: same method; the streaming upgrade
  (`exec_streaming` → `StreamEvent`s) drives a live log/progress view (subscribe to
  the `mpsc` on a GPUI channel, `cx.notify` per event).
- [ ] Wire both into `router::render_page`.
- [ ] Build + live smoke: search a package (real `pacman_search`), see results;
  open SystemUpdate, run a check (`checkupdates`) live. Commit `app : port Packages
  + SystemUpdate pages (React→rsx, live core)`.

**Verify:** live `pacman_search` returns real results in the UI; SystemUpdate shows
real update data; rsx-vs-div verdict noted.

---

## Phase 2-3 (not this plan — waves after Phase 1 lands)
- Remaining pages: `Applications`(476), `Maintenance`(839), `Settings`(325),
  `Config`(299), `News`(252), `AurStore`/`DropZone` components — one agent per
  cluster, same React→rsx method.
- Delete the React/Tauri tree once all pages ported.
- **Shell-side (separate, ChronOS repo):** IPC (update-count badge, "open pkg"),
  the sidebar permission card + ChronOS-as-polkit-agent (auth surfaces for
  Chronos-AUR/yay/Claude Code system-wide).

---

## Self-review
- **Coverage:** engine (A) + exec (B) + app shell (C) + 2 pages (D) = a runnable
  Chronos-AUR that searches/installs/updates. Remaining 5 pages + IPC = Phase 2-3,
  explicitly deferred. ✅
- **Interfaces:** `ShellExec` (B→A), core API (A→C/D), `Page`/`render_page` (C→D),
  `StreamEvent` (shared) — all defined above with signatures. ✅
- **Port faithfulness:** malware/analyze/build byte-faithful constraint stated;
  source repo is the behavioural spec. ✅
- **Risk:** fish-isms in Alloy scripts (Track B audits); rsx dynamic-UI limits
  (Track C/D fall back to div, report — known from ChronOS panel v2). ✅
