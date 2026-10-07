//! 插件安装管线 —— 可观察的七段流程，以及"没动过就别说动过"的判据。
//!
//! ## 流程即数据
//!
//! brief 第四条要求安装不是黑盒。这里每一步都产出一条 [`StageOutcome`]，
//! UI 直接渲染它，因此**展示的进度就是实际发生的进度**，不存在一条独立的、
//! 可能与真实行为脱节的假进度条。键名 `detect` / `version` / `compat` /
//! `conflict` / `source` / `backup` / `apply` / `verify` 是 UI 的 testid 契约。
//!
//! ## 三条不可协商的安全规则
//!
//! 1. **未验证版本默认阻断** —— [`CompatStatus::allows_install`] 为 `false` 时，
//!    没有 `allow_unverified` 就停在 `compat` 段，一行字节都不写。
//! 2. **备份失败就不安装** —— `backup` 段失败会立刻返回 `RunStatus::Refused`。
//!    没有备份的 patch 失败 = 用户的 Claude 打不开且无法自救，正是 brief 第五条
//!    要避免的那个结局。
//! 3. **目标正被占用就不碰** —— Desktop 的 `app.asar` 被运行中的进程锁住，
//!    强行写入要么失败、要么写进一半。`conflict` 段拦在这里。
//!
//! ## `untouched()` 为什么是数据推导出来的
//!
//! brief 第十三条要求失败时能说"原 Claude 未受影响"。这句话只有在 `modified`
//! 为空时才为真，所以它由 [`PluginRun::untouched`] 从数据计算，**不是 UI 上的一
//! 段文案**。拒绝发生在任何写入之前，`modified` 必然为空，这句话因此永远诚实。

use super::compat;
use super::probe;
use super::{
    backup_root, data_root, read_state, state_for, write_state, CodeLayer, InstalledRecord,
    PluginCatalog, PluginEntry, PluginRun, PluginTarget, RunMode, RunStatus, StageOutcome,
    TargetState,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// 一次运行的可选闸门。
#[derive(Debug, Clone, Default)]
pub struct RunOptions {
    /// 显式放行未验证版本。**默认 `false`** —— 放行必须是用户的一次有意识点击。
    pub allow_unverified: bool,
    /// Claude Code 要安装的层；`None` = 按插件声明的全部低风险层（1–3）。
    pub layers: Option<Vec<CodeLayer>>,
    /// 上游源码所在目录（含 `LICENSE` 与安装入口）。
    /// `None` 时按 [`source_root`] 查找。放在这里是为了让测试注入临时目录。
    pub source: Option<PathBuf>,
}

/// 上游源码缓存根。
///
/// **我们的仓库里不含任何上游源码** —— 这是刻意的：brief 说"能作为外部安装器
/// 调用就不要擅自复制源码"。上游以 MIT 分发，我们仍然只在安装时**校验许可证
/// 后调用它**，而不是把它 vendor 进版本库。这样上游更新时我们不会落后，也不会
/// 在没读过新 LICENSE 的情况下分发别人的新代码。
pub fn source_root() -> PathBuf {
    data_root().join("plugin-sources")
}

/// 上游源码的约定布局：`plugin-sources/<仓库名>/`。
fn staged_source(entry: &PluginEntry, opts: &RunOptions) -> PathBuf {
    if let Some(s) = &opts.source {
        return s.clone();
    }
    let name = entry
        .source
        .rsplit('/')
        .next()
        .unwrap_or(entry.id.as_str());
    source_root().join(name)
}

use serde::{Deserialize, Serialize};

/// Allowed root directories for plugin operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginRootId {
    DesktopResources,
    ClaudeHome,
    PluginCache,
}

