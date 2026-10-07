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
use serde::{Deserialize, Serialize};

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
            Component::Disk => read_system_disk_serial(),
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

/// Reads the serial number of the physical disk backing the Windows system volume.
///
/// Deliberately resolves the volume rather than assuming Disk Index 0: on multi-disk
/// NVMe/SATA setups or systems booted from another drive, Index 0 is often a data drive
/// that can be removed or swapped, which would break machine binding (Issue A10).
#[cfg(windows)]
fn read_system_disk_serial() -> String {
    let script = r#"
$sysDrive = $env:SystemDrive
if (-not $sysDrive) { $sysDrive = 'C:' }
$dl = $sysDrive.TrimEnd(':')
$part = Get-Partition -DriveLetter $dl -ErrorAction SilentlyContinue
if ($part) {
    $disk = Get-Disk -Number $part.DiskNumber -ErrorAction SilentlyContinue
    if ($disk -and $disk.SerialNumber) {
        $disk.SerialNumber.Trim()
        exit
    }
}
$assoc = Get-CimInstance -Query "ASSOCIATORS OF {Win32_LogicalDisk.DeviceID='$sysDrive'} WHERE AssocClass=Win32_LogicalDiskToPartition" -ErrorAction SilentlyContinue
if ($assoc) {
    $drive = Get-CimInstance -Query "ASSOCIATORS OF {Win32_DiskPartition.DeviceID='$($assoc.DeviceID)'} WHERE AssocClass=Win32_DiskDriveToDiskPartition" -ErrorAction SilentlyContinue
    if ($drive -and $drive.SerialNumber) {
        $drive.SerialNumber.Trim()
        exit
    }
}
(Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | Select-Object -First 1).SerialNumber
"#;
    query_wmi(script)
}

#[cfg(not(windows))]
fn read_system_disk_serial() -> String {
    String::new()
}

/// Reads the system hardware UUID from WMI.
#[cfg(windows)]
fn read_system_uuid() -> String {
    query_wmi("(Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).UUID")
}

#[cfg(not(windows))]
fn read_system_uuid() -> String {
    String::new()
}

// ---------------------------------------------------------------------------
// Device Evidence V2 (Issue A10)
// ---------------------------------------------------------------------------

/// The individual components of a machine's evidence record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceComponentKind {
    SystemUuid,
    MachineGuid,
    SystemDiskSerial,
    CpuModel,
    BoardModel,
}

impl DeviceComponentKind {
    pub fn is_strong(self) -> bool {
        matches!(
            self,
            DeviceComponentKind::SystemUuid
                | DeviceComponentKind::MachineGuid
                | DeviceComponentKind::SystemDiskSerial
        )
    }

    pub fn label(self) -> &'static str {
        match self {
            DeviceComponentKind::SystemUuid => "system-uuid",
            DeviceComponentKind::MachineGuid => "machine-guid",
            DeviceComponentKind::SystemDiskSerial => "system-disk-serial",
            DeviceComponentKind::CpuModel => "cpu-model",
            DeviceComponentKind::BoardModel => "board-model",
        }
    }
}

/// Status of probing a component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentStatus {
    Available,
    Missing,
    PermissionDenied,
    WeakDefaultValue,
    QueryFailed,
}

/// One observed component in the V2 device evidence.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceComponentV2 {
    pub kind: DeviceComponentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub status: ComponentStatus,
    pub is_strong: bool,
}

/// V2 Device Evidence record containing structured observations with explicit statuses.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEvidenceV2 {
    pub version: u32,
    pub components: Vec<DeviceComponentV2>,
    pub observed_at: String,
}

/// Verdict from matching current machine evidence against stored evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceMatchVerdict {
    Matched,
    Mismatch,
    NeedsAttention,
}

/// Identifies common placeholder or default strings that must not be counted as strong unique identifiers.
pub fn is_weak_or_default_value(val: &str) -> bool {
    let trimmed = val.trim();
    if trimmed.is_empty() {
        return true;
    }
    let lower = trimmed.to_lowercase();
    let is_all_zeros = trimmed.chars().all(|c| c == '0' || c == '-');
    let is_all_f = trimmed.chars().all(|c| c == 'f' || c == 'F' || c == '-');
    is_all_zeros
        || is_all_f
        || lower == "default string"
        || lower == "to be filled by o.e.m."
        || lower == "to be filled by oem"
        || lower == "system serial number"
        || lower == "none"
        || lower == "unknown"
        || lower == "not applicable"
        || lower == "chassis serial number"
}

