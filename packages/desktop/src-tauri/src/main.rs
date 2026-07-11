// Prevents an additional console window from appearing on Windows when
// launched as a GUI app (no-op on macOS/Linux). Deferred platform, kept
// for when Windows support lands (plan.md Phase 15: "macOS first").
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod claim;
mod settings;
mod sidecar;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;
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
            let app_handle = app.handle().clone();

            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(move |app_handle, event| {
                if event.id().as_ref() == SWITCH_WORKSPACE_MENU_ID {
                    switch_workspace(app_handle.clone());
                }
            });

            let app_data_dir = app.path().app_data_dir()?;
            match settings::load_remembered_workspace(&app_data_dir) {
                Some(workspace) => launch_and_show(app_handle, workspace),
                None => prompt_for_workspace(app_handle, false),
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building skillmaker-desktop")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Best-effort, synchronous: ExitRequested fires on the
                // main thread right before the app tears down, so a
                // short blocking stop here (SIGTERM + a few hundred ms
                // to a few seconds of polling for claim-file removal,
                // see `sidecar::stop_owned_sidecar`) is the simplest way
                // to guarantee the sidecar is asked to shut down before
                // the app itself exits.
                stop_current_sidecar(app_handle);
            }
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
    let workspace_submenu = Submenu::with_id_and_items(
        app,
        "workspace",
        "Workspace",
        true,
        &[&switch_item],
    )?;
    // Position 1: right after the app's own default first submenu (the
    // "Skillmaker Studio" app menu on macOS), ahead of Edit/Window/Help.
    menu.insert(&workspace_submenu, 1)?;
    Ok(menu)
}

/// Runs the folder-picker (non-blocking dialog API -- safe to call from
/// the main thread, unlike `blocking_pick_folder`) and, on a selection,
/// persists it and launches it. On cancel with no workspace already
/// showing, quits the app -- there's nothing to show.
fn prompt_for_workspace(app: AppHandle, has_existing_window: bool) {
    let app_for_callback = app.clone();
    app.dialog()
        .file()
        .set_title("Choose a Skillmaker workspace folder")
        .pick_folder(move |result| {
            let Some(picked) = result else {
                if !has_existing_window {
                    app_for_callback.exit(0);
                }
                return;
            };
            let Ok(workspace) = picked.into_path() else {
                if !has_existing_window {
                    app_for_callback.exit(0);
                }
                return;
            };
            launch_and_show(app_for_callback.clone(), workspace);
        });
}

/// Spawns (or attaches to) the workspace's server on a background thread
/// -- `sidecar::launch_workspace` blocks waiting for the sidecar's first
/// stdout line, so it must never run on the main thread -- and once a URL
/// is known, hands off to it by navigating the "main" window there (main
/// thread, via `run_on_main_thread`, since webview navigation needs it).
fn launch_and_show(app: AppHandle, workspace: PathBuf) {
    std::thread::spawn(move || {
        let workspace_for_state = workspace.clone();
        let result = sidecar::launch_workspace(&app, &workspace);

        let app_data_dir = app.path().app_data_dir().ok();

        match result {
            Ok(launched) => {
                if let Some(dir) = app_data_dir {
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
                let message = match error {
                    sidecar::LaunchError::Spawn(reason) => {
                        format!("could not spawn the skillmaker sidecar: {reason}")
                    }
                    sidecar::LaunchError::NoUrlBeforeExit { stderr_tail } => {
                        format!("skillmaker sidecar exited before serving; stderr:\n{stderr_tail}")
                    }
                };
                eprintln!("skillmaker-desktop: failed to launch workspace: {message}");
                // Leave the loading screen up rather than a blank/broken
                // window; this phase doesn't have an in-app error surface
                // beyond stderr (see README "Known limitations").
            }
        }
    });
}

/// "Switch Workspace…" menu handler: stops whatever sidecar this process
/// currently owns (a background thread, since stopping can block up to a
/// few seconds -- see `sidecar::stop_owned_sidecar`), then re-opens the
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

    prompt_for_workspace(app, true);
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
