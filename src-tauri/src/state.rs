//! Shared application state.
//!
//! Holds the module stores (profiles, localisation) and the last detection
//! results. Deliberately small: the heavy lifting lives in the modules, and
//! anything cached here is only cached to avoid redundant *probing*, never to
//! avoid recomputation.

use crate::model::{EnvironmentReport, ExecutionSession, SoftwareId, SoftwareInventory, SoftwareScan};
use crate::modules::bootstrap::run::BootstrapSession;
use crate::modules::executor::CancelFlag;
use crate::modules::task::TaskManager;
use crate::modules::{config, knowledge, plugins, profiles};

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub profiles: profiles::ProfileStore,
    pub localization: config::LocalizationStore,
    /// Explanatory content: what each program is, what each term means.
    ///
    /// Loaded exactly like the profiles and for the same reason — a school can
    /// correct an explanation without a rebuild. Held in state rather than
    /// re-read per command because the knowledge base is consulted on every
    /// dashboard row.
    pub knowledge: knowledge::Knowledge,
    /// Claude 增强插件目录（`plugins/*.json`）。
    ///
    /// 与 profiles/knowledge 同样的加载方式与同样的理由：**加一个插件是加一个
    /// 数据文件**，不是改代码。而且每行 Claude 详情都要问"这个 target 有哪些增强"，
    /// 每次重读五个 JSON 属于浪费。
    pub plugins: plugins::PluginCatalog,
    /// 统一任务管理器与互斥协调器 (T07)
    pub tasks: Arc<TaskManager>,
    cache: Mutex<Cache>,
    plans: Mutex<std::collections::HashMap<String, PlanRecord>>,
    winget_cache: Mutex<std::collections::HashMap<String, crate::modules::system_ops::WingetPackageDetails>>,
}

#[derive(Default)]
struct Cache {
    environment: Option<EnvironmentReport>,
    scan: Option<SoftwareInventory>,
    /// The running or last-finished installation session.
    ///
    /// Held so the UI can resume an interrupted run *after the app was closed*
    /// and reopened — the whole point of "可恢复". A session that only existed
    /// in the frontend would be lost on a crash, which is exactly when a
    /// resumable installer matters most.
    session: Option<ExecutionSession>,
    /// The last bootstrap run, finished or not.
    ///
    /// Separate from `session` because the two answer different questions —
    /// "what software do I have" versus "what is configured" — and the report
    /// needs both. Kept in state rather than in the UI for the same reason the
    /// install session is: a bootstrap that wrote half its files and then lost
    /// its window must still be visible as an interruption.
    bootstrap: Option<BootstrapSession>,
}

impl AppState {
    /// Builds state, resolving the resource directory containing `profiles/`
    /// and `localization/`.
    ///
    /// `resource_dir` is injected rather than read from Tauri so this is
    /// constructible in tests.
    pub fn new(resource_dir: Option<PathBuf>) -> Self {
        let profiles_dir = resource_dir.as_ref().map(|d| d.join("profiles"));
        let localization_dir = resource_dir.as_ref().map(|d| d.join("localization"));
        let knowledge_dir = resource_dir.as_ref().map(|d| d.join("knowledge"));
        let plugins_dir = resource_dir.as_ref().map(|d| d.join("plugins"));

        let cache = Mutex::new(Cache::default());

        // 启动检测 active_task.json：running/queued 改 interrupted，绝不自动续跑
        if let Ok(Some(mut doc)) = crate::modules::install::load_task_document() {
            if doc.status == "running" || doc.status == "queued" {
                doc.status = "interrupted".to_string();
                for step in doc.session.steps.iter_mut() {
                    if step.status == StepStatus::Running {
                        step.status = StepStatus::Failed;
                        step.stage = "上次结果不确定".into();
                        step.detail = Some("进程在运行中异常中断，结果未经验证".into());
                        step.action_outcome = Some(AttemptOutcome::Cancelled);
                        step.availability = Some(AvailabilityEvidence {
                            kind: AvailabilityKind::Cli,
                            status: AvailabilityStatus::Unknown,
                            version: None,
                            evidence_source: "启动检查".into(),
                            observed_at: crate::modules::detect::now_iso8601(),
                            detail: Some("进程在运行中异常中断，可用性未知".into()),
                        });
                    }
                }
                doc.updated_at = crate::modules::detect::now_iso8601();
                let _ = crate::modules::install::save_task_document(&doc);
            }
            if let Ok(mut c) = cache.lock() {
                c.session = Some(doc.session);
            }
        }

        Self {
            profiles: profiles::ProfileStore::load(profiles_dir.as_deref()),
            localization: config::LocalizationStore::load(localization_dir.as_deref()),
            knowledge: knowledge::Knowledge::load(knowledge_dir.as_deref()),
            // 目录缺席时是空目录而非错误 —— `cargo test` 下资源本就不在，这条
            // 与 profiles/knowledge 的既有约定一致，不能让单测依赖打包产物。
            plugins: plugins::PluginCatalog::load(&plugins_dir.unwrap_or_default()),
            tasks: Arc::new(TaskManager::new()),
            cache,
            plans: Mutex::new(std::collections::HashMap::new()),
            winget_cache: Mutex::new(std::collections::HashMap::new()),
        }
    }

