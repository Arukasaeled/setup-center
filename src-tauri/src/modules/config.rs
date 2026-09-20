//! Configuration and localisation module.
//!
//! Localisation is **data-driven**, as the brief requires: the settings live in
//! `localization/*.json` and are loaded at runtime, never hard-coded in Rust or
//! in the frontend. That is what lets someone add a fourth target (say, JetBrains
//! IDEs) without a code change.
//!
//! Stage 3 will execute [`ConfigAction`]s. Stage 1 loads and validates the
//! plans, so the shape is locked in and testable.

use crate::model::*;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// One localisation recipe for one target program.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalizationPlan {
    pub id: String,
    pub target: String,
    pub description: String,
    /// File to create or patch, relative to a resolved base directory.
    /// Supports `%APPDATA%` and `%USERPROFILE%` expansion.
    pub file: String,
    /// Strategy used to apply the change.
    pub strategy: LocalizationStrategy,
    /// Key/value pairs written into the file (JSON merge) or used as
    /// `key=value` lines, depending on the strategy.
    pub settings: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalizationStrategy {
    /// Merge `settings` into an existing JSON file, keeping other keys.
    JsonMerge,
    /// Write a plain-text snippet (e.g. VS Code's locale setting).
    TextPatch,
    /// Register the change through a command rather than a file.
    Command,
}

/// Which localisations are relevant for a given profile.
pub fn plans_for(software: &[SoftwareId]) -> Vec<&'static str> {
    let mut ids = Vec::new();
    if software.contains(&SoftwareId::Vscode) {
        ids.push("vscode");
    }
    if software.contains(&SoftwareId::ClaudeCode) || software.contains(&SoftwareId::ClaudeDesktop) {
        ids.push("claude");
    }
    if software.contains(&SoftwareId::Codex) {
        ids.push("codex");
    }
    ids
}

const BUILTIN: &[&str] = &[
    include_str!("../../localization/vscode.json"),
    include_str!("../../localization/claude.json"),
    include_str!("../../localization/codex.json"),
];

pub struct LocalizationStore {
    plans: HashMap<String, LocalizationPlan>,
    pub source_dir: Option<PathBuf>,
    pub warnings: Vec<String>,
}

impl LocalizationStore {
    pub fn load(dir: Option<&Path>) -> Self {
        let mut plans = HashMap::new();
        let mut warnings = Vec::new();
        let mut source_dir = None;

        if let Some(dir) = dir {
            if dir.is_dir() {
                let files: Vec<PathBuf> = std::fs::read_dir(dir)
                    .map(|entries| {
                        let mut v: Vec<_> = entries
                            .flatten()
                            .map(|e| e.path())
                            .filter(|p| p.extension().is_some_and(|e| e == "json"))
                            .collect();
                        v.sort();
                        v
                    })
                    .unwrap_or_default();

                for file in files {
                    match std::fs::read_to_string(&file).and_then(|text| {
                        serde_json::from_str::<LocalizationPlan>(&text)
                            .map_err(|e| std::io::Error::other(e.to_string()))
                    }) {
                        Ok(plan) => {
                            plans.insert(plan.id.clone(), plan);
                        }
                        Err(e) => warnings.push(format!(
                            "{} 本地化配置无效，已跳过: {e}",
                            file.file_name().unwrap_or_default().to_string_lossy()
                        )),
                    }
                }

                if !plans.is_empty() {
                    source_dir = Some(dir.to_path_buf());
                }
            }
        }

        if plans.is_empty() {
            for text in BUILTIN {
                if let Ok(plan) = serde_json::from_str::<LocalizationPlan>(text) {
                    plans.insert(plan.id.clone(), plan);
                }
            }
        }

        Self {
            plans,
            source_dir,
            warnings,
        }
    }

    pub fn get(&self, id: &str) -> Option<&LocalizationPlan> {
        self.plans.get(id)
    }

