//! Domain model for Setup Center.
//!
//! Every type in this file is the *contract* between the modules and the UI.
//! Modules depend on these types; screens depend on these types; nothing
//! depends on a concrete implementation. That is what lets us fill in the
//! installer engine in stage 3 without touching the detection UI.
//!
//! All types are `serde`-serialisable with `camelCase` field names so the
//! TypeScript mirror in `src/lib/types.ts` is a literal transcription and the
//! compiler catches drift on the Rust side at least.

use serde::{Deserialize, Serialize};

pub use crate::modules::storage::{InstallLocationSupport, StorageMode, StoragePolicy};

// ---------------------------------------------------------------------------
// Shared scalar types
// ---------------------------------------------------------------------------

/// How confident the app is that a capability works.
///
/// This is deliberately richer than a bool: "we could not tell" is a real and
/// common outcome for PATH/registry probing, and silently folding it into
/// `false` is how installers end up lying to users.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Confidence {
    /// Positively verified.
    Ok,
    /// Positively verified as absent or degraded — a real, actionable finding.
    Fail,
    /// Probed, but the answer is ambiguous; treat as "unknown", never as ok.
    Unknown,
    /// Not applicable on this machine, so intentionally skipped.
    Skipped,
}

impl Confidence {
    pub fn is_ok(self) -> bool {
        matches!(self, Confidence::Ok)
    }
}

/// Severity of a detection signal, used to weight the environment score and to
/// decide which screen to nudge the user toward.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    /// Informational only, no effect on the score.
    Info,
    /// Worth mentioning; small score penalty.
    Warning,
    /// Blocks the selected profile; large score penalty.
    Blocking,
}

/// A single detection outcome.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Signal {
    /// Stable machine key, e.g. `windows.version`.
    pub key: String,
    /// Short user-facing label, already localised.
    pub label: String,
    /// Human-readable current value, e.g. `Windows 11 24H2 (26100)`.
    pub value: String,
    pub confidence: Confidence,
    pub severity: Severity,
    /// Score contribution in `[0.0, weight]`; `None` when not scored.
    pub score: Option<f32>,
    /// Maximum points this signal can contribute.
    pub weight: Option<f32>,
    /// Actionable hint shown when confidence is not `Ok`.
    pub hint: Option<String>,
}

impl Signal {
    pub fn ok(key: &str, label: &str, value: impl Into<String>, weight: f32) -> Self {
        Self {
            key: key.into(),
            label: label.into(),
            value: value.into(),
            confidence: Confidence::Ok,
            severity: Severity::Info,
            score: Some(weight),
            weight: Some(weight),
            hint: None,
        }
    }

    pub fn fail(key: &str, label: &str, value: impl Into<String>, weight: f32) -> Self {
        Self {
            key: key.into(),
            label: label.into(),
            value: value.into(),
            confidence: Confidence::Fail,
            severity: Severity::Blocking,
            score: Some(0.0),
            weight: Some(weight),
            hint: None,
        }
    }

    pub fn unknown(key: &str, label: &str, value: impl Into<String>, weight: f32) -> Self {
        Self {
            key: key.into(),
            label: label.into(),
            value: value.into(),
            confidence: Confidence::Unknown,
            severity: Severity::Warning,
            // Unknown earns half credit: we neither claim success nor punish
            // the user for something we failed to probe.
            score: Some(weight / 2.0),
            weight: Some(weight),
            hint: None,
        }
    }

    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    pub fn with_severity(mut self, severity: Severity) -> Self {
        self.severity = severity;
        self
    }
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/// Windows release, derived from the build number rather than the marketing
/// string, because `os.version` alone cannot distinguish 10 from 11.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsInfo {
    /// e.g. `Windows 11`
    pub edition: String,
    /// e.g. `24H2`
    pub release: Option<String>,
    /// e.g. `10.0.26100`
    pub build: String,
    pub major: u32,
    pub minor: u32,
    pub build_number: u32,
    pub architecture: String,
}

/// Whether this process can write to machine-wide locations (Program Files,
/// HKLM). This is *reported*, not required: V0.1 installs per-user via winget
/// so a non-elevated学生 can still finish.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminInfo {
    pub is_elevated: bool,
    pub user_name: String,
    /// Whether the current account is in the local Administrators group, so we
    /// can offer "restart as admin" only when it would actually work.
    pub is_admin_member: bool,
    /// True when we could not answer; UI must not claim "no".
    pub detection_uncertain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    /// Root that will hold downloads and installs, e.g. `C:\`
    pub root: String,
    /// Drive label when available.
    pub label: Option<String>,
    pub total_bytes: u64,
    pub free_bytes: u64,
    /// Result of actually writing a small file, not just a space calculation.
    pub writable: bool,
    /// True when free space is below what the biggest profile needs.
    pub low_space: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NetworkQuality {
    /// Reachable, low latency.
    Good,
    /// Reachable but slow or lossy — installers will still work.
    Degraded,
    /// Nothing reachable.
    Offline,
    /// Probe failed in a way that does not prove offline.
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub quality: NetworkQuality,
    /// Best round-trip time observed across probes, milliseconds.
    pub latency_ms: Option<u32>,
    /// Hosts that answered, used as evidence in the report.
    pub reachable_hosts: Vec<String>,
    /// Whether the winget CDN specifically is reachable. This is the probe that
    /// actually matters for installation, and it can fail independently of
    /// general internet access (campus firewalls, captive portals).
    pub winget_reachable: bool,
    /// Proxy inherited from the environment, if any.
    pub proxy: Option<String>,
}

/// Snapshot of everything the detection module knows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReport {
    pub windows: WindowsInfo,
    pub admin: AdminInfo,
    pub disks: Vec<DiskInfo>,
    pub network: NetworkInfo,
    /// CPU, memory, GPU and virtualisation.
    ///
    /// Added in P4.5. `#[serde(default)]` rather than required so a report
    /// captured before this field existed still deserialises — the field is
    /// additive, and a saved report losing its hardware section is preferable to
    /// failing to load at all.
    #[serde(default)]
    pub machine: super::modules::machine::MachineFacts,
    /// One signal per user-facing check row, in display order.
    pub signals: Vec<Signal>,
    /// Weighted 0-100 environment score.
    pub score: u8,
    /// Scores summed to this much; used to explain the number in the UI.
    pub score_max: f32,
    pub blocking_count: u32,
    pub warning_count: u32,
}

impl EnvironmentReport {
    /// Recomputes `score`, `score_max` and the severity counters from
    /// `signals`. Called once at the end of detection so the individual probes
    /// never have to maintain a running total.
    pub fn recalculate(&mut self) {
        let mut earned = 0.0f32;
        let mut max = 0.0f32;
        let mut blocking = 0u32;
        let mut warning = 0u32;

        for signal in &self.signals {
            if let (Some(score), Some(weight)) = (signal.score, signal.weight) {
                earned += score;
                max += weight;
            }
            match signal.severity {
                Severity::Blocking => blocking += 1,
                Severity::Warning => warning += 1,
                Severity::Info => {}
            }
        }

        self.score_max = max;
        self.score = if max > 0.0 {
            ((earned / max) * 100.0).round().clamp(0.0, 100.0) as u8
        } else {
            0
        };
        self.blocking_count = blocking;
        self.warning_count = warning;
    }
}

