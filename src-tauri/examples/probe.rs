// Dumps the real command payloads to JSON so the UI verification harness runs
// against genuine data shapes rather than hand-written fixtures.
//
// Lives in `examples/` rather than `src/bin/` on purpose: a second bin target
// makes `tauri build` ambiguous about which artefact is the application, and it
// would ship a diagnostic binary to users. Examples are opt-in and never bundled.
//
// Run with:
//   cargo run --example probe > ../tools/fixtures.json
//
// This is the bridge that makes the frontend verifiable: the same structs the
// Tauri commands return are serialised here, straight from Rust.

use ai_student_setup_lib::model::*;
use ai_student_setup_lib::modules::{catalog, capability, config, detect, install, inventory, knowledge, license, verify};
use ai_student_setup_lib::modules::bootstrap::{self, plan as bootstrap_plan, run as bootstrap_run};
use ai_student_setup_lib::state::AppState;

use serde_json::{json, Value};
use std::path::PathBuf;

/// Hand-picked program lists to capture plans for.
///
/// Chosen for what each one would catch:
///
/// * `CherryStudio` alone — the exact request from the bug report. The plan must
///   contain Cherry Studio and must NOT contain any AI CLI, which is what the
///   capability layer used to force in.
/// * `CherryStudio + Vscode` — two programs from different catalog categories,
///   so the plan order and the per-program strategy list are both exercised
///   outside a profile.
/// * `Codex` alone — an AI CLI picked *instead of* Claude Code, so a regression
///   that hard-wires Claude Code into the plan is caught here rather than by a
///   student.
/// * `Chatbox + Node` — a pair where one program is a dependency of nothing and
///   the other has no dependency, i.e. no ordering help from the profile.
const PICKED: &[&[SoftwareId]] = &[
    &[SoftwareId::CherryStudio],
    &[SoftwareId::CherryStudio, SoftwareId::Vscode],
    &[SoftwareId::Codex],
    &[SoftwareId::Chatbox, SoftwareId::Node],
];

/// The fixture key for a hand-picked list: the ids joined, in the order given.
fn picked_key(ids: &[SoftwareId]) -> String {
    ids.iter().map(|id| id.key()).collect::<Vec<_>>().join("+")
}

/// One program's install strategy, in the shape `install_strategies` returns.
fn strategy_json(cat: &catalog::Catalog, id: SoftwareId) -> Value {
    let spec = install::spec_from(cat, id);
    // A detect-only program has an empty chain, so `chain[0]` would panic. The
    // UI still gets a row, with a description that says who does the work —
    // silence here would render as a blank line.
    let preferred = spec
        .chain
        .first()
        .map(|f| install::describe_source(&f.source))
        .unwrap_or_else(|| "本工具只检测，需要你手动安装".to_string());
    json!({
        "id": id,
        "name": id.display_name(),
        "purpose": id.purpose(),
        "preferred": preferred,
        "fallbacks": spec.chain.iter().skip(1)
            .map(|f| format!("{}（{}）", f.rationale, install::describe_source(&f.source)))
            .collect::<Vec<_>>(),
    })
}

