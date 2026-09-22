//! 插件模块的单元测试 — 锁**契约**，不重复 `compat.rs` 已覆盖的判定逻辑。
//!
//! 三件事只有测试能守住：
//!
//! 1. **serde 取值 ↔ `src/lib/types.ts` 的镜像**。前端手写了同名联合类型，
//!    Rust 这边改了 casing 而 TS 没改，类型检查不会有任何反应，只有运行时
//!    静默失配 —— `Entitlements.state` 的大小写事故（见 types.ts 注释）就是
//!    这么发生并长期存活的。
//! 2. **目录加载的容错**：坏 manifest 被跳过而非吞掉整个目录、缺席目录是
//!    空目录而非错误、输出顺序不依赖文件系统枚举顺序。
//! 3. **一份真实 manifest 能完整落到 `PluginEntry` 每个字段**（camelCase 映射
//!    + `serde(default)` 的可选字段）。

use super::*;
use serde_json::json;

// ---------------------------------------------------------------------------
// serde 取值契约（镜像 types.ts）
// ---------------------------------------------------------------------------

#[test]
fn plugin_target_is_kebab_case_while_every_other_enum_is_camel_case() {
    // `PluginTarget` 自带 `rename_all = "kebab-case"` —— 与模块内所有其他
    // 枚举不对称，正是 types.ts 专门注释警告的那个点。
    assert_eq!(serde_json::to_value(PluginTarget::ClaudeDesktop).unwrap(), "claude-desktop");
    assert_eq!(serde_json::to_value(PluginTarget::ClaudeCode).unwrap(), "claude-code");
    assert_eq!(serde_json::to_value(PluginTarget::Both).unwrap(), "both");
}

#[test]
fn compat_status_values_match_the_typescript_union() {
    for (v, expected) in [
        (CompatStatus::Verified, "verified"),
        (CompatStatus::Unverified, "unverified"),
        (CompatStatus::Incompatible, "incompatible"),
        (CompatStatus::TargetMissing, "targetMissing"),
        (CompatStatus::UnknownVersion, "unknownVersion"),
    ] {
        assert_eq!(serde_json::to_value(v).unwrap(), expected);
    }
}

#[test]
fn remaining_enum_values_match_the_typescript_unions() {
    for (value, expected) in [
        (serde_json::to_value(RiskLevel::Low).unwrap(), "low"),
        (serde_json::to_value(RiskLevel::Medium).unwrap(), "medium"),
        (serde_json::to_value(RiskLevel::High).unwrap(), "high"),
        (serde_json::to_value(EvidenceStage::SourceFound).unwrap(), "sourceFound"),
        (serde_json::to_value(EvidenceStage::Implemented).unwrap(), "implemented"),
        (serde_json::to_value(EvidenceStage::Tested).unwrap(), "tested"),
        (serde_json::to_value(EvidenceStage::RealWorldVerified).unwrap(), "realWorldVerified"),
        (serde_json::to_value(CodeLayer::Plugin).unwrap(), "plugin"),
        (serde_json::to_value(CodeLayer::Hook).unwrap(), "hook"),
        (serde_json::to_value(CodeLayer::Config).unwrap(), "config"),
        (serde_json::to_value(CodeLayer::CliPatch).unwrap(), "cliPatch"),
        (serde_json::to_value(RunMode::DryRun).unwrap(), "dryRun"),
        (serde_json::to_value(RunMode::Install).unwrap(), "install"),
        (serde_json::to_value(RunMode::Verify).unwrap(), "verify"),
        (serde_json::to_value(RunMode::Rollback).unwrap(), "rollback"),
        (serde_json::to_value(RunStatus::Succeeded).unwrap(), "succeeded"),
        (serde_json::to_value(RunStatus::Refused).unwrap(), "refused"),
        (serde_json::to_value(RunStatus::Failed).unwrap(), "failed"),
    ] {
        assert_eq!(value, expected);
    }
}

