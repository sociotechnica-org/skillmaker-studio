//! Reads `<workspace>/.skillmaker/claims/server.json`, the same
//! single-instance claim file `packages/cli/src/server/ClaimFile.ts`
//! writes/reads. This is a read-only Rust port of that file's
//! `readClaim` + `isPidAlive` + `classifyClaim` -- deliberately duplicated
//! rather than shared, since `packages/desktop` may only read files
//! produced by the CLI's own discipline, not import its TypeScript.
//!
//! Why the desktop shell reads this itself (rather than always spawning
//! `skillmaker start` and letting *it* decide via its own claim check):
//! the CLI's own dedupe still works either way (a second `start` for an
//! already-served workspace just prints "already running" and exits), but
//! reading the claim first lets the shell know *up front*, before
//! spawning anything, whether it will own the resulting process. That
//! ownership bit matters for shutdown: on quit/switch-workspace the shell
//! must only SIGTERM a sidecar it started itself, never a server some
//! other `skillmaker start` (e.g. a terminal the user has open) is
//! already running for that same workspace.

use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
pub struct ClaimFileData {
    pub pid: u32,
    pub port: u16,
    #[serde(rename = "startedAt")]
    #[allow(dead_code)]
    pub started_at: String,
}

pub enum ClaimStatus {
    /// No claim file, or a claim file that failed to parse.
    Absent,
    /// A claim whose PID is alive -- a server is genuinely already
    /// serving this workspace.
    Running(ClaimFileData),
    /// A claim file left behind by a process that crashed without
    /// cleaning up. Treated the same as `Absent` by callers today (both
    /// mean "safe to spawn a fresh sidecar"); kept as a distinct variant
    /// since it's useful to be able to tell them apart in logs/future
    /// diagnostics.
    Stale,
}

pub fn claim_path_for(workspace_root: &Path) -> PathBuf {
    workspace_root
        .join(".skillmaker")
        .join("claims")
        .join("server.json")
}

fn read_claim(claim_path: &Path) -> Option<ClaimFileData> {
    let contents = std::fs::read(claim_path).ok()?;
    serde_json::from_slice(&contents).ok()
}

/// Zero-signal `kill` probe, mirroring `ClaimFile.ts`'s `isPidAlive`:
/// `ESRCH` means the process is gone, `EPERM` still means it exists (just
/// owned by someone else).
#[cfg(unix)]
fn is_pid_alive(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if result == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn is_pid_alive(_pid: u32) -> bool {
    // Windows/other: liveness probing is deferred along with the rest of
    // non-macOS support (plan.md Phase 15's "macOS first"). Treat as dead
    // so callers fall back to spawning a fresh sidecar rather than
    // silently pointing at a possibly-stale claim.
    false
}

pub fn classify(workspace_root: &Path) -> ClaimStatus {
    let claim_path = claim_path_for(workspace_root);
    match read_claim(&claim_path) {
        None => ClaimStatus::Absent,
        Some(claim) => {
            if is_pid_alive(claim.pid) {
                ClaimStatus::Running(claim)
            } else {
                ClaimStatus::Stale
            }
        }
    }
}
