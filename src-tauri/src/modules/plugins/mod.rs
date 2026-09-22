//! Claude 增强插件中心 — PluginEntry / 检测链 / 兼容矩阵 / 安装管线。
//!
//! ## 为什么插件是独立的数据模型，而不是 Claude 软件条目上的几个字段
//!
//! [`crate::modules::catalog`] 回答的是"这台电脑装了什么软件"，它的条目是
//! `SoftwareDescriptor`。插件回答的是完全不同的问题："在**已装好的**软件之上，
//! 还能安全地叠加什么"。把插件塞进 `SoftwareDescriptor` 会立刻丢掉一整层
//! 语义 —— target、风险等级、回滚能力、上游许可证、验证阶段，这些字段对一个
//! winget 包 id 毫无意义。所以插件有自己的目录（`plugins/*.json`），加插件是
//! 加一条数据，不是改探测逻辑。
//!
//! ## 两个 target 是两条独立的链，不是一条链的两个参数
//!
//! 这是整个模块最重要的结构决定。Claude Desktop 是 Electron 应用，补丁作用于
//! `resources\` 下的 i18n JSON；Claude Code 是 native binary + 用户配置目录，
//! 增强作用于 `~/.claude`。两者的版本空间不同（Desktop `2.2553.1`、Code
//! `2.1.275`）、文件布局不同、失败模式不同、回滚方式也不同。
//!
//! 把它们合成一个 `target: String` 再靠 if 分流，正是 brief 明令禁止的
//! "拿 Desktop 的 app.asar patch 逻辑去处理 Claude Code"。所以
//! [`PluginTarget`] 是枚举，[`probe`] 为每个 target 走自己的探测链，
//! [`compat`] 为每个 target 查自己的版本矩阵，[`pipeline`] 只接受**已解析到
//! 单一 target** 的安装计划。
//!
//! ## 未验证版本是硬拒绝，不是警告
//!
//! [`CompatStatus::Unverified`] 会阻断 `RunMode::Install`，除非调用方显式传入
//! `allow_unverified`。这对应 brief 第六条："未验证版本绝对不要直接强制 patch"。
//! 对面向普通学生的产品，一个会静默改写应用文件、然后在下次更新后留下半坏状态
//! 的工具，比不提供该功能更糟。拒绝是默认行为，放行必须是一次有意识的点击。

pub mod compat;
pub mod pipeline;
pub mod probe;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/// 插件作用于哪个 Claude 目标。
///
/// `Both` 不是"两个都装"的快捷方式，而是"这条数据同时描述两条链上的两套
/// 兼容范围"。解析时仍会拆成单 target 的计划，见 [`PluginEntry::range_for`]。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginTarget {
    ClaudeDesktop,
    ClaudeCode,
    Both,
}

impl PluginTarget {
    /// UI 用的短标签。
    pub fn label(self) -> &'static str {
        match self {
            PluginTarget::ClaudeDesktop => "Claude Desktop",
            PluginTarget::ClaudeCode => "Claude Code",
            PluginTarget::Both => "Desktop 与 Code",
        }
    }
}

/// 风险等级 —— 决定 UI 的措辞强度，不决定是否放行。
///
/// 放行由 [`CompatStatus`] 决定。把两件事合并到一个字段会让"低风险但未验证"
/// 无法表达，而那恰恰是最危险的组合。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RiskLevel {
    /// 只写用户配置目录，不碰安装文件。
    Low,
    /// 会写入应用安装目录，但只新增文件。
    Medium,
    /// 会改写已有应用文件（chunk、二进制、asar）。
    High,
}

impl RiskLevel {
    pub fn label(self) -> &'static str {
        match self {
            RiskLevel::Low => "低",
            RiskLevel::Medium => "中",
            RiskLevel::High => "高",
        }
    }
}

/// 版本兼容判定结果。
///
/// 三态而非布尔：**"无法确认当前版本"** 与 **"确认不兼容"** 需要不同的措辞，
/// 把前者并入后者会让用户以为自己的版本被测过。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompatStatus {
    /// 当前版本在上游已验证范围内。
    Verified,
    /// 当前版本不在已验证范围内 —— 安装被默认阻断。
    Unverified,
    /// 明确不兼容（上游声明不支持该大版本）。
    Incompatible,
    /// 目标没装，无从判断。
    TargetMissing,
    /// 目标装了但版本读不出来。
    UnknownVersion,
}

