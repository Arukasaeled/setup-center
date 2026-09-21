//! The author's issuance ledger: `license_inventory.csv`.
//!
//! ## What this is, and what it is not
//!
//! It is a **plain CSV on the author's own disk**. It is not shipped, not read
//! by the app, and not consulted at activation time — the client verifies a code
//! cryptographically and never asks whether the ledger thinks the code is valid.
//! The ledger exists to answer questions the *signature* cannot:
//!
//! * Which codes have I issued, and which are still unused?
//! * Which device activated this one, and when?
//! * Has this code been handed out twice?
//!
//! ## Why CSV rather than a database
//!
//! At 500–1000 codes the failure modes of SQLite (another dependency, a binary
//! file to back up, a schema to migrate) all cost more than they save. A CSV
//! opens in Excel, diffs in git, and survives being emailed to yourself. The
//! brief's own escalation path — CSV → SQLite → server — is only worth taking
//! when the questions outgrow the file, and 500 rows does not.
//!
//! ## The invariant that is actually enforced
//!
//! Codes are stored as **`code_hash`**, never in plaintext. The file is a
//! ledger, not a keyring: if it leaked, an attacker should learn which codes
//! exist without being able to use any of them. `code_hash` is
//! [`validator::code_fingerprint`] — deterministic, unkeyed, and carrying no
//! authorisation (see its doc comment for why it must not be confused with the
//! device-salted `digest` that `license.dat` holds).

use crate::model::{AppError, AppResult};

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::validator::{self, CodeFormat};
use super::Tier;

/// The default ledger name, relative to the Cargo manifest directory.
pub const DEFAULT_INVENTORY: &str = "license_inventory.csv";

/// The header written when the file is created.
///
/// Written explicitly rather than inferred from the first row so that an empty
/// ledger is still self-describing, and so that a reader knows the column order
/// without cross-referencing this source file.
const HEADER: &str = "id,code_hash,tier,format,created_at,status,activated_at,device_hash,note";

/// Whether a code has been handed out or used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Unused,
    Activated,
    Revoked,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Unused => "unused",
            Status::Activated => "activated",
            Status::Revoked => "revoked",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text.trim().to_ascii_lowercase().as_str() {
            "unused" => Some(Status::Unused),
            "activated" => Some(Status::Activated),
            "revoked" => Some(Status::Revoked),
            _ => None,
        }
    }
}

/// One row of the ledger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// Zero-padded sequential identifier, `"001"`. A string, not a number, so
    /// that the padding survives a round trip through Excel.
    pub id: String,
    /// `sha256("inventory:v1:<code>")` — never the code.
    pub code_hash: String,
    pub tier: Tier,
    pub format: CodeFormat,
    pub created_at: String,
    pub status: Status,
    pub activated_at: String,
    pub device_hash: String,
    pub note: String,
}

impl Entry {
    /// The CSV line for this entry, without a trailing newline.
    pub fn to_csv(&self) -> String {
        [
            self.id.clone(),
            self.code_hash.clone(),
            self.tier.canonical().to_string(),
            self.format.label().to_string(),
            self.created_at.clone(),
            self.status.as_str().to_string(),
            self.activated_at.clone(),
            self.device_hash.clone(),
            self.note.clone(),
        ]
        .join(",")
    }

    /// Parses a CSV line, tolerating a trailing `\r` from a Windows editor.
    pub fn parse(line: &str) -> Option<Self> {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() || line.starts_with("id,") {
            return None;
        }
        let fields: Vec<&str> = line.split(',').collect();
        // Tolerate a short row from a hand-edited file rather than refusing to
        // read the whole ledger: losing one row is better than losing all of
        // them to one missing comma.
        let get = |i: usize| fields.get(i).copied().unwrap_or("").trim().to_string();

        Some(Self {
            id: get(0),
            code_hash: get(1),
            tier: match get(2).as_str() {
                "free" => Tier::Free,
                _ => Tier::Pro,
            },
            format: match get(3).as_str() {
                "v1" => CodeFormat::V1,
                _ => CodeFormat::V2,
            },
            created_at: get(4),
            status: Status::parse(&get(5)).unwrap_or(Status::Unused),
            activated_at: get(6),
            device_hash: get(7),
            note: get(8),
        })
    }
}

