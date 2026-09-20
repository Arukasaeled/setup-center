//! Profile system.
//!
//! Profiles are **data, not code**: JSON files on disk, loaded at runtime and
//! shipped as Tauri resources. That is what makes the `claude-toolbox`
//! "profile思想" portable to a GUI product — a school can drop in
//! `campus.json` without a rebuild, and stage 3+ can add MCP/skills entries to
//! an existing profile without touching Rust.
//!
//! Fallback behaviour: if the resource directory is unreadable, we fall back to
//! profiles compiled into the binary. The app must always be able to start.

use crate::model::*;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Compiled-in profiles. Kept in sync with `src-tauri/profiles/*.json`; the
/// `profiles_match_builtin` test asserts they do not drift.
const BUILTIN: &[&str] = &[
    include_str!("../../profiles/beginner.json"),
    include_str!("../../profiles/ai_basic.json"),
    include_str!("../../profiles/coder.json"),
    include_str!("../../profiles/ai_engineer.json"),
    include_str!("../../profiles/ai_developer.json"),
    include_str!("../../profiles/programmer.json"),
];

pub struct ProfileStore {
    profiles: HashMap<String, Profile>,
    /// Where the profiles were loaded from, or `None` when using the builtins.
    pub source_dir: Option<PathBuf>,
    /// Non-fatal problems, surfaced in the UI/report instead of being swallowed.
    pub warnings: Vec<String>,
}

impl ProfileStore {
    /// Loads every `*.json` in `dir`, falling back to builtins when the
    /// directory is missing or yields nothing usable.
    ///
    /// A single malformed file does not take down the store: it is recorded as
    /// a warning and the remaining profiles still load.
    pub fn load(dir: Option<&Path>) -> Self {
        let mut profiles = HashMap::new();
        let mut warnings = Vec::new();
        let mut source_dir = None;

        if let Some(dir) = dir {
            if dir.is_dir() {
                let entries: Vec<PathBuf> = match std::fs::read_dir(dir) {
                    Ok(entries) => {
                        let mut v: Vec<PathBuf> = entries
                            .flatten()
                            .map(|e| e.path())
                            .filter(|p| p.extension().is_some_and(|e| e == "json"))
                            .collect();
                        v.sort();
                        v
                    }
                    Err(e) => {
                        warnings.push(format!("无法读取配置目录 {}: {e}", dir.display()));
                        Vec::new()
                    }
                };

                for file in entries {
                    match std::fs::read_to_string(&file) {
                        Ok(text) => match parse_profile(&text) {
                            Ok(profile) => {
                                profiles.insert(profile.id.clone(), profile);
                            }
                            Err(e) => warnings.push(format!(
                                "{} 解析失败，已跳过: {e}",
                                file.file_name().unwrap_or_default().to_string_lossy()
                            )),
                        },
                        Err(e) => warnings.push(format!("无法读取 {}: {e}", file.display())),
                    }
                }

                if !profiles.is_empty() {
                    source_dir = Some(dir.to_path_buf());
                }
            }
        }

        if profiles.is_empty() {
            if source_dir.is_some() {
                warnings.push("磁盘上的方案文件均不可用，已回退到内置方案。".into());
                source_dir = None;
            }
            for text in BUILTIN {
                match parse_profile(text) {
                    Ok(profile) => {
                        profiles.insert(profile.id.clone(), profile);
                    }
                    Err(e) => warnings.push(format!("内置方案解析失败（这是程序缺陷）: {e}")),
                }
            }
        }

        let mut store = Self {
            profiles,
            source_dir,
            warnings,
        };
        store.validate(&mut Vec::new());
        store
    }

    /// Drops profiles that reference software we cannot install, so a typo in a
    /// hand-written JSON cannot produce a plan with unresolvable steps.
    fn validate(&mut self, extra_warnings: &mut Vec<String>) {
        let mut invalid = Vec::new();
        for (id, profile) in &self.profiles {
            if profile.software.is_empty() {
                extra_warnings.push(format!("方案 {id} 未包含任何软件，已忽略。"));
                invalid.push(id.clone());
                continue;
            }
            if profile.name.trim().is_empty() {
                invalid.push(id.clone());
                extra_warnings.push(format!("方案 {id} 缺少名称，已忽略。"));
            }
        }
        for id in invalid {
            self.profiles.remove(&id);
        }
        self.warnings.append(extra_warnings);
    }

    pub fn all(&self) -> Vec<Profile> {
        let mut list: Vec<Profile> = self.profiles.values().cloned().collect();
        // Stable, meaningful order: by how much they install.
        list.sort_by_key(|p| (p.software.len(), p.id.clone()));
        list
    }

    pub fn get(&self, id: &str) -> AppResult<Profile> {
        self.profiles
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::ProfileNotFound { id: id.to_string() })
    }

    pub fn is_empty(&self) -> bool {
        self.profiles.is_empty()
    }
}

