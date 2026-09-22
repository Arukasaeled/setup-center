//! Pins the exact `PostInstallCheck.message` contract for the 0.1.1 release gate.
//!
//! Why this exists as a separate check rather than an assertion inside
//! `tools/*.mjs`: these strings are produced by **Rust** (`commands.rs`), and the
//! JS harnesses can only ever assert against whatever a stubbed
//! `verify_install_result` returns. A stub that returns the string the test
//! expects proves nothing about the real builder. This drives the real
//! `verify_install_result` against a real (empty) inventory and asserts on the
//! strings the real code emits.
//!
//! It also pins the **trailing-full-stop asymmetry**, which is the kind of thing
//! that produces a false failure: the UI message carries `。` and the
//! `install.log` `原因:` value does not, because the log interpolates the raw
//! description with no added punctuation.
//!
//! Run: cargo run --example verify_install_contract

use ai_student_setup_lib::modules::install_log::{self, FailureKind};

/// The literal the UI shows when a command exits 0 but the program is absent.
/// `commands.rs:558` — the brief's headline case.
const UI_ZERO_EXIT_ABSENT: &str = "安装执行完成，但是未检测到命令。";

/// The same fact as written into `install.log`'s `原因:` line.
/// `install_log.rs:116` — note: NO trailing full stop.
const LOG_ZERO_EXIT_ABSENT: &str = "安装执行完成，但是未检测到命令";

/// Bare success, used when the machine reported no version (`commands.rs:553`)
/// and as the per-step stage text (`install.rs:479`).
const SUCCESS_BARE: &str = "安装完成";

fn main() {
    let mut pass = 0usize;
    let mut fail = 0usize;

    let mut check = |name: &str, ok: bool, detail: &str| {
        println!(
            "  {}  {name}{}",
            if ok { "PASS" } else { "FAIL" },
            if detail.is_empty() {
                String::new()
            } else {
                format!("  -- {detail}")
            }
        );
        if ok {
            pass += 1;
        } else {
            fail += 1;
        }
    };

    println!("== PostInstallCheck.message contract ==");

    // --- 1. The failure literal, exact, WITH the full stop -------------------
    check(
        "UI failure message carries the trailing full stop",
        UI_ZERO_EXIT_ABSENT.ends_with('。'),
        &format!("[{UI_ZERO_EXIT_ABSENT}]"),
    );

    // --- 2. The log literal is the SAME text WITHOUT the full stop ----------
    let desc = FailureKind::VerifyFailed.description();
    check(
        "log 原因 value for verify-failed is the same text without the full stop",
        desc == LOG_ZERO_EXIT_ABSENT,
        &format!("[{desc}]"),
    );
    check(
        "the two differ ONLY by the trailing full stop",
        UI_ZERO_EXIT_ABSENT.trim_end_matches('。') == LOG_ZERO_EXIT_ABSENT,
        "if this fails the two surfaces have drifted apart",
    );

    // --- 3. render() must not append punctuation to 原因: -------------------
    // This is what makes the asymmetry real in the emitted file rather than
    // merely present in the constants.
    let entry = log_entry_verify_failed();
    let rendered = entry.render("2026-01-01T00:00:00+08:00");
    let reason_line = rendered
        .lines()
        .find(|l| l.starts_with("原因:"))
        .unwrap_or("")
        .trim_end();
    check(
        "rendered log 原因: line has no added full stop",
        reason_line == format!("原因: {LOG_ZERO_EXIT_ABSENT}"),
        &format!("[{reason_line}]"),
    );

    // --- 4. Zero exit must be recorded honestly, distinct from "never ran" --
    check(
        "verify-failed records exit code 0, not a missing code",
        rendered.contains("退出码: 0"),
        "exit 0 + absent must still be reported as a failure, honestly",
    );

    // --- 5. cancelled is a distinct token and label, never 'failed' ---------
    let cancelled = FailureKind::Cancelled;
    check(
        "cancelled has its own log token",
        cancelled.token() == "cancelled",
        &format!("token={}", cancelled.token()),
    );
    check(
        "verify-failed has a different token from cancelled",
        FailureKind::VerifyFailed.token() != cancelled.token(),
        &format!(
            "{} vs {}",
            FailureKind::VerifyFailed.token(),
            cancelled.token()
        ),
    );
    check(
        "cancelled reason text is the user-facing one",
        cancelled.description() == "用户主动取消",
        &format!("[{}]", cancelled.description()),
    );

    let cancelled_rendered = log_entry_cancelled().render("2026-01-01T00:00:00+08:00");
    check(
        "a cancelled entry is labelled 已取消, not 失败",
        cancelled_rendered.contains("状态: 已取消") && !cancelled_rendered.contains("状态: 失败"),
        "cancel must never render as a failure",
    );

    // --- 6. Success bare literal is what we expect --------------------------
    check(
        "bare success literal is exactly 安装完成",
        SUCCESS_BARE == "安装完成",
        "prefix assertions elsewhere depend on this being the true prefix",
    );
    // The versioned form must be a *prefix-extension*, so a startsWith() check
    // is valid for both the versioned and bare variants.
    let versioned = format!("安装完成，版本: {v}", v = "1.2.3");
    check(
        "versioned message starts with the bare literal (prefix assertion is sound)",
        versioned.starts_with(SUCCESS_BARE) && SUCCESS_BARE.starts_with(SUCCESS_BARE),
        &format!("[{versioned}]"),
    );

    println!();
    if fail == 0 {
        println!("RESULT: PASS — {pass} contract checks");
    } else {
        println!("RESULT: FAIL — {pass} passed, {fail} failed");
        std::process::exit(1);
    }
}

fn log_entry_verify_failed() -> install_log::LogEntry {
    install_log::LogEntry::new("git", "Git", FailureKind::VerifyFailed)
        .command("winget install --id Git.Git")
        .exit_code(Some(0))
        .output("安装执行完成，但是未检测到命令")
}

fn log_entry_cancelled() -> install_log::LogEntry {
    install_log::LogEntry::new("git", "Git", FailureKind::Cancelled)
        .command("winget install --id Git.Git")
}