fn main() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let state = AppState::new(Some(manifest));
    let cat = catalog::Catalog::builtin();

    let profiles = state.profiles.all();
    let required_mb = state.required_download_mb();

    // Real detection, on this machine.
    let environment = detect::detect(required_mb).expect("detection failed");

    // The real Software Intelligence Layer scan: three independent providers,
    // merged. This is the same call the app makes, so the fixtures the UI is
    // verified against are genuine output rather than invented shapes.
    let inv = inventory::scan(&cat, &SoftwareId::ALL);
    let scan = SoftwareScan {
        scanned_at: inv.scanned_at.clone(),
        inventory: inv.clone(),
    };

    // Print the inventory summary to stderr so it is visible when piping stdout
    // to the fixtures file. A silent example is hard to trust.
    eprintln!("--- software inventory ({} providers) ---", inv.providers.join(", "));
    for item in &inv.items {
        eprintln!(
            "  {:<16} installed={:<5} conf={:<8?} ver={:<16} path={}",
            item.name,
            item.installed,
            item.confidence,
            item.version.as_deref().unwrap_or("-"),
            item.path.as_deref().unwrap_or("-"),
        );
        for ev in &item.evidence {
            eprintln!(
                "      {} → {}{}",
                ev.source.display_name(),
                ev.outcome,
                ev.detail
                    .as_deref()
                    .map(|d| format!(" ({d})"))
                    .unwrap_or_default()
            );
        }
    }

    let mut plans = serde_json::Map::new();
    let mut strategies = serde_json::Map::new();
    let mut verification_by_profile = serde_json::Map::new();
    let mut config_actions = serde_json::Map::new();
    let mut previews = serde_json::Map::new();

    for profile in &profiles {
        let plan = install::build_plan(&cat, profile, &scan);
        plans.insert(profile.id.clone(), serde_json::to_value(&plan).unwrap());
        // Preview per profile: the dry-run stream must match the chosen profile,
        // otherwise the UI is handed a 7-step stream for a 4-step plan.
        previews.insert(
            profile.id.clone(),
            serde_json::to_value(install::simulate_plan(&plan)).unwrap(),
        );

        let strat: Vec<Value> = profile
            .software
            .iter()
            .map(|id| strategy_json(&cat, *id))
            .collect();
        strategies.insert(profile.id.clone(), serde_json::to_value(strat).unwrap());

        let verification = verify::verify_plan(&plan, &scan);
        verification_by_profile
            .insert(profile.id.clone(), serde_json::to_value(&verification).unwrap());

        let actions = config::config_actions_for(&profile.software, &state.localization);
        config_actions.insert(profile.id.clone(), serde_json::to_value(&actions).unwrap());
    }

    // --- Hand-picked programs (0.1.4) -----------------------------------------
    //
    // The software list's row buttons build a plan from the programs the student
    // ticked instead of from a profile. That is the path the "I wanted Cherry
    // Studio and was told to install Claude" bug lived on, and until now it had
    // no fixture at all — so no frontend test could assert that pressing 安装 on
    // Cherry Studio yields a Cherry Studio plan.
    //
    // The lists are keyed by their own joined id list, which is what the harness
    // can reconstruct from the arguments the command receives. Every entry comes
    // out of the same `build_plan_with` and `strategy_json` the commands call, so
    // the fixture cannot drift from the product.
    let mut picked_plans = serde_json::Map::new();
    let mut picked_strategies = serde_json::Map::new();
    for ids in PICKED {
        let key = picked_key(ids);
        let plan = install::build_plan_with(&cat, "", None, ids, &scan);
        picked_plans.insert(key.clone(), serde_json::to_value(&plan).unwrap());
        let strat: Vec<Value> = ids.iter().map(|id| strategy_json(&cat, *id)).collect();
        picked_strategies.insert(key, serde_json::to_value(strat).unwrap());
    }

    // Use the widest profile as the default fixture.
    let primary = profiles
        .iter()
        .max_by_key(|p| p.software.len())
        .expect("no profiles");
    let primary_plan = install::build_plan(&cat, primary, &scan);
    let primary_verification = verify::verify_plan(&primary_plan, &scan);
    let primary_actions = config::config_actions_for(&primary.software, &state.localization);

    let report = SetupReport {
        generated_at: detect::now_iso8601(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        profile_id: primary.id.clone(),
        profile_name: primary.name.clone(),
        environment_score: environment.score,
        environment: environment.clone(),
        plan: primary_plan.clone(),
        verification: primary_verification.clone(),
        config_actions: primary_actions,
        not_attempted: vec![
            "MCP 服务器安装（后续版本）".into(),
            "Skills 安装（后续版本）".into(),
            "Agent 管理（后续版本）".into(),
        ],
    };
    let report_text = verify::render_text_report(&report);

    let preview = install::simulate_plan(&primary_plan);

    // Readiness for the primary plan: the same call the install screen makes
    // before it lets the student start. Emitting it here means the UI harness
    // verifies against the real shape rather than a hand-written object.
    let readiness = install::readiness(&primary_plan, &cat, environment.admin.is_elevated);

    // A realistic completed session per profile, built from that profile's real
    // plan and the real inventory. Per profile rather than one shared object:
    // a session whose step ids do not match the plan on screen is exactly the
    // drift this harness exists to catch, and a single 7-step session handed to
    // the 4-step "coder" plan would render as a list with nothing matched up.
    //
    // These are *not* executions — nothing is installed by this example — they
    // are the payload shapes the install screen renders, so the harness can
    // exercise the success, failure and resume branches without touching the
    // machine.
    let mut demo_sessions = serde_json::Map::new();
    for profile in &profiles {
        let plan = install::build_plan(&cat, profile, &scan);
        demo_sessions.insert(
            profile.id.clone(),
            json!({
                "completed": demo_session(&plan, &scan, DemoKind::Success),
                "partial": demo_session(&plan, &scan, DemoKind::PartialFailure),
                "halted": demo_session(&plan, &scan, DemoKind::PermissionHalt),
            }),
        );
    }

    let status = json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "profilesSource": state.profiles.source_dir.as_ref().map(|p| p.to_string_lossy().to_string()),
        "localizationSource": state.localization.source_dir.as_ref().map(|p| p.to_string_lossy().to_string()),
        "profileCount": profiles.len(),
        "localizationCount": state.localization.all().len(),
        "warnings": state.profiles.warnings.iter()
            .chain(state.localization.warnings.iter()).cloned().collect::<Vec<_>>(),
        "wingetVersion": install::winget_available().ok(),
        "isElevated": environment.admin.is_elevated,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    });

    // --- Bootstrap (stage 4) -------------------------------------------------
    //
    // The bootstrap fixtures are built through the *real* planner and the real
    // verification, then demo sessions are constructed through the real
    // `BootstrapSession` type. That is the whole point of this example: the UI is
    // verified against genuine shapes and genuine answers, so a drift between the
    // Rust model and the TypeScript mirror breaks this example rather than
    // silently producing a fixture the UI no longer matches.
    //
    // Nothing here writes to the machine. The plans are pure; the sessions are
    // assembled from statuses, not from runs.
    let mut bootstrap_plans = serde_json::Map::new();
    let mut bootstrap_sessions = serde_json::Map::new();

    for profile in &profiles {
        let context = bootstrap::probe_context(&inv);
        let plan = bootstrap_plan::build_plan(&cat, profile, &context);

        bootstrap_plans.insert(
            profile.id.clone(),
            bootstrap_plan_json(&plan),
        );

        // The demo sessions use the plan as the source of truth for what to
        // pretend happened, so the step ids always line up with the list the
        // screen is rendering.
        bootstrap_sessions.insert(
            profile.id.clone(),
            json!({
                "completed": demo_bootstrap_session(&plan, BootstrapDemoKind::Success),
                "partial": demo_bootstrap_session(&plan, BootstrapDemoKind::PartialFailure),
                "halted": demo_bootstrap_session(&plan, BootstrapDemoKind::PermissionHalt),
            }),
        );
    }

    let localization_targets: Vec<Value> = bootstrap::localization::provider_catalogue()
        .into_iter()
        .map(|provider| {
            json!({
                "id": provider.id,
                "target": provider.target,
                "upstream": provider.upstream,
                "method": match &provider.method {
                    bootstrap::localization::LocalizationMethod::Package { .. } => "官方语言包",
                    bootstrap::localization::LocalizationMethod::Script { .. } => "上游社区方案",
                },
            })
        })
        .collect();

    // --- Capability layer (stage 5) ------------------------------------------
    //
    // Built from the *same* environment report and inventory the app uses, so the
    // harness verifies against real capability answers for this machine rather
    // than a hand-written list. The manual checks are read for real (they run
    // `git config --global --list`), which means the Git-identity branch the UI
    // renders is the one the student would actually see.
    let manual = capability::probe_manual_facts(Some(&inv));
    let facts = capability::facts_from(Some(&environment), Some(&inv), manual);
    let capabilities = capability::resolve(&facts, None);

    // Per-profile capability sets, so the plan screen can show "what this buys
    // you" from the real projection rather than from a copy of it.
    let mut profile_capabilities = serde_json::Map::new();
    for profile in &profiles {
        profile_capabilities.insert(
            profile.id.clone(),
            json!({
                "derived": capability::from_profile(profile)
                    .iter()
                    .map(|c| c.as_str())
                    .collect::<Vec<_>>(),
                "unknownDeclared": capability::unknown_declared(profile),
            }),
        );
    }

    // Every catalogued program with the metadata the dashboard explains it with.
    let machine_catalogue: Vec<Value> = SoftwareId::ALL
        .iter()
        .map(|id| {
            json!({
                "id": id,
                "name": id.display_name(),
                "purpose": id.purpose(),
                "category": id.category().key(),
                "categoryName": id.category().name(),
                "installable": id.installable(),
            })
        })
        .collect();

    // --- Stage 5: knowledge, goals, advisor ---------------------------------
    //
    // Generated through the real loader and the real resolvers, so the harness
    // renders the knowledge the binary ships with and the plans this machine
    // actually produces. Hand-written fixtures here would test the fixture
    // rather than the product — the trap this file exists to avoid.
    //
    // The knowledge base is loaded the way `AppState` loads it, which during
    // `cargo run` means the checked-in `knowledge/` directory. A file that
    // failed to parse would show up as a warning in the fixtures rather than
    // silently reducing the UI to bare rows.
    let knowledge_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("knowledge");
    let knowledge = knowledge::Knowledge::load(Some(&knowledge_dir));

    let explained: Vec<Value> = SoftwareId::ALL
        .iter()
        .map(|id| {
            let shown = knowledge.shown_for(*id);
            let item = inv.find(*id);
            let version = item.and_then(|i| i.version.clone());
            let applicable_notes: Vec<&knowledge::VersionNote> = version
                .as_deref()
                .map(|v| shown.versions.iter().filter(|n| n.applies_to(v)).collect())
                .unwrap_or_default();
            json!({
                "knowledge": shown,
                "installed": item.map(|i| i.installed),
                "onPath": item.map(|i| i.on_path),
                "version": version,
                "confidence": match item.map(|i| i.confidence) {
                    Some(Confidence::Ok) => "confirmed",
                    Some(Confidence::Fail) => "confirmedAbsent",
                    Some(Confidence::Unknown) => "unknown",
                    Some(Confidence::Skipped) => "skipped",
                    None => "notScanned",
                },
                "evidence": item
                    .map(|i| i.evidence.iter().map(|e| evidence_label(e)).collect::<Vec<_>>())
                    .unwrap_or_default(),
                "capabilityNames": shown
                    .related_capabilities
                    .iter()
                    .filter_map(|c| capability::lookup_by_str(c))
                    .map(|s| s.name)
                    .collect::<Vec<_>>(),
                "applicableNotes": applicable_notes,
            })
        })
        .collect();

    let goal_views: Vec<Value> = knowledge::goal::TABLE
        .iter()
        .map(|spec| serde_json::to_value(knowledge::goal::GoalView::from_spec(spec, true)).unwrap())
        .collect();

    let goal_plans: Vec<Value> = knowledge::goal::TABLE
        .iter()
        .map(|spec| {
            let profile_name = profiles
                .iter()
                .find(|p| p.id == spec.profile_id)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| spec.profile_id.to_string());
            serde_json::to_value(knowledge::goal::resolve(
                spec,
                &capabilities,
                &knowledge,
                &profile_name,
            ))
            .unwrap()
        })
        .collect();

    // The advisor is built from the capability statuses and the inventory, which
    // is exactly what the command does — the fixture cannot be more generous than
    // the product.
    let resolved_plans: Vec<knowledge::goal::EnvironmentPlan> = knowledge::goal::TABLE
        .iter()
        .map(|spec| {
            let profile_name = profiles
                .iter()
                .find(|p| p.id == spec.profile_id)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| spec.profile_id.to_string());
            knowledge::goal::resolve(spec, &capabilities, &knowledge, &profile_name)
        })
        .collect();

    let advisor_summary = knowledge::advisor::summarize(
        &capabilities,
        Some(&inv),
        &resolved_plans,
        &knowledge,
    );
    let machine_assessment = knowledge::advisor::assess_machine(Some(&environment));

    let concepts: Vec<Value> = knowledge
        .all_concepts()
        .into_iter()
        .map(|c| serde_json::to_value(c).unwrap())
        .collect();

    let knowledge_status = json!({
        "softwareCount": knowledge.software_count(),
        "conceptCount": knowledge.concept_count(),
        "sourceDir": knowledge.source_dir.as_ref().map(|d| d.display().to_string()),
        "warnings": knowledge.warnings,
        "withoutKnowledge": knowledge
            .software_without_knowledge()
            .iter()
            .map(|id| id.key())
            .collect::<Vec<_>>(),
    });

    let out = json!({
        "environment": environment,
        "scan": scan,
        "profiles": profiles,
        "plans": plans,
        "pickedPlans": picked_plans,
        "pickedStrategies": picked_strategies,
        "strategies": strategies,
        "verificationByProfile": verification_by_profile,
        "configActions": config_actions,
        "preview": preview,
        "previews": previews,
        "readiness": readiness,
        "sessions": demo_sessions,
        "report": report,
        "reportText": report_text,
        "status": status,
        "bootstrapPlans": bootstrap_plans,
        "bootstrapSessions": bootstrap_sessions,
        "localizationTargets": localization_targets,
        "capabilities": capabilities,
        "profileCapabilities": profile_capabilities,
        "machineCatalogue": machine_catalogue,
        // Stage 5
        "explained": explained,
        "goals": {
            "goals": goal_views,
            "goalsWithoutProfiles": knowledge::goal::goals_without_profiles(
                &profiles.iter().map(|p| p.id.clone()).collect::<Vec<_>>()
            ),
            "defaultGoal": knowledge::goal::default_goal().id,
        },
        "goalPlans": goal_plans,
        "advisor": {
            "summary": advisor_summary,
            "machine": machine_assessment,
            "detected": true,
        },
        "concepts": concepts,
        "knowledgeStatus": knowledge_status,
        // Stage 5: licensing. Captured from the real projection rather than
        // hand-written, so the harness renders whichever tier/enforcement
        // combination this build actually ships. The default is what matters
        // here: an unenforced free tier, which must render as *not* gated.
        "license": {
            "freeUnenforced": license::Entitlements::of(&license::LicenseFile::default(), false),
            "freeEnforced": license::Entitlements::of(&license::LicenseFile::default(), true),
            // `LicenseFile` no longer carries the tier or the code: the stored
            // record is only `{version, license_hash, device_hash, activated_at}`
            // (see `license/mod.rs`). A PRO projection is therefore built from a
            // record that *has* a hash and a binding, not from a `tier` field.
            //
            // `device_hash` is this machine's real fingerprint on purpose: the
            // harness renders the activated screen from this entry, so a
            // placeholder hash would render the *failure* screen under a name
            // that promises the success one.
            "proEnforced": license::Entitlements::of(
                &license::LicenseFile {
                    // **`tier` must be set explicitly.** `LicenseFile::default()`
                    // yields `Tier::Free` (only a *deserialised* record that lacks
                    // the field defaults to `Pro`), so the `..Default::default()`
                    // below silently produced a FREE activation. The fixture was
                    // named `proEnforced` and reported `canInstall: false`, which
                    // meant no frontend suite has ever exercised the PRO install
                    // path — the one a paying customer uses, and the one where
                    // "I wanted Cherry Studio and got Claude" lived.
                    tier: license::Tier::Pro,
                    license_hash: Some(
                        "0000000000000000000000000000000000000000000000000000000000000000"
                            .to_string(),
                    ),
                    device_hash: Some(license::device_summary().0),
                    // A fixed date, and the only fabricated field in this block.
                    //
                    // It cannot be derived: this machine is not activated, and a
                    // value read from a real activation would change every time
                    // the fixtures are regenerated — making every UI diff noisy
                    // and the assertion below it flaky. A constant is the honest
                    // choice as long as it is clearly a fixture value, which is
                    // why it is named here rather than silently defaulted.
                    //
                    // Leaving it `None` is worse than either option: the licence
                    // screen correctly hides the 激活时间 row when there is no
                    // time, so the fixture would render a *different screen* from
                    // the one an activated customer sees, and the assertion about
                    // that row would pass for the wrong reason.
                    activated_at: Some("2026-01-15T10:30:00Z".to_string()),
                    ..Default::default()
                },
                true,
            ),
            // The state a customer reaches by copying `license.dat` to a second
            // PC, or by having their hardware change enough that the fingerprint
            // stops matching. It is produced by the *same* projection the other
            // entries use, with a device hash that deliberately is not this
            // machine's — which is exactly what a foreign machine's file holds.
            //
            // This belongs in the probe rather than in a hand-written fixture
            // because the licence screen has a distinct branch for it, and a
            // branch nothing generates is a branch nothing checks.
            "freeMismatch": license::Entitlements::of(
                &license::LicenseFile {
                    license_hash: Some(
                        "0000000000000000000000000000000000000000000000000000000000000000"
                            .to_string(),
                    ),
                    device_hash: Some("0".repeat(64)),
                    ..Default::default()
                },
                true,
            ),        },
        // What the licence screen prints beside the tier: the machine summary and
        // the probe count behind it. Emitted per mode because the screen shows
        // the mismatch variant only when the state calls for it, and the harness
        // has to be able to drive all of them.
        "licenseDevice": {
            "freeEnforced": license_device_summary(),
            "freeUnenforced": license_device_summary(),
            "proEnforced": license_device_summary(),
            "freeMismatch": license_device_summary(),
        },
    });

    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}