// ---------------------------------------------------------------------------
// Software inventory
// ---------------------------------------------------------------------------

/// Every piece of software V0.1 knows how to install. The enum exists so
/// profiles, installers and the verifier share one vocabulary; adding "MCP" or
/// "Skills" later means adding a variant, and the compiler points at every
/// `match` that must handle it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SoftwareId {
    // `snake_case` matches `key()` for every variant, so the JSON spelling used
    // in profile files and the JSON sent to the frontend are the same string —
    // no custom (de)serialisers, no second spelling to keep in sync.
    Vscode,
    Git,
    Python,
    Node,
    ClaudeDesktop,
    ClaudeCode,
    Codex,
    Docker,
    Cursor,
    Wsl,
    /// The C/C++ toolchain MSVC build tools, which is what a CS course needs
    /// (not Visual Studio itself, which is a different and much larger product).
    MsvcBuildTools,
    Cmake,
    Npm,
    Pnpm,
    Uv,
    Rust,
    Java,
    Gemini,
    OpenCode,
    Continue,
    Jetbrains,
    /// ChatGPT's Windows desktop app.
    ///
    /// Distinct from [`SoftwareId::Codex`] even though the two share an OEM
    /// identity on disk: Codex is the developer CLI/app, this is the plain chat
    /// client a student installs first. They are separate rows because a student
    /// who wants "the ChatGPT app" has no way to know it appears under a name
    /// containing "Codex".
    ///
    /// Spelled `ChatgptDesktop` rather than `ChatGptDesktop` so the derived
    /// `snake_case` key is `chatgpt_desktop` — the spelling a student would type
    /// in a profile file. The acronym casing is a Rust-style concern; the key is
    /// product surface, and `key()` remains the single source of truth for it.
    ChatgptDesktop,
    /// Windsurf, an AI-first editor competing with Cursor.
    Windsurf,
    /// LM Studio, the local-model runner a student uses to try models offline.
    LmStudio,
    /// Windows Terminal — the modern console host.
    ///
    /// Distinct from [`SoftwareId::Wsl`]: WSL provides the Linux environment,
    /// this provides the tabbed terminal most tutorials screenshot. A student
    /// following a WSL guide sees "open Windows Terminal", and on a machine that
    /// only has the legacy `conhost` window that instruction has no equivalent.
    WindowsTerminal,
    /// Qwen Code — Alibaba's open-source terminal coding agent.
    ///
    /// Official channel is npm (`@qwen-code/qwen-code`, which installs the
    /// `qwen` command) with the source at `github.com/QwenLM/qwen-code`. Added
    /// because it is one of the few Chinese-lab coding agents that ships a real
    /// Windows install path *and* a CLI this tool can verify — the criterion the
    /// brief sets, rather than "it is Chinese".
    QwenCode,
    /// Kimi Code CLI — Moonshot AI's terminal coding agent.
    ///
    /// Distribution is the part worth stating: Moonshot ships **only** a GitHub
    /// release archive per platform (`MoonshotAI/kimi-cli`), not an npm package.
    /// The `kimi-cli` package on npm is an unrelated placeholder, so installing
    /// by that name would fetch a stranger's code. The catalog therefore models
    /// this as a release-archive install, and the knowledge file says so.
    KimiCli,
    /// CC Switch — a desktop switcher for AI coding CLI profiles.
    ///
    /// Verified on the author's machine as product name "CC Switch", company
    /// "ccswitch", version 3.19.2 (a portable build with no registry uninstall
    /// entry). Upstream is `github.com/farion1231/cc-switch`.
    ///
    /// It is the one entry here that **writes other tools' configuration**: a
    /// read-only probe on this machine found it had already touched `~/.claude/`
    /// and `~/.codex/`, and its own `%APPDATA%\cc-switch\path-backups\` shows it
    /// rewrites PATH. It is therefore detected and explained but deliberately
    /// **not** auto-installed — see its knowledge file.
    CcSwitch,
    /// Crush — Charm's terminal coding agent.
    ///
    /// Official npm scope is `@charmland/crush` (repository
    /// `github.com/charmbracelet/crush`). The unscoped `crush` package is a
    /// different, unrelated project, which is exactly why the profile must name
    /// the scope.
    Crush,
    // -----------------------------------------------------------------------
    // 0.1.2 — AI chat clients and AIGC creation tools.
    //
    // These are the entries the product's own audience kept asking for. A
    // student who wants 豆包 or 剪映 is not being served by a catalogue that only
    // knows compilers, and the brief's instruction was explicit: expand into
    // AI- and AIGC-related software rather than more developer tooling.
    //
    // Every `winget` id below was verified live with `winget show` (the version
    // output at the time is recorded in `catalog.rs`). Two candidates were
    // *rejected* rather than guessed at:
    //
    // * **即梦AI** (`XPFFCMLPD8RSBG`) — `winget search` lists it, but
    //   `winget show` on that id fails with `0x8a150039 : REST 源返回的数据无效`.
    //   The Store entry is malformed upstream, so an install would fail at the
    //   first step with an error that reads to a student as "this app is broken".
    //   Excluded until the upstream entry resolves.
    // * **TapNow** — not in `winget` at all (`winget search tapnow` finds
    //   nothing), though it *is* installed on the reference machine as an ARP
    //   entry (`TapNow 0.4.23`). No unattended route exists, so listing it would
    //   mean inventing a package id.
    // -----------------------------------------------------------------------
    /// 豆包 — ByteDance's AI assistant desktop client.
    Doubao,
    /// Cherry Studio — multi-model desktop client (OpenAI/Claude/Gemini/local).
    CherryStudio,
    /// Chatbox — lightweight multi-model chat client.
    Chatbox,
    /// 剪映专业版 — ByteDance's video editor, the mainstream Chinese AIGC
    /// creation tool for students.
    JianyingPro,
    /// CapCut — the international build of the same editor.
    CapCut,
    /// ComfyUI Desktop — node-based image-generation workflow tool, the standard
    /// local front end for Stable Diffusion-style models.
    ComfyUi,
    /// Google's *desktop* Gemini app — distinct from [`SoftwareId::Gemini`],
    /// which is the `@google/gemini-cli` command-line agent.
    ///
    /// The two are separate entries for the same reason ChatGPT and Codex are:
    /// a student who wants "the Gemini app" is not served by a row named
    /// "Gemini CLI" that installs an npm package. The desktop app installs
    /// through the vendor's own Windows installer.
    ///
    /// The catalog routes this through `winget` id `Google.GoogleDesktop`
    /// (verified live with `winget show`, which reports version `152.0.7933.0`
    /// and tag `google-gemini`). That version matches the `GeminiSetup.exe` the
    /// user downloaded from Google's own site byte-for-byte at the version
    /// field, which is how the id was confirmed rather than guessed at.
    GeminiDesktop,
    /// Dynamic software discovered and installed via winget
    Dynamic,
}

