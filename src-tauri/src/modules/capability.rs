//! Capability layer — the answer to "what can this machine do?".
//!
//! ## The problem this solves
//!
//! Before P4.5 the only vocabulary the app had was `SoftwareId`: seven programs
//! it could install. A profile was a list of those seven. That works while the
//! product is an installer, and stops working the moment it becomes an assistant,
//! because a student's question is never "do I have Node.js" — it is "can I run
//! the thing my course wants me to run".
//!
//! A [`Capability`] is that second question, named. `python-development` is a
//! capability; it resolves to a set of *requirements*, each of which is
//! satisfied by a fact about the machine (a program present, a config present, a
//! hardware property). The resolver walks requirements against an
//! [`EnvironmentFacts`] snapshot and reports, per capability, whether it is met
//! and what specifically is missing.
//!
//! ## The rule this module exists to enforce
//!
//! The brief for every phase has said the same thing in different words:
//! **data, not control flow.** So:
//!
//! * A capability is a `const` table row. Adding one is adding a row.
//! * A requirement is a variant of [`Requirement`], and satisfaction is decided
//!   in exactly one `match` over those variants — not per capability.
//! * Nothing here reads a profile, runs a process, or writes a file. This module
//!   is a pure function from facts to findings, which is what makes it testable
//!   without a machine.
//!
//! ## Why capabilities are derived, not authored
//!
//! The alternative design — every profile listing its capabilities by hand — was
//! rejected because it moves the same knowledge into N profile files and lets
//! them disagree. Instead a profile is *projected* onto the capability table:
//! see [`from_profile`]. The table stays the single source of truth, and a
//! school's `campus.json` gets capabilities for free.

use crate::model::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/// A stable identifier for something a machine can be able to do.
///
/// A newtype over `&'static str` rather than an enum, deliberately and for the
/// same reason `SoftwareId` *is* an enum: this set is expected to grow every
/// time a course is added, and an enum would make that a source change in every
/// consumer. The values are checked at startup ([`validate_table`]) instead, so
/// a typo in a requirement fails a test rather than silently resolving to
/// "nothing is missing".
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CapabilityId(pub &'static str);

impl CapabilityId {
    pub fn as_str(self) -> &'static str {
        self.0
    }
}

impl std::fmt::Display for CapabilityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

/// One thing that must be true for a capability to be available.
///
/// The variants are the *only* kinds of check the resolver knows how to make,
/// and that is the point: a capability author composes from this list rather
/// than writing a predicate. If a genuinely new kind of check is needed, it is
/// added here once and every capability can then use it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Requirement {
    /// A catalogued program must be present.
    Program(SoftwareId),
    /// A catalogued program must be present **and** callable by its bare name.
    ///
    /// Distinct from `Program` because they fail differently and the fixes
    /// differ: present-but-not-on-PATH means "restart your terminal", absent
    /// means "install it". Collapsing them would replace an actionable message
    /// with a vague one.
    OnPath(SoftwareId),
    /// A named *fact* about the machine, e.g. `memory.gb >= 8`.
    ///
    /// Carried as an opaque key the resolver looks up in the facts map, so a new
    /// hardware requirement does not change this enum.
    Fact(FactKey),
    /// Something that cannot be detected automatically and must be reported as
    /// "needs your attention" rather than guessed at.
    ///
    /// Git identity is the canonical case: we *can* read `user.name`, but a
    /// capability author may want to state the requirement even when the probe
    /// is unavailable, and the honest render for that is "we could not check"
    /// — never a fabricated ✓.
    Manual(ManualKey),
}

/// A machine fact a capability may depend on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FactKey {
    /// Total physical memory, gigabytes.
    MemoryGb,
    /// Best dedicated VRAM found, gigabytes. `0` when no discrete GPU.
    VramGb,
    /// Logical processor count.
    LogicalCores,
    /// Virtualisation is available (WSL2 / Hyper-V capable).
    Virtualization,
    /// Free space on the workspace drive, gigabytes.
    FreeDiskGb,
    /// The winget CDN is reachable.
    NetworkOk,
}

impl FactKey {
    pub fn key(self) -> &'static str {
        match self {
            FactKey::MemoryGb => "memory.gb",
            FactKey::VramGb => "gpu.vram.gb",
            FactKey::LogicalCores => "cpu.logical",
            FactKey::Virtualization => "virtualization",
            FactKey::FreeDiskGb => "disk.free.gb",
            FactKey::NetworkOk => "network.ok",
        }
    }

    /// The bare noun for this fact, with no state word attached.
    ///
    /// Deliberately a noun phrase rather than a sentence: this string is
    /// interpolated into more than one template (a checklist label, a remedy,
    /// a threshold sentence), and a noun composes into all of them. An earlier
    /// version carried "虚拟化支持" and a separate `"支持{}"` template, which
    /// produced "支持虚拟化支持" — the state word doubled because the noun had
    /// absorbed it.
    pub fn label(self) -> &'static str {
        match self {
            FactKey::MemoryGb => "内存",
            FactKey::VramGb => "显存",
            FactKey::LogicalCores => "处理器线程数",
            FactKey::Virtualization => "虚拟化",
            FactKey::FreeDiskGb => "可用磁盘空间",
            FactKey::NetworkOk => "网络连通性",
        }
    }

    pub fn unit(self) -> &'static str {
        match self {
            FactKey::MemoryGb | FactKey::VramGb | FactKey::FreeDiskGb => "GB",
            FactKey::LogicalCores => "线程",
            _ => "",
        }
    }
}

/// A configuration requirement the app can report on but not satisfy by itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ManualKey {
    GitIdentity,
    ProxyConfigured,
    SshKey,
}

impl ManualKey {
    pub fn key(self) -> &'static str {
        match self {
            ManualKey::GitIdentity => "config.git.identity",
            ManualKey::ProxyConfigured => "config.proxy",
            ManualKey::SshKey => "config.ssh",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ManualKey::GitIdentity => "Git 身份",
            ManualKey::ProxyConfigured => "代理设置",
            ManualKey::SshKey => "SSH 密钥",
        }
    }
}

/// How demanding a capability's requirement is.
///
/// The distinction drives the UI's treatment and — importantly — whether the
/// capability counts as available. A missing `Optional` requirement does not
/// make a capability unavailable; it produces a suggestion. Without this,
/// "Python development" would be reported unavailable on any machine lacking a
/// formatter, which is both true and useless.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Necessity {
    /// Without it, the capability genuinely does not work.
    Required,
    /// Nice to have. Its absence is a suggestion, never a failure.
    Optional,
}

/// One requirement, annotated.
///
/// Not `Eq`: the threshold is an `f64`, and claiming a total equality over
/// floats would be a lie the compiler should not let us tell. `PartialEq` is
/// enough for every use in this module and in tests.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Requires {
    pub requirement: Requirement,
    pub necessity: Necessity,
    /// Threshold for a `Fact` requirement. Ignored for the others.
    ///
    /// Numeric facts compare `>= threshold`; boolean facts treat any non-zero
    /// threshold as "must be true". One field rather than a per-variant payload
    /// keeps [`Requires`] `Copy`, which keeps the capability table a `const`.
    pub threshold: f64,
}

impl Requires {
    pub const fn required(requirement: Requirement) -> Self {
        Self {
            requirement,
            necessity: Necessity::Required,
            threshold: 0.0,
        }
    }

    pub const fn optional(requirement: Requirement) -> Self {
        Self {
            requirement,
            necessity: Necessity::Optional,
            threshold: 0.0,
        }
    }

