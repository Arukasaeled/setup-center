//! 两个 target 的探测链 —— **完全独立**，不共享路径假设。
//!
//! ## 为什么必须分开，且这份文件本身就是证据
//!
//! 最初的设计假设是"Claude Desktop 在 `%LOCALAPPDATA%\Programs\Claude`"，并据此
//! 写过一版报告。实测结果是**那个目录根本不存在**：真实根是
//! `%LOCALAPPDATA%\AnthropicClaude\`。同一个错误假设如果被复用到 Claude Code，
//! 就会得出"它在 `C:\Program Files\claude`"——而那里也没有，`claude` 根本不在
//! PATH 上。
//!
//! 两个 target 的真实形态：
//!
//! | | Claude Desktop | Claude Code |
//! |---|---|---|
//! | 形态 | Electron + Squirrel（per-user） | native binary（本机未装）+ 用户配置目录 |
//! | 根 | `%LOCALAPPDATA%\AnthropicClaude\` | 二进制按 PATH 找；配置在 `%USERPROFILE%\.claude\` |
//! | 版本 | `claude.exe` 的 `ProductVersion` | `claude --version` |
//! | 语言资源 | `app-<v>\resources\*.json` + `app.asar` | `settings.json` / `~/.claude/plugins/` |
//!
//! 两者没有一个路径是共用的，所以这里没有任何"通用查找"函数。
//!
//! ## 全部 spawn 都带 `CREATE_NO_WINDOW`
//!
//! 这不是风格偏好。本项目曾经因为两处漏加该标志，让用户屏幕上弹出一叠
//! Windows Terminal 的对话框（这台机器的默认控制台宿主是 WT，未抑制的
//! console spawn 不会是黑框闪一下，而是被 WT 接管并弹自己的窗口）。
//! 同目录下既有的 6 处 spawn 全部带标志，这里新增的每处也必须带。

use super::{PluginTarget, TargetState};
use std::os::windows::process::CommandExt;
use std::process::Command;

/// Windows 常量：创建进程时不为它开新的控制台窗口。
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 探测一个 target。传 `Both` 时返回两条链各自的结果（不是一个合并对象）。
pub fn probe(target: PluginTarget) -> Vec<TargetState> {
    match target {
        PluginTarget::ClaudeDesktop => vec![desktop()],
        PluginTarget::ClaudeCode => vec![code()],
        PluginTarget::Both => vec![desktop(), code()],
    }
}

/// Claude Desktop：Squirrel per-user 安装。
///
/// 版本取自 `claude.exe` 的 `ProductVersion`，**不**从目录名 `app-*` 推断。
/// 理由是 Squirrel 会在升级后保留旧的 `app-*` 目录（本机就同时有
/// `app-2.2553.1` 与 `app-0.14.10`），按目录名取"最新"会得到一个可能与实际
/// 运行版本不一致的数字 —— 而兼容性判定依赖的恰恰是**正在运行的那个**。
pub fn desktop() -> TargetState {
    let root = match std::env::var_os("LOCALAPPDATA") {
        Some(v) => std::path::PathBuf::from(v).join("AnthropicClaude"),
        None => {
            return missing(
                PluginTarget::ClaudeDesktop,
                "找不到 %LOCALAPPDATA%，无法定位安装根目录。".to_string(),
            )
        }
    };

    let exe = root.join("claude.exe");
    if !exe.exists() {
        return missing(
            PluginTarget::ClaudeDesktop,
            format!("{} 下没有 claude.exe。", root.display()),
        );
    }

    // FileDescription 就是 "Claude" —— 用它而不是文件名，避免把某个碰巧叫
    // claude.exe 的东西当成目标。装了 Desktop 的机器上两者同名，这层区分是必须的。
    let version = product_version(&exe);
    let running = process_count("claude");
    let localized = is_localized(&root, version.as_deref());

    TargetState {
        target: PluginTarget::ClaudeDesktop,
        installed: true,
        version: version.clone(),
        root: Some(root.display().to_string()),
        running,
        localized,
        note: version.as_ref().map(|v| format!("ProductVersion = {v}")),
    }
}