impl SoftwareId {
    pub const ALL: [SoftwareId; 36] = [
        SoftwareId::Vscode,
        SoftwareId::Git,
        SoftwareId::Python,
        SoftwareId::Node,
        SoftwareId::ClaudeDesktop,
        SoftwareId::ClaudeCode,
        SoftwareId::Codex,
        SoftwareId::ChatgptDesktop,
        SoftwareId::Docker,
        SoftwareId::Cursor,
        SoftwareId::Windsurf,
        SoftwareId::Wsl,
        SoftwareId::MsvcBuildTools,
        SoftwareId::Cmake,
        SoftwareId::Npm,
        SoftwareId::Pnpm,
        SoftwareId::Uv,
        SoftwareId::Rust,
        SoftwareId::Java,
        SoftwareId::Gemini,
        SoftwareId::OpenCode,
        SoftwareId::Continue,
        SoftwareId::LmStudio,
        SoftwareId::Jetbrains,
        SoftwareId::WindowsTerminal,
        SoftwareId::QwenCode,
        SoftwareId::KimiCli,
        SoftwareId::CcSwitch,
        SoftwareId::Crush,
        // 0.1.2 — AI chat clients and AIGC creation tools.
        SoftwareId::Doubao,
        SoftwareId::CherryStudio,
        SoftwareId::Chatbox,
        SoftwareId::JianyingPro,
        SoftwareId::CapCut,
        SoftwareId::ComfyUi,
        SoftwareId::GeminiDesktop,
    ];

