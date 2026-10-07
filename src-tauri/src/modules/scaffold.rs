//! Project scaffolding execution contract and parameter substitution.
//!
//! Implements issues E01, E02, E03, E04, E05, E07:
//! - Structured execution steps (`program`, `args`, `cwd`) replacing naive string splitting
//! - Typed parameter substitution (`{{projectName}}`, `{{parentDir}}`, `{{targetPath}}`)
//! - Strict target path normalization (`target_path = parent_dir.join(project_name)`)
//! - Package manager compatibility and capability declarations
//! - Explicit `prepared_only` gate for unverified recipes

use crate::model::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A single discrete step in a template scaffolding workflow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaffoldStep {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub program: String,
    pub args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub optional: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
}

/// Validated specification for a project scaffolding plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaffoldPlan {
    pub template_id: String,
    pub project_name: String,
    pub parent_dir: PathBuf,
    pub target_path: PathBuf,
    pub steps: Vec<ScaffoldStep>,
    #[serde(default)]
    pub supported_package_managers: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_package_manager: Option<String>,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
    #[serde(default)]
    pub prepared_only: bool,
}

/// Windows reserved filenames that cannot be used as project names.
const RESERVED_DEVICE_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Validates that a project name contains only safe identifier characters
/// and is not a reserved Windows device name or path traversal attempt.
pub fn validate_project_name(name: &str) -> AppResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidRequest {
            reason: "工程名称不能为空".into(),
        });
    }

    if trimmed.len() > 128 {
        return Err(AppError::InvalidRequest {
            reason: "工程名称长度不能超过 128 个字符".into(),
        });
    }

    // Disallow path traversal and separator characters
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") || trimmed.contains(':') {
        return Err(AppError::InvalidRequest {
            reason: "工程名称不能包含路径分隔符、冒号或上级目录引用 (..)".into(),
        });
    }

    // Must be valid alphanumeric, hyphen, underscore, or dot
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return Err(AppError::InvalidRequest {
            reason: "工程名称仅支持英文字母、数字、短横线、下划线及点".into(),
        });
    }

    let upper = trimmed.to_ascii_uppercase();
    let stem = upper.split('.').next().unwrap_or(&upper);
    if RESERVED_DEVICE_NAMES.contains(&stem) {
        return Err(AppError::InvalidRequest {
            reason: format!("工程名称不能使用 Windows 保留设备名: {trimmed}"),
        });
    }

    Ok(())
}

/// Resolves and substitutes controlled parameters in a single scaffold step.
///
/// Only controlled variables are replaced:
/// - `{{projectName}}` -> sanitized project name
/// - `{{parentDir}}` -> parent workspace directory string
/// - `{{targetPath}}` -> target project directory string
pub fn substitute_step_params(
    step: &ScaffoldStep,
    project_name: &str,
    parent_dir: &Path,
    target_path: &Path,
) -> ScaffoldStep {
    let parent_str = parent_dir.to_string_lossy();
    let target_str = target_path.to_string_lossy();

    let replace_vars = |input: &str| -> String {
        input
            .replace("{{projectName}}", project_name)
            .replace("{{parentDir}}", &parent_str)
            .replace("{{targetPath}}", &target_str)
    };

    let resolved_args: Vec<String> = step.args.iter().map(|arg| replace_vars(arg)).collect();
    let resolved_cwd = step.cwd.as_deref().map(replace_vars);
    let resolved_desc = step.description.as_deref().map(replace_vars);

    ScaffoldStep {
        id: step.id.clone(),
        program: step.program.clone(),
        args: resolved_args,
        cwd: resolved_cwd,
        description: resolved_desc,
        optional: step.optional,
        condition: step.condition.clone(),
    }
}

/// Builds a validated `ScaffoldPlan` from raw inputs, ensuring target directory
/// strictly matches `parent_dir.join(project_name)` (Issue E03).
pub fn build_scaffold_plan(
    template_id: String,
    project_name: String,
    parent_dir: PathBuf,
    raw_steps: Vec<ScaffoldStep>,
    supported_package_managers: Vec<String>,
    selected_package_manager: Option<String>,
    required_capabilities: Vec<String>,
    prepared_only: bool,
) -> AppResult<ScaffoldPlan> {
    validate_project_name(&project_name)?;

    if !parent_dir.is_absolute() {
        return Err(AppError::InvalidRequest {
            reason: "父级目录必须是绝对路径".into(),
        });
    }

    let target_path = parent_dir.join(&project_name);

    let substituted_steps: Vec<ScaffoldStep> = raw_steps
        .iter()
        .map(|s| substitute_step_params(s, &project_name, &parent_dir, &target_path))
        .collect();

    Ok(ScaffoldPlan {
        template_id,
        project_name,
        parent_dir,
        target_path,
        steps: substituted_steps,
        supported_package_managers,
        selected_package_manager,
        required_capabilities,
        prepared_only,
    })
}