/// Windows 下取 PE 版本资源的 `ProductVersion`。
///
/// 用 `powershell` 而不是在 Rust 里解析 PE：解析 PE 要引入依赖，而这个调用是
/// 一次性的、结果缓存在 `TargetState` 里，为它加一个 crate 不划算。
/// **这是全模块唯一的进程调用**，且带 `CREATE_NO_WINDOW`。
fn file_product_version(exe: &std::path::Path) -> Option<String> {
    let script = format!(
        "$v=(Get-Item -LiteralPath '{p}').VersionInfo.ProductVersion; if($v){{$v}}",
        p = exe.display().to_string().replace('\'', "''")
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

fn product_version(exe: &std::path::Path) -> Option<String> {
    file_product_version(exe)
}

/// Claude Code：按 PATH 找二进制；配置目录单独判断。
///
/// 这台机器的真实状态是**二进制未安装**（`claude` 不在 PATH，全盘也无
/// `claude*.exe`），但 `%USERPROFILE%\.claude\` 存在（`settings.json` /
/// `skills` / `sessions` / `backups`）。
///
/// 这两件事必须分开报告：只看配置目录会谎报"已安装"，只看二进制又会谎报
/// "什么都没有"。所以 `installed` 只由二进制决定，配置目录写进 `note`。
pub fn code() -> TargetState {
    let exe = find_code_binary();

    let home = std::env::var_os("USERPROFILE")
        .map(std::path::PathBuf::from)
        .map(|p| p.join(".claude"));
    let has_home = home.as_ref().map(|p| p.exists()).unwrap_or(false);

    let exe = match exe {
        Some(e) => e,
        None => {
            return TargetState {
                target: PluginTarget::ClaudeCode,
                installed: false,
                version: None,
                root: home.as_ref().map(|p| p.display().to_string()),
                running: false,
                localized: false,
                note: Some(format!(
                    "未找到 claude 可执行文件（不在 PATH）。{} 配置目录{}存在 —— \
                     配置在、程序不在，因此按未安装处理。",
                    home.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
                    if has_home { "已" } else { "未" },
                )),
            };
        }
    };

    let version = code_version(&exe);
    TargetState {
        target: PluginTarget::ClaudeCode,
        installed: true,
        version: version.clone(),
        root: home.as_ref().map(|p| p.display().to_string()),
        running: process_count("claude"),
        // Claude Code 的"已中文化"看用户配置，不看安装文件。
        localized: code_settings_localized(home.as_deref()),
        note: version.as_ref().map(|v| format!("claude --version = {v}")),
    }
}

/// 按 PATH 与几个已知位置找 `claude` 可执行文件。
fn find_code_binary() -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for name in ["claude.exe", "claude.cmd", "claude.ps1", "claude"] {
                let p = dir.join(name);
                if p.is_file() {
                    candidates.push(p);
                }
            }
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let base = std::path::PathBuf::from(home);
        for p in [
            base.join("AppData/Roaming/npm/claude.cmd"),
            base.join("AppData/Local/npm/claude.cmd"),
            base.join(".local/bin/claude.exe"),
        ] {
            if p.is_file() {
                candidates.push(p);
            }
        }
    }
    for p in [
        std::path::PathBuf::from(r"C:\Program Files\claude\claude.exe"),
        std::path::PathBuf::from(r"C:\Program Files (x86)\claude\claude.exe"),
    ] {
        if p.is_file() {
            candidates.push(p);
        }
    }

    // 排除 Claude **Desktop** —— 它也叫 claude.exe，但它不是本 target。
    // 不排除的话，装了 Desktop 会被误报成"装了 Claude Code"，而两者的安装链
    // 毫无共同之处（这正是必须分两条链的原因）。
    candidates
        .into_iter()
        .find(|p| !p.to_string_lossy().to_lowercase().contains("anthropicclaude"))
}

/// `claude --version` → `"2.1.275 (Claude Code)"` → `"2.1.275"`。
///
/// 只取开头的数字段：上游输出带后缀，而兼容矩阵存的是纯数字。
fn code_version(exe: &std::path::Path) -> Option<String> {
    let out = Command::new(exe)
        .arg("--version")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let token = text.split_whitespace().next()?;
    let head = token
        .split(|c: char| !c.is_ascii_digit() && c != '.')
        .next()?;
    if head.is_empty() || !head.chars().next()?.is_ascii_digit() {
        return None;
    }
    Some(head.to_string())
}

/// 进程数。Desktop 有多个实例窗口，`claude` 这个名字同时也是 Code 的名字，
/// 所以这里只用于"是否正在运行"的粗判，不参与安装判断。
fn process_count(name: &str) -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {name}.exe"), "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains(&format!("{name}.exe"))
        })
        .unwrap_or(false)
}

/// Desktop 是否已被汉化：以上游自己的标记为准。
///
/// 上游 `install_windows.ps1` 把它动过的文件备份进 `resources\.zh-cn-backups\`
/// 并记录 `.zh-orig-version`（README「Windows 脚本会做什么」）。所以**存在该
/// 备份目录 = 上游安装器跑过**。这是比"有没有 zh-CN.json"更强的证据 —— 后者
/// 也可能是 Claude 自带的（这台机器两种都有）。
fn is_localized(root: &std::path::Path, version: Option<&str>) -> bool {
    let backups = root
        .join("resources")
        .join(".zh-cn-backups");
    if !backups.exists() {
        // 旧布局：备份在 `app-<v>\resources\` 下。
        if let Some(v) = version {
            let alt = root.join(format!("app-{v}")).join("resources").join(".zh-cn-backups");
            if alt.exists() {
                return true;
            }
        }
        return false;
    }
    true
}

/// Claude Code 是否已中文化：看 `settings.json` 的 `language` 键。
///
/// 只读不写。该文件可能含第三方 API token（本机就有），因此这里**绝不把内容
/// 返回给调用方**，只回答一个是非题。
fn code_settings_localized(home: Option<&std::path::Path>) -> bool {
    let home = match home {
        Some(h) => h,
        None => return false,
    };
    let text = match std::fs::read_to_string(home.join("settings.json")) {
        Ok(t) => t,
        Err(_) => return false,
    };
    // 粗匹配足够：这是一个展示用的是非题，不是解析器；真正的写入路径在
    // `pipeline.rs` 里用 serde_json 做，那里必须精确。
    text.contains("\"language\"") && text.to_lowercase().contains("chinese")
}

fn missing(target: PluginTarget, why: String) -> TargetState {
    TargetState {
        target,
        installed: false,
        version: None,
        root: None,
        running: false,
        localized: false,
        note: Some(why),
    }
}
