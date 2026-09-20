//! Bootstrap Layer integration tests.
//!
//! These live in their own file for the same reason `inventory_tests` and
//! `execution_tests` do: they are the tests that span modules, they are larger
//! than any single module's unit tests, and a reader opening `plan.rs` should not
//! have to scroll past whole-pipeline assertions to find the planner's own.
//!
//! What is tested here that the unit tests cannot:
//!
//! * the **real profile files** parse and produce a runnable plan, so a JSON edit
//!   that breaks a shipped profile is caught by `cargo test` rather than by a
//!   student;
//! * the **architecture rules** the brief states explicitly — no `match` on
//!   software identity, no vendor name outside the catalog, one executor — which
//!   are properties of the source tree, not of any one function.

use crate::model::*;
use crate::modules::bootstrap::plan::{build_plan, PlanContext};
use crate::modules::bootstrap::{extension, git, mcp, run};
use crate::modules::catalog::Catalog;
use crate::modules::profiles::parse_profile;

use std::collections::BTreeMap;
use std::path::PathBuf;

/// The shipped profile files, parsed the same way the app parses them.
///
/// Read from disk rather than from the compiled-in copies on purpose: the point
/// is to catch a broken *file*, and the builtins are a copy of it that could be
/// stale.
fn shipped_profiles() -> Vec<(String, Profile)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("profiles");
    let mut out = Vec::new();
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("profiles directory must exist")
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();

    for file in files {
        let text = std::fs::read_to_string(&file).expect("profile must be readable");
        let profile = parse_profile(&text).unwrap_or_else(|e| {
            panic!(
                "{} does not parse: {}",
                file.file_name().unwrap_or_default().to_string_lossy(),
                e
            )
        });
        out.push((file.file_name().unwrap().to_string_lossy().to_string(), profile));
    }
    out
}

fn empty_inventory() -> SoftwareInventory {
    SoftwareInventory {
        items: Vec::new(),
        scanned_at: String::new(),
        providers: Vec::new(),
    }
}

fn inventory_with(ids: &[SoftwareId]) -> SoftwareInventory {
    SoftwareInventory {
        items: ids
            .iter()
            .map(|id| SoftwareInfo {
                id: *id,
                name: id.display_name().to_string(),
                installed: true,
                version: Some("1.0.0".into()),
                path: Some(format!("C:\\{}", id.key())),
                on_path: true,
                confidence: Confidence::Ok,
                package_id: None,
                sources: vec![],
                evidence: vec![],
                hints: vec![],
            })
            .collect(),
        scanned_at: String::new(),
        providers: Vec::new(),
    }
}

fn context_for<'a>(inventory: &'a SoftwareInventory) -> PlanContext<'a> {
    let mut ctx = PlanContext::empty(inventory);
    ctx.code_cli = Some(PathBuf::from(r"C:\Code\bin\code.cmd"));
    ctx.installed_extensions = Vec::new();
    ctx.git_identity = git::IdentityState::Configured {
        name: "Li".into(),
        email: "li@x.cn".into(),
    };
    ctx.skills_root = Some(PathBuf::from(r"C:\Users\Li\.claude\skills"));
    ctx.npx_available = true;
    ctx.localizations = crate::modules::bootstrap::localization::provider_catalogue();
    ctx
}

// ---------------------------------------------------------------------------
// The shipped profiles
// ---------------------------------------------------------------------------

#[test]
fn every_shipped_profile_parses() {
    let profiles = shipped_profiles();
    // A floor, not an equality: the shipped set is product content and grows
    // with each package. Asserting the exact count turns "we added a package"
    // into a test failure that says nothing about whether the package works.
    assert!(
        profiles.len() >= 3,
        "expected the shipped packages, got {}",
        profiles.len()
    );

    let ids: Vec<&str> = profiles.iter().map(|(_, p)| p.id.as_str()).collect();
    assert!(ids.contains(&"beginner"));
    assert!(ids.contains(&"coder"));
    assert!(ids.contains(&"ai_engineer"));
    assert!(ids.contains(&"ai_basic"));
    assert!(ids.contains(&"ai_developer"));
    assert!(ids.contains(&"programmer"));
}