impl CompatStatus {
    pub fn label(self) -> &'static str {
        match self {
            CompatStatus::Verified => "已验证",
            CompatStatus::Unverified => "未验证",
            CompatStatus::Incompatible => "不兼容",
            CompatStatus::TargetMissing => "目标未安装",
            CompatStatus::UnknownVersion => "版本未知",
        }
    }

    /// 是否允许默认安装。
    ///
    /// 只有 `Verified` 是 `true`。`TargetMissing` 与 `UnknownVersion` 同样为
    /// `false`：装不了和不敢装，在"是否按下按钮"这个问题上答案一致。
    pub fn allows_install(self) -> bool {
        matches!(self, CompatStatus::Verified)
    }
}

/// 研究报告要求的四级证据阶段。
///
/// 存在的理由是 brief 第十五条那句"不能把第三方 README 中的支持直接写成
/// Setup Center 已验证"。这个字段就是那道区分，且按**最保守**的一侧取值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvidenceStage {
    /// 只在上游找到该项目，未做任何集成。
    SourceFound,
    /// 已接入 Setup Center 的安装管线。
    Implemented,
    /// 在本项目内通过自动化测试。
    Tested,
    /// 在真实 Claude 安装上跑通完整链路。
    RealWorldVerified,
}

impl EvidenceStage {
    pub fn label(self) -> &'static str {
        match self {
            EvidenceStage::SourceFound => "SOURCE FOUND",
            EvidenceStage::Implemented => "IMPLEMENTED",
            EvidenceStage::Tested => "TESTED",
            EvidenceStage::RealWorldVerified => "REAL WORLD VERIFIED",
        }
    }
}

/// Claude Code 的四层能力模型（brief 第九条的原文分层）。
///
/// 层号越小越安全：**Layer 1–3 只碰 `~/.claude` 用户配置**，Claude Code 更新
/// 不影响它们，也不需要管理员权限；**Layer 4 改 native binary / cli.js**，
/// 每次更新都会失效，且失败会留下坏掉的 CLI。
///
/// 这个分层不是分类学装饰，它直接决定两件事：哪些层可以对**未验证版本**自动
/// 安装（1–3 可以），哪些层必须被 [`CompatStatus`] 拦住（只有 4）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodeLayer {
    /// Layer 1 — 官方插件能力：`~/.claude/plugins/<id>/`（manifest + hooks +
    /// output styles）。走 Claude Code 自己的插件机制，**不碰二进制**。
    Plugin,
    /// Layer 2 — Hook / Skill：SessionStart、Notification 等钩子脚本。
    Hook,
    /// Layer 3 — 配置增强：`settings.json` 深合并（如 `"language": "Chinese"`）。
    Config,
    /// Layer 4 — CLI patch：`cli.js` 或 native binary 内的硬编码文案。
    /// **唯一会因更新失效、且唯一需要已验证版本的一层。**
    CliPatch,
}

impl CodeLayer {
    pub fn label(self) -> &'static str {
        match self {
            CodeLayer::Plugin => "官方插件",
            CodeLayer::Hook => "Hook / Skill",
            CodeLayer::Config => "配置增强",
            CodeLayer::CliPatch => "CLI patch",
        }
    }

    /// UI 用的层号，与 brief 第九条的 `Layer N` 对齐。
    pub fn ordinal(self) -> u8 {
        match self {
            CodeLayer::Plugin => 1,
            CodeLayer::Hook => 2,
            CodeLayer::Config => 3,
            CodeLayer::CliPatch => 4,
        }
    }

    /// 该层是否依赖目标版本被验证。
    ///
    /// Layer 1–3 返回 `false`：它们写的是用户配置，与二进制版本无关。
    /// Layer 4 返回 `true`：上游 `support-matrix.md` 把 Windows native patch
    /// 明确标为 `experimental` 且逐版本列举，超出清单就是未验证。
    pub fn needs_verified_version(self) -> bool {
        matches!(self, CodeLayer::CliPatch)
    }
}

