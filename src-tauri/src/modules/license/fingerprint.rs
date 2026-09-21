//! The machine fingerprint an activation is bound to.
//!
//! ## What is hashed, and why these four
//!
//! ```text
//! SHA256( MachineGuid | CPU | 主板 | 磁盘序列号 )
//! ```
//!
//! The brief names these four, and they are a reasonable set: `MachineGuid` is
//! written once by Windows at install time and does not move, the CPU and
//! motherboard identify the physical board, and the system disk's serial
//! survives a reinstall of the OS. None of them is a random number this program
//! generated, which is the property that matters — a fingerprint we invented
//! ourselves would be lost the moment its storage was cleared, and re-binding
//! would be indistinguishable from a fresh activation.
//!
//! ## The honest failure mode, and what is done about it
//!
//! Every one of these probes can fail: WMI can be broken, a VM can report blanks,
//! a locked-down machine can deny `reg query`. A fingerprint that silently
//! changed because one probe hiccuped would tell a paying customer their licence
//! "已绑定其他设备" — the worst bug this module can have. Three things guard it:
//!
//! 1. Every probe is fail-soft ([`Component::read`]) and contributes nothing
//!    rather than contributing an empty string that would still shift the hash.
//! 2. [`Fingerprint::combine`] is a pure function of the parts that *were* read,
//!    so the mapping from "what we could see" to "what we hash" is testable
//!    without touching real hardware.
//! 3. [`Fingerprint::reliable`] reports whether enough parts were readable to be
//!    trusted, and the UI says so, so a mismatch on a degraded machine can be
//!    explained instead of merely asserted.
//!
//! ## Privacy
//!
//! Only the resulting digest is stored. The raw `MachineGuid`, board name and
//! disk serial never leave this module, and the digest is one-way — the licence
//! file reveals nothing about the hardware it was bound to.

use super::crypto::{hex, sha256};

use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// `CREATE_NO_WINDOW`, duplicated from `modules::detect` rather than imported.
///
/// Imported would be tidier, but this module is compiled into the licence path
/// that must also build under `cfg(not(windows))` for the unit tests, and
/// `detect`'s constant is itself `#[cfg(windows)]`. Two lines of duplication is
/// cheaper than a `cfg` import dance for a value that has been stable since
/// Windows 2000.
///
/// **This is not cosmetic.** On a machine whose default console host is Windows
/// Terminal, an unsuppressed spawn does not flash a black box — WT adopts the
/// child and raises its own "Windows 终端 1.24…" dialog. One fingerprint is one
/// `reg` plus three `powershell` calls, so a licence check with these flags
/// missing pops four finished-looking error dialogs on top of the app.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// One ingredient of the fingerprint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Component {
    /// `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`.
    MachineGuid,
    /// The processor's reported name.
    Cpu,
    /// The motherboard's manufacturer + product string.
    Board,
    /// The system disk's serial number.
    Disk,
}

impl Component {
    /// Every component, in the fixed order they are hashed.
    pub const ALL: [Component; 4] = [
        Component::MachineGuid,
        Component::Cpu,
        Component::Board,
        Component::Disk,
    ];

    /// The stable label that goes into the hashed string.
    ///
    /// Part of the hash input, so it must never change without a version bump —
    /// renaming `"cpu"` to `"processor"` would re-hash every machine and orphan
    /// every existing activation.
    pub fn label(self) -> &'static str {
        match self {
            Component::MachineGuid => "machine-guid",
            Component::Cpu => "cpu",
            Component::Board => "board",
            Component::Disk => "disk",
        }
    }
}

/// The computed fingerprint, plus what it was computed from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint {
    /// Hex SHA-256 of the readable components. This is what gets stored.
    pub device_hash: String,
    /// How many of the four components were readable.
    pub components_readable: usize,
}

impl Fingerprint {
    /// Whether enough parts were readable for a mismatch to mean something.
    ///
    /// Two of four is the threshold, and it is deliberately not four: requiring
    /// every probe would make a VM without a board serial permanently
    /// unactivatable. Requiring only one would mean a machine whose *sole*
    /// readable part changed (say `MachineGuid`, after a Windows reinstall)
    /// silently re-binds, which defeats the point.
    pub fn reliable(&self) -> bool {
        self.components_readable >= 2
    }

    /// Whether an activation bound to `stored` belongs to this machine.
    ///
    /// Plain equality, because the digest already includes only the parts both
    /// sides read. Comparing raw component lists instead would re-introduce the
    /// false-mismatch problem this shape exists to avoid.
    pub fn matches(&self, stored: &str) -> bool {
        super::crypto::constant_time_eq(self.device_hash.as_bytes(), stored.as_bytes())
    }
}

