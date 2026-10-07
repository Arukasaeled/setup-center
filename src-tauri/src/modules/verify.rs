//! Verification module.
//!
//! The brief names three checks per program: **present**, **on PATH**, and
//! **version sane**. They are modelled as three separate [`CheckResult`]s
//! rather than one boolean because they fail in different ways and need
//! different advice:
//!
//! | failure | what the student sees |
//! |---|---|
//! | not present | "重新安装" |
//! | present, not on PATH | "只需要重启终端/修复 PATH" |
//! | present, on PATH, version unparsable | "已安装，但版本异常 — 可能装成了 Store 版" |
//!
//! Stage 1 ships the engine and the check-building logic for real; the probes
//! that fill in observed values arrive in stage 2/4.

use crate::model::*;

/// Minimum version we consider usable, per program.
///
/// Only programs the product *installs* appear here, because this drives the
/// "your version is too old, the plan will upgrade it" decision, and that
/// decision only makes sense for something we can act on. A detect-only program
/// returns `None`, which the caller renders as "present" without a version
/// judgement — reporting "too old" for something we will not replace would be an
/// instruction with no follow-through.
///
/// Exhaustive by design: adding a `SoftwareId` variant fails to compile until it
/// is classified here.
fn minimum_version(id: SoftwareId) -> Option<&'static str> {
    match id {
        SoftwareId::Git => Some("2.30"),
        SoftwareId::Python => Some("3.9"),
        SoftwareId::Node => Some("18.0"),
        SoftwareId::Vscode => Some("1.70"),
        SoftwareId::ClaudeCode => Some("1.0"),
        SoftwareId::Codex => Some("0.1"),
        SoftwareId::ClaudeDesktop => None,
        // The ChatGPT desktop app publishes no version through any channel this
        // tool can read, so there is nothing to compare against.
        SoftwareId::ChatgptDesktop => None,

        // Detect-only: no version floor is enforced.
        SoftwareId::Docker
        | SoftwareId::Cursor
        | SoftwareId::Windsurf
        | SoftwareId::LmStudio
        | SoftwareId::Wsl
        | SoftwareId::MsvcBuildTools
        | SoftwareId::Cmake
        | SoftwareId::Npm
        | SoftwareId::Pnpm
        | SoftwareId::Uv
        | SoftwareId::Rust
        | SoftwareId::Java
        | SoftwareId::Gemini
        | SoftwareId::OpenCode
        | SoftwareId::Continue
        | SoftwareId::Jetbrains
        // The three added Chinese/Charm agents and CC Switch are all installed
        // by their own vendor's channel (npm for qwen/crush, a GitHub release
        // archive for Kimi, an MSI the user runs for CC Switch). None of them
        // publishes a version floor worth enforcing, and CC Switch is not
        // installed by this tool at all.
        | SoftwareId::QwenCode
        | SoftwareId::KimiCli
        | SoftwareId::Crush
        | SoftwareId::CcSwitch
        // Installable, but no version floor worth enforcing: every supported
        // Windows 10/11 build ships a Terminal whose new features arrive by
        // Store update, so "too old" would never be actionable.
        | SoftwareId::WindowsTerminal
        // The 0.1.2 AIGC batch. All are end-user creative/chat applications that
        // auto-update themselves and have no API or file-format contract this
        // tool depends on, so there is no version a student could be "too old"
        // for in a way that would block their work. Enforcing a floor here would
        // produce an upgrade prompt with nothing behind it.
        | SoftwareId::Doubao
        | SoftwareId::CherryStudio
        | SoftwareId::Chatbox
        | SoftwareId::JianyingPro
        | SoftwareId::CapCut
        | SoftwareId::ComfyUi
        // Gemini Desktop is the same class as the batch above: a self-updating
        // chat client with no contract this tool depends on.
        | SoftwareId::GeminiDesktop => None,
    }
}

