//! Tests for the knowledge layer.
//!
//! ## What these tests are for
//!
//! The brief named four cases that must not go wrong, and they are the spine of
//! this file:
//!
//! 1. **Missing knowledge must not break the app.** Deleting every knowledge
//!    file has to leave a working product that says less — not a crash, not an
//!    empty screen.
//! 2. **Software present but unknown must still show basic info.** The catalog
//!    fallback from before this layer existed is the floor.
//! 3. **Unknown state must not produce advice.** A row we could not measure must
//!    never be rendered as missing, and must never generate an install step.
//! 4. **Different goals must produce different requirements.** Otherwise the
//!    goal layer is decoration.
//!
//! The remaining tests cover the YAML reader's contract with real files, the
//! cross-check that catches typos, and the version-note matching that the brief
//! singled out as "knowledge, not a verdict".

use super::*;
use crate::modules::capability::{self, CapabilityStatus};
use crate::modules::knowledge::{advisor, goal};

fn store() -> Knowledge {
    Knowledge::load(None)
}

/// A knowledge base with nothing in it, for the degradation tests.
fn empty() -> Knowledge {
    Knowledge {
        software: Default::default(),
        concepts: Default::default(),
        warnings: Vec::new(),
        source_dir: None,
    }
}

// ---------------------------------------------------------------------------
// Case 1 — missing knowledge must not break anything
// ---------------------------------------------------------------------------

#[test]
fn an_empty_knowledge_base_is_usable_not_a_failure() {
    let k = empty();
    assert!(k.is_empty());
    assert_eq!(k.software_count(), 0);
    assert!(k.warnings.is_empty(), "an empty base is not a warning");
}

#[test]
fn every_catalogued_program_shows_something_even_with_no_knowledge() {
    // The floor: before this layer existed the app showed `display_name` and
    // `purpose` from the enum. Removing the knowledge files must not make a row
    // blank — a blank row is worse than an unexplained one, because the student
    // cannot even tell what they are looking at.
    let k = empty();
    for id in SoftwareId::ALL {
        let shown = k.shown_for(id);
        assert!(!shown.name.trim().is_empty(), "{} has no name", id.key());
        assert!(
            !shown.description.trim().is_empty(),
            "{} has no description",
            id.key()
        );
        assert!(
            !shown.purposes.is_empty(),
            "{} has no purpose",
            id.key()
        );
        assert!(
            !shown.from_knowledge,
            "{} should report the fallback",
            id.key()
        );
    }
}

#[test]
fn a_missing_knowledge_directory_falls_back_instead_of_empty() {
    let k = Knowledge::load(Some(std::path::Path::new("Z:\\does\\not\\exist")));
    assert!(k.source_dir.is_none(), "must not claim a source directory");
    assert!(k.software_count() > 0, "must fall back to builtins");
    assert!(k.concept_count() > 0, "concepts must fall back too");
    // A directory that does not exist is the normal state of a build that did
    // not bundle the resources, so it is not a warning — but the fallback must
    // still be complete enough to run.
    assert!(k.warnings.is_empty(), "unexpected: {:?}", k.warnings);
}

