//! Goal layer — the answer to "what am I trying to become?".
//!
//! ## Where this sits
//!
//! The pipeline after P4.5 answers, in order:
//!
//! ```text
//! inventory   →  what is on this machine?
//! capability  →  what can it therefore do?
//! profile     →  what does the student want installed?
//! bootstrap   →  how is that configured?
//! ```
//!
//! A profile is *already* a statement of intent — `beginner.json` is "AI 办公".
//! What P5 adds is not another layer of intent but the missing **analysis**
//! between intent and action:
//!
//! ```text
//!   Goal          "我想做 AI 应用开发"
//!     ↓
//!   Capability    python-development, ai-agent-development, git-collaboration
//!     ↓
//!   Requirement   Python on PATH, Node on PATH, ≥8 GB RAM …
//!     ↓
//!   Current       measured against this machine
//!     ↓
//!   Gap           what is missing, and what closing it would take
//!     ↓
//!   EnvironmentPlan
//! ```
//!
//! ## The relationship between a Goal and a Profile
//!
//! They are **not** competing abstractions and this module does not replace the
//! profile system. A profile is the *installable* unit — it names software, it
//! has estimates, it is what the planner consumes. A goal is the *explanatory*
//! unit — it names capabilities, states a completion percentage, and produces a
//! recommendation.
//!
//! The link is [`Goal::profile_id`]: every goal points at a shipping profile, so
//! "I want to be an AI developer, what do I do?" resolves to a concrete install
//! the existing stage-3/4 machinery already knows how to perform. Nothing here
//! runs a process or writes a file.
//!
//! ## Why goals are data
//!
//! Same rule as every phase. A goal is a row in [`TABLE`]. Adding "考研机试" is
//! adding a row, and the completion percentage, gap list and recommendation all
//! fall out of the existing capability resolver for free — because a goal does
//! not restate what a capability needs, it *names* capabilities.

use crate::modules::capability::{self, CapabilityStatus};
use crate::modules::knowledge::Knowledge;

use serde::{Deserialize, Serialize};

/// One row of the goal table.
pub struct GoalSpec {
    pub id: &'static str,
    /// Shown on the goal-selection screen.
    pub name: &'static str,
    /// One line under the name, in the student's own terms.
    pub tagline: &'static str,
    /// Who this is for.
    pub audience: &'static str,
    /// The shipping profile that installs this goal.
    ///
    /// Not optional. A goal with no profile would be a recommendation the app
    /// cannot act on, and the whole point of linking them is that every gap the
    /// analysis reports is closable by a run the product already supports.
    pub profile_id: &'static str,
    /// The capabilities this goal is measured by.
    ///
    /// Every id must exist in the capability table, checked by
    /// [`validate_table`] — a typo here would silently lower a student's
    /// completion percentage, which is worse than a crash because it looks like
    /// an answer.
    pub capabilities: &'static [&'static str],
    /// Capabilities that are a bonus rather than part of the goal.
    ///
    /// Kept separate so the headline percentage is not made unreachable by
    /// something optional. Counting an optional capability in the denominator
    /// would mean a student is told "80%" forever with no way to reach 100.
    pub nice_to_have: &'static [&'static str],
}