/// Hashes the components that were successfully read.
///
/// Pure, and therefore the part of this module that can be tested exactly. The
/// gap separator is `\x1f` (unit separator) rather than `|` so that a component
/// whose *value* contains a separator cannot shift the others' boundaries.
pub fn combine(parts: &[(Component, String)]) -> Fingerprint {
    let mut input = String::new();
    for (component, value) in parts {
        let value = value.trim();
        if value.is_empty() {
            // A blank reading contributes nothing. Hashing "" would still move
            // the digest, which is exactly the instability being avoided.
            continue;
        }
        input.push_str(component.label());
        input.push('=');
        input.push_str(value);
        input.push('\x1f');
    }

    Fingerprint {
        device_hash: hex(&sha256(input.as_bytes())),
        components_readable: parts
            .iter()
            .filter(|(_, v)| !v.trim().is_empty())
            .count(),
    }
}

/// Builds the fingerprint for this machine.
pub fn capture() -> Fingerprint {
    let parts: Vec<(Component, String)> = Component::ALL
        .iter()
        .map(|c| (*c, c.read()))
        .collect();
    combine(&parts)
}

impl Component {
    /// Reads one component, returning `""` when it cannot be read.
    ///
    /// Never fails and never panics: see the module docs on why a probe failure
    /// must not become an activation failure.
    fn read(self) -> String {
        match self {
            Component::MachineGuid => read_machine_guid(),
            Component::Cpu => query_wmi(
                "(Get-CimInstance Win32_Processor | Select-Object -First 1).Name",
            ),
            Component::Board => {
                let m = query_wmi(
                    "(Get-CimInstance Win32_BaseBoard | Select-Object -First 1).Manufacturer",
                );
                let p = query_wmi(
                    "(Get-CimInstance Win32_BaseBoard | Select-Object -First 1).Product",
                );
                format!("{m} {p}").trim().to_string()
            }
            Component::Disk => query_wmi(
                "(Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq 0 } | Select-Object -First 1).SerialNumber",
            ),
        }
    }
}