/// The machine summary the licence screen renders beside the tier.
///
/// Mirrors `commands::license_device` rather than calling it: that function is
/// `pub` on the Tauri-facing module and reads the machine's *real* stored
/// licence, whereas the fixtures must describe four modes the machine may not be
/// in. What is shared is the derivation, and the harness asserts on the rendered
/// result, so a drift between the two shows up as a failing assertion rather than
/// as a silent mismatch.
fn license_device_summary() -> Value {
    let (hash, components) = license::device_summary();
    let entitlements =
        license::Entitlements::of(&license::load(), license::enforcement_enabled());
    json!({
        // First 8 hex characters only, exactly as the command truncates it: enough
        // that two machines are visibly different in a support conversation, not
        // enough to correlate.
        "shortId": hash.chars().take(8).collect::<String>(),
        "componentsReadable": components,
        "reliable": entitlements.device_reliable,
        "boundHere": entitlements.state == license::LicenseState::Active,
        "state": entitlements.state,
    })
}

/// The same label the command produces for a probe source.
///
/// Duplicated rather than shared because `commands.rs` is Tauri-facing and this
/// is a build-time example; the harness asserts on the string, so the two
/// drifting would be caught by a UI test rather than by a silent mismatch.
fn evidence_label(e: &EvidenceView) -> String {    let source = match e.source {
        ProbeSource::Registry => "系统注册表",
        ProbeSource::Path => "命令行路径",
        ProbeSource::Winget => "winget 包列表",
    };
    match &e.detail {
        Some(d) => format!("{source} · {d}"),
        None => format!("{source} · {}", e.outcome),
    }
}

