// End-to-end smoke test for the Execution Engine.
//
// What this proves that `cargo test` cannot: the executor actually spawns a
// real process, captures its real output, and classifies the real exit code —
// on *this* machine, with *this* winget build.
//
// It deliberately installs nothing. The package id is one that cannot exist, so
// the run exercises the whole path (spawn → capture → classify → record) and is
// required to fail. A test that installed real software would be an unacceptable
// side effect on a student's machine.
//
// Run with:
//   cargo run --example execute_smoke

use ai_student_setup_lib::model::*;
use ai_student_setup_lib::modules::catalog::Catalog;
use ai_student_setup_lib::modules::{executor, install};

fn main() {
    let cat = Catalog::builtin();

    println!("=== Execution Engine smoke test ===\n");

    // 1. Is winget usable here? Reported, not required: the engine has a
    //    fallback for each program that needs it.
    match executor::winget_version() {
        Ok(v) => println!("winget        : {v}"),
        Err(e) => println!("winget        : UNAVAILABLE ({e})"),
    }
    println!();

    // 2. Run the real winget executor against an impossible package. The engine
    //    must reject it cleanly rather than hang or panic, and the record must
    //    carry enough to diagnose the failure.
    let source = InstallSource::Winget {
        package_id: "AIStudentSetup.SmokeTest.NoSuchPackage".into(),
    };
    println!("attempting    : {}", install::describe_source(&source));

    let cancel = executor::CancelFlag::new();
    let record = executor::execute_source(SoftwareId::Git, &source, 0, &cancel);

    println!("outcome       : {:?}", record.outcome);
    println!("exit code     : {:?}", record.exit_code);
    println!("duration      : {} ms", record.duration_ms);
    println!("retryable     : {}", record.outcome.is_retryable());
    println!(
        "error         : {}",
        record.error.as_deref().unwrap_or("(none)")
    );
    let output = record.output.trim();
    if !output.is_empty() {
        println!("output (head) : {}", output.lines().next().unwrap_or(""));
    }

    // 3. Assert the contract the rest of the program depends on.
    let ok = match record.outcome {
        // winget present: it must reject the id, and must be retryable so the
        // fallback chain advances to the vendor installer.
        AttemptOutcome::Failed => {
            assert!(record.exit_code.is_some(), "a failure must record an exit code");
            assert!(record.error.is_some(), "a failure must record a reason");
            record.outcome.is_retryable()
        }
        // winget absent: also correct, and also retryable.
        AttemptOutcome::Unavailable => record.outcome.is_retryable(),
        other => {
            eprintln!("\nUNEXPECTED OUTCOME: {other:?} — an impossible package must not succeed");
            false
        }
    };

    // 4. Print the full trace, which is what "可追踪" means in practice.
    println!("\n--- action record ---");
    println!("id            : {:?}", record.id);
    println!("command       : {}", record.command);
    println!("started       : {}", record.started_at);
    println!("finished      : {}", record.finished_at);
    println!("attempt       : {}", record.attempt);

    // 5. Confirm every program in the catalog has a runnable chain, so nothing
    //    in the catalogue can be planned but not installed.
    println!("\n--- catalog coverage ---");
    for id in SoftwareId::ALL {
        let spec = install::spec_from(&cat, id);
        let sources: Vec<String> = spec
            .chain
            .iter()
            .map(|f| install::describe_source(&f.source))
            .collect();
        println!("  {:<16} {} 种方式", id.display_name(), sources.len());
        for s in &sources {
            println!("      · {s}");
        }
    }

    // 6. Readiness, exactly as the UI sees it before a run.
    let profile = Profile {
        id: "smoke".into(),
        name: "Smoke".into(),
        tagline: String::new(),
        audience: String::new(),
        rationale: String::new(),
        software: vec![SoftwareId::Git, SoftwareId::Python, SoftwareId::Node, SoftwareId::Vscode],
        configure: vec![],
        estimated_minutes: 10,
        estimated_download_mb: 1024,
        requires_admin: false,
        future: ProfileFuture::default(),
        // No bootstrap declarations: this example exercises the *installation*
        // engine, and a bootstrap section here would plan steps it never runs.
        bootstrap: ProfileBootstrap::default(),
        // Likewise no declared capabilities: the set is derived from `software`
        // and this example never asks about it.
        capabilities: vec![],
    };
    let scan = SoftwareScan {
        inventory: SoftwareInventory {
            items: vec![],
            scanned_at: String::new(),
            providers: vec![],
        },
        scanned_at: String::new(),
    };
    let plan = install::build_plan(&cat, &profile, &scan);
    let ready = install::readiness(&plan, &cat, false);
    println!("\n--- readiness (as the UI sees it) ---");
    println!("can start     : {}", ready.can_start);
    println!("elevated      : {}", ready.is_elevated);
    println!("blockers      : {:?}", ready.blockers);

    if ok {
        println!("\n=== PASS: the executor ran, classified and recorded correctly ===");
    } else {
        eprintln!("\n=== FAIL ===");
        std::process::exit(1);
    }
}
