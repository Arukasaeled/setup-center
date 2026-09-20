//! Software Intelligence Layer — "what is already on this machine?"
//!
//! This module answers exactly one question and nothing else. It never installs,
//! never writes to the registry, never touches `PATH`. Everything it does is a
//! read plus a comparison.
//!
//! Architecture
//! ------------
//! Three *independent* providers, each a plain function returning facts:
//!
//! ```text
//!  winget   →  winget list, parsed from measured column offsets
//!  registry →  HKLM/HKCU Uninstall keys, both 32- and 64-bit views
//!  path     →  App Paths, PATH directories, well-known install roots
//! ```
//!
//! They share no state and never call each other, so any one of them can fail
//! without invalidating the others — and each is unit-testable against captured
//! fixtures with no Windows session involved.
//!
//! **Facts are the product; [`merge`] is the only place that decides.** Providers
//! may report evidence and may report the absence of evidence, but they may not
//! report "not installed" — that claim requires every source, and it is what
//! [`merge`] computes. One function, pure and total. A provider bug can then
//! never silently become a false "installed ✓" in the UI.
//!
//! No software name is hard-coded here
//! -----------------------------------
//! The brief requires that. Names, executable stems, registry patterns and
//! install roots all live in [`super::catalog`], which owns the only mention of a
//! vendor name in the Rust source.

use crate::model::*;

use super::catalog;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Facts — what a provider is allowed to say
// ---------------------------------------------------------------------------

/// What one provider observed.
///
/// Deliberately *not* `SoftwareInfo`: absence of evidence and evidence of
/// absence are different things, and only [`merge`] may conflate them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Finding {
    /// This source positively knows the program is present.
    Present { value: String },
    /// The source was unavailable or errored. **Not** evidence of absence:
    /// treating it as such is how installers end up reinstalling software the
    /// student already has.
    Unavailable { reason: String },
    /// The source ran successfully and knows nothing about this program.
    Absent,
}

/// A [`Finding`] tagged with the source that produced it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Evidence {
    pub source: ProbeSource,
    pub finding: Finding,
}

impl Evidence {
    pub fn present(source: ProbeSource, value: impl Into<String>) -> Self {
        Self {
            source,
            finding: Finding::Present {
                value: value.into(),
            },
        }
    }

    pub fn unavailable(source: ProbeSource, reason: impl Into<String>) -> Self {
        Self {
            source,
            finding: Finding::Unavailable {
                reason: reason.into(),
            },
        }
    }

    pub fn absent(source: ProbeSource) -> Self {
        Self {
            source,
            finding: Finding::Absent,
        }
    }

    /// Stable token used by the UI and the report.
    pub fn outcome(&self) -> &'static str {
        match self.finding {
            Finding::Present { .. } => "present",
            Finding::Unavailable { .. } => "unavailable",
            Finding::Absent => "absent",
        }
    }

    /// The raw value a provider recorded, in that provider's own encoding.
    ///
    /// **Not for display.** The providers pack several fields into one string with
    /// `|` as the separator (`version|location|key`) because the merge step needs
    /// all of them and the evidence type carries one value. See [`Self::detail`]
    /// for the readable form; the UI must use that.
    pub fn raw(&self) -> Option<String> {
        match &self.finding {
            Finding::Present { value } => Some(value.clone()),
            Finding::Unavailable { reason } => Some(reason.clone()),
            Finding::Absent => None,
        }
    }

    /// The human-readable detail, for the UI and the report.
    ///
    /// Unpacks the provider's `|`-delimited payload so the student sees
    /// `2.54.0 · C:\…\git.exe` rather than `2.54.0|C:\…\git.exe|HKEY_…`. The
    /// delimiter is an internal contract and leaking it into the interface makes
    /// the tool look unfinished — the exact complaint this phase addresses.
    ///
    /// The registry's third field (the full `Microsoft.PowerShell.Core\Registry::
    /// HKEY_…` path) is deliberately dropped: it is the provider's internal key,
    /// several hundred characters long, and meaningless to a student. What it
    /// establishes — *which* registry entry matched — is already implicit in the
    /// provider's name.
    pub fn detail(&self) -> Option<String> {
        let raw = self.raw()?;
        if matches!(self.finding, Finding::Unavailable { .. }) {
            return Some(raw);
        }
        Some(summarise_present_value(&raw))
    }
}

/// Renders a packed `Present` value as a readable line.
///
/// Split out and tested directly, because the shape of the packed string differs
/// per provider and getting it wrong is invisible until it is on screen.
fn summarise_present_value(raw: &str) -> String {
    let fields: Vec<&str> = raw.split('|').collect();

    // winget: `version|packageId|displayName` — the display name is the most
    // useful thing to show, with the version.
    if fields.len() >= 3 && fields[1].contains('.') {
        let version = fields[0].trim();
        let package = fields[1].trim();
        let name = fields[2].trim();
        return match (version.is_empty(), name.is_empty()) {
            (false, false) => format!("{name} · {version}"),
            (false, true) => format!("{package} · {version}"),
            (true, false) => name.to_string(),
            (true, true) => package.to_string(),
        };
    }

    // registry: `version|installLocation|registryKey` — show where it lives.
    if fields.len() >= 2 && fields[1].contains('\\') {
        let version = fields[0].trim();
        let location = fields[1].trim();
        return match (version.is_empty(), location.is_empty()) {
            (false, false) => format!("{location} · {version}"),
            (_, false) => location.to_string(),
            (false, true) => version.to_string(),
            (true, true) => raw.to_string(),
        };
    }

    // path: `version|absolutePath` — the resolved binary.
    if fields.len() >= 2 {
        let version = fields[0].trim();
        let path = fields[1].trim();
        return match (version.is_empty(), path.is_empty()) {
            (false, false) => format!("{path} · {version}"),
            (_, false) => path.to_string(),
            (false, true) => version.to_string(),
            (true, true) => raw.to_string(),
        };
    }

    raw.to_string()
}

/// One provider's complete output, keyed by program.
pub type Facts = BTreeMap<SoftwareId, IndividualFinding>;

/// A single provider only ever has one thing to say about a program, but the
/// accumulator across providers has several. Wrapping it makes the difference
/// explicit at the call site instead of hiding it in a type alias.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndividualFinding {
    pub evidence: Evidence,
}

/// The complete evidence table after every provider has run.
pub type EvidenceTable = BTreeMap<SoftwareId, Vec<Evidence>>;

/// One provider: a pure function over the catalog.
pub type ProviderSpec = fn(&catalog::Catalog) -> Facts;

/// The provider set with its display name, in **precedence order** (highest
/// first).
///
/// Named as a table rather than three constants because the name and the function
/// have to stay in step: comparing function pointers to recover a provider's name
/// is fragile (it depends on a warning-suppressed cast and breaks the moment two
/// providers share an implementation), so the name is carried alongside.
///
/// `BTreeMap` iteration order is alphabetical and therefore meaningless here, so
/// the order is stated explicitly. `registry` outranks `path` and `winget`
/// because the uninstall entry is the only source that also carries the install
/// location, and `path` outranks `winget` because a binary that actually runs is
/// stronger evidence of *usability* than a package-manager record, which survives
/// an uninstall.
pub const PROVIDERS: [(&str, ProviderSpec); 3] = [
    ("注册表", registry_provider),
    ("PATH", path_provider),
    ("winget", winget_provider),
];