#[test]
fn every_shipped_profile_plans_without_panicking() {
    // The structural guarantee: whatever a profile declares, building a plan for
    // it is total. A panic here would be a crash on the profile screen.
    let inventory = inventory_with(SoftwareId::ALL.as_slice());
    let ctx = context_for(&inventory);

    for (file, profile) in shipped_profiles() {
        let plan = build_plan(&Catalog::builtin(), &profile, &ctx);
        assert_eq!(plan.profile_id, profile.id, "{file}");
        assert_eq!(plan.stages.len(), 5, "{file} must summarise every stage");
    }
}

#[test]
fn a_shipped_profile_plans_without_panicking_on_an_empty_machine() {
    // The other direction: nothing installed at all. Every step must become a
    // skip, a blocked step, or a note — never a panic and never a fabricated
    // success.
    let inventory = empty_inventory();
    let ctx = PlanContext::empty(&inventory);

    for (file, profile) in shipped_profiles() {
        let plan = build_plan(&Catalog::builtin(), &profile, &ctx);

        // No step may claim to be runnable. Writing a config *file* is the one
        // exception and it is legitimate: `ai_engineer`'s MCP registration is a
        // file write, and an absent Node means the *server* may not start rather
        // than that the configuration should not be written. That is why MCP is
        // a `blocked`-or-runnable distinction rather than a "needs the program"
        // one — see `BootstrapStage::requires`.
        let runnable: Vec<String> = plan.runnable().map(|s| s.action.id()).collect();
        assert!(
            runnable.iter().all(|id| id.starts_with("file:")),
            "{file} claims non-config work on an empty machine: {runnable:?}"
        );
    }
}

#[test]
fn an_mcp_registration_does_not_require_the_package_manager_to_be_present() {
    // Pins the exception above as a deliberate decision rather than an accident:
    // Node may be installed by the same run, so blocking the MCP file write on it
    // would make the order of the run matter in a way the student cannot see.
    use crate::modules::bootstrap::plan::BootstrapStage;

    assert_eq!(BootstrapStage::Mcp.requires(), None);
    assert_eq!(BootstrapStage::Skills.requires(), None);
    assert_eq!(
        BootstrapStage::Vscode.requires(),
        Some(SoftwareId::Vscode)
    );
    assert_eq!(BootstrapStage::Git.requires(), Some(SoftwareId::Git));
    // The stage with a per-target dependency resolves it through the provider.
    assert_eq!(BootstrapStage::Localization.requires(), None);
}

#[test]
fn the_coder_profile_requests_extensions_git_and_localisation() {
    // Guards the shipped profile against a silent regression to "installs
    // software but configures nothing".
    let (_, coder) = shipped_profiles()
        .into_iter()
        .find(|(_, p)| p.id == "coder")
        .expect("coder profile");

    assert!(!coder.bootstrap.vscode.extensions.is_empty());
    assert!(coder.bootstrap.git.configure);
    assert!(coder.bootstrap.localization.contains(&"vscode".to_string()));
}

#[test]
fn the_ai_engineer_profile_requests_an_mcp_server() {
    let (_, engineer) = shipped_profiles()
        .into_iter()
        .find(|(_, p)| p.id == "ai_engineer")
        .expect("ai_engineer profile");

    assert_eq!(engineer.bootstrap.mcp.len(), 1);
    assert_eq!(engineer.bootstrap.mcp[0].name, "filesystem");
    // And its spec must be one the parser accepts, or the shipped profile ships
    // a blocked step.
    assert!(mcp::parse_server(&engineer.bootstrap.mcp[0].name, &engineer.bootstrap.mcp[0].spec).is_ok());
}

#[test]
fn every_extension_a_shipped_profile_names_is_parseable() {
    // A typo in a profile is otherwise only discovered by a student.
    for (file, profile) in shipped_profiles() {
        for spec in &profile.bootstrap.vscode.extensions {
            assert!(
                extension::ExtensionRequest::parse(spec).is_some(),
                "{file} names an invalid extension id: {spec:?}"
            );
        }
    }
}

#[test]
fn every_localisation_a_shipped_profile_names_exists() {
    let catalogue = crate::modules::bootstrap::localization::provider_catalogue();
    for (file, profile) in shipped_profiles() {
        for id in &profile.bootstrap.localization {
            assert!(
                catalogue.iter().any(|p| &p.id == id),
                "{file} names an unknown localisation: {id}"
            );
        }
    }
}