    pub fn all(&self) -> Vec<&LocalizationPlan> {
        let mut list: Vec<_> = self.plans.values().collect();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        list
    }
}

/// Expands Windows environment variables in a path template.
pub fn expand_path(template: &str) -> String {
    let mut out = template.to_string();
    for var in ["APPDATA", "USERPROFILE", "LOCALAPPDATA", "PROGRAMFILES"] {
        if let Ok(value) = std::env::var(var) {
            out = out.replace(&format!("%{var}%"), &value);
        }
    }
    out
}

/// Turns localisation plans into reportable config actions.
pub fn config_actions_for(software: &[SoftwareId], store: &LocalizationStore) -> Vec<ConfigAction> {
    let mut actions: Vec<ConfigAction> = plans_for(software)
        .into_iter()
        .filter_map(|id| store.get(id))
        .map(|plan| ConfigAction {
            id: plan.id.clone(),
            target: plan.target.clone(),
            description: plan.description.clone(),
            applied: None,
            detail: Some(format!(
                "{} → {}",
                plan.strategy_display(),
                expand_path(&plan.file)
            )),
        })
        .collect();

    // A plain, non-localisation config action that the brief explicitly asks
    // for: minimal, sensible git defaults so the first commit works.
    if software.contains(&SoftwareId::Git) {
        actions.push(ConfigAction {
            id: "git.baseline".into(),
            target: "Git".into(),
            description: "写入基础 Git 配置（默认分支、换行符处理）".into(),
            applied: None,
            detail: Some("core.autocrlf=true, init.defaultBranch=main".into()),
        });
    }

    actions
}

impl LocalizationPlan {
    pub fn strategy_display(&self) -> &'static str {
        match self.strategy {
            LocalizationStrategy::JsonMerge => "合并 JSON 设置",
            LocalizationStrategy::TextPatch => "写入配置文本",
            LocalizationStrategy::Command => "执行配置命令",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_localization_plans_load() {
        let store = LocalizationStore::load(None);
        assert!(store.get("vscode").is_some());
        assert!(store.get("claude").is_some());
        assert!(store.get("codex").is_some());
    }

    #[test]
    fn plans_are_selected_by_profile_software() {
        assert_eq!(plans_for(&[SoftwareId::Vscode]), vec!["vscode"]);
        assert!(plans_for(&[SoftwareId::Git]).is_empty());

        let both = plans_for(&[SoftwareId::Vscode, SoftwareId::Codex]);
        assert!(both.contains(&"vscode"));
        assert!(both.contains(&"codex"));
    }

    #[test]
    fn vscode_plan_sets_chinese_locale() {
        let store = LocalizationStore::load(None);
        let plan = store.get("vscode").unwrap();
        assert_eq!(
            plan.settings.get("locale").and_then(|v| v.as_str()),
            Some("zh-cn"),
            "the VS Code plan must actually switch the language"
        );
    }

    #[test]
    fn path_expansion_handles_unknown_variables() {
        std::env::set_var("AISS_TEST_VAR", "x");
        // Unknown variables are left alone rather than becoming an empty path.
        assert_eq!(expand_path("%NOT_A_REAL_VAR%\\a"), "%NOT_A_REAL_VAR%\\a");
    }

    #[test]
    fn config_actions_include_git_baseline_when_git_selected() {
        let store = LocalizationStore::load(None);
        let actions = config_actions_for(&[SoftwareId::Git, SoftwareId::Vscode], &store);
        assert!(actions.iter().any(|a| a.id == "git.baseline"));
        assert!(actions.iter().any(|a| a.id == "vscode"));
        assert!(actions.iter().all(|a| a.applied.is_none()));
    }

    #[test]
    fn missing_directory_falls_back_to_builtins() {
        let store = LocalizationStore::load(Some(Path::new("Z:\\nope")));
        assert_eq!(store.all().len(), 3);
        assert!(store.source_dir.is_none());
    }
}