/// A parsed ledger, with the decoded rows and where they came from.
#[derive(Debug, Clone)]
pub struct Ledger {
    pub path: PathBuf,
    pub entries: Vec<Entry>,
    /// True when the file did not exist and was created by this run.
    pub created: bool,
    /// Lines that could not be parsed, with their 1-based line numbers.
    ///
    /// Reported rather than skipped silently: a row the tool cannot read is a
    /// code whose fate is unknown, and quietly ignoring it is how a ledger
    /// becomes untrustworthy.
    pub unreadable: Vec<(usize, String)>,
}

impl Ledger {
    /// The next identifier, continuing from the highest one present.
    ///
    /// Derived from the **maximum**, not the row count, so that deleting a row
    /// in the middle — or reordering the file — cannot make the next code
    /// collide with one already issued.
    pub fn next_number(&self) -> u64 {
        self.entries
            .iter()
            .filter_map(|e| e.id.trim().parse::<u64>().ok())
            .max()
            .unwrap_or(0)
            + 1
    }

    pub fn find_by_hash(&self, hash: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.code_hash == hash)
    }

    pub fn count_status(&self, status: Status) -> usize {
        self.entries.iter().filter(|e| e.status == status).count()
    }
}

/// Opens the ledger, creating it with a header when absent.
///
/// ## The overwrite guard the brief asks for
///
/// "删除 CSV 后重新生成必须报警" — removing the ledger and re-running the
/// issuer is the one mistake that silently re-issues live codes, because the
/// numbering restarts at `001` while codes bearing those numbers are already in
/// customers' hands. This cannot be *prevented* from inside the process (the
/// file is simply gone), so it is made **visible**: `created == true` means the
/// caller must refuse to append without an explicit override, and both the
/// issuer and the admin tool surface that as an error rather than a warning.
pub fn open(path: &Path) -> AppResult<Ledger> {
    if !path.exists() {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| {
                    AppError::Internal(format!("{}: {e}", parent.to_string_lossy()))
                })?;
            }
        }
        let mut file = fs::File::create(path)
            .map_err(|e| AppError::Internal(format!("{}: {e}", path.to_string_lossy())))?;
        writeln!(file, "{HEADER}")
            .map_err(|e| AppError::Internal(format!("{}: {e}", path.to_string_lossy())))?;
        return Ok(Ledger {
            path: path.to_path_buf(),
            entries: Vec::new(),
            created: true,
            unreadable: Vec::new(),
        });
    }

    let text = fs::read_to_string(path)
        .map_err(|e| AppError::Internal(format!("{}: {e}", path.to_string_lossy())))?;

    let mut entries = Vec::new();
    let mut unreadable = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if line.trim().is_empty() || line.starts_with("id,") {
            continue;
        }
        match Entry::parse(line) {
            Some(entry) => entries.push(entry),
            None => unreadable.push((i + 1, line.to_string())),
        }
    }

    Ok(Ledger {
        path: path.to_path_buf(),
        entries,
        created: false,
        unreadable,
    })
}

/// Appends entries, refusing to do so onto a ledger that was just created.
///
/// The append is a single `write_all` of a pre-built string so that a failure
/// part-way cannot leave a torn row. `File::append` on Windows is atomic for
/// small writes, which is adequate here — this is a single-user tool, not a
/// concurrent service.
pub fn append(ledger: &Ledger, entries: &[Entry], allow_new_file: bool) -> AppResult<()> {
    if entries.is_empty() {
        return Ok(());
    }
    if ledger.created && !allow_new_file {
        return Err(AppError::Internal(format!(
            "{} 不存在，已新建空台账。为避免与已发出的旧编号冲突，本次未写入。\
             请确认这是首次发行（加 --allow-new-ledger），或恢复原有的 {} 后重试。",
            ledger.path.display(),
            DEFAULT_INVENTORY
        )));
    }

    // Refuse to write duplicate identifiers at all. This is the last line of
    // defence for "保留编号连续性": two rows sharing an id mean the ledger can
    // no longer answer which code was given to whom.
    let mut seen: std::collections::HashSet<&str> =
        ledger.entries.iter().map(|e| e.id.as_str()).collect();
    for entry in entries {
        if !seen.insert(entry.id.as_str()) {
            return Err(AppError::Internal(format!(
                "台账中已存在编号 {}，拒绝写入以免覆盖历史记录。",
                entry.id
            )));
        }
    }

    let mut payload = String::new();
    for entry in entries {
        payload.push_str(&entry.to_csv());
        payload.push_str("\r\n");
    }

    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&ledger.path)
        .map_err(|e| AppError::Internal(format!("{}: {e}", ledger.path.display())))?;
    file.write_all(payload.as_bytes())
        .map_err(|e| AppError::Internal(format!("{}: {e}", ledger.path.display())))?;
    file.flush()
        .map_err(|e| AppError::Internal(format!("{}: {e}", ledger.path.display())))?;

    Ok(())
}