/// The provider functions in precedence order.
pub fn providers() -> impl Iterator<Item = ProviderSpec> {
    PROVIDERS.iter().map(|(_, provider)| *provider)
}

/// Human-readable provider names in precedence order, for the UI.
pub fn provider_names() -> Vec<String> {
    PROVIDERS.iter().map(|(name, _)| name.to_string()).collect()
}

// ---------------------------------------------------------------------------
// Provider 1 — winget
// ---------------------------------------------------------------------------

/// Reads the installed-package list from `winget list`.
///
/// Two facts drive the parsing. Both were *measured* against winget 1.29.290 on
/// a live machine rather than assumed, and both would produce silent corruption
/// if guessed:
///
/// 1. `winget list` has **no `--output json`** — that flag exists on `search`,
///    not `list` — and the table's padding counts **characters, not bytes**.
///    Byte slicing works on an ASCII machine and produces garbage the moment a
///    row contains a Chinese program name, which is most of them here.
/// 2. The header is localised (`名称 ID 版本 可用 源`) and the column starts are
///    fixed character offsets from it. The offsets are therefore *derived from
///    the header actually received*, never from constants keyed to English.
///
/// When the header cannot be understood this reports [`Finding::Unavailable`]
/// rather than "absent". Refusing to parse is the correct failure mode: a wrong
/// "not installed" makes the app reinstall software that is already there.
pub fn winget_provider(cat: &catalog::Catalog) -> Facts {
    let rows = match winget_list() {
        Ok(rows) => rows,
        Err(reason) => return unavailable_for_all(cat, ProbeSource::Winget, reason),
    };

    // Index by package id. The id column is the one column winget does not
    // translate, which is exactly why the catalog declares ids.
    let by_id: BTreeMap<String, WingetRow> = rows
        .into_iter()
        .filter(|row| !row.id.is_empty())
        .map(|row| (row.id.to_lowercase(), row))
        .collect();

    cat.ids()
        .map(|id| {
            let entry = cat.entry(id);

            let hit = entry
                .winget_ids()
                .iter()
                .find_map(|pid| by_id.get(&pid.to_lowercase()))
                // Fall back to the display-name column, which is localised but
                // still matchable. Never the *source* column: that one is the
                // literal string "winget" in both locales and carries nothing.
                .or_else(|| {
                    by_id
                        .values()
                        .find(|row| entry.matches_name(&row.name))
                });

            let evidence = match hit {
                Some(row) => {
                    let version = row
                        .version
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string());
                    // Encode id and version together; `merge` decodes. Keeping
                    // the provider's own shape out of the model is what lets the
                    // merge rules stay provider-agnostic.
                    Evidence::present(
                        ProbeSource::Winget,
                        format!("{version}|{}|{}", row.id, row.name),
                    )
                }
                None => Evidence::absent(ProbeSource::Winget),
            };
            (id, IndividualFinding { evidence })
        })
        .collect()
}

/// One row of `winget list`, already split into columns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WingetRow {
    pub name: String,
    pub id: String,
    pub version: Option<String>,
    /// The "available upgrade" column. A value here does *not* mean the row is
    /// a different package — it means an update exists. Kept so that distinction
    /// is explicit rather than accidentally folded into the version.
    pub available: Option<String>,
}

/// Where each column starts, in **characters** from the line start.
///
/// The offsets are taken from a *data row*, not from the header. This is not a
/// stylistic choice: `winget list` renders its header flush from column 0 but
/// indents every data row by two spaces, so the two have different column starts.
/// Deriving offsets from the header and applying them to rows reads every field
/// two characters to the left, which shifted `MSIX\OpenAI.Codex…` into the name
/// column and made VS Code's package id invisible. Measured on winget 1.29.290:
/// header `ID` at char 59, row id at char 61.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WingetColumns {
    pub id: usize,
    pub version: usize,
    pub available: Option<usize>,
    /// Where the source column begins. Needed as the *end* boundary of
    /// `available` — the version and available fields are right-aligned inside
    /// their columns, so slicing up to the next column start is the only way to
    /// recover them without also capturing the trailing `winget` source value.
    pub source: Option<usize>,
}

impl WingetColumns {
    /// Derives the layout from the header row.
    ///
    /// The header is used for *structure* — how many columns there are and in
    /// what order — while the actual offsets come from a data row, because only
    /// the data row carries the indent. Kept public because callers that have
    /// only a header can still validate that it looks like a winget table.
    pub fn from_header(header: &str) -> Option<Self> {
        let starts = column_starts(header);
        let id_pos = starts
            .iter()
            .copied()
            .find(|pos| token_at(header, *pos, 2).eq_ignore_ascii_case("id"))?;
        let mut after_id = starts.iter().copied().filter(|pos| *pos > id_pos);
        let version = after_id.next()?;
        // The header's own trailing columns: `版本 可用 源`. Taking the third run
        // after the id gives the source boundary; on a 4-column header it is the
        // source itself.
        let available = after_id.next();
        let source = after_id.next();
        if version <= id_pos {
            return None;
        }
        Some(Self {
            id: id_pos,
            version,
            available,
            source,
        })
    }

    /// Derives the layout from the header plus the first data row.
    ///
    /// The two together are needed because `winget list` renders them at
    /// different offsets: the header sits flush from column 0, while every data
    /// row is indented. Measured on winget 1.29.290 — header `ID` at char 59,
    /// data-row id at char 61.
    ///
    /// The data row's layout is otherwise **fixed**: the id, version, available
    /// and source columns always begin at the same character regardless of what
    /// those columns contain. So the offsets are recovered as *widths* from the
    /// header (which is uniformly padded) and then anchored to the row's first
    /// non-space character. Counting whitespace runs does not work — a name with
    /// spaces yields five runs where a name without yields one.
    pub fn from_table(header: &str, first_row: &str) -> Option<Self> {
        let header_starts = column_starts(header);
        if header_starts.len() < 3 {
            return None;
        }

        let id_pos = header_starts
            .iter()
            .copied()
            .find(|pos| token_at(header, *pos, 2).eq_ignore_ascii_case("id"))?;
        let id_index = header_starts.iter().position(|p| *p == id_pos)?;

        let version_header = *header_starts.get(id_index + 1)?;
        let available_header = header_starts.get(id_index + 2).copied();

        // The row's indent: everything before its first non-space character.
        // Names may themselves lead with spaces in principle, so this is the
        // offset of the row's first run start, not of its id column.
        let indent = first_row
            .chars()
            .position(|c| !c.is_whitespace())
            .unwrap_or(0);
        // The header's own first run starts at 0, so the indent is the difference
        // between where the row's first column starts and where the header's does.
        let header_indent = header_starts.first().copied().unwrap_or(0);
        let shift = indent.saturating_sub(header_indent);

        let id = id_pos + shift;
        let version = version_header + shift;
        let available = available_header.map(|a| a + shift);
        let source = available_header
            .and_then(|a| header_starts.iter().copied().find(|p| *p > a))
            .map(|s| s + shift);

        if version <= id {
            return None;
        }
        Some(Self {
            id,
            version,
            available,
            source,
        })
    }
}