#[test]
fn stage_outcome_constructors_write_the_four_documented_statuses() {
    assert_eq!(StageOutcome::ok("k", "l", "d").status, "ok");
    assert_eq!(StageOutcome::warn("k", "l", "d").status, "warn");
    assert_eq!(StageOutcome::fail("k", "l", "d").status, "fail");
    assert_eq!(StageOutcome::skipped("k", "l", "d").status, "skipped");
    // detail 接受 &str（`impl Into<String>`），四个构造器行为一致。
    assert_eq!(StageOutcome::ok("k", "l", String::from("d")).detail, "d");
}

/// 一份完整条目，测试共用。
fn entry() -> PluginEntry {
    PluginEntry {
        id: "claude-code-zh-cn".into(),
        name: "Claude Code 中文界面".into(),
        description: "将 Claude Code 的界面切换为简体中文。".into(),
        target: PluginTarget::ClaudeCode,
        category: "界面".into(),
        author: "KongBai1145".into(),
        source: "https://github.com/KongBai1145/claude-code-zh-cn".into(),
        license: "MIT".into(),
        version: "2.5.0".into(),
        compatibility: CompatRange::default(),
        install_method: "写入 ~/.claude 用户配置".into(),
        requires_admin: false,
        risk_level: RiskLevel::Low,
        backup_required: true,
        rollback_supported: true,
        verify_supported: true,
        free: true,
        modifies: vec!["~/.claude".into()],
        requires: vec!["Claude Code 已安装".into()],
        evidence: EvidenceStage::Implemented,
        layers: vec![CodeLayer::Plugin],
        upstream_note: String::new(),
        installer: "claude-code-layers".into(),
    }
}

fn run_of(modified: Vec<String>) -> PluginRun {
    PluginRun {
        plugin_id: "demo".into(),
        mode: RunMode::Install,
        status: RunStatus::Succeeded,
        reason: "已安装".into(),
        stages: vec![StageOutcome::ok("apply", "安装插件", "ok")],
        modified,
        backup: None,
        restored: false,
        offer_retry: false,
    }
}

#[test]
fn plugin_view_flattens_the_entry_because_typescript_reads_it_flat() {
    let view = PluginView {
        entry: entry(),
        resolved_target: PluginTarget::ClaudeCode,
        compat: CompatStatus::Verified,
        compat_reason: "在上游已验证清单内".into(),
        target_installed: true,
        target_version: Some("2.1.153".into()),
        active: false,
        installed_for_version: None,
        stale: false,
        blocked_reason: None,
        backup: None,
        layer_notes: vec![(CodeLayer::Plugin, true, "只写用户配置".into())],
    };
    let v = serde_json::to_value(&view).unwrap();

    // `#[serde(flatten)]`：entry 的字段必须出现在顶层。TS 侧是
    // `PluginEntry & { ... }`，若哪天改成嵌套对象，这条会先红。
    assert_eq!(v["id"], json!("claude-code-zh-cn"));
    assert_eq!(v["installMethod"], json!("写入 ~/.claude 用户配置"));
    assert!(v.get("entry").is_none(), "entry 不应作为嵌套键出现");

    // 视图自身的字段名逐个对上 types.ts。
    for key in [
        "resolvedTarget",
        "compat",
        "compatReason",
        "targetInstalled",
        "targetVersion",
        "active",
        "installedForVersion",
        "stale",
        "blockedReason",
        "backup",
        "layerNotes",
    ] {
        assert!(v.get(key).is_some(), "PluginView 缺少字段 {key}");
    }
    assert_eq!(v["resolvedTarget"], json!("claude-code"));
    assert_eq!(v["compat"], json!("verified"));
    assert_eq!(v["targetVersion"], json!("2.1.153"));

    // tuple vec 序列化为定长数组的数组 —— TS 侧 `[CodeLayer, boolean, string][]`。
    assert_eq!(v["layerNotes"], json!([["plugin", true, "只写用户配置"]]));
}

