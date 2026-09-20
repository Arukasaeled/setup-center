//! Advisor summary — the answer to "so how am I doing?".
//!
//! ## What this is not
//!
//! It is not an installation report. The existing `SetupReport` (stage 1–4) is
//! the record of *what happened*: this step ran, that step failed, here is the
//! error text. That is the right artefact after a run, and it is written from
//! execution records.
//!
//! This module produces something different: an analysis of *the machine as it
//! is now*, independent of whether any run ever happened.
//!
//! ## Why the distinction is load-bearing
//!
//! The brief for this phase said it plainly: **the report's source must be
//! verification, not the execution log.** The failure mode being avoided is
//! concrete and common — a step reports success, the write silently fails, and
//! the report says "✓ configured" about something that is not configured. A
//! student then cannot understand why the tool they were told was set up does
//! not work.
//!
//! So this summary is built from exactly two inputs, both of which are *read
//! from the machine*:
//!
//! * [`CapabilityStatus`] rows, whose `unknown` state is preserved rather than
//!   rounded to a pass or a fail;
//! * [`SoftwareInventory`] items, produced by the detection layer.
//!
//! Nothing here accepts an `ExecutionSession`, and that is enforced by the
//! function signatures rather than by convention.

use crate::model::*;
use crate::modules::capability::CapabilityStatus;
use crate::modules::knowledge::{goal, Knowledge};

use serde::Serialize;

/// The advisory view of a machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorSummary {
    /// Headline score, 0–100.
    pub score: u32,
    /// One of `excellent` | `good` | `fair` | `limited` | `unknown`.
    ///
    /// A word as well as a number because "72" alone tells a first-year student
    /// nothing about whether that is fine.
    pub grade: &'static str,
    /// The sentence under the score.
    pub headline: String,
    /// What the machine is good at.
    pub strengths: Vec<Finding>,
    /// What is missing, most significant first.
    pub gaps: Vec<Finding>,
    /// What could not be measured.
    pub unmeasured: Vec<Finding>,
    /// Installed software that no capability in the table accounts for.
    ///
    /// Informational only — never a gap. It exists so a student who has, say,
    /// Rust installed sees that the app noticed, rather than reading a summary
    /// that silently omits it and wondering whether the scan worked.
    pub extras: Vec<Finding>,
    /// What a student could plausibly do with this machine.
    ///
    /// Derived from the capability table, not authored — see
    /// [`eligible_goals`]. A machine that cannot run local models does not list
    /// the research goal, so the list is always achievable.
    pub suited_for: Vec<GoalFitness>,
    /// The recommended next actions.
    pub recommendations: Vec<Recommendation>,
    /// How many capabilities were considered.
    pub capabilities_checked: u32,
    pub capabilities_met: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub name: String,
    pub detail: String,
    /// How significant this is to the overall picture.
    pub severity: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalFitness {
    pub goal_id: String,
    pub goal_name: String,
    pub completion: u32,
    /// `ready` | `close` | `distant`.
    pub readiness: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub order: u32,
    pub title: String,
    pub reason: String,
    /// `install` | `configure` | `manual` — see `goal::NextStep::kind`.
    pub kind: &'static str,
}

/// Builds the advisory summary.
///
/// `goal_plans` is the per-goal analysis, already resolved. Taking it as input
/// rather than recomputing means the summary and the goal screen can never
/// disagree: they are views over one resolution.
pub fn summarize(
    statuses: &[CapabilityStatus],
    inventory: Option<&SoftwareInventory>,
    goal_plans: &[goal::EnvironmentPlan],
    knowledge: &Knowledge,
) -> AdvisorSummary {
    let mut strengths = Vec::new();
    let mut gaps = Vec::new();
    let mut unmeasured = Vec::new();
    let mut findings_extra = Vec::new();

    for status in statuses {
        let detail = knowledge
            .software_note_for_capability(&status.id)
            .unwrap_or_else(|| status.description.clone());
        let finding = Finding {
            id: status.id.clone(),
            name: status.name.clone(),
            detail,
            severity: "info",
        };
        match status.status.as_str() {
            "available" => strengths.push(finding),
            "unknown" => unmeasured.push(Finding {
                severity: "warn",
                ..finding
            }),
            _ => gaps.push(Finding {
                severity: if status.met_count == 0 { "high" } else { "medium" },
                ..finding
            }),
        }
    }

    // Highest impact first: a capability with nothing satisfied blocks more than
    // one that is a single requirement short.
    let severity_of = |id: &str| {
        statuses
            .iter()
            .find(|s| s.id == id)
            .map(|s| s.required_count.saturating_sub(s.met_count))
            .unwrap_or(0)
    };
    gaps.sort_by_key(|g| std::cmp::Reverse(severity_of(&g.id)));

    // Software that is present but that no capability accounts for. Surfaced
    // because the alternative reads as an omission: a student who has Rust
    // installed sees a summary that never mentions it and reasonably wonders
    // whether the app looked. This is a *note*, not a gap — nothing is wrong.
    if let Some(inv) = inventory {
        let known: std::collections::BTreeSet<&str> = statuses
            .iter()
            .flat_map(|s| {
                knowledge
                    .software_for_capability(&s.id)
                    .into_iter()
                    .map(|k| k.id.as_str())
            })
            .collect();
        for item in &inv.items {
            if item.installed && !known.is_empty() && !known.contains(item.id.key()) {
                // Only mention it if at least one capability is in play, so an
                // empty knowledge base does not produce a wall of "extra" rows.
                findings_extra.push(Finding {
                    id: item.id.key().to_string(),
                    name: item.id.display_name().to_string(),
                    detail: knowledge
                        .software(item.id)
                        .map(|k| k.description.clone())
                        .filter(|d| !d.is_empty())
                        .unwrap_or_else(|| item.id.purpose().to_string()),
                    severity: "info",
                });
            }
        }
    }

    let relevant: Vec<&CapabilityStatus> = statuses
        .iter()
        .filter(|s| s.status != "available" || s.required_count > 0)
        .collect();
    let met = strengths.len() as u32;
    let measured = relevant.iter().filter(|s| s.status != "unknown").count() as u32;

    // The score counts only capabilities we could *measure*. An unmeasured one
    // is excluded from both numerator and denominator rather than counted as a
    // failure — otherwise a machine whose probes were blocked would score 0 and
    // be described as incapable, which is the worst claim this app could make.
    let score = if measured == 0 {
        0
    } else {
        (met * 100 + measured / 2) / measured
    };

    let (grade, headline) = grade_for(score, measured, statuses.len() as u32);

    AdvisorSummary {
        score,
        grade,
        headline,
        strengths,
        gaps,
        unmeasured,
        extras: findings_extra,
        suited_for: eligible_goals(goal_plans),
        recommendations: recommendations_from(goal_plans),
        capabilities_checked: statuses.len() as u32,
        capabilities_met: met,
    }
}

