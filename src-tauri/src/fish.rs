use std::io::{BufRead, BufReader, Read};
use std::process::Stdio;
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::models::StreamEvent;

const FISH: &str = "/usr/bin/fish";

// ═══════════════════════════════════════════════════════════════════════════
//  pacman/yay output parser
//
//  pacman emits two things the System Update UI needs, beyond raw log lines:
//    1. a transaction summary — "Packages (N) name-ver  name-ver …"
//    2. per-package steps      — "(i/N) <verb> <name> [####] 100%"
//  It also redraws download progress in place with `\r` (no newline). This
//  parser turns that byte stream into structured StreamEvents the frontend
//  already listens for (Progress / TransactionSummary / StdoutRedraw), while
//  still forwarding every committed line as Stdout for the terminal panel.
// ═══════════════════════════════════════════════════════════════════════════

const PKG_VERBS: &[&str] = &[
    "installing", "upgrading", "downloading", "reinstalling", "removing",
    "checking", "loading", "downgrading",
];

/// Strip the version/rel/arch suffix from a pacman package entry, leaving the
/// bare package name. The name is the prefix up to the first `-`-segment that
/// starts with a digit — handles hyphenated names (`linux-headers-6.14.4-1` →
/// `linux-headers`), epochs (`pkg-2:1.0-3` → `pkg`) and digit-led names
/// (`7zip-1.0-1` → `7zip`, `389-ds-base-2.0-1` → `389-ds-base`).
fn strip_version(token: &str) -> String {
    let mut name_parts: Vec<&str> = Vec::new();
    for part in token.split('-') {
        let starts_digit = part.as_bytes().first().is_some_and(u8::is_ascii_digit);
        if starts_digit && !name_parts.is_empty() {
            break;
        }
        name_parts.push(part);
    }
    name_parts.join("-")
}

/// Parse a `(i/N) <verb> <name> … NN%` step line. Returns
/// `(pkg_num, pkg_total, bare_name, pct)`. `pct` falls back to `committed_default`
/// when the line carries no trailing percentage (e.g. a completed install line
/// that pacman printed without a bar). Returns None if the line isn't a step.
fn parse_progress(line: &str, committed_default: u32) -> Option<(u32, u32, String, u32)> {
    let line = line.trim();
    if !line.starts_with('(') {
        return None;
    }
    let close = line.find(')')?;
    let inside = &line[1..close];
    let (num_s, tot_s) = inside.split_once('/')?;
    let num: u32 = num_s.trim().parse().ok()?;
    let tot: u32 = tot_s.trim().parse().ok()?;

    let rest = line[close + 1..].trim();
    let mut tokens = rest.split_whitespace();
    let first = tokens.next()?;
    // Skip a leading verb ("upgrading", "installing", …); otherwise the first
    // token already is the package entry (the "Retrieving packages" format).
    let name_tok = if PKG_VERBS.contains(&first) {
        tokens.next()?
    } else {
        first
    };
    let name = strip_version(name_tok);
    if name.is_empty() {
        return None;
    }

    // Find a trailing "NN%" token anywhere on the line.
    let pct = line
        .split_whitespace()
        .filter_map(|t| t.strip_suffix('%').and_then(|d| d.parse::<u32>().ok()))
        .last()
        .unwrap_or(committed_default)
        .min(100);

    Some((num, tot, name, pct))
}

// TEMP DEBUG — REVERT. Append parser decisions to a file we can read after a run.
fn dbg_log(msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("/tmp/alloy-parser.log") {
        let _ = writeln!(f, "{msg}");
    }
}

/// Stateful, line-at-a-time parser fed from the child's stdout byte stream.
struct PacmanParser {
    total: u32,
    collecting_summary: bool,
    summary_names: Vec<String>,
    summary_emitted: bool,
}

impl PacmanParser {
    fn new() -> Self {
        Self { total: 0, collecting_summary: false, summary_names: Vec::new(), summary_emitted: false }
    }

