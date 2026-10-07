//! Setup Center — library entry point.
//!
//! Layering, from the outside in:
//!
//! ```text
//! main.rs      process bootstrap, single-instance guard
//! commands.rs  the entire capability surface exposed to the UI
//! state.rs     shared module stores + caches
//! modules/     detect · inventory · catalog · install · executor · verify · config
//! model.rs     the data contract every layer agrees on
//! ```
//!
//! Nothing in `modules/` knows that Tauri exists, which is why the modules are
//! unit-testable with `cargo test` and no window.

pub mod commands;
pub mod model;
pub mod modules;
pub mod state;

use state::AppState;
use std::sync::Mutex;
use tauri::Manager;

/// Guard so only one instance runs. Uses Windows Named Mutex Local\SetupCenter.<SID>.app.aistudent.setup
/// to prevent two instances racing over winget / MSI / local configuration.
pub struct SingleInstanceGuard(pub Mutex<Option<modules::task::NamedSingleInstanceGuard>>);

impl Default for SingleInstanceGuard {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let guard = match modules::task::NamedSingleInstanceGuard::acquire() {
                Ok(g) => g,
                Err(err) => {
                    eprintln!("Single instance check: {err}");
                    std::process::exit(0);
                }
            };
            app.manage(SingleInstanceGuard(Mutex::new(Some(guard))));

            // Resource dir is where `profiles/`, `localization/` and
            // `knowledge/` were bundled. It is absent during `cargo test`, in
            // which case state falls back to the compiled-in copies.
            //
            // Gated on `profiles/` alone rather than requiring all three: a
            // build that bundles profiles but forgets knowledge should still
            // find its profiles, and the knowledge layer is built to degrade on
            // its own.
            let resource_dir = app
                .path()
                .resource_dir()
                .ok()
                .filter(|dir| dir.join("profiles").is_dir());

            app.manage(AppState::new(resource_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::detect_environment,
            commands::windows_info,
            commands::scan_software,
            commands::last_software_scan,
            commands::list_profiles,
            commands::get_profile,
            commands::build_install_plan,
            commands::build_install_plan_for,
            commands::install_strategies,
            commands::install_strategies_for,
            commands::preview_install,
            commands::execution_readiness,
            commands::run_install,
            commands::resume_install,
            commands::cancel_install,
            commands::resumable_install,
            commands::last_install_session,
            commands::verify_installation,
            // Post-install verification + install.log (0.1.1)
            commands::verify_install_result,
            commands::install_log_path,
            commands::read_install_log,
            commands::install_log_exists,
            commands::planned_config_actions,
            commands::generate_report,
            commands::save_report,
            commands::runtime_status,
            // Stage 4: bootstrap
            commands::build_bootstrap_plan,
            commands::run_bootstrap,
            commands::cancel_bootstrap,
            commands::resumable_bootstrap,
            commands::last_bootstrap,
            commands::verify_bootstrap,
            commands::localization_targets,
            // Stage 5: capability layer + dashboard data
            commands::capability_report,
            commands::profile_capabilities,
            commands::software_catalogue,
            commands::machine_facts,
            // Stage 5: knowledge, goals, advisor
            commands::explain_software,
            commands::explained_catalogue,
            commands::list_goals,
            commands::environment_plan,
            commands::environment_plans,
            commands::advisor_summary,
            commands::advisor_report_text,
            commands::concept_notes,
            commands::knowledge_status,
            // Stage 5: licensing (Free = detect, Pro = install + configure)
            commands::license_status,
            commands::license_device,
            commands::activate_license,
            commands::deactivate_license,
            // Claude enhancement plugins (catalogue + install pipeline)
            commands::plugin_views,
            commands::plugin_targets,
            commands::run_plugin,
            // Native system ops & discovery
            commands::build_dynamic_install_plan,
            commands::cancel_task,
            commands::query_task,
            commands::get_task_events,
            commands::native_download,
            commands::winget_search,
            commands::winget_show,
            commands::reveal_in_explorer,
            commands::open_url,
            commands::detect_editors,
            commands::open_in_editor,
            commands::get_downloads_dir,
            commands::verify_file_sha256,
            commands::load_user_uiparts,
            commands::save_user_uiparts,
            commands::get_uiparts_info,
            commands::save_uipart_asset,
            commands::stage_uipart_asset,
            commands::commit_uipart_assets,
            commands::discard_uipart_assets,
            commands::read_uipart_asset,
            commands::delete_uipart_assets,
            // Storage policy (0.2.4)
            commands::get_storage_policy,
            commands::set_storage_policy,
            commands::select_storage_folder,
            commands::validate_storage_path,
            commands::clean_download_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Setup Center");
}