#[test]
fn plugin_run_and_target_state_field_names_match_the_typescript_interfaces() {
    let v = serde_json::to_value(run_of(vec![])).unwrap();
    for key in [
        "pluginId",
        "mode",
        "status",
        "reason",
        "stages",
        "modified",
        "backup",
        "restored",
        "offerRetry",
    ] {
        assert!(v.get(key).is_some(), "PluginRun 缺少字段 {key}");
    }

    let t = TargetState {
        target: PluginTarget::ClaudeDesktop,
        installed: true,
        version: Some("2.2553.1".into()),
        root: None,
        running: false,
        localized: false,
        note: None,
    };
    let v = serde_json::to_value(&t).unwrap();
    assert_eq!(v["target"], json!("claude-desktop"));
    assert_eq!(v["installed"], json!(true));
    assert_eq!(v["root"], serde_json::Value::Null, "Option::None 必须是 null 而非缺键");
}

#[test]
fn untouched_means_nothing_was_ever_written() {
    // brief 第十三条"原 Claude 未受影响"的判据完全由数据得出。
    assert!(run_of(vec![]).untouched());
    assert!(!run_of(vec!["C:\\x\\app.asar".into()]).untouched());
}

// ---------------------------------------------------------------------------
// 目录加载
// ---------------------------------------------------------------------------

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("sc-plugin-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create scratch dir");
    dir
}

#[test]
fn missing_directory_is_an_empty_catalog_not_an_error() {
    let absent = std::env::temp_dir().join(format!("sc-plugin-absent-{}", std::process::id()));
    let catalog = PluginCatalog::load(&absent);
    assert!(catalog.entries.is_empty());
    assert!(catalog.get("anything").is_none());
}