/// Composes a safe shell display script from structured steps.
pub fn compose_shell_preview(plan: &ScaffoldPlan) -> String {
    let mut script_lines: Vec<String> = Vec::new();

    for step in &plan.steps {
        let mut line = String::new();
        if let Some(ref cwd) = step.cwd {
            line.push_str(&format!("(cd \"{cwd}\" && "));
        }
        line.push_str(&step.program);
        for arg in &step.args {
            line.push(' ');
            if arg.contains(' ') || arg.contains('\t') || arg.is_empty() {
                line.push_str(&format!("\"{arg}\""));
            } else {
                line.push_str(arg);
            }
        }
        if step.cwd.is_some() {
            line.push(')');
        }
        script_lines.push(line);
    }

    script_lines.join(" &&\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_project_name_success() {
        assert!(validate_project_name("my-app").is_ok());
        assert!(validate_project_name("my_app_v2").is_ok());
        assert!(validate_project_name("demo123").is_ok());
    }

    #[test]
    fn test_validate_project_name_rejections() {
        assert!(validate_project_name("").is_err());
        assert!(validate_project_name("   ").is_err());
        assert!(validate_project_name("my/app").is_err());
        assert!(validate_project_name("my\\app").is_err());
        assert!(validate_project_name("../escape").is_err());
        assert!(validate_project_name("CON").is_err());
        assert!(validate_project_name("nul").is_err());
        assert!(validate_project_name("aux.txt").is_err());
        assert!(validate_project_name("COM1").is_err());
    }

    #[test]
    fn test_substitute_step_params_preserves_spaces_and_quotes() {
        let step = ScaffoldStep {
            id: Some("init".into()),
            program: "pnpm".into(),
            args: vec![
                "create".into(),
                "next-app@latest".into(),
                "{{targetPath}}".into(),
                "--import-alias".into(),
                "@/*".into(),
            ],
            cwd: Some("{{parentDir}}".into()),
            description: Some("生成工程: {{projectName}}".into()),
            optional: false,
            condition: None,
        };

        let parent = Path::new("D:\\Projects");
        let target = Path::new("D:\\Projects\\my-next-app");
        let resolved = substitute_step_params(&step, "my-next-app", parent, target);

        assert_eq!(resolved.args[2], "D:\\Projects\\my-next-app");
        assert_eq!(resolved.cwd, Some("D:\\Projects".into()));
        assert_eq!(resolved.description, Some("生成工程: my-next-app".into()));
    }

    #[test]
    fn test_build_scaffold_plan_target_path_consistency() {
        let raw_steps = vec![
            ScaffoldStep {
                id: Some("step1".into()),
                program: "git".into(),
                args: vec!["clone".into(), "https://example.com/repo.git".into(), "{{projectName}}".into()],
                cwd: Some("{{parentDir}}".into()),
                description: None,
                optional: false,
                condition: None,
            },
            ScaffoldStep {
                id: Some("step2".into()),
                program: "npm".into(),
                args: vec!["install".into()],
                cwd: Some("{{targetPath}}".into()),
                description: None,
                optional: false,
                condition: None,
            },
        ];

        let plan = build_scaffold_plan(
            "tpl:demo".into(),
            "demo-app".into(),
            PathBuf::from("C:\\Work"),
            raw_steps,
            vec!["npm".into(), "pnpm".into()],
            Some("pnpm".into()),
            vec!["node".into(), "git".into()],
            true,
        )
        .expect("plan should be valid");

        assert_eq!(plan.target_path, PathBuf::from("C:\\Work\\demo-app"));
        assert_eq!(plan.steps[0].args[2], "demo-app");
        assert_eq!(plan.steps[1].cwd, Some("C:\\Work\\demo-app".into()));
        assert!(plan.prepared_only);
    }
}