/// Every goal the product offers.
///
/// Ordered as they are shown — broadest first, because a student who is unsure
/// should recognise themselves in the earlier entries.
pub const TABLE: &[GoalSpec] = &[
    GoalSpec {
        id: "ai_application",
        name: "AI 应用开发",
        tagline: "写调用大模型的程序，做自己的 AI 工具",
        audience: "想做 AI 项目、把大模型接到自己程序里的同学",
        profile_id: "ai_engineer",
        capabilities: &[
            "python-development",
            "ai-agent-development",
            "git-collaboration",
        ],
        nice_to_have: &["ai-cli-assistant", "vscode-ai-pairing"],
    },
    GoalSpec {
        id: "ai_usage",
        name: "AI 日常使用",
        tagline: "用 AI 帮忙写作业、查资料、处理文档",
        audience: "不打算写代码，只想把 AI 用起来的同学",
        profile_id: "beginner",
        capabilities: &["ai-desktop-assistant"],
        nice_to_have: &[],
    },
    GoalSpec {
        id: "coursework",
        name: "计算机课程学习",
        tagline: "完成 C/C++、Python 课程作业与实验",
        audience: "计算机相关专业，跟着课程走的同学",
        profile_id: "coder",
        capabilities: &["python-development", "cpp-learning", "git-collaboration"],
        nice_to_have: &["container-development"],
    },
    GoalSpec {
        id: "algorithm_research",
        name: "算法与模型研究",
        tagline: "训练模型、跑深度学习实验",
        audience: "要做机器学习实验、需要显卡算力的同学",
        profile_id: "ai_engineer",
        capabilities: &[
            "python-development",
            "local-model-inference",
            "git-collaboration",
        ],
        nice_to_have: &["linux-environment"],
    },
    GoalSpec {
        id: "fullstack",
        name: "全栈与部署",
        tagline: "写网站后端，把项目部署到服务器",
        audience: "做前后端项目、需要部署上线的同学",
        profile_id: "ai_engineer",
        capabilities: &[
            "node-development",
            "git-collaboration",
            "container-development",
        ],
        nice_to_have: &["linux-environment"],
    },
    GoalSpec {
        id: "tools_first",
        name: "命令行 AI 助手",
        tagline: "在终端里让 AI 直接改我的项目",
        audience: "已经会写代码，想用 AI 加速的同学",
        profile_id: "ai_engineer",
        capabilities: &["ai-cli-assistant", "git-collaboration"],
        nice_to_have: &["vscode-ai-pairing", "ai-agent-development"],
    },
];

/// The row for `id`, if the table has one.
pub fn lookup(id: &str) -> Option<&'static GoalSpec> {
    TABLE.iter().find(|g| g.id == id)
}

/// The goal the app pre-selects.
///
/// The broadest one, because a student who has not decided should land
/// somewhere that shows the most about their machine rather than somewhere
/// narrow that hides options.
pub fn default_goal() -> &'static GoalSpec {
    lookup("ai_application").expect("default goal must exist in the table")
}

pub fn all() -> &'static [GoalSpec] {
    TABLE
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/// A goal resolved against this machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentPlan {
    pub goal_id: String,
    pub goal_name: String,
    pub goal_tagline: String,
    /// The profile that would close the remaining gaps.
    pub profile_id: String,
    pub profile_name: String,
    /// 0–100, over the goal's *required* capabilities.
    pub completion: u32,
    /// Capabilities that are met, with the reason they matter.
    pub strengths: Vec<PlanEntry>,
    /// Capabilities that are not met, ordered most-blocking first.
    pub gaps: Vec<PlanEntry>,
    /// Capabilities that could not be measured.
    ///
    /// Kept apart from `gaps` for the same reason `unknown` is a separate status
    /// everywhere else in this app: "we could not check" must never be rendered
    /// as "you don't have it".
    pub unmeasured: Vec<PlanEntry>,
    /// Optional capabilities the student already has.
    pub bonuses: Vec<PlanEntry>,
    /// What to do next, in order. Empty when the goal is complete.
    pub next_steps: Vec<NextStep>,
    /// One sentence a student can read without opening anything else.
    pub headline: String,
    /// State of the machine overall, for the header.
    pub overall: String,
}

/// One capability, as the plan reports it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    pub capability_id: String,
    pub name: String,
    /// Why this capability is part of the goal, in student terms.
    pub description: String,
    pub status: String,
    /// The one-line state, e.g. "可以开始写 Python 了" or the fix.
    pub summary: String,
    /// Concepts a student should know to understand this row.
    ///
    /// Populated from the knowledge layer, and empty when that layer has nothing
    /// — which is the additive rule: no knowledge means fewer words, never a
    /// broken row.
    pub concepts: Vec<ConceptNote>,
}

/// A term worth explaining in the detail pane.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptNote {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub why_it_matters: String,
}

/// One recommended action.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NextStep {
    /// 1-based position, so the UI does not have to compute it.
    pub order: u32,
    /// What to do, phrased as an instruction.
    pub title: String,
    /// Why it matters, or what happens without it.
    pub reason: String,
    /// The capability this closes. Lets the UI link back to the row.
    pub capability_id: String,
    /// `install` | `configure` | `manual` | `hardware`.
    ///
    /// Four values rather than a bool because they lead to different UI: an
    /// `install` and a `configure` are things the app will do to the machine, a
    /// `manual` is something only the student can do (signing in, setting a Git
    /// identity), and a `hardware` is something *nobody* can do from inside this
    /// app. Offering a button for the last two would be a lie, and listing a
    /// memory upgrade beside "install Node" would put an impossible item in a
    /// to-do list the student is meant to work through.
    pub kind: &'static str,
}