pub fn resolve_plugin_root(root_id: PluginRootId, version: Option<&str>) -> Option<PathBuf> {
    match root_id {
        PluginRootId::DesktopResources => active_desktop_resources(version),
        PluginRootId::ClaudeHome => claude_home(),
        PluginRootId::PluginCache => claude_home().map(|h| h.join("plugins").join("cache")),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ManifestEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntryV2 {
    pub root_id: PluginRootId,
    pub relative_path: String,
    pub kind: ManifestEntryKind,
    pub existed_before: bool,
    pub backup_file_or_dir: Option<String>,
    pub applied: bool,
    pub restored: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionManifestV2 {
    pub version: u32,
    pub transaction_id: String,
    pub plugin_id: String,
    pub target: PluginTarget,
    pub claude_version: Option<String>,
    pub created_at: String,
    pub entries: Vec<ManifestEntryV2>,
}

pub fn tx_backup_dir_for(entry: &PluginEntry, tx_id: &str) -> PathBuf {
    backup_root().join(&entry.id).join(tx_id)
}

fn generate_tx_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    format!("tx-{now}-{pid}")
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/// 跑一遍完整管线，返回带阶段记录的结果。
///
/// `DryRun` 与 `Install` 走**同一条代码路径**，只在 `apply` 段分叉 —— 这样
/// "预览"就不是另一套逻辑的产物，而是同一条链在写入前停下。预览漏报的风险
/// 因此等于安装时的实测风险，而不是一个独立的、可能与现实脱节的猜测。
pub fn run(entry: &PluginEntry, mode: RunMode, opts: &RunOptions) -> PluginRun {
    let mut stages: Vec<StageOutcome> = Vec::new();
    let mut modified: Vec<String> = Vec::new();
    let target = resolve_target(entry);
    let dry = matches!(mode, RunMode::DryRun);

    // --- 1. detect -------------------------------------------------------
    let state = probe::probe(target).into_iter().next().unwrap_or_else(|| {
        TargetState {
            target,
            installed: false,
            version: None,
            root: None,
            running: false,
            localized: false,
            note: Some("探测无结果".into()),
        }
    });
    let _ = &stages;
    stages.push(if state.installed {
        StageOutcome::ok(
            "detect",
            "检测 Claude",
            format!(
                "{} 已安装{}",
                target.label(),
                state
                    .root
                    .as_deref()
                    .map(|r| format!("（{r}）"))
                    .unwrap_or_default()
            ),
        )
    } else {
        StageOutcome::fail(
            "detect",
            "检测 Claude",
            state.note.clone().unwrap_or_else(|| "未安装".into()),
        )
    });
    if !state.installed {
        return refuse(entry, mode, stages, modified, target, "目标未安装");
    }

    // --- 2. version ------------------------------------------------------
    let version = state.version.clone();
    stages.push(match &version {
        Some(v) => StageOutcome::ok("version", "检测版本", format!("当前版本 {v}")),
        None => StageOutcome::warn(
            "version",
            "检测版本",
            state.note.clone().unwrap_or_else(|| "版本无法读取".into()),
        ),
    });

    // --- 接管（Adopt）：把"别人装好的汉化"登记成我们的状态 ----------------
    // 只做两件事：复用 verify() 判定既有状态、写一条状态记录。**跳过
    // compat / source / backup / apply 全部写入段** —— 它不改 Claude 任何
    // 文件、不弹 UAC、不执行上游脚本，所以也不该被"版本未验证"这类面向
    // 补丁的闸拦住（那个闸保护的是别人的目标文件）。
    if mode == RunMode::Adopt {
        let v = verify(entry, target, version.as_deref());
        let passed = v.status == "ok";
        stages.push(v);
        if !passed {
            return refuse(
                entry,
                mode,
                stages,
                modified,
                target,
                "未检测到可接管的汉化状态（验证未通过），未写入任何记录。",
            );
        }
        if let Err(e) = record(entry, target, version.as_deref(), None, &[], &default_layers(entry), None) {
            stages.push(StageOutcome::fail("adopt", "接管登记", e.clone()));
            return refuse(entry, mode, stages, modified, target, &e);
        }
        stages.push(StageOutcome::ok(
            "adopt",
            "接管登记",
            "已登记现有汉化状态；本次未修改任何 Claude 文件。",
        ));
        return PluginRun {
            plugin_id: entry.id.clone(),
            mode,
            status: RunStatus::Succeeded,
            reason: "已接管现有安装：仅登记状态，可在卡片上使用「验证」。".into(),
            stages,
            modified,
            backup: existing_backup(entry, target, version.as_deref()),
            restored: false,
            offer_retry: false,
            transaction_id: None,
        };
    }

    // --- 3. compat -------------------------------------------------------
    let (compat_status, compat_reason) =
        compat::evaluate(entry.range_for(target), target, state.installed, version.as_deref());
    stages.push(if compat_status.allows_install() {
        StageOutcome::ok("compat", "检测兼容性", compat_reason.clone())
    } else {
        StageOutcome::warn("compat", "检测兼容性", compat_reason.clone())
    });

    // 未验证 → **只拦要写入的安装**。这是全管线唯一一处"不写任何字节就返回"
    // 的硬闸（brief 第六条：未验证版本绝不直接强制 patch），所以它的射程也
    // 必须只覆盖写入：预览 / 验证 / 回滚不改目标文件（回滚还是恢复自己的
    // 备份），拦它们只会让已放行安装的用户既验不了也回不去。真机实测：本机
    // Claude Code 2.1.278 高于上游冻结的 2.1.153、Desktop 上游干脆不发布
    // 版本清单 —— 旧闸（拒绝一切非 Install 模式）让"验证"按钮在几乎所有
    // 真实机器上必然拒绝，免费服务的验证功能形同虚设。compat 的 warn 阶段
    // 已在上面无条件推送，未验证的事实用户始终看得见。
    if mode == RunMode::Install && !compat_status.allows_install() && !opts.allow_unverified {
        stages.push(StageOutcome::skipped(
            "conflict",
            "检查冲突",
            "兼容性未通过，未进入后续阶段。",
        ));
        return refuse(entry, mode, stages, modified, target, "版本未验证");
    }

    // --- 4. conflict -----------------------------------------------------
    if let Some(blocker) = conflict(entry, target, &state, mode) {
        stages.push(StageOutcome::fail("conflict", "检查冲突", blocker.clone()));
        return refuse(entry, mode, stages, modified, target, &blocker);
    }
    stages.push(StageOutcome::ok("conflict", "检查冲突", "无冲突"));

    // --- 5. source -------------------------------------------------------
    let src = staged_source(entry, opts);
    match check_source(&src) {
        Ok(note) => stages.push(StageOutcome::ok("source", "检查上游源码", note)),
        Err(why) => {
            stages.push(StageOutcome::fail("source", "检查上游源码", why.clone()));
            return refuse(entry, mode, stages, modified, target, &why);
        }
    }

    if dry || mode == RunMode::Verify {
        stages.push(StageOutcome::skipped(
            "backup",
            "备份",
            if dry { "预览模式，不写入。" } else { "验证模式，不写入。" },
        ));
        stages.push(StageOutcome::skipped(
            "apply",
            "安装",
            if dry { "预览模式，跳过安装。" } else { "验证模式，跳过安装。" },
        ));
        let verify = verify(entry, target, version.as_deref());
        stages.push(verify.clone());
        let status = if verify.status == "fail" { RunStatus::Refused } else { RunStatus::Succeeded };
        return PluginRun {
            plugin_id: entry.id.clone(),
            mode,
            status,
            reason: if status == RunStatus::Succeeded {
                "预览完成，未修改任何文件。".into()
            } else {
                "当前状态与预期不符。".into()
            },
            stages,
            modified,
            backup: existing_backup(entry, target, version.as_deref()),
            restored: false,
            offer_retry: true,
            transaction_id: None,
        };
    }

    if mode == RunMode::Rollback {
        return rollback(entry, target, stages, modified);
    }

    // --- 6. backup（失败即中止，绝不带伤安装）------------------------------
    let tx_id = generate_tx_id();
    let backup_dir = tx_backup_dir_for(entry, &tx_id);
    let mut manifest = match take_backup_v2(entry, target, &src, &backup_dir, version.as_deref(), &tx_id) {
        Ok(m) => {
            let count = m.entries.iter().filter(|e| e.existed_before).count();
            stages.push(StageOutcome::ok(
                "backup",
                "备份",
                format!("{} 个现有文件/目录已备份（事务 {}）→ {}", count, tx_id, backup_dir.display()),
            ));
            m
        }
        Err(why) => {
            stages.push(StageOutcome::fail("backup", "备份", why.clone()));
            return PluginRun {
                plugin_id: entry.id.clone(),
                mode,
                status: RunStatus::Refused,
                reason: format!("备份失败，已停止安装（{why}）。原文件未修改。"),
                stages,
                modified,
                backup: None,
                restored: false,
                offer_retry: true,
                transaction_id: Some(tx_id),
            };
        }
    };

    // --- 7. apply --------------------------------------------------------
    let layers = opts.layers.clone().unwrap_or_else(|| default_layers(entry));
    match apply(entry, target, &src, version.as_deref(), &layers, &mut manifest, &backup_dir) {
        Ok(written) => {
            stages.push(StageOutcome::ok(
                "apply",
                "安装插件",
                format!("已写入 {} 个位置", written.len()),
            ));
            modified.extend(written);
        }
        Err(why) => {
            stages.push(StageOutcome::fail("apply", "安装插件", why.clone()));
            // 安装失败 → 立即回滚，避免"汉化失败以后 Claude 也打不开"。
            let (restored, errs) = restore_v2(&backup_dir, version.as_deref());
            let status = if errs.is_empty() {
                stages.push(StageOutcome::ok(
                    "rollback",
                    "回滚",
                    if restored { "已恢复原始文件" } else { "无文件需要恢复" },
                ));
                RunStatus::Failed
            } else {
                stages.push(StageOutcome::fail(
                    "rollback",
                    "回滚",
                    format!("回滚未完全成功（{} 项错误）：{}", errs.len(), errs.join("; ")),
                ));
                RunStatus::RollbackPartial
            };
            return PluginRun {
                plugin_id: entry.id.clone(),
                mode,
                status,
                reason: format!("安装失败，已尝试回滚（{why}）。"),
                stages,
                modified: Vec::new(),
                backup: Some(backup_dir.display().to_string()),
                restored,
                offer_retry: true,
                transaction_id: Some(tx_id),
            };
        }
    }

    // --- 8. verify -------------------------------------------------------
    let v = verify(entry, target, version.as_deref());
    let ok = v.status == "ok";
    stages.push(v);

    if !ok {
        let (restored, errs) = restore_v2(&backup_dir, version.as_deref());
        let status = if errs.is_empty() {
            stages.push(StageOutcome::ok(
                "rollback",
                "回滚",
                if restored { "验证失败，已恢复原始文件" } else { "无文件需要恢复" },
            ));
            RunStatus::Failed
        } else {
            stages.push(StageOutcome::fail(
                "rollback",
                "回滚",
                format!("验证失败后回滚未完全成功（{} 项错误）：{}", errs.len(), errs.join("; ")),
            ));
            RunStatus::RollbackPartial
        };
        return PluginRun {
            plugin_id: entry.id.clone(),
            mode,
            status,
            reason: "安装后验证未通过，已回滚，原 Claude 未受影响。".into(),
            stages,
            modified: Vec::new(),
            backup: Some(backup_dir.display().to_string()),
            restored,
            offer_retry: true,
            transaction_id: Some(tx_id),
        };
    }

    // 记录"针对哪个版本安装"——第七条的版本漂移检测靠它。
    if let Err(e) = record(entry, target, version.as_deref(), Some(&backup_dir), &modified, &layers, Some(&tx_id)) {
        stages.push(StageOutcome::warn(
            "state",
            "记录状态",
            format!("安装成功但状态未写入：{e}。回滚入口可能丢失。"),
        ));
    }

    PluginRun {
        plugin_id: entry.id.clone(),
        mode,
        status: RunStatus::Succeeded,
        reason: "安装成功，已通过验证。".into(),
        stages,
        modified,
        backup: Some(backup_dir.display().to_string()),
        restored: false,
        offer_retry: false,
        transaction_id: Some(tx_id),
    }
}

// ---------------------------------------------------------------------------
// 各段实现
// ---------------------------------------------------------------------------

/// 把 `Both` 收敛到本机实际装了哪一个。
///
/// `Both` 是目录数据的表达（"这个插件两边都能用"），不是运行时的模糊状态。
/// 装了两个就返回 `ClaudeCode` 之外的 `ClaudeDesktop`……实际上：两个都装时按
/// Desktop 优先，因为它的补丁更重、更需要被看见。没装任何一个返回 Desktop，
/// 让 `detect` 段给出"未安装"而不是静默跳过。
fn resolve_target(entry: &PluginEntry) -> PluginTarget {
    match entry.target {
        PluginTarget::Both => {
            let d = probe::desktop().installed;
            let c = probe::code().installed;
            if d {
                PluginTarget::ClaudeDesktop
            } else if c {
                PluginTarget::ClaudeCode
            } else {
                PluginTarget::ClaudeDesktop
            }
        }
        t => t,
    }
}

/// 冲突检查。返回 `Some(原因)` 表示必须停。
fn conflict(entry: &PluginEntry, target: PluginTarget, state: &TargetState, mode: RunMode) -> Option<String> {
    if matches!(mode, RunMode::Verify | RunMode::DryRun) {
        return None;
    }
    if target == PluginTarget::ClaudeDesktop && state.running {
        // 运行中锁住 app.asar，强写会失败或写坏。
        return Some(
            "Claude Desktop 正在运行，其资源文件被占用。请先退出 Claude 再试。".into(),
        );
    }
    if entry.requires_admin && !is_elevated() {
        // 不直接失败：上游安装器自己会弹 UAC。这里只提示，由 `source` 段之后
        // 交由上游处理 —— 我们自己绝不静默提权。
        return None;
    }
    None
}

/// 上游源码是否就绪，且许可证是否是我们读过的那一个。
///
/// 校验 `LICENSE` 含 `MIT License` 是硬要求：我们会在安装时执行**别人的**脚本，
/// 那么在执行前确认我们读过它的许可证，是唯一能保证"集成方式正确"的时点。
/// 这也直接对应 brief 那句"必须确认许可证和允许的集成方式"。
fn check_source(dir: &Path) -> Result<String, String> {
    if !dir.exists() {
        return Err(format!(
            "上游安装器未就绪：找不到 {}。请先取得上游源码到该目录（我们的包不含上游源码）。",
            dir.display()
        ));
    }
    let license = ["LICENSE", "LICENSE.md", "LICENSE.txt"]
        .iter()
        .map(|n| dir.join(n))
        .find(|p| p.is_file())
        .ok_or_else(|| "上游目录缺少 LICENSE，拒绝执行未知许可证的代码。".to_string())?;
    let text = std::fs::read_to_string(&license).map_err(|e| format!("读取 LICENSE 失败：{e}"))?;
    if !text.contains("MIT License") {
        return Err(format!(
            "上游许可证为 {}，非 MIT，拒绝按当前集成方式执行。",
            license.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    Ok(format!("{}（MIT，已核对）", dir.display()))
}

/// Claude Desktop **实际生效**的 resources 目录。
///
/// Squirrel 有两种布局：经典布局把 `app.asar` 放根 `resources\`，更新布局放
/// `app-<版本>\resources\`（本机 2.2553.1 = `app-2.2553\resources\`，根
/// `resources\` 是**空的**）。probe 的 `is_localized` 早就做了这个回退，但
/// backup/verify 曾写死根目录 —— 在本机导致"备了空清单 + 验证必失败"。
/// 三处必须共用这一个判据，否则同一台机器上探测说"已汉化"、验证说"没生效"。
fn active_desktop_resources(version: Option<&str>) -> Option<PathBuf> {
    let root = claude_desktop_root()?;
    // 1. 经典布局：根 resources 自己就有 app.asar。
    let root_res = root.join("resources");
    if root_res.join("app.asar").is_file() {
        return Some(root_res);
    }
    // 2. Squirrel 布局：目录名与 claude.exe 的 ProductVersion 一致。
    if let Some(v) = version {
        let p = root.join(format!("app-{v}")).join("resources");
        if p.join("app.asar").is_file() {
            return Some(p);
        }
    }
    // 3. 版本读不到时：挑最新的、带 app.asar 的 app-*\resources。
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    if let Ok(rd) = std::fs::read_dir(&root) {
        for e in rd.flatten() {
            let p = e.path().join("resources");
            if p.join("app.asar").is_file() {
                let mt = e
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                if best.as_ref().map(|(t, _)| mt > *t).unwrap_or(true) {
                    best = Some((mt, p));
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

/// 上游 transcript 是否已出现成功句 `安装完成`。
///
/// ps1 用 `Start-Transcript` 把它写进 stage 根的 `install-windows.log`，
/// 只有 [8/8] 全部成功才会出现（失败走 catch → throw，不会有这句）。
/// 实测日志带 UTF-8 BOM（`EF BB BF`），先剥再匹配；读失败按"还没完成"处理，
/// 由轮询继续。
fn log_says_installed(p: &std::path::Path) -> bool {
    let Ok(bytes) = std::fs::read(p) else {
        return false;
    };
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    String::from_utf8_lossy(body).contains("安装完成")
}

fn plugin_source_version(src: &Path, entry: &PluginEntry) -> String {
    std::fs::read_to_string(src.join("plugin").join("manifest.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("version").and_then(|s| s.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| entry.version.clone())
}

pub fn save_manifest_v2(dest: &Path, manifest: &TransactionManifestV2) -> Result<(), String> {
    let manifest_path = dest.join("manifest.json");
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("序列化备份清单失败：{e}"))? + "\n";
    crate::modules::atomic_file::write_atomic(&manifest_path, json.as_bytes())
        .map_err(|e| format!("写入备份清单失败：{e}"))
}

pub fn take_backup_v2(
    entry: &PluginEntry,
    target: PluginTarget,
    src: &Path,
    dest: &Path,
    version: Option<&str>,
    tx_id: &str,
) -> Result<TransactionManifestV2, String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("创建备份目录失败：{e}"))?;

    let planned_entries: Vec<(PluginRootId, String, ManifestEntryKind)> = match (entry.installer.as_str(), target) {
        ("claude-code-layers", PluginTarget::ClaudeCode) => {
            let src_ver = plugin_source_version(src, entry);
            vec![
                (PluginRootId::ClaudeHome, "settings.json".into(), ManifestEntryKind::File),
                (PluginRootId::ClaudeHome, format!("plugins/{}", code_plugin_dir(entry)), ManifestEntryKind::Directory),
                (PluginRootId::ClaudeHome, "plugins/known_marketplaces.json".into(), ManifestEntryKind::File),
                (PluginRootId::ClaudeHome, "plugins/installed_plugins.json".into(), ManifestEntryKind::File),
                (PluginRootId::PluginCache, format!("{}/{}/{}", ZH_MARKETPLACE, entry.id, src_ver), ManifestEntryKind::Directory),
            ]
        }
        ("external-windows-bat", PluginTarget::ClaudeDesktop) => {
            vec![
                (PluginRootId::DesktopResources, "app.asar".into(), ManifestEntryKind::File),
                (PluginRootId::DesktopResources, "zh-CN.json".into(), ManifestEntryKind::File),
                (PluginRootId::DesktopResources, "en-US.json".into(), ManifestEntryKind::File),
                (PluginRootId::DesktopResources, ".zh-cn-backups".into(), ManifestEntryKind::Directory),
            ]
        }
        _ => Vec::new(),
    };

    let mut entries = Vec::new();

    for (i, (root_id, rel, kind)) in planned_entries.into_iter().enumerate() {
        let root = resolve_plugin_root(root_id, version)
            .ok_or_else(|| format!("无法定位根目录 {:?}", root_id))?;
        let abs_path = crate::modules::path_policy::resolve_under_root(&root, &rel)
            .map_err(|e| format!("路径校验失败 {} under {}: {}", rel, root.display(), e))?;

        let existed = abs_path.exists();
        let backup_sub = if existed {
            let backup_name = format!("{i:03}_{}", file_name(&abs_path));
            let to = dest.join(&backup_name);
            if kind == ManifestEntryKind::Directory {
                copy_dir(&abs_path, &to)?;
            } else {
                std::fs::copy(&abs_path, &to)
                    .map_err(|e| format!("备份文件 {} 失败：{e}", abs_path.display()))?;
            }
            Some(backup_name)
        } else {
            None
        };

        entries.push(ManifestEntryV2 {
            root_id,
            relative_path: rel,
            kind,
            existed_before: existed,
            backup_file_or_dir: backup_sub,
            applied: false,
            restored: false,
            error: None,
        });
    }

    let manifest = TransactionManifestV2 {
        version: 2,
        transaction_id: tx_id.to_string(),
        plugin_id: entry.id.clone(),
        target,
        claude_version: version.map(|v| v.to_string()),
        created_at: iso_now(),
        entries,
    };

    save_manifest_v2(dest, &manifest)?;
    Ok(manifest)
}

fn restore_directory_safe(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_dir() {
        return Err(format!("备份源不存在或非目录: {}", from.display()));
    }
    let parent = to.parent().ok_or_else(|| format!("无法确定目标父目录: {}", to.display()))?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建目标父目录失败 {}: {e}", parent.display()))?;

    let file_name = to.file_name().and_then(|n| n.to_str()).unwrap_or("dir");
    let nonce = format!("{}_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos(), std::process::id());
    let staging = parent.join(format!(".{file_name}.restore_staging_{nonce}"));

    // 1. 复制到同级准备目录
    if let Err(e) = copy_dir(from, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("复制备份到准备目录失败: {e}"));
    }

    // 2. 准备目录就绪后，如果有当前目录，先 rename 到唯一保留目录
    if to.exists() {
        let preserve = parent.join(format!(".{file_name}.restore_preserve_{nonce}"));
        if let Err(e) = std::fs::rename(to, &preserve) {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("保留当前目录失败: {e}"));
        }

        // 3. 将准备目录 rename 到目标
        if let Err(rename_err) = std::fs::rename(&staging, to) {
            // 第二次失败则把保留目录恢复原位
            if let Err(rollback_err) = std::fs::rename(&preserve, to) {
                // 回退也失败时保留所有文件并报告各路径，禁止删除保留目录
                return Err(format!(
                    "严重错误：还原准备目录失败 ({rename_err})，且回退保留目录失败 ({rollback_err})！原目录保留在 {}，准备目录保留在 {}",
                    preserve.display(),
                    staging.display()
                ));
            } else {
                let _ = std::fs::remove_dir_all(&staging);
                return Err(format!("替换目标目录失败，已回退恢复当前目录: {rename_err}"));
            }
        }
        // 当前数据保留目录本轮不自动递归删除（保护用户数据）
    } else {
        if let Err(e) = std::fs::rename(&staging, to) {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("移动准备目录到目标失败: {e}"));
        }
    }

    Ok(())
}

pub fn restore_v2(dest: &Path, _version: Option<&str>) -> (bool, Vec<String>) {
    let manifest_path = dest.join("manifest.json");
    let text = match std::fs::read_to_string(&manifest_path) {
        Ok(t) => t,
        Err(_) => return (false, vec!["manifest.json 不存在".into()]),
    };

    // 优先尝试 V2 事务清单格式
    if let Ok(mut manifest) = serde_json::from_str::<TransactionManifestV2>(&text) {
        // Pre-flight check: 确保每个安装前存在的文件/目录，其备份均完好存在、类型正确且能读取
        for entry in &manifest.entries {
            if entry.existed_before {
                if let Some(backup_sub) = &entry.backup_file_or_dir {
                    let from = dest.join(backup_sub);
                    if !from.exists() {
                        return (false, vec![format!("备份损坏或缺失，拒绝破坏性操作: {}", from.display())]);
                    }
                    if entry.kind == ManifestEntryKind::Directory {
                        if !from.is_dir() {
                            return (false, vec![format!("备份类型错误（非目录）: {}", from.display())]);
                        }
                        if std::fs::read_dir(&from).is_err() {
                            return (false, vec![format!("备份目录无法读取: {}", from.display())]);
                        }
                    } else {
                        if !from.is_file() {
                            return (false, vec![format!("备份类型错误（非文件）: {}", from.display())]);
                        }
                        if std::fs::File::open(&from).is_err() {
                            return (false, vec![format!("备份文件无法读取: {}", from.display())]);
                        }
                    }
                } else {
                    return (false, vec![format!("备份记录异常，存在标记但无备份文件: {}", entry.relative_path)]);
                }
            }
        }

        let mut errors = Vec::new();
        let backup_version = manifest.claude_version.as_deref();

        // 逆序回滚写入
        for entry in manifest.entries.iter_mut().rev() {
            if entry.root_id == PluginRootId::DesktopResources && backup_version.is_none() {
                let err = "备份清单缺少 claude_version 记录，无法确定原始目标版本目录".to_string();
                entry.error = Some(err.clone());
                errors.push(err);
                continue;
            }

            let root = match resolve_plugin_root(entry.root_id, backup_version) {
                Some(r) => r,
                None => {
                    let err = format!("无法定位根目录 {:?}（版本: {:?}）", entry.root_id, backup_version);
                    entry.error = Some(err.clone());
                    errors.push(err);
                    continue;
                }
            };

            let to = match crate::modules::path_policy::resolve_under_root(&root, &entry.relative_path) {
                Ok(p) => p,
                Err(e) => {
                    let err = format!("恢复路径安全校验失败 {}: {e}", entry.relative_path);
                    entry.error = Some(err.clone());
                    errors.push(err);
                    continue;
                }
            };

            if entry.existed_before {
                let from = dest.join(entry.backup_file_or_dir.as_ref().unwrap());
                let res = if entry.kind == ManifestEntryKind::Directory {
                    restore_directory_safe(&from, &to)
                } else {
                    if let Some(parent) = to.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    match std::fs::read(&from) {
                        Ok(bytes) => crate::modules::atomic_file::write_atomic(&to, &bytes)
                            .map_err(|e| format!("原子写入文件 {} 失败: {e}", to.display())),
                        Err(e) => Err(format!("读取备份文件 {} 失败: {e}", from.display())),
                    }
                };

                match res {
                    Ok(()) => {
                        entry.restored = true;
                        entry.error = None;
                    }
                    Err(e) => {
                        let err = format!("还原 {} 失败：{e}", to.display());
                        entry.error = Some(err.clone());
                        errors.push(err);
                    }
                }
            } else {
                // 原先不存在 -> 安全清理新生成的文件或目录
                if to.exists() {
                    let res = if entry.kind == ManifestEntryKind::Directory {
                        std::fs::remove_dir_all(&to).map_err(|e| e.to_string())
                    } else {
                        std::fs::remove_file(&to).map_err(|e| e.to_string())
                    };

                    match res {
                        Ok(()) => {
                            entry.restored = true;
                            entry.error = None;
                        }
                        Err(e) => {
                            let err = format!("清理新生成文件 {} 失败：{e}", to.display());
                            entry.error = Some(err.clone());
                            errors.push(err);
                        }
                    }
                } else {
                    entry.restored = true;
                    entry.error = None;
                }
            }
        }

        if let Err(e) = save_manifest_v2(dest, &manifest) {
            errors.push(format!("保存回滚记录清单失败: {e}"));
        }
        return (errors.is_empty(), errors);
    }

    // 兼容回退：Legacy V1 备份清单格式
    if let Ok(list) = serde_json::from_str::<Vec<Value>>(&text) {
        let mut any = false;
        let mut errors = Vec::new();
        for item in list {
            let (name, path) = match (item.get("name"), item.get("path")) {
                (Some(n), Some(p)) => (n.as_str().unwrap_or_default(), p.as_str().unwrap_or_default()),
                _ => continue,
            };
            if path.trim().is_empty() {
                errors.push(format!("Legacy 备份项缺少有效目标路径: {name}"));
                continue;
            }
            let from = dest.join(name);
            let to = PathBuf::from(path);
            if !from.exists() {
                errors.push(format!("Legacy 备份文件不存在: {}", from.display()));
                continue;
            }
            let res = if from.is_dir() {
                restore_directory_safe(&from, &to)
            } else {
                if let Some(parent) = to.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::read(&from) {
                    Ok(bytes) => crate::modules::atomic_file::write_atomic(&to, &bytes)
                        .map_err(|e| format!("Legacy 原子写入文件失败 {}: {e}", to.display())),
                    Err(e) => Err(format!("Legacy 读取备份文件失败 {}: {e}", from.display())),
                }
            };
            match res {
                Ok(()) => any = true,
                Err(e) => errors.push(e),
            }
        }
        return (any && errors.is_empty(), errors);
    }

    (false, vec!["未知的备份清单格式".into()])
}

pub fn restore(dest: &Path) -> bool {
    restore_v2(dest, None).0
}

/// 实际写入。**按 `installer` 分派，两条链共用一个入口但不共用任何一行逻辑。**
fn apply(
    entry: &PluginEntry,
    target: PluginTarget,
    src: &Path,
    version: Option<&str>,
    layers: &[CodeLayer],
    manifest: &mut TransactionManifestV2,
    dest: &Path,
) -> Result<Vec<String>, String> {
    match (entry.installer.as_str(), target) {
        // Desktop：我们**不自己实现补丁**。上游 16 万字节的 PowerShell 已经处理
        // 了 asar 解析、完整性哈希、进程互斥、版本漂移重新备份等一堆我们不该重造
        // 的细节。Setup Center 的职责是"安全地发现、备份、调用、验证、回滚"，
        // 不是把上游重写一遍。
        ("external-windows-bat", PluginTarget::ClaudeDesktop) => {
            let bat = src.join("install-windows.bat");
            if !bat.is_file() {
                return Err(format!("上游缺少 install-windows.bat：{}", src.display()));
            }
            // 上一次运行的 transcript 必须先删：否则它还含着旧的"安装完成"，
            // 新安装尚未跑完就会被轮询读到，形成假通过（stage 目录名是固定的）。
            let install_log = std::env::temp_dir()
                .join("ClaudeDesktopZhCnInstaller")
                .join("install-windows.log");
            let _ = std::fs::remove_file(&install_log);
            // 启动上游安装器：交互窗口与 UAC 都由上游脚本自己弹（`Start-Process
            // -Verb RunAs`），我们不静默提权 —— 这才是"不静默提权"的真实形态。
            // 旧行为是无条件 Err("请在授权窗口中完成")却从不打开任何窗口：文案承诺
            // 了一个不存在的窗口，用户只能对着空气等待。窗口必须由这一行真实打开。
            // 这里刻意**不加** CREATE_NO_WINDOW：交互式安装的进度窗口就是给用户看的。
            let mut child = Command::new("cmd")
                .arg("/C")
                .arg(&bat)
                .spawn()
                .map_err(|e| format!("启动上游安装器失败：{e}"))?;

            // 第一段：等 bat 自己退出。bat 在 UAC 被答复后才返回（Start-Process
            // -Verb RunAs 会阻塞在提权对话框上），所以退出码直接反映 UAC 结果。
            // 超时说明它卡在 `pause`（错误分支）或别的等待上 —— 不能无限期挂住
            // 整条管线，到点杀掉并如实报告。
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
            let code = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break status.code(),
                    Ok(None) if std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                    }
                    Ok(None) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(
                            "上游安装器 180 秒内未退出（可能在等待按键或 UAC 未被答复）。\
                             请在它的窗口里完成操作后，点「验证」复查。"
                                .into(),
                        );
                    }
                    Err(e) => return Err(format!("等待上游安装器失败：{e}")),
                }
            };
            if code != Some(0) {
                return Err(format!(
                    "上游安装器退出码 {code:?}（通常是 UAC 被取消）。\
                     可点「验证」查看实际结果，再决定是否重试。"
                ));
            }

            // 第二段：bat 派生的**提权副本是异步的**（bat 自己 exit 0 不代表安装
            // 完成），所以上游 transcript 的成功句才是完成信号。拿
            // `.zh-cn-backups` 当证据是错的：备份目录在**备份段**就已创建，
            // 会把"刚备份完、补丁还没打"误判成装完。
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
            loop {
                if log_says_installed(&install_log) {
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    return Err(
                        "上游提权副本 120 秒内未在 install-windows.log 中留下成功句\
                         `安装完成`（可能仍在安装或 UAC 被取消）。请点「验证」复查实际结果。"
                            .into(),
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }

            for ent in &mut manifest.entries {
                ent.applied = true;
            }
            let _ = save_manifest_v2(dest, manifest);

            let touched = active_desktop_resources(version)
                .map(|r| r.display().to_string())
                .unwrap_or_else(|| bat.display().to_string());
            Ok(vec![touched])
        }
        // Claude Code Layer 1–3：写用户配置，不需要管理员，也不碰二进制。
        ("claude-code-layers", PluginTarget::ClaudeCode) => {
            let home = claude_home().ok_or("找不到 %USERPROFILE%\\.claude")?;
            let mut written = Vec::new();
            let mut registered = false;

            for layer in layers {
                if layer.needs_verified_version() {
                    return Err(format!(
                        "{} 在当前 Claude Code 版本不可用：已超出上游验证窗口\
                         （Windows native ≤2.1.153，上游 bun-binary-io 自 2026-05-31\
                         未更新），Layer 1–3 不受影响。",
                        layer.label()
                    ));
                }
                match layer {
                    CodeLayer::Plugin | CodeLayer::Hook => {
                        let from = src.join("plugin");
                        if !from.is_dir() {
                            return Err("上游缺少 plugin/ 目录。".into());
                        }
                        // Windows / CC 2.1.278 适配，先改源头再 copy —— marketplace
                        // cache 从源头 copy，源头不适配 cache 拿到的就是坏的（实测：
                        // 旧格式清单让 `plugin list` 报 No plugins installed、裸
                        // session-start 唤不起、无 BOM 的 ps1 被按 GBK 解析成乱码）。
                        write_plugin_manifest(&from)?;
                        rewrite_hooks_cmd(&from)?;
                        ensure_ps1_bom(&from)?;
                        write_marketplace_manifest(src, entry)?;
                        let to = home.join("plugins").join(code_plugin_dir(entry));
                        copy_dir(&from, &to)?;
                        write_plugin_manifest(&to)?;
                        rewrite_hooks_cmd(&to)?;
                        ensure_ps1_bom(&to)?;
                        written.push(to.display().to_string());
                        registered = true;
                        let plug_rel = format!("plugins/{}", code_plugin_dir(entry));
                        for ent in &mut manifest.entries {
                            if ent.relative_path == plug_rel {
                                ent.applied = true;
                            }
                        }
                    }
                    CodeLayer::Config => {
                        let overlay_path = src.join("settings-overlay.json");
                        let settings_path = home.join("settings.json");
                        let overlay: Value = serde_json::from_str(
                            &std::fs::read_to_string(&overlay_path)
                                .map_err(|e| format!("读取 settings-overlay.json：{e}"))?,
                        )
                        .map_err(|e| format!("settings-overlay.json 非法 JSON：{e}"))?;
                        // 深合并：**只加不覆盖**。本机 settings.json 里有第三方
                        // API token，用整文件替换会把它抹掉 —— 那是不可接受的破坏。
                        let mut base: Value = if settings_path.is_file() {
                            serde_json::from_str(
                                &std::fs::read_to_string(&settings_path)
                                    .map_err(|e| format!("读取 settings.json：{e}"))?,
                            )
                            .map_err(|e| format!("settings.json 非法 JSON：{e}"))?
                        } else {
                            json!({})
                        };
                        deep_merge(&mut base, &overlay);
                        if let Some(parent) = settings_path.parent() {
                            std::fs::create_dir_all(parent)
                                .map_err(|e| format!("创建 ~/.claude 失败：{e}"))?;
                        }
                        write_json_pretty(&settings_path, &base)?;
                        written.push(settings_path.display().to_string());
                        for ent in &mut manifest.entries {
                            if ent.relative_path == "settings.json" {
                                ent.applied = true;
                            }
                        }
                    }
                    CodeLayer::CliPatch => {
                        return Err(format!("{} 未通过版本闸，不应到达此处。", layer.label()))
                    }
                }
            }
            // 注册是 Hook/Plugin 层的**生效必要条件**：copy 目录只是落盘，CC 2.1.278
            // 只认 marketplace 注册态（enabledPlugins）。失败必须让整个安装失败 ——
            // 上方 Err 路径会 restore 备份，绝不留下"装了但不生效"的半成品。
            if registered {
                written.extend(register_plugin(src, entry)?);
                for ent in &mut manifest.entries {
                    if ent.relative_path == "plugins/known_marketplaces.json"
                        || ent.relative_path == "plugins/installed_plugins.json"
                        || ent.root_id == PluginRootId::PluginCache
                    {
                        ent.applied = true;
                    }
                }
            }
            let _ = save_manifest_v2(dest, manifest);
            Ok(written)
        }
        (other, t) => Err(format!("未知的安装器 `{other}`（target={}）", t.label())),
    }
}

/// 安装后验证：检查**预期状态**，而不是检查"文件存在"。
fn verify(entry: &PluginEntry, target: PluginTarget, version: Option<&str>) -> StageOutcome {
    match (entry.installer.as_str(), target) {
        ("claude-code-layers", PluginTarget::ClaudeCode) => {
            let home = match claude_home() {
                Some(h) => h,
                None => return StageOutcome::fail("verify", "验证", "找不到 ~/.claude"),
            };
            let plug = home.join("plugins").join(code_plugin_dir(entry));
            let settings = home.join("settings.json");
            let has_plugin = plug.join("manifest.json").is_file();
            let settings_text = std::fs::read_to_string(&settings).unwrap_or_default();
            let has_lang = settings_text.contains("\"language\"")
                && settings_text.to_lowercase().contains("chinese");
            // 两个断言都必须成立：只装了插件目录但语言没生效 = 半成品，
            // 而半成品正是用户最不知道该怎么办的状态。
            if has_plugin && has_lang {
                StageOutcome::ok(
                    "verify",
                    "验证",
                    "插件目录与 settings.json 的 language 均已生效。",
                )
            } else if !has_plugin {
                StageOutcome::fail("verify", "验证", "插件目录缺少 manifest.json。")
            } else {
                StageOutcome::fail("verify", "验证", "settings.json 中未找到 language: Chinese。")
            }
        }
        ("external-windows-bat", PluginTarget::ClaudeDesktop) => {
            // 与 probe 的 is_localized、backup_targets 共用**生效目录**判据：
            // 写死根 resources 会让 app-<v> 布局的机器"验证必失败"。
            match active_desktop_resources(version) {
                Some(res) if res.join(".zh-cn-backups").exists() => {
                    StageOutcome::ok("verify", "验证", "检测到上游备份目录，补丁已应用。")
                }
                Some(_) => StageOutcome::fail(
                    "verify",
                    "验证",
                    "未找到上游备份目录 .zh-cn-backups，补丁可能未生效。",
                ),
                None => StageOutcome::fail("verify", "验证", "找不到 Claude Desktop 安装根。"),
            }
        }
        _ => StageOutcome::warn("verify", "验证", "该安装器没有声明验证方式。"),
    }
}

/// 回滚：只认备份清单。
fn rollback(entry: &PluginEntry, target: PluginTarget, mut stages: Vec<StageOutcome>, _m: Vec<String>) -> PluginRun {
    let records = read_state();
    let rec = state_for(&records, &entry.id);
    let version = probe::probe(target).into_iter().next().and_then(|s| s.version);
    let dir = rec
        .and_then(|r| r.backup.as_deref().map(PathBuf::from))
        .unwrap_or_else(|| backup_dir_for(entry, target, version.as_deref()));
    if !dir.exists() {
        stages.push(StageOutcome::fail(
            "rollback",
            "回滚",
            format!("没有备份（{} 不存在）。", dir.display()),
        ));
        return PluginRun {
            plugin_id: entry.id.clone(),
            mode: RunMode::Rollback,
            status: RunStatus::Refused,
            reason: "无备份可回滚，未修改任何文件。".into(),
            stages,
            modified: Vec::new(),
            backup: None,
            restored: false,
            offer_retry: false,
            transaction_id: rec.and_then(|r| r.transaction_id.clone()),
        };
    }
    let (ok, errs) = restore_v2(&dir, version.as_deref());
    if !errs.is_empty() {
        stages.push(StageOutcome::fail(
            "rollback",
            "回滚",
            format!("部分文件还原失败（{} 项）：{}", errs.len(), errs.join("; ")),
        ));
        let v = verify(entry, target, version.as_deref());
        stages.push(v);
        // 部分失败时绝不清除已安装记录，保护回滚重试入口
        return PluginRun {
            plugin_id: entry.id.clone(),
            mode: RunMode::Rollback,
            status: RunStatus::RollbackPartial,
            reason: format!("部分文件回滚失败，状态记录已保留：{}", errs.join("; ")),
            stages,
            modified: Vec::new(),
            backup: Some(dir.display().to_string()),
            restored: ok,
            offer_retry: true,
            transaction_id: rec.and_then(|r| r.transaction_id.clone()),
        };
    }
    stages.push(StageOutcome::ok(
        "rollback",
        "回滚",
        if ok { format!("已从 {} 还原", dir.display()) } else { "清单为空，无可还原文件".into() },
    ));
    let v = verify(entry, target, version.as_deref());
    stages.push(v);
    clear_record(&entry.id);
    PluginRun {
        plugin_id: entry.id.clone(),
        mode: RunMode::Rollback,
        status: RunStatus::Succeeded,
        reason: "已回滚到安装前状态。".into(),
        stages,
        modified: Vec::new(),
        backup: Some(dir.display().to_string()),
        restored: ok,
        offer_retry: false,
        transaction_id: rec.and_then(|r| r.transaction_id.clone()),
    }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/// 上游 `settings-overlay.json` 的深合并：**只补缺失键，不覆盖已有值**。
fn deep_merge(base: &mut Value, overlay: &Value) {
    match (base, overlay) {
        (Value::Object(b), Value::Object(o)) => {
            for (k, v) in o {
                match b.get_mut(k) {
                    Some(slot) if slot.is_object() && v.is_object() => deep_merge(slot, v),
                    // 已有键不覆盖 —— 用户自己的配置优先于插件的默认值。
                    Some(_) => {}
                    None => {
                        b.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        (slot, v) => *slot = v.clone(),
    }
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "root".into())
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("{}: {e}", to.display()))?;
    for entry in std::fs::read_dir(from).map_err(|e| format!("{}: {e}", from.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let dst = to.join(entry.file_name());
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            copy_dir(&entry.path(), &dst)?;
        } else {
            std::fs::copy(entry.path(), &dst)
                .map(|_| ())
                .map_err(|e| format!("{}: {e}", entry.path().display()))?;
        }
    }
    Ok(())
}

fn claude_desktop_root() -> Option<PathBuf> {
    let root = std::env::var_os("LOCALAPPDATA")?.into();
    let p: PathBuf = root;
    let p = p.join("AnthropicClaude");
    p.join("claude.exe").exists().then_some(p)
}

fn claude_home() -> Option<PathBuf> {
    let p: PathBuf = std::env::var_os("USERPROFILE")?.into();
    Some(p.join(".claude"))
}

/// Claude Code 插件落盘目录名。**与上游 `install.ps1` 的 `$PluginDst` 同名**，
/// 否则我们的"已安装"检查和上游的安装器会各写各的，状态就分叉了。
fn code_plugin_dir(entry: &PluginEntry) -> String {
    entry.id.clone()
}

fn is_elevated() -> bool {
    std::env::var_os("USERPROFILE").is_some()
        && Command::new("net")
            .args(["session"])
            .creation_flags(0x0800_0000)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
}

use std::os::windows::process::CommandExt;
use std::process::Command;

fn backup_dir_for(entry: &PluginEntry, target: PluginTarget, version: Option<&str>) -> PathBuf {
    // 版本进目录名：Claude 升级后旧备份**不能**被装回去，那是上游踩过的真实坑
    // （javaht 的 issue #156：恢复最旧备份把 Claude 降级了）。按版本隔离备份，
    // 从结构上杜绝"拿 1.15200 的 app.asar 覆盖 2.2553.1"。
    backup_root()
        .join(&entry.id)
        .join(format!("{}-{}", target.label().replace(' ', "_"), version.unwrap_or("unknown")))
}

fn existing_backup(entry: &PluginEntry, target: PluginTarget, version: Option<&str>) -> Option<String> {
    let records = read_state();
    if let Some(r) = state_for(&records, &entry.id) {
        if let Some(b) = &r.backup {
            if Path::new(b).exists() {
                return Some(b.clone());
            }
        }
    }
    let p = backup_dir_for(entry, target, version);
    p.exists().then(|| p.display().to_string())
}

fn refuse(
    entry: &PluginEntry,
    mode: RunMode,
    stages: Vec<StageOutcome>,
    modified: Vec<String>,
    _target: PluginTarget,
    reason: &str,
) -> PluginRun {
    PluginRun {
        plugin_id: entry.id.clone(),
        mode,
        status: RunStatus::Refused,
        reason: reason.to_string(),
        stages,
        // 拒绝发生在任何写入之前，所以这里必然为空 —— `untouched()` 因此为真，
        // UI 才有资格说"原 Claude 未受影响"。
        modified,
        backup: None,
        restored: false,
        offer_retry: true,
        transaction_id: None,
    }
}

fn default_layers(entry: &PluginEntry) -> Vec<CodeLayer> {
    if entry.layers.is_empty() {
        Vec::new()
    } else {
        entry.layers.iter().copied().filter(|l| !l.needs_verified_version()).collect()
    }
}

fn record(
    entry: &PluginEntry,
    target: PluginTarget,
    version: Option<&str>,
    backup: Option<&Path>,
    modified: &[String],
    layers: &[CodeLayer],
    transaction_id: Option<&str>,
) -> Result<(), String> {
    let mut all = read_state();
    all.retain(|r| r.plugin_id != entry.id);
    all.push(InstalledRecord {
        plugin_id: entry.id.clone(),
        target,
        claude_version: version.unwrap_or("unknown").into(),
        installed_at: now_stamp(),
        // `None` = 接管登记（Adopt）：没有我方备份就不能记成有，否则
        // `views.backup` 会亮出一个点了必失败的回滚按钮。
        backup: backup.map(|p| p.display().to_string()),
        modified: modified.to_vec(),
        layers: layers.to_vec(),
        transaction_id: transaction_id.map(|s| s.to_string()),
    });
    write_state(&all).map_err(|e| e.to_string())
}

fn clear_record(id: &str) {
    let mut all = read_state();
    all.retain(|r| r.plugin_id != id);
    let _ = write_state(&all);
}

fn now_stamp() -> String {
    // 不引时间 crate：一个稳定的、可排序的时间戳就够了，格式由调用方自己解释。
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// 视图
// ---------------------------------------------------------------------------

/// 目录 + 本机判定的完整视图列表。
pub fn views(catalog: &PluginCatalog) -> Vec<super::PluginView> {
    let records = read_state();
    let desktop = probe::desktop();
    let code = probe::code();

    catalog.entries.iter().map(|entry| {
        let resolved = match entry.target {
            PluginTarget::Both => {
                if desktop.installed {
                    PluginTarget::ClaudeDesktop
                } else if code.installed {
                    PluginTarget::ClaudeCode
                } else {
                    PluginTarget::ClaudeDesktop
                }
            }
            t => t,
        };
        let state = match resolved {
            PluginTarget::ClaudeDesktop => &desktop,
            _ => &code,
        };
        let (compat, reason) =
            compat::evaluate(entry.range_for(resolved), resolved, state.installed, state.version.as_deref());
        let rec = state_for(&records, &entry.id);
        let installed_for = rec.as_ref().map(|r| r.claude_version.clone());
        let stale = installed_for
            .as_ref()
            .zip(state.version.as_ref())
            .map(|(a, b)| a != b)
            .unwrap_or(false);

        let blocked = if !state.installed {
            Some("目标未安装".to_string())
        } else if !compat.allows_install() {
            Some(format!("版本未验证：{}", compat.label()))
        } else if resolved == PluginTarget::ClaudeDesktop && state.running {
            Some("Claude Desktop 正在运行，请先退出".to_string())
        } else {
            None
        };

        let layer_notes = if resolved == PluginTarget::ClaudeCode {
            entry
                .layers
                .iter()
                .map(|l| {
                    let ok = !l.needs_verified_version();
                    (
                        *l,
                        ok,
                        if ok {
                            format!("Layer {} 只写用户配置，不受版本影响", l.ordinal())
                        } else {
                            "Layer 4 需要已验证版本，未验证时拒绝".into()
                        },
                    )
                })
                .collect()
        } else {
            Vec::new()
        };

        super::PluginView {
            entry: entry.clone(),
            resolved_target: resolved,
            compat,
            compat_reason: reason,
            target_installed: state.installed,
            target_version: state.version.clone(),
            active: rec.is_some(),
            installed_for_version: installed_for,
            stale,
            blocked_reason: blocked,
            backup: rec.and_then(|r| r.backup.clone()),
            layer_notes,
        }
    })
    .collect()
}

/// 某个 target 的状态（UI 顶部"Claude Desktop 已安装 ✓"）。
pub fn targets() -> Vec<TargetState> {
    vec![probe::desktop(), probe::code()]
}

// ---------------------------------------------------------------------------
// 注册链：清单适配 → hooks Windows 化 → BOM → marketplace 登记 → 启用
// ---------------------------------------------------------------------------
//
// 落盘 ≠ 生效。CC 2.1.x 只认 `installed_plugins.json` + `known_marketplaces.json`
// + settings 的 `enabledPlugins` 这条注册态：只把文件 copy 进 `~/.claude/plugins`
// 会让 `plugin list` 显示 No plugins installed / × disabled —— 本机实测踩过。
// 这组函数把"手动敲 claude plugin marketplace add/install/enable 能成的那套状态"
// 变成幂等的文件写入，让新机器开箱即通；schema 与 CLI 实际产出逐字段对齐
// （`installed_plugins.json` version: 2），不依赖 PATH 上有没有 claude。

/// 本地 marketplace 名：`write_marketplace_manifest` 写出的 `name`、注册表的键、
/// 以及 `插件@marketplace` 键的后半段必须三处一致，常量是唯一来源。
const ZH_MARKETPLACE: &str = "zh-cn-local";

fn load_json_or(path: &Path, default: Value) -> Result<Value, String> {
    match std::fs::read_to_string(path) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("解析 {}：{e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(default),
        Err(e) => Err(format!("读取 {}：{e}", path.display())),
    }
}

fn write_json_pretty(path: &Path, v: &Value) -> Result<(), String> {
    let body = serde_json::to_string_pretty(v).map_err(|e| e.to_string())? + "\n";
    crate::modules::atomic_file::write_atomic(path, body.as_bytes())
        .map_err(|e| format!("写入 {}：{e}", path.display()))
}

/// ISO-8601 UTC（`2026-09-22T06:29:22.000Z`）—— 注册表两份 JSON 的时间字段要
/// 这种形状；`now_stamp()` 的 unix 秒填进去是 `Invalid Date`。不引 chrono：
/// 纯算术，有单测钉住已知时间点。
fn iso_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso_from_unix(secs)
}

fn iso_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil_from_days（Howard Hinnant 的经典算法）：epoch 天数 → 年月日。
    let z = days + 719_468;
    let era_z = if z >= 0 { z } else { z - 146_096 };
    let era = era_z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let mon = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mon <= 2 { y + 1 } else { y };
    format!("{y:04}-{mon:02}-{day:02}T{h:02}:{m:02}:{s:02}.000Z")
}

/// 把插件目录补成 CC 认的两份清单：根 `manifest.json`（hooks/outputStyles 元数据）
/// 与 `.claude-plugin\plugin.json`（新格式 sidecar）。**实测：缺 sidecar 时
/// `claude plugin list` 报 No plugins installed** —— 只 copy 目录不修清单，装了也
/// 认不出。幂等：已正确则一个字节都不写。
fn write_plugin_manifest(plugin_dir: &Path) -> Result<(), String> {
    let mpath = plugin_dir.join("manifest.json");
    let text = std::fs::read_to_string(&mpath)
        .map_err(|e| format!("读取 {}：{e}", mpath.display()))?;
    let manifest: Value =
        serde_json::from_str(&text).map_err(|e| format!("解析 {}：{e}", mpath.display()))?;
    for k in ["name", "version", "description"] {
        let ok = manifest
            .get(k)
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        if !ok {
            return Err(format!("manifest.json 缺少非空 `{k}`，拒绝注册无名插件。"));
        }
    }
    let author = match manifest.get("author") {
        Some(Value::String(s)) => json!({ "name": s }),
        Some(other) => other.clone(),
        None => json!({ "name": "unknown" }),
    };
    let hooks_ref = manifest
        .get("hooks")
        .and_then(|v| v.as_str())
        .map(|s| Value::String(format!("./{}", s.trim_start_matches("./"))))
        .or_else(|| {
            plugin_dir
                .join("hooks.json")
                .is_file()
                .then(|| Value::String("./hooks.json".into()))
        });
    let mut derived = json!({
        "name": manifest["name"],
        "version": manifest["version"],
        "description": manifest["description"],
        "author": author,
        "license": manifest.get("license").cloned().unwrap_or_else(|| json!("MIT")),
    });
    if let Some(h) = hooks_ref {
        if let Some(obj) = derived.as_object_mut() {
            obj.insert("hooks".into(), h);
        }
    }
    let meta = plugin_dir.join(".claude-plugin");
    std::fs::create_dir_all(&meta).map_err(|e| format!("创建 {}：{e}", meta.display()))?;
    let ppath = meta.join("plugin.json");
    let cur = std::fs::read_to_string(&ppath)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok());
    if cur.as_ref() != Some(&derived) {
        write_json_pretty(&ppath, &derived)?;
    }
    Ok(())
}

/// hooks.json 的 command 必须落到 Windows 能执行的载体（`.cmd`）。上游以 bash 为
/// 主，裸 `session-start` 在 Windows 上唤不起（实测）：已有 `.cmd` 就改引用，只有
/// `.ps1` 就生成等价 `.cmd` 包装，都没有则保持原样（不引 bash 依赖）。幂等。
fn rewrite_hooks_cmd(plugin_dir: &Path) -> Result<(), String> {
    let hpath = plugin_dir.join("hooks.json");
    if !hpath.is_file() {
        return Ok(());
    }
    let text = std::fs::read_to_string(&hpath)
        .map_err(|e| format!("读取 {}：{e}", hpath.display()))?;
    let mut root: Value =
        serde_json::from_str(&text).map_err(|e| format!("解析 hooks.json：{e}"))?;
    let Some(events) = root.get_mut("hooks").and_then(|v| v.as_object_mut()) else {
        return Ok(());
    };
    let mut changed = false;
    for (_event, list) in events.iter_mut() {
        let Some(entries) = list.as_array_mut() else { continue };
        for item in entries {
            let Some(inner) = item.get_mut("hooks").and_then(|v| v.as_array_mut()) else {
                continue;
            };
            for h in inner.iter_mut() {
                let Some(cmd) = h.get("command").and_then(|v| v.as_str()) else {
                    continue;
                };
                let bare = cmd.trim().trim_matches(|c| c == '\'' || c == '"');
                let Some(rel) = bare.strip_prefix("${CLAUDE_PLUGIN_ROOT}/") else {
                    continue;
                };
                let low = rel.to_ascii_lowercase();
                if low.ends_with(".cmd") || low.ends_with(".bat") || low.ends_with(".exe") {
                    continue;
                }
                let stem = Path::new(rel)
                    .with_extension("")
                    .to_string_lossy()
                    .to_string();
                let cmd_path = plugin_dir.join(format!("{stem}.cmd"));
                if !cmd_path.is_file() {
                    let ps1 = plugin_dir.join(format!("{stem}.ps1"));
                    if !ps1.is_file() {
                        continue;
                    }
                    let ps1_name = ps1
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let wrap = format!(
                        "@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass \
                         -File \"%~dp0{ps1_name}\"\r\n"
                    );
                    crate::modules::atomic_file::write_atomic(&cmd_path, wrap.as_bytes())
                        .map_err(|e| format!("写入 {}：{e}", cmd_path.display()))?;
                }
                let new_cmd = format!("'${{CLAUDE_PLUGIN_ROOT}}/{stem}.cmd'");
                if h.get("command").and_then(|v| v.as_str()) != Some(new_cmd.as_str()) {
                    if let Some(obj) = h.as_object_mut() {
                        obj.insert("command".into(), Value::String(new_cmd));
                        changed = true;
                    }
                }
            }
        }
    }
    if changed {
        write_json_pretty(&hpath, &root)?;
    }
    Ok(())
}

/// UTF-8 BOM：无 BOM 的 `.ps1` 在 Windows PowerShell 5 上按 GBK 解析 → 中文注释
/// 全乱码、可能连语法都坏（实测）。幂等：已有 BOM 不动。
fn ensure_ps1_bom(dir: &Path) -> Result<(), String> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let rd = std::fs::read_dir(&d).map_err(|e| format!("读取 {}：{e}", d.display()))?;
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let is_ps1 = p
                .extension()
                .map(|x| x.eq_ignore_ascii_case("ps1"))
                .unwrap_or(false);
            if !is_ps1 {
                continue;
            }
            let bytes = std::fs::read(&p).map_err(|e| format!("读取 {}：{e}", p.display()))?;
            if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
                continue;
            }
            let mut nb = Vec::with_capacity(bytes.len() + 3);
            nb.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            nb.extend_from_slice(&bytes);
            crate::modules::atomic_file::write_atomic(&p, &nb)
                .map_err(|e| format!("写入 {}：{e}", p.display()))?;
        }
    }
    Ok(())
}

/// 本地 marketplace 清单：`claude plugin marketplace add` 认的是源码根
/// `.claude-plugin\marketplace.json`。已有且含本插件则不动（保留上游多余字段）。
fn write_marketplace_manifest(src: &Path, entry: &PluginEntry) -> Result<(), String> {
    let dir = src.join(".claude-plugin");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 {}：{e}", dir.display()))?;
    let path = dir.join("marketplace.json");
    let cur = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok());
    let already_ok = cur
        .as_ref()
        .map(|c| {
            let name_ok = c.get("name").and_then(|n| n.as_str()) == Some(ZH_MARKETPLACE);
            let has_plugin = c
                .get("plugins")
                .and_then(|p| p.as_array())
                .map(|a| {
                    a.iter().any(|x| {
                        x.get("name").and_then(|n| n.as_str()) == Some(entry.id.as_str())
                    })
                })
                .unwrap_or(false);
            name_ok && has_plugin
        })
        .unwrap_or(false);
    if already_ok {
        return Ok(());
    }
    let desc = std::fs::read_to_string(src.join("plugin").join("manifest.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("description").cloned())
        .unwrap_or_else(|| Value::String(entry.description.clone()));
    let want = json!({
        "name": ZH_MARKETPLACE,
        "owner": { "name": "Setup Center" },
        "plugins": [{
            "name": entry.id.clone(),
            "source": "./plugin",
            "description": desc,
        }],
    });
    write_json_pretty(&path, &want)
}

/// marketplace 登记 + 安装登记 + 启用：直写 CC 的三份注册文件（schema 与本机
/// `claude plugin marketplace add/install/enable` 实际产出逐字段一致，v2）。
/// **只落盘不算生效** —— CC 只认 `installed_plugins.json` + `enabledPlugins` 这条
/// 注册态。任何一步失败都返回 Err，让上层回滚，绝不留"装了但不生效"的半成品。
fn register_plugin(src: &Path, entry: &PluginEntry) -> Result<Vec<String>, String> {
    let home = claude_home().ok_or("找不到 %USERPROFILE%，无法注册 Claude 插件。")?;
    let root = home.join("plugins");
    std::fs::create_dir_all(&root).map_err(|e| format!("创建 {}：{e}", root.display()))?;

    // 版本以（已适配过的）源头清单为准：cache 路径带版本，与 CLI 安装一致。
    let manifest_text = std::fs::read_to_string(src.join("plugin").join("manifest.json"))
        .map_err(|e| format!("读取源头 manifest.json：{e}"))?;
    let manifest: Value =
        serde_json::from_str(&manifest_text).map_err(|e| format!("manifest.json：{e}"))?;
    let version = manifest
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or(&entry.version)
        .to_string();

    let id_at = format!("{}@{}", entry.id, ZH_MARKETPLACE);
    let iso = iso_now();

    // 1) cache —— CC 实际加载插件的地方（installPath 指向这里）。copy_dir 是合并
    //    覆盖语义，重装幂等；新版本进新目录，旧目录自然成为孤儿、不碍事。
    let cache = root
        .join("cache")
        .join(ZH_MARKETPLACE)
        .join(&entry.id)
        .join(&version);
    copy_dir(&src.join("plugin"), &cache)?;

    // 2) known_marketplaces.json —— 只覆写本 marketplace 的键，其它键原样保留。
    let km_path = root.join("known_marketplaces.json");
    let mut km = load_json_or(&km_path, json!({}))?;
    if !km.is_object() {
        return Err("known_marketplaces.json 不是对象。".into());
    }
    let src_str = src.display().to_string();
    km[ZH_MARKETPLACE] = json!({
        "source": { "source": "directory", "path": src_str.clone() },
        "installLocation": src_str,
        "lastUpdated": iso.clone(),
    });

    // 3) installed_plugins.json（v2）—— 已有条目原位更新，不重复堆积。
    let ip_path = root.join("installed_plugins.json");
    let mut ip = load_json_or(&ip_path, json!({ "version": 2, "plugins": {} }))?;
    if !ip.is_object() {
        return Err("installed_plugins.json 不是对象。".into());
    }
    if ip.get("version").is_none() {
        ip["version"] = json!(2);
    }
    let plugins = ip
        .as_object_mut()
        .and_then(|o| {
            o.entry("plugins")
                .or_insert_with(|| json!({}))
                .as_object_mut()
        })
        .ok_or("installed_plugins.json 的 plugins 不是对象。")?;
    let cache_str = cache.display().to_string();
    let rec = match plugins
        .get(&id_at)
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .filter(|v| v.is_object())
        .cloned()
    {
        Some(mut r) => {
            r["lastUpdated"] = Value::String(iso);
            r["version"] = Value::String(version);
            r["installPath"] = Value::String(cache_str);
            r
        }
        None => json!({
            "scope": "user",
            "installPath": cache_str,
            "version": version,
            "installedAt": iso,
            "lastUpdated": iso,
        }),
    };
    plugins.insert(id_at.clone(), Value::Array(vec![rec]));
    write_json_pretty(&ip_path, &ip)?;
    write_json_pretty(&km_path, &km)?;

    // 4) settings.json —— `enabledPlugins` 是"启用"的唯一真源（`plugin list` 的
    //    Status 由它派生）。深合并且只加不覆盖：E2E 断言安装前的键一个都不能丢。
    let st_path = home.join("settings.json");
    let mut st = load_json_or(&st_path, json!({}))?;
    if !st.is_object() {
        return Err("settings.json 不是对象。".into());
    }
    let ep = st
        .as_object_mut()
        .and_then(|o| {
            o.entry("enabledPlugins")
                .or_insert_with(|| json!({}))
                .as_object_mut()
        })
        .ok_or("settings.json 的 enabledPlugins 不是对象。")?;
    ep.insert(id_at, Value::Bool(true));
    write_json_pretty(&st_path, &st)?;

    Ok(vec![
        cache_str_final(&cache),
        km_path.display().to_string(),
        ip_path.display().to_string(),
        st_path.display().to_string(),
    ])
}

fn cache_str_final(p: &Path) -> String {
    p.display().to_string()
}

#[cfg(test)]
mod helper_tests {
    use super::*;
    use serde_json::json;

    fn tmpd(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sc-ph-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn entry_stub() -> PluginEntry {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("plugins");
        PluginCatalog::load(&dir)
            .get("claude-code-zh-cn")
            .expect("catalogue entry claude-code-zh-cn")
            .clone()
    }

    #[test]
    fn iso_from_unix_matches_known_epochs() {
        assert_eq!(iso_from_unix(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_unix(1_767_225_600), "2026-01-01T00:00:00.000Z");
    }

    #[test]
    fn manifest_sidecar_is_derived_and_idempotent() {
        let d = tmpd("manifest");
        std::fs::write(
            d.join("manifest.json"),
            json!({
                "name": "demo", "version": "1.2.3", "description": "演示",
                "author": "someone", "license": "MIT", "hooks": "hooks.json"
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(d.join("hooks.json"), "{}").unwrap();
        write_plugin_manifest(&d).unwrap();
        let p = d.join(".claude-plugin").join("plugin.json");
        let side: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(side["name"], json!("demo"));
        assert_eq!(side["author"]["name"], json!("someone"));
        assert_eq!(side["hooks"], json!("./hooks.json"));
        let first = std::fs::read_to_string(&p).unwrap();
        write_plugin_manifest(&d).unwrap();
        assert_eq!(first, std::fs::read_to_string(&p).unwrap(), "应幂等不重写");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn manifest_without_name_is_rejected() {
        let d = tmpd("manifest-bad");
        std::fs::write(d.join("manifest.json"), json!({ "version": "1" }).to_string()).unwrap();
        assert!(write_plugin_manifest(&d).is_err(), "缺 name 必须拒绝");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hooks_bare_command_gains_a_cmd_wrapper() {
        let d = tmpd("hooks");
        std::fs::create_dir_all(d.join("hooks")).unwrap();
        std::fs::write(d.join("hooks").join("session-start.ps1"), "Write-Host hi").unwrap();
        std::fs::write(
            d.join("hooks.json"),
            json!({
                "hooks": { "SessionStart": [ { "matcher": "", "hooks": [
                    { "type": "command",
                      "command": "'${CLAUDE_PLUGIN_ROOT}/hooks/session-start'",
                      "async": false }
                ] } ] }
            })
            .to_string(),
        )
        .unwrap();
        rewrite_hooks_cmd(&d).unwrap();
        let out: Value =
            serde_json::from_str(&std::fs::read_to_string(d.join("hooks.json")).unwrap()).unwrap();
        assert_eq!(
            out["hooks"]["SessionStart"][0]["hooks"][0]["command"],
            json!("'${CLAUDE_PLUGIN_ROOT}/hooks/session-start.cmd'")
        );
        let wrap_path = d.join("hooks").join("session-start.cmd");
        assert!(wrap_path.is_file(), "应生成 .cmd 包装");
        let wrap = std::fs::read_to_string(&wrap_path).unwrap();
        assert!(wrap.contains("session-start.ps1"), "包装应指向 ps1：{wrap}");
        let b1 = std::fs::read_to_string(d.join("hooks.json")).unwrap();
        rewrite_hooks_cmd(&d).unwrap();
        assert_eq!(b1, std::fs::read_to_string(d.join("hooks.json")).unwrap(), "应幂等");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hooks_cmd_reference_is_left_alone() {
        let d = tmpd("hooks-ok");
        std::fs::create_dir_all(d.join("hooks")).unwrap();
        std::fs::write(d.join("hooks").join("x.cmd"), "@echo off").unwrap();
        std::fs::write(
            d.join("hooks.json"),
            json!({
                "hooks": { "SessionStart": [ { "matcher": "", "hooks": [
                    { "type": "command",
                      "command": "'${CLAUDE_PLUGIN_ROOT}/hooks/x.cmd'" }
                ] } ] }
            })
            .to_string(),
        )
        .unwrap();
        let before = std::fs::read_to_string(d.join("hooks.json")).unwrap();
        rewrite_hooks_cmd(&d).unwrap();
        assert_eq!(before, std::fs::read_to_string(d.join("hooks.json")).unwrap());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn ps1_without_bom_gets_one_and_stays_idempotent() {
        let d = tmpd("bom");
        let f = d.join("a.ps1");
        std::fs::write(&f, "Write-Output '中文'").unwrap();
        ensure_ps1_bom(&d).unwrap();
        let b1 = std::fs::read(&f).unwrap();
        assert!(b1.starts_with(&[0xEF, 0xBB, 0xBF]), "无 BOM 应补 BOM");
        ensure_ps1_bom(&d).unwrap();
        let b2 = std::fs::read(&f).unwrap();
        assert_eq!(b1, b2, "已有 BOM 不应重复添加");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn marketplace_manifest_created_and_preserved() {
        let d = tmpd("mkt");
        std::fs::create_dir_all(d.join("plugin")).unwrap();
        std::fs::write(
            d.join("plugin").join("manifest.json"),
            json!({ "name": "demo", "version": "1.0.0", "description": "插件描述" }).to_string(),
        )
        .unwrap();
        let entry = entry_stub();
        write_marketplace_manifest(&d, &entry).unwrap();
        let mp = d.join(".claude-plugin").join("marketplace.json");
        let m: Value = serde_json::from_str(&std::fs::read_to_string(&mp).unwrap()).unwrap();
        assert_eq!(m["name"], json!("zh-cn-local"));
        assert_eq!(m["plugins"][0]["source"], json!("./plugin"));
        assert_eq!(m["plugins"][0]["description"], json!("插件描述"));
        // 已有合法清单：保留上游多余字段（幂等 = 不重写）
        let mut m2 = m.clone();
        m2["extra"] = json!("keep");
        std::fs::write(&mp, m2.to_string()).unwrap();
        write_marketplace_manifest(&d, &entry).unwrap();
        let again: Value = serde_json::from_str(&std::fs::read_to_string(&mp).unwrap()).unwrap();
        assert_eq!(again["extra"], json!("keep"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn transaction_manifest_v2_roundtrip_and_restore() {
        let d = tmpd("tx-manifest");
        let manifest = TransactionManifestV2 {
            version: 2,
            transaction_id: "tx-test-123".into(),
            plugin_id: "demo".into(),
            target: PluginTarget::ClaudeCode,
            claude_version: Some("2.1.278".into()),
            created_at: iso_now(),
            entries: vec![
                ManifestEntryV2 {
                    root_id: PluginRootId::ClaudeHome,
                    relative_path: "settings.json".into(),
                    kind: ManifestEntryKind::File,
                    existed_before: true,
                    backup_file_or_dir: Some("000_settings.json".into()),
                    applied: true,
                    restored: false,
                    error: None,
                },
                ManifestEntryV2 {
                    root_id: PluginRootId::ClaudeHome,
                    relative_path: "plugins/demo".into(),
                    kind: ManifestEntryKind::Directory,
                    existed_before: false,
                    backup_file_or_dir: None,
                    applied: true,
                    restored: false,
                    error: None,
                },
            ],
        };
        save_manifest_v2(&d, &manifest).unwrap();
        let read_back: TransactionManifestV2 = serde_json::from_str(
            &std::fs::read_to_string(d.join("manifest.json")).unwrap(),
        ).unwrap();
        assert_eq!(read_back.version, 2);
        assert_eq!(read_back.transaction_id, "tx-test-123");
        assert_eq!(read_back.entries.len(), 2);
        assert!(read_back.entries[0].existed_before);
        assert!(!read_back.entries[1].existed_before);
        let _ = std::fs::remove_dir_all(&d);
    }
}