// ---------------------------------------------------------------------------
// Bootstrap fixtures (stage 4)
// ---------------------------------------------------------------------------

/// Renders a bootstrap plan into the shape the Tauri command returns.
///
/// Transcribed from `commands::BootstrapPlanView` rather than reusing it,
/// because that module pulls in Tauri and an example cannot depend on the app's
/// windowing layer. The `bootstrap_payload_matches_the_command_shape` test in
/// `bootstrap_tests.rs` is what keeps the two spellings from drifting.
fn bootstrap_plan_json(plan: &bootstrap_plan::BootstrapPlan) -> Value {
    let steps: Vec<Value> = plan
        .steps
        .iter()
        .map(|step| {
            json!({
                "actionId": step.action.id(),
                "stage": step.stage.key(),
                "stageName": step.stage.display_name(),
                "kind": bootstrap_step_kind(&step.action),
                "name": step.action.description(),
                "target": bootstrap_step_target(&step.action),
                "rationale": step.rationale,
                "needed": step.needed,
                "skipReason": step.skip_reason,
                "blocked": step.blocked,
            })
        })
        .collect();

    let stages: Vec<Value> = plan
        .stages
        .iter()
        .map(|s| {
            json!({
                "key": s.key,
                "name": s.name,
                "total": s.total,
                "needed": s.needed,
                "blocked": s.blocked,
            })
        })
        .collect();

    json!({
        "profileId": plan.profile_id,
        "steps": steps,
        "stages": stages,
        "neededCount": plan.needed_count(),
        "blockedCount": plan.blocked_count(),
        "notAttempted": plan.not_attempted,
    })
}