    /// Stable key used in JSON profiles and in the report.
    pub fn key(self) -> &'static str {
        match self {
            SoftwareId::Vscode => "vscode",
            SoftwareId::Git => "git",
            SoftwareId::Python => "python",
            SoftwareId::Node => "node",
            SoftwareId::ClaudeDesktop => "claude_desktop",
            SoftwareId::ClaudeCode => "claude_code",
            SoftwareId::Codex => "codex",
            SoftwareId::Docker => "docker",
            SoftwareId::Cursor => "cursor",
            SoftwareId::Wsl => "wsl",
            SoftwareId::WindowsTerminal => "windows_terminal",
            SoftwareId::MsvcBuildTools => "msvc_build_tools",
            SoftwareId::Cmake => "cmake",
            SoftwareId::Npm => "npm",
            SoftwareId::Pnpm => "pnpm",
            SoftwareId::Uv => "uv",
            SoftwareId::ChatgptDesktop => "chatgpt_desktop",
            SoftwareId::Windsurf => "windsurf",
            SoftwareId::LmStudio => "lm_studio",
            SoftwareId::Rust => "rust",
            SoftwareId::Java => "java",
            SoftwareId::Gemini => "gemini",
            SoftwareId::OpenCode => "opencode",
            SoftwareId::Continue => "continue",
            SoftwareId::Jetbrains => "jetbrains",
            SoftwareId::QwenCode => "qwen_code",
            SoftwareId::KimiCli => "kimi_cli",
            SoftwareId::CcSwitch => "cc_switch",
            SoftwareId::Crush => "crush",
            SoftwareId::Doubao => "doubao",
            SoftwareId::CherryStudio => "cherry_studio",
            SoftwareId::Chatbox => "chatbox",
            SoftwareId::JianyingPro => "jianying_pro",
            SoftwareId::CapCut => "capcut",
            SoftwareId::ComfyUi => "comfyui",
            SoftwareId::GeminiDesktop => "gemini_desktop",
            SoftwareId::Dynamic => "dynamic",
        }
    }

    /// Chinese display name (the primary locale for this product).
    pub fn display_name(self) -> &'static str {
        match self {
            SoftwareId::Vscode => "VS Code",
            SoftwareId::Git => "Git",
            SoftwareId::Python => "Python",
            SoftwareId::Node => "Node.js",
            SoftwareId::ClaudeDesktop => "Claude Desktop",
            SoftwareId::ClaudeCode => "Claude Code",
            SoftwareId::Codex => "Codex",
            SoftwareId::Docker => "Docker",
            SoftwareId::Cursor => "Cursor",
            SoftwareId::Wsl => "WSL",
            SoftwareId::WindowsTerminal => "Windows Terminal",
            SoftwareId::MsvcBuildTools => "MSVC 编译工具",
            SoftwareId::Cmake => "CMake",
            SoftwareId::Npm => "npm",
            SoftwareId::Pnpm => "pnpm",
            SoftwareId::Uv => "uv",
            SoftwareId::ChatgptDesktop => "ChatGPT",
            SoftwareId::Windsurf => "Windsurf",
            SoftwareId::LmStudio => "LM Studio",
            SoftwareId::Rust => "Rust",
            SoftwareId::Java => "Java",
            SoftwareId::Gemini => "Gemini CLI",
            SoftwareId::OpenCode => "OpenCode",
            SoftwareId::Continue => "Continue",
            SoftwareId::Jetbrains => "JetBrains 系列",
            SoftwareId::QwenCode => "通义千问的命令行编程助手",
            SoftwareId::KimiCli => "月之暗面的命令行编程助手",
            SoftwareId::CcSwitch => "在多个 AI 编程工具之间切换配置",
            SoftwareId::Crush => "Charm 出品的终端编程助手",
            SoftwareId::Doubao => "豆包",
            SoftwareId::CherryStudio => "Cherry Studio",
            SoftwareId::Chatbox => "Chatbox",
            SoftwareId::JianyingPro => "剪映专业版",
            SoftwareId::CapCut => "CapCut",
            SoftwareId::ComfyUi => "ComfyUI",
            SoftwareId::GeminiDesktop => "Gemini",
            SoftwareId::Dynamic => "动态应用",
        }
    }

    /// One-line description of *why a student needs this*.
    ///
    /// A missing entry here is not a cosmetic gap: the dashboard renders this
    /// string under every row, and a student who does not already know what
    /// "pnpm" is gets nothing from seeing that it is installed.
    pub fn purpose(self) -> &'static str {
        match self {
            SoftwareId::Vscode => "写代码的编辑器",
            SoftwareId::Git => "代码版本管理与下载",
            SoftwareId::Python => "AI 脚本与工具运行环境",
            SoftwareId::Node => "许多 AI 工具的运行环境",
            SoftwareId::ClaudeDesktop => "桌面版 Claude 助手",
            SoftwareId::ClaudeCode => "终端里的 AI 编程助手",
            SoftwareId::Codex => "OpenAI 的 AI 编程助手",
            SoftwareId::Docker => "打包与运行服务，换台电脑也能跑",
            SoftwareId::Cursor => "内置 AI 的代码编辑器",
            SoftwareId::Wsl => "在 Windows 里直接用 Linux",
            SoftwareId::WindowsTerminal => "更好用的终端，支持多标签与分屏",
            SoftwareId::MsvcBuildTools => "编译 C/C++ 程序",
            SoftwareId::Cmake => "管理 C/C++ 项目的构建",
            SoftwareId::Npm => "安装与运行 JavaScript 工具",
            SoftwareId::Pnpm => "更快、更省磁盘的包管理器",
            SoftwareId::Uv => "极快的 Python 包管理器",
            SoftwareId::ChatgptDesktop => "OpenAI 官方桌面聊天客户端",
            SoftwareId::Windsurf => "内置 AI 的代码编辑器，新手容易上手",
            SoftwareId::LmStudio => "在本机离线运行开源大模型",
            SoftwareId::Rust => "系统级语言，许多工具由它编写",
            SoftwareId::Java => "Java 课程与工具运行环境",
            SoftwareId::Gemini => "Google 的命令行 AI 助手",
            SoftwareId::OpenCode => "开源的终端 AI 编程助手",
            SoftwareId::Continue => "编辑器里的开源 AI 插件",
            SoftwareId::QwenCode => "阿里通义官方的命令行 AI 编程助手",
            SoftwareId::KimiCli => "Kimi 官方的命令行 AI 编程助手",
            SoftwareId::CcSwitch => "一键切换 Claude Code / Codex 等工具的配置",
            SoftwareId::Crush => "命令行里的 AI 编程助手，界面漂亮",
            SoftwareId::Jetbrains => "PyCharm / IDEA 等专业 IDE",
            SoftwareId::Doubao => "字节跳动的 AI 助手，日常问答与写作",
            SoftwareId::CherryStudio => "一个客户端接入多家 AI 模型",
            SoftwareId::Chatbox => "轻量的多模型聊天客户端",
            SoftwareId::JianyingPro => "剪视频、做字幕，AI 一键成片",
            SoftwareId::CapCut => "剪映国际版，功能与剪映一致",
            SoftwareId::ComfyUi => "节点式 AI 绘画，本地出图",
            SoftwareId::GeminiDesktop => "Google 官方桌面聊天客户端",
            SoftwareId::Dynamic => "通过 winget 检索安装的自定义软件包",
        }
    }

    /// Which group the dashboard files this under.
    ///
    /// Data rather than a `match` in the UI, so adding a program is one row in
    /// this file and it lands in the right section with the right explanation.
    pub fn category(self) -> SoftwareCategory {
        match self {
            SoftwareId::Vscode
            | SoftwareId::Cursor
            | SoftwareId::Windsurf
            | SoftwareId::Jetbrains
            | SoftwareId::Continue => SoftwareCategory::Editor,
            SoftwareId::ClaudeDesktop
            | SoftwareId::ClaudeCode
            | SoftwareId::Codex
            | SoftwareId::ChatgptDesktop
            | SoftwareId::Gemini
            | SoftwareId::GeminiDesktop
            | SoftwareId::OpenCode
            | SoftwareId::QwenCode
            | SoftwareId::KimiCli
            | SoftwareId::Crush
            | SoftwareId::CcSwitch
            | SoftwareId::LmStudio => SoftwareCategory::AiTool,
            SoftwareId::Docker | SoftwareId::Wsl | SoftwareId::WindowsTerminal => {
                SoftwareCategory::Runtime
            }
            // Creation tools, kept apart from the coding assistants above: a
            // student after 剪映 is not looking through a list of CLI agents.
            SoftwareId::Doubao
            | SoftwareId::CherryStudio
            | SoftwareId::Chatbox
            | SoftwareId::JianyingPro
            | SoftwareId::CapCut
            | SoftwareId::ComfyUi
            | SoftwareId::Dynamic => SoftwareCategory::AiCreative,
            SoftwareId::Python
            | SoftwareId::Node
            | SoftwareId::Git
            | SoftwareId::MsvcBuildTools
            | SoftwareId::Cmake
            | SoftwareId::Npm
            | SoftwareId::Pnpm
            | SoftwareId::Uv
            | SoftwareId::Rust
            | SoftwareId::Java => SoftwareCategory::Development,
        }
    }

    /// Whether the product can install this itself.
    ///
    /// `false` for anything detected but not managed. The dashboard renders
    /// those with an explanation and no action button, which is the honest
    /// presentation: "you have it / you don't, and here is where to get it" —
    /// rather than an install button that would fail.
    ///
    /// The bar for `true` is *reliable unattended install*, not merely "an
    /// installer exists". `ChatGptDesktop` and `Windsurf` qualify because both
    /// publish a winget package that installs without a browser round-trip;
    /// `LmStudio` does not, because its package is a moving target and the first
    /// run requires a multi-GB model choice the student must make themselves.
    ///
    /// Note the asymmetry with [`CatalogEntry::is_installable`], which is derived
    /// from the catalog's `install` list. This function is the *policy* statement
    /// and that one is the *data*; `entries_without_a_strategy_are_exactly_the_ones_declared_detect_only`
    /// asserts the two never disagree, so a program cannot drift into being
    /// installable in one place and not the other.
    pub fn installable(self) -> bool {
        matches!(
            self,
            SoftwareId::Vscode
                | SoftwareId::Git
                | SoftwareId::Python
                | SoftwareId::Node
                | SoftwareId::ClaudeDesktop
                | SoftwareId::ClaudeCode
                | SoftwareId::Codex
                | SoftwareId::ChatgptDesktop
                | SoftwareId::Windsurf
                // Ships as an MSIX/Store package with a stable winget id and
                // installs silently, so it meets the same bar as the rest of
                // this list rather than the "detect only" bar.
                | SoftwareId::WindowsTerminal
                // Both install unattended from an official npm package with a
                // stable, vendor-published name, which is the same bar the rest
                // of this list meets.
                //
                // `KimiCli` is deliberately *not* here: Moonshot publishes no
                // official package manager channel (only a GitHub release
                // archive), so there is no unattended strategy this tool can
                // stand behind. `CcSwitch` is not here either — it rewrites
                // other tools' configuration, so an unattended install is the
                // exact harm the brief forbids.
                | SoftwareId::QwenCode
                | SoftwareId::Crush
                // 0.1.2 — promoted from detect-only to installable.
                //
                // Each of these had a working, vendor-published `winget` package
                // all along; they were listed as detect-only because the original
                // design argued that an installer which needs a reboot (Docker) or
                // a firmware setting (WSL) is worse than one that explains itself.
                // That reasoning does not survive contact with a product whose
                // promise is 一键安装: the screen showed a package id and then
                // refused to use it, which reads as "this tool doesn't work".
                // Docker still warns about the reboot — in its rationale, where a
                // warning belongs — instead of blocking the install.
                //
                // Every id below was verified live with `winget show` before being
                // added (versions recorded in `catalog.rs`). WSL is deliberately
                // *not* here: it is a Windows optional feature rather than a
                // package, and `wsl --install` changes boot configuration.
                | SoftwareId::Docker
                | SoftwareId::Cursor
                | SoftwareId::MsvcBuildTools
                | SoftwareId::Cmake
                | SoftwareId::Java
                | SoftwareId::Rust
                | SoftwareId::Uv
                | SoftwareId::Pnpm
                // 0.1.2 — the AIGC batch. All six ship as signed vendor
                // installers available from `winget`, verified live; two of them
                // (剪映, 豆包) were already present on the reference machine, so
                // their declared ids were observed in `winget list` rather than
                // only in `winget search` — which is the stronger evidence.
                | SoftwareId::Doubao
                | SoftwareId::CherryStudio
                | SoftwareId::Chatbox
                | SoftwareId::JianyingPro
                | SoftwareId::CapCut
                | SoftwareId::ComfyUi
                // Gemini Desktop installs unattended from Google's own winget
                // package (`Google.GoogleDesktop`, verified live: 152.0.7933.0,
                // publisher Google), which is the same bar as the rest of this
                // list. Its older sibling `Gemini` (the CLI) is npm-installed
                // and remains detect-only.
                | SoftwareId::GeminiDesktop
                | SoftwareId::Dynamic
        )
    }

    pub fn from_key(key: &str) -> Option<Self> {
        if key == "dynamic" {
            return Some(SoftwareId::Dynamic);
        }
        Self::ALL.into_iter().find(|s| s.key() == key)
    }
}