/// Character positions where a non-space run begins, treating any character that
/// is preceded by whitespace (or the line start) as the beginning of a column.
///
/// Returns **character** indices, not byte offsets. `char_indices()` yields byte
/// offsets, which is the wrong unit here for the same reason it is wrong in
/// `slice_chars`: the table's leading `名称` makes every byte position four
/// greater than the corresponding character position on this machine, and
/// identical on an English one — so a byte-based version of this function would
/// pass on an English system and corrupt every name on a Chinese one.
///
/// A run may contain internal spaces (`Microsoft Visual Studio Code (User)` is
/// one column), so callers must not treat every run as a column.
fn column_starts(line: &str) -> Vec<usize> {
    let chars: Vec<char> = line.chars().collect();
    let mut starts = Vec::new();
    for (idx, ch) in chars.iter().enumerate() {
        if ch.is_whitespace() {
            continue;
        }
        if idx == 0 || chars[idx - 1].is_whitespace() {
            starts.push(idx);
        }
    }
    starts
}

fn token_at(text: &str, start: usize, max: usize) -> String {
    // `start` is a *character* offset, like everywhere else in this parser, so it
    // must not be used to index the string's bytes. `名称` is two characters but
    // six bytes, which made `&text[59..]` land on byte 59 — four characters too
    // early — and silently return the wrong token for the header's ID column.
    text.chars().skip(start).take(max).collect()
}

/// Extracts the fields of one data row using the derived layout.
pub fn parse_winget_row(line: &str, columns: &WingetColumns) -> WingetRow {
    let id_end = columns.version;
    let version_end = columns.available.unwrap_or_else(|| line.chars().count());
    // `available` ends where the source column begins; falling back to the line
    // end is correct only when there is no source column at all.
    let available_end = columns
        .source
        .unwrap_or_else(|| line.chars().count());

    WingetRow {
        name: slice_chars(line, 0, columns.id),
        id: slice_chars(line, columns.id, id_end),
        version: non_empty_str(slice_chars(line, columns.version, version_end)),
        available: columns
            .available
            .map(|start| slice_chars(line, start, available_end))
            .and_then(non_empty_str),
    }
}

/// Character-safe slice. `skip`/`take` on `chars()` is the whole point: indices
/// here are character positions, and `&line[start..end]` would panic or corrupt
/// output on any line containing multi-byte UTF-8.
fn slice_chars(line: &str, start: usize, end: usize) -> String {
    line.chars()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect::<String>()
        .trim()
        .to_string()
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// Same as [`non_empty`] for an owned `String`, so the enum-decoding paths can
/// reuse one definition instead of duplicating the trim-and-filter logic.
fn non_empty_str(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Runs `winget list` and parses it into rows.
pub fn winget_list() -> Result<Vec<WingetRow>, String> {
    let raw = super::detect::run_capture("winget", &["list", "--disable-interactivity"])
        .map_err(|e| format!("无法运行 winget：{e}"))?;

    parse_winget_table(&raw)
}

/// Splits a captured `winget list` capture into rows.
///
/// Split out from the process call so the parser is testable against a captured
/// fixture — including the Chinese-output fixture that proves the
/// character-vs-byte decision, and the truncated-output fixture that proves the
/// parser refuses to guess.
pub fn parse_winget_table(raw: &str) -> Result<Vec<WingetRow>, String> {
    let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        return Err("winget 没有输出".into());
    }

    // winget prints a version banner and possibly progress before the table, so
    // the header is *found*, not assumed to be line 0.
    let mut header_index = None;
    for (index, line) in lines.iter().enumerate() {
        if WingetColumns::from_header(line).is_some() && index + 1 < lines.len() {
            header_index = Some(index);
            break;
        }
    }

    let Some(header_index) = header_index else {
        return Err("无法识别 winget 输出的列结构（可能是本地化格式变化）".into());
    };

    // The layout comes from the header *and* the first data row together: the
    // header gives the columns, the row gives the offsets including its indent.
    // See `WingetColumns::from_table`.
    let data: Vec<&&str> = lines[header_index + 1..]
        .iter()
        .filter(|line| !is_rule(line))
        .collect();

    let Some(first_row) = data.first() else {
        // A table with a header and no rows is a legitimate answer: nothing is
        // installed. Return no rows rather than an error, so the caller can
        // distinguish it from "we could not read the output".
        return Ok(Vec::new());
    };

    let columns = WingetColumns::from_table(lines[header_index], first_row)
        .ok_or_else(|| "winget 表格的首行数据与表头列数不一致".to_string())?;

    Ok(data
        .iter()
        .map(|line| parse_winget_row(line, &columns))
        .collect())
}

fn is_rule(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty() && trimmed.chars().all(|c| c == '-')
}

// ---------------------------------------------------------------------------
// Provider 2 — registry
// ---------------------------------------------------------------------------

/// A parsed `Uninstall` registry entry, before matching.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UninstallEntry {
    pub display_name: String,
    pub display_version: Option<String>,
    /// Raw `InstallLocation`. **Not** a path to a program: vendors put quotes,
    /// environment variables and occasionally an entire uninstall command in
    /// here, so it is never trusted as a filesystem path without validation.
    pub install_location: Option<String>,
    /// Raw `DisplayIcon`, which frequently *is* an executable path.
    pub display_icon: Option<String>,
    /// Registry location, kept so a finding stays auditable in the report.
    pub key: String,
}

/// Reads every `Uninstall` key from both hives and both registry views.
///
/// The `WOW6432Node` (32-bit) view matters: older Git and Python installers still
/// register there, and a scan that only reads the native view silently misses
/// them — after which the app "helpfully" reinstalls them.
pub fn registry_provider(cat: &catalog::Catalog) -> Facts {
    let entries = match uninstall_entries() {
        Ok(entries) => entries,
        Err(reason) => return unavailable_for_all(cat, ProbeSource::Registry, reason),
    };

    cat.ids()
        .map(|id| {
            let entry = cat.entry(id);
            // The whole entry, not just the display name: a name alone is not an
            // identity, and this is where the Codex/`ChatGPT`-web-app false
            // positive is rejected.
            let hit = entries
                .iter()
                .find(|row| entry.matches_registry_entry(row));

            let evidence = match hit {
                Some(row) => {
                    // Prefer the version the vendor registered. If it is absent,
                    // say "unknown" rather than inventing one from the key name.
                    let version = row
                        .display_version
                        .clone()
                        .filter(|v| !v.trim().is_empty())
                        .unwrap_or_else(|| "unknown".to_string());
                    let location = row
                        .install_location
                        .clone()
                        .filter(|v| !v.trim().is_empty())
                        .or_else(|| row.display_icon.as_deref().and_then(icon_to_dir))
                        .unwrap_or_default();
                    Evidence::present(
                        ProbeSource::Registry,
                        format!("{version}|{location}|{}", row.key),
                    )
                }
                None => Evidence::absent(ProbeSource::Registry),
            };

            (id, IndividualFinding { evidence })
        })
        .collect()
}