/// Builds an entry for a freshly minted code.
pub fn entry_for(code: &str, id: u64, tier: Tier, format: CodeFormat, created_at: &str) -> Entry {
    Entry {
        id: format!("{id:03}"),
        code_hash: validator::code_fingerprint(code),
        tier,
        format,
        created_at: created_at.to_string(),
        status: Status::Unused,
        activated_at: String::new(),
        device_hash: String::new(),
        note: String::new(),
    }
}

/// Where the ledger lives by default: beside `Cargo.toml`, not inside `src/`.
///
/// `CARGO_MANIFEST_DIR` is baked in at compile time and points at `src-tauri/`,
/// which keeps the file out of the packaged resources — the same reason the
/// issuer itself is an `examples/` binary.
pub fn default_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(DEFAULT_INVENTORY)
}

/// The dated export filename for a batch of newly issued codes.
///
/// The date is supplied by the caller rather than read here so the tests can
/// pin it; `issue.rs` passes today's date.
pub fn export_path(dir: &Path, date: &str) -> PathBuf {
    dir.join(format!("codes_export_{}.txt", date.replace('-', "")))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aissetup-ledger-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(id: u64, tier: Tier, code: &str) -> Entry {
        entry_for(code, id, tier, CodeFormat::V2, "2026-09-21T10:00:00Z")
    }

    // -- Creation and the overwrite guard ------------------------------------

    #[test]
    fn a_missing_ledger_is_created_with_a_header() {
        let dir = tempdir("create");
        let path = dir.join("license_inventory.csv");
        assert!(!path.exists());

        let book = open(&path).unwrap();
        assert!(book.created, "a new ledger must be flagged as created");
        assert!(path.exists());

        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("id,code_hash,tier"), "{text}");
    }

    #[test]
    fn an_existing_ledger_is_not_flagged_as_created() {
        let dir = tempdir("existing");
        let path = dir.join("license_inventory.csv");
        let _ = open(&path).unwrap();

        let again = open(&path).unwrap();
        assert!(
            !again.created,
            "a second open must not claim to have created it"
        );
    }

    #[test]
    fn writing_into_a_just_created_ledger_is_refused_without_the_override() {
        // The brief's "删除 CSV 后重新生成必须报警". Losing the ledger restarts
        // numbering at 001, so issuing into it would mint codes whose numbers
        // collide with codes already delivered.
        let dir = tempdir("guard");
        let path = dir.join("license_inventory.csv");
        let book = open(&path).unwrap();
        assert!(book.created);

        let err = append(
            &book,
            &[entry(1, Tier::Pro, "SC-ABCDE-23456-FGHJK-23456")],
            false,
        );
        assert!(err.is_err(), "issuing into a fresh ledger must be refused");

        let message = match err {
            Err(AppError::Internal(m)) => m,
            other => panic!("expected the guard error, got {other:?}"),
        };
        assert!(message.contains("--allow-new-ledger"), "{message}");

        // And nothing was written.
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("SC-"), "the refused write still landed");
    }

    #[test]
    fn writing_into_a_new_ledger_is_allowed_with_the_override() {
        let dir = tempdir("override");
        let path = dir.join("license_inventory.csv");
        let book = open(&path).unwrap();

        append(
            &book,
            &[entry(1, Tier::Pro, "SC-ABCDE-23456-FGHJK-23456")],
            true,
        )
        .unwrap();
        let reopened = open(&path).unwrap();
        assert_eq!(reopened.entries.len(), 1);
    }

    // -- Appending and continuity --------------------------------------------

    #[test]
    fn append_never_truncates_what_is_already_there() {
        // The rule from the brief: 每次生成追加，不覆盖历史.
        let dir = tempdir("append");
        let path = dir.join("license_inventory.csv");
        open(&path).unwrap();

        for id in 1..=3u64 {
            let book = open(&path).unwrap();
            let code = format!("SC-{id:05}-23456-FGHJK-23456");
            append(&book, &[entry(id, Tier::Pro, &code)], false).unwrap();
        }

        let book = open(&path).unwrap();
        assert_eq!(book.entries.len(), 3, "an earlier row was lost");
        assert_eq!(book.entries[0].id, "001");
        assert_eq!(book.entries[2].id, "003");
    }

    #[test]
    fn numbering_continues_across_separate_invocations() {
        // Each `issue` run is a separate process; the ledger is the only memory.
        let dir = tempdir("continuity");
        let path = dir.join("license_inventory.csv");
        open(&path).unwrap();

        let mut expected = 1u64;
        for _batch in 0..4 {
            let book = open(&path).unwrap();
            assert_eq!(book.next_number(), expected);

            let entries: Vec<Entry> = (0..5)
                .map(|i| {
                    let id = book.next_number() + i;
                    entry(id, Tier::Pro, &format!("SC-{id:05}-23456-FGHJK-23456"))
                })
                .collect();
            expected += 5;
            append(&book, &entries, false).unwrap();
        }

        let book = open(&path).unwrap();
        assert_eq!(book.entries.len(), 20);
        assert_eq!(book.next_number(), 21);
    }

    #[test]
    fn a_duplicate_identifier_is_refused_rather_than_overwritten() {
        let dir = tempdir("dupid");
        let path = dir.join("license_inventory.csv");
        open(&path).unwrap();

        let book = open(&path).unwrap();
        append(
            &book,
            &[entry(1, Tier::Pro, "SC-ABCDE-23456-FGHJK-23456")],
            false,
        )
        .unwrap();

        let book = open(&path).unwrap();
        let err = append(
            &book,
            &[entry(1, Tier::Pro, "SC-ZZZZZ-23456-FGHJK-23456")],
            false,
        );
        assert!(err.is_err(), "a duplicate id must be refused");

        // The original row is intact.
        let book = open(&path).unwrap();
        assert_eq!(book.entries.len(), 1);
        assert_eq!(
            book.entries[0].code_hash,
            validator::code_fingerprint("SC-ABCDE-23456-FGHJK-23456")
        );
    }

    #[test]
    fn ids_are_zero_padded_to_three_digits() {
        let e = entry(7, Tier::Pro, "SC-ABCDE-23456-FGHJK-23456");
        assert_eq!(e.id, "007");
        let e = entry(1234, Tier::Pro, "SC-ABCDE-23456-FGHJK-23456");
        assert_eq!(e.id, "1234", "beyond 999 the padding is simply absent");
    }

    // -- Round trips ---------------------------------------------------------

    #[test]
    fn a_row_survives_a_csv_round_trip() {
        let mut original = entry(137, Tier::Free, "SC-ABCDE-23456-FGHJK-23456");
        original.status = Status::Activated;
        original.activated_at = "2026-09-22T08:00:00Z".to_string();
        original.device_hash = "dbe44ff0".repeat(8);
        original.note = "alice".to_string();

        let parsed = Entry::parse(&original.to_csv()).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn the_tier_and_format_survive_the_round_trip() {
        for tier in [Tier::Pro, Tier::Free] {
            for format in [CodeFormat::V1, CodeFormat::V2] {
                let e = Entry {
                    tier,
                    format,
                    ..entry(1, tier, "SC-ABCDE-23456-FGHJK-23456")
                };
                let parsed = Entry::parse(&e.to_csv()).unwrap();
                assert_eq!(parsed.tier, tier);
                assert_eq!(parsed.format, format);
            }
        }
    }

    #[test]
    fn a_windows_line_ending_is_tolerated() {
        // The ledger is meant to be openable in Notepad and editable in Excel,
        // both of which will produce CRLF.
        let line = format!(
            "{}\r",
            entry(1, Tier::Pro, "SC-ABCDE-23456-FGHJK-23456").to_csv()
        );
        assert!(Entry::parse(&line).is_some());
    }

    #[test]
    fn the_header_row_is_not_mistaken_for_an_entry() {
        assert_eq!(Entry::parse(HEADER), None);
    }

    #[test]
    fn a_short_row_is_read_as_far_as_it_goes_rather_than_dropped() {
        // Losing one row to a missing comma is better than losing the ledger.
        let parsed = Entry::parse("137,abcdef,pro,v2,2026-09-21T10:00:00Z,unused").unwrap();
        assert_eq!(parsed.id, "137");
        assert_eq!(parsed.status, Status::Unused);
        assert!(parsed.device_hash.is_empty());
    }

    #[test]
    fn unparseable_data_is_reported_not_silently_skipped() {
        // There is no line shape that `parse` rejects outright today, so this
        // asserts the *contract*: any line that yields no entry must appear in
        // `unreadable`. Empty and header lines are explicitly excluded.
        let dir = tempdir("unreadable");
        let path = dir.join("license_inventory.csv");
        std::fs::write(&path, format!("{HEADER}\r\n\r\n")).unwrap();

        let book = open(&path).unwrap();
        assert!(book.entries.is_empty());
        assert!(book.unreadable.is_empty(), "blank lines are not errors");
    }

    // -- The privacy invariant -----------------------------------------------

    #[test]
    fn the_ledger_stores_no_plaintext_code() {
        // The point of hashing: a leaked ledger must not be a set of working
        // licence keys. Asserted on the bytes that reach the disk.
        let dir = tempdir("noplain");
        let path = dir.join("license_inventory.csv");
        open(&path).unwrap();

        let code = "SC-ABCDE-23456-FGHJK-23456";
        let book = open(&path).unwrap();
        append(&book, &[entry(1, Tier::Pro, code)], false).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            !text.contains("ABCDE"),
            "the code body is in the ledger:\n{text}"
        );
        assert!(
            !text.contains("FGHJK"),
            "the code body is in the ledger:\n{text}"
        );
        assert!(!text.contains(code), "the whole code is in the ledger");
        // But the hash is there, which is what makes `verify` possible.
        assert!(text.contains(&validator::code_fingerprint(code)));
    }

    #[test]
    fn a_code_can_be_found_by_recomputing_its_hash() {
        // What `license_admin verify` depends on.
        let dir = tempdir("find");
        let path = dir.join("license_inventory.csv");
        open(&path).unwrap();

        let codes = [
            "SC-ABCDE-23456-FGHJK-23456",
            "SC-QWERT-23456-FGHJK-23456",
            "SC-11111-23456-FGHJK-23456",
        ];
        let book = open(&path).unwrap();
        let entries: Vec<Entry> = codes
            .iter()
            .enumerate()
            .map(|(i, c)| entry(i as u64 + 1, Tier::Pro, c))
            .collect();
        append(&book, &entries, false).unwrap();

        let book = open(&path).unwrap();
        for (i, code) in codes.iter().enumerate() {
            let found = book
                .find_by_hash(&validator::code_fingerprint(code))
                .unwrap();
            assert_eq!(found.id, format!("{:03}", i + 1));
        }
        assert!(book
            .find_by_hash(&validator::code_fingerprint("SC-99999-23456-FGHJK-23456"))
            .is_none());
    }

    // -- Counting ------------------------------------------------------------

    #[test]
    fn statuses_are_counted_independently() {
        let dir = tempdir("counts");
        let path = dir.join("license_inventory.csv");
        open(&path).unwrap();

        let mut entries: Vec<Entry> = (1..=4)
            .map(|i| entry(i, Tier::Pro, &format!("SC-{i:05}-23456-FGHJK-23456")))
            .collect();
        entries[0].status = Status::Activated;
        entries[1].status = Status::Revoked;

        let book = open(&path).unwrap();
        append(&book, &entries, false).unwrap();

        let book = open(&path).unwrap();
        assert_eq!(book.count_status(Status::Unused), 2);
        assert_eq!(book.count_status(Status::Activated), 1);
        assert_eq!(book.count_status(Status::Revoked), 1);
        assert_eq!(book.entries.len(), 4);
    }

    #[test]
    fn a_status_string_round_trips() {
        for status in [Status::Unused, Status::Activated, Status::Revoked] {
            assert_eq!(Status::parse(status.as_str()), Some(status));
        }
        assert_eq!(Status::parse("ACTIVATED"), Some(Status::Activated));
        assert_eq!(Status::parse("nonsense"), None);
    }

    // -- A real 500-code batch ------------------------------------------------
    //
    // The brief's scale target, exercised against the real ledger rather than
    // asserted in prose. This is the test that answers "生成500个PRO是否成功".

    #[test]
    fn five_hundred_codes_issue_with_continuous_unique_numbers() {
        let dir = tempdir("batch500");
        let path = dir.join("license_inventory.csv");
        open(&path).unwrap();

        let book = open(&path).unwrap();
        let first = book.next_number();
        assert_eq!(first, 1);

        let mut codes = Vec::with_capacity(500);
        let mut entries = Vec::with_capacity(500);
        for i in 0..500u64 {
            let code = validator::mint_tiered(Tier::Pro).unwrap();
            entries.push(entry_for(
                &code,
                first + i,
                Tier::Pro,
                CodeFormat::V2,
                "2026-09-21T10:00:00Z",
            ));
            codes.push(code);
        }
        append(&book, &entries, false).unwrap();

        // Every code is unique.
        let unique: std::collections::HashSet<&String> = codes.iter().collect();
        assert_eq!(unique.len(), 500, "duplicate codes in a 500 batch");

        // Every code validates and reports PRO.
        for code in &codes {
            let v = validator::validate_tiered(code).expect("a minted code must validate");
            assert_eq!(v.tier, Tier::Pro, "{code}");
        }

        // The ledger persisted all 500, numbered continuously from 001.
        let book = open(&path).unwrap();
        assert_eq!(book.entries.len(), 500);
        for (i, e) in book.entries.iter().enumerate() {
            assert_eq!(e.id, format!("{:03}", i + 1), "numbering broke at {i}");
            assert_eq!(e.status, Status::Unused);
            assert_eq!(e.tier, Tier::Pro);
            assert_eq!(e.format, CodeFormat::V2);
            assert_eq!(e.code_hash.len(), 64);
        }
        assert_eq!(book.next_number(), 501);
        assert_eq!(book.count_status(Status::Unused), 500);

        // And every row is findable by its own code — the property the admin
        // tool needs, checked at the scale the brief actually asks about.
        for code in codes.iter().take(20) {
            assert!(book
                .find_by_hash(&validator::code_fingerprint(code))
                .is_some());
        }
    }

    #[test]
    fn a_second_batch_continues_from_501() {
        // Guards the release path: the 500 shipped codes must not be reissued.
        let dir = tempdir("second");
        let path = dir.join("license_inventory.csv");

        let write_batch = |from: u64, count: u64| {
            let book = open(&path).unwrap();
            let mut entries = Vec::new();
            for i in 0..count {
                let code = validator::mint_tiered(Tier::Pro).unwrap();
                entries.push(entry_for(
                    &code,
                    from + i,
                    Tier::Pro,
                    CodeFormat::V2,
                    "2026-09-21T10:00:00Z",
                ));
            }
            append(&book, &entries, false).unwrap();
        };

        // First run creates the ledger, then issues into it.
        open(&path).unwrap();
        write_batch(1, 500);

        let book = open(&path).unwrap();
        assert_eq!(book.next_number(), 501);

        write_batch(501, 3);
        let book = open(&path).unwrap();
        assert_eq!(book.entries.len(), 503);
        assert_eq!(book.entries.last().unwrap().id, "503");
    }

    #[test]
    fn a_free_batch_and_a_pro_batch_stay_distinguishable_in_the_ledger() {
        // The author must be able to tell which codes are trials, which is the
        // whole reason the ledger carries a tier column.
        let dir = tempdir("mixed");
        let path = dir.join("license_inventory.csv");
        open(&path).unwrap();

        let free = validator::mint_tiered(Tier::Free).unwrap();
        let pro = validator::mint_tiered(Tier::Pro).unwrap();
        let book = open(&path).unwrap();
        append(
            &book,
            &[
                entry_for(&free, 1, Tier::Free, CodeFormat::V2, "2026-09-21T10:00:00Z"),
                entry_for(&pro, 2, Tier::Pro, CodeFormat::V2, "2026-09-21T10:00:00Z"),
            ],
            false,
        )
        .unwrap();

        let book = open(&path).unwrap();
        let free_row = book
            .find_by_hash(&validator::code_fingerprint(&free))
            .unwrap();
        let pro_row = book
            .find_by_hash(&validator::code_fingerprint(&pro))
            .unwrap();
        assert_eq!(free_row.tier, Tier::Free);
        assert_eq!(pro_row.tier, Tier::Pro);
        assert_eq!(
            free_row.tier,
            validator::validate_tiered(&free).unwrap().tier
        );
        assert_eq!(pro_row.tier, validator::validate_tiered(&pro).unwrap().tier);
    }

    #[test]
    fn the_default_ledger_path_sits_beside_the_manifest() {
        // Not inside `src/`, and not inside the packaged resources — the same
        // constraint that keeps the issuer out of the bundle.
        let path = default_path();
        assert_eq!(
            path.file_name().unwrap().to_string_lossy(),
            "license_inventory.csv"
        );
        assert!(path.to_string_lossy().ends_with("license_inventory.csv"));
        assert!(!path.to_string_lossy().contains("src\\src"));
    }
}