/// The dashboard's software grouping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SoftwareCategory {
    /// Languages, version control, build tools.
    Development,
    /// Editors and IDEs.
    Editor,
    /// AI assistants, CLI and desktop.
    AiTool,
    /// Containers, virtual machines, runtimes.
    Runtime,
    /// AIGC creation tools — video, image, and general-purpose AI clients used
    /// to *make things* rather than to write code.
    ///
    /// Separated from [`SoftwareCategory::AiTool`] in 0.1.2 because the two answer
    /// different questions for a beginner. "AI 工具" is where you go to get a
    /// coding assistant; "AI 创作" is where you go to make a video or generate an
    /// image, and a student looking for 剪映 has no reason to open a list full of
    /// command-line agents. Grouping is product surface, not taxonomy.
    AiCreative,
}

impl SoftwareCategory {
    pub const ALL: [SoftwareCategory; 5] = [
        SoftwareCategory::Development,
        SoftwareCategory::Editor,
        SoftwareCategory::AiTool,
        SoftwareCategory::AiCreative,
        SoftwareCategory::Runtime,
    ];

    pub fn name(self) -> &'static str {
        match self {
            SoftwareCategory::Development => "开发工具",
            SoftwareCategory::Editor => "编辑器",
            SoftwareCategory::AiTool => "AI 工具",
            SoftwareCategory::AiCreative => "AI 创作",
            SoftwareCategory::Runtime => "运行环境",
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            SoftwareCategory::Development => "development",
            SoftwareCategory::Editor => "editor",
            SoftwareCategory::AiTool => "aiTool",
            SoftwareCategory::AiCreative => "aiCreative",
            SoftwareCategory::Runtime => "runtime",
        }
    }
}

/// Which independent source reported something about a program.
///
/// Ordered highest-precedence first, and the ordering is meaningful: when two
/// sources disagree about a version, the earlier one wins. `Registry` outranks
/// `Path` because the uninstall entry is the vendor's own declaration of what was
/// installed; `Path` outranks `Winget` because a binary that actually runs is
/// stronger evidence of *usability* than a package-manager record, which can
/// survive an uninstall.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProbeSource {
    Registry,
    Path,
    Winget,
}

/// What one source observed about one program.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceView {
    pub source: ProbeSource,
    /// `present` | `unavailable` | `absent`.
    pub outcome: String,
    /// The raw value the source supplied: version, path, registry key, or the
    /// reason the source could not answer.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AvailabilityKind {
    Cli,
    Gui,
    Config,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AvailabilityStatus {
    Available,
    Unavailable,
    Unknown,
    NotApplicable,
    LegacyUnverified,
}

/// Structured evidence distinguishing physical installation, execution outcome, and operational availability.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityEvidence {
    pub kind: AvailabilityKind,
    pub status: AvailabilityStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub evidence_source: String,
    pub observed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// The answer to "is this on the machine, and how sure are we?"
///
/// Named `installed`/`confidence` per the brief's field list. The two are
/// deliberately independent: a program can be `installed: false` with
/// `confidence: unknown`, which means "we could not check" and must never be
/// rendered as "not installed".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareInfo {
    pub id: SoftwareId,
    /// Display name, taken from the catalog rather than from whatever string a
    /// vendor happened to write into the registry.
    pub name: String,
    /// Whether at least one provider positively found it.
    pub installed: bool,
    pub version: Option<String>,
    /// Absolute path, only when the file was confirmed to exist on disk.
    pub path: Option<String>,
    /// Whether typing the bare command name actually resolves to `path`.
    pub on_path: bool,
    /// `ok` = walked the evidence and none of it is missing; `fail` = positively
    /// absent; `unknown` = every provider failed.
    pub confidence: Confidence,
    pub package_id: Option<String>,
    /// Every source that positively found it, for display as corroboration.
    pub sources: Vec<ProbeSource>,
    /// The full per-source audit trail, including the negative answers.
    pub evidence: Vec<EvidenceView>,
    /// Actionable notes, e.g. "installed but not callable from this terminal".
    pub hints: Vec<String>,
    /// Independent operational availability evidence (CLI runnable, GUI registered, Config validated).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability: Option<AvailabilityEvidence>,
}

/// The complete answer: what is on this machine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareInventory {
    pub items: Vec<SoftwareInfo>,
    pub scanned_at: String,
    /// The providers that produced this inventory, in precedence order. Shown in
    /// the advanced view so a surprising result can be traced to its source.
    pub providers: Vec<String>,
}

impl SoftwareInventory {
    pub fn find(&self, id: SoftwareId) -> Option<&SoftwareInfo> {
        self.items.iter().find(|item| item.id == id)
    }

    pub fn installed_count(&self) -> u32 {
        self.items.iter().filter(|i| i.installed).count() as u32
    }

    /// Programs whose status is genuinely unknown, so the UI can say so instead
    /// of listing them as missing.
    pub fn unknown_count(&self) -> u32 {
        self.items
            .iter()
            .filter(|i| !i.installed && i.confidence == Confidence::Unknown)
            .count() as u32
    }
}

/// Where the detection found a piece of software.
///
/// Kept for the stage-1 report format. Stage 2 replaced the single `detectedVia`
/// field with [`SoftwareInfo::sources`], which can express agreement between
/// providers instead of forcing one winner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DetectionMethod {
    /// Found by walking `PATH` and running `--version`.
    Path,
    /// Found via an uninstall registry key.
    Registry,
    /// Found via `winget list`.
    Winget,
    /// Not found by any method that we trust.
    NotFound,
}

impl From<ProbeSource> for DetectionMethod {
    fn from(source: ProbeSource) -> Self {
        match source {
            ProbeSource::Path => DetectionMethod::Path,
            ProbeSource::Registry => DetectionMethod::Registry,
            ProbeSource::Winget => DetectionMethod::Winget,
        }
    }
}

/// Result of a full software scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareScan {
    /// The stage-2 inventory, which is what every current consumer reads.
    pub inventory: SoftwareInventory,
    pub scanned_at: String,
}

impl SoftwareScan {
    /// Adapts the inventory to the flat shape the verifier and the planner use.
    ///
    /// The verifier predates the inventory and works from one row per program;
    /// rather than duplicate the merge logic there, it reads this view. The
    /// single `detected_via` is the highest-precedence source that found it,
    /// which is lossy — the lossless list is [`SoftwareInfo::sources`], and the
    /// UI reads that.
    pub fn items(&self) -> Vec<InstalledSoftware> {
        self.inventory
            .items
            .iter()
            .map(|item| InstalledSoftware {
                id: item.id,
                name: item.name.clone(),
                installed: item.installed,
                version: item.version.clone(),
                path: item.path.clone(),
                on_path: item.on_path,
                detected_via: item
                    .sources
                    .first()
                    .map(|s| DetectionMethod::from(*s))
                    .unwrap_or(DetectionMethod::NotFound),
                package_id: item.package_id.clone(),
            })
            .collect()
    }

    pub fn find(&self, id: SoftwareId) -> Option<&SoftwareInfo> {
        self.inventory.find(id)
    }
}

/// One row of the flat legacy view, produced by [`SoftwareScan::items`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSoftware {
    pub id: SoftwareId,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub on_path: bool,
    pub detected_via: DetectionMethod,
    pub package_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/// A profile is a *curated starting point*, not a package list. The extra