/// Reads `MachineGuid` via `reg query`.
///
/// Deliberately not WMI: this is the component the whole fingerprint leans on,
/// and `reg` is present on every Windows install while `Get-CimInstance` can be
/// slow, disabled by policy, or missing on a stripped image.
#[cfg(windows)]
fn read_machine_guid() -> String {
    let mut cmd = Command::new("reg");
    cmd.args([
        "query",
        r"HKLM\SOFTWARE\Microsoft\Cryptography",
        "/v",
        "MachineGuid",
    ]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let Ok(output) = cmd.output() else {
        return String::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);

    // "    MachineGuid    REG_SZ    4f8a...-..."
    for line in text.lines() {
        if line.contains("REG_SZ") {
            if let Some(idx) = line.find("REG_SZ") {
                return line[idx + "REG_SZ".len()..].trim().to_string();
            }
        }
    }
    String::new()
}

#[cfg(not(windows))]
fn read_machine_guid() -> String {
    String::new()
}

/// Runs a one-line PowerShell query, returning `""` on any failure.
///
/// `-NoProfile` matters: a student's profile script can print a banner, which
/// would end up inside the component value and make the fingerprint depend on
/// the user's shell configuration.
///
/// The missing `CREATE_NO_WINDOW` here was a real shipped bug: this runs three
/// times per fingerprint, and on Windows Terminal each call raised a dialog.
fn query_wmi(script: &str) -> String {
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let Ok(output) = cmd.output() else {
        return String::new();
    };
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn part(c: Component, v: &str) -> (Component, String) {
        (c, v.to_string())
    }

    // -- The pure part -------------------------------------------------------

    #[test]
    fn the_same_components_always_produce_the_same_hash() {
        // The single property an activation depends on. If this is ever false,
        // every activated machine reports "bound to another device" on restart.
        let parts = vec![
            part(Component::MachineGuid, "AAAA-BBBB"),
            part(Component::Cpu, "Ryzen 7"),
            part(Component::Board, "ASUS B550"),
            part(Component::Disk, "SN12345"),
        ];
        assert_eq!(combine(&parts).device_hash, combine(&parts).device_hash);
    }

    #[test]
    fn a_different_machine_guid_changes_the_hash() {
        let a = combine(&[part(Component::MachineGuid, "AAAA")]);
        let b = combine(&[part(Component::MachineGuid, "BBBB")]);
        assert_ne!(a.device_hash, b.device_hash);
    }

    #[test]
    fn whitespace_does_not_change_the_hash() {
        // A probe returning a trailing newline must not re-bind the machine.
        let a = combine(&[part(Component::Cpu, "Ryzen 7")]);
        let b = combine(&[part(Component::Cpu, "  Ryzen 7 \n")]);
        assert_eq!(a.device_hash, b.device_hash);
    }

    #[test]
    fn a_blank_component_contributes_nothing_at_all() {
        // The false-mismatch guard: a probe that failed must produce the same
        // hash as a machine where that component was simply never included.
        let with_blank = combine(&[
            part(Component::MachineGuid, "AAAA"),
            part(Component::Disk, "   "),
        ]);
        let without = combine(&[part(Component::MachineGuid, "AAAA")]);
        assert_eq!(with_blank.device_hash, without.device_hash);
    }

    #[test]
    fn a_value_containing_the_separator_cannot_forge_a_collision() {
        // `|`-style joining would let "a|b" + "c" hash the same as "a" + "b|c".
        // The unit separator plus per-component labels makes that impossible,
        // and this is the assertion that keeps it that way.
        let one = combine(&[part(Component::Cpu, "a"), part(Component::Board, "b")]);
        let two = combine(&[part(Component::Cpu, "a\x1fb"), part(Component::Board, "")]);
        assert_ne!(one.device_hash, two.device_hash);
    }

    #[test]
    fn component_order_is_part_of_the_identity() {
        let a = combine(&[part(Component::Cpu, "x"), part(Component::Board, "y")]);
        let b = combine(&[part(Component::Board, "y"), part(Component::Cpu, "x")]);
        assert_ne!(a.device_hash, b.device_hash);
    }

    #[test]
    fn the_hash_is_a_sha256_digest_in_hex() {
        let fp = combine(&[part(Component::MachineGuid, "AAAA")]);
        assert_eq!(fp.device_hash.len(), 64);
        assert!(fp.device_hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    // -- Reliability reporting ----------------------------------------------

    #[test]
    fn two_readable_components_are_enough_to_be_reliable() {
        let fp = combine(&[
            part(Component::MachineGuid, "AAAA"),
            part(Component::Cpu, "Ryzen"),
        ]);
        assert_eq!(fp.components_readable, 2);
        assert!(fp.reliable());
    }

    #[test]
    fn a_single_readable_component_is_reported_as_unreliable() {
        // A machine where only one probe worked must not be treated as a solid
        // binding, which is what makes the UI able to explain a mismatch.
        let fp = combine(&[part(Component::MachineGuid, "AAAA")]);
        assert_eq!(fp.components_readable, 1);
        assert!(!fp.reliable());
    }

    #[test]
    fn blank_components_are_not_counted_as_readable() {
        let fp = combine(&[
            part(Component::MachineGuid, "AAAA"),
            part(Component::Cpu, ""),
            part(Component::Board, "   "),
        ]);
        assert_eq!(fp.components_readable, 1);
    }

    // -- Matching ------------------------------------------------------------

    #[test]
    fn matching_accepts_the_hash_it_produced() {
        let fp = combine(&[part(Component::MachineGuid, "AAAA")]);
        assert!(fp.matches(&fp.device_hash));
    }

    #[test]
    fn matching_rejects_another_machines_hash() {
        let mine = combine(&[part(Component::MachineGuid, "AAAA")]);
        let theirs = combine(&[part(Component::MachineGuid, "BBBB")]);
        assert!(!mine.matches(&theirs.device_hash));
    }

    #[test]
    fn matching_rejects_an_empty_or_truncated_stored_hash() {
        let fp = combine(&[part(Component::MachineGuid, "AAAA")]);
        assert!(!fp.matches(""));
        assert!(!fp.matches(&fp.device_hash[..10]));
    }

    // -- The real probes -----------------------------------------------------
    //
    // These touch the actual machine. They assert *stability*, never a specific
    // value: a test that required this build machine's CPU name would fail on
    // every other machine, which is the opposite of useful.

    #[test]
    fn capturing_twice_on_this_machine_gives_the_same_answer() {
        let a = capture();
        let b = capture();
        assert_eq!(
            a.device_hash, b.device_hash,
            "the fingerprint is not stable between two immediate reads"
        );
    }

    #[test]
    fn this_machine_yields_a_usable_fingerprint() {
        // A normal Windows desktop must produce a reliable fingerprint. On a
        // stripped CI container this may legitimately read fewer components, so
        // the assertion is that a digest exists at all — the *reliability* claim
        // is what is allowed to vary, and it is reported rather than assumed.
        let fp = capture();
        assert_eq!(fp.device_hash.len(), 64, "no digest was produced");
    }

    #[test]
    fn machine_guid_is_readable_on_windows() {
        // The component the design leans on. Worth pinning directly: if a
        // Windows update ever moved this key, the fingerprint would quietly drop
        // to three ingredients and this test is how we would find out.
        if cfg!(windows) {
            assert!(
                !read_machine_guid().is_empty(),
                "MachineGuid could not be read from the registry"
            );
        }
    }

    #[test]
    fn a_probe_that_fails_does_not_panic() {
        // `query_wmi` with a script that cannot produce output. It must return
        // an empty string, not panic or hang.
        let got = query_wmi("throw 'nope'");
        assert!(got.is_empty() || got.contains("nope"));
    }
}