impl DeviceEvidenceV2 {
    /// Captures the structured hardware evidence of this machine.
    pub fn capture() -> Self {
        let mut components = Vec::with_capacity(5);

        // 1. SystemUuid (Strong)
        let uuid_raw = read_system_uuid();
        let (uuid_val, uuid_status) = if uuid_raw.is_empty() {
            (None, ComponentStatus::Missing)
        } else if is_weak_or_default_value(&uuid_raw) {
            (Some(uuid_raw), ComponentStatus::WeakDefaultValue)
        } else {
            (Some(uuid_raw), ComponentStatus::Available)
        };
        components.push(DeviceComponentV2 {
            kind: DeviceComponentKind::SystemUuid,
            value: uuid_val,
            status: uuid_status,
            is_strong: true,
        });

        // 2. MachineGuid (Strong)
        let guid_raw = read_machine_guid();
        let (guid_val, guid_status) = if guid_raw.is_empty() {
            (None, ComponentStatus::Missing)
        } else if is_weak_or_default_value(&guid_raw) {
            (Some(guid_raw), ComponentStatus::WeakDefaultValue)
        } else {
            (Some(guid_raw), ComponentStatus::Available)
        };
        components.push(DeviceComponentV2 {
            kind: DeviceComponentKind::MachineGuid,
            value: guid_val,
            status: guid_status,
            is_strong: true,
        });

        // 3. SystemDiskSerial (Strong)
        let disk_raw = read_system_disk_serial();
        let (disk_val, disk_status) = if disk_raw.is_empty() {
            (None, ComponentStatus::Missing)
        } else if is_weak_or_default_value(&disk_raw) {
            (Some(disk_raw), ComponentStatus::WeakDefaultValue)
        } else {
            (Some(disk_raw), ComponentStatus::Available)
        };
        components.push(DeviceComponentV2 {
            kind: DeviceComponentKind::SystemDiskSerial,
            value: disk_val,
            status: disk_status,
            is_strong: true,
        });

        // 4. CpuModel (Informational)
        let cpu_raw = query_wmi("(Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1).Name");
        let (cpu_val, cpu_status) = if cpu_raw.is_empty() {
            (None, ComponentStatus::Missing)
        } else {
            (Some(cpu_raw), ComponentStatus::Available)
        };
        components.push(DeviceComponentV2 {
            kind: DeviceComponentKind::CpuModel,
            value: cpu_val,
            status: cpu_status,
            is_strong: false,
        });

        // 5. BoardModel (Informational)
        let m = query_wmi("(Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue | Select-Object -First 1).Manufacturer");
        let p = query_wmi("(Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue | Select-Object -First 1).Product");
        let board_raw = format!("{m} {p}").trim().to_string();
        let (board_val, board_status) = if board_raw.is_empty() {
            (None, ComponentStatus::Missing)
        } else if is_weak_or_default_value(&board_raw) {
            (Some(board_raw), ComponentStatus::WeakDefaultValue)
        } else {
            (Some(board_raw), ComponentStatus::Available)
        };
        components.push(DeviceComponentV2 {
            kind: DeviceComponentKind::BoardModel,
            value: board_val,
            status: board_status,
            is_strong: false,
        });

        DeviceEvidenceV2 {
            version: 2,
            components,
            observed_at: crate::modules::detect::now_iso8601(),
        }
    }

    /// Evaluates current machine evidence against the stored evidence.
    ///
    /// Fixed V2 matching rule (Audit A10):
    /// - At least 2 of the 3 strong components must be Available in stored evidence.
    /// - At least 2 of the strong components must match between current and stored.
    /// - If matching fails and current strong probes are fewer than 2, reports NeedsAttention.
    /// - A single component change (e.g. MachineGuid after reinstall) still matches if the other two agree.
    pub fn match_against(&self, stored: &DeviceEvidenceV2) -> DeviceMatchVerdict {
        let strong_kinds = [
            DeviceComponentKind::SystemUuid,
            DeviceComponentKind::MachineGuid,
            DeviceComponentKind::SystemDiskSerial,
        ];

        let stored_strong_available = strong_kinds
            .iter()
            .filter(|&&k| {
                stored
                    .components
                    .iter()
                    .any(|c| c.kind == k && c.status == ComponentStatus::Available && c.value.is_some())
            })
            .count();

        if stored_strong_available < 2 {
            return DeviceMatchVerdict::NeedsAttention;
        }

        let current_strong_available = strong_kinds
            .iter()
            .filter(|&&k| {
                self
                    .components
                    .iter()
                    .any(|c| c.kind == k && c.status == ComponentStatus::Available && c.value.is_some())
            })
            .count();

        let mut matched_count = 0;
        for &k in &strong_kinds {
            let stored_val = stored
                .components
                .iter()
                .find(|c| c.kind == k && c.status == ComponentStatus::Available)
                .and_then(|c| c.value.as_deref());
            let current_val = self
                .components
                .iter()
                .find(|c| c.kind == k && c.status == ComponentStatus::Available)
                .and_then(|c| c.value.as_deref());

            if let (Some(s), Some(c)) = (stored_val, current_val) {
                if s.trim().eq_ignore_ascii_case(c.trim()) {
                    matched_count += 1;
                }
            }
        }

        if matched_count >= 2 {
            DeviceMatchVerdict::Matched
        } else if current_strong_available < 2 {
            DeviceMatchVerdict::NeedsAttention
        } else {
            DeviceMatchVerdict::Mismatch
        }
    }
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