/// fields (`audience`, `rationale`, `estimated_minutes`) exist so the UI can
/// explain the choice to someone who does not yet know what a "profile" is.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub tagline: String,
    /// Who this is for, e.g. "刚接触 AI 的同学".
    pub audience: String,
    /// Why these programs are included.
    pub rationale: String,
    pub software: Vec<SoftwareId>,
    /// Concrete steps performed after installation (localisation, git config…).
    pub configure: Vec<String>,
    pub estimated_minutes: u32,
    /// Approximate download size, for the disk-space check.
    pub estimated_download_mb: u32,
    /// Whether this profile needs an elevated shell at some point.
    pub requires_admin: bool,
    /// Reserved for stage 3+: MCP servers and skills are declared here but not
    /// yet installed. Declaring them now keeps profile files stable.
    #[serde(default)]
    pub future: ProfileFuture,
    /// Stage 4: what to configure after installing. Absent in an older profile
    /// file, which is why it defaults rather than being required — an existing
    /// `campus.json` keeps working and simply plans no bootstrap steps.
    #[serde(default)]
    pub bootstrap: ProfileBootstrap,
    /// Stage 5: capability ids this profile explicitly aims at.
    ///
    /// **Optional and usually unnecessary.** The capability set is derived from
    /// `software` (see `capability::from_profile`), so a profile that lists
    /// Python and VS Code already projects onto `python-development` without
    /// saying so. This key exists for the case the derivation cannot see: a
    /// profile that intends a capability whose *programs* it obtains elsewhere,
    /// or a campus profile that wants to foreground one goal.
    ///
    /// An id that is not in the capability table is reported as a warning rather
    /// than silently dropped — a typo here should be visible.
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFuture {
    #[serde(default)]
    pub mcp: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub agents: Vec<String>,
}

// ---------------------------------------------------------------------------
// Profile: bootstrap declarations (stage 4)
// ---------------------------------------------------------------------------

/// What a profile asks to be *configured*, as opposed to installed.
///
/// This is the stage-4 extension of the profile format, and the design rule from
/// stage 1 still holds: **a profile describes requirements; it never contains
/// logic.** There is no `"if"`, no ordering directive, no command to run. Every
/// list here is a list of ids or values that the planner already knows how to
/// interpret, which is what lets a school ship `campus.json` without a rebuild.
///
/// The one place that is easy to get wrong: `settings` values are *data* merged
/// into the target's own settings file. A profile cannot name a script path, a
/// shell command, or an environment variable to set — those would be execution
/// instructions smuggled through a data file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBootstrap {
    #[serde(default)]
    pub vscode: VscodeBootstrap,
    #[serde(default)]
    pub git: GitBootstrap,
    /// MCP servers to register.
    #[serde(default)]
    pub mcp: Vec<McpBootstrap>,
    /// Skill names. Each resolves to a directory shipped with the app.
    #[serde(default)]
    pub skills: Vec<String>,
    /// Localisation ids, resolved against the localisation catalogue.
    #[serde(default)]
    pub localization: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VscodeBootstrap {
    /// Marketplace ids in `publisher.name` form, optionally `@version`-pinned.
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Settings to merge into the user's settings file.
    ///
    /// Keys may be dotted (`editor.fontSize`) or not; the writer resolves them
    /// against the existing file — see `bootstrap::config`.
    #[serde(default)]
    pub settings: std::collections::BTreeMap<String, serde_json::Value>,
    /// Override for the settings file location. Rarely needed, and only
    /// honoured when it falls inside the run's allowed roots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings_file: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBootstrap {
    /// Whether to check the identity and apply the baseline behaviour settings.
    #[serde(default)]
    pub configure: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    Stdio,
    Http,
}

impl Default for McpTransport {
    fn default() -> Self {
        Self::Stdio
    }
}

/// One MCP server declaration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBootstrap {
    pub name: String,
    /// Preserved for display and backward-compatibility.
    #[serde(default)]
    pub spec: String,
    #[serde(default)]
    pub executable: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub transport: McpTransport,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_names: Option<Vec<String>>,
}

// ---------------------------------------------------------------------------
// Installation planning and execution
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallerKind {
    Exe,
    Msi,
    Ps1,
    Cmd,
    Bat,
    Unsupported,
}

impl InstallerKind {
    pub fn from_url_pathname(url: &str) -> Self {
        let path = url.split('?').next().unwrap_or(url);
        let path = path.split('#').next().unwrap_or(path);
        let lower = path.to_lowercase();
        if lower.ends_with(".exe") {
            InstallerKind::Exe
        } else if lower.ends_with(".msi") {
            InstallerKind::Msi
        } else if lower.ends_with(".ps1") {
            InstallerKind::Ps1
        } else if lower.ends_with(".cmd") {
            InstallerKind::Cmd
        } else if lower.ends_with(".bat") {
            InstallerKind::Bat
        } else {
            InstallerKind::Unsupported
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            InstallerKind::Exe => "exe",
            InstallerKind::Msi => "msi",
            InstallerKind::Ps1 => "ps1",
            InstallerKind::Cmd => "cmd",
            InstallerKind::Bat => "bat",
            InstallerKind::Unsupported => "bin",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScriptProgramKind {
    Npm,
    Npx,
    Pip,
    Python,
    PowerShell,
    Cmd,
}

/// How an installer will obtain the software. Modelled explicitly so the
/// "don't maintain your own binaries" rule is enforced by the type system:
/// there is no `BundledBinary` variant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallSource {
    /// `winget install --id <id>` — the preferred path.
    ///
    /// No `--source` is passed: winget's default resolution handles both
    /// community package ids and Microsoft Store product ids (`9PLM9XGG6VKS`),
    /// because the `msstore` source is registered and non-explicit. Verified on
    /// winget 1.29.290 — pinning `--source winget` for a store id breaks it with
    /// 0x8A150014, so leaving the source unset is the working case.
    Winget { package_id: String },
    /// Official installer, downloaded at runtime from the vendor and passed to
    /// the OS. Used only where winget has no package or ships something stale
    /// (Claude Desktop, Codex).
    OfficialInstaller {
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sha256: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        kind: Option<InstallerKind>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        vendor_id: Option<String>,
    },
    /// Installed through a package manager that is itself already present.
    Script {
        command: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        program_kind: Option<ScriptProgramKind>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        args: Option<Vec<String>>,
    },
    /// Nothing to install; configuration only (e.g. a local git config).
    ConfigurationOnly,
}

/// A single planned unit of work.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStep {
    pub id: SoftwareId,
    pub name: String,
    pub source: InstallSource,
    /// Human-readable explanation of the fallback order, surfaced in the UI.
    pub fallback_plan: Vec<String>,
    /// Already present and healthy — the step becomes a no-op.
    pub satisfied: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location_support: Option<InstallLocationSupport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_location: Option<String>,
}

/// Origin category of an install plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanOrigin {
    Profile,
    Selection,
}

/// The complete plan for a detected environment + chosen profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    /// The scenario the student started from. Empty is legitimate: a plan built
    /// from hand-picked programs has no profile to belong to, and nothing in the
    /// engine reads this field.
    pub profile_id: String,
    pub steps: Vec<InstallStep>,
    /// Steps that can start immediately.
    pub ready_count: u32,
    /// Steps that will be skipped because they are already satisfied.
    pub satisfied_count: u32,
    /// `None` when no profile supplied a number — the UI then shows no estimate
    /// rather than a figure invented from a step count. A wrong estimate is a
    /// promise the run has to break.
    #[serde(default)]
    pub estimated_minutes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_policy: Option<crate::modules::storage::StoragePolicy>,
}