#[test]
fn one_bad_manifest_does_not_hide_the_rest() {
    let dir = scratch("mixed");
    std::fs::write(dir.join("good.json"), serde_json::to_string(&entry()).unwrap()).unwrap();
    std::fs::write(dir.join("broken.json"), "{ not json").unwrap();
    // 形状不对（缺必填字段）也必须被跳过，而不是让整个目录消失。
    std::fs::write(dir.join("wrong-shape.json"), r#"{"id":"x"}"#).unwrap();
    std::fs::write(dir.join("ignored.txt"), "not a manifest").unwrap();

    let catalog = PluginCatalog::load(&dir);
    assert_eq!(catalog.entries.len(), 1, "坏数据被跳过，好数据必须存活");
    assert!(catalog.get("claude-code-zh-cn").is_some());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn catalogue_order_is_sorted_not_filesystem_order() {
    let dir = scratch("sort");
    let mut zeta = entry();
    zeta.id = "zeta".into();
    zeta.category = "界面".into();
    let mut alpha = entry();
    alpha.id = "alpha".into();
    alpha.category = "界面".into();
    let mut agent = entry();
    agent.id = "any".into();
    agent.category = "Agent".into();

    for e in [&zeta, &alpha, &agent] {
        std::fs::write(dir.join(format!("{}.json", e.id)), serde_json::to_string(e).unwrap())
            .unwrap();
    }

    let catalog = PluginCatalog::load(&dir);
    let order: Vec<&str> = catalog.entries.iter().map(|e| e.id.as_str()).collect();
    // 排序键是 (category, id)：ASCII 的 "Agent" 先于中文分类，同分类内按 id。
    assert_eq!(order, vec!["any", "alpha", "zeta"]);

    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// manifest → PluginEntry 映射
// ---------------------------------------------------------------------------

#[test]
fn a_manifest_maps_every_field_across_camel_case() {
    // 与 `plugins/claude-code-zh-cn.json` 同构的完整样本：target 是 kebab，
    // 其余键是 camelCase，两者都在这一条里被走到。
    let text = r#"{
        "id": "demo",
        "name": "Demo",
        "description": "d",
        "target": "claude-code",
        "category": "界面",
        "author": "a",
        "source": "https://github.com/x/y",
        "license": "MIT",
        "version": "1.0.0",
        "compatibility": { "desktop": [], "codeStable": ["2.1.92"], "codeExperimental": [], "note": "n" },
        "installMethod": "m",
        "requiresAdmin": false,
        "riskLevel": "high",
        "backupRequired": true,
        "rollbackSupported": true,
        "verifySupported": true,
        "free": true,
        "modifies": ["x"],
        "requires": ["Claude Code 已安装"],
        "evidence": "sourceFound",
        "layers": ["plugin", "hook"],
        "upstreamNote": "u",
        "installer": "claude-code-layers"
    }"#;

    let e: PluginEntry = serde_json::from_str(text).expect("完整 manifest 必须能解析");
    assert_eq!(e.target, PluginTarget::ClaudeCode);
    assert_eq!(e.risk_level, RiskLevel::High);
    assert_eq!(e.evidence, EvidenceStage::SourceFound);
    assert_eq!(e.layers, vec![CodeLayer::Plugin, CodeLayer::Hook]);
    assert_eq!(e.install_method, "m");
    assert!(!e.requires_admin);
    assert_eq!(e.compatibility.code_stable, vec!["2.1.92".to_string()]);
    assert_eq!(e.requires, vec!["Claude Code 已安装".to_string()]);
    assert!(e.free);
}

#[test]
fn optional_manifest_fields_default_instead_of_rejecting_the_row() {
    // 加插件是加一个 JSON 文件，`upstreamNote` / `requires` / `layers` 缺席
    // 不该要求同时改 Rust —— `#[serde(default)]` 必须真的生效。
    let text = r#"{
        "id": "minimal", "name": "n", "description": "d",
        "target": "claude-desktop", "category": "效率", "author": "a",
        "source": "https://github.com/x/y", "license": "MIT", "version": "1",
        "compatibility": { "desktop": [], "codeStable": [], "codeExperimental": [], "note": "" },
        "installMethod": "m", "requiresAdmin": true, "riskLevel": "medium",
        "backupRequired": false, "rollbackSupported": false, "verifySupported": false,
        "free": true, "modifies": [], "evidence": "tested",
        "installer": "external-windows-bat"
    }"#;

    let e: PluginEntry = serde_json::from_str(text).expect("可选字段缺席必须能解析");
    assert_eq!(e.target, PluginTarget::ClaudeDesktop);
    assert!(e.upstream_note.is_empty());
    assert!(e.requires.is_empty());
    assert!(e.layers.is_empty());
    assert!(e.requires_admin);
}

#[test]
fn state_lookup_is_by_plugin_id() {
    let records = vec![
        InstalledRecord {
            plugin_id: "a".into(),
            target: PluginTarget::ClaudeCode,
            claude_version: "2.1.153".into(),
            installed_at: "2026-09-13T00:00:00Z".into(),
            backup: None,
            modified: vec![],
            layers: vec![],
        },
        InstalledRecord {
            plugin_id: "b".into(),
            target: PluginTarget::ClaudeDesktop,
            claude_version: "2.2553.1".into(),
            installed_at: "2026-09-13T00:00:00Z".into(),
            backup: None,
            modified: vec![],
            layers: vec![],
        },
    ];
    assert!(state_for(&records, "a").is_some());
    assert!(state_for(&records, "b").is_some());
    assert!(state_for(&records, "missing").is_none());
}

#[test]
fn data_roots_share_the_license_directory() {
    // 备份与授权文件同根：用户只需记住一个位置。
    let root = data_root();
    assert!(root.ends_with("Setup Center"), "{}", root.display());
    assert_eq!(backup_root(), root.join("plugin-backups"));
    assert_eq!(state_path(), root.join("plugin-state.json"));
}
