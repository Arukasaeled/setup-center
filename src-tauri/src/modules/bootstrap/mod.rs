//! Bootstrap Layer — turning a profile into a *configured* environment.
//!
//! Stage 3 taught the program to install software. This stage teaches it to set
//! the machine up: install the editor extensions, write the configuration files,
//! register the MCP servers, place the skills, apply the localisation.
//!
//! The governing rule
//! ------------------
//! **Everything that changes the machine is an [`plan::BootstrapAction`], and
//! every action runs through [`super::executor`].** Not "most things", not "the
//! things we remembered to route" — all of them. That is why
//! [`plan::BootstrapAction::sources`] returns [`InstallSource`] values rather
//! than doing anything itself: the planner cannot change the machine, only
//! describe how it would be changed. The engine that runs the description is the
//! one stage 3 already built and tested.
//!
//! What that buys, concretely:
//!
//! * one place records the trace ([`ActionRecord`]), so bootstrap steps appear in
//!   the same log format as installs, with the same [`AttemptOutcome`] vocabulary;
//! * one cancellation mechanism ([`executor::CancelFlag`]) covers a five-minute
//!   `winget install` and a 20 ms file copy;
//! * one set of failure semantics — the "permission denied stops the run rather
//!   than doubling the failure" rule from stage 3 applies to a
//!   `code --install-extension` that needs elevation too.
//!
//! No second execution framework, as the brief requires. The one deliberate
//! exception is the file-and-directory work (`ConfigWriter`, the skill copy),
//! which is not process-shaped and cannot be expressed as an [`InstallSource`];
//! it goes through *shared components* rather than new mechanisms, and
//! `bootstrap_tests` asserts both halves of that rule by reading the source.
//!
//! Reuse, not reimplementation
//! ---------------------------
//! The brief's "不要重复造轮子" is answered by a table, because it is the central
//! design decision of this stage:
//!
//! | capability | we call | we do **not** |
//! |---|---|---|
//! | editor extensions | `code --install-extension` (vendor CLI) | implement a VSIX downloader or marketplace client |
//! | MCP servers | the documented `mcpServers` JSON shape | implement the MCP transport or protocol |
//! | skills | copy a directory in the community's own layout | invent a skill manifest format |
//! | localisation | the vendor's language pack, or the upstream community project's own installer | reverse-engineer the program's resource files |
//! | config files | the format's own syntax (JSON/JSONC/TOML) | define a config DSL |
//! | software | `winget` (stage 3) | maintain our own binaries |
//!
//! Every one of those is a case where an authoritative implementation already
//! exists. Our contribution is *knowing where it goes and proving it worked* —
//! which is what [`verify`] is for.
//!
//! Layering
//! --------
//! ```text
//! profile (data)  ──►  plan.rs  ──►  Vec<BootstrapStep>  ──►  run.rs  ──►  Executor
//!                        │                                       │
//!                        └────────── config/ (ConfigWriter) ─────┘
//!                                                                    │
//!                                                        verify.rs ──┘  (reads the machine)
//! ```
//!
//! `plan.rs` never touches the disk; `run.rs` never decides *what* to do, only
//! executes; `verify.rs` never sees the run at all. That split is what lets the
//! whole planning surface be tested without side effects, and what stops
//! verification from quietly re-reading the runner's own bookkeeping instead of
//! the machine.

pub mod config;
pub mod extension;
pub mod git;
pub mod localization;
pub mod mcp;
pub mod plan;
pub mod run;
pub mod skill;
pub mod verify;

#[cfg(test)]
mod bootstrap_tests;

pub use plan::{BootstrapPlan, BootstrapStage, BootstrapStep, StageSummary};
pub use run::{attach_verification, run_bootstrap, BootstrapContext, BootstrapSession};
pub use verify::{summarize, BootstrapCheck, BootstrapVerification, VerifyEvidence};

/// Builds a plan for `profile` against a live inventory.
///
/// Convenience for the command layer. It performs the probes (the editor CLI, the
/// installed extension list, git's config, where skills go) and hands the results
/// to the *pure* planner — which is what keeps `plan.rs` testable without a
/// machine.
pub fn plan_for_machine(
    catalog: &super::catalog::Catalog,
    profile: &crate::model::Profile,
    inventory: &crate::model::SoftwareInventory,
) -> BootstrapPlan {
    plan::build_plan(catalog, profile, &probe_context(inventory))
}

/// Probes this machine and assembles the planner's input.
///
/// Everything here is a *read*. Each probe degrades to the honest "unknown"
/// answer rather than to a negative one — a failed git read becomes
/// [`git::IdentityState::Unknown`], never "not configured" — which is the same
/// discipline the inventory established in stage 2.
pub fn probe_context(inventory: &crate::model::SoftwareInventory) -> plan::PlanContext<'_> {
    let mut ctx = plan::PlanContext::empty(inventory);

    ctx.code_cli = resolve_code_cli();
    ctx.installed_extensions = list_installed_extensions(ctx.code_cli.as_ref());
    ctx.git_config = read_git_config();
    ctx.git_identity = git::identity_from(&ctx.git_config);
    ctx.npx_available = mcp::npx_available();
    ctx.skill_sources = bundled_skill_sources();
    ctx.skills_root = resolve_skills_root();
    ctx.localizations = localization::provider_catalogue();

    ctx
}