#[test]
fn one_bad_knowledge_file_does_not_lose_the_good_ones() {
    let dir = std::env::temp_dir().join("aissetup-partial-knowledge");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("software")).unwrap();
    std::fs::write(
        dir.join("software").join("good.yaml"),
        "id: git\nname: Git\ndescription: ok\n",
    )
    .unwrap();
    std::fs::write(dir.join("software").join("broken.yaml"), ": : : not valid").unwrap();

    let k = Knowledge::load(Some(&dir));
    assert!(k.software(SoftwareId::Git).is_some(), "the good file must load");
    assert!(
        k.warnings.iter().any(|w| w.contains("broken.yaml")),
        "the bad file must be reported: {:?}",
        k.warnings
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_empty_directory_falls_back_with_a_warning() {
    let dir = std::env::temp_dir().join("aissetup-empty-knowledge");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("software")).unwrap();
    std::fs::create_dir_all(dir.join("concept")).unwrap();

    let k = Knowledge::load(Some(&dir));
    assert!(k.software_count() > 0, "must not start empty");
    assert!(k.source_dir.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn knowledge_naming_unknown_software_warns_but_does_not_fail() {
    // A typo in a YAML file must be visible, and must not take down the load.
    let dir = std::env::temp_dir().join("aissetup-unknown-knowledge");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("software")).unwrap();
    std::fs::write(
        dir.join("software").join("ghost.yaml"),
        "id: definitely_not_real\nname: Ghost\n",
    )
    .unwrap();
    std::fs::write(
        dir.join("software").join("git.yaml"),
        "id: git\nname: Git\n",
    )
    .unwrap();

    let k = Knowledge::load(Some(&dir));
    assert!(k.software(SoftwareId::Git).is_some());
    assert!(
        k.warnings.iter().any(|w| w.contains("definitely_not_real")),
        "{:?}",
        k.warnings
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn knowledge_naming_an_unknown_capability_is_reported() {
    let dir = std::env::temp_dir().join("aissetup-badcap-knowledge");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("software")).unwrap();
    std::fs::write(
        dir.join("software").join("git.yaml"),
        "id: git\nrelatedCapabilities: [not-a-real-capability]\n",
    )
    .unwrap();
    let k = Knowledge::load(Some(&dir));
    assert!(
        k.warnings.iter().any(|w| w.contains("not-a-real-capability")),
        "{:?}",
        k.warnings
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn knowledge_naming_an_unknown_dependency_is_reported() {
    let dir = std::env::temp_dir().join("aissetup-baddep-knowledge");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("software")).unwrap();
    std::fs::write(
        dir.join("software").join("git.yaml"),
        "id: git\ndependsOn: [ghost_program]\n",
    )
    .unwrap();
    let k = Knowledge::load(Some(&dir));
    assert!(k.warnings.iter().any(|w| w.contains("ghost_program")), "{:?}", k.warnings);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Case 2 — software present, knowledge absent
// ---------------------------------------------------------------------------

#[test]
fn a_program_without_knowledge_still_reports_its_catalog_purpose() {
    let k = empty();
    let shown = k.shown_for(SoftwareId::Git);
    assert_eq!(shown.name, "Git");
    assert_eq!(shown.description, SoftwareId::Git.purpose());
    assert!(!shown.from_knowledge);
    // The structured fields are empty rather than invented.
    assert!(shown.student_explanation.is_empty());
    assert!(shown.related_capabilities.is_empty());
    assert!(shown.versions.is_empty());
}

#[test]
fn a_program_with_knowledge_reports_the_file_contents() {
    let k = store();
    let shown = k.shown_for(SoftwareId::Git);
    assert!(shown.from_knowledge);
    assert!(!shown.student_explanation.is_empty());
    assert!(
        shown.related_capabilities.contains(&"git-collaboration".to_string()),
        "{:?}",
        shown.related_capabilities
    );
    assert!(shown.purposes.len() >= 2, "{:?}", shown.purposes);
}

#[test]
fn a_half_written_knowledge_entry_falls_back_field_by_field() {
    // An entry with a name but no purpose must not produce an empty purpose
    // list, because the UI renders it as a bulleted section.
    let dir = std::env::temp_dir().join("aissetup-thin-knowledge");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("software")).unwrap();
    std::fs::write(dir.join("software").join("git.yaml"), "id: git\nname: 自定义名字\n").unwrap();
    let k = Knowledge::load(Some(&dir));

    let shown = k.shown_for(SoftwareId::Git);
    assert_eq!(shown.name, "自定义名字", "the file wins where it speaks");
    assert!(!shown.purposes.is_empty(), "but purpose falls back");
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Case 3 — unknown state must not produce advice
// ---------------------------------------------------------------------------

fn status(id: &str, state: &str) -> CapabilityStatus {
    CapabilityStatus {
        id: id.into(),
        name: id.into(),
        description: String::new(),
        group: "development".into(),
        group_name: "开发能力".into(),
        status: state.into(),
        outcome: String::new(),
        requirements: Vec::new(),
        met_count: 0,
        required_count: 1,
        summary: String::new(),
    }
}

/// A status with one unmet required requirement, so the plan has something to
/// advise. The bare [`status`] helper has no requirements, which is correct for
/// the status-classification tests but produces no remedies.
fn status_with_gap(id: &str, key: &str, remedy: &str) -> CapabilityStatus {
    CapabilityStatus {
        status: "unavailable".into(),
        met_count: 0,
        required_count: 1,
        summary: remedy.to_string(),
        requirements: vec![capability::RequirementOutcome {
            key: key.into(),
            label: format!("已安装 {id}"),
            necessity: "required",
            met: false,
            unknown: false,
            observed: "未安装".into(),
            remedy: Some(remedy.into()),
        }],
        ..status(id, "unavailable")
    }
}

#[test]
fn an_unknown_capability_never_becomes_a_gap() {
    // The central discipline of the whole product, asserted at the advisor.
    let statuses = vec![status("python-development", "unknown")];
    let summary = advisor::summarize(&statuses, None, &[], &store());
    assert!(summary.gaps.is_empty(), "unknown must not be a gap");
    assert_eq!(summary.unmeasured.len(), 1);
}

#[test]
fn an_unknown_capability_does_not_generate_an_install_step() {
    let statuses = vec![status("python-development", "unknown")];
    let spec = goal::lookup("ai_application").unwrap();
    let plan = goal::resolve(spec, &statuses, &store(), "方案");
    assert!(
        plan.next_steps.iter().all(|s| s.kind != "install"),
        "advising an install for an unmeasured capability: {:?}",
        plan.next_steps
    );
    // But the student is still told something, or the screen looks broken.
    assert!(!plan.next_steps.is_empty());
    assert!(plan.next_steps[0].title.contains("重新检测"));
}

#[test]
fn a_fully_unmeasured_machine_scores_zero_by_exclusion_not_by_failure() {
    // Every capability unknown: the score must not claim the machine is bad.
    let statuses: Vec<CapabilityStatus> = capability::TABLE
        .iter()
        .map(|s| status(s.id.as_str(), "unknown"))
        .collect();
    let summary = advisor::summarize(&statuses, None, &[], &empty());

    assert_eq!(summary.score, 0);
    assert_eq!(summary.grade, "unknown", "0 must not be graded as a failure");
    assert!(summary.headline.contains("无法给出评估"), "{}", summary.headline);
    assert!(summary.gaps.is_empty());
}

#[test]
fn a_partially_measured_machine_excludes_the_unmeasured_from_the_score() {
    let statuses = vec![
        status("a", "available"),
        status("b", "available"),
        status("c", "unknown"),
        status("d", "unknown"),
    ];
    let summary = advisor::summarize(&statuses, None, &[], &empty());
    // 2 met of 2 measured = 100, not 2 of 4 = 50.
    assert_eq!(summary.score, 100, "{}", summary.headline);
    assert_eq!(summary.unmeasured.len(), 2);
}

#[test]
fn unknown_and_absent_are_reported_as_different_things() {
    let statuses = vec![
        status("python-development", "unknown"),
        status("node-development", "unavailable"),
    ];
    let summary = advisor::summarize(&statuses, None, &[], &empty());
    let gap_ids: Vec<&str> = summary.gaps.iter().map(|g| g.id.as_str()).collect();
    let unk_ids: Vec<&str> = summary.unmeasured.iter().map(|g| g.id.as_str()).collect();
    assert_eq!(gap_ids, vec!["node-development"]);
    assert_eq!(unk_ids, vec!["python-development"]);
}

// ---------------------------------------------------------------------------
// Case 4 — different goals produce different plans
// ---------------------------------------------------------------------------

#[test]
fn different_goals_name_different_capabilities() {
    let a = goal::lookup("ai_application").unwrap();
    let b = goal::lookup("ai_usage").unwrap();
    assert_ne!(a.capabilities, b.capabilities);
    assert_ne!(a.capabilities.len(), b.capabilities.len());
}

#[test]
fn different_goals_produce_different_completions_for_the_same_machine() {
    // A machine with only Claude Desktop: the "日常使用" goal is met, the
    // "AI 应用开发" goal is not. If this test passes trivially the goal layer is
    // decorative, so it asserts on exact numbers.
    let statuses = vec![
        status("ai-desktop-assistant", "available"),
        status("python-development", "available"),
        status("ai-agent-development", "unavailable"),
        status("git-collaboration", "available"),
    ];
    let knowledge = store();

    let usage = goal::resolve(goal::lookup("ai_usage").unwrap(), &statuses, &knowledge, "P");
    let app = goal::resolve(goal::lookup("ai_application").unwrap(), &statuses, &knowledge, "P");

    assert_eq!(usage.completion, 100);
    assert_eq!(app.completion, 67, "2 of 3 required capabilities");
    assert_ne!(usage.completion, app.completion);
}

#[test]
fn a_goal_with_a_gap_recommends_that_gap_first() {
    let statuses = vec![
        status("python-development", "available"),
        status_with_gap("ai-agent-development", "onPath.node", "安装 Node.js"),
        status("git-collaboration", "available"),
    ];
    let plan = goal::resolve(
        goal::lookup("ai_application").unwrap(),
        &statuses,
        &store(),
        "方案",
    );
    assert_eq!(plan.gaps.len(), 1);
    assert_eq!(plan.gaps[0].capability_id, "ai-agent-development");
    assert!(!plan.next_steps.is_empty(), "a gap must produce a step");
    assert_eq!(plan.next_steps[0].title, "安装 Node.js");
    assert_eq!(plan.next_steps[0].kind, "install");
}

#[test]
fn a_missing_program_is_advised_as_an_install_and_a_config_as_manual() {
    // The three kinds lead to different UI, so the classification is
    // load-bearing: offering an action button for something only the student can
    // do (signing in, setting a Git identity) would be a lie.
    let statuses = vec![
        status_with_gap("git-collaboration", "onPath.git", "安装 Git"),
        status_with_gap("ai-agent-development", "config.git.identity", "配置 Git 身份"),
        status_with_gap("container-development", "fact.disk.free.gb", "磁盘空间不足"),
    ];
    let plan = goal::resolve(
        goal::lookup("ai_application").unwrap(),
        &statuses,
        &store(),
        "方案",
    );
    let kinds: Vec<&str> = plan.next_steps.iter().map(|s| s.kind).collect();
    assert!(kinds.contains(&"install"), "{kinds:?}");
    assert!(kinds.contains(&"manual"), "{kinds:?}");
    assert!(kinds.contains(&"configure"), "{kinds:?}");
}

#[test]
fn a_hardware_requirement_is_never_advised_as_an_action() {
    // Found on the development machine: the advisor's first recommendation was
    // "内存不足（当前 15.5 GB，建议 16 GB 以上）" classified as `configure`, which
    // puts an impossible task at the top of a to-do list. A student cannot
    // install more RAM, and the app must not imply otherwise.
    let statuses = vec![status_with_gap(
        "local-model-inference",
        "fact.gpu.vram.gb",
        "显存不足（当前 2.0 GB，建议 6 GB 以上）",
    )];
    let plan = goal::resolve(
        goal::lookup("algorithm_research").unwrap(),
        &statuses,
        &store(),
        "方案",
    );
    // Only one capability is supplied, so the other required ones resolve as
    // unmeasured and add a re-check step. The hardware step is the one asserted.
    let step = plan
        .next_steps
        .iter()
        .find(|s| s.capability_id == "local-model-inference")
        .expect("a step for the hardware gap");
    assert_eq!(
        step.kind, "hardware",
        "a hardware limit must be labelled as one: {step:?}"
    );
}

#[test]
fn a_reason_does_not_contradict_the_action_it_explains() {
    // The rendered bug this pins: the overview showed "安装 Claude Code" with the
    // reason "命令行 AI 助手需要：已安装 Claude Code" — the explanation stated the
    // desired end state as though it were already true, directly above the button
    // offering to do it.
    let statuses = vec![CapabilityStatus {
        id: "ai-cli-assistant".into(),
        name: "命令行 AI 助手".into(),
        requirements: vec![capability::RequirementOutcome {
            key: "program.claude_code".into(),
            label: "已安装 Claude Code".into(),
            necessity: "required",
            met: false,
            unknown: false,
            observed: "未安装".into(),
            remedy: Some("安装 Claude Code".into()),
        }],
        ..status("ai-cli-assistant", "unavailable")
    }];
    let plan = goal::resolve(
        goal::lookup("tools_first").unwrap(),
        &statuses,
        &store(),
        "方案",
    );
    let step = plan
        .next_steps
        .iter()
        .find(|s| s.title.contains("Claude Code"))
        .expect("a step to install Claude Code");

    assert!(
        !step.reason.contains("需要已安装"),
        "the reason states the target as if it were already true: {}",
        step.reason
    );
    assert!(
        step.reason.contains("当前未安装"),
        "the reason should state the present condition: {}",
        step.reason
    );
}

#[test]
fn a_reason_carries_the_capability_and_the_current_state() {
    let statuses = vec![CapabilityStatus {
        requirements: vec![capability::RequirementOutcome {
            key: "onPath.git".into(),
            label: "Git 可在命令行调用".into(),
            necessity: "required",
            met: false,
            unknown: false,
            observed: "已安装，但命令行找不到".into(),
            remedy: Some("重启终端，让 Git 进入 PATH".into()),
        }],
        ..status("git-collaboration", "partial")
    }];
    let plan = goal::resolve(
        goal::lookup("coursework").unwrap(),
        &statuses,
        &store(),
        "方案",
    );
    let step = plan
        .next_steps
        .iter()
        .find(|s| s.title.contains("PATH"))
        .expect("a PATH step");
    assert!(step.reason.contains("当前已安装，但命令行找不到"), "{}", step.reason);
}

/// The phrasing rules, pinned as data rather than trusted to review.
///
/// Every string in the capability layer is composed from a small noun and a
/// template, and each defect below shipped at least once because nothing was
/// watching the *seam* between the two:
///
/// * "内存 至少 16 GB" — unit before noun reads as translated English.
/// * "当前 未安装" — a space inserted before a value that already carries its
///   own state word.
/// * "支持虚拟化支持" — a noun that had absorbed the state word, then prefixed
///   with the same word again.
/// * "已配置Git 身份" — a template with no separator where the noun needs one.
///
/// These assert against the *generated* strings on a real fact set, so a future
/// edit to `evaluate` that reintroduces any of them fails here rather than in a
/// screenshot a student sees.
#[test]
fn every_generated_requirement_label_reads_as_chinese_not_as_a_template() {
    use crate::modules::capability::{self, EnvironmentFacts};

    // Every fact present, so every branch of `evaluate` produces a label.
    let mut facts = EnvironmentFacts::default();
    facts.numbers.insert(capability::FactKey::MemoryGb, 15.5);
    facts.numbers.insert(capability::FactKey::VramGb, 8.0);
    facts.numbers.insert(capability::FactKey::LogicalCores, 16.0);
    facts.numbers.insert(capability::FactKey::FreeDiskGb, 105.0);
    facts.numbers.insert(capability::FactKey::Virtualization, 1.0);
    facts.numbers.insert(capability::FactKey::NetworkOk, 1.0);
    for id in SoftwareId::ALL {
        facts.programs.insert(
            id,
            capability::ProgramPresence {
                installed: true,
                on_path: true,
                uncertain: false,
            },
        );
    }
    for key in [
        capability::ManualKey::GitIdentity,
        capability::ManualKey::ProxyConfigured,
        capability::ManualKey::SshKey,
    ] {
        facts.manual.insert(key, Some(true));
    }

    let statuses = capability::resolve(&facts, None);
    let labels: Vec<&str> = statuses
        .iter()
        .flat_map(|s| s.requirements.iter().map(|r| r.label.as_str()))
        .collect();
    assert!(!labels.is_empty(), "the table produced no requirements at all");

    for label in &labels {
        // A doubled state word ("支持虚拟化支持", "已安装已安装 X").
        for word in ["支持", "已安装", "已配置", "可用"] {
            let occurrences = label.matches(word).count();
            assert!(
                occurrences <= 1,
                "the state word {word:?} appears {occurrences} times in {label:?}"
            );
        }
        // No space between a CJK character and an ASCII one is required, but a
        // space *before* a CJK character that is not a separator is a tell that a
        // template stitched two fragments without punctuation.
        assert!(
            !label.contains(" 已") && !label.contains(" 未") && !label.contains(" 支持"),
            "a template stitched two fragments without a separator: {label:?}"
        );
        // The threshold form puts the unit beside the number, not after the noun.
        if let Some(rest) = label.strip_prefix("至少 ") {
            let unit_at = rest.find("GB").or_else(|| rest.find("线程"));
            assert!(
                unit_at.is_some_and(|i| i < rest.chars().count()),
                "a threshold label has no unit beside its number: {label:?}"
            );
        }
    }

    // The two shapes that regressed, asserted by name so the test fails loudly
    // if either vocabulary drifts.
    assert!(
        labels.contains(&"支持虚拟化"),
        "the virtualisation label lost its bare-noun form: {labels:?}"
    );
    assert!(
        labels.contains(&"已配置 Git 身份"),
        "the manual label lost its separator: {labels:?}"
    );
    assert!(
        labels.iter().any(|l| l.starts_with("至少 16 GB 内存") || l.starts_with("至少 8 GB 内存")),
        "the memory threshold lost its unit-first form: {labels:?}"
    );
}

/// A reason never inserts whitespace before a value that carries its own state.
#[test]
fn no_reason_contains_a_space_before_a_state_word() {
    for goal_id in ["ai_application", "tools_first", "coursework"] {
        let Some(spec) = goal::lookup(goal_id) else {
            continue;
        };

        // One capability per requirement shape, each unmet, so every branch of
        // the reason builder runs.
        let statuses: Vec<CapabilityStatus> = [
            ("program.python", "已安装 Python", "未安装", "安装 Python"),
            ("onPath.git", "Git 可在命令行调用", "已安装，但命令行找不到", "重启终端"),
            ("config.git.identity", "已配置 Git 身份", "未配置", "配置 Git 用户名"),
            ("fact.memory.gb", "至少 16 GB 内存", "8.0 GB", "内存不足"),
        ]
        .into_iter()
        .map(|(key, label, observed, remedy)| CapabilityStatus {
            requirements: vec![capability::RequirementOutcome {
                key: key.into(),
                label: label.into(),
                necessity: "required",
                met: false,
                unknown: false,
                observed: observed.into(),
                remedy: Some(remedy.into()),
            }],
            ..status("python-development", "unavailable")
        })
        .collect();

        let plan = goal::resolve(spec, &statuses, &store(), "方案");
        for step in &plan.next_steps {
            assert!(
                !step.reason.contains(" 未") && !step.reason.contains(" 已"),
                "reason for {:?} has a space before a state word: {:?}",
                step.title,
                step.reason
            );
            // The suffix form must be stripped, or the sentence names the target
            // by its satisfied state.
            assert!(
                !step.reason.contains("可在命令行调用需要"),
                "a suffixed label was not stripped: {:?}",
                step.reason
            );
        }
    }
}

#[test]
fn every_requirement_key_shape_maps_to_a_known_kind() {    // The mapping is by key prefix, so a new requirement kind added to the
    // capability table without a matching arm would silently fall through to
    // `configure`. This asserts the four shapes the resolver actually emits.
    let cases = [
        ("onPath.git", "install"),
        ("program.python", "install"),
        ("config.git.identity", "manual"),
        ("fact.memory.gb", "hardware"),
    ];
    for (key, expected) in cases {
        let statuses = vec![status_with_gap("python-development", key, "修复")];
        let plan = goal::resolve(
            goal::lookup("ai_application").unwrap(),
            &statuses,
            &store(),
            "方案",
        );
        let step = plan
            .next_steps
            .iter()
            .find(|s| s.capability_id == "python-development")
            .unwrap_or_else(|| panic!("{key} produced no step: {:?}", plan.next_steps));
        assert_eq!(step.kind, expected, "key {key}");
    }
}

#[test]
fn a_complete_goal_recommends_nothing() {
    let statuses = vec![
        status("python-development", "available"),
        status("ai-agent-development", "available"),
        status("git-collaboration", "available"),
    ];
    let plan = goal::resolve(
        goal::lookup("ai_application").unwrap(),
        &statuses,
        &store(),
        "方案",
    );
    assert_eq!(plan.completion, 100);
    assert!(plan.gaps.is_empty());
    assert!(plan.next_steps.is_empty(), "nothing to do: {:?}", plan.next_steps);
    assert!(plan.headline.contains("已经可以开始"), "{}", plan.headline);
}

#[test]
fn nice_to_have_capabilities_do_not_lower_the_completion_percentage() {
    // The bug this prevents: a student sits at 80% forever because the
    // denominator includes something optional they chose not to install.
    let statuses = vec![
        status("python-development", "available"),
        status("ai-agent-development", "available"),
        status("git-collaboration", "available"),
        // Both nice_to_have entries missing/unavailable.
        status("ai-cli-assistant", "unavailable"),
        status("vscode-ai-pairing", "unavailable"),
    ];
    let plan = goal::resolve(
        goal::lookup("ai_application").unwrap(),
        &statuses,
        &store(),
        "方案",
    );
    assert_eq!(plan.completion, 100);
    assert!(plan.bonuses.is_empty());
}

#[test]
fn a_goal_naming_an_unknown_capability_is_a_validation_problem() {
    // Guards the table itself: a typo would silently lower a percentage.
    let problems = goal::validate_table();
    assert!(problems.is_empty(), "{problems:?}");
}

#[test]
fn every_goal_in_the_table_validates_and_points_at_a_known_capability() {
    assert!(!goal::TABLE.is_empty());
    for spec in goal::TABLE {
        for id in spec.capabilities.iter().chain(spec.nice_to_have.iter()) {
            assert!(
                capability::lookup_by_str(id).is_some(),
                "{} names unknown capability {id}",
                spec.id
            );
        }
    }
}

#[test]
fn a_goal_with_no_measurement_reports_unmeasured_not_zero_percent_wrongly() {
    let plan = goal::resolve(
        goal::lookup("ai_application").unwrap(),
        &[],
        &store(),
        "方案",
    );
    assert_eq!(plan.completion, 0);
    assert!(plan.gaps.is_empty());
    assert_eq!(plan.unmeasured.len(), 3);
    assert!(plan.headline.contains("无法确认"), "{}", plan.headline);
}

// ---------------------------------------------------------------------------
// Version notes — knowledge, not a verdict
// ---------------------------------------------------------------------------

#[test]
fn a_version_note_matches_by_prefix() {
    let note = VersionNote {
        topic: "t".into(),
        versions: vec!["3.13".into(), "3.14".into()],
        note: "n".into(),
    };
    assert!(note.applies_to("3.14.0"));
    assert!(note.applies_to("3.13.7"));
    assert!(!note.applies_to("3.12.1"));
    assert!(!note.applies_to("3.1"));
}

#[test]
fn a_version_note_with_no_versions_applies_to_everything() {
    let note = VersionNote {
        topic: "t".into(),
        versions: vec![],
        note: "n".into(),
    };
    assert!(note.applies_to("1.0"));
    assert!(note.applies_to("99.99.99"));
}

#[test]
fn python_carries_a_version_note_about_the_ai_ecosystem() {
    // The brief asked for this specifically: the app must be able to say
    // "3.13/3.14 are newer than most packages target" without calling it wrong.
    let k = store();
    let py = k.software(SoftwareId::Python).expect("python knowledge");
    let note = py
        .versions
        .iter()
        .find(|n| n.topic.contains("兼容"))
        .expect("a compatibility note");
    assert!(note.applies_to("3.14.2"));
    // The note must not read as a verdict. Checking for the *absence of a word*
    // is not reliable here — the note legitimately contains "这不是错误" ("this
    // is not an error"), so a naive substring check fails on correct text.
    // What actually distinguishes knowledge from a verdict is that the note
    // names an alternative rather than issuing a command, so that is what is
    // asserted.
    assert!(
        note.note.contains("3.11") && note.note.contains("3.12"),
        "the note must name what is better supported: {}",
        note.note
    );
    assert!(
        !note.note.contains("必须") && !note.note.contains("建议降级"),
        "the note must inform, not instruct: {}",
        note.note
    );
}

// ---------------------------------------------------------------------------
// Cross-layer consistency
// ---------------------------------------------------------------------------

#[test]
fn every_knowledge_capability_reference_exists_in_the_table() {
    // Same check the loader does, asserted directly so a failure names the file.
    let k = store();
    let mut bad = Vec::new();
    for id in SoftwareId::ALL {
        if let Some(entry) = k.software(id) {
            for cap in &entry.related_capabilities {
                if capability::lookup_by_str(cap).is_none() {
                    bad.push(format!("{} -> {cap}", id.key()));
                }
            }
        }
    }
    assert!(bad.is_empty(), "{bad:?}");
}

#[test]
fn the_builtin_knowledge_loads_without_warnings() {
    // A warning here means a shipped file has a typo. That is a shipping bug,
    // not a runtime condition, so it fails the suite.
    let k = store();
    assert!(k.warnings.is_empty(), "{:?}", k.warnings);
}

#[test]
fn builtin_knowledge_covers_the_programs_the_profiles_install() {
    // Not a completeness requirement over all 21 catalog entries — but every
    // program a shipping profile installs should be explainable.
    use crate::modules::profiles::ProfileStore;
    let k = store();
    let profiles = ProfileStore::load(None);
    let mut missing = Vec::new();
    for profile in profiles.all() {
        for id in &profile.software {
            if k.software(*id).is_none() {
                missing.push(format!("{} ({})", id.key(), profile.id));
            }
        }
    }
    assert!(missing.is_empty(), "unexplained: {missing:?}");
}

/// Every shipped knowledge file must resolve its references.
///
/// ## Why this test exists separately from `the_builtin_knowledge_loads_without_warnings`
///
/// That test loads with `None`, which falls back to the *compiled-in* set — and
/// the compiled-in set deliberately omitted `java.yaml` and `rust.yaml`. So two
/// files that named capabilities the table does not have (`java-development`,
/// `rust-development`) produced a warning only on a real machine, where the
/// files are read from disk. The suite was green and the product was telling a
/// maintainer its knowledge base was broken.
///
/// This loads the directory the app actually ships and fails on any warning.
/// A dangling capability id means a row whose 关联能力 silently shows nothing.
#[test]
fn the_shipped_knowledge_directory_has_no_dangling_references() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("knowledge");
    assert!(dir.is_dir(), "knowledge dir missing: {}", dir.display());
    let k = Knowledge::load(Some(&dir));
    assert_eq!(
        k.source_dir.as_deref(),
        Some(dir.as_path()),
        "the shipped files must be what was read"
    );
    assert!(k.warnings.is_empty(), "{:?}", k.warnings);
    assert_eq!(
        k.software_without_knowledge(),
        Vec::new(),
        "every catalogued program needs an explanation file"
    );
}

/// The compiled-in set must be the shipped set.
///
/// ## Why this test did not exist until now, and what it cost
///
/// [`BUILTIN`]'s own doc comment claimed a `knowledge_matches_builtin` test
/// asserted the two do not drift — but no such test was ever written, and they
/// had drifted: the compiled-in set carried 17 of the 29 shipped files. A binary
/// built without the resource directory silently explained two-thirds as much as
/// the source did, and nothing said so.
///
/// The drift also *hid a real bug*: `java.yaml` and `rust.yaml` named
/// capabilities the table does not have, which warns on every real machine and
/// warned in no test, precisely because those two files were missing from the
/// compiled-in set that the suite loads through.
#[test]
fn knowledge_matches_builtin() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("knowledge");
    let disk = Knowledge::load(Some(&dir));
    let builtin = Knowledge::load(None);
    assert!(
        builtin.source_dir.is_none(),
        "load(None) must take the compiled-in path"
    );

    let disk_software: Vec<&String> = disk.software.keys().collect();
    let builtin_software: Vec<&String> = builtin.software.keys().collect();
    assert_eq!(
        builtin_software, disk_software,
        "the compiled-in software files have drifted from src-tauri/knowledge/software/"
    );

    let disk_concepts: Vec<&String> = disk.concepts.keys().collect();
    let builtin_concepts: Vec<&String> = builtin.concepts.keys().collect();
    assert_eq!(builtin_concepts, disk_concepts, "concepts have drifted");

    for id in SoftwareId::ALL {
        assert!(
            builtin.software.contains_key(id.key()),
            "{} is compiled in nowhere: a machine without bundled resources cannot explain it",
            id.key()
        );
    }
}

#[test]
fn on_disk_knowledge_is_preferred_over_builtin() {
    let dir = std::env::temp_dir().join("aissetup-custom-knowledge");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("software")).unwrap();
    std::fs::write(
        dir.join("software").join("git.yaml"),
        "id: git\nname: 自定义 Git\ndescription: d\n",
    )
    .unwrap();

    let k = Knowledge::load(Some(&dir));
    assert_eq!(k.source_dir.as_deref(), Some(dir.as_path()));
    assert_eq!(k.shown_for(SoftwareId::Git).name, "自定义 Git");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn concept_files_land_in_the_concept_namespace_not_the_software_one() {
    // The failure this guards: a concept file being parsed as software and
    // putting "PATH" in the program list, where it renders as permanently
    // missing and makes the dashboard look broken.
    let k = store();
    assert!(k.concept("mcp").is_some());
    assert!(k.concept("cuda").is_some());
    assert!(k.concept("path").is_some());
    assert!(
        SoftwareId::ALL.iter().all(|id| id.key() != "mcp"),
        "a concept must never be reachable as software"
    );
}

#[test]
fn concepts_are_found_by_the_capability_they_explain() {
    let k = store();
    let mcp = k.concepts_for_capability("ai-agent-development");
    assert!(
        mcp.iter().any(|c| c.id == "mcp"),
        "MCP should explain agent development: {:?}",
        mcp.iter().map(|c| &c.id).collect::<Vec<_>>()
    );
}

#[test]
fn a_capability_with_no_concept_returns_an_empty_list_not_an_error() {
    let k = empty();
    assert!(k.concepts_for_capability("python-development").is_empty());
    assert!(k.software_note_for_capability("python-development").is_none());
}

#[test]
fn software_notes_are_found_by_capability() {
    let k = store();
    let note = k.software_note_for_capability("python-development");
    assert!(note.is_some(), "python development should be explained");
    assert!(note.unwrap().contains("Python"));
}

#[test]
fn parse_software_rejects_a_document_with_no_id() {
    assert!(parse_software("name: Git\n").is_err());
}

#[test]
fn parse_software_rejects_an_unknown_field() {
    // `deny_unknown_fields` is on, so a misspelled key is an error rather than a
    // silently dropped field. Without this, `studentExplanation` vs
    // `student_explanation` would produce an app that mysteriously explains
    // nothing.
    let bad = "id: git\nstudent_explanation: wrong key style\n";
    assert!(parse_software(bad).is_err());
}

#[test]
fn parse_applies_camel_case_names() {
    let text = "id: git\nstudentExplanation: 说明\nrelatedCapabilities: [git-collaboration]\n";
    let parsed = parse_software(text).unwrap();
    assert_eq!(parsed.student_explanation, "说明");
    assert_eq!(parsed.related_capabilities, vec!["git-collaboration"]);
}

#[test]
fn profiles_and_knowledge_agree_on_the_git_dependency_chain() {
    // Claude Code needs Node, and both the knowledge file and the capability
    // table should reflect that. This asserts the *knowledge* side only — the
    // capability side has its own test.
    let k = store();
    let cc = k.software(SoftwareId::ClaudeCode).unwrap();
    assert!(
        cc.depends_on.contains(&"node".to_string()),
        "{:?}",
        cc.depends_on
    );
}
