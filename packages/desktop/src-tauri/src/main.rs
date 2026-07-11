// Prevents an additional console window from appearing on Windows when
// launched as a GUI app (no-op on macOS/Linux). Deferred platform, kept
// for when Windows support lands (plan.md Phase 15: "macOS first").
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod claim;
mod settings;
mod sidecar;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_shell::process::CommandChild;

const SWITCH_WORKSPACE_MENU_ID: &str = "switch_workspace";

/// The desktop shell manages at most one workspace/sidecar pair at a
/// time; this is that pair, guarded by a mutex since the picker callback,
/// the menu handler, and the app's own exit hook can all touch it.
#[derive(Default)]
struct WorkspaceState {
    workspace_root: Option<PathBuf>,
    /// `Some` only when this process spawned the sidecar itself (as
    /// opposed to attaching to one already running for the same
    /// workspace) -- see `sidecar::launch_workspace`. Only an owned child
    /// gets SIGTERM'd on quit/switch.
    owned_child: Option<CommandChild>,
}

type SharedState = Mutex<WorkspaceState>;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SharedState::default())
        .setup(|app| {
            // Menu only -- the workspace flow (picker/sidecar) must NOT
            // start here. `setup` runs before the event loop is live; a
            // native folder-picker opened at that point renders but never
            // receives events on macOS (NSOpenPanel needs the NSApp run
            // loop to be pumping), which is exactly the "dialog would not
            // accept clicks" bug observed live. The flow starts on
            // RunEvent::Ready below instead.
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(move |app_handle, event| {
                if event.id().as_ref() == SWITCH_WORKSPACE_MENU_ID {
                    switch_workspace(app_handle.clone());
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building skillmaker-desktop")
        .run(|app_handle, event| match event {
            RunEvent::Ready => {
                // The event loop is pumping; dialogs are interactive now.
                let app = app_handle.clone();
                match app
                    .path()
                    .app_data_dir()
                    .ok()
                    .and_then(|dir| settings::load_remembered_workspace(&dir))
                {
                    Some(workspace) => launch_and_show(app, workspace),
                    None => prompt_for_workspace(app),
                }
            }
            RunEvent::ExitRequested { .. } => {
                // Best-effort, synchronous: ExitRequested fires on the
                // main thread right before the app tears down, so a short
                // blocking stop here (SIGTERM + up to ~3s polling for
                // claim-file removal, see `sidecar::stop_owned_sidecar`)
                // is the simplest way to guarantee the sidecar is asked
                // to shut down before the app itself exits.
                stop_current_sidecar(app_handle);
            }
            _ => {}
        });
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // Start from the platform default (App/Edit/Window/Help on macOS --
    // keeps Cmd+Q, Cmd+C/V/A, etc. working in the loaded viewer) and add
    // one "Workspace" submenu with the single affordance this phase
    // needs.
    let menu = Menu::default(app)?;
    let switch_item = MenuItem::with_id(
        app,
        SWITCH_WORKSPACE_MENU_ID,
        "Switch Workspace…",
        true,
        Some("Cmd+Shift+O"),
    )?;
    let workspace_submenu =
        Submenu::with_id_and_items(app, "workspace", "Workspace", true, &[&switch_item])?;
    // Position 1: right after the app's own default first submenu (the
    // "Skillmaker Studio" app menu on macOS), ahead of Edit/Window/Help.
    menu.insert(&workspace_submenu, 1)?;
    Ok(menu)
}

/// Swaps the loading page to its error state via the `window.__sm*` hooks
/// in `ui/index.html` -- one-way Rust->page `eval`, no IPC capability
/// needed. A no-op once the window has navigated to the sidecar's origin
/// (the hooks don't exist there and the `&&` guard makes the eval do
/// nothing), which is the right behavior: every caller fires
/// before/instead of a successful navigation.
fn show_page_error(app: &AppHandle, headline: &str, detail: Option<&str>) {
    if let Some(window) = app.get_webview_window("main") {
        // serde_json::to_string produces a valid, fully-escaped JS string
        // literal (sidecar stderr can contain quotes/newlines/backticks).
        let headline_js = serde_json::to_string(headline).unwrap_or_else(|_| "\"\"".into());
        let detail_js =
            serde_json::to_string(detail.unwrap_or("")).unwrap_or_else(|_| "\"\"".into());
        let _ = window.eval(format!(
            "window.__smShowError && window.__smShowError({headline_js}, {detail_js});"
        ));
    }
}

/// Back to the spinner (a new launch attempt is in flight).
fn show_page_loading(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.__smShowLoading && window.__smShowLoading();");
    }
}

/// Runs the folder-picker (the non-blocking dialog API -- safe to call
/// from the main thread, unlike `blocking_pick_folder`), parented to the
/// main window so it attaches as a window-modal sheet driven by the app's
/// own (running) event loop. On a selection, launches it (which persists
/// it on success); on cancel, leaves whatever is currently showing -- a
/// previous workspace, the error state, or the loading page flipped to a
/// "no workspace selected" note -- never a dead end (the Workspace menu
/// can always re-open the picker) and never `exit(0)` (a stray Escape
/// shouldn't quit the app).
fn prompt_for_workspace(app: AppHandle) {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose a Skillmaker workspace folder");
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }

    let app_for_callback = app.clone();
    dialog.pick_folder(move |result| {
        let app = app_for_callback;
        let Some(picked) = result else {
            let has_workspace = {
                let state = app.state::<SharedState>();
                let guard = state.lock().expect("state mutex poisoned");
                guard.workspace_root.is_some()
            };
            if !has_workspace {
                show_page_error(&app, "No workspace folder selected.", None);
            }
            return;
        };
        match picked.into_path() {
            Ok(workspace) => {
                show_page_loading(&app);
                launch_and_show(app, workspace);
            }
            Err(error) => {
                show_page_error(
                    &app,
                    "Could not use the selected folder.",
                    Some(&error.to_string()),
                );
            }
        }
    });
}

/// Spawns (or attaches to) the workspace's server on a background thread
/// -- `sidecar::launch_workspace` blocks (bounded by its startup timeout)
/// waiting for the sidecar's URL line, so it must never run on the main
/// thread -- and once a URL is known, hands off to it by navigating the
/// "main" window there (main thread, via `run_on_main_thread`, since
/// webview navigation needs it). On failure: error state on the loading
/// page (with the sidecar's stderr excerpt) plus a native dialog offering
/// to re-pick the folder.
fn launch_and_show(app: AppHandle, workspace: PathBuf) {
    std::thread::spawn(move || {
        let workspace_for_state = workspace.clone();
        let result = sidecar::launch_workspace(&app, &workspace);

        match result {
            Ok(launched) => {
                // Persist only on success -- a folder that failed to
                // launch must not become the remembered workspace, or the
                // next app launch would boot straight into the failure.
                if let Ok(dir) = app.path().app_data_dir() {
                    let _ = settings::remember_workspace(&dir, &workspace_for_state);
                }

                {
                    let state = app.state::<SharedState>();
                    let mut guard = state.lock().expect("state mutex poisoned");
                    guard.workspace_root = Some(workspace_for_state);
                    guard.owned_child = launched.owned_child;
                }

                let url = launched.url;
                let app_for_main = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Some(window) = app_for_main.get_webview_window("main") {
                        if let Ok(parsed) = url.parse() {
                            let _ = window.navigate(parsed);
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            }
            Err(error) => {
                let (headline, detail) = match error {
                    sidecar::LaunchError::Spawn(reason) => {
                        ("Could not start the Skillmaker server.".to_string(), reason)
                    }
                    sidecar::LaunchError::NoUrlBeforeExit { stderr_tail } => (
                        format!(
                            "\"{}\" doesn't look like a Skillmaker workspace.",
                            workspace_for_state.display()
                        ),
                        stderr_tail,
                    ),
                    sidecar::LaunchError::Timeout { stderr_tail } => (
                        "The Skillmaker server didn't start in time and was stopped.".to_string(),
                        stderr_tail,
                    ),
                };
                eprintln!("skillmaker-desktop: {headline}\n{detail}");
                let detail_trimmed = detail.trim();
                show_page_error(
                    &app,
                    &headline,
                    (!detail_trimmed.is_empty()).then_some(detail_trimmed),
                );

                // Native retry affordance (the page itself has no IPC
                // surface to offer a button): Ok re-opens the picker,
                // Cancel leaves the error state showing -- the Workspace
                // menu remains available either way.
                let app_for_retry = app.clone();
                app.dialog()
                    .message(format!(
                        "{headline}\n\nChoose another folder? (A workspace is a folder where \
                         \"skillmaker init\" has been run.)"
                    ))
                    .title("Skillmaker Studio")
                    .kind(MessageDialogKind::Error)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Choose Another Folder…".to_string(),
                        "Not Now".to_string(),
                    ))
                    .show(move |confirmed| {
                        if confirmed {
                            let app = app_for_retry.clone();
                            let _ =
                                app_for_retry.run_on_main_thread(move || prompt_for_workspace(app));
                        }
                    });
            }
        }
    });
}

/// "Switch Workspace…" menu handler: stops whatever sidecar this process
/// currently owns (on a background thread, since stopping can block up to
/// a few seconds -- see `sidecar::stop_owned_sidecar`), then re-opens the
/// picker. The window keeps showing the outgoing workspace's content
/// until the new one is ready and navigated to.
fn switch_workspace(app: AppHandle) {
    let previous = {
        let state = app.state::<SharedState>();
        let mut guard = state.lock().expect("state mutex poisoned");
        let workspace_root = guard.workspace_root.take();
        let owned_child = guard.owned_child.take();
        (workspace_root, owned_child)
    };

    if let (Some(workspace_root), Some(child)) = previous {
        std::thread::spawn(move || {
            let claim_path = claim::claim_path_for(&workspace_root);
            sidecar::stop_owned_sidecar(child, &claim_path);
        });
    }

    prompt_for_workspace(app);
}

/// Used only from the app-exit hook: stops the current sidecar (if this
/// process owns one) synchronously on the calling (main) thread. Quit is
/// the one place a short block-the-main-thread stop is acceptable, since
/// the app is tearing down anyway.
fn stop_current_sidecar(app: &AppHandle) {
    let (workspace_root, owned_child) = {
        let state = app.state::<SharedState>();
        let mut guard = state.lock().expect("state mutex poisoned");
        (guard.workspace_root.take(), guard.owned_child.take())
    };

    if let (Some(workspace_root), Some(child)) = (workspace_root, owned_child) {
        let claim_path = claim::claim_path_for(&workspace_root);
        sidecar::stop_owned_sidecar(child, &claim_path);
    }
}