fn bootstrap_step_kind(action: &bootstrap_plan::BootstrapAction) -> &'static str {
    use bootstrap_plan::BootstrapAction;
    match action {
        BootstrapAction::Extension { .. } => "extension",
        BootstrapAction::ConfigCommand { .. } => "configCommand",
        BootstrapAction::FileWrite { .. } => "fileWrite",
        BootstrapAction::SkillInstall { .. } => "skillInstall",
        BootstrapAction::Localization { .. } => "localization",
    }
}

fn bootstrap_step_target(action: &bootstrap_plan::BootstrapAction) -> Option<String> {
    use bootstrap_plan::BootstrapAction;
    match action {
        BootstrapAction::Extension { id, .. } => Some(id.clone()),
        BootstrapAction::ConfigCommand { key, .. } => Some(key.clone()),
        BootstrapAction::FileWrite { path, .. } => Some(path.to_string_lossy().to_string()),
        BootstrapAction::SkillInstall {
            target_root, name, ..
        } => Some(target_root.join(name).to_string_lossy().to_string()),
        BootstrapAction::Localization { id, .. } => Some(id.clone()),
    }
}

/// Which branch of the bootstrap screen a demo session exercises.
#[derive(Clone, Copy)]
enum BootstrapDemoKind {
    Success,
    PartialFailure,
    PermissionHalt,
}