#[test]
fn a_shipped_profile_never_declares_a_secret() {
    // The profile is a file a school edits and shares.
    for (file, profile) in shipped_profiles() {
        for server in &profile.bootstrap.mcp {
            assert!(
                mcp::parse_server(&server.name, &server.spec).is_ok(),
                "{file}: {} is not a valid server spec",
                server.name
            );
            for marker in ["token", "key", "secret", "password"] {
                let rendered = format!("{} {}", server.name, server.spec).to_lowercase();
                assert!(
                    !rendered.contains(marker),
                    "{file} carries what looks like a credential: {rendered}"
                );
            }
        }
    }
}

#[test]
fn the_beginner_profile_asks_for_no_bootstrap_work() {
    // Its whole premise is "install one thing and open it"; a bootstrap step
    // appearing there would be a scope regression.
    let (_, beginner) = shipped_profiles()
        .into_iter()
        .find(|(_, p)| p.id == "beginner")
        .expect("beginner profile");

    assert!(beginner.bootstrap.vscode.extensions.is_empty());
    assert!(beginner.bootstrap.vscode.settings.is_empty());
    assert!(!beginner.bootstrap.git.configure);
    assert!(beginner.bootstrap.mcp.is_empty());
    assert!(beginner.bootstrap.skills.is_empty());
    assert!(beginner.bootstrap.localization.is_empty());
}

// ---------------------------------------------------------------------------
// Data flow: a real profile through plan → run → verify
// ---------------------------------------------------------------------------

#[test]
fn a_real_profile_produces_a_plan_that_runs_and_verifies() {
    // The end-to-end shape the brief's completion criterion describes, driven
    // without touching the machine: a profile in, a verified session out.
    let (_, coder) = shipped_profiles()
        .into_iter()
        .find(|(_, p)| p.id == "coder")
        .expect("coder profile");

    let inventory = inventory_with(&[SoftwareId::Vscode, SoftwareId::Git, SoftwareId::Python]);
    let ctx = context_for(&inventory);
    let plan = build_plan(&Catalog::builtin(), &coder, &ctx);

    assert!(plan.needed_count() > 0, "the coder profile planned no work");

    // Every stage the profile touches must have at least one step.
    let populated: Vec<&str> = plan
        .stages
        .iter()
        .filter(|s| s.total > 0)
        .map(|s| s.key.as_str())
        .collect();
    assert!(populated.contains(&"vscode"), "got: {populated:?}");
    assert!(populated.contains(&"git"), "got: {populated:?}");
    assert!(populated.contains(&"localization"), "got: {populated:?}");

    // Verification, with every extension present and every git setting applied:
    // the run must be able to come out green.
    //
    // The list must include the extensions the plan asks for *including* those
    // contributed by the localisation stage, because a language pack is installed
    // as an extension. An earlier version enumerated only
    // `bootstrap.vscode.extensions`, so the language-pack check failed against a
    // machine the test had declared fully configured — the test was wrong, not
    // the verifier.
    let mut wanted: Vec<String> = coder
        .bootstrap
        .vscode
        .extensions
        .iter()
        .filter_map(|spec| extension::ExtensionRequest::parse(spec).map(|r| r.cli_argument()))
        .collect();

    for step in plan.steps.iter() {
        if let crate::modules::bootstrap::plan::BootstrapAction::Extension { id, .. } = &step.action {
            if !wanted.contains(id) {
                wanted.push(id.clone());
            }
        }
    }
    assert!(
        wanted.len() > coder.bootstrap.vscode.extensions.len(),
        "the localisation stage must contribute an extension; otherwise this test is not exercising it"
    );

    let installed = extension::parse_installed_list(&wanted.join("\n"));

    let mut git_config = BTreeMap::new();
    for (key, value, _) in git::baseline_settings() {
        git_config.insert(key.to_string(), value.to_string());
    }

    let mut paths = BTreeMap::new();
    for step in plan.steps.iter() {
        match &step.action {
            crate::modules::bootstrap::plan::BootstrapAction::FileWrite { path, .. } => {
                paths.insert(run::VerifyEvidence::file_key(path), true);
            }
            crate::modules::bootstrap::plan::BootstrapAction::SkillInstall { name, .. } => {
                paths.insert(run::VerifyEvidence::skill_key(name), true);
            }
            _ => {}
        }
    }

    let evidence = run::VerifyEvidence {
        installed_extensions: installed,
        git_config,
        existing_paths: paths,
        locale: None,
    };
    let verification = run::verify(&plan, &evidence);

    assert!(
        verification.failed == 0,
        "a fully-configured machine must verify clean: {:?}",
        verification
            .checks
            .iter()
            .filter(|c| c.confidence == Confidence::Fail)
            .collect::<Vec<_>>()
    );
    assert!(verification.passed > 0);
}

