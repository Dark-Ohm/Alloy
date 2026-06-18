use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Unified error type for Alloy backend operations.
///
/// This replaces ad-hoc `String`/`anyhow::Error` error handling with a structured
/// error type that can be serialized to the frontend for proper error display.
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[allow(dead_code)]
pub enum AlloyError {
    /// Io error (file not found, permission denied, etc.)
    #[error("I/O error: {message}")]
    Io { message: String },

    /// Command execution failed (non-zero exit code)
    #[error("Command failed (exit {code}): {stderr}")]
    CommandFailed {
        code: i32,
        stdout: String,
        stderr: String,
    },

    /// Package format not supported
    #[error("Unsupported package format: {format}")]
    UnsupportedFormat { format: String },

    /// Package analysis failed (could not parse metadata)
    #[error("Failed to analyze package: {message}")]
    AnalysisFailed { message: String },

    /// Dependency not found (e.g., pacman, yay, debtap not installed)
    #[error("Missing dependency: {name}")]
    MissingDependency { name: String },

    /// Permission denied (pkexec/sudo failed)
    #[error("Permission denied: {message}")]
    PermissionDenied { message: String },

    /// Network error (download failed, AUR unreachable)
    #[error("Network error: {message}")]
    Network { message: String },

    /// Configuration error (invalid config, missing file)
    #[error("Configuration error: {message}")]
    Config { message: String },

    /// Invalid input (bad package name, path, etc.)
    #[error("Invalid input: {message}")]
    InvalidInput { message: String },

    /// Internal error (catch-all for unexpected failures)
    #[error("Internal error: {message}")]
    Internal { message: String },
}

impl From<std::io::Error> for AlloyError {
    fn from(e: std::io::Error) -> Self {
        AlloyError::Io {
            message: e.to_string(),
        }
    }
}

impl From<anyhow::Error> for AlloyError {
    fn from(e: anyhow::Error) -> Self {
        AlloyError::Internal {
            message: e.to_string(),
        }
    }
}

/// Result type alias using AlloyError
#[allow(dead_code)]
pub type AlloyResult<T> = Result<T, AlloyError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StreamEvent {
    Stdout {
        line: String,
    },
    /// In-place redraw of the current line (pacman/yay `\r`-updated progress frame).
    /// The frontend replaces its live tail line rather than appending.
    StdoutRedraw {
        line: String,
    },
    Stderr {
        line: String,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        pkg_name: String,
        pkg_num: u32,
        pkg_total: u32,
        pct: u32,
    },
    #[serde(rename_all = "camelCase")]
    TransactionSummary {
        total_packages: u32,
        package_names: Vec<String>,
    },
    Exit {
        code: i32,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DepStatus {
    pub installed: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemDeps {
    pub pacman: DepStatus,
    pub yay: DepStatus,
    pub debtap: DepStatus,
    pub fish: DepStatus,
    pub pkexec: DepStatus,
    pub makepkg: DepStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageAnalysis {
    pub format: String,
    pub file_path: String,
    pub package_name: String,
    pub version: String,
    pub description: String,
    pub dependencies: Vec<String>,
    pub arch: String,
    pub size_bytes: u64,
    pub extracted_path: Option<String>,
    pub desktop_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub success: bool,
    pub package_name: String,
    pub pkg_path: Option<String>,
    pub desktop_file: Option<String>,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PkgbuildReview {
    pub package_name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct DependencyNode {
    pub name: String,
    pub depth: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InformantResult {
    pub informant_available: bool,
    pub has_unread: bool,
    pub entries: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppImageEntry {
    pub name: String,
    pub desktop_path: String,
    pub exec_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub name: String,
    pub desktop_path: String,
    pub exec_path: String,
    pub icon: String,
    /// Resolved icon as a `data:` URI, or `None` if no icon file could be found.
    pub icon_data_uri: Option<String>,
    /// One of: "Productivity" | "Gaming" | "Tools" | "Media" | "Other".
    pub category: String,
}

pub fn config_dir() -> std::path::PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .unwrap_or_else(|_| format!("{}/.config", std::env::var("HOME").unwrap_or_default()));
    std::path::PathBuf::from(base).join("alloy")
}

pub fn config_path() -> std::path::PathBuf {
    config_dir().join("config.json")
}

pub fn load_config() -> HashMap<String, serde_json::Value> {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_config(cfg: &HashMap<String, serde_json::Value>) {
    let _ = std::fs::create_dir_all(config_dir());
    let _ = std::fs::write(
        config_path(),
        serde_json::to_string_pretty(cfg).unwrap_or_default(),
    );
}

pub fn track_install(name: &str, version: &str, kind: &str) {
    let mut cfg = load_config();
    let installs = cfg
        .entry("installed".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if let Some(obj) = installs.as_object_mut() {
        obj.insert(
            name.to_string(),
            serde_json::json!({"version": version, "kind": kind}),
        );
    }
    save_config(&cfg);
}

pub fn track_remove(name: &str) {
    let mut cfg = load_config();
    if let Some(installs) = cfg.get_mut("installed") {
        if let Some(obj) = installs.as_object_mut() {
            obj.remove(name);
        }
    }
    save_config(&cfg);
}

pub fn list_tracked_installs() -> Vec<(String, String, String)> {
    let cfg = load_config();
    let mut result = vec![];
    if let Some(installs) = cfg.get("installed") {
        if let Some(obj) = installs.as_object() {
            for (name, val) in obj {
                let version = val
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let kind = val
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                result.push((name.clone(), version, kind));
            }
        }
    }
    result.sort_by(|a, b| a.0.cmp(&b.0));
    result
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct PackageSecurityInfo {
    pub package: String,
    pub compromised: bool,
    pub known_compromised_count: usize,
}