// ---------------------------------------------------------------------------
// 目录数据
// ---------------------------------------------------------------------------

/// 上游声明的已验证版本范围。
///
/// 用**前缀**而非语义化区间：上游项目自己就是按前缀声明的（`2.1.113 - 2.1.153`、
/// `适配 1.15200.0.0`），把它翻译成 semver 区间会凭空造出上游从未承诺过的
/// 中间版本。前缀匹配保持了与上游声明相同的信息量。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatRange {
    /// 针对 Claude Desktop 的**上游已枚举**版本。
    ///
    /// `javaht/claude-desktop-zh-cn` 全仓不发布任何版本清单，所以真实数据里
    /// 这个字段是空的 —— 空 = "上游未声明"，由 [`compat::evaluate`] 翻译成
    /// [`CompatStatus::Unverified`] 而不是"不兼容"。
    #[serde(default)]
    pub desktop: Vec<String>,
    /// Claude Code —— 上游 `stable` 档已验证版本（npm cli.js 形态）。
    #[serde(default)]
    pub code_stable: Vec<String>,
    /// Claude Code —— 上游 `experimental` 档已验证版本（Windows native）。
    #[serde(default)]
    pub code_experimental: Vec<String>,
    /// 上游兼容声明原文，原样展示给用户核对。
    #[serde(default)]
    pub note: String,
}

/// 一个插件条目 —— 即 brief 第三条要求的 `PluginEntry`。
///
/// 全部字段来自 `plugins/*.json`，**没有任何一条写在 Rust 里**：加插件是加一个
/// JSON 文件，改兼容范围是改一行数据。`requiresAdmin` / `rollbackSupported` 等
/// 字段是 UI 在用户按下按钮**之前**必须展示的事实（brief 第四条），所以它们是
/// 数据的一部分，不是安装时才推断出来的东西。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub target: PluginTarget,
    /// 分类：界面 / 开发 / Agent / 模型 / 效率。
    pub category: String,
    pub author: String,
    /// 上游仓库地址。**必须展示**：我们是在请用户执行别人的代码。
    pub source: String,
    pub license: String,
    /// 插件自身的版本（不是 Claude 的版本）。
    pub version: String,
    pub compatibility: CompatRange,
    /// 安装方式的人类描述，展示在"操作"一栏。
    pub install_method: String,
    pub requires_admin: bool,
    pub risk_level: RiskLevel,
    pub backup_required: bool,
    pub rollback_supported: bool,
    pub verify_supported: bool,
    /// 免费服务 —— 与 PRO 权限模型完全无关（brief 第十一条）。
    pub free: bool,
    /// 安装会触碰的文件/位置，按原样展示给用户。
    pub modifies: Vec<String>,
    /// 依赖（Node / Git / Claude 已安装 …），缺了要清晰提示。
    #[serde(default)]
    pub requires: Vec<String>,
    pub evidence: EvidenceStage,
    /// Claude Code 专用：本插件提供哪几层。Desktop 插件留空。
    #[serde(default)]
    pub layers: Vec<CodeLayer>,
    /// 上游适配的 Claude 版本说明，原样引用以便用户核对。
    #[serde(default)]
    pub upstream_note: String,
    /// 本插件的安装管线键，[`pipeline`] 据此分派。
    pub installer: String,
}

impl PluginEntry {
    /// 该 target 的完整兼容声明（含档位说明）。
    ///
    /// `Both` 直接调用时返回 Desktop 一侧 —— 那是**错误用法**，调用方必须先把
    /// `Both` 拆成两个单 target 的计划再查。保留这个返回是为了让编译通过，而不是
    /// 表示"两者等价"：真把它们等价看待，就是本模块 `probe.rs` 开头记的那个事故。
    pub fn range_for(&self, target: PluginTarget) -> &CompatRange {
        match target {
            PluginTarget::ClaudeDesktop | PluginTarget::Both => &self.compatibility,
            PluginTarget::ClaudeCode => &self.compatibility,
        }
    }
}

/// 插件目录。`plugins/*.json` 的加载结果。
#[derive(Debug, Clone, Default)]
pub struct PluginCatalog {
    pub entries: Vec<PluginEntry>,
}