    pub const fn at_least(key: FactKey, threshold: f64) -> Self {
        Self {
            requirement: Requirement::Fact(key),
            necessity: Necessity::Required,
            threshold,
        }
    }

    pub const fn at_least_optional(key: FactKey, threshold: f64) -> Self {
        Self {
            requirement: Requirement::Fact(key),
            necessity: Necessity::Optional,
            threshold,
        }
    }

    pub const fn needs(key: ManualKey) -> Self {
        Self {
            requirement: Requirement::Manual(key),
            necessity: Necessity::Required,
            threshold: 0.0,
        }
    }
}

/// One row of the capability table.
pub struct CapabilitySpec {
    pub id: CapabilityId,
    pub name: &'static str,
    /// What a student gains. Written for someone who does not know the jargon.
    pub description: &'static str,
    /// Which group it is shown under, matching [`CapabilityGroup`].
    pub group: CapabilityGroup,
    pub requires: &'static [Requires],
    /// Shown when the capability is available, so the UI has something to say
    /// about success and not only about failure.
    pub outcome: &'static str,
}

/// The dashboard's grouping. Kept as an enum (unlike [`CapabilityId`]) because
/// the UI lays out a fixed number of sections and the compiler should point at
/// every place a new group needs handling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityGroup {
    /// Running scripts and programs.
    Development,
    /// Building agents and using AI tooling.
    AiTooling,
    /// System-level: containers, virtual machines.
    Systems,
}

impl CapabilityGroup {
    pub const ALL: [CapabilityGroup; 3] = [
        CapabilityGroup::Development,
        CapabilityGroup::AiTooling,
        CapabilityGroup::Systems,
    ];

    pub fn name(self) -> &'static str {
        match self {
            CapabilityGroup::Development => "开发能力",
            CapabilityGroup::AiTooling => "AI 工具链",
            CapabilityGroup::Systems => "系统环境",
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            CapabilityGroup::Development => "development",
            CapabilityGroup::AiTooling => "aiTooling",
            CapabilityGroup::Systems => "systems",
        }
    }
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/// Every capability the product knows about.
///
/// Ordering is display order within a group. The list is intentionally short:
/// each entry is a promise that the UI can explain it, and a long list of
/// untested promises is how a capability layer becomes decoration.
pub const TABLE: &[CapabilitySpec] = &[
    // --- Development ------------------------------------------------------
    CapabilitySpec {
        id: CapabilityId("python-development"),
        name: "Python 开发",
        description: "写 Python 脚本、跑数据分析、跟着课程做练习",
        group: CapabilityGroup::Development,
        requires: &[
            Requires::required(Requirement::Program(SoftwareId::Python)),
            Requires::required(Requirement::OnPath(SoftwareId::Python)),
            Requires::required(Requirement::OnPath(SoftwareId::Vscode)),
            // Optional on purpose: a student with Python and an editor can work.
            // Git turns that into work they can keep and share.
            Requires::optional(Requirement::OnPath(SoftwareId::Git)),
        ],
        outcome: "可以开始写 Python 了",
    },
    CapabilitySpec {
        id: CapabilityId("cpp-learning"),
        name: "C/C++ 学习",
        description: "编译课程作业、练习数据结构与算法",
        group: CapabilityGroup::Development,
        requires: &[
            Requires::required(Requirement::OnPath(SoftwareId::Vscode)),
            Requires::required(Requirement::OnPath(SoftwareId::Git)),
            Requires::at_least(FactKey::FreeDiskGb, 10.0),
        ],
        outcome: "可以编译 C/C++ 程序",
    },
    CapabilitySpec {
        id: CapabilityId("git-collaboration"),
        name: "Git 协作",
        description: "把代码传到 GitHub，和别人一起改同一份代码",
        group: CapabilityGroup::Development,
        requires: &[
            Requires::required(Requirement::OnPath(SoftwareId::Git)),
            Requires::needs(ManualKey::GitIdentity),
            Requires::at_least(FactKey::NetworkOk, 1.0),
        ],
        outcome: "可以提交与同步代码",
    },
    CapabilitySpec {
        id: CapabilityId("node-development"),
        name: "Node.js 开发",
        description: "运行前端项目、使用 npm 安装命令行工具",
        group: CapabilityGroup::Development,
        requires: &[
            Requires::required(Requirement::Program(SoftwareId::Node)),
            Requires::required(Requirement::OnPath(SoftwareId::Node)),
            Requires::required(Requirement::OnPath(SoftwareId::Vscode)),
        ],
        outcome: "可以运行 Node.js 项目",
    },

    // --- AI tooling -------------------------------------------------------
    CapabilitySpec {
        id: CapabilityId("ai-agent-development"),
        name: "AI Agent 开发",
        description: "写调用大模型的程序，做自己的 AI 小助手",
        group: CapabilityGroup::AiTooling,
        requires: &[
            Requires::required(Requirement::Program(SoftwareId::Python)),
            Requires::required(Requirement::OnPath(SoftwareId::Python)),
            // The MCP ecosystem is npm-distributed; without Node the majority of
            // servers cannot be started at all.
            Requires::required(Requirement::OnPath(SoftwareId::Node)),
            Requires::required(Requirement::OnPath(SoftwareId::Vscode)),
            Requires::at_least(FactKey::MemoryGb, 8.0),
            Requires::at_least(FactKey::NetworkOk, 1.0),
        ],
        outcome: "可以开发并运行 AI Agent",
    },
    CapabilitySpec {
        id: CapabilityId("ai-cli-assistant"),
        name: "命令行 AI 助手",
        description: "在终端里让 AI 直接读写你的项目文件",
        group: CapabilityGroup::AiTooling,
        requires: &[
            Requires::required(Requirement::Program(SoftwareId::ClaudeCode)),
            Requires::required(Requirement::OnPath(SoftwareId::ClaudeCode)),
            Requires::required(Requirement::OnPath(SoftwareId::Node)),
        ],
        outcome: "可以在终端使用 AI 编程助手",
    },
    CapabilitySpec {
        id: CapabilityId("ai-desktop-assistant"),
        name: "桌面 AI 助手",
        description: "不写代码也能用的 AI 对话工具",
        group: CapabilityGroup::AiTooling,
        // `Program`, not `OnPath`, and that distinction is load-bearing. Claude
        // Desktop is a GUI application with no CLI — it has no `--version` and is
        // never callable by name. Requiring it on PATH made the capability report
        // "重启终端，让 Claude Desktop 进入 PATH" on a machine where it was
        // correctly installed and working. Demanding something that cannot exist
        // is a worse error than missing a real one, because the advice is
        // un-followable.
        requires: &[Requires::required(Requirement::Program(
            SoftwareId::ClaudeDesktop,
        ))],
        outcome: "可以随时打开 AI 助手提问",
    },
    CapabilitySpec {
        id: CapabilityId("local-model-inference"),
        name: "本地运行大模型",
        description: "模型跑在自己电脑上，断网也能用，数据不出本机",
        group: CapabilityGroup::AiTooling,
        requires: &[
            Requires::at_least(FactKey::VramGb, 6.0),
            Requires::at_least(FactKey::MemoryGb, 16.0),
            Requires::at_least(FactKey::FreeDiskGb, 20.0),
        ],
        outcome: "可以在本机运行中小规模模型",
    },
    CapabilitySpec {
        id: CapabilityId("vscode-ai-pairing"),
        name: "编辑器内 AI 辅助",
        description: "在编辑器里直接补全、解释和修改代码",
        group: CapabilityGroup::AiTooling,
        requires: &[
            Requires::required(Requirement::OnPath(SoftwareId::Vscode)),
            Requires::required(Requirement::OnPath(SoftwareId::ClaudeCode)),
        ],
        outcome: "编辑器里已有 AI 助手",
    },

    // --- Systems ----------------------------------------------------------
    CapabilitySpec {
        id: CapabilityId("container-development"),
        name: "容器与部署",
        description: "用 Docker 打包和运行服务，别人电脑上也能跑起来",
        group: CapabilityGroup::Systems,
        requires: &[
            Requires::required(Requirement::OnPath(SoftwareId::Vscode)),
            Requires::at_least(FactKey::Virtualization, 1.0),
            Requires::at_least(FactKey::FreeDiskGb, 15.0),
        ],
        outcome: "可以构建与运行容器",
    },
    CapabilitySpec {
        id: CapabilityId("linux-environment"),
        name: "Linux 子系统",
        description: "在 Windows 里直接使用 Linux 命令与工具链",
        group: CapabilityGroup::Systems,
        requires: &[
            Requires::at_least(FactKey::Virtualization, 1.0),
            Requires::at_least(FactKey::MemoryGb, 8.0),
        ],
        outcome: "可以安装并使用 WSL2",
    },
];