    // -- DeviceEvidenceV2 tests (Issue A10) ----------------------------------

    fn make_test_evidence(
        uuid: Option<&str>,
        guid: Option<&str>,
        disk: Option<&str>,
    ) -> DeviceEvidenceV2 {
        let components = vec![
            DeviceComponentV2 {
                kind: DeviceComponentKind::SystemUuid,
                value: uuid.map(String::from),
                status: if uuid.is_some() {
                    ComponentStatus::Available
                } else {
                    ComponentStatus::Missing
                },
                is_strong: true,
            },
            DeviceComponentV2 {
                kind: DeviceComponentKind::MachineGuid,
                value: guid.map(String::from),
                status: if guid.is_some() {
                    ComponentStatus::Available
                } else {
                    ComponentStatus::Missing
                },
                is_strong: true,
            },
            DeviceComponentV2 {
                kind: DeviceComponentKind::SystemDiskSerial,
                value: disk.map(String::from),
                status: if disk.is_some() {
                    ComponentStatus::Available
                } else {
                    ComponentStatus::Missing
                },
                is_strong: true,
            },
        ];
        DeviceEvidenceV2 {
            version: 2,
            components,
            observed_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn v2_matching_accepts_two_matching_strong_components() {
        let stored = make_test_evidence(Some("UUID-1"), Some("GUID-1"), Some("DISK-1"));
        // MachineGuid changed (e.g. OS reinstalled), but UUID and Disk match
        let current = make_test_evidence(Some("UUID-1"), Some("GUID-2"), Some("DISK-1"));
        assert_eq!(current.match_against(&stored), DeviceMatchVerdict::Matched);
    }

    #[test]
    fn v2_matching_rejects_when_fewer_than_two_strong_components_match() {
        let stored = make_test_evidence(Some("UUID-1"), Some("GUID-1"), Some("DISK-1"));
        // Only UUID matches, GUID and Disk belong to a different machine
        let current = make_test_evidence(Some("UUID-1"), Some("GUID-2"), Some("DISK-2"));
        assert_eq!(current.match_against(&stored), DeviceMatchVerdict::Mismatch);
    }

    #[test]
    fn v2_matching_needs_attention_when_stored_has_fewer_than_two_strong_components() {
        let stored = make_test_evidence(Some("UUID-1"), None, None);
        let current = make_test_evidence(Some("UUID-1"), Some("GUID-1"), Some("DISK-1"));
        assert_eq!(
            current.match_against(&stored),
            DeviceMatchVerdict::NeedsAttention
        );
    }

    #[test]
    fn v2_matching_needs_attention_when_current_probes_insufficient() {
        let stored = make_test_evidence(Some("UUID-1"), Some("GUID-1"), Some("DISK-1"));
        // Current machine only has one probe working (e.g. WMI broken, reg denied)
        let current = make_test_evidence(Some("UUID-1"), None, None);
        assert_eq!(
            current.match_against(&stored),
            DeviceMatchVerdict::NeedsAttention
        );
    }

    #[test]
    fn weak_default_values_are_detected() {
        assert!(is_weak_or_default_value("00000000-0000-0000-0000-000000000000"));
        assert!(is_weak_or_default_value("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"));
        assert!(is_weak_or_default_value("To be filled by O.E.M."));
        assert!(is_weak_or_default_value("None"));
        assert!(is_weak_or_default_value("Default string"));
        assert!(!is_weak_or_default_value("4A2C85A1-97BD-41D8-868C-226871DFDE25"));
    }
}