impl PluginCatalog {
    /// 从目录加载。`dir` 不存在时返回空目录而不是错误 —— 单元测试与
    /// `cargo test` 下资源目录本就缺席，这是既有约定（见 `lib.rs`）。
    pub fn load(dir: &PathBuf) -> Self {
        let mut entries = Vec::new();
        if let Ok(rd) = std::fs::read_dir(dir) {
            for f in rd.flatten() {
                let p = f.path();
                if p.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(text) = std::fs::read_to_string(&p) {
                    match serde_json::from_str::<PluginEntry>(&text) {
                        Ok(e) => entries.push(e),
                        Err(err) => {
                            // 一条坏数据不能让整个中心消失：跳过并保留其余条目。
                            eprintln!("plugin catalog: skipping {}: {err}", p.display());
                        }
                    }
                }
            }
        }
        // 按分类 + id 排序，保证 UI 顺序稳定，不依赖文件系统枚举顺序。
        entries.sort_by(|a, b| (&a.category, &a.id).cmp(&(&b.category, &b.id)));
        Self { entries }
    }

    pub fn get(&self, id: &str) -> Option<&PluginEntry> {
        self.entries.iter().find(|e| e.id == id)
    }
}

// ---------------------------------------------------------------------------
// 运行时视图
// ---------------------------------------------------------------------------

/// 目标安装状态（brief 第十二条 UI 要显示的"Claude Desktop 已安装 ✓"）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetState {
    pub target: PluginTarget,
    pub installed: bool,
    pub version: Option<String>,
    /// 安装根目录，如 `%LOCALAPPDATA%\AnthropicClaude\app-2.2553.1`。
    pub root: Option<String>,
    pub running: bool,
    /// 已被第三方汉化过的痕迹（备份目录、zh-CN 译文文件）。
    pub localized: bool,
    /// 探测失败时的原因。`installed: false` + 这个字段非空 = "无法确认"。
    pub note: Option<String>,
}

/// 插件的完整状态视图 = 目录数据 + 本机判定。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
    #[serde(flatten)]
    pub entry: PluginEntry,
    /// 解析到的实际 target（`Both` 会按本机装了什么收敛）。
    pub resolved_target: PluginTarget,
    pub compat: CompatStatus,
    /// 判定理由，直接展示给用户。
    pub compat_reason: String,
    pub target_installed: bool,
    pub target_version: Option<String>,
    /// 已安装本插件。
    pub active: bool,
    /// 安装时记录的 Claude 版本；与当前不同 = 需要重新应用（brief 第七条）。
    pub installed_for_version: Option<String>,
    /// Claude 已更新、插件需要重新应用。
    pub stale: bool,
    /// 阻止安装的原因（冲突、目标未装、版本未验证 …）。空 = 可以安装。
    pub blocked_reason: Option<String>,
    /// 已有备份路径，存在即可回滚。
    pub backup: Option<String>,
    /// 本插件可提供的全部层，及每层是否可用（Claude Code）。
    pub layer_notes: Vec<(CodeLayer, bool, String)>,
}

// ---------------------------------------------------------------------------
// 管线结果
// ---------------------------------------------------------------------------

/// 安装管线的一个阶段（brief 第四条的可观察流程）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageOutcome {
    /// 稳定键，UI 用它做 testid：`detect` / `version` / `compat` /
    /// `conflict` / `backup` / `apply` / `verify` / `rollback` / `adopt`。
    pub key: String,
    pub label: String,
    /// `ok` | `warn` | `fail` | `skipped`。
    pub status: String,
    pub detail: String,
}