/// Where the `code` CLI is, if VS Code's shim resolves.
///
/// Resolved by asking the inventory's PATH walk rather than by shelling out: the
/// same resolution the software screen displays, so the two cannot disagree about
/// whether `code` works.
fn resolve_code_cli() -> Option<std::path::PathBuf> {
    let catalog = super::catalog::Catalog::builtin();
    crate::modules::inventory::resolve_paths(&catalog)
        .get(&crate::model::SoftwareId::Vscode)
        .cloned()
}

/// The installed extension list, or empty when the CLI cannot answer.
///
/// An empty list is the *conservative* answer: it means every requested extension
/// is planned for install. Planning one that turns out to be present is harmless
/// (the CLI reports "already installed", which the extension classifier treats as
/// success); the reverse — assuming present and skipping — would silently leave
/// the student without it.
fn list_installed_extensions(cli: Option<&std::path::PathBuf>) -> Vec<(String, Option<String>)> {
    let Some(cli) = cli else {
        return Vec::new();
    };
    let path = cli.to_string_lossy().to_string();
    match super::detect::run_capture(
        "cmd",
        &["/C", &format!("\"{path}\" --list-extensions --show-versions")],
    ) {
        Ok(text) => extension::parse_installed_list(&text),
        Err(_) => Vec::new(),
    }
}

/// Git's global config, or empty when it cannot be read.
///
/// Empty is safe here because the *identity* answer is derived separately and
/// distinguishes "empty config" from "could not read" via
/// [`git::IdentityState::Unknown`]. For the baseline settings an empty map means
/// "plan them all", which is the harmless direction.
fn read_git_config() -> std::collections::BTreeMap<String, String> {
    match super::detect::run_capture("git", &["config", "--global", "--list"]) {
        Ok(text) => git::parse_global_config(&text),
        Err(_) => std::collections::BTreeMap::new(),
    }
}

/// Skill directories bundled with the app.
///
/// V1 ships no skills, so this is empty and a profile that names one gets a
/// *blocked step with a clear reason* rather than a silent skip — see
/// `plan::plan_skills`. Resolving from the resource directory means adding one is
/// dropping a directory in, with no code change.
fn bundled_skill_sources() -> std::collections::BTreeMap<String, std::path::PathBuf> {
    let mut map = std::collections::BTreeMap::new();
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("skills");
    let Ok(entries) = std::fs::read_dir(&root) else {
        return map;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !path.join("SKILL.md").is_file() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            map.insert(name.to_string(), path);
        }
    }
    map
}

/// Where an agent's skills are installed.
///
/// The community layout: `<agent home>/skills/<name>/SKILL.md`. Resolved from
/// `%USERPROFILE%` so a profile's skills land where an existing agent already
/// looks, rather than in a directory this tool invented.
fn resolve_skills_root() -> Option<std::path::PathBuf> {
    let home = std::env::var("USERPROFILE").ok()?;
    let root = std::path::PathBuf::from(home).join(".claude").join("skills");
    Some(root)
}

#[cfg(test)]
mod mod_tests {
    use super::*;

    #[test]
    fn the_probe_context_is_built_without_panicking_on_any_machine() {
        // Every probe degrades; none of them may panic. This runs on the build
        // machine, which is why it is worth having: a probe that assumed a
        // particular tool is installed would break the app on a fresh student
        // machine in a way no unit test would catch.
        let inventory = crate::model::SoftwareInventory {
            items: Vec::new(),
            scanned_at: String::new(),
            providers: Vec::new(),
        };
        let ctx = probe_context(&inventory);
        assert!(ctx.localizations.len() >= 2, "the localisation catalogue must load");
    }

    #[test]
    fn the_localisation_catalogue_names_a_real_upstream_for_every_entry() {
        // We ask the student to run someone else's script; the report must say
        // whose.
        for provider in localization::provider_catalogue() {
            assert!(
                provider.upstream.starts_with("https://"),
                "{} has no upstream to point at",
                provider.id
            );
        }
    }

    #[test]
    fn a_script_provider_points_at_a_trusted_host() {
        // The check the runner performs, asserted against the shipped catalogue:
        // a catalogue entry that would be blocked at run time is a shipped bug.
        for provider in localization::provider_catalogue() {
            if let localization::LocalizationMethod::Script { url } = &provider.method {
                assert!(
                    localization::validate_script_url(url).is_ok(),
                    "{} would be blocked at run time: {url}",
                    provider.id
                );
            }
        }
    }
}