    /// Handle one output frame. `committed` = terminated by `\n` (a real line);
    /// `false` = terminated by `\r` (an in-place progress redraw).
    fn on_frame(&mut self, raw: &str, tx: &mpsc::Sender<StreamEvent>, committed: bool) {
        dbg_log(&format!("{} {:?}", if committed { "LINE  " } else { "REDRAW" }, raw));
        if !raw.is_empty() {
            let ev = if committed {
                StreamEvent::Stdout { line: raw.to_string() }
            } else {
                StreamEvent::StdoutRedraw { line: raw.to_string() }
            };
            let _ = tx.try_send(ev);
        }

        let trimmed = raw.trim();

        // ── Transaction summary (committed lines only) ──────────────────
        if committed && !self.summary_emitted {
            if let Some(rest) = trimmed.strip_prefix("Packages (") {
                if let Some(close) = rest.find(')') {
                    self.total = rest[..close].trim().parse().unwrap_or(0);
                    self.collecting_summary = true;
                    self.summary_names.clear();
                    self.push_summary_tokens(&rest[close + 1..]);
                    return;
                }
            } else if self.collecting_summary {
                let ends_block = trimmed.is_empty()
                    || trimmed.starts_with("Total")
                    || trimmed.starts_with(':');
                if ends_block {
                    dbg_log(&format!("  >> EMIT summary total={} names={:?}", self.total, self.summary_names));
                    let _ = tx.try_send(StreamEvent::TransactionSummary {
                        total_packages: self.total,
                        package_names: std::mem::take(&mut self.summary_names),
                    });
                    self.collecting_summary = false;
                    self.summary_emitted = true;
                } else {
                    self.push_summary_tokens(trimmed);
                }
            }
        }

        // ── Per-package step / live progress ────────────────────────────
        if let Some((num, tot, name, pct)) = parse_progress(raw, if committed { 100 } else { 0 }) {
            dbg_log(&format!("  >> EMIT progress {num}/{tot} {name} {pct}%"));
            let _ = tx.try_send(StreamEvent::Progress {
                pkg_name: name,
                pkg_num: num,
                pkg_total: tot,
                pct,
            });
        }
    }

    fn push_summary_tokens(&mut self, s: &str) {
        for tok in s.split_whitespace() {
            let name = strip_version(tok);
            if !name.is_empty() {
                self.summary_names.push(name);
            }
        }
    }

    /// Flush any trailing buffered output with no final newline.
    fn finish(&mut self, raw: &str, tx: &mpsc::Sender<StreamEvent>) {
        if !raw.is_empty() {
            self.on_frame(raw, tx, true);
        }
        if self.collecting_summary && !self.summary_emitted {
            let _ = tx.try_send(StreamEvent::TransactionSummary {
                total_packages: self.total,
                package_names: std::mem::take(&mut self.summary_names),
            });
            self.summary_emitted = true;
        }
    }
}

pub async fn exec_one(script: &str) -> anyhow::Result<(String, String, i32)> {
    let out = Command::new(FISH).arg("-c").arg(script).output().await
        .map_err(|e| anyhow::anyhow!("fish failed: {e}"))?;
    Ok((
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
        out.status.code().unwrap_or(-1),
    ))
}

/// Run a command with streaming output.
/// Uses piped stdout/stderr with SUDO_ASKPASS for sudo authentication via GUI dialog.
/// PTY mode is unreliable with sudo; piped mode works reliably.
pub async fn exec_streaming(script: &str, pkexec: bool, tx: mpsc::Sender<StreamEvent>) -> anyhow::Result<()> {
    let script = script.to_string();

    if pkexec {
        exec_streaming_piped(&script, tx, false).await
    } else {
        exec_streaming_piped(&script, tx, true).await
    }
}

/// Create a temporary askpass script that uses zenity/kdialog/rofi to prompt for a password.
fn create_askpass_script() -> Option<std::path::PathBuf> {
    let path = std::path::PathBuf::from("/tmp/alloy-askpass.sh");
    let script = r#"#!/bin/sh
if command -v zenity >/dev/null 2>&1; then
    zenity --password --title="Alloy — System Update" --text="Enter your password for sudo:"
elif command -v kdialog >/dev/null 2>&1; then
    kdialog --password "Enter your password for sudo:"
elif command -v rofi >/dev/null 2>&1; then
    rofi -dmenu -password -p "sudo password:" -theme-str 'entry { placeholder: "Password"; }'
else
    exit 1
fi
"#;
    std::fs::write(&path, script).ok()?;
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
    Some(path)
}

