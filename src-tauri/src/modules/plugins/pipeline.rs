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
        if let Err(e) = record(entry, target, version.as_deref(), None, &[], &default_layers(entry)) {
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
        };
    }

    if mode == RunMode::Rollback {
        return rollback(entry, target, stages, modified);
    }

    // --- 6. backup（失败即中止，绝不带伤安装）------------------------------
    let backup_dir = backup_dir_for(entry, target, version.as_deref());
    match take_backup(entry, target, &src, &backup_dir, version.as_deref()) {
        Ok(files) => stages.push(StageOutcome::ok(
            "backup",
            "备份",
            format!("{} 个文件 → {}", files.len(), backup_dir.display()),
        )),
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
            };
        }
    }

    // --- 7. apply --------------------------------------------------------
    let layers = opts.layers.clone().unwrap_or_else(|| default_layers(entry));
    match apply(entry, target, &src, version.as_deref(), &layers) {
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
            let restored = restore(&backup_dir);
            stages.push(StageOutcome::ok(
                "rollback",
                "回滚",
                if restored { "已恢复原始文件" } else { "无文件需要恢复" },
            ));
            return PluginRun {
                plugin_id: entry.id.clone(),
                mode,
                status: RunStatus::Failed,
                reason: format!("安装失败，已回滚（{why}）。"),
                stages,
                modified: Vec::new(),
                backup: Some(backup_dir.display().to_string()),
                restored,
                offer_retry: true,
            };
        }
    }

    // --- 8. verify -------------------------------------------------------
    let v = verify(entry, target, version.as_deref());
    let ok = v.status == "ok";
    stages.push(v);

    if !ok {
        let restored = restore(&backup_dir);
        stages.push(StageOutcome::ok(
            "rollback",
            "回滚",
            if restored { "验证失败，已恢复原始文件" } else { "无文件需要恢复" },
        ));
        return PluginRun {
            plugin_id: entry.id.clone(),
            mode,
            status: RunStatus::Failed,
            reason: "安装后验证未通过，已回滚，原 Claude 未受影响。".into(),
            stages,
            modified: Vec::new(),
            backup: Some(backup_dir.display().to_string()),
            restored,
            offer_retry: true,
        };
    }

    // 记录"针对哪个版本安装"——第七条的版本漂移检测靠它。
    if let Err(e) = record(entry, target, version.as_deref(), Some(&backup_dir), &modified, &layers) {
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

/// 需要备份的文件 —— **按插件声明，不按猜测**。
fn backup_targets(
    entry: &PluginEntry,
    _target: PluginTarget,
    src: &Path,
    version: Option<&str>,
) -> Vec<PathBuf> {
    match entry.installer.as_str() {
        // Desktop：上游只改**生效的** resources 目录下的语言资源与 `app.asar`。
        "external-windows-bat" => {
            let mut out = Vec::new();
            if let Some(res) = active_desktop_resources(version) {
                for name in ["app.asar", "zh-CN.json", "en-US.json"] {
                    let p = res.join(name);
                    if p.is_file() {
                        out.push(p);
                    }
                }
                // 上游自己的备份目录也一并备份：回滚时要把"被汉化过的状态"也
                // 还原回去，否则只还原 app.asar 会留下半套中文资源。
                let bak = res.join(".zh-cn-backups");
                if bak.is_dir() {
                    out.push(bak);
                }
            }
            out
        }
        // Claude Code Layer 1–3：全部在 `~/.claude` 下，逐个按需存在。
        "claude-code-layers" => {
            let mut out = Vec::new();
            if let Some(home) = claude_home() {
                let settings = home.join("settings.json");
                if settings.is_file() {
                    out.push(settings);
                }
                let plug = home.join("plugins").join(code_plugin_dir(entry));
                if plug.is_dir() {
                    out.push(plug);
                }
            }
            let _ = src;
            out
        }
        _ => Vec::new(),
    }
}

/// 把 `backup_targets` 复制进备份目录，返回实际复制的清单。
///
/// **一个文件都复制不了就算失败** —— 空备份等于没有备份，而接下来要做的事是
/// 改写别人的安装文件。返回 `Ok(vec![])` 是不可能的路径，除非目标本来就没有
/// 任何文件可备份，那种情况 `backup_targets` 会给出空清单，由调用方判定。
fn take_backup(
    entry: &PluginEntry,
    target: PluginTarget,
    src: &Path,
    dest: &Path,
    version: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let targets = backup_targets(entry, target, src, version);
    if targets.is_empty() {
        // 没有既有文件 = 全新安装，写入的都是新文件，回滚只需删除它们。
        std::fs::create_dir_all(dest).map_err(|e| format!("创建备份目录失败：{e}"))?;
        return Ok(Vec::new());
    }
    std::fs::create_dir_all(dest).map_err(|e| format!("创建备份目录失败：{e}"))?;
    let mut done = Vec::new();
    for (i, file) in targets.iter().enumerate() {
        let name = format!("{i:03}_{}", file_name(file));
        let to = dest.join(&name);
        let res = if file.is_dir() {
            copy_dir(file, &to)
        } else {
            std::fs::copy(file, &to).map(|_| ()).map_err(|e| e.to_string())
        };
        if let Err(e) = res {
            return Err(format!("备份 {} 失败：{e}", file.display()));
        }
        done.push(file.clone());
    }
    // 写一份清单，让回滚知道每个编号对应哪个原路径。
    let manifest: Vec<Value> = targets
        .iter()
        .enumerate()
        .map(|(i, p)| {
            json!({
                "index": i,
                "name": format!("{i:03}_{}", file_name(p)),
                "path": p.display().to_string(),
            })
        })
        .collect();
    if let Err(e) = std::fs::write(
        dest.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    ) {
        return Err(format!("写入备份清单失败：{e}"));
    }
    Ok(done)
}

/// 按 `manifest.json` 把备份还原回去。**不看目录里有什么，只看清单** —— 目录里
/// 多出来的文件不应该被写进用户的安装目录。
fn restore(dest: &Path) -> bool {
    let text = match std::fs::read_to_string(dest.join("manifest.json")) {
        Ok(t) => t,
        Err(_) => return false,
    };
    let list: Vec<Value> = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let mut any = false;
    for item in list {
        let (name, path) = match (item.get("name"), item.get("path")) {
            (Some(n), Some(p)) => (n.as_str().unwrap_or_default(), p.as_str().unwrap_or_default()),
            _ => continue,
        };
        let from = dest.join(name);
        let to = PathBuf::from(path);
        if !from.exists() {
            continue;
        }
        let ok = if from.is_dir() {
            let _ = std::fs::remove_dir_all(&to);
            copy_dir(&from, &to).is_ok()
        } else {
            if let Some(parent) = to.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::copy(&from, &to).is_ok()
        };
        any |= ok;
    }
    any
}

/// 实际写入。**按 `installer` 分派，两条链共用一个入口但不共用任何一行逻辑。**
fn apply(
    entry: &PluginEntry,
    target: PluginTarget,
    src: &Path,
    version: Option<&str>,
    layers: &[CodeLayer],
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

            let touched = active_desktop_resources(version)
                .map(|r| r.display().to_string())
                .unwrap_or_else(|| bat.display().to_string());
            Ok(vec![touched])
        }
        // Claude Code Layer 1–3：写用户配置，不需要管理员，也不碰二进制。
        ("claude-code-layers", PluginTarget::ClaudeCode) => {
            let home = claude_home().ok_or("找不到 %USERPROFILE%\\.claude")?;
            let mut written = Vec::new();

            for layer in layers {
                if layer.needs_verified_version() {
                    return Err(format!(
                        "{} 需要已验证的 Claude Code 版本，当前未验证，已拒绝。",
                        layer.label()
                    ));
                }
                match layer {
                    CodeLayer::Plugin | CodeLayer::Hook => {
                        let from = src.join("plugin");
                        if !from.is_dir() {
                            return Err("上游缺少 plugin/ 目录。".into());
                        }
                        let to = home.join("plugins").join(code_plugin_dir(entry));
                        copy_dir(&from, &to)?;
                        written.push(to.display().to_string());
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
                        std::fs::write(
                            &settings_path,
                            serde_json::to_string_pretty(&base).unwrap_or_default(),
                        )
                        .map_err(|e| format!("写入 settings.json：{e}"))?;
                        written.push(settings_path.display().to_string());
                    }
                    CodeLayer::CliPatch => unreachable!("已在上方拒绝"),
                }
            }
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
    let version = probe::probe(target).into_iter().next().and_then(|s| s.version);
    let dir = backup_dir_for(entry, target, version.as_deref());
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
        };
    }
    let ok = restore(&dir);
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