/// `"C:\Program Files\Git\git-basics.ico",0` → `C:\Program Files\Git`
///
/// The trailing `,0` is an icon index, not part of the path. Keeping it would
/// produce a path that never exists, and the `Path::is_file` check downstream
/// would then silently drop a real install location.
fn icon_to_dir(icon: &str) -> Option<String> {
    let without_index = icon.trim().trim_matches('"').split(',').next()?.trim();
    let path = PathBuf::from(without_index.trim_matches('"'));
    if path.is_absolute() {
        Some(path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// All uninstall entries, from a single PowerShell call.
///
/// One process launch covers four registry locations. Four separate `reg query`
/// calls on a machine with ~200 installed programs is a visible multi-second
/// stall, and this scan sits on the detection path the student waits for.
pub fn uninstall_entries() -> Result<Vec<UninstallEntry>, String> {
    let raw = super::detect::run_capture(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", UNINSTALL_SCRIPT],
    )
    .map_err(|e| format!("无法读取注册表：{e}"))?;
    parse_uninstall_records(&raw)
}

/// Dumps uninstall entries as tab-separated records.
///
/// **The UTF-8 preamble is load-bearing.** Windows PowerShell 5.1 chooses its
/// stdout encoding based on whether stdout is a console or a pipe: with a console
/// it uses the console code page, and with a pipe it uses the OEM code page —
/// 936 (GBK) on a Chinese system. Rust always reads a pipe, so without forcing
/// `[Console]::OutputEncoding` every non-ASCII install path comes back as
/// `??????` after the lossy decode.
///
/// This was a real defect, not a theoretical one: VS Code's install location is
/// `D:\工具软件\Microsoft VS Code`, and the registry evidence line rendered as
/// `D:\??????\Microsoft VS Code` in the evidence panel while the PATH line (which
/// never leaves Rust) was correct. Setting the encoding inside the script is what
/// makes the two agree.
///
/// `SilentlyContinue` is likewise load-bearing rather than cosmetic:
/// `DisplayVersion` is genuinely missing on a number of keys, and without it a
/// single missing property raises `PropertyNotFoundException` and aborts the whole
/// scan — which would be reported as "registry unavailable", i.e. nothing on the
/// machine could be detected at all. Unreadable keys are skipped instead.
///
/// The default output width is deliberately left alone: one record per line with
/// tabs cannot be truncated by a width limit, whereas a `Format-Table`-shaped
/// script would be truncated at 80 columns and silently lose the install location.
const UNINSTALL_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($p in $paths) {
  Get-ItemProperty $p | ForEach-Object {
    if ($_.DisplayName) {
      $name = ([string]$_.DisplayName) -replace "`t", ' '
      $ver  = ([string]$_.DisplayVersion) -replace "`t", ' '
      $loc  = ([string]$_.InstallLocation) -replace "`t", ' '
      $icon = ([string]$_.DisplayIcon) -replace "`t", ' '
      Write-Output ("$name`t$ver`t$loc`t$icon`t" + $_.PSPath)
    }
  }
}
"#;

/// Parses the records emitted by [`UNINSTALL_SCRIPT`].
///
/// Separated from the probe so the registry's awkward cases — an entry with no
/// version, an install location containing spaces, a name with a multi-byte
/// character — are covered by fixtures rather than by hoping a real machine has
/// them.
pub fn parse_uninstall_records(raw: &str) -> Result<Vec<UninstallEntry>, String> {
    let mut out = Vec::new();

    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        // A short record is *skipped*, never guessed at. A truncated line would
        // yield a half-word name, which could then match the wrong program.
        if fields.len() < 5 {
            continue;
        }
        let name = fields[0].trim();
        if name.is_empty() {
            continue;
        }
        out.push(UninstallEntry {
            display_name: name.to_string(),
            display_version: non_empty(Some(fields[1])),
            install_location: non_empty(Some(fields[2])),
            display_icon: non_empty(Some(fields[3])),
            key: fields[4].trim().to_string(),
        });
    }

    if out.is_empty() {
        Err("注册表中没有读到任何已安装程序记录".into())
    } else {
        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// Provider 3 — PATH
// ---------------------------------------------------------------------------

/// Resolves programs by walking `PATH` plus the locations Windows itself
/// consults.
///
/// Three Windows behaviours, each of which causes a real misreport if ignored:
///
/// * **`PATHEXT`** — on disk the program is `git.exe` (or `.cmd`, or `.bat`);
///   looking for a bare `git` finds nothing.
/// * **`App Paths`** — how Chrome-style installers make a program launchable by
///   name from `Win+R` without ever putting it on `PATH`. It is the only correct
///   answer to "can the student type this command", and plain-`PATH` resolution
///   gets VS Code wrong because `bin\code.cmd` is not registered anywhere else.
/// * **The user/machine `PATH` split** — a shell started before an installer ran
///   does not see the new entry. That is why the verifier has a distinct
///   "reopen your terminal" message instead of a bare failure.
pub fn path_provider(cat: &catalog::Catalog) -> Facts {
    let resolved = resolve_paths(cat);

    cat.ids()
        .map(|id| {
            let entry = cat.entry(id);
            let evidence = match resolved.get(&id) {
                Some(path) => {
                    // The version comes from running the binary with the flag the
                    // catalog declares. A binary that exists but cannot report a
                    // version is *still present* — reporting it as absent would
                    // trigger a reinstall of working software — so the version
                    // degrades to "unknown" and presence stands.
                    let version = entry
                        .version_args
                        .as_ref()
                        .and_then(|args| read_version(path, args, entry))
                        .unwrap_or_else(|| "unknown".to_string());                    Evidence::present(
                        ProbeSource::Path,
                        format!("{version}|{}", path.to_string_lossy()),
                    )
                }
                None => Evidence::absent(ProbeSource::Path),
            };
            (id, IndividualFinding { evidence })
        })
        .collect()
}

/// Resolves every catalogued program to an absolute executable path.
///
/// This is a *flat* map with no error case beyond I/O failure, and "found
/// nothing" is `Ok(empty)` rather than `Err`. That matters: an `Err` would be
/// reported as `Unavailable`, which is a weaker claim than the truth. On a fresh
/// machine, "nothing is installed" is a real and useful answer.
pub fn resolve_paths(cat: &catalog::Catalog) -> BTreeMap<SoftwareId, PathBuf> {
    let mut out = BTreeMap::new();
    for id in cat.ids() {
        if let Some(path) = find_executable(cat.entry(id)) {
            out.insert(id, path);
        }
    }
    out
}

/// Search order, from most to least authoritative.
///
/// The nesting puts the *candidate* outermost so preference order across
/// [`CatalogEntry::executables`] is honoured globally rather than per stage. An
/// earlier version exhausted every location for `code.cmd` only after trying every
/// location for `Code.exe`, so VS Code always resolved to the root `Code.exe` even
/// with `bin\code.cmd` listed first and present.
///
/// `PATH` is searched **before** the well-known install roots, which inverts the
/// "roots then PATH" order used previously. The reason is what each one proves:
/// `PATH` answers "can the student type this command", which is the question the
/// verifier and the student actually care about, while a root answer is only
/// "a file exists somewhere". Preferring roots meant VS Code resolved to
/// `Code.exe` in the install root — on no `PATH` — and the app reported
/// `命令行可用: false` on a machine where `code --version` works in any terminal.
///
/// `App Paths` still comes first, because it is the OS's own "launchable by name"
/// table and is authoritative for GUI programs that are not on `PATH` at all.
fn find_executable(entry: &catalog::CatalogEntry) -> Option<PathBuf> {
    let candidates = entry.executables();

    // Shell shims are resolved through `PATH` only. A shim is by definition the
    // thing an installer puts on `PATH`, and `App Paths` never lists one — so
    // consulting `App Paths` first would let an unrelated `Code.exe` registration
    // shadow the `code.cmd` the entry asked for. This is the ordering that makes
    // VS Code resolve to `bin\code.cmd` (runnable, reports a version) instead of
    // the root `Code.exe` (not on `PATH`, prints nothing without its shim).
    for exe in &candidates {
        if is_shim(exe) {
            if let Some(found) = probe_path_dirs(exe) {
                return Some(found);
            }
        }
    }

    for exe in &candidates {
        if !is_shim(exe) {
            if let Some(found) = probe_app_paths(exe) {
                return Some(found);
            }
        }
    }
    for exe in &candidates {
        if !is_shim(exe) {
            if let Some(found) = probe_path_dirs(exe) {
                return Some(found);
            }
        }
    }
    for exe in &candidates {
        if !is_shim(exe) {
            if let Some(found) = probe_well_known_roots(entry, exe) {
                return Some(found);
            }
        }
    }
    None
}

/// Is this candidate a shell shim rather than a real executable?
pub(crate) fn is_shim(exe: &str) -> bool {
    let lower = exe.to_lowercase();
    lower.ends_with(".cmd") || lower.ends_with(".bat")
}

/// `HKLM|HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\<exe>`.
fn probe_app_paths(exe: &str) -> Option<PathBuf> {
    for hive in ["HKLM", "HKCU"] {
        let key =
            format!("{hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{exe}");
        let Ok(text) = super::detect::run_capture("reg", &["query", &key, "/ve"]) else {
            continue;
        };
        for line in text.lines() {
            if !line.contains("REG_SZ") {
                continue;
            }
            let value = line
                .split("REG_SZ")
                .nth(1)
                .map(str::trim)
                .unwrap_or_default()
                .trim_matches('"');
            if value.is_empty() {
                continue;
            }
            let path = PathBuf::from(value);
            // The registered value can point at a stale path from an uninstalled
            // copy. Confirming it exists is the difference between "registered"
            // and "installed".
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

/// `%LOCALAPPDATA%\Programs\<Name>` and `%ProgramFiles%\<Name>` — where
/// per-user installers (VS Code, Claude Desktop, Codex) land.
fn probe_well_known_roots(entry: &catalog::CatalogEntry, exe: &str) -> Option<PathBuf> {
    for var in [
        "LOCALAPPDATA",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
    ] {
        let Ok(base) = std::env::var(var) else {
            continue;
        };
        let base = PathBuf::from(base);
        for sub in entry.install_roots {
            let root = base.join(sub);
            // `.bin` first for the general case; then the root itself. The
            // launcher shim in `bin` is what belongs on PATH, so it wins.
            let in_bin = root.join("bin").join(exe);
            if in_bin.is_file() {
                return Some(in_bin);
            }
            let direct = root.join(exe);
            if direct.is_file() {
                return Some(direct);
            }
        }
    }
    None
}

fn probe_path_dirs(exe: &str) -> Option<PathBuf> {
    search_paths()
        .into_iter()
        .map(|dir| dir.join(exe))
        .find(|candidate| candidate.is_file())
}

/// The directories consulted for "can I type this command?".
fn search_paths() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(path) = std::env::var("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }

    // `%LOCALAPPDATA%\Microsoft\WindowsApps` holds the Store/shim aliases and
    // `Programs` holds every per-user install. Both are on a *new* shell's PATH
    // but frequently not on the one this process inherited.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        dirs.push(local.join("Microsoft").join("WindowsApps"));
        dirs.push(local.join("Programs"));
    }

    dirs.retain(|d| !d.as_os_str().is_empty());
    dirs
}

/// Runs `<exe> <flag>` and returns the first version-looking token in its output.
///
/// The flag comes from the catalog because it is not standardised: `--version`
/// for most, `-v` for some, and `code --version` prints the version on the *first*
/// line with a commit hash and an architecture on the following lines.
///
/// The scan is stricter than "starts with a digit and contains a dot", which was
/// the original rule and produced a real misreport: `code.cmd` launches Electron
/// with `ELECTRON_RUN_AS_NODE=1`, and when spawned from another process Electron
/// emits a diagnostic line before the version. A token taken from
/// `...[2026-09-18T05:59:49.406Z]...` satisfied "starts with a digit and contains a
/// dot" on its `9.406` substring, and that timestamp became VS Code's version.
///
/// Every character of the token must now be part of the version, so a fragment
/// embedded in a longer token can no longer be mistaken for one. The whole token
/// is returned, minus any `-`/`+` suffix, because that is what a user reads off
/// the first line of `--version`.
fn read_version(path: &Path, args: &[&str], entry: &catalog::CatalogEntry) -> Option<String> {
    let program = if entry.version_via_shim {
        // Prefer the shell shim that the vendor ships next to the executable.
        // It carries the environment *and* the CLI script argument that an
        // Electron app needs, which this code cannot reconstruct correctly — see
        // `CatalogEntry::version_via_shim`.
        shim_for(path).unwrap_or_else(|| path.to_path_buf())
    } else {
        path.to_path_buf()
    };

    let mut cmd = std::process::Command::new(&program);
    cmd.args(args);
    for (key, value) in entry.version_env {
        cmd.env(key, value);
    }
    cmd.stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(super::detect::CREATE_NO_WINDOW);
    }

    let output = cmd.output().ok()?;
    // stdout only. Electron and several other tools write progress and warnings to
    // stderr, and mixing the two is how a diagnostic line ends up being read as a
    // version.
    let stdout = super::detect::decode_console_output(&output.stdout);

    for line in stdout.lines() {
        let line = line.trim();
        // A version line is short and contains exactly one token, or starts with
        // the bare version. Anything else is a log line.
        let mut tokens = line.split_whitespace();
        let Some(first) = tokens.next() else { continue };
        if let Some(version) = version_token(first) {
            return Some(version);
        }
    }

    // Some tools print `Program <version>`; accept a version as the second token
    // when the first is clearly a product name.
    for line in stdout.lines() {
        for token in line.split_whitespace().skip(1) {
            if let Some(version) = version_token(token) {
                return Some(version);
            }
        }
    }

    None
}

/// Finds the shell shim that belongs to an executable, if one exists.
///
/// Searched in two places, because vendors do not agree on one:
///
/// * the executable's own directory (`claude.cmd` sits beside the binary), and
/// * a `bin\` subdirectory of it — this is where VS Code keeps `code.cmd` while
///   `Code.exe` lives in the install root. Missing this second location is why an
///   earlier version reported VS Code's version as `unknown`: the shim was never
///   found, the raw `Code.exe` was invoked, and Electron printed nothing.
pub(crate) fn shim_for(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;
    let stem = exe.file_stem()?.to_str()?;

    let mut candidates = Vec::new();
    for base in [dir.to_path_buf(), dir.join("bin")] {
        for ext in ["cmd", "bat"] {
            candidates.push(base.join(format!("{stem}.{ext}")));
        }
    }
    // Match case-insensitively and return the path as it is *spelled on disk*.
    // Testing `is_file()` alone works on NTFS — which ignores case — but returns a
    // path named after the input: `Code.exe` yielded `…\bin\Code.cmd` for a file
    // that is really `code.cmd`. That is wrong on any case-sensitive volume and
    // looks wrong in the evidence panel, which shows this path verbatim.
    for candidate in candidates {
        let Some(name) = candidate.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(parent) = candidate.parent() else {
            continue;
        };
        if let Some(found) = find_in_dir(parent, name) {
            return Some(found);
        }
    }
    None
}

/// Is this whole token a version number?
///
/// Returns the normalised version, or `None` if the token is anything else. The
/// requirement is that **every character** belongs to the version: digits, at
/// most one `.`, and an optional alphanumeric suffix introduced by `-` or `+`.
/// A `v` prefix is stripped.
///
/// This is deliberately exact rather than permissive. The failure mode of a
/// permissive rule is not a missing version — it is a *wrong* version presented
/// as fact, which is worse.
pub(crate) fn version_token(token: &str) -> Option<String> {
    let candidate = token.trim().trim_start_matches(['v', 'V']);
    if candidate.is_empty() {
        return None;
    }

    // Split off a suffix (`-beta.1`, `+build`). Everything before it must be the
    // numeric part.
    let (numeric, suffix) = match candidate.find(['-', '+']) {
        Some(index) => (&candidate[..index], &candidate[index..]),
        None => (candidate, ""),
    };

    if numeric.is_empty() {
        return None;
    }

    let mut parts = numeric.split('.');
    let first = parts.next()?;
    // At least a major.minor, and those two must be purely numeric. This is the
    // part that rejects a timestamp fragment: `9.406` inside
    // `2026-09-18T05:59:49.406Z]` is never reached, because the *whole token* is
    // tested and the leading `2026-09-18T05` fails the numeric check.
    let second = parts.next()?;
    if first.is_empty() || second.is_empty() {
        return None;
    }
    if !first.chars().all(|c| c.is_ascii_digit())
        || !second.chars().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    // Later components may be numeric or a short alphabetic label. Git reports
    // `2.54.0.windows.1` and several tools report `1.2.3-beta`, so requiring every
    // position to be numeric would discard real versions. A component must still
    // be short and alphanumeric-only, which keeps arbitrary prose out.
    if !parts.all(|p| {
        !p.is_empty()
            && p.len() <= 16
            && p.chars().all(|c| c.is_ascii_alphanumeric())
    }) {
        return None;
    }
    // A suffix must be non-empty and start with a letter or digit.
    if !suffix.is_empty()
        && !suffix
            .trim_start_matches(['-', '+'])
            .starts_with(|c: char| c.is_ascii_alphanumeric())
    {
        return None;
    }

    Some(format!("{numeric}{suffix}"))
}

fn unavailable_for_all(cat: &catalog::Catalog, source: ProbeSource, reason: String) -> Facts {
    cat.ids()
        .map(|id| {
            (
                id,
                IndividualFinding {
                    evidence: Evidence::unavailable(source.clone(), reason.clone()),
                },
            )
        })
        .collect()
}

// ---------------------------------------------------------------------------
// ProbeSource helper
// ---------------------------------------------------------------------------

impl ProbeSource {
    /// Chinese label for the UI's evidence list.
    pub fn display_name(&self) -> &'static str {
        match self {
            ProbeSource::Winget => "winget",
            ProbeSource::Registry => "注册表",
            ProbeSource::Path => "PATH",
        }
    }
}

// ---------------------------------------------------------------------------
// Merge — the one place that decides "installed"
// ---------------------------------------------------------------------------

/// Combines provider facts into the inventory the UI renders.
///
/// Pure and total: the same facts always give the same inventory, and there is no
/// path through it that reports a program as installed without at least one
/// provider having positively said so.
///
/// The confidence rules, in order:
///
/// | situation | installed | confidence | reasoning |
/// |---|---|---|---|
/// | ≥1 source found it | yes | `Ok` | positive evidence needs no corroboration to be *true* |
/// | nothing found it, ≥1 source failed | *unknown* | `Unknown` | "couldn't check" ≠ "absent" |
/// | nothing found it, every source concluded | no | `Fail` | a real, actionable finding |
pub fn merge(cat: &catalog::Catalog, table: &EvidenceTable, scanned_at: &str) -> SoftwareInventory {
    let mut items: Vec<SoftwareInfo> = Vec::new();

    for id in cat.ids() {
        let Some(evidence) = table.get(&id) else {
            continue;
        };
        let entry = cat.entry(id);

        let present: Vec<&Evidence> = evidence
            .iter()
            .filter(|e| matches!(e.finding, Finding::Present { .. }))
            .collect();
        let errored: Vec<&Evidence> = evidence
            .iter()
            .filter(|e| matches!(e.finding, Finding::Unavailable { .. }))
            .collect();

        let installed = !present.is_empty();
        let confidence = if installed {
            Confidence::Ok
        } else if !errored.is_empty() {
            // At least one source failed to reach a conclusion. We cannot rule
            // the program out, so this is `Unknown`, not `Fail`.
            //
            // Note this is deliberately *not* `errored.len() == evidence.len()`.
            // A `PATH` walk that found nothing does not cancel a `winget` failure:
            // the PATH walk only proves "no such executable here", which is
            // exactly the evidence a *failed* probe was supposed to supply. Letting
            // a successful-but-negative PATH result downgrade the whole answer to
            // `Fail` would turn "we couldn't read the registry" into "Python is
            // not installed" — the single most damaging misreport this module
            // could produce, and the one the brief's scenario 4 is about.
            Confidence::Unknown
        } else {
            Confidence::Fail
        };

        // Field-level provenance: each value is taken from the source that
        // supplied it. This replaces the old single `detectedVia` field, which
        // had to pick one winner and so could not express "winget says 1.136.2
        // while the binary on PATH reports 1.138.0".
        let version = preferred_version(&present);
        let package_id = field_from(&present, Field::PackageId);

        // The path is *not* resolved by precedence. Only `path` ever reports an
        // executable file; the registry reports a *directory* under
        // `InstallLocation` (and sometimes a stale one), and winget reports
        // nothing at all. So the path is taken from whichever source can produce
        // a file that passes `matches_executable`, scanning in precedence order.
        //
        // Resolving it by precedence — as this originally did — reported VS Code
        // with `path: None` on a machine where `bin\code.cmd` was sitting one
        // entry further down, because the registry's directory won and then
        // failed the `is_file` check.
        let mut path_candidates: Vec<&Evidence> = present
            .iter()
            .filter(|e| matches!(e.source, ProbeSource::Path | ProbeSource::Registry))
            .copied()
            .collect();
        path_candidates.sort_by_key(|e| e.source);

        let confirmed_path = path_candidates.into_iter().find_map(|evidence| {
            let Finding::Present { value } = &evidence.finding else {
                return None;
            };
            let candidate = PathBuf::from(value.split('|').nth(1)?);
            if candidate.is_file() && entry.matches_executable(&candidate) {
                Some((
                    evidence.source.clone(),
                    candidate.to_string_lossy().to_string(),
                ))
            } else {
                None
            }
        });

        let on_path = confirmed_path
            .as_ref()
            .map(|(_, value)| resolves_from_path(value))
            .unwrap_or(false);

        let mut hints: Vec<String> = Vec::new();
        if !installed {
            for e in &errored {
                if let Finding::Unavailable { reason } = &e.finding {
                    hints.push(format!("{}：{reason}", e.source.display_name()));
                }
            }
        }
        if installed && !on_path {
            hints.push(
                "已安装，但当前终端可能无法直接调用。重开一次终端通常即可；若仍无效，需要修复 PATH。"
                    .into(),
            );
        }

        // Sorted by precedence, so `sources.first()` is the strongest evidence —
        // the UI labels the row with it, and `SoftwareScan::items()` maps it to
        // the single `detectedVia` the legacy report format needs.
        let mut ranked_sources: Vec<ProbeSource> =
            present.iter().map(|e| e.source.clone()).collect();
        ranked_sources.sort();

        items.push(SoftwareInfo {
            id,
            name: id.display_name().to_string(),
            installed,
            version: version.map(|(_, v)| v),
            path: confirmed_path.map(|(_, v)| v),
            on_path,
            confidence,
            package_id: package_id.map(|(_, v)| v),
            // Only sources that positively found it are listed. Listing a source
            // that said "absent" would make the UI claim corroboration that does
            // not exist.
            sources: ranked_sources,
            evidence: evidence
                .iter()
                .map(|e| EvidenceView {
                    source: e.source.clone(),
                    outcome: e.outcome().to_string(),
                    detail: e.detail(),
                })
                .collect(),
            hints,
        });
    }

    SoftwareInventory {
        items,
        scanned_at: scanned_at.to_string(),
        providers: provider_names(),
    }
}

/// Which scalar is being extracted from a provider's encoded value.
///
/// There is no `Path` variant: the executable path is not resolved by precedence
/// (see the comment in `merge`), so it never goes through `field_from`.
enum Field {
    Version,
    PackageId,
}

/// Decides which source's version to trust when several disagree.
///
/// The general rule is precedence: [`ProbeSource`] is ordered so that the source
/// carrying the most authoritative metadata wins. But there is one case where
/// that gives a worse answer, and it is not hypothetical — it happened on the
/// machine this was developed on.
///
/// Python's uninstall entry sets `DisplayVersion` to `3.14-64`. That is the
/// *package* tag; the interpreter on PATH reports `3.14.7`. Both strings are
/// syntactically version-shaped (both contain a dot and start with digits), so no
/// parsing rule separates them — a check that rejected `3.14-64` would also have
/// to reject `2.54.0.windows.1`, which is Git's real version.
///
/// The discriminator that *does* work is provenance: a version printed by the
/// program itself came from the binary that will actually run. So when the
/// `path` source has a version, it wins for this one field.
///
/// This is deliberately narrow. It applies only to the version field, only when
/// the `path` source has an answer, and it does not touch the precedence used for
/// the package id or for deciding `installed`.
fn preferred_version(present: &[&Evidence]) -> Option<(ProbeSource, String)> {
    // A version reported by the executable itself is the most trustworthy thing
    // we can have, because it is what the student's `--version` will print.
    if let Some(found) = field_from(
        &present
            .iter()
            .copied()
            .filter(|e| matches!(e.source, ProbeSource::Path))
            .collect::<Vec<_>>(),
        Field::Version,
    ) {
        return Some(found);
    }
    field_from(present, Field::Version)
}
///
/// Sorting by [`ProbeSource`] first is load-bearing, not tidiness. The evidence
/// table arrives in whatever order the providers happened to run, so iterating it
/// directly would resolve a disagreement by *execution order* — a coincidence —
/// while the documented precedence said something else. That is exactly the bug
/// this function had: PATH's `22.9.0` was silently overridden by winget's
/// `24.19.0` because winget happened to be inserted first.
///
/// The per-source encoding is decoded here rather than in the model so that a
/// provider-specific string shape never leaves this file:
///
/// ```text
///  winget    version|package-id|display-name
///  registry  version|install-location|registry-key
///  path      version|absolute-executable-path
/// ```
fn field_from(present: &[&Evidence], field: Field) -> Option<(ProbeSource, String)> {
    let mut ranked: Vec<&&Evidence> = present.iter().collect();
    ranked.sort_by_key(|e| e.source);

    for evidence in ranked {
        let Finding::Present { value } = &evidence.finding else {
            continue;
        };
        let parts: Vec<&str> = value.split('|').collect();
        let candidate = match field {
            Field::Version => parts.first().copied(),
            Field::PackageId => match evidence.source {
                ProbeSource::Winget => parts.get(1).copied(),
                _ => None,
            },
        };
        if let Some(value) = candidate {
            let value = value.trim();
            // An explicit "unknown" is not a value; falling through lets a lower
            // source that *does* know the version supply it. The same applies to a
            // value that is plainly not a version at all (`node`, `latest`), which
            // some vendors write into `DisplayVersion`.
            if value.is_empty() || value == "unknown" {
                continue;
            }
            if matches!(field, Field::Version) && !looks_like_a_version(value) {
                continue;
            }
            return Some((evidence.source.clone(), value.to_string()));
        }
    }
    None
}

/// Does this string plausibly read as a version number?
///
/// A predicate wrapper over [`version_token`], so the two call sites that only
/// need a yes/no answer share one definition of "is this a version" with the code
/// that actually extracts one.
///
/// It is **not** able to reject a build tag such as Python's `3.14-64`: that
/// string has a numeric major and minor exactly like Git's real
/// `2.54.0.windows.1`. Disambiguating those two is a question of *provenance*, not
/// syntax, and is handled by [`preferred_version`]. A false negative here is
/// harmless — it just means the next source's value is tried.
pub(crate) fn looks_like_a_version(value: &str) -> bool {
    version_token(value).is_some()
}

/// Would typing the bare command name in a terminal actually run *this* program?
///
/// Three outcomes, checked from most to least strict:
///
/// 1. the resolved command is the same file (case-insensitively), or
/// 2. the resolved command is a **Store alias / reparse point** that leads to the
///    same program — `python` on this machine resolves to
///    `…\WindowsApps\python.exe`, an app-execution alias, while the registered
///    install is under `C:\Program Files\WindowsApps\…`. These are different files
///    and the same program, and comparing paths reported `命令行可用: false` for a
///    `python` that works perfectly in every terminal, or
/// 3. the resolved command reports the *same version* as the candidate, which is
///    the strongest evidence available when the paths legitimately differ.
///
/// Requiring an exact path match — as this originally did — under-reported
/// usability, which is the more damaging direction: it tells a student to fix
/// something that is not broken.
pub fn resolves_from_path(exe_path: &str) -> bool {
    let candidate = Path::new(exe_path);
    let Some(stem) = candidate.file_stem().and_then(|s| s.to_str()) else {
        return false;
    };

    let mut names = vec![stem.to_string()];
    match std::env::var("PATHEXT") {
        Ok(exts) => {
            for ext in exts.split(';') {
                let ext = ext.trim();
                if !ext.is_empty() {
                    names.push(format!("{stem}{}", ext.to_lowercase()));
                }
            }
        }
        Err(_) => names.extend([
            format!("{stem}.exe"),
            format!("{stem}.cmd"),
            format!("{stem}.bat"),
        ]),
    }

    let mut found_any = false;
    for dir in search_paths() {
        for name in &names {
            let Some(found) = find_in_dir(&dir, name) else {
                continue;
            };
            found_any = true;

            if same_file(&found, candidate) {
                return true;
            }
            // A reparse point (Store alias, symlink) counts: it is a deliberate
            // redirection to the same program.
            if is_reparse_point(&found) {
                return true;
            }
        }
    }

    // Paths differ everywhere, but the name was found. Fall back to comparing the
    // reported version, which is what actually matters to the student. The
    // versions are read with the catalog's own args and env so a shim that needs
    // environment setup is invoked the same way both times.
    if found_any {
        let (args, env) = version_invocation_for(candidate);
        if let (Some(want), Some(Some(got))) = (
            version_of_exe(candidate, args, env),
            names
                .first()
                .map(|n| version_of_exe(Path::new(n), args, env)),
        ) {
            return versions_equal(&want, &got);
        }
    }

    false
}

/// The `--version` invocation the catalog declares for whichever entry matches
/// this executable.
///
/// Returns the slices by value rather than borrowing from the catalog: the
/// `CatalogEntry` fields are `&'static` already, so the catalog itself does not
/// need to outlive the result — which it cannot, since it is built on the stack
/// here.
fn version_invocation_for(
    path: &Path,
) -> (
    &'static [&'static str],
    &'static [(&'static str, &'static str)],
) {
    let cat = catalog::Catalog::builtin();
    for id in cat.ids() {
        let entry = cat.entry(id);
        if entry.matches_executable(path) {
            // Both fields are `&'static`, so copying them out ends the borrow of
            // `cat` and the catalog can be dropped.
            let args: &'static [&'static str] = entry.version_args.unwrap_or(&["--version"]);
            let env: &'static [(&'static str, &'static str)] = entry.version_env;
            return (args, env);
        }
    }
    (&["--version"], &[])
}

/// Runs `<program> --version` and returns the parsed version, if any.
///
/// `args` and `env` come from the catalog entry so a shim that needs environment
/// setup (VS Code's `ELECTRON_RUN_AS_NODE`) is invoked correctly. Empty means the
/// default `--version`.
fn version_of_exe(
    program: &Path,
    args: &[&str],
    env: &[(&str, &str)],
) -> Option<String> {
    let effective: &[&str] = if args.is_empty() { &["--version"] } else { args };

    let mut cmd = std::process::Command::new(program);
    cmd.args(effective);
    for (key, value) in env {
        cmd.env(key, value);
    }
    cmd.stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(super::detect::CREATE_NO_WINDOW);
    }

    let output = cmd.output().ok()?;
    let stdout = super::detect::decode_console_output(&output.stdout);
    stdout
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .find_map(version_token)
}

fn versions_equal(a: &str, b: &str) -> bool {
    a.split(['-', '+']).next() == b.split(['-', '+']).next()
}

/// Is this file a reparse point (Store app-execution alias, symlink, junction)?
///
/// Used to recognise the `WindowsApps` aliases, which are how the Microsoft Store
/// and the Python Manager expose a command without placing a real executable on
/// `PATH`.
pub(crate) fn is_reparse_point(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    std::fs::symlink_metadata(path)
        .map(|m| m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        .unwrap_or(false)
}

pub(crate) fn find_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if direct.is_file() {
        // Return the path as spelled **on disk**, not as constructed.
        //
        // `is_file()` on NTFS succeeds for any casing, so this fast path used to
        // return e.g. `…\bin\Code.cmd` for a file genuinely named `code.cmd`. The
        // caller shows this path to the student, so the casing is user-visible
        // output, not an internal detail. The directory scan below is the same
        // `read_dir` cost either way, so there is nothing to save by trusting the
        // constructed name.
        if let Some(on_disk) = read_dir_case_insensitive(dir, name) {
            return Some(on_disk);
        }
        return Some(direct);
    }
    read_dir_case_insensitive(dir, name)
}

/// Finds `name` inside `dir`, returning the path spelled as the filesystem has it.
fn read_dir_case_insensitive(dir: &Path, name: &str) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(name)
        })
        .map(|entry| entry.path())
}

fn same_file(a: &Path, b: &Path) -> bool {
    // `fs::canonicalize` would resolve 8.3 short names and junctions, but it also
    // fails on paths that exist only as registry values. Case-insensitive string
    // comparison is the conservative choice: it can miss a genuinely identical
    // file spelled two ways, which under-reports `on_path` rather than
    // over-reporting it.
    a.to_string_lossy()
        .trim_end_matches('\\')
        .eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches('\\'))
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Runs every provider over `ids` and merges the results.
///
/// Providers are independent by construction, so a provider that fails degrades
/// exactly one source of evidence and nothing else.
pub fn scan(cat: &catalog::Catalog, ids: &[SoftwareId]) -> SoftwareInventory {
    let subset = cat.subset(ids);
    let mut table: EvidenceTable = BTreeMap::new();

    for provider in providers() {
        for (id, finding) in provider(&subset) {
            table.entry(id).or_default().push(finding.evidence);
        }
    }

    merge(&subset, &table, &super::detect::now_iso8601())
}