/// The grade word and its sentence.
///
/// The `unknown` case is handled first and separately. A machine that was not
/// measured has no score, and reporting "0 分" would be a claim about the
/// machine rather than about the measurement — so the grade says so instead.
fn grade_for(score: u32, measured: u32, total: u32) -> (&'static str, String) {
    if measured == 0 {
        return (
            "unknown",
            format!("共 {total} 项能力，但没有一项检测完成，暂时无法给出评估。"),
        );
    }
    if measured < total {
        return (
            grade_word(score),
            format!(
                "已检测 {measured}/{total} 项，其中 {score}% 满足条件；未检测的部分不计入评分。"
            ),
        );
    }
    (
        grade_word(score),
        match score {
            90..=100 => "这台电脑的 AI 开发环境已经完整，可以直接开始项目。".to_string(),
            70..=89 => "基础已经打好，补齐少量缺项就能顺利开发。".to_string(),
            40..=69 => "核心工具还不齐，按建议顺序补齐即可。".to_string(),
            _ => "大部分开发条件尚未满足，建议从下面的第一步开始。".to_string(),
        },
    )
}

fn grade_word(score: u32) -> &'static str {
    match score {
        90..=100 => "excellent",
        70..=89 => "good",
        40..=69 => "fair",
        _ => "limited",
    }
}

/// Goals this machine can actually reach, with how close it is.
///
/// Sorted by completion so the most reachable appears first — the list is
/// advice, and advice that leads with the hardest option is not advice.
pub fn eligible_goals(plans: &[goal::EnvironmentPlan]) -> Vec<GoalFitness> {
    let mut out: Vec<GoalFitness> = plans
        .iter()
        .map(|p| GoalFitness {
            goal_id: p.goal_id.clone(),
            goal_name: p.goal_name.clone(),
            completion: p.completion,
            readiness: match p.completion {
                100 => "ready",
                60..=99 => "close",
                _ => "distant",
            },
        })
        .collect();
    out.sort_by_key(|g| std::cmp::Reverse(g.completion));
    out
}

/// Merges every goal's next steps into one ordered list, deduplicated.
///
/// Deduplication is not cosmetic: five of the six goals require Git, so an
/// undeduplicated list would open with the same instruction five times and a
/// student would reasonably conclude the app was broken.
fn recommendations_from(plans: &[goal::EnvironmentPlan]) -> Vec<Recommendation> {
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for plan in plans {
        for step in &plan.next_steps {
            if seen.insert(step.title.clone()) {
                out.push(Recommendation {
                    order: 0,
                    title: step.title.clone(),
                    reason: step.reason.clone(),
                    kind: step.kind,
                });
            }
        }
    }
    for (i, r) in out.iter_mut().enumerate() {
        r.order = i as u32 + 1;
    }
    out
}

/// The machine-hardware part of the analysis, for the summary's header.
///
/// Separate from the capability findings because hardware cannot be installed:
/// "8 GB 内存" is a fact about the computer, not a gap a student can close by
/// running the installer, and mixing the two would put an un-actionable item in
/// a list of actions.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineAssessment {
    pub cpu: String,
    pub memory: String,
    pub gpu: String,
    pub disk: String,
    /// Anything worth knowing about the hardware, already phrased.
    pub notes: Vec<String>,
}

