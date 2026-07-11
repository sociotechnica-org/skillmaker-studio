//! Spawns and manages the `skillmaker` sidecar for one workspace at a
//! time, and the (lightweight) shutdown-on-quit discipline that keeps it
//! playing nice with `.skillmaker/claims/server.json`.

use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::AppHandle;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::claim;

fn port_url_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"http://localhost:(\d+)").expect("valid regex"))
}

/// What launching a workspace resulted in: a URL to point the window at,
/// and whether the shell now owns the process behind it (and so should
/// SIGTERM it on quit/switch) or is just observing one someone else
/// started (e.g. a `skillmaker start` left running in a terminal).
pub struct LaunchedWorkspace {
    pub url: String,
    pub owned_child: Option<CommandChild>,
}

#[derive(Debug)]
pub enum LaunchError {
    Spawn(String),
    /// The sidecar exited before ever printing a `http://localhost:<port>`
    /// line -- e.g. the workspace has no `skillmaker.config.json`
    /// (`skillmaker start` prints "no skillmaker workspace found" and
    /// exits 1), or the compiled binary can't find its `viewer-dist`.
    NoUrlBeforeExit { stderr_tail: String },
}

/// Launches (or attaches to) the server for `workspace_root`. Reads the
/// claim file first -- per `docs/plans/.../plan.md` Phase 15's "respect
/// an already-running server for the same workspace" -- and only spawns
/// the sidecar if no live claim is found. `skillmaker start`'s own claim
/// check (`packages/cli/src/commands/Start.ts`) is a second, independent
/// backstop against a duplicate server even if this read races a
/// concurrent start; it isn't relied on for the ownership decision, since
/// that needs to be known *before* spawning.
pub fn launch_workspace(
    app: &AppHandle,
    workspace_root: &Path,
) -> Result<LaunchedWorkspace, LaunchError> {
    if let claim::ClaimStatus::Running(existing) = claim::classify(workspace_root) {
        return Ok(LaunchedWorkspace {
            url: format!("http://localhost:{}", existing.port),
            owned_child: None,
        });
    }

    spawn_sidecar(app, workspace_root)
}

fn spawn_sidecar(
    app: &AppHandle,
    workspace_root: &Path,
) -> Result<LaunchedWorkspace, LaunchError> {
    let shell = app.shell();
    let command = shell
        .sidecar("skillmaker")
        .map_err(|error| LaunchError::Spawn(error.to_string()))?
        // Port 0: let the OS assign a free port rather than the
        // config-default 4323, so the desktop shell's own server never
        // collides with one a user already has running from a terminal
        // for a *different* workspace. `skillmaker start` writes the
        // actually-bound port to the claim file and its startup banner.
        .args(["start", "--port", "0", "--no-open"])
        .current_dir(workspace_root);

    let (mut receiver, child) = command
        .spawn()
        .map_err(|error| LaunchError::Spawn(error.to_string()))?;

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    // `spawn()` delivers events on a channel from a background reader
    // thread; block this (non-main, see caller) thread on it just long
    // enough to learn the port, then hand the receiver off to keep
    // draining in the background so the pipe never backs up.
    let url = loop {
        match receiver.blocking_recv() {
            Some(CommandEvent::Stdout(bytes)) => {
                stdout_buf.push_str(&String::from_utf8_lossy(&bytes));
                stdout_buf.push('\n');
                if let Some(captures) = port_url_pattern().captures(&stdout_buf) {
                    break captures.get(0).unwrap().as_str().to_string();
                }
            }
            Some(CommandEvent::Stderr(bytes)) => {
                stderr_buf.push_str(&String::from_utf8_lossy(&bytes));
                stderr_buf.push('\n');
            }
            Some(CommandEvent::Error(message)) => {
                stderr_buf.push_str(&message);
                stderr_buf.push('\n');
            }
            Some(CommandEvent::Terminated(_)) | None => {
                return Err(LaunchError::NoUrlBeforeExit {
                    stderr_tail: tail(&stderr_buf, 2000),
                });
            }
            _ => {}
        }
    };

    // Keep draining stdout/stderr in the background for the process
    // lifetime so the child never blocks on a full pipe.
    tauri::async_runtime::spawn(async move { while receiver.recv().await.is_some() {} });

    Ok(LaunchedWorkspace {
        url,
        owned_child: Some(child),
    })
}

fn tail(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let start = s.chars().count() - max_chars;
        s.chars().skip(start).collect()
    }
}

/// Stops an owned sidecar cleanly: SIGTERM (matching `Start.ts`'s
/// `waitForShutdown`, which only listens for SIGINT/SIGTERM and runs
/// `removeClaim` before exiting), then polls the claim file briefly for
/// removal, falling back to a hard kill if it doesn't shut down in time.
/// `claim_path` is passed by the caller (computed while it still knows
/// the workspace root) rather than recovered from the child, since
/// `CommandChild` doesn't carry cwd.
#[cfg(unix)]
pub fn stop_owned_sidecar(child: CommandChild, claim_path: &PathBuf) {
    let pid = child.pid();
    let sigterm_result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };

    if sigterm_result == 0 {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while std::time::Instant::now() < deadline {
            if !claim_path.exists() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        // Still alive after the grace period -- force it so quit/switch
        // never hangs indefinitely on a wedged sidecar.
        let _ = child.kill();
    } else {
        // Already gone, or we couldn't signal it for some other reason;
        // nothing left to escalate to.
        let _ = child;
    }
}

#[cfg(not(unix))]
pub fn stop_owned_sidecar(child: CommandChild, _claim_path: &PathBuf) {
    let _ = child.kill();
}