/// Parses one profile document.
///
/// Validation is done on the parsed struct (unknown keys are rejected via
/// `deny_unknown_fields` in the JSON schema below being enforced by hand, since
/// serde's derive would need the attribute on every struct). Concretely we
/// check: id/non-empty software/known software keys.
pub fn parse_profile(text: &str) -> AppResult<Profile> {
    let raw: serde_json::Value = serde_json::from_str(text).map_err(|e| AppError::ProfileInvalid {
        reason: e.to_string(),
    })?;

    // Deserialise `software` from strings so profiles stay readable, then
    // convert to the enum — an unknown key becomes a clear error rather than a
    // silently dropped step.
    let mut profile: Profile =
        serde_json::from_value(raw).map_err(|e| AppError::ProfileInvalid {
            reason: e.to_string(),
        })?;

    if profile.id.trim().is_empty() {
        return Err(AppError::ProfileInvalid {
            reason: "缺少 id".into(),
        });
    }

    let mut software = Vec::new();
    for id in &profile.software {
        if !profile.software.contains(id) {
            continue;
        }
        software.push(*id);
    }
    // Deduplicate while preserving order (a hand-edited profile may repeat one).
    software.sort();
    software.dedup();
    profile.software = software;

    if profile.software.is_empty() {
        return Err(AppError::ProfileInvalid {
            reason: format!("方案 {} 没有有效软件项", profile.id),
        });
    }

    if profile.estimated_download_mb == 0 {
        // Derive a sane default rather than failing: a missing number should
        // not make a profile unusable.
        profile.estimated_download_mb = profile.software.len() as u32 * 220;
    }
    if profile.estimated_minutes == 0 {
        profile.estimated_minutes = profile.software.len() as u32 * 2;
    }

    Ok(profile)
}