/// Builds a bootstrap session payload shaped exactly like the engine's output.
///
/// Constructed through the real [`bootstrap_run::BootstrapSession`] type, so a
/// change to the model breaks this example at compile time.
///
/// The verification attached to it comes from the *real* verifier fed a synthetic
/// machine state, so the report the UI renders is the one the real code would
/// produce for that state — not a hand-written object.
fn demo_bootstrap_session(
    plan: &bootstrap_plan::BootstrapPlan,
    kind: BootstrapDemoKind,
) -> Value {
    let mut session = bootstrap_run::BootstrapSession::new_for(plan.profile_id.clone());
    // `new_for` stamps "now"; the fixture is a fixed point in time so the report
    // is reproducible.
    session.started_at = "2026-01-01T10:05:00.0000000+08:00".into();
    session.id = "demo-bootstrap".into();

    // The first step that actually has work — chosen rather than a fixed index,
    // for the same reason the install demo does it: on a machine where the first
    // few steps are already satisfied, a fixed index lands on a skipped step and
    // the "failure" branch shows nothing failing.
    let carrier = plan
        .steps
        .iter()
        .position(|s| s.needed && s.blocked.is_none());

    for (index, step) in plan.steps.iter().enumerate() {
        let is_carrier = carrier == Some(index);
        let failed = matches!(kind, BootstrapDemoKind::PartialFailure) && is_carrier;
        let halted = matches!(kind, BootstrapDemoKind::PermissionHalt) && is_carrier;
        // Only steps *after* the carrier are left unattempted. A halted run stops
        // at the failure; it does not jump over earlier steps.
        let not_reached = matches!(kind, BootstrapDemoKind::PermissionHalt)
            && carrier.is_some_and(|c| index > c);

        let (status, label, detail) = if let Some(reason) = &step.blocked {
            (
                StepStatus::Cancelled,
                "无法执行".to_string(),
                Some(reason.clone()),
            )
        } else if not_reached {
            (
                StepStatus::Cancelled,
                "等待继续".to_string(),
                None,
            )
        } else if !step.needed {
            (
                StepStatus::Skipped,
                "无需操作".to_string(),
                step.skip_reason.clone(),
            )
        } else if halted {
            (
                StepStatus::Failed,
                "需要管理员权限".to_string(),
                Some(
                    "配置写入需要管理员权限。请右键以管理员身份重新运行本程序，然后重试。"
                        .to_string(),
                ),
            )
        } else if failed {
            (
                StepStatus::Failed,
                "未能完成".to_string(),
                Some(format!("{}：扩展未在插件列表中找到", step.action.description())),
            )
        } else {
            (
                StepStatus::Succeeded,
                "已完成".to_string(),
                step.skip_reason.clone(),
            )
        };

        session.steps.push(bootstrap_run::BootstrapStepProgress {
            action_id: step.action.id(),
            stage: step.stage,
            name: step.action.description(),
            status,
            index: index as u32,
            total: plan.steps.len() as u32,
            stage_label: label,
            description: step.action.description(),
            detail,
        });

        if failed || halted {
            session.failed_steps.push(step.action.id());
            session.remaining.push(step.action.id());
        } else if not_reached {
            session.remaining.push(step.action.id());
        }
    }

    session.finished_at = Some("2026-01-01T10:07:20.0000000+08:00".into());
    session.halted_reason = match kind {
        BootstrapDemoKind::PermissionHalt => Some(
            "配置写入或命令执行需要管理员权限。请右键以管理员身份重新运行本程序，然后重试。"
                .into(),
        ),
        _ => None,
    };

    // A synthetic post-run machine state, fed to the *real* verifier. The
    // success branch claims everything landed; the failure branches withhold the
    // carrier step's own artefact, so the verification agrees with the run about
    // which step is the problem.
    let evidence = demo_verify_evidence(plan, kind, carrier);
    session.verified = Some(bootstrap_run::verify(plan, &evidence));

    json!({
        "id": session.id,
        "profileId": session.profile_id,
        "startedAt": session.started_at,
        "finishedAt": session.finished_at,
        "steps": session.steps.iter().map(|s| json!({
            "actionId": s.action_id,
            "stage": s.stage.key(),
            "status": step_status_key(s.status),
            "stageLabel": s.stage_label,
            "name": s.name,
            "detail": s.detail,
        })).collect::<Vec<_>>(),
        "succeededCount": session.succeeded_count(),
        "failedSteps": session.failed_steps,
        "remaining": session.remaining,
        "haltedReason": session.halted_reason,
        "resumable": session.is_resumable(),
        "verification": session.verified.as_ref().map(|v| json!({
            "checks": v.checks.iter().map(|c| json!({
                "key": c.key,
                "label": c.label,
                "confidence": c.confidence,
                "expected": c.expected,
                "observed": c.observed,
                "hint": c.hint,
            })).collect::<Vec<_>>(),
            "passed": v.passed,
            "failed": v.failed,
            "unknown": v.unknown,
            "overallOk": v.overall_ok,
            "summary": bootstrap::summarize(v),
        })),
        "stages": plan.stages.iter().map(|s| json!({
            "key": s.key,
            "name": s.name,
            "total": s.total,
            "needed": s.needed,
            "blocked": s.blocked,
        })).collect::<Vec<_>>(),
    })
}