/// Authoritative backend-owned record of an install plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRecord {
    pub plan_id: String,
    pub origin: PlanOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    pub steps: Vec<InstallStep>,
    pub ready_count: u32,
    pub satisfied_count: u32,
    pub estimated_minutes: Option<u32>,
    pub storage_policy: Option<crate::modules::storage::StoragePolicy>,
    pub storage_revision: u64,
    pub created_at: String,
}

impl PlanRecord {
    pub fn to_view(&self) -> PlanView {
        PlanView {
            plan_id: self.plan_id.clone(),
            origin: self.origin,
            profile_id: self.profile_id.clone(),
            steps: self.steps.clone(),
            ready_count: self.ready_count,
            satisfied_count: self.satisfied_count,
            estimated_minutes: self.estimated_minutes,
            storage_policy: self.storage_policy.clone(),
            storage_revision: self.storage_revision,
            created_at: self.created_at.clone(),
        }
    }
}

/// Display-only view of a plan returned to the client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanView {
    pub plan_id: String,
    pub origin: PlanOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    pub steps: Vec<InstallStep>,
    pub ready_count: u32,
    pub satisfied_count: u32,
    pub estimated_minutes: Option<u32>,
    pub storage_policy: Option<crate::modules::storage::StoragePolicy>,
    pub storage_revision: u64,
    pub created_at: String,
}

impl PlanView {
    pub fn to_install_plan(&self) -> InstallPlan {
        InstallPlan {
            profile_id: self.profile_id.clone().unwrap_or_default(),
            steps: self.steps.clone(),
            ready_count: self.ready_count,
            satisfied_count: self.satisfied_count,
            estimated_minutes: self.estimated_minutes,
            storage_policy: self.storage_policy.clone(),
        }
    }
}

/// IPC request payload to launch an install.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInstallRequest {
    pub plan_id: String,
    #[serde(default)]
    pub selected_step_ids: Option<Vec<SoftwareId>>,
    #[serde(default)]
    pub request_id: Option<String>,
}

/// Frozen snapshot of a plan saved into `TaskDocumentV1`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenPlan {
    pub plan_id: String,
    pub origin: PlanOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    pub catalog_revision: String,
    pub steps: Vec<InstallStep>,
    pub storage_policy: Option<crate::modules::storage::StoragePolicy>,
    pub storage_revision: u64,
    pub created_at: String,
}

/// On-disk task document adhering to schema `task-document.v1`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDocumentV1 {
    pub schema_version: String,
    pub task_id: String,
    pub status: String,
    pub frozen_plan: FrozenPlan,
    pub session: ExecutionSession,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attention_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    Pending,
    Running,
    Succeeded,
    /// Completed, but something needs the user's attention afterwards.
    SucceededWithWarning,
    Failed,
    /// Deliberately not run.
    Skipped,
    /// Not run because an earlier failure made it meaningless.
    Cancelled,
}

/// Streaming progress event. Sent to the frontend per step so the UI can show
/// a determinate progress bar without parsing logs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepProgress {
    pub step_id: SoftwareId,
    pub name: String,
    pub status: StepStatus,
    /// Index of the step in the plan, 0-based.
    pub index: u32,
    pub total: u32,
    /// Sub-stage label, e.g. "正在下载官方组件…".
    pub stage: String,
    /// 0.0-1.0 within the current step, when known.
    pub fraction: Option<f32>,
    /// Verbatim tool output. Rendered only in advanced mode.
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability: Option<AvailabilityEvidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_outcome: Option<AttemptOutcome>,
}

// ---------------------------------------------------------------------------
// Execution (stage 3)
// ---------------------------------------------------------------------------

/// What the engine actually did for one attempt.
///
/// This is a separate axis from [`StepStatus`] on purpose. `StepStatus` answers
/// "how did this program turn out"; `Outcome` answers "what did the OS say".
/// They disagree in the case that matters most: a fallback chain where link 1
/// failed and link 2 succeeded produces one `Failed` attempt and one `Succeeded`
/// attempt, and only the *last* outcome decides the step. Collapsing the two
/// would make "it worked on the second try" indistinguishable from "it worked
/// first time", which is exactly the diagnostic you need when a student reports
/// that installation is flaky.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttemptOutcome {
    /// Ran and the OS reported success (exit code 0).
    Succeeded,
    /// Ran and the OS reported success with warning (e.g. MSI 3010 / 1641 reboot required).
    SucceededWithWarning,
    /// Ran and the OS reported failure.
    Failed,
    /// Could not be started at all — the tool is missing (no winget), the
    /// download failed, or the process could not be spawned. Distinct from
    /// `Failed` because the fix is different: nothing was installed and nothing
    /// was changed, so retrying later can work.
    Unavailable,
    /// The action needs privileges this process does not have. Detected from the
    /// specific access-denied failure rather than guessed from the exit code, so
    /// it can be surfaced with the one instruction that fixes it.
    PermissionDenied,
    /// Not run: the program was already present, or an earlier step made it
    /// pointless.
    Skipped,
    /// Killed because the user cancelled, or the session was interrupted.
    Cancelled,
    /// Execution resources or durable state require intervention; never retry automatically.
    NeedsAttention,
}

impl AttemptOutcome {
    pub fn is_success(self) -> bool {
        matches!(
            self,
            AttemptOutcome::Succeeded
                | AttemptOutcome::SucceededWithWarning
                | AttemptOutcome::Skipped
        )
    }

    /// Whether a *different* link in the fallback chain could still succeed.
    ///
    /// `PermissionDenied` deliberately is not retryable: the next strategy in
    /// the chain runs under the same token, so trying the vendor installer after
    /// winget returned access-denied only doubles the failure. The honest answer
    /// is to stop and tell the student to re-run elevated.
    pub fn is_retryable(self) -> bool {
        matches!(
            self,
            AttemptOutcome::Failed | AttemptOutcome::Unavailable
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubjectKind {
    Software,
    Config,
    Plugin,
    Skill,
}

impl Default for SubjectKind {
    fn default() -> Self {
        Self::Software
    }
}

/// One executed action, recorded so the session is replayable after the fact.
///
/// The brief requires every installation to be "可追踪": this is the trace. It
/// is append-only for the lifetime of a session, and it survives a failed step
/// because the failing attempt is the most informative record in the log.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<SoftwareId>,
    #[serde(default)]
    pub subject_kind: SubjectKind,
    #[serde(default)]
    pub subject_id: String,
    /// The strategy that was attempted, in the same form the plan used.
    pub source: InstallSource,
    /// Human-readable description of the command, for the advanced view.
    pub command: String,
    pub started_at: String,
    pub finished_at: String,
    /// Wall-clock duration in milliseconds.
    pub duration_ms: u64,
    pub outcome: AttemptOutcome,
    /// Exit code, when a process actually ran.
    pub exit_code: Option<i32>,
    /// Captured stdout+stderr, truncated. The raw text is kept because a failed
    /// installation is undiagnosable without it, and it is only shown behind
    /// "高级模式".
    pub output: String,
    /// Set when `outcome` is not a success.
    pub error: Option<String>,
    /// Which link in the fallback chain this was, 0-based.
    pub attempt: u32,
    /// True when this was the attempt the step's final status came from.
    pub final_attempt: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
    NeedsAttention,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Running => "running",
            TaskStatus::Succeeded => "succeeded",
            TaskStatus::Failed => "failed",
            TaskStatus::Cancelled => "cancelled",
            TaskStatus::Interrupted => "interrupted",
            TaskStatus::NeedsAttention => "needsAttention",
        }
    }
}