/// Parses a dotted numeric version into comparable components.
///
/// Returns `None` when the string has no numeric component at all, so callers
/// can distinguish "this is not a version" from "this is version 0.0.0".
/// Suffixes like `2.45.0.windows.1` and prefixes like `v1.9.0` are tolerated.
fn parse_version(v: &str) -> Option<Vec<u32>> {
    let cleaned = v.trim().trim_start_matches(['v', 'V']);
    // Accept an optional leading digit run; anything else is not a version.
    if cleaned.is_empty() || !cleaned.starts_with(|c: char| c.is_ascii_digit()) {
        return None;
    }
    Some(
        cleaned
            .split(['.', '-', '+', ' '])
            .map(|part| {
                part.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .unwrap_or(0)
            })
            .collect(),
    )
}

/// Compares dotted numeric versions, tolerating suffixes like `2.45.0.windows.1`.
///
/// Returns `None` when either side is unparsable, which callers must treat as
/// "cannot judge" rather than "too old". Trailing zero components are ignored so
/// `3.12` and `3.12.1` compare as unequal but `3.12` and `3.12.0` compare equal.
pub fn compare_versions(observed: &str, minimum: &str) -> Option<std::cmp::Ordering> {
    use std::cmp::Ordering;

    let mut a = parse_version(observed)?;
    let mut b = parse_version(minimum)?;

    // Normalise width so `3.12` vs `3.12.0` is Equal, not Greater.
    let len = a.len().max(b.len());
    a.resize(len, 0);
    b.resize(len, 0);

    // Trailing zeros carry no meaning: trim them before comparing.
    while a.len() > 1 && a.last() == Some(&0) && b.last() == Some(&0) {
        a.pop();
        b.pop();
    }

    Some(match a.cmp(&b) {
        Ordering::Greater => Ordering::Greater,
        Ordering::Less => Ordering::Less,
        Ordering::Equal => Ordering::Equal,
    })
}

/// Turns one detected program into the three checks the report requires.
///
/// The `Unknown` confidence is handled explicitly and is the reason this
/// function takes the merged [`SoftwareInfo`] rather than a bare bool: when every
/// provider failed, "installed: false, confidence: unknown" must become an
/// *unknown* check, never a failure. A verifier that turns a failed registry read
/// into "Git is not installed" tells the student to reinstall working software.
pub fn verify_package(id: SoftwareId, detected: Option<&SoftwareInfo>) -> PackageVerification {
    let name = id.display_name().to_string();
    let cat = crate::modules::catalog::Catalog::builtin();
    let cat_entry = cat.entry(id);
    let is_gui = cat_entry.version_args.is_none() || id.category() == SoftwareCategory::AiCreative;

    let unknown = detected.is_some_and(|item| {
        !item.installed && item.confidence == Confidence::Unknown
    });

    let present = match detected {
        Some(item) if item.installed => CheckResult {
            key: format!("{}.present", id.key()),
            label: "已安装".into(),
            confidence: Confidence::Ok,
            expected: Some("已安装".into()),
            // Name the sources that agreed, so a surprising result is traceable
            // to the provider that produced it.
            observed: Some(match (&item.path, item.sources.len()) {
                (Some(path), n) if n > 1 => format!("{path}（{n} 个来源确认）"),
                (Some(path), _) => path.clone(),
                (None, n) if n > 1 => format!("已检测到（{n} 个来源确认）"),
                (None, _) => "已检测到".to_string(),
            }),
            hint: None,
        },
        Some(_) if unknown => CheckResult {
            key: format!("{}.present", id.key()),
            label: "已安装".into(),
            confidence: Confidence::Unknown,
            expected: Some("已安装".into()),
            observed: Some("无法确认".into()),
            hint: Some(format!(
                "所有检测来源都未能完成检查，因此无法判断 {} 是否已安装。这不是「未安装」，安装前请自行确认。",
                name
            )),
        },
        _ => CheckResult {
            key: format!("{}.present", id.key()),
            label: "已安装".into(),
            confidence: Confidence::Fail,
            expected: Some("已安装".into()),
            observed: Some("未找到".into()),
            hint: Some(format!("{} 未安装，请重新运行安装。", name)),
        },
    };

    let on_path = if is_gui {
        match detected {
            Some(item) if item.installed => CheckResult {
                key: format!("{}.path", id.key()),
                label: "无需 PATH (GUI应用)".into(),
                confidence: Confidence::Ok,
                expected: Some("桌面应用".into()),
                observed: Some("桌面应用程序无需配置环境变量".into()),
                hint: None,
            },
            Some(_) if unknown => CheckResult {
                key: format!("{}.path", id.key()),
                label: "无需 PATH (GUI应用)".into(),
                confidence: Confidence::Unknown,
                expected: Some("桌面应用".into()),
                observed: Some("无法确认".into()),
                hint: None,
            },
            _ => CheckResult {
                key: format!("{}.path", id.key()),
                label: "无需 PATH (GUI应用)".into(),
                confidence: Confidence::Skipped,
                expected: Some("桌面应用".into()),
                observed: Some("未安装，跳过".into()),
                hint: None,
            },
        }
    } else {
        match detected {
            Some(item) if item.installed && item.on_path => CheckResult {
                key: format!("{}.path", id.key()),
                label: "已加入 PATH".into(),
                confidence: Confidence::Ok,
                expected: Some("在 PATH 中".into()),
                observed: Some("在 PATH 中".into()),
                hint: None,
            },
            Some(item) if item.installed => CheckResult {
                key: format!("{}.path", id.key()),
                label: "已加入 PATH".into(),
                confidence: Confidence::Fail,
                expected: Some("在 PATH 中".into()),
                observed: Some("不在 PATH 中".into()),
                hint: Some("关闭并重新打开终端后重试；若仍无效，需要修复 PATH。".into()),
            },
            Some(_) if unknown => CheckResult {
                key: format!("{}.path", id.key()),
                label: "已加入 PATH".into(),
                confidence: Confidence::Unknown,
                expected: Some("在 PATH 中".into()),
                observed: Some("无法确认".into()),
                hint: None,
            },
            _ => CheckResult {
                key: format!("{}.path", id.key()),
                label: "已加入 PATH".into(),
                confidence: Confidence::Skipped,
                expected: Some("在 PATH 中".into()),
                observed: Some("未安装，跳过".into()),
                hint: None,
            },
        }
    };

    let version = evaluate_version(id, detected);

    let passed = present.confidence.is_ok()
        && (is_gui || !on_path.confidence.eq(&Confidence::Fail))
        && !version.confidence.eq(&Confidence::Fail);

    PackageVerification {
        id,
        name,
        present,
        on_path,
        version,
        passed,
        availability: detected.and_then(|d| d.availability.clone()),
    }
}