/// Turns a requirement's satisfied-state label into a neutral noun phrase.
///
/// Requirement labels are written for a checklist, so they describe the state a
/// student wants to reach: "已安装 Claude Code", "Git 可在命令行调用". A reason
/// for an action needs to name the *thing*, not the state, or the sentence
/// contradicts the action beside it ("安装 X，因为需要已安装 X").
///
/// Deliberately a small strip rather than a rewrite: the labels are generated in
/// one place (`capability::evaluate`) with a known small set of shapes, and
/// anything unrecognised is passed through unchanged. Passing through is the safe
/// failure — a slightly formal sentence beats a mangled one.
///
/// Two shapes, not one. `evaluate` writes presence labels with the state *in
/// front* ("已安装 Grok") and callability labels with it *behind*
/// ("Git 可在命令行调用"). A prefix-only strip silently passed the second kind
/// through, which is how "Git 可在命令行调用" ended up in a sentence that had
/// already said the thing was not callable. Both are handled here so the reason
/// names the *thing* in either case.
fn strip_state_prefix(label: &str) -> String {
    for prefix in ["已安装 ", "安装 ", "已配置 ", "支持"] {
        if let Some(rest) = label.strip_prefix(prefix) {
            return rest.trim().to_string();
        }
    }
    for suffix in [" 可在命令行调用", " 可用"] {
        if let Some(rest) = label.strip_suffix(suffix) {
            return rest.trim().to_string();
        }
    }
    label.to_string()
}

/// Resolves a goal against the machine.
///
/// Takes `statuses` rather than facts so this module never probes anything and
/// never disagrees with the capability screen beside it — both read the same
/// resolved rows.
///
/// `knowledge` is optional *in the type sense only*: passing
/// [`Knowledge::default`] yields a plan with no concept notes and identical
/// percentages. Nothing about the analysis depends on the knowledge layer.
pub fn resolve(
    spec: &GoalSpec,
    statuses: &[CapabilityStatus],
    knowledge: &Knowledge,
    profile_name: &str,
) -> EnvironmentPlan {
    let find = |id: &str| statuses.iter().find(|s| s.id == id);

    let mut strengths = Vec::new();
    let mut gaps = Vec::new();
    let mut unmeasured = Vec::new();

    for id in spec.capabilities {
        let Some(status) = find(id) else {
            // A goal naming a capability the resolver did not return. This is a
            // wiring bug rather than a machine state, so it is reported as
            // unmeasured instead of being silently dropped — dropping it would
            // inflate the completion percentage for a reason nobody could see.
            unmeasured.push(PlanEntry {
                capability_id: (*id).to_string(),
                name: (*id).to_string(),
                description: String::new(),
                status: "unknown".into(),
                summary: "该能力未参与本次检测".into(),
                concepts: Vec::new(),
            });
            continue;
        };

        let entry = entry_from(status, knowledge);
        match status.status.as_str() {
            "available" => strengths.push(entry),
            "unknown" => unmeasured.push(entry),
            _ => gaps.push(entry),
        }
    }

    // Most-blocking first: a capability with nothing met is further from working
    // than one that is one requirement short, and a student reading a list of
    // five gaps should see the biggest one at the top.
    gaps.sort_by_key(|g| {
        let status = find(&g.capability_id);
        match status {
            Some(s) => s.required_count.saturating_sub(s.met_count),
            None => 0,
        }
    });
    gaps.reverse();

    let bonuses: Vec<PlanEntry> = spec
        .nice_to_have
        .iter()
        .filter_map(|id| find(id))
        .filter(|s| s.status == "available")
        .map(|s| entry_from(s, knowledge))
        .collect();

    let total = spec.capabilities.len() as u32;
    let met = strengths.len() as u32;
    let completion = if total == 0 {
        100
    } else {
        // Rounded to the nearest whole percent, computed in integers to avoid a
        // float that renders as 66.666666 in a headline.
        (met * 100 + total / 2) / total
    };

    let next_steps = next_steps_for(statuses, spec, &gaps, &unmeasured);
    let headline = headline_for(completion, &gaps, &unmeasured, &strengths);

    EnvironmentPlan {
        goal_id: spec.id.to_string(),
        goal_name: spec.name.to_string(),
        goal_tagline: spec.tagline.to_string(),
        profile_id: spec.profile_id.to_string(),
        profile_name: profile_name.to_string(),
        completion,
        strengths,
        gaps,
        unmeasured,
        bonuses,
        next_steps,
        headline,
        overall: overall_for(statuses, spec),
    }
}