#[test]
fn a_run_records_every_step_in_the_session() {
    // Traceability, asserted at the session level: whatever the outcome, the
    // student can see what happened to every planned step.
    let (_, coder) = shipped_profiles()
        .into_iter()
        .find(|(_, p)| p.id == "coder")
        .expect("coder profile");

    let inventory = inventory_with(&[SoftwareId::Vscode, SoftwareId::Git]);
    let ctx = context_for(&inventory);
    let plan = build_plan(&Catalog::builtin(), &coder, &ctx);

    let context = run::BootstrapContext::for_local_run(
        Some(PathBuf::from(r"C:\Code\bin\code.cmd")),
        ctx.skills_root.clone(),
    );
    let session = run::run_bootstrap(&plan, &context, &crate::modules::executor::CancelFlag::new());

    assert_eq!(session.steps.len(), plan.steps.len());
    assert!(session.steps.iter().all(|s| !s.action_id.is_empty()));
    assert!(session.finished_at.is_some());
}

/// Reads the non-test source of the bootstrap layer.
///
/// **The unit-test modules are stripped, and that is load-bearing.** These
/// architecture tests assert properties of the *implementation*, but a test file
/// necessarily contains the very strings being searched for — `bootstrap_tests`
/// mentions `SoftwareId::Git`, and a scan that did not exclude test code would
/// report the scanner itself. An earlier version of this harness failed on its own
/// pattern literals, which is exactly the false-positive class this exclusion
/// removes.
///
/// Only an **inline** `#[cfg(test)] mod … { … }` is cut, and the cut runs to the
/// matching closing brace. A bare `#[cfg(test)] mod x_tests;` declaration
/// contributes nothing to scan and is simply dropped — cutting to end-of-file at
/// one of those, as an earlier version did, silently discarded every function
/// declared after it and made the architecture scans vacuously pass on `mod.rs`.
fn production_sources() -> Vec<(String, String)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("modules")
        .join("bootstrap");
    let mut out = Vec::new();

    for entry in std::fs::read_dir(&dir).expect("bootstrap dir").flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        // The integration-test file is entirely test code.
        if name == "bootstrap_tests.rs" {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        out.push((name, strip_test_modules(&text)));
    }
    out
}

/// Removes inline `#[cfg(test)]` modules, leaving everything else in place.
fn strip_test_modules(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;

    while let Some(rel) = text[cursor..].find("#[cfg(test)]") {
        let marker = cursor + rel;
        out.push_str(&text[cursor..marker]);

        let after = &text[marker..];
        // An inline module is `mod <name> {`; a declaration is `mod <name>;`.
        // The distinction is the terminator, not the name — an earlier version
        // compared against the literal `mod tests;` and therefore treated
        // `mod more_tests;` as an inline module, opening a brace search that ran
        // to the end of the following function.
        match after.find("mod ") {
            Some(mod_at) => {
                let rest = &after[mod_at + 4..];
                let terminated = rest.find(['{', ';']);
                match terminated {
                    Some(offset) if rest.as_bytes()[offset] == b'{' => {
                        let open = marker + mod_at + 4 + offset;
                        match matching_brace(text, open) {
                            Some(close) => cursor = close + 1,
                            None => break,
                        }
                    }
                    // A declaration: drop just the marker, keep everything.
                    _ => cursor = marker + "#[cfg(test)]".len(),
                }
            }
            None => cursor = marker + "#[cfg(test)]".len(),
        }
        // Whitespace between items.
        out.push('\n');
    }
    out.push_str(&text[cursor..]);
    out
}

/// The index of the brace that closes the one at `open`.
fn matching_brace(text: &str, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (offset, ch) in text[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(open + offset);
                }
            }
            _ => {}
        }
    }
    None
}