/// Piped stdout/stderr — used for both pkexec (root) and askpass (user + SUDO_ASKPASS) modes.
async fn exec_streaming_piped(script: &str, tx: mpsc::Sender<StreamEvent>, use_askpass: bool) -> anyhow::Result<()> {
    let script = script.to_string();
    let tx_io = tx.clone();
    let tx_exit = tx.clone();
    let askpass = if use_askpass { create_askpass_script() } else { None };
    let askpass_cleanup = askpass.clone();

    let result = tokio::task::spawn_blocking(move || -> anyhow::Result<i32> {
        let mut cmd = if use_askpass {
            let mut c = std::process::Command::new(FISH);
            c.arg("-c").arg(&script);
            if let Some(ref ap) = askpass {
                c.env("SUDO_ASKPASS", ap.to_string_lossy().as_ref());
            }
            c
        } else {
            let mut c = std::process::Command::new("pkexec");
            c.arg(FISH).arg("-c").arg(&script);
            c
        };
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.spawn()
            .map_err(|e| anyhow::anyhow!("spawn failed: {e}"))?;

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let tx1 = tx_io.clone();
        let h1 = std::thread::spawn(move || {
            // Byte-level read so pacman's `\r`-redrawn progress frames are seen
            // as their own frames, not swallowed until the next `\n`.
            let mut reader = BufReader::new(stdout);
            let mut parser = PacmanParser::new();
            let mut buf: Vec<u8> = Vec::new();
            let mut byte = [0u8; 1];
            loop {
                match reader.read(&mut byte) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => match byte[0] {
                        b'\n' => {
                            let line = String::from_utf8_lossy(&buf).into_owned();
                            buf.clear();
                            parser.on_frame(&line, &tx1, true);
                        }
                        b'\r' => {
                            let line = String::from_utf8_lossy(&buf).into_owned();
                            buf.clear();
                            parser.on_frame(&line, &tx1, false);
                        }
                        b => buf.push(b),
                    },
                }
            }
            let line = String::from_utf8_lossy(&buf).into_owned();
            parser.finish(&line, &tx1);
        });

        let tx2 = tx_io;
        let h2 = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                let _ = tx2.try_send(StreamEvent::Stdout { line });
            }
        });

        let _ = h1.join();
        let _ = h2.join();

        let status = child.wait().map_err(|e| anyhow::anyhow!("wait failed: {e}"))?;
        let code = status.code().unwrap_or(-1);

        let _ = tx_exit.blocking_send(StreamEvent::Exit { code });
        Ok(code)
    })
    .await
    .map_err(|e| anyhow::anyhow!("task panicked: {e}"))?;

    if let Err(e) = result {
        let _ = tx.send(StreamEvent::Stdout { line: format!("Error: {e}") }).await;
        let _ = tx.send(StreamEvent::Exit { code: 1 }).await;
    }

    if let Some(path) = askpass_cleanup { let _ = std::fs::remove_file(path); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_version_handles_hyphens_epochs_and_digit_names() {
        assert_eq!(strip_version("glibc-2.41-2"), "glibc");
        assert_eq!(strip_version("linux-headers-6.14.4-1"), "linux-headers");
        assert_eq!(strip_version("gcc-15.1.0-2"), "gcc");
        assert_eq!(strip_version("pkg-2:1.0-3"), "pkg");
        assert_eq!(strip_version("7zip-1.0-1"), "7zip");
        assert_eq!(strip_version("389-ds-base-2.0-1"), "389-ds-base");
        assert_eq!(strip_version("glibc"), "glibc"); // already bare
    }

    #[test]
    fn parse_progress_reads_retrieve_and_install_forms() {
        // "Retrieving packages" form: full name-ver-arch, trailing percent.
        let (n, t, name, pct) = parse_progress("(1/12) glibc-2.41-2-x86_64   100%", 100).unwrap();
        assert_eq!((n, t, name.as_str(), pct), (1, 12, "glibc", 100));

        // Install form: verb + bare name + bar + percent.
        let (n, t, name, pct) =
            parse_progress("(7/12) upgrading mesa            [######] 42%", 100).unwrap();
        assert_eq!((n, t, name.as_str(), pct), (7, 12, "mesa", 42));

        // Committed install line with no percent → falls back to 100.
        let (_, _, name, pct) = parse_progress("(4/12) installing pacman", 100).unwrap();
        assert_eq!((name.as_str(), pct), ("pacman", 100));

        // Non-step lines are ignored.
        assert!(parse_progress(":: Retrieving packages…", 100).is_none());
        assert!(parse_progress("Total Download Size:   247.33 MiB", 100).is_none());
    }

    fn drain(rx: &mut mpsc::Receiver<StreamEvent>) -> Vec<StreamEvent> {
        let mut out = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            out.push(ev);
        }
        out
    }

    #[test]
    fn full_stream_emits_summary_then_progress() {
        // Faithful sample of pacman -Syu stdout (mirrors the reference HTML).
        let sample = "\
:: Starting full system upgrade…
:: Resolving dependencies…

Packages (12)
  glibc-2.41-2  linux-headers-6.14.4-1  systemd-257.4-2  pacman-7.0.0-4
  bash-5.2.037-2  curl-8.13.0-1  mesa-25.0.6-1  nvidia-utils-570.153-1
  python-3.13.2-1  git-2.49.0-1  gcc-15.1.0-2  neovim-0.11.1-2

Total Download Size:   247.33 MiB
:: Retrieving packages…
(1/12) glibc-2.41-2-x86_64    100%
(2/12) linux-headers-6.14.4-1 100%
";
        let (tx, mut rx) = mpsc::channel::<StreamEvent>(512);
        let mut parser = PacmanParser::new();
        for line in sample.split_inclusive('\n') {
            let committed = line.ends_with('\n');
            parser.on_frame(line.trim_end_matches('\n'), &tx, committed);
        }
        let events = drain(&mut rx);

        // Exactly one TransactionSummary, with all 12 names version-stripped.
        let summaries: Vec<_> = events.iter().filter(|e| matches!(e, StreamEvent::TransactionSummary { .. })).collect();
        assert_eq!(summaries.len(), 1, "should emit summary exactly once");
        if let StreamEvent::TransactionSummary { total_packages, package_names } = summaries[0] {
            assert_eq!(*total_packages, 12);
            assert_eq!(package_names.len(), 12);
            assert_eq!(package_names[0], "glibc");
            assert_eq!(package_names[1], "linux-headers");
            assert_eq!(package_names[6], "mesa");
            assert_eq!(package_names[11], "neovim");
        }

        // Two Progress events, in order, with bare names.
        let progress: Vec<_> = events.iter().filter_map(|e| match e {
            StreamEvent::Progress { pkg_name, pkg_num, pkg_total, pct } => Some((pkg_name.as_str(), *pkg_num, *pkg_total, *pct)),
            _ => None,
        }).collect();
        assert_eq!(progress, vec![("glibc", 1, 12, 100), ("linux-headers", 2, 12, 100)]);
    }

    #[test]
    fn progress_event_serializes_camelcase_for_frontend() {
        // The React page reads p.pkgName / p.pkgNum / p.pkgTotal — the Rust
        // variant MUST rename fields to camelCase or the events are dropped.
        let json = serde_json::to_string(&StreamEvent::Progress {
            pkg_name: "mesa".into(),
            pkg_num: 7,
            pkg_total: 12,
            pct: 42,
        })
        .unwrap();
        assert!(json.contains("\"kind\":\"progress\""), "{json}");
        assert!(json.contains("\"pkgName\":\"mesa\""), "{json}");
        assert!(json.contains("\"pkgNum\":7"), "{json}");
        assert!(json.contains("\"pkgTotal\":12"), "{json}");
        assert!(!json.contains("pkg_name"), "snake_case leaked: {json}");
    }

    #[test]
    fn carriage_return_frames_emit_redraw_and_live_pct() {
        let (tx, mut rx) = mpsc::channel::<StreamEvent>(512);
        let mut parser = PacmanParser::new();
        // A download redrawing in place: same package, climbing percent.
        parser.on_frame("(7/12) mesa  [###       ] 30%", &tx, false);
        parser.on_frame("(7/12) mesa  [######    ] 60%", &tx, false);
        let events = drain(&mut rx);

        assert!(events.iter().any(|e| matches!(e, StreamEvent::StdoutRedraw { .. })));
        let last_pct = events.iter().rev().find_map(|e| match e {
            StreamEvent::Progress { pct, pkg_name, .. } if pkg_name == "mesa" => Some(*pct),
            _ => None,
        });
        assert_eq!(last_pct, Some(60));
    }
}