fn entry_from(status: &CapabilityStatus, knowledge: &Knowledge) -> PlanEntry {
    PlanEntry {
        capability_id: status.id.clone(),
        name: status.name.clone(),
        description: status.description.clone(),
        status: status.status.clone(),
        summary: status.summary.clone(),
        concepts: knowledge
            .concepts_for_capability(&status.id)
            .into_iter()
            .map(|c| ConceptNote {
                id: c.id.clone(),
                name: c.name.clone(),
                summary: c.summary.clone(),
                why_it_matters: c.why_it_matters.clone(),
            })
            .collect(),
    }
}

/// Turns gaps into ordered advice.
///
/// The ordering rule: `install` before `configure` before `manual`. That is
/// delivery order — there is no point telling a student to set a Git identity
/// before Git exists — and it also means the list reads top-down as a plan
/// rather than as a bag of tasks.
fn next_steps_for(
    statuses: &[CapabilityStatus],
    spec: &GoalSpec,
    gaps: &[PlanEntry],
    unmeasured: &[PlanEntry],
) -> Vec<NextStep> {
    let mut steps: Vec<NextStep> = Vec::new();
    let mut order = 1u32;

    for gap in gaps {
        let Some(status) = statuses.iter().find(|s| s.id == gap.capability_id) else {
            continue;
        };
        // Only the *unmet required* requirements produce advice. A partial
        // capability can have several, and reporting all of them at once would
        // turn a three-item plan into a nine-item one.
        let missing: Vec<&capability::RequirementOutcome> = status
            .requirements
            .iter()
            .filter(|r| r.necessity == "required" && !r.met && !r.unknown)
            .collect();

        for req in missing {
            let Some(remedy) = &req.remedy else { continue };

            // Four kinds, and the fourth is the one this classification exists to
            // get right.
            //
            // `hardware` is not `configure`. A student told "内存不足（当前 15.5
            // GB，建议 16 GB 以上）" cannot install more RAM, and offering that
            // under a heading that implies an action is a claim the app cannot
            // deliver. The real evidence for this: on the development machine the
            // advisor's first recommendation was a memory upgrade, which is
            // correct as *information* and useless as a *step*.
            //
            // The distinction is by requirement kind rather than by which fact,
            // so a new hardware threshold is classified correctly without anyone
            // remembering to add it here.
            let kind = match req.key.split('.').next() {
                Some("onPath") | Some("program") => "install",
                Some("config") => "manual",
                // Every `fact.*` requirement is a property of the machine.
                Some("fact") => "hardware",
                _ => "configure",
            };
            steps.push(NextStep {
                order,
                title: remedy.clone(),
                // The reason states the *unmet condition*, phrased from the
                // requirement's own two halves.
                //
                // A requirement carries its target in `label` ("已安装 Claude
                // Code" — the satisfied state, correct wording for a checklist
                // row) and its current state in `observed` ("未安装"). Naively
                // reusing `label` as the reason for an action produced the
                // contradiction "安装 Claude Code / 命令行 AI 助手需要：已安装
                // Claude Code". So the reason is built from both, in the
                // direction that reads correctly for a *missing* item: what is
                // wrong now, and what it is blocking.
                //
                // No space is inserted before `observed`: every value
                // `capability::evaluate` produces already starts with its own
                // state word ("未安装", "已安装，但命令行找不到", "检测未完成",
                // "1.5 GB"), and "当前 未安装" read as a typo rather than as two
                // words. The separator is the punctuation, not whitespace.
                reason: format!(
                    "{}需要 {}，当前{}",
                    spec.name,
                    strip_state_prefix(&req.label),
                    req.observed
                ),
                capability_id: gap.capability_id.clone(),
                kind,
            });
            order += 1;
        }
    }

    // Unmeasured capabilities produce a *re-check*, not an install. Telling a
    // student to install something we could not confirm is absent is the exact
    // failure this whole app is built to avoid.
    if !unmeasured.is_empty() {
        steps.push(NextStep {
            order,
            title: "重新检测环境".into(),
            reason: format!(
                "有 {} 项条件无法确认，重新检测后再看结论",
                unmeasured.len()
            ),
            capability_id: unmeasured[0].capability_id.clone(),
            kind: "configure",
        });
    }

    steps
}