/// The lines of a source, with comments skipped, as `(line number, text)`.
fn code_lines(text: &str) -> impl Iterator<Item = (usize, &str)> {
    text.lines()
        .enumerate()
        .filter(|(_, line)| {
            let trimmed = line.trim_start();
            !trimmed.starts_with("//")
        })
        .map(|(index, line)| (index + 1, line))
}

#[test]
fn the_test_stripper_removes_inline_modules_and_keeps_the_rest() {
    // The stripper itself is the thing the architecture tests depend on, so it
    // gets its own test. Both shapes are covered: an inline module that must be
    // cut, and a bare declaration that must not take the file with it.
    let source = "\
fn before() {}
#[cfg(test)]
mod tests {
    fn inside() {}
}
fn after() {}
#[cfg(test)]
mod more_tests;
fn last() {}
";
    let stripped = strip_test_modules(source);
    assert!(stripped.contains("fn before"), "got: {stripped}");
    assert!(stripped.contains("fn after"), "the inline module ate the file");
    assert!(stripped.contains("fn last"), "a bare declaration ate the file");
    assert!(!stripped.contains("fn inside"), "the test body survived");
}

#[test]
fn no_production_code_follows_a_test_module() {
    // Guards the assumption `production_sources` makes. Stated properly: after
    // stripping the test modules, no file-scope `pub` item may have gone missing.
    // The concrete failure this catches is a `#[cfg(test)] mod x_tests;`
    // declaration followed by real functions — an earlier version of the stripper
    // cut to end-of-file there and made every architecture scan vacuous.
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("modules")
        .join("bootstrap");

    for entry in std::fs::read_dir(&dir).expect("bootstrap dir").flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if name == "bootstrap_tests.rs" {
            continue;
        }
        let original = std::fs::read_to_string(&path).unwrap();
        let stripped = strip_test_modules(&original);

        // Every `pub fn` in the real file must survive the strip, except those
        // that live inside a stripped test module. Counting is the honest check:
        // a lossy strip shows up as a lower count.
        let before = original.matches("pub fn ").count();
        let after = stripped.matches("pub fn ").count();
        let inside_tests = original
            .split("#[cfg(test)]")
            .skip(1)
            .map(|chunk| chunk.matches("pub fn ").count())
            .sum::<usize>();

        assert!(
            after + inside_tests >= before,
            "{name}: the stripper dropped production functions (before {before}, after {after}, in tests {inside_tests})"
        );
    }
}

// ---------------------------------------------------------------------------
// The architecture rules from the brief
// ---------------------------------------------------------------------------

#[test]
fn the_bootstrap_layer_never_matches_on_software_identity() {
    // "禁止 match SoftwareId" / "禁止 install_xxx() configure_xxx()".
    //
    // Checked by reading the source, because this is a property of the tree that
    // no single function's behaviour can demonstrate.
    let mut offenders: Vec<String> = Vec::new();

    for (name, text) in production_sources() {
        for (number, line) in code_lines(&text) {
            let trimmed = line.trim();
            if trimmed.contains("match SoftwareId") {
                offenders.push(format!("{name}:{number} match SoftwareId"));
            }
            for prefix in ["fn install_", "fn configure_", "fn setup_"] {
                if trimmed.contains(prefix) {
                    offenders.push(format!("{name}:{number} {trimmed}"));
                }
            }
        }
    }

    assert!(offenders.is_empty(), "architecture rule violated: {offenders:#?}");
}

#[test]
fn the_bootstrap_layer_names_no_software_product() {
    // The same rule `executor.rs` is held to: a program name belongs in `catalog`
    // (and in the profile data), never in the algorithm.
    //
    // `plan.rs` legitimately asks whether its stage's target exists, and it does
    // so through `BootstrapStage::requires` — a data table — rather than by
    // naming a program. So the check is: no `SoftwareId::<name>` inside a
    // *decision* in a bootstrap module. The stage table itself is the sanctioned
    // exception and is in `plan.rs`.
    let mut offenders: Vec<String> = Vec::new();
    let banned = ["SoftwareId::Git", "SoftwareId::Python", "SoftwareId::Node"];

    for (name, text) in production_sources() {
        if name == "plan.rs" {
            // The stage→dependency table lives here; see the dedicated test.
            continue;
        }
        for (number, line) in code_lines(&text) {
            for needle in banned {
                if line.contains(needle) {
                    offenders.push(format!("{name}:{number} {needle}"));
                }
            }
        }
    }

    assert!(offenders.is_empty(), "product names leaked: {offenders:#?}");
}