pub fn assess_machine(report: Option<&EnvironmentReport>) -> Option<MachineAssessment> {
    let report = report?;

    let cpu = report
        .machine
        .cpu
        .as_ref()
        .map(|c| {
            let cores = c
                .logical_cores
                .map(|n| format!("{n} 线程"))
                .unwrap_or_else(|| "线程数未知".into());
            format!("{} · {cores}", c.name)
        })
        .unwrap_or_else(|| "未能读取处理器信息".into());

    let memory = report
        .machine
        .memory
        .as_ref()
        .map(|m| format_gb(m.total_bytes))
        .unwrap_or_else(|| "未能读取内存信息".into());

    let gpu = if report.machine.gpus.is_empty() {
        "未检测到显卡".to_string()
    } else {
        report
            .machine
            .gpus
            .iter()
            .map(|g| match g.vram_bytes {
                Some(bytes) => format!("{} ({})", g.name, format_gb(bytes)),
                // No fabricated capacity. A card whose VRAM could not be read is
                // named without a number rather than reported as 0 GB.
                None => format!("{} (显存未知)", g.name),
            })
            .collect::<Vec<_>>()
            .join("、")
    };

    let disk = report
        .disks
        .iter()
        .map(|d| format!("{} 可用 {}", d.root, format_gb(d.free_bytes)))
        .collect::<Vec<_>>()
        .join("，");

    let mut notes = Vec::new();
    if let Some(mem) = &report.machine.memory {
        let gb = mem.total_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
        if gb < 8.0 {
            notes.push("内存低于 8 GB，同时运行编辑器和命令行 AI 工具会比较吃力。".into());
        }
    }
    let has_discrete = report
        .machine
        .gpus
        .iter()
        .any(|g| g.vram_bytes.is_some_and(|v| v >= 6 * 1024 * 1024 * 1024));
    if !has_discrete {
        notes.push("未检测到 6 GB 以上显存的独立显卡，本地运行大模型会比较慢。".into());
    }
    if report.machine.virtualization_enabled == Some(false) {
        notes.push("虚拟化未开启，Docker 与 WSL 需要它，需要在 BIOS 中打开。".into());
    }

    Some(MachineAssessment {
        cpu,
        memory,
        gpu,
        disk,
        notes,
    })
}

fn format_gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

/// Renders the summary as plain text for the report file.
///
/// Plain text rather than HTML or Markdown because the file is written to the
/// student's desktop and opened in Notepad as often as in an editor. A heading
/// level nobody renders is noise.
pub fn render_text(summary: &AdvisorSummary, machine: Option<&MachineAssessment>) -> String {
    let mut out = String::new();
    out.push_str("AI 开发环境分析\n");
    out.push_str("================\n\n");

    out.push_str(&format!("综合评分: {} / 100\n", summary.score));
    out.push_str(&format!("{}\n\n", summary.headline));

    if let Some(m) = machine {
        out.push_str("硬件\n----\n");
        out.push_str(&format!("处理器: {}\n", m.cpu));
        out.push_str(&format!("内存:   {}\n", m.memory));
        out.push_str(&format!("显卡:   {}\n", m.gpu));
        out.push_str(&format!("磁盘:   {}\n", m.disk));
        for note in &m.notes {
            out.push_str(&format!("  · {note}\n"));
        }
        out.push('\n');
    }

    if !summary.strengths.is_empty() {
        out.push_str("已具备的能力\n------------\n");
        for s in &summary.strengths {
            out.push_str(&format!("  ✓ {}\n", s.name));
        }
        out.push('\n');
    }

    if !summary.gaps.is_empty() {
        out.push_str("尚未具备的能力\n--------------\n");
        for g in &summary.gaps {
            out.push_str(&format!("  ✗ {}\n", g.name));
            out.push_str(&format!("      {}\n", g.detail));
        }
        out.push('\n');
    }

    if !summary.unmeasured.is_empty() {
        out.push_str("无法确认\n--------\n");
        for u in &summary.unmeasured {
            out.push_str(&format!("  ? {}\n", u.name));
        }
        out.push_str("  （未能检测不等同于未安装，建议重新检测）\n\n");
    }

    if !summary.extras.is_empty() {
        out.push_str("已安装的其他软件\n----------------\n");
        for e in &summary.extras {
            out.push_str(&format!("  · {} — {}\n", e.name, e.detail));
        }
        out.push('\n');
    }

    if !summary.suited_for.is_empty() {
        out.push_str("适合的方向\n----------\n");
        for g in &summary.suited_for {
            let mark = match g.readiness {
                "ready" => "✓",
                "close" => "△",
                _ => "·",
            };
            out.push_str(&format!("  {mark} {} （{}/100）\n", g.goal_name, g.completion));
        }
        out.push('\n');
    }

    if summary.recommendations.is_empty() {
        out.push_str("建议\n----\n  当前没有需要补的项。\n\n");
    } else {
        out.push_str("建议的下一步\n------------\n");
        for r in &summary.recommendations {
            out.push_str(&format!("  {}. {}\n", r.order, r.title));
            out.push_str(&format!("     {}\n", r.reason));
        }
        out.push('\n');
    }

    out
}