fn evaluate_version(id: SoftwareId, detected: Option<&SoftwareInfo>) -> CheckResult {
    let key = format!("{}.version", id.key());
    let label = "版本正常".to_string();

    // "We could not check" short-circuits before the version logic: reporting a
    // version check as skipped or failed when the presence check is unknown would
    // imply a finding we do not have.
    if detected.is_some_and(|item| !item.installed && item.confidence == Confidence::Unknown) {
        return CheckResult {
            key,
            label,
            confidence: Confidence::Unknown,
            expected: minimum_version(id).map(str::to_string),
            observed: Some("无法确认".into()),
            hint: None,
        };
    }

    let Some(item) = detected.filter(|i| i.installed) else {
        return CheckResult {
            key,
            label,
            confidence: Confidence::Skipped,
            expected: minimum_version(id).map(str::to_string),
            observed: Some("未安装，跳过".into()),
            hint: None,
        };
    };

    let Some(observed) = item.version.as_deref() else {
        return CheckResult {
            key,
            label,
            confidence: Confidence::Unknown,
            expected: minimum_version(id).map(str::to_string),
            observed: Some("无法读取版本".into()),
            hint: Some("程序存在但未返回版本号，请手动确认。".into()),
        };
    };

    let Some(minimum) = minimum_version(id) else {
        return CheckResult {
            key,
            label,
            confidence: if observed.is_empty() {
                Confidence::Unknown
            } else {
                Confidence::Ok
            },
            expected: None,
            observed: Some(observed.to_string()),
            hint: None,
        };
    };

    match compare_versions(observed, minimum) {
        Some(std::cmp::Ordering::Less) => CheckResult {
            key,
            label,
            confidence: Confidence::Fail,
            expected: Some(format!("≥ {minimum}")),
            observed: Some(observed.to_string()),
            hint: Some(format!("版本过旧，建议升级到 {minimum} 或更高。")),
        },
        Some(_) => CheckResult {
            key,
            label,
            confidence: Confidence::Ok,
            expected: Some(format!("≥ {minimum}")),
            observed: Some(observed.to_string()),
            hint: None,
        },
        None => CheckResult {
            key,
            label,
            confidence: Confidence::Unknown,
            expected: Some(format!("≥ {minimum}")),
            observed: Some(observed.to_string()),
            hint: Some("版本号格式无法解析，请手动确认。".into()),
        },
    }
}