/// A synthetic machine state for the demo sessions' verification.
///
/// The success branch claims everything landed. The failure branches withhold the
/// artefact belonging to the step the session marked failed — **the same step**,
/// named by `carrier`. That correspondence is the whole point: an earlier version
/// withheld "the first extension" while failing an independently-chosen step, so
/// the run reported a failure and the verification reported all-green. The screen
/// then correctly rendered "初始化完成 · 通过 11", and the assertion that a failed
/// branch shows a failure failed — against a fixture that was not actually
/// exercising the failure path.
///
/// Making both sides name the same step is what turns the branch into a real test.
fn demo_verify_evidence(
    plan: &bootstrap_plan::BootstrapPlan,
    kind: BootstrapDemoKind,
    carrier: Option<usize>,
) -> bootstrap_run::VerifyEvidence {
    use bootstrap_plan::BootstrapAction;

    let mut extensions = Vec::new();
    let mut git_config = std::collections::BTreeMap::new();
    let mut paths = std::collections::BTreeMap::new();

    for (index, step) in plan.steps.iter().enumerate() {
        // Everything lands, except the carrier's artefact in a failure branch.
        let landed = !(carrier == Some(index) && !matches!(kind, BootstrapDemoKind::Success));

        match &step.action {
            BootstrapAction::Extension { id, .. } => {
                if landed {
                    extensions.push((id.clone(), None));
                }
            }
            BootstrapAction::ConfigCommand { key, value, .. } => {
                if key != "user.identity.check" && landed {
                    git_config.insert(key.clone(), value.clone());
                }
            }
            BootstrapAction::FileWrite { path, .. } => {
                paths.insert(bootstrap_run::VerifyEvidence::file_key(path), landed);
            }
            BootstrapAction::SkillInstall { name, .. } => {
                paths.insert(bootstrap_run::VerifyEvidence::skill_key(name), landed);
            }
            BootstrapAction::Localization { .. } => {}
        }
    }

    bootstrap_run::VerifyEvidence {
        installed_extensions: extensions,
        git_config,
        existing_paths: paths,
        locale: None,
    }
}

fn step_status_key(status: StepStatus) -> &'static str {
    match status {
        StepStatus::Pending => "pending",
        StepStatus::Running => "running",
        StepStatus::Succeeded => "succeeded",
        StepStatus::SucceededWithWarning => "succeededWithWarning",
        StepStatus::Failed => "failed",
        StepStatus::Skipped => "skipped",
        StepStatus::Cancelled => "cancelled",
    }
}

// ---------------------------------------------------------------------------
// Demo sessions for the UI harness
// ---------------------------------------------------------------------------