/// The row for `id`, if the table has one.
pub fn lookup(id: CapabilityId) -> Option<&'static CapabilitySpec> {
    TABLE.iter().find(|spec| spec.id == id)
}

/// Every capability whose requirements mention `program`.
///
/// Used to answer "what does installing Git actually buy me?" — the question the
/// plan screen needs to answer, and the reason capabilities are worth having as
/// data rather than as prose.
pub fn depending_on(program: SoftwareId) -> Vec<&'static CapabilitySpec> {
    TABLE
        .iter()
        .filter(|spec| {
            spec.requires.iter().any(|r| match r.requirement {
                Requirement::Program(p) | Requirement::OnPath(p) => p == program,
                _ => false,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/// The machine's measured state, in the shape the resolver queries.
///
/// Built from the three existing sources and nothing else: `EnvironmentReport`
/// for hardware, `SoftwareInventory` for programs, and the config checks for
/// manual requirements. This struct existing means the resolver is a pure
/// function and every test can construct a machine by hand.
#[derive(Debug, Clone, Default)]
pub struct EnvironmentFacts {
    /// Measured numeric facts, keyed by [`FactKey`].
    pub numbers: BTreeMap<FactKey, f64>,
    /// Programs present, and whether each resolves from PATH.
    pub programs: BTreeMap<SoftwareId, ProgramPresence>,
    /// Answers to the manual checks. `None` means "we could not determine it",
    /// which is rendered as unknown rather than as missing.
    pub manual: BTreeMap<ManualKey, Option<bool>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ProgramPresence {
    pub installed: bool,
    pub on_path: bool,
    /// The program could not be probed at all, so `installed: false` means
    /// "we don't know" rather than "it is absent".
    pub uncertain: bool,
}

/// Builds the fact map from the existing modules' outputs.
///
/// Note what this does *not* do: it does not re-probe anything. Hardware comes
/// from the environment report already taken, programs from the inventory
/// already taken. A capability report is therefore always consistent with the
/// dashboard it sits beside — the alternative would have the two screens
/// disagree about the same machine.
pub fn facts_from(
    environment: Option<&EnvironmentReport>,
    inventory: Option<&SoftwareInventory>,
    manual: BTreeMap<ManualKey, Option<bool>>,
) -> EnvironmentFacts {
    let mut numbers = BTreeMap::new();

    if let Some(env) = environment {
        if let Some(cpu) = &env.machine.cpu {
            if let Some(logical) = cpu.logical_cores {
                numbers.insert(FactKey::LogicalCores, logical as f64);
            }
        }
        if let Some(mem) = &env.machine.memory {
            numbers.insert(
                FactKey::MemoryGb,
                mem.total_bytes as f64 / (1024.0 * 1024.0 * 1024.0),
            );
        }
        // Best VRAM across all GPUs, or 0. Taking the maximum rather than the
        // first is deliberate: a laptop with integrated graphics *and* a
        // discrete card lists the integrated one first, and reading only that
        // would report a capable machine as incapable of local models.
        //
        // A GPU whose capacity could not be decoded contributes nothing rather
        // than a guess — `filter_map` on `vram_bytes` drops it, and if every card
        // is unknown the fact is simply absent, which the resolver reports as
        // "未检测" instead of "0 GB".
        let vram = env
            .machine
            .gpus
            .iter()
            .filter_map(|g| g.vram_bytes)
            .max()
            .unwrap_or(0);
        numbers.insert(FactKey::VramGb, vram as f64 / (1024.0 * 1024.0 * 1024.0));

        if let Some(v) = env.machine.virtualization_enabled {
            numbers.insert(FactKey::Virtualization, if v { 1.0 } else { 0.0 });
        }

        // The workspace drive is the one the app installs to; taking the maximum
        // free space across all drives would be optimistic in a way that matters
        // when a student has a full C: and an empty D:.
        let workspace = env
            .disks
            .iter()
            .find(|d| d.root.eq_ignore_ascii_case("C:\\"))
            .or_else(|| env.disks.first());
        if let Some(disk) = workspace {
            numbers.insert(
                FactKey::FreeDiskGb,
                disk.free_bytes as f64 / (1024.0 * 1024.0 * 1024.0),
            );
        }

        // `winget_reachable` specifically, not general internet: it is the probe
        // that decides whether an install will work, and campus captive portals
        // routinely pass one and fail the other.
        numbers.insert(
            FactKey::NetworkOk,
            if env.network.winget_reachable { 1.0 } else { 0.0 },
        );
    }

    let mut programs = BTreeMap::new();
    if let Some(inv) = inventory {
        for item in &inv.items {
            programs.insert(
                item.id,
                ProgramPresence {
                    installed: item.installed,
                    on_path: item.on_path,
                    uncertain: !item.installed && item.confidence == Confidence::Unknown,
                },
            );
        }
    } else {
        // No inventory at all — the student has not scanned, or the scan failed.
        //
        // Every program is marked `uncertain`, which is the whole point: without
        // this, `unwrap_or_default()` in the resolver produced
        // `installed: false, uncertain: false`, and an *unscanned* machine was
        // indistinguishable from one with nothing installed. That is the single
        // worst failure this product can make — it tells a student they are
        // missing software nobody ever looked for — and it showed up as a plan
        // reporting three gaps on a machine that had not been examined.
        //
        // Populating the map rather than leaving it empty also means the
        // `Program` and `OnPath` arms below cannot accidentally take the
        // default path through a lookup miss.
        for id in SoftwareId::ALL {
            programs.insert(
                id,
                ProgramPresence {
                    installed: false,
                    on_path: false,
                    uncertain: true,
                },
            );
        }
    }

    EnvironmentFacts {
        numbers,
        programs,
        manual,
    }
}

/// Reads every manual check the table can ask about.
///
/// Separate from [`facts_from`] because it *does* touch the machine — running
/// `git config --global --list` — whereas `facts_from` is pure. Keeping the side
/// effect at one named call site means a test can build facts for a synthetic
/// machine without invoking Git, and the production path can be audited by
/// looking at exactly one function.
///
/// Each check is best-effort: a failure yields `None`, which renders as
/// "无法确认" rather than as a confident negative.
pub fn probe_manual_facts(inventory: Option<&SoftwareInventory>) -> BTreeMap<ManualKey, Option<bool>> {
    let mut out = BTreeMap::new();

    // Three outcomes, not two, and the third is the one that matters here.
    //
    // * Git installed  → ask it.
    // * Git probed and genuinely absent → `Some(false)` is honest and
    //   actionable: the capability already requires Git, so the student's first
    //   step is to install it, and setting an identity is pointless before that.
    // * **No scan at all** → `None`. The previous version collapsed this into
    //   the absent case, so a machine that had never been examined reported
    //   "Git identity not configured" — a claim about a computer nobody looked
    //   at. It surfaced as the dashboard showing a Git gap on first run.
    let git = inventory.and_then(|inv| inv.find(SoftwareId::Git));
    let git_identity = match git {
        Some(item) if item.installed => super::bootstrap::git::identity_configured(),
        Some(_) => Some(false),
        None => None,
    };

    out.insert(ManualKey::GitIdentity, git_identity);

    // Not probed yet. `None` is the truthful answer and renders as unknown; a
    // `Some(false)` would send students to configure a proxy most of them do not
    // need.
    out.insert(ManualKey::ProxyConfigured, None);
    out.insert(ManualKey::SshKey, None);

    out
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/// How one requirement turned out.
///
/// `Serialize` only, not `Deserialize`: this is an *output* type, produced by
/// resolving a machine and consumed by the UI. Deriving `Deserialize` would
/// require the borrowed `&'static str` fields to become owned `String`s purely
/// to satisfy a direction nothing uses.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementOutcome {
    /// Stable key, for the UI to key rows by and for tests to assert on.
    pub key: String,
    /// What was required, already phrased for a student.
    pub label: String,
    pub necessity: &'static str,
    pub met: bool,
    /// `true` when the requirement could not be evaluated at all.
    pub unknown: bool,
    /// What we observed, e.g. `2.43.0` or `未安装`.
    pub observed: String,
    /// What would satisfy it, when not met.
    pub remedy: Option<String>,
}

/// The state of one capability on this machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub group: String,
    pub group_name: String,
    /// `available` | `partial` | `unavailable` | `unknown`.
    pub status: String,
    pub outcome: String,
    pub requirements: Vec<RequirementOutcome>,
    /// Met required-requirement count / total required.
    pub met_count: u32,
    pub required_count: u32,
    /// One line stating what to do, or why nothing needs doing.
    pub summary: String,
}

/// Resolves the whole table against `facts`.
pub fn resolve(
    facts: &EnvironmentFacts,
    id_filter: Option<&[CapabilityId]>,
) -> Vec<CapabilityStatus> {
    TABLE
        .iter()
        .filter(|spec| id_filter.is_none_or(|ids| ids.contains(&spec.id)))
        .map(|spec| resolve_one(facts, spec))
        .collect()
}

/// Resolves one capability. Public so a test can check a single row without
/// building the whole list.
pub fn resolve_one(facts: &EnvironmentFacts, spec: &CapabilitySpec) -> CapabilityStatus {
    let requirements: Vec<RequirementOutcome> = spec
        .requires
        .iter()
        .map(|req| evaluate(facts, *req))
        .collect();

    let required: Vec<&RequirementOutcome> = requirements
        .iter()
        .filter(|r| r.necessity == "required")
        .collect();

    let met = required.iter().filter(|r| r.met).count() as u32;
    let total = required.len() as u32;
    let missing: Vec<&RequirementOutcome> =
        required.iter().copied().filter(|r| !r.met && !r.unknown).collect();
    // A capability that is `partial` on known facts *and* has unmeasured
    // requirements is in the most dangerous state of all: the student is told
    // what to fix, and the message will be incomplete. Saying so is the only
    // honest option.
    let unmeasured = required.iter().any(|r| r.unknown);

    // The status is a four-way answer rather than a bool because "we could not
    // check" must not be reported as "you don't have it" — the single worst
    // failure this whole product could make, and the reason `Confidence` exists
    // all the way back in the detection layer.
    //
    // Precedence, and why: a missing *required* piece makes the capability
    // genuinely unavailable, so that is decided first. Only then does `unknown`
    // take priority over `partial` — a capability where one requirement could
    // not be probed has not been *partially verified*, it has been
    // *incompletely measured*, and reporting it as "partial" would imply we know
    // which half is missing. We do not.
    let status = if total == 0 {
        // Nothing required: every conceivable machine satisfies it.
        "available"
    } else if met == total {
        "available"
    } else if !missing.is_empty() {
        // Something is definitively absent, which is actionable regardless of
        // what else is unknown.
        if met > 0 {
            "partial"
        } else {
            "unavailable"
        }
    } else {
        // Everything not met is unknown.
        "unknown"
    };

    let summary = if status == "available" {
        let optional_missing: Vec<&RequirementOutcome> = requirements
            .iter()
            .filter(|r| r.necessity == "optional" && !r.met && !r.unknown)
            .collect();
        if optional_missing.is_empty() {
            spec.outcome.to_string()
        } else {
            format!(
                "{}（还可以补上：{}）",
                spec.outcome,
                optional_missing
                    .iter()
                    .map(|r| r.label.as_str())
                    .collect::<Vec<_>>()
                    .join("、")
            )
        }
    } else {
        // Deduplicated: a program that is both absent and off-PATH produces two
        // failing requirements whose remedies are the same sentence, and the
        // first real run printed "安装 Claude Code；安装 Claude Code". Repeating
        // a fix does not make it more actionable.
        let mut seen = std::collections::BTreeSet::new();
        let fixes: Vec<String> = missing
            .iter()
            .filter_map(|r| r.remedy.clone())
            .filter(|f| seen.insert(f.clone()))
            .collect::<Vec<_>>();
        let fixes = fixes.join("；");
        if unmeasured {
            format!("{fixes}（另有条件无法确认，建议重新检测）")
        } else {
            fixes
        }
    };

    CapabilityStatus {
        id: spec.id.as_str().to_string(),
        name: spec.name.to_string(),
        description: spec.description.to_string(),
        group: spec.group.key().to_string(),
        group_name: spec.group.name().to_string(),
        status: status.to_string(),
        outcome: spec.outcome.to_string(),
        requirements,
        met_count: met,
        required_count: total,
        summary,
    }
}

/// Decides one requirement.
///
/// **This is the only `match` over [`Requirement`] in the crate.** Everything a
/// capability author writes is a table row; everything about how a requirement is
/// judged lives here. That is what keeps the table data and the semantics in one
/// place instead of smeared across a hundred `if` statements.
///
/// Note it takes no [`Catalog`]: resolution reads `facts`, which were built from
/// the detection and inventory layers. A capability check that consulted the
/// catalog directly would be a second source of truth about what is installed —
/// and the two would eventually disagree.
fn evaluate(facts: &EnvironmentFacts, req: Requires) -> RequirementOutcome {
    let necessity = match req.necessity {
        Necessity::Required => "required",
        Necessity::Optional => "optional",
    };

    match req.requirement {
        Requirement::Program(id) | Requirement::OnPath(id) => {
            let needs_path = matches!(req.requirement, Requirement::OnPath(_));
            // A lookup miss means "never probed", not "absent".
            //
            // `unwrap_or_default()` here was a real bug: `ProgramPresence`'s
            // default is `installed: false, uncertain: false`, which reads as a
            // confident "not installed". `facts_from` now populates the map, so
            // a miss should not happen — but this is the line that decides what a
            // student is told, and it should not depend on that being true.
            let presence = facts.programs.get(&id).copied().unwrap_or(ProgramPresence {
                installed: false,
                on_path: false,
                uncertain: true,
            });
            let name = entry_display_name(id);

            let (met, remedy, observed) = if presence.uncertain {
                (false, None, "检测未完成".to_string())
            } else if !presence.installed {                (
                    false,
                    Some(format!("安装 {name}")),
                    "未安装".to_string(),
                )
            } else if needs_path && !presence.on_path {
                // Installed but not callable. The fix is different from
                // "install it", and telling a student to reinstall software
                // they already have is the worst message this app could send.
                (
                    false,
                    Some(format!("重启终端，让 {name} 进入 PATH")),
                    "已安装，但命令行找不到".to_string(),
                )
            } else {
                (true, None, "已就绪".to_string())
            };

            RequirementOutcome {
                key: if needs_path {
                    format!("onPath.{}", id.key())
                } else {
                    format!("program.{}", id.key())
                },
                label: if needs_path {
                    format!("{name} 可在命令行调用")
                } else {
                    format!("已安装 {name}")
                },
                necessity,
                met,
                unknown: presence.uncertain,
                observed,
                remedy,
            }
        }

        Requirement::Fact(key) => {
            let observed_value = facts.numbers.get(&key).copied();
            let met = observed_value.is_some_and(|v| v >= req.threshold);

            let observed = match observed_value {
                Some(v) => {
                    let unit = key.unit();
                    if unit.is_empty() {
                        if v >= 1.0 {
                            "支持".to_string()
                        } else {
                            "不支持".to_string()
                        }
                    } else {
                        format!("{v:.1} {unit}")
                    }
                }
                None => "未检测".to_string(),
            };

            // Boolean facts are phrased as a state, numbers as a threshold, so
            // the sentence reads naturally in both cases.
            //
            // Numeric facts read "至少 16 GB 内存" rather than "内存 至少 16 GB":
            // the unit belongs beside the number, and Chinese puts the qualifying
            // phrase before the noun. The first form was written as
            // `{} 至少 {:.0} {}` and produced "内存 至少 16 GB", where the space
            // after the noun read as a typo and the ordering read as translated
            // English. `unit()` is a real unit here — the branch is guarded by
            // `unit().is_empty()`, so a unitless key never reaches this arm.
            let label = if key.unit().is_empty() {
                format!("支持{}", key.label())
            } else {
                format!("至少 {:.0} {} {}", req.threshold, key.unit(), key.label())
            };

            let remedy = if met {
                None
            } else if observed_value.is_none() {
                None
            } else if key.unit().is_empty() {
                Some(format!("开启{}", key.label()))
            } else {
                Some(format!(
                    "{}不足（当前 {}，建议 {:.0} {} 以上）",
                    key.label(),
                    observed,
                    req.threshold,
                    key.unit()
                ))
            };

            RequirementOutcome {
                key: format!("fact.{}", key.key()),
                label,
                necessity,
                met,
                unknown: observed_value.is_none(),
                observed,
                remedy,
            }
        }

        Requirement::Manual(key) => {
            // A manual check has three outcomes, not two. `None` — we could not
            // read it — becomes `unknown`, which renders as "无法确认" and never
            // as a ✓.
            let answer = facts.manual.get(&key).copied().flatten();
            let met = answer == Some(true);

            RequirementOutcome {
                key: key.key().to_string(),
                label: format!("已配置 {}", key.label()),
                necessity,
                met,
                unknown: answer.is_none(),
                observed: match answer {
                    Some(true) => "已配置".to_string(),
                    Some(false) => "未配置".to_string(),
                    None => "未检测".to_string(),
                },
                remedy: match answer {
                    Some(true) => None,
                    Some(false) => Some(match key {
                        ManualKey::GitIdentity => {
                            "配置 Git 用户名与邮箱（需要你自己填写）".to_string()
                        }
                        ManualKey::ProxyConfigured => "在系统设置中配置代理".to_string(),
                        ManualKey::SshKey => "生成并添加 SSH 公钥到 GitHub".to_string(),
                    }),
                    None => None,
                },
            }
        }
    }
}

/// The catalog's display name for a program.
///
/// Goes through `SoftwareId::display_name` rather than reading a catalog field,
/// because the catalog carries *identity* (executables, registry patterns) and
/// the display name is a presentation concern that `SoftwareId` already owns.
fn entry_display_name(id: SoftwareId) -> &'static str {
    id.display_name()
}

// ---------------------------------------------------------------------------
// Profile projection
// ---------------------------------------------------------------------------

/// The capabilities a profile is aiming at.
///
/// **Why this is derived rather than declared in the profile file.** A profile
/// says which programs to install; capabilities say what those programs are
/// *for*. Deriving the second from the first keeps one source of truth, and it
/// means a school editing `campus.json` cannot accidentally claim a capability
/// its program list does not actually deliver. The derivation is deliberately
/// conservative: a capability is included only when *every* required program it
/// names is in the profile, so the profile genuinely does aim at it.
///
/// Explicit overrides are still available (the `capabilities` key in a profile),
/// and are unioned with the derived set — see [`from_profile_declared`].
pub fn from_profile(profile: &Profile) -> Vec<CapabilityId> {
    let mut out: Vec<CapabilityId> = TABLE
        .iter()
        .filter(|spec| {
            spec.requires.iter().all(|req| match req.requirement {
                Requirement::Program(id) | Requirement::OnPath(id) => {
                    profile.software.contains(&id)
                }
                // Hardware and manual requirements are decided by the machine,
                // not by the profile, so they never exclude a capability here.
                Requirement::Fact(_) | Requirement::Manual(_) => true,
            })
        })
        .map(|spec| spec.id)
        .collect();

    for extra in &profile.capabilities {
        // Resolved through the table rather than wrapped: `CapabilityId` holds a
        // `&'static str`, so a profile may *select* a capability but can never
        // invent one. An unknown id is surfaced by `unknown_declared`.
        if let Some(spec) = lookup_by_str(extra) {
            if !out.contains(&spec.id) {
                out.push(spec.id);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// The capability ids a profile names explicitly, filtered to those the table
/// knows. Exposed so the profile screen can warn about an unknown id rather than
/// silently ignoring it.
pub fn unknown_declared(profile: &Profile) -> Vec<String> {
    profile
        .capabilities
        .iter()
        .filter(|id| lookup_by_str(id).is_none())
        .cloned()
        .collect()
}

/// Looks a capability up by plain string.
///
/// Needed because [`CapabilityId`] holds a `&'static str` — it can only name ids
/// that exist in the table, which is exactly the guarantee we want, but it means
/// a `String` read from a JSON file has to be resolved through here rather than
/// wrapped. Wrapping an owned string would require `CapabilityId` to own its
/// data and the table would stop being a `const`.
pub fn lookup_by_str(id: &str) -> Option<&'static CapabilitySpec> {
    TABLE.iter().find(|spec| spec.id.as_str() == id)
}

/// The table rows for a profile's declared ids, dropping unknown ones.
pub fn declared_specs(profile: &Profile) -> Vec<&'static CapabilitySpec> {
    profile
        .capabilities
        .iter()
        .filter_map(|id| lookup_by_str(id))
        .collect()
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// Programs the catalog knows how to invoke from a command line.
///
/// Derived from the catalog rather than hand-listed, so it cannot drift: an entry
/// with `version_args` is one we run a process for, which is exactly the set for
/// which "is it on PATH" is a meaningful question. A GUI-only product has
/// `version_args: None` and is therefore excluded automatically.
fn programs_with_a_cli() -> Vec<SoftwareId> {
    let catalog = crate::modules::catalog::Catalog::builtin();
    catalog
        .ids()
        .filter(|id| catalog.entry(*id).version_args.is_some())
        .collect()
}

/// Structural checks over the table, run from a test.
///
/// Returns human-readable problems rather than panicking so a failing run shows
/// every problem at once instead of stopping at the first.
pub fn validate_table() -> Vec<String> {
    let mut problems = Vec::new();
    let mut seen: BTreeMap<&'static str, usize> = BTreeMap::new();

    for spec in TABLE {
        *seen.entry(spec.id.as_str()).or_insert(0) += 1;
        if spec.requires.is_empty() {
            problems.push(format!("{} has no requirements", spec.id));
        }
        if spec.name.trim().is_empty() {
            problems.push(format!("{} has no name", spec.id));
        }
        if spec.description.trim().is_empty() {
            problems.push(format!("{} has no description", spec.id));
        }
        if spec.outcome.trim().is_empty() {
            problems.push(format!("{} has no outcome line", spec.id));
        }
        // A capability with no required requirement is always "available",
        // which is never what the author meant.
        if !spec
            .requires
            .iter()
            .any(|r| r.necessity == Necessity::Required)
        {
            problems.push(format!("{} has only optional requirements", spec.id));
        }
        for req in spec.requires {
            match req.requirement {
                Requirement::OnPath(id) => {
                    // A program with no CLI can never be on PATH, so requiring it
                    // produces advice the student cannot follow ("重启终端，让
                    // Claude Desktop 进入 PATH"). The catalog knows which programs
                    // have a CLI — that is what `version_args` records — so the
                    // check is structural rather than a note in a comment.
                    if !programs_with_a_cli().contains(&id) {
                        problems.push(format!(
                            "{} requires {:?} on PATH, but it has no CLI to call",
                            spec.id, id
                        ));
                    }
                }
                Requirement::Fact(key) if key.unit().is_empty() => {
                    // Boolean facts are compared as `>= 1.0`; any other
                    // threshold is a mistake that would silently never pass.
                    if (req.threshold - 1.0).abs() > f64::EPSILON {
                        problems.push(format!(
                            "{} requires boolean fact {} with threshold {}",
                            spec.id,
                            key.key(),
                            req.threshold
                        ));
                    }
                }
                Requirement::Fact(_) | Requirement::Program(_) | Requirement::Manual(_) => {}
            }
        }
    }

    for (id, count) in seen {
        if count > 1 {
            problems.push(format!("duplicate capability id: {id}"));
        }
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::super::catalog::Catalog;

    fn catalog() -> Catalog {
        Catalog::builtin()
    }

    /// A capable developer machine, so tests can start from a known-good state
    /// and remove one thing at a time.
    fn good_machine() -> EnvironmentFacts {
        let mut facts = EnvironmentFacts::default();
        for id in SoftwareId::ALL {
            facts.programs.insert(
                id,
                ProgramPresence {
                    installed: true,
                    on_path: true,
                    uncertain: false,
                },
            );
        }
        facts.numbers.insert(FactKey::MemoryGb, 32.0);
        facts.numbers.insert(FactKey::VramGb, 8.0);
        facts.numbers.insert(FactKey::LogicalCores, 16.0);
        facts.numbers.insert(FactKey::Virtualization, 1.0);
        facts.numbers.insert(FactKey::FreeDiskGb, 200.0);
        facts.numbers.insert(FactKey::NetworkOk, 1.0);
        facts.manual.insert(ManualKey::GitIdentity, Some(true));
        facts
    }

    fn status_of(facts: &EnvironmentFacts, id: &str) -> CapabilityStatus {
        let spec = lookup_by_str(id).unwrap_or_else(|| panic!("no capability {id}"));
        resolve_one(facts, spec)
    }

    #[test]
    fn the_table_is_structurally_sound() {
        let problems = validate_table();
        assert!(problems.is_empty(), "capability table:\n{}", problems.join("\n"));
    }

    #[test]
    fn the_path_requirement_guard_has_teeth() {
        // A guard nobody has seen fail is not a guard. This asserts that the
        // check would reject the exact mistake it was written for — an `OnPath`
        // requirement on a GUI-only program — by running the same predicate the
        // validator uses.
        let gui_only = SoftwareId::ClaudeDesktop;
        assert!(
            !programs_with_a_cli().contains(&gui_only),
            "the fixture for this test is wrong: Claude Desktop now has a CLI"
        );
        assert!(
            programs_with_a_cli().contains(&SoftwareId::Git),
            "a program with a CLI must be in the list, or the guard rejects nothing"
        );
    }

    #[test]
    fn a_gui_only_program_is_never_required_on_path() {
        // The measured regression: `ai-desktop-assistant` demanded Claude Desktop
        // on PATH, which is impossible for a GUI app with no executable shim, so
        // a machine with it correctly installed was told to "重启终端，让 Claude
        // Desktop 进入 PATH" — advice that cannot be followed.
        let spec = lookup(CapabilityId("ai-desktop-assistant")).unwrap();
        for req in spec.requires {
            assert!(
                !matches!(req.requirement, Requirement::OnPath(SoftwareId::ClaudeDesktop)),
                "a GUI-only program must be required as a Program, not on PATH"
            );
        }
    }

    #[test]
    fn every_capability_has_at_least_one_consumer_visible_line() {
        // A capability nobody can read is a capability that should not exist.
        for spec in TABLE {
            assert!(!spec.description.is_empty(), "{}", spec.id);
            assert!(!spec.outcome.is_empty(), "{}", spec.id);
        }
    }

    #[test]
    fn a_capable_machine_satisfies_everything() {
        let facts = good_machine();
        for spec in TABLE {
            let status = resolve_one(&facts, spec);
            assert_eq!(
                status.status, "available",
                "{} was not available on a fully capable machine: {}",
                spec.id, status.summary
            );
        }
    }

    #[test]
    fn a_missing_program_makes_exactly_the_capabilities_that_need_it_unavailable() {
        let mut facts = good_machine();
        facts.programs.insert(
            SoftwareId::Node,
            ProgramPresence {
                installed: false,
                on_path: false,
                uncertain: false,
            },
        );
        let node_dev = resolve_one(&facts, lookup(CapabilityId("node-development")).unwrap());
        assert_ne!(node_dev.status, "available");

        let agent = resolve_one(&facts, lookup(CapabilityId("ai-agent-development")).unwrap());
        assert_ne!(agent.status, "available");

        // Python-only work must be unaffected — this is the whole reason
        // capabilities are separate from programs.
        let python = resolve_one(&facts, lookup(CapabilityId("python-development")).unwrap());
        assert_eq!(python.status, "available");
    }

    #[test]
    fn installed_but_off_path_is_reported_as_a_path_problem_not_a_missing_program() {
        // The single most important message in this module. A student who is
        // told to reinstall a program they already have will do it, waste ten
        // minutes, and end up in exactly the same state.
        let mut facts = good_machine();
        facts.programs.insert(
            SoftwareId::Git,
            ProgramPresence {
                installed: true,
                on_path: false,
                uncertain: false,
            },
        );
        let status = status_of(&facts, "git-collaboration");

        let git = status
            .requirements
            .iter()
            .find(|r| r.key == "onPath.git")
            .expect("git path requirement");
        assert!(!git.met);
        assert_eq!(git.observed, "已安装，但命令行找不到");
        assert!(git.remedy.as_ref().unwrap().contains("PATH"));
        assert!(
            !git.remedy.as_ref().unwrap().contains("安装 Git"),
            "must not tell the student to install what they already have"
        );
    }

    #[test]
    fn an_unprobeable_program_is_unknown_not_missing() {
        // Everything else about this machine is fine, so the only thing that can
        // keep Python development from being available is the unmeasurable
        // Python probe. The status must be `unknown`, which renders as "we could
        // not check" — never as "not installed".
        let mut facts = good_machine();
        facts.programs.insert(
            SoftwareId::Python,
            ProgramPresence {
                installed: false,
                on_path: false,
                uncertain: true,
            },
        );
        let status = status_of(&facts, "python-development");
        assert_eq!(status.status, "unknown");
        let py = status
            .requirements
            .iter()
            .find(|r| r.key == "program.python")
            .unwrap();
        assert!(py.unknown);
        assert_eq!(py.observed, "检测未完成");
        assert!(py.remedy.is_none(), "no advice can be given without a reading");
    }

    #[test]
    fn an_unprobeable_program_does_not_mask_a_real_absence() {
        // The interaction between the two: if something is definitively missing
        // *and* something else is unmeasurable, the actionable finding wins —
        // but the answer still admits it is incomplete.
        let mut facts = good_machine();
        facts.programs.insert(
            SoftwareId::Python,
            ProgramPresence {
                installed: false,
                on_path: false,
                uncertain: true,
            },
        );
        facts.programs.insert(
            SoftwareId::Node,
            ProgramPresence {
                installed: false,
                on_path: false,
                uncertain: false,
            },
        );
        let status = status_of(&facts, "ai-agent-development");
        assert_eq!(status.status, "partial");
        assert!(status.summary.contains("Node"), "{}", status.summary);
        assert!(status.summary.contains("无法确认"), "{}", status.summary);
    }

    #[test]
    fn partial_is_distinct_from_both_available_and_unavailable() {
        // C/C++ learning requires VS Code, Git and enough disk. A machine with
        // VS Code and disk but no Git is half-met — and saying "unavailable"
        // would hide the fact that the student is one program away.
        let mut facts = EnvironmentFacts::default();
        facts.programs.insert(
            SoftwareId::Vscode,
            ProgramPresence {
                installed: true,
                on_path: true,
                uncertain: false,
            },
        );
        // Git is *explicitly* probed-and-absent. Leaving it out of the map is a
        // different statement — "never looked for" — which the resolver reports
        // as unknown rather than as a gap.
        facts.programs.insert(
            SoftwareId::Git,
            ProgramPresence {
                installed: false,
                on_path: false,
                uncertain: false,
            },
        );
        facts.numbers.insert(FactKey::FreeDiskGb, 100.0);
        let status = status_of(&facts, "cpp-learning");
        assert_eq!(status.status, "partial");
        assert_eq!(status.met_count, 2, "VS Code and disk are met");
        assert_eq!(status.required_count, 3);
        assert!(status.summary.contains("Git"), "the fix names the gap: {}", status.summary);
    }

    #[test]
    fn a_program_that_was_never_probed_is_unknown_not_absent() {
        // The bug this pins: `unwrap_or_default()` on a lookup miss produced
        // `installed: false, uncertain: false`, so an unscanned machine reported
        // confidently-missing software. It surfaced as a first-run dashboard
        // listing three gaps for a computer nobody had examined.
        let mut facts = EnvironmentFacts::default();
        facts.numbers.insert(FactKey::FreeDiskGb, 100.0);
        // Nothing inserted for VS Code or Git: not probed.
        let status = status_of(&facts, "cpp-learning");
        assert_eq!(status.status, "unknown", "unprobed must not be unavailable");
        assert!(
            status.requirements.iter().filter(|r| r.unknown).count() >= 2,
            "both programs should read as unmeasured: {:?}",
            status.requirements
        );
        for req in status.requirements.iter().filter(|r| r.unknown) {
            assert!(req.remedy.is_none(), "no advice from an unmeasured fact");
        }
    }

    #[test]
    fn a_requirement_that_cannot_be_measured_never_reads_as_partially_verified() {
        // The dangerous middle state: one requirement definitively missing, one
        // unmeasurable. Reporting only the known fix would hand the student an
        // incomplete to-do list without telling them it is incomplete.
        let mut facts = EnvironmentFacts::default();
        facts.programs.insert(
            SoftwareId::Vscode,
            ProgramPresence {
                installed: true,
                on_path: true,
                uncertain: false,
            },
        );
        // Git definitively absent — the actionable finding.
        facts.programs.insert(
            SoftwareId::Git,
            ProgramPresence {
                installed: false,
                on_path: false,
                uncertain: false,
            },
        );
        // Disk left unset, so it is unknown.
        let status = status_of(&facts, "cpp-learning");
        assert_eq!(status.status, "partial");
        assert!(
            status.summary.contains("Git"),
            "the known fix must be stated: {}",
            status.summary
        );
        assert!(
            status.summary.contains("无法确认"),
            "an incomplete answer must say so: {}",
            status.summary
        );
    }

    #[test]
    fn nothing_missing_but_something_unmeasured_is_unknown_not_partial() {
        // No requirement is definably absent, so there is nothing to fix and
        // nothing to report as half-done. The only honest word is "unknown".
        let mut facts = EnvironmentFacts::default();
        facts.programs.insert(
            SoftwareId::Vscode,
            ProgramPresence {
                installed: true,
                on_path: true,
                uncertain: false,
            },
        );
        facts.programs.insert(
            SoftwareId::Git,
            ProgramPresence {
                installed: false,
                on_path: false,
                uncertain: true,
            },
        );
        let status = status_of(&facts, "cpp-learning");
        assert_eq!(status.status, "unknown");
    }

    #[test]
    fn hardware_shortfalls_produce_a_measured_explanation() {
        let mut facts = good_machine();
        facts.numbers.insert(FactKey::MemoryGb, 4.0);
        let status = status_of(&facts, "ai-agent-development");
        assert_ne!(status.status, "available");
        let mem = status
            .requirements
            .iter()
            .find(|r| r.key == "fact.memory.gb")
            .unwrap();
        assert!(!mem.met);
        assert_eq!(mem.observed, "4.0 GB");
        let remedy = mem.remedy.as_ref().unwrap();
        assert!(remedy.contains("8"), "the suggestion must state the target: {remedy}");
    }

    #[test]
    fn no_discrete_gpu_does_not_break_the_capabilities_that_do_not_need_one() {
        let mut facts = good_machine();
        facts.numbers.insert(FactKey::VramGb, 0.0);
        assert_ne!(status_of(&facts, "local-model-inference").status, "available");
        assert_eq!(status_of(&facts, "python-development").status, "available");
        assert_eq!(status_of(&facts, "git-collaboration").status, "available");
    }

    #[test]
    fn unreadable_manual_checks_are_unknown_never_met() {
        let mut facts = good_machine();
        facts.manual.insert(ManualKey::GitIdentity, None);
        let status = status_of(&facts, "git-collaboration");
        assert_ne!(status.status, "available");
        let ident = status
            .requirements
            .iter()
            .find(|r| r.key == "config.git.identity")
            .unwrap();
        assert!(!ident.met, "an unreadable check must never render as ✓");
        assert!(ident.unknown);
    }

    #[test]
    fn an_absent_manual_check_is_missing_and_explains_the_fix() {
        let mut facts = good_machine();
        facts.manual.insert(ManualKey::GitIdentity, Some(false));
        let status = status_of(&facts, "git-collaboration");
        let ident = status
            .requirements
            .iter()
            .find(|r| r.key == "config.git.identity")
            .unwrap();
        assert!(!ident.met);
        assert!(!ident.unknown);
        assert!(ident.remedy.as_ref().unwrap().contains("邮箱"));
    }

    #[test]
    fn optional_requirements_do_not_block_availability_but_are_mentioned() {
        let mut facts = good_machine();
        facts.programs.insert(
            SoftwareId::Git,
            ProgramPresence {
                installed: false,
                on_path: false,
                uncertain: false,
            },
        );
        // Git is optional for Python development.
        let status = status_of(&facts, "python-development");
        assert_eq!(status.status, "available");
        assert!(
            status.summary.contains("Git"),
            "the suggestion must still surface: {}",
            status.summary
        );
    }

    #[test]
    fn unknown_numbers_are_distinguished_from_failing_numbers() {
        // "8 GB, needs 16" is actionable. "we could not measure it" is a
        // different sentence, and conflating them would have the app tell
        // students to replace working hardware.
        let mut facts = good_machine();
        facts.numbers.remove(&FactKey::MemoryGb);
        let status = status_of(&facts, "ai-agent-development");
        let mem = status
            .requirements
            .iter()
            .find(|r| r.key == "fact.memory.gb")
            .unwrap();
        assert!(!mem.met);
        assert!(mem.unknown);
        assert_eq!(mem.observed, "未检测");
        assert!(mem.remedy.is_none(), "no advice without a measurement");
    }

    #[test]
    fn facts_are_built_from_the_real_report_shape() {
        // Exercises the wiring rather than the resolver: a real detection run
        // must produce facts the table can use.
        let env = crate::modules::detect::detect(500).unwrap();
        let inv = crate::modules::inventory::scan(&catalog(), &SoftwareId::ALL);
        let facts = facts_from(Some(&env), Some(&inv), Default::default());

        assert!(facts.numbers.contains_key(&FactKey::MemoryGb));
        assert!(facts.numbers.contains_key(&FactKey::FreeDiskGb));
        assert_eq!(facts.programs.len(), SoftwareId::ALL.len());

        let statuses = resolve(&facts, None);
        assert_eq!(statuses.len(), TABLE.len());
        for s in &statuses {
            assert!(
                ["available", "partial", "unavailable", "unknown"].contains(&s.status.as_str()),
                "{} produced status {}",
                s.id,
                s.status
            );
        }
    }

    #[test]
    fn facts_without_an_environment_are_unknown_not_zero() {
        let facts = facts_from(None, None, Default::default());
        assert!(facts.numbers.is_empty());
        let status = status_of(&facts, "local-model-inference");
        assert_eq!(status.status, "unknown");
    }

    #[test]
    fn the_best_gpu_is_used_not_the_first() {
        // A laptop lists integrated graphics first. Reading only the first GPU
        // would report a machine with an RTX card as unable to run local models.
        let mut env = crate::modules::detect::detect(500).unwrap();
        env.machine.gpus = vec![
            crate::modules::machine::GpuInfo {
                name: "Intel UHD".into(),
                vram_bytes: None,
                driver_version: None,
            },
            crate::modules::machine::GpuInfo {
                name: "RTX".into(),
                vram_bytes: Some(8 * 1024 * 1024 * 1024),
                driver_version: None,
            },
        ];
        let facts = facts_from(Some(&env), None, Default::default());
        assert_eq!(facts.numbers[&FactKey::VramGb], 8.0);
    }

    #[test]
    fn depending_on_finds_every_capability_a_program_unlocks() {
        let node = depending_on(SoftwareId::Node);
        let ids: Vec<&str> = node.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"node-development"));
        assert!(ids.contains(&"ai-agent-development"));
        assert!(!ids.contains(&"python-development"));
    }

    #[test]
    fn a_profile_projects_onto_capabilities_without_being_told() {
        let store = crate::modules::profiles::ProfileStore::load(None);
        let coder = store.get("coder").unwrap();
        let caps = from_profile(&coder);
        let ids: Vec<&str> = caps.iter().map(|c| c.as_str()).collect();

        // coder installs vscode + git + python + claude_code.
        assert!(ids.contains(&"python-development"), "{ids:?}");
        assert!(ids.contains(&"git-collaboration"), "{ids:?}");
        // It does not install Node, so Node-based work is correctly excluded.
        assert!(!ids.contains(&"node-development"), "{ids:?}");
    }

    #[test]
    fn ai_engineer_projects_the_agent_capability() {
        let store = crate::modules::profiles::ProfileStore::load(None);
        let engineer = store.get("ai_engineer").unwrap();
        let ids: Vec<&str> = from_profile(&engineer).iter().map(|c| c.as_str()).collect();
        assert!(ids.contains(&"ai-agent-development"), "{ids:?}");
        assert!(ids.contains(&"ai-cli-assistant"), "{ids:?}");
    }

    #[test]
    fn a_beginner_profile_does_not_claim_development_capabilities() {
        // The projection must be conservative in the direction that matters:
        // never promising a student something their profile does not deliver.
        let store = crate::modules::profiles::ProfileStore::load(None);
        let beginner = store.get("beginner").unwrap();
        let ids: Vec<&str> = from_profile(&beginner).iter().map(|c| c.as_str()).collect();
        assert!(!ids.contains(&"python-development"), "{ids:?}");
        assert!(!ids.contains(&"node-development"), "{ids:?}");
        assert!(ids.contains(&"ai-desktop-assistant"), "{ids:?}");
    }

    #[test]
    fn unknown_declared_ids_are_surfaced_not_swallowed() {
        let mut profile = crate::modules::profiles::ProfileStore::load(None)
            .get("coder")
            .unwrap();
        profile.capabilities = vec!["python-development".into(), "not-a-real-capability".into()];
        let unknown = unknown_declared(&profile);
        assert_eq!(unknown, vec!["not-a-real-capability".to_string()]);
    }

    #[test]
    fn filtering_by_id_narrows_the_result_without_changing_order() {
        let facts = good_machine();
        let wanted = [CapabilityId("git-collaboration"), CapabilityId("python-development")];
        let out = resolve(&facts, Some(&wanted));
        assert_eq!(out.len(), 2);
        // Table order, not argument order.
        assert_eq!(out[0].id, "python-development");
        assert_eq!(out[1].id, "git-collaboration");
    }

    #[test]
    fn groups_are_all_represented_in_the_table() {
        for group in CapabilityGroup::ALL {
            assert!(
                TABLE.iter().any(|s| s.group == group),
                "{} has no capabilities",
                group.name()
            );
        }
    }

    #[test]
    fn every_required_requirement_can_be_satisfied_by_construction() {
        // Guards against a table row that can never pass on any machine — e.g. a
        // threshold no hardware meets, or a Manual key nothing ever sets.
        let facts = good_machine();
        for spec in TABLE {
            let status = resolve_one(&facts, spec);
            assert_eq!(
                status.status, "available",
                "{} cannot be satisfied on a well-equipped machine",
                spec.id
            );
        }
    }
}