    /// Disk requirement derived from the *largest* profile, so the disk check
    /// does not need to know which profile the user will pick.
    pub fn required_download_mb(&self) -> u64 {
        profiles::required_download_mb(&self.profiles)
    }

    pub fn profiles_dir_hint(&self) -> Option<&Path> {
        self.profiles.source_dir.as_deref()
    }

    pub fn cache_environment(&self, report: &EnvironmentReport) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.environment = Some(report.clone());
        }
    }

    pub fn cache_scan(&self, inventory: &SoftwareInventory) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.scan = Some(inventory.clone());
        }
    }

    /// The cached inventory, but only if it already covers every id in `ids`.
    ///
    /// A partial cache must not be reused silently: the profile screen scanning
    /// only Git, then the report screen asking about Python, would otherwise get
    /// an inventory that says "Python: not found" because Python was never
    /// probed. This returns `None` in that case so the caller re-scans.
    pub fn cached_scan_covering(&self, ids: &[SoftwareId]) -> Option<SoftwareScan> {
        let cache = self.cache.lock().ok()?;
        let inventory = cache.scan.as_ref()?;
        let covers_all = ids
            .iter()
            .all(|id| inventory.find(*id).is_some());
        if !covers_all {
            return None;
        }
        Some(SoftwareScan {
            scanned_at: inventory.scanned_at.clone(),
            inventory: inventory.clone(),
        })
    }

    /// Last detection, if any. Exposed for diagnostics and the report screen.
    pub fn last_environment(&self) -> Option<EnvironmentReport> {
        self.cache.lock().ok().and_then(|c| c.environment.clone())
    }

    pub fn last_scan(&self) -> Option<SoftwareInventory> {
        self.cache.lock().ok().and_then(|c| c.scan.clone())
    }

    // -----------------------------------------------------------------------
    // Installation session
    // -----------------------------------------------------------------------

    /// The session to resume from, if one was interrupted.
    ///
    /// Returns `None` for a session that completed or was deliberately
    /// cancelled: offering to "continue" a finished run would invite the
    /// student to install everything twice.
    pub fn resumable_session(&self) -> Option<ExecutionSession> {
        let cache = self.cache.lock().ok()?;
        cache.session.as_ref().filter(|s| s.is_resumable()).cloned()
    }

    /// The most recent session, finished or not. Used by the report screen.
    pub fn last_session(&self) -> Option<ExecutionSession> {
        self.cache.lock().ok().and_then(|c| c.session.clone())
    }

    /// Begins an install session, acquiring a unified MutationLease.
    /// Fails if ANY other mutating task (Install, Bootstrap, Plugin, etc.) is in progress.
    pub fn begin_session(
        &self,
        session: ExecutionSession,
    ) -> Result<(crate::modules::task::MutationLease, CancelFlag), String> {
        let lease = self
            .tasks
            .try_begin_mutation(crate::modules::task::MutationKind::Install, None)
            .map_err(|e| e.message)?;
        let flag = lease.cancel_flag().clone();
        if let Ok(mut cache) = self.cache.lock() {
            cache.session = Some(session);
        }
        Ok((lease, flag))
    }

    pub fn finish_session(
        &self,
        session: ExecutionSession,
        lease: Option<crate::modules::task::MutationLease>,
    ) {
        if let Some(l) = lease {
            let status = if session.is_success() {
                crate::modules::task::TaskFinalStatus::Succeeded
            } else if session.is_cancelled() {
                crate::modules::task::TaskFinalStatus::Cancelled
            } else {
                crate::modules::task::TaskFinalStatus::Failed
            };
            l.finish(status);
        }
        if let Ok(mut cache) = self.cache.lock() {
            cache.session = Some(session);
            // The session's verification re-scanned the machine, so the cached
            // inventory is now stale by exactly the amount the run changed it.
            // Dropping it forces the next screen to re-read rather than show a
            // pre-install answer next to a post-install report.
            cache.scan = None;
        }
    }

    /// Requests cancellation of the in-flight run.
    pub fn cancel_active_session(&self) -> bool {
        if let Some(active_id) = self.tasks.active_task_id() {
            self.tasks.cancel_task(&active_id).unwrap_or(false)
        } else {
            false
        }
    }

    /// True while an installation is physically running.
    pub fn is_installing(&self) -> bool {
        self.tasks.active_kind() == Some(crate::modules::task::MutationKind::Install)
    }

    /// Stores a backend-owned plan record.
    pub fn store_plan(&self, plan: PlanRecord) {
        if let Ok(mut plans) = self.plans.lock() {
            plans.insert(plan.plan_id.clone(), plan);
        }
    }

    /// Retrieves a backend-owned plan record by id.
    pub fn get_plan(&self, plan_id: &str) -> Option<PlanRecord> {
        self.plans.lock().ok()?.get(plan_id).cloned()
    }

    /// Stores a validated winget package details record in backend cache.
    pub fn store_winget_package(&self, details: crate::modules::system_ops::WingetPackageDetails) {
        if let Ok(mut cache) = self.winget_cache.lock() {
            cache.insert(details.id.clone(), details);
        }
    }

    /// Retrieves a validated winget package details record by exact package id.
    pub fn get_winget_package(&self, package_id: &str) -> Option<crate::modules::system_ops::WingetPackageDetails> {
        self.winget_cache.lock().ok()?.get(package_id).cloned()
    }

    // -----------------------------------------------------------------------
    // Bootstrap session
    // -----------------------------------------------------------------------

    /// True while any state-changing run is in flight.
    ///
    /// The single-instance rule covers all mutating tasks (Install, Bootstrap, Plugin, Template, Clean).
    pub fn is_busy(&self) -> bool {
        self.tasks.is_busy()
    }

    pub fn begin_bootstrap(
        &self,
        session: BootstrapSession,
    ) -> Result<(crate::modules::task::MutationLease, CancelFlag), String> {
        let lease = self
            .tasks
            .try_begin_mutation(crate::modules::task::MutationKind::Bootstrap, None)
            .map_err(|e| e.message)?;
        let flag = lease.cancel_flag().clone();
        if let Ok(mut cache) = self.cache.lock() {
            cache.bootstrap = Some(session);
        }
        Ok((lease, flag))
    }

    pub fn finish_bootstrap(
        &self,
        session: BootstrapSession,
        lease: Option<crate::modules::task::MutationLease>,
    ) {
        if let Some(l) = lease {
            let status = if session.is_success() {
                crate::modules::task::TaskFinalStatus::Succeeded
            } else {
                crate::modules::task::TaskFinalStatus::Failed
            };
            l.finish(status);
        }
        if let Ok(mut cache) = self.cache.lock() {
            cache.bootstrap = Some(session);
            // Configuration can change what a program reports about itself.
            // Dropping the scan forces a re-read rather than letting a stale answer sit.
            cache.scan = None;
        }
    }

    pub fn last_bootstrap(&self) -> Option<BootstrapSession> {
        self.cache.lock().ok().and_then(|c| c.bootstrap.clone())
    }

    /// The bootstrap session to offer "继续" for, if one was interrupted.
    pub fn resumable_bootstrap(&self) -> Option<BootstrapSession> {
        let cache = self.cache.lock().ok()?;
        cache
            .bootstrap
            .as_ref()
            .filter(|s| s.is_resumable())
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_boots_with_builtin_profiles_when_resources_are_absent() {
        let state = AppState::new(None);
        // Asserts the *property* rather than a count: the built-in set is
        // product content that grows, and a count assertion turns every new
        // package into a test failure that says nothing about correctness.
        // What matters is that every profile the binary ships is usable.
        let loaded = state.profiles.all();
        assert!(
            loaded.len() >= 3,
            "expected the shipped packages to load, got {}",
            loaded.len()
        );
        assert!(state.required_download_mb() >= 2048);
    }

    #[test]
    fn state_boots_from_a_real_resource_directory() {
        // Exercises the same path as production: resources/profiles/*.json
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let state = AppState::new(Some(root));
        assert!(!state.profiles.is_empty(), "the shipped profiles must load");
        assert_eq!(state.localization.all().len(), 3);
        assert!(state.profiles_dir_hint().is_some());

        // The two halves of the product must agree: every profile loads from
        // disk *and* from the compiled-in copies, and the two sets are the same
        // set. A file added to `profiles/` but forgotten in `BUILTIN` would
        // otherwise only show up as a missing package on a machine where the
        // resource directory is unreadable — the worst place to find out.
        let from_disk: Vec<String> = state.profiles.all().into_iter().map(|p| p.id).collect();
        let from_binary: Vec<String> = crate::modules::profiles::ProfileStore::load(None)
            .all()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(
            from_disk, from_binary,
            "profiles/ and the compiled-in BUILTIN list have drifted"
        );
    }

    #[test]
    fn caching_round_trips() {
        let state = AppState::new(None);
        assert!(state.last_environment().is_none());
        let report = crate::modules::detect::detect(500).unwrap();
        state.cache_environment(&report);
        assert_eq!(
            state.last_environment().unwrap().signals.len(),
            report.signals.len()
        );
    }

    #[test]
    fn a_partial_scan_is_never_reused_for_a_wider_request() {
        // The bug this prevents: the profile screen scans only Git, then the
        // report screen asks about Python and receives a cached inventory that
        // reports Python as missing because it was never probed.
        use crate::modules::{catalog, inventory};

        let state = AppState::new(None);
        let inv = inventory::scan(&catalog::Catalog::builtin(), &[SoftwareId::Git]);
        state.cache_scan(&inv);

        assert!(state.cached_scan_covering(&[SoftwareId::Git]).is_some());
        assert!(
            state
                .cached_scan_covering(&[SoftwareId::Git, SoftwareId::Python])
                .is_none(),
            "a cache that never probed Python must not answer questions about it"
        );
    }
}