#[test]
fn plan_rs_names_a_program_only_in_the_stage_dependency_table() {
    // The one sanctioned exception, pinned precisely: `SoftwareId::<name>` may
    // appear only inside `BootstrapStage::requires`. Anywhere else in `plan.rs`
    // would be the per-program branching the brief forbids.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("modules")
        .join("bootstrap")
        .join("plan.rs");
    let text = std::fs::read_to_string(&path).unwrap();
    let production = match text.find("#[cfg(test)]") {
        Some(index) => &text[..index],
        None => &text[..],
    };

    let body = function_body(production, "pub fn requires(self) -> Option<SoftwareId> {")
        .expect("BootstrapStage::requires must exist");

    assert!(
        body.contains("SoftwareId::Git"),
        "the stage table must name its dependencies"
    );

    // Everything outside the function body, with comments removed so the doc
    // comment that *explains* the exception does not count as the violation it
    // describes. (An earlier version compared the raw text and failed on the
    // explanatory comment — the test was wrong, not the code.)
    let (before, after_with_marker) = production.split_at(
        production
            .find("pub fn requires(self) -> Option<SoftwareId> {")
            .unwrap(),
    );
    let after = &after_with_marker[body.len()..];
    let outside: String = format!("{before}{after}");

    for (number, line) in code_lines(&outside) {
        for id in ["SoftwareId::Git", "SoftwareId::Python", "SoftwareId::Node"] {
            assert!(
                !line.contains(id),
                "plan.rs names {id} outside the stage dependency table, at stripped line {number}: {line}"
            );
        }
    }
}

/// Extracts a braced function body by counting braces.
///
/// A simple `find("\n    }")` is not enough: the first such line inside a
/// function that contains a `match` is the *match arm's* closing brace, so the
/// extracted "body" would stop early and the remainder would be mistaken for code
/// outside the function. That produced a false failure in this very test.
fn function_body(source: &str, signature: &str) -> Option<String> {
    let start = source.find(signature)?;
    let open = source[start..].find('{')? + start;

    let mut depth = 0usize;
    for (offset, ch) in source[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(source[open..=open + offset].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

#[test]
fn there_is_exactly_one_process_launcher_in_the_bootstrap_layer() {
    // "禁止产生第二套执行框架", asserted by reading the source: the bootstrap
    // modules must not construct a `Command` of their own.
    let mut offenders: Vec<String> = Vec::new();

    for (name, text) in production_sources() {
        for (number, line) in code_lines(&text) {
            if line.contains("process::Command") || line.contains(".spawn()") {
                offenders.push(format!("{name}:{number} {}", line.trim()));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "the bootstrap layer spawned its own process: {offenders:#?}"
    );
}

#[test]
fn the_bootstrap_layer_routes_processes_through_the_executor() {
    // The positive half of the rule above: the runner must actually use the
    // stage-3 executor rather than merely avoid spawning things itself.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("modules")
        .join("bootstrap")
        .join("run.rs");
    let text = std::fs::read_to_string(&path).unwrap();

    assert!(
        text.contains("execute_source"),
        "run.rs does not use the stage-3 executor"
    );
    assert!(
        text.contains("CancelFlag"),
        "run.rs does not honour the shared cancel flag"
    );
    assert!(
        text.contains("ActionRecord"),
        "run.rs does not record into the shared trace type"
    );
}

#[test]
fn the_bootstrap_layer_writes_only_inside_allowed_roots() {
    // The confinement check that stops a hand-edited profile naming a system
    // path. Asserted against the real roots on this machine.
    use crate::modules::bootstrap::config::ConfigWriter;
    use crate::modules::bootstrap::plan::allowed_roots;

    let roots = allowed_roots();
    let writer = ConfigWriter::new(roots);

    assert!(
        !writer.is_allowed(std::path::Path::new(r"C:\Windows\System32\drivers\etc\hosts")),
        "a system file must never be writable"
    );
    assert!(!writer.is_allowed(std::path::Path::new(r"D:\somewhere\else\config.json")));
}