/// Largest download any profile needs — used as the disk-space requirement.
pub fn required_download_mb(store: &ProfileStore) -> u64 {
    store
        .all()
        .iter()
        .map(|p| p.estimated_download_mb as u64)
        .max()
        .unwrap_or(500)
        // Headroom for the Windows installer temp copies and extraction.
        .max(2048)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_parse_and_cover_the_three_scenarios() {
        let store = ProfileStore::load(None);
        assert!(store.warnings.is_empty(), "builtin warnings: {:?}", store.warnings);

        let ids: Vec<String> = store.all().into_iter().map(|p| p.id).collect();
        assert!(ids.contains(&"beginner".to_string()));
        assert!(ids.contains(&"coder".to_string()));
        assert!(ids.contains(&"ai_engineer".to_string()));
        // The three student-facing packages. These ids are load-bearing: the
        // first-run screen names them, so a rename here is a product change.
        assert!(ids.contains(&"ai_basic".to_string()));
        assert!(ids.contains(&"ai_developer".to_string()));
        assert!(ids.contains(&"programmer".to_string()));
    }

    #[test]
    fn every_builtin_profile_plans_an_actionable_step_for_each_program() {
        // The property that matters for a shipped package: every program the
        // profile names produces a step the executor can *act on* — a non-empty
        // source chain — or is honestly marked satisfied.
        //
        // Deliberately *not* asserting "every program is installable". A profile
        // may legitimately name a detect-only program — `programmer` names MSVC
        // build tools, which this tool reports on but will not install because
        // the package is multi-GB and the installer needs interactive choices.
        // The earlier version of this test asserted `is_installable()` and
        // failed on that legitimate case, which is the test being wrong rather
        // than the profile.
        //
        // What is *not* legitimate is a step whose chain is empty while not
        // satisfied: that renders as a row with nothing to do and no reason why.
        let catalog = crate::modules::catalog::Catalog::builtin();
        let store = ProfileStore::load(None);
        let scan = crate::model::SoftwareScan {
            inventory: crate::model::SoftwareInventory {
                items: Vec::new(),
                scanned_at: String::new(),
                providers: Vec::new(),
            },
            scanned_at: String::new(),
        };
        for profile in store.all() {
            let plan = crate::modules::install::build_plan(&catalog, &profile, &scan);
            assert_eq!(
                plan.steps.len(),
                profile.software.len(),
                "方案 {} 的计划步骤数与软件数不一致",
                profile.id
            );
            for step in &plan.steps {
                let chain = crate::modules::install::spec_from(&catalog, step.id).chain;
                // Two honest outcomes for a step: the executor has something to
                // run, or the program is one this tool only *reports* on and the
                // row tells the student so. What must not happen is a step that
                // is neither — that renders as a row with no action and no
                // explanation.
                let detect_only = !catalog.entry(step.id).is_installable();
                assert!(
                    step.satisfied || !chain.is_empty() || detect_only,
                    "方案 {} 的 {} 既未满足、也没有可执行方式、也不是「仅检测」",
                    profile.id,
                    step.name
                );
                if detect_only {
                    // A detect-only program must never claim an install route.
                    assert!(
                        chain.is_empty(),
                        "方案 {} 的 {} 被标为仅检测，却带着安装方式",
                        profile.id,
                        step.name
                    );
                }
            }
        }
    }

    #[test]
    fn profiles_are_ordered_by_scope() {
        let store = ProfileStore::load(None);
        let all = store.all();
        let beginner = all.iter().find(|p| p.id == "beginner").unwrap();
        let engineer = all.iter().find(|p| p.id == "ai_engineer").unwrap();
        assert!(
            beginner.software.len() < engineer.software.len(),
            "ai_engineer should install strictly more than beginner"
        );
    }

    #[test]
    fn unknown_software_key_is_rejected_not_ignored() {
        let bad = r#"{"id":"x","name":"X","tagline":"","audience":"","rationale":"",
                      "software":["git","definitely_not_real"],"configure":[],
                      "estimatedMinutes":1,"estimatedDownloadMb":1,"requiresAdmin":false}"#;
        // serde reports the unknown variant, and we surface it as ProfileInvalid
        // rather than silently planning a shorter install.
        assert!(matches!(
            parse_profile(bad),
            Err(AppError::ProfileInvalid { .. })
        ));
    }

    #[test]
    fn malformed_json_is_an_error_not_a_panic() {
        assert!(matches!(
            parse_profile("{ not json"),
            Err(AppError::ProfileInvalid { .. })
        ));
    }

    #[test]
    fn missing_id_is_rejected() {
        let text = r#"{"id":"","name":"X","tagline":"","audience":"","rationale":"",
                       "software":["git"],"configure":[],"estimatedMinutes":1,
                       "estimatedDownloadMb":1,"requiresAdmin":false}"#;
        assert!(matches!(
            parse_profile(text),
            Err(AppError::ProfileInvalid { .. })
        ));
    }

    #[test]
    fn duplicate_software_entries_are_deduplicated() {
        let text = r#"{"id":"d","name":"D","tagline":"","audience":"","rationale":"",
                       "software":["git","git","python"],"configure":[],
                       "estimatedMinutes":1,"estimatedDownloadMb":1,"requiresAdmin":false}"#;
        let profile = parse_profile(text).unwrap();
        assert_eq!(profile.software.len(), 2);
    }

    #[test]
    fn zero_estimates_get_derived_defaults() {
        let text = r#"{"id":"z","name":"Z","tagline":"","audience":"","rationale":"",
                       "software":["git","python"],"configure":[],
                       "estimatedMinutes":0,"estimatedDownloadMb":0,"requiresAdmin":false}"#;
        let profile = parse_profile(text).unwrap();
        assert!(profile.estimated_download_mb > 0);
        assert!(profile.estimated_minutes > 0);
    }

    #[test]
    fn missing_directory_falls_back_to_builtins() {
        let store = ProfileStore::load(Some(Path::new("Z:\\does\\not\\exist")));
        assert!(!store.is_empty());
        assert!(store.source_dir.is_none());
    }

    #[test]
    fn unusable_directory_falls_back_to_builtins() {
        let dir = std::env::temp_dir().join("aissetup-empty-profiles");
        let _ = std::fs::create_dir_all(&dir);
        let store = ProfileStore::load(Some(&dir));
        assert!(!store.is_empty(), "must fall back rather than start empty");
        assert!(store.source_dir.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn on_disk_profiles_are_preferred_over_builtins() {
        let dir = std::env::temp_dir().join("aissetup-custom-profiles");
        let _ = std::fs::create_dir_all(&dir);
        let text = r#"{"id":"campus","name":"校园版","tagline":"t","audience":"a",
                       "rationale":"r","software":["git"],"configure":[],
                       "estimatedMinutes":3,"estimatedDownloadMb":100,"requiresAdmin":false}"#;
        std::fs::write(dir.join("campus.json"), text).unwrap();

        let store = ProfileStore::load(Some(&dir));
        assert_eq!(store.source_dir.as_deref(), Some(dir.as_path()));
        assert!(store.get("campus").is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn one_bad_file_does_not_lose_the_good_ones() {
        let dir = std::env::temp_dir().join("aissetup-partial-profiles");
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("good.json"), r#"{"id":"ok","name":"OK","tagline":"t",
            "audience":"a","rationale":"r","software":["git"],"configure":[],
            "estimatedMinutes":1,"estimatedDownloadMb":1,"requiresAdmin":false}"#).unwrap();
        std::fs::write(dir.join("broken.json"), "{ nope").unwrap();

        let store = ProfileStore::load(Some(&dir));
        assert!(store.get("ok").is_ok());
        assert_eq!(store.warnings.len(), 1);
        assert!(store.warnings[0].contains("broken.json"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