impl StageOutcome {
    pub fn ok(key: &str, label: &str, detail: impl Into<String>) -> Self {
        Self { key: key.into(), label: label.into(), status: "ok".into(), detail: detail.into() }
    }
    pub fn warn(key: &str, label: &str, detail: impl Into<String>) -> Self {
        Self { key: key.into(), label: label.into(), status: "warn".into(), detail: detail.into() }
    }
    pub fn fail(key: &str, label: &str, detail: impl Into<String>) -> Self {
        Self { key: key.into(), label: label.into(), status: "fail".into(), detail: detail.into() }
    }
    pub fn skipped(key: &str, label: &str, detail: impl Into<String>) -> Self {
        Self { key: key.into(), label: label.into(), status: "skipped".into(), detail: detail.into() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunMode {
    /// 只走检测与兼容性判断，一个字节都不写。
    DryRun,
    Install,
    Verify,
    Rollback,
    /// 接管既有安装：复用 `verify()` 判定已存在的汉化状态，只写**我们自己的**
    /// 状态记录 —— 不碰 Claude 文件、不执行上游脚本、不弹 UAC。因此它不经过
    /// 面向补丁写入的 compat 硬闸：那个闸保护的是别人的目标文件，而这里一个
    /// 字节都不改。存在理由：绕过 Setup Center 装好的汉化没有状态记录，UI 会
    /// 误报"未安装"，验证按钮也因此不出现。
    Adopt,
}

/// 一次运行的终局。
///
/// `Refused` 是独立成员，**不是** `Failed` 的一种。"我们主动拒绝了" 与
/// "我们尝试了但搞砸了" 对用户是两件事，后者才需要"已恢复原始文件"的安心话术
/// （brief 第十三条）。合并成 `failed` 会让拒绝看起来像事故。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Succeeded,
    Refused,
    Failed,
}

/// 一次插件运行的完整记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRun {
    pub plugin_id: String,
    pub mode: RunMode,
    pub status: RunStatus,
    /// 一行给用户的结论。
    pub reason: String,
    pub stages: Vec<StageOutcome>,
    /// 本次实际写入的路径。空 = 原文件未受影响。
    pub modified: Vec<String>,
    pub backup: Option<String>,
    /// 回滚是否已执行并成功。
    pub restored: bool,
    /// 是否需要"重新检测"按钮（失败/拒绝时为 true）。
    pub offer_retry: bool,
}

impl PluginRun {
    /// 是否在任何写入发生**之前**就停下了。
    ///
    /// 这是 brief 第十三条那句"原 Claude 未受影响"的判据，由数据得出而不是
    /// 由 UI 硬编码：只要 `modified` 为空，这句话就是真的。
    pub fn untouched(&self) -> bool {
        self.modified.is_empty()
    }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/// Setup Center 的用户数据根目录：`%LOCALAPPDATA%\Setup Center`。
///
/// 与 `license.dat` 同根，所以插件备份和授权文件共用一个已知位置。
pub fn data_root() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Setup Center")
}

/// 插件备份根：`%LOCALAPPDATA%\Setup Center\plugin-backups`。
pub fn backup_root() -> PathBuf {
    data_root().join("plugin-backups")
}

/// 插件状态文件 —— 记录"装了什么、装在哪个 Claude 版本上、备份在哪"。
///
/// 这个文件是第七条"Claude 更新后检测"的唯一依据：没有它，就无法回答
/// "当前插件是针对哪个版本安装的"，版本漂移只能靠猜。
pub fn state_path() -> PathBuf {
    data_root().join("plugin-state.json")
}

/// 一条已安装插件的记录。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRecord {
    pub plugin_id: String,
    pub target: PluginTarget,
    /// 安装时的 Claude 版本。
    pub claude_version: String,
    pub installed_at: String,
    pub backup: Option<String>,
    /// 实际写入的路径，回滚时按此还原。
    pub modified: Vec<String>,
    /// 实际生效的层（Claude Code）。
    #[serde(default)]
    pub layers: Vec<CodeLayer>,
}

/// 读取已安装记录。
pub fn read_state() -> Vec<InstalledRecord> {
    let p = state_path();
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<InstalledRecord>>(&t).ok())
        .unwrap_or_default()
}

/// 写入已安装记录。失败返回 `Err`，由调用方决定是否阻断 —— 安装成功但状态
/// 写不进去时，**不能**假装没装，那会让用户失去回滚入口。
pub fn write_state(records: &[InstalledRecord]) -> std::io::Result<()> {
    let p = state_path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&p, serde_json::to_string_pretty(records).map_err(std::io::Error::other)?)
}

/// 记录中某个插件的条目。
pub fn state_for<'a>(records: &'a [InstalledRecord], id: &str) -> Option<&'a InstalledRecord> {
    records.iter().find(|r| r.plugin_id == id)
}

#[cfg(test)]
pub fn reset_state_for_test() {
    let _ = std::fs::remove_file(state_path());
}