fn headline_for(
    completion: u32,
    gaps: &[PlanEntry],
    unmeasured: &[PlanEntry],
    strengths: &[PlanEntry],
) -> String {
    if gaps.is_empty() && unmeasured.is_empty() {
        return format!("你的环境已经可以开始这个方向了（{completion}%）。");
    }
    if gaps.is_empty() {
        return format!(
            "主要条件已满足，但有 {} 项无法确认，建议重新检测。",
            unmeasured.len()
        );
    }
    if strengths.is_empty() {
        return format!(
            "还差 {} 项才能开始这个方向，按下面的顺序来即可。",
            gaps.len()
        );
    }
    format!(
        "已完成 {completion}%，还差 {} 项就可以开始这个方向。",
        gaps.len()
    )
}

/// One line describing the machine as a whole, independent of the goal.
///
/// Deliberately *not* goal-specific: it is the sentence a student reads before
/// they have chosen anything, so it must be true for every goal.
fn overall_for(statuses: &[CapabilityStatus], spec: &GoalSpec) -> String {
    let relevant: Vec<&CapabilityStatus> = statuses
        .iter()
        .filter(|s| spec.capabilities.contains(&s.id.as_str()))
        .collect();
    let available = relevant.iter().filter(|s| s.status == "available").count();

    if relevant.is_empty() {
        return "尚未检测".into();
    }
    if available == relevant.len() {
        return format!("{} 项条件全部满足", relevant.len());
    }
    format!("{}/{} 项条件满足", available, relevant.len())
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// Structural checks, run from a test.
///
/// Returns problems rather than panicking so a failing run shows all of them.
pub fn validate_table() -> Vec<String> {
    let mut problems = Vec::new();
    let mut seen = std::collections::BTreeSet::new();

    for spec in TABLE {
        if !seen.insert(spec.id) {
            problems.push(format!("重复的目标 id: {}", spec.id));
        }
        if spec.name.trim().is_empty() {
            problems.push(format!("{} 没有名称", spec.id));
        }
        if spec.capabilities.is_empty() {
            problems.push(format!("{} 没有能力项，完成度将恒为 100%", spec.id));
        }
        for id in spec.capabilities.iter().chain(spec.nice_to_have.iter()) {
            if capability::lookup_by_str(id).is_none() {
                problems.push(format!("{} 引用了未知能力 “{id}”", spec.id));
            }
        }
        // A capability in both lists would be counted twice, once as required
        // and once as a bonus, producing a percentage and a bonus row that
        // disagree about the same thing.
        for id in spec.nice_to_have {
            if spec.capabilities.contains(id) {
                problems.push(format!("{id} 同时出现在 {} 的必需项与加分项中", spec.id));
            }
        }
    }

    problems
}

/// Goals whose profile is not among the loaded profiles.
///
/// Separate from [`validate_table`] because it needs runtime data — the profile
/// store — whereas `validate_table` is a pure check over the const. A goal whose
/// profile is missing is reported to the UI rather than hidden: the analysis is
/// still true even when the app cannot act on it.
pub fn goals_without_profiles(known_profile_ids: &[String]) -> Vec<String> {
    TABLE
        .iter()
        .filter(|g| !known_profile_ids.iter().any(|p| p == g.profile_id))
        .map(|g| g.id.to_string())
        .collect()
}

/// The `Profile` a goal installs, for the existing plan builder.
pub fn profile_for_goal(id: &str) -> Option<&'static str> {
    lookup(id).map(|g| g.profile_id)
}

/// A goal view for the selection screen, without resolving anything.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalView {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub audience: String,
    pub profile_id: String,
    /// Names of the required capabilities, for the "需要什么" list.
    pub needs: Vec<String>,
    /// Names of the bonus capabilities.
    pub bonuses: Vec<String>,
}

impl GoalView {
    pub fn from_spec(spec: &'static GoalSpec, profiles_known: bool) -> Self {
        let name_of = |id: &str| {
            capability::lookup_by_str(id)
                .map(|s| s.name.to_string())
                .unwrap_or_else(|| id.to_string())
        };
        Self {
            id: spec.id.to_string(),
            name: spec.name.to_string(),
            tagline: spec.tagline.to_string(),
            audience: spec.audience.to_string(),
            profile_id: if profiles_known {
                spec.profile_id.to_string()
            } else {
                String::new()
            },
            needs: spec.capabilities.iter().map(|c| name_of(c)).collect(),
            bonuses: spec.nice_to_have.iter().map(|c| name_of(c)).collect(),
        }
    }
}