fn default_task_status() -> TaskStatus {
    TaskStatus::NeedsAttention
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceStatus {
    Present,
    Absent,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageObservation {
    pub provider: String,
    pub package_id: String,
    pub presence: PresenceStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    pub observed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// The record of one installation run.
///
/// Holds everything needed to answer "what happened" without re-running
/// anything: the plan it was working from, every action it took, and the
/// inventory it observed afterwards.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionSession {
    /// Stable id, so a report can be tied to the session that produced it.
    pub id: String,
    pub profile_id: String,
    pub started_at: String,
    /// `None` while running.
    pub finished_at: Option<String>,
    #[serde(default = "default_task_status")]
    pub task_status: TaskStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_observation: Option<PackageObservation>,
    /// Every action attempted, in order.
    pub actions: Vec<ActionRecord>,
    /// Per-step results, which is what the UI renders.
    pub steps: Vec<StepProgress>,
    /// Steps that ended in failure or permission trouble, for quick access.
    pub failed_steps: Vec<SoftwareId>,
    /// Steps that were not attempted because an earlier failure blocked them.
    pub cancelled_steps: Vec<SoftwareId>,
    /// Ids still worth attempting. Non-empty means the session is resumable.
    pub remaining: Vec<SoftwareId>,
    /// The inventory taken *after* execution. `None` until verification runs.
    pub verified: Option<SoftwareInventory>,
    /// Why the whole run stopped early, if it did.
    pub halted_reason: Option<String>,
    pub cancelled_by_user: bool,
}

impl ExecutionSession {
    pub fn new(id: String, profile_id: String, started_at: String) -> Self {
        Self {
            id,
            profile_id,
            started_at,
            finished_at: None,
            task_status: TaskStatus::Running,
            package_observation: None,
            actions: Vec::new(),
            steps: Vec::new(),
            failed_steps: Vec::new(),
            cancelled_steps: Vec::new(),
            remaining: Vec::new(),
            verified: None,
            halted_reason: None,
            cancelled_by_user: false,
        }
    }

    /// Whether this session can be continued.
    ///
    /// A run that stopped for a reason the user must fix first — no privileges —
    /// is still resumable *after* they fix it, so the condition is "work is
    /// left", not "nothing was wrong".
    pub fn is_resumable(&self) -> bool {
        !self.remaining.is_empty() && !self.cancelled_by_user
    }

    pub fn succeeded_count(&self) -> u32 {
        self.steps
            .iter()
            .filter(|s| {
                matches!(
                    s.status,
                    StepStatus::Succeeded | StepStatus::SucceededWithWarning
                )
            })
            .count() as u32
    }

    /// The most recent action, for the UI's "current action" line.
    pub fn last_action(&self) -> Option<&ActionRecord> {
        self.actions.last()
    }

    pub fn is_success(&self) -> bool {
        self.failed_steps.is_empty() && self.remaining.is_empty() && !self.cancelled_by_user
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled_by_user
    }
}

/// Whether this process may attempt a given source at all, and why not.
///
/// Computed *before* execution so the UI can grey out a plan it cannot run,
/// rather than letting the student press a button and watch it fail. This is the
/// difference between "winget is missing, here is what we will do instead" and
/// an error dialog after three minutes of waiting.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionReadiness {
    /// Every blocker that applies to the plan as a whole.
    pub blockers: Vec<String>,
    /// True when at least one strategy per step can be attempted.
    pub can_start: bool,
    /// Whether winget was found on this machine, with its version when known.
    pub winget_version: Option<String>,
    /// Whether this process is elevated. Reported, never required: per-user
    /// winget installs work without it, and demanding elevation up front would
    /// lock out exactly the students this tool is for.
    pub is_elevated: bool,
    /// Steps that will need an elevated shell if they are to succeed.
    pub needs_admin: Vec<SoftwareId>,
}

// ---------------------------------------------------------------------------
// Configuration / localisation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigAction {
    pub id: String,
    pub target: String,
    pub description: String,
    /// `None` until applied.
    pub applied: Option<bool>,
    pub detail: Option<String>,
}

// ---------------------------------------------------------------------------
// Verification and reporting
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub key: String,
    pub label: String,
    pub confidence: Confidence,
    pub expected: Option<String>,
    pub observed: Option<String>,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageVerification {
    pub id: SoftwareId,
    pub name: String,
    /// The three checks the spec requires: present, on PATH, version sane.
    pub present: CheckResult,
    pub on_path: CheckResult,
    pub version: CheckResult,
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability: Option<AvailabilityEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReport {
    pub packages: Vec<PackageVerification>,
    pub passed_count: u32,
    pub failed_count: u32,
    /// `true` only when every planned package passed.
    pub overall_ok: bool,
}

/// The `Setup Center Report` written to disk and rendered in the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupReport {
    pub generated_at: String,
    pub app_version: String,
    pub profile_id: String,
    pub profile_name: String,
    pub environment_score: u8,
    pub environment: EnvironmentReport,
    pub plan: InstallPlan,
    pub verification: VerificationReport,
    pub config_actions: Vec<ConfigAction>,
    /// Skipped features, stated explicitly so the report is honest about scope.
    pub not_attempted: Vec<String>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "detail")]
pub enum AppError {
    #[error("unsupported Windows version: build {build}")]
    UnsupportedWindows { build: u32 },
    #[error("profile not found: {id}")]
    ProfileNotFound { id: String },
    #[error("profile file is invalid: {reason}")]
    ProfileInvalid { reason: String },
    #[error("未找到安装方案：{id}")]
    PlanNotFound { id: String },
    #[error("detection probe failed: {probe} ({reason})")]
    ProbeFailed { probe: String, reason: String },
    #[error("winget is unavailable: {reason}")]
    WingetUnavailable { reason: String },
    #[error("installation failed for {id}: {reason}")]
    InstallFailed { id: String, reason: String },
    /// The action is reserved for the paid tier and this machine is not
    /// activated for it.
    ///
    /// A first-class variant rather than an [`AppError::Internal`] string
    /// because the UI has to *recognise* it: a refusal must open the activation
    /// screen, not render as a red error. Encoding that decision in the error's
    /// `kind` means the frontend's job is a switch, not a string match against
    /// Chinese prose that could be reworded at any time.
    #[error("专业版功能：{reason}")]
    LicenseRequired { reason: String },
    /// The caller asked for something that is not a meaningful request — an
    /// empty program selection, for instance.
    ///
    /// Its own variant rather than [`AppError::Internal`] because it is the
    /// *caller's* mistake and the frontend can legitimately provoke it while
    /// the student is still choosing, which is not an internal fault worth
    /// reporting as one.
    #[error("请求无效：{reason}")]
    InvalidRequest { reason: String },
    #[error("internal error: {0}")]
    Internal(String),
}

pub type AppResult<T> = Result<T, AppError>;