/// Verifies every program in the plan.
///
/// Reads the *inventory* directly rather than the flattened view, so all three
/// checks can be backed by the same merged evidence the student was shown on the
/// software screen. A verification that disagreed with the status page would be
/// worse than no verification.
pub fn verify_plan(plan: &InstallPlan, scan: &SoftwareScan) -> VerificationReport {
    let packages: Vec<PackageVerification> = plan
        .steps
        .iter()
        .map(|step| {
            let detected = scan.find(step.id);
            verify_package(step.id, detected)
        })
        .collect();

    let passed_count = packages.iter().filter(|p| p.passed).count() as u32;
    let failed_count = packages.len() as u32 - passed_count;

    VerificationReport {
        overall_ok: failed_count == 0 && !packages.is_empty(),
        packages,
        passed_count,
        failed_count,
    }
}

/// Renders the human-readable `Setup Center Report` required by the brief.
pub fn render_text_report(report: &SetupReport) -> String {
    let mut out = String::new();
    out.push_str("Setup Center Report\n");
    out.push_str("===================\n\n");
    out.push_str(&format!("生成时间: {}\n", report.generated_at));
    out.push_str(&format!("程序版本: {}\n", report.app_version));
    out.push_str(&format!(
        "安装方案: {} ({})\n\n",
        report.profile_name, report.profile_id
    ));

    out.push_str("环境检测:\n");
    for signal in &report.environment.signals {
        let mark = match signal.confidence {
            Confidence::Ok => "[OK]  ",
            Confidence::Fail => "[FAIL]",
            Confidence::Unknown => "[??]  ",
            Confidence::Skipped => "[-]   ",
        };
        out.push_str(&format!(
            "  {mark} {:<12} {}\n",
            signal.label, signal.value
        ));
    }
    out.push_str(&format!("  环境评分: {}%\n\n", report.environment_score));

    out.push_str("安装结果:\n");
    for package in &report.verification.packages {
        let status = if package.passed { "installed" } else { "FAILED" };
        out.push_str(&format!("  {pal:<16} {status}\n", pal = package.name));
        for check in [&package.present, &package.on_path, &package.version] {
            let mark = match check.confidence {
                Confidence::Ok => "ok",
                Confidence::Fail => "fail",
                Confidence::Unknown => "unknown",
                Confidence::Skipped => "skipped",
            };
            out.push_str(&format!(
                "      - {:<10} {:<8} {}\n",
                check.label,
                mark,
                check.observed.clone().unwrap_or_default()
            ));
        }
    }
    out.push('\n');

    out.push_str(&format!(
        "Environment: {}\n",
        if report.verification.overall_ok {
            "OK"
        } else {
            "INCOMPLETE"
        }
    ));
    out.push_str(&format!(
        "通过 {}/{} 项\n",
        report.verification.passed_count,
        report.verification.passed_count + report.verification.failed_count
    ));

    if !report.not_attempted.is_empty() {
        out.push_str("\n本次未做（明确说明）:\n");
        for item in &report.not_attempted {
            out.push_str(&format!("  - {item}\n"));
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detected(version: Option<&str>, on_path: bool) -> SoftwareInfo {
        SoftwareInfo {
            id: SoftwareId::Git,
            name: "Git".into(),
            installed: true,
            version: version.map(str::to_string),
            path: Some("C:\\Git\\cmd\\git.exe".into()),
            on_path,
            confidence: Confidence::Ok,
            package_id: Some("Git.Git".into()),
            sources: vec![ProbeSource::Path],
            evidence: vec![],
            hints: vec![],
            availability: None,
        }
    }

    /// The state a failed registry+winget probe leaves behind: not found, but
    /// nothing positively ruled it out.
    fn uncheckable() -> SoftwareInfo {
        SoftwareInfo {
            id: SoftwareId::Git,
            name: "Git".into(),
            installed: false,
            version: None,
            path: None,
            on_path: false,
            confidence: Confidence::Unknown,
            package_id: None,
            sources: vec![],
            evidence: vec![EvidenceView {
                source: ProbeSource::Winget,
                outcome: "unavailable".into(),
                detail: Some("无法运行 winget".into()),
            }],
            hints: vec![],
            availability: None,
        }
    }

    #[test]
    fn missing_program_fails_present_check() {
        let v = verify_package(SoftwareId::Git, None);
        assert_eq!(v.present.confidence, Confidence::Fail);
        assert_eq!(v.on_path.confidence, Confidence::Skipped);
        assert!(!v.passed);
    }

    #[test]
    fn uncheckable_program_is_never_reported_as_missing() {
        // The single most damaging bug this module could have: turning "the
        // probes could not run" into "Git is not installed", which sends the
        // student off to reinstall software they already have.
        let item = uncheckable();
        let v = verify_package(SoftwareId::Git, Some(&item));
        assert_eq!(v.present.confidence, Confidence::Unknown);
        assert_ne!(v.present.confidence, Confidence::Fail);
        assert!(v.present.hint.as_deref().unwrap().contains("这不是「未安装」"));
    }

    #[test]
    fn not_on_path_fails_even_when_installed() {
        let item = detected(Some("2.45.0"), false);
        let v = verify_package(SoftwareId::Git, Some(&item));
        assert_eq!(v.present.confidence, Confidence::Ok);
        assert_eq!(v.on_path.confidence, Confidence::Fail);
        assert!(!v.passed);
    }

    #[test]
    fn healthy_install_passes_all_three() {
        let item = detected(Some("2.45.0"), true);
        let v = verify_package(SoftwareId::Git, Some(&item));
        assert!(v.passed);
        assert_eq!(v.version.confidence, Confidence::Ok);
    }

    #[test]
    fn old_version_is_a_real_failure() {
        let item = detected(Some("2.20.0"), true);
        let v = verify_package(SoftwareId::Git, Some(&item));
        assert_eq!(v.version.confidence, Confidence::Fail);
        assert!(!v.passed, "an outdated tool must not be reported as verified");
    }

    #[test]
    fn unparsable_version_is_unknown_not_failure() {
        let item = detected(Some("unknown-build"), true);
        let v = verify_package(SoftwareId::Git, Some(&item));
        assert_eq!(v.version.confidence, Confidence::Unknown);
        assert!(v.passed, "unknown version should not block the user");
    }

    #[test]
    fn version_comparison_handles_suffixes_and_prefixes() {
        assert_eq!(
            compare_versions("2.45.0.windows.1", "2.30"),
            Some(std::cmp::Ordering::Greater)
        );
        assert_eq!(
            compare_versions("v1.9.0", "1.10"),
            Some(std::cmp::Ordering::Less),
            "1.9 must sort below 1.10"
        );
        assert_eq!(
            compare_versions("3.12", "3.12.0"),
            Some(std::cmp::Ordering::Equal),
            "trailing zeros are not significant"
        );
        assert_eq!(compare_versions("junk", "1.0"), None);
    }

    #[test]
    fn text_report_contains_required_sections() {
        let plan = InstallPlan {
            profile_id: "coder".into(),
            steps: vec![],
            ready_count: 0,
            satisfied_count: 0,
            estimated_minutes: Some(10),
        };
        let mut env = crate::modules::detect::detect(500).unwrap();
        env.recalculate();
        let report = SetupReport {
            generated_at: "2024-01-01T00:00:00Z".into(),
            app_version: "0.1.0".into(),
            profile_id: "coder".into(),
            profile_name: "AI 编程".into(),
            environment_score: env.score,
            environment: env,
            plan,
            verification: VerificationReport {
                packages: vec![],
                passed_count: 0,
                failed_count: 0,
                overall_ok: false,
            },
            config_actions: vec![],
            not_attempted: vec!["MCP 安装".into()],
        };
        let text = render_text_report(&report);
        assert!(text.contains("Setup Center Report"));
        assert!(text.contains("环境评分"));
        assert!(text.contains("MCP 安装"));
    }
}