/// Which branch of the install screen a demo session exercises.
#[derive(Clone, Copy)]
enum DemoKind {
    /// Everything installed cleanly.
    Success,
    /// One step failed after trying both links in its chain.
    PartialFailure,
    /// The run stopped because the first step needed administrator rights.
    PermissionHalt,
}

/// Builds a session payload shaped exactly like the one the engine returns.
///
/// Deliberately constructed through the real `ExecutionSession` type rather than
/// assembled as JSON, so a change to the model breaks this example at compile
/// time instead of silently producing a fixture the UI no longer matches.
fn demo_session(plan: &InstallPlan, scan: &SoftwareScan, kind: DemoKind) -> Value {
    let mut session = ExecutionSession::new(
        "demo-session".into(),
        plan.profile_id.clone(),
        "2026-01-01T10:00:00.0000000+08:00".into(),
    );

    for (index, step) in plan.steps.iter().enumerate() {
        // Which step carries the failure.
        //
        // Chosen as the first step that is *not* already satisfied, not simply
        // "index 1". On a machine where the first few programs are present, a
        // fixed index lands on a step the engine would legitimately skip, so the
        // demo would show every step green while claiming to be the failure
        // branch — a fixture that tests nothing.
        let first_unsatisfied = plan.steps.iter().position(|s| !s.satisfied);
        let carrier = first_unsatisfied.unwrap_or(0);

        let failed = matches!(kind, DemoKind::PartialFailure) && index == carrier;
        let halted = matches!(kind, DemoKind::PermissionHalt) && index == carrier;
        // Only steps *after* the carrier are left unattempted. A halted run
        // stops at the failure; it does not jump over earlier steps.
        let not_reached = matches!(kind, DemoKind::PermissionHalt)
            && first_unsatisfied.is_some_and(|c| index > c);

        let (status, stage, detail) = if step.satisfied {
            (
                StepStatus::Skipped,
                "已检测到，无需安装".to_string(),
                None,
            )
        } else if not_reached {
            (
                StepStatus::Cancelled,
                "等待继续安装".to_string(),
                None,
            )
        } else if halted {
            (
                StepStatus::Failed,
                "需要管理员权限".to_string(),
                Some(format!(
                    "{} 需要管理员权限。请关闭本程序，右键「以管理员身份运行」后重试。",
                    step.name
                )),
            )
        } else if failed {
            (
                StepStatus::Failed,
                "安装未能完成".to_string(),
                Some(format!("{}：软件源中没有找到对应的包", step.name)),
            )
        } else {
            (
                StepStatus::Succeeded,
                "安装完成".to_string(),
                None,
            )
        };

        session.steps.push(StepProgress {
            step_id: step.id,
            name: step.name.clone(),
            status,
            index: index as u32,
            total: plan.steps.len() as u32,
            stage,
            fraction: Some(1.0),
            detail,
        });

        if not_reached || step.satisfied {
            if not_reached {
                session.remaining.push(step.id);
            }
            continue;
        }

        // The first attempt. A failing step gets a second record so the advanced
        // view shows a real fallback chain rather than a single line.
        session.actions.push(demo_action(step, 0, if failed || halted {
            AttemptOutcome::Failed
        } else {
            AttemptOutcome::Succeeded
        }));

        if failed || halted {
            session.actions.push(demo_action(step, 1, if halted {
                AttemptOutcome::PermissionDenied
            } else {
                AttemptOutcome::Failed
            }));
            session.failed_steps.push(step.id);
            session.remaining.push(step.id);
        }
    }

    session.finished_at = Some("2026-01-01T10:04:30.0000000+08:00".into());
    session.halted_reason = match kind {
        DemoKind::PermissionHalt => Some(
            "安装需要管理员权限。请右键以管理员身份重新运行本程序，然后点击「继续安装」。".into(),
        ),
        _ => None,
    };
    session.verified = Some(scan.inventory.clone());

    serde_json::to_value(&session).unwrap()
}

fn demo_action(step: &InstallStep, attempt: u32, outcome: AttemptOutcome) -> ActionRecord {
    let command = install::describe_source(&step.source);
    ActionRecord {
        id: step.id,
        source: step.source.clone(),
        command: command.clone(),
        started_at: "2026-01-01T10:00:05.0000000+08:00".into(),
        finished_at: "2026-01-01T10:00:41.0000000+08:00".into(),
        duration_ms: 36_000,
        outcome,
        exit_code: Some(if outcome == AttemptOutcome::Succeeded { 0 } else { 1 }),
        output: if outcome == AttemptOutcome::Succeeded {
            "Successfully installed".into()
        } else {
            "No package found matching input criteria.".into()
        },
        error: match outcome {
            AttemptOutcome::Succeeded => None,
            AttemptOutcome::PermissionDenied => Some(format!(
                "{} 需要管理员权限。请关闭本程序，右键「以管理员身份运行」后重试。",
                step.name
            )),
            _ => Some(format!("{}：软件源中没有找到对应的包", step.name)),
        },
        attempt,
        final_attempt: outcome == AttemptOutcome::Succeeded,
    }
}
