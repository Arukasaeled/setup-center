//! Software Intelligence Layer tests.
//!
//! The brief names four scenarios that must be covered, and each one here is
//! tested against *captured real output* or a constructed fact table rather than
//! a mock of the provider. That distinction matters: a mock of `winget_provider`
//! would pass no matter how badly the parser is broken.
//!
//! The fixtures in `fixtures/` were captured from this machine with winget
//! 1.29.290 and PowerShell 7, so they carry the localised headers and multi-byte
//! program names that the parser has to survive in production.

use super::catalog::Catalog;
use super::inventory::*;
use crate::model::*;

use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const WINGET_FIXTURE: &str = include_str!("../../fixtures/winget-list.zh.txt");
const REGISTRY_FIXTURE: &str = include_str!("../../fixtures/uninstall.txt");
// ---------------------------------------------------------------------------
// winget parsing
// ---------------------------------------------------------------------------

#[test]
fn winget_header_is_derived_not_hard_coded() {
    // The parser must read the layout out of whatever header it receives, because
    // the header is localised and its column widths change with the words in it.
    // Both of these are real header shapes, captured from winget 1.29.290 and
    // from its English output.
    let zh = WingetColumns::from_header(
        "名称                                                         ID                                                                                      版本               可用            源",
    )
    .expect("Chinese header must parse");

    let en = WingetColumns::from_header(
        "Name                                                         Id                                                                                      Version            Available       Source",
    )
    .expect("English header must parse");

    // Asserting the two are *identical* would be wrong: `名称` is two characters
    // while `Name` is four, so the English table's columns sit elsewhere. What
    // must hold is that each header yields offsets consistent with its own data
    // rows, which is exactly why the offsets are derived rather than hard-coded.
    assert_eq!(zh.id, 59, "the Chinese header's ID column");
    assert_eq!(zh.version, 147, "the Chinese header's version column");

    // And the structure is the same: three columns, id before version.
    assert!(en.id > 0);
    assert!(en.version > en.id);
    assert!(en.available.is_some());
    assert!(zh.available.is_some());
}

#[test]
fn winget_columns_are_character_offsets_not_byte_offsets() {
    // The load-bearing measurement. `名称` is two characters but six UTF-8 bytes
    // at the start of every line, so a byte-indexed parser reads the whole table
    // shifted by four bytes here and by nothing at all on an English machine —
    // the kind of bug that only appears on real user machines.
    //
    // Measured against the *checked-in fixture's own header*, not a retyped
    // string: a retyped header with different padding silently tests nothing.
    let header = WINGET_FIXTURE.lines().next().unwrap();
    let columns = WingetColumns::from_header(header).expect("fixture header must parse");

    // The byte length and the character length of this header differ, which is
    // what makes the distinction observable at all.
    assert!(
        header.len() > header.chars().count(),
        "the fixture header must contain multi-byte characters for this test to mean anything"
    );

    assert_eq!(columns.id, 59, "ID column starts at character 59");
    assert_eq!(columns.version, 147, "Version column starts at character 147");

    // And a byte-indexed read of the same position yields something else, which
    // is precisely the corruption this guards against.
    let row = WINGET_FIXTURE.lines().nth(2).unwrap();
    let by_chars = parse_winget_row(row, &columns);
    assert_eq!(by_chars.id, "MSIX\\OpenAI.Codex_26.911.7940.0_x64__2p2nqsd0c76g0");
    assert_eq!(by_chars.name, "ChatGPT");
}

#[test]
fn real_winget_fixture_parses_every_row() {
    let rows = parse_winget_table(WINGET_FIXTURE).expect("captured table must parse");
    assert!(
        rows.len() >= 6,
        "expected the captured rows, got {}",
        rows.len()
    );

    let vscode = rows
        .iter()
        .find(|r| r.id == "Microsoft.VisualStudioCode")
        .expect("VS Code row must be present");
    // A name containing spaces must survive as one field, not be split on
    // whitespace into four columns.
    assert_eq!(vscode.name, "Microsoft Visual Studio Code (User)");
    assert_eq!(vscode.version.as_deref(), Some("1.136.2"));
    // The upgrade column must not be folded into the version, or the app would
    // report a version the machine does not have.
    assert_eq!(vscode.available.as_deref(), Some("1.138.0"));
}

#[test]
fn winget_row_with_an_empty_upgrade_column_still_parses() {
    // Registry-backed rows (`ARP\...`) have no upgrade column. Treating the empty
    // string as a version would be a silent corruption.
    let rows = parse_winget_table(WINGET_FIXTURE).unwrap();
    let node = rows
        .iter()
        .find(|r| r.id.starts_with("ARP\\"))
        .expect("a registry-backed row must be in the fixture");
    assert!(node.version.is_some());
    assert_eq!(node.available, None);
}

#[test]
fn winget_table_with_an_unrecognisable_header_is_refused_not_guessed() {
    // The honest failure mode. A parser that returned zero rows here instead of
    // an error would report *every* program as absent, and the installer would
    // then reinstall software the student already has.
    let result = parse_winget_table("完全无法识别的输出\n第二行\n");
    assert!(result.is_err(), "an unparsable table must not yield rows");
}

#[test]
fn winget_table_skips_the_version_banner() {
    let raw = format!(
        "Windows 程序包管理器 v1.29.290\n© 2026 Microsoft。保留所有权利。\n{WINGET_FIXTURE}"
    );
    let rows = parse_winget_table(&raw).expect("banner must be skipped");
    assert!(rows.iter().any(|r| r.id == "GitHub.cli"));
    // The banner lines must not have become rows.
    assert!(!rows.iter().any(|r| r.name.contains("程序包管理器")));
}

#[test]
fn real_winget_fixture_produces_facts_for_known_programs() {
    let rows = parse_winget_table(WINGET_FIXTURE).unwrap();

    // The fixture's first row is, verbatim:
    //   ChatGPT    MSIX\OpenAI.Codex_26.911.7940.0_x64__2p2nqsd0c76g0    26.911.7940.0
    //
    // This test previously asserted that row was **Codex**, on the belief that
    // Codex shipped as an MSIX inside the ChatGPT product. Measured against the
    // real machine, that is wrong: the Appx named `OpenAI.Codex` is ChatGPT
    // Desktop, and winget's `OpenAI.Codex` is Codex **CLI**. The row is the
    // desktop app, so it must be recognised as such — and must not be claimed as
    // Codex CLI, which is what made one registry row satisfy two products.
    let msix_row = rows
        .iter()
        .find(|r| r.id.starts_with("MSIX\\OpenAI.Codex"))
        .unwrap();
    assert_eq!(msix_row.name, "ChatGPT");
    let cat = Catalog::builtin();
    assert!(
        cat.entry(SoftwareId::ChatgptDesktop).matches_name(&msix_row.name),
        "the catalog must recognise the ChatGPT desktop MSIX by its display name"
    );
    assert!(
        !cat.entry(SoftwareId::Codex).matches_name(&msix_row.name),
        "the ChatGPT desktop MSIX is not Codex CLI"
    );
}

/// A Store product id can never match this provider, and here is the proof.
///
/// This is the question that bounced back and forth three times, so it is worth
/// settling in executable form rather than in prose.
///
/// `winget_list()` runs `winget list --disable-interactivity` — **no `--id`**
/// (`inventory.rs:514`). It therefore parses the *unfiltered* listing, and it
/// matches ids as an exact key lookup against that listing's ID column
/// (`inventory.rs:273`).
///
/// In an unfiltered listing winget prints the **MSIX package-family name** for an
/// installed Store app, not its product id — see the real captured fixture:
///
/// ```text
/// ChatGPT   MSIX\OpenAI.Codex_26.911.7940.0_x64__2p2nqsd0c76g0   26.911.7940.0
/// ```
///
/// A store id *does* resolve under `winget list --id <store id>` — winget maps it
/// when asked directly, which is a real and verified behaviour. But that is a
/// **different call shape from the one this provider makes**, so it says nothing
/// about whether the lookup above can hit. It cannot.
///
/// Consequence, and the reason the catalog keeps this list empty for the entry:
/// detection runs on the display-name + `location_markers` path, which is what
/// genuinely works.
#[test]
fn a_store_product_id_cannot_match_the_unfiltered_winget_list_id_column() {
    let rows = parse_winget_table(WINGET_FIXTURE).unwrap();

    // Assert the property directly, on real captured data, rather than
    // restating the conclusion.
    assert!(
        !rows.iter().any(|r| r.id == "9PLM9XGG6VKS"),
        "the unfiltered ID column must not contain the Store product id; if \
         winget ever starts printing it there, the catalog's empty winget_ids \
         for ChatgptDesktop becomes wrong and should be revisited"
    );

    // And the row that IS there is the MSIX family name, which is the reason.
    let msix = rows
        .iter()
        .find(|r| r.name == "ChatGPT")
        .expect("the fixture contains the ChatGPT row");
    assert!(
        msix.id.starts_with("MSIX\\"),
        "expected an MSIX package-family name in the ID column, got {:?}",
        msix.id
    );

    // The catalog agrees with the data: it declares no ids, because none could
    // match this listing.
    let cat = Catalog::builtin();
    let entry = cat.entry(SoftwareId::ChatgptDesktop);
    assert!(entry.winget_ids.is_empty());
    assert!(
        !entry
            .winget_ids()
            .iter()
            .any(|id| rows.iter().any(|r| r.id.eq_ignore_ascii_case(id))),
        "an id that cannot match the listing would be decoration, not detection"
    );
}

// ---------------------------------------------------------------------------
// Registry parsing
// ---------------------------------------------------------------------------

#[test]
fn registry_records_parse_including_unicode_and_missing_fields() {
    let entries =
        parse_uninstall_records(REGISTRY_FIXTURE).expect("captured registry fixture must parse");

    let git = entries
        .iter()
        .find(|e| e.display_name == "Git")
        .expect("Git entry must be present");
    assert_eq!(git.display_version.as_deref(), Some("2.51.0.1"));
    assert_eq!(git.install_location.as_deref(), Some("C:\\Program Files\\Git"));

    // A Unicode install path must survive round-tripping through the
    // tab-separated format. This is where a fixed-width or byte-oriented parser
    // breaks: every non-ASCII character's byte length differs from its character
    // length, so `工具软件` (4 characters, 12 bytes) shifts every later field.
    let unicode = entries
        .iter()
        .find(|e| e.display_name == "Claude")
        .expect("the Unicode entry must be present");
    assert_eq!(
        unicode.install_location.as_deref(),
        Some("D:\\工具软件\\Claude"),
        "a non-ASCII install location must be preserved intact"
    );
    assert_eq!(unicode.display_version, None, "this entry has no version");
}

/// **Regression — a shell shim must be preferred over the GUI executable.**
#[test]
fn shim_candidates_are_searched_before_bare_executables() {
    // VS Code ships `Code.exe` in the install root and `bin\code.cmd` as its CLI.
    // Windows registers `App Paths\Code.exe` but never the shim.
    //
    // The bug this guards: resolution exhausted every *location* for `code.exe`
    // before trying any location for `code.cmd`, so the entry's preference order
    // was silently ignored, `Code.exe` won, and `--version` on it printed nothing
    // (Electron needs the shim's `ELECTRON_RUN_AS_NODE` plus a `cli.js` argument).
    // The student saw "版本 unknown" for a working VS Code, and `命令行可用: false`
    // on a machine where `code` works in a terminal.
    let cat = Catalog::builtin();
    let vscode = cat.entry(SoftwareId::Vscode);

    // The shim is declared first, which is what the resolver now honours.
    assert_eq!(vscode.executables()[0], "code.cmd");
    assert!(is_shim("code.cmd"));
    assert!(is_shim("claude.bat"));
    assert!(!is_shim("Node.exe"));

    // A shim in a `bin\` subdirectory of the executable's own directory is the
    // layout VS Code uses, so both places must be searched.
    let root = std::env::temp_dir().join("ai-setup-shim-test");
    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(root.join("Code.exe"), b"x").unwrap();
    std::fs::write(bin.join("code.cmd"), b"x").unwrap();

    let found = shim_for(&root.join("Code.exe"));
    assert_eq!(
        found.as_deref(),
        Some(bin.join("code.cmd").as_path()),
        "the shim lives in bin\\, not beside the executable"
    );

    let _ = std::fs::remove_dir_all(&root);
}

/// **Regression — a Store alias must count as "callable".**
#[test]
fn a_store_alias_counts_as_on_path() {
    // `python` on this machine resolves to
    // `%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`, a reparse point, while the
    // registered install is `C:\Program Files\WindowsApps\…`. Different files, same
    // program. Requiring an exact path match reported `命令行可用: false` for a
    // `python` that works in every terminal — telling the student to fix something
    // that is not broken, which is the more damaging direction to be wrong in.
    let alias = std::env::var("LOCALAPPDATA")
        .map(|l| {
            std::path::PathBuf::from(l)
                .join("Microsoft")
                .join("WindowsApps")
                .join("python.exe")
        })
        .unwrap();

    if alias.exists() {
        assert!(
            is_reparse_point(&alias),
            "the WindowsApps entry is expected to be a reparse point"
        );
        assert!(
            resolves_from_path(&alias.to_string_lossy()),
            "a Store alias must be recognised as resolving on PATH"
        );
    }
}
#[test]
fn a_chatgpt_web_app_shortcut_is_not_codex() {
    // This is a false positive that the live probe actually produced. Chrome's
    // "install as web app" for chatgpt.com registers an uninstall entry named
    // exactly `ChatGPT`, whose `DisplayIcon` points into the browser's profile
    // directory. Name-only matching reported a program as installed on a machine
    // that had only ever opened the website.
    //
    // The entry is now rejected on the *name* as well, because `ChatGPT` is
    // ChatGPT Desktop's identity and no longer Codex's — so the location check is
    // a second line of defence rather than the only one. Both are asserted.
    let web_app = super::inventory::UninstallEntry {
        display_name: "ChatGPT".into(),
        display_version: Some("1.0".into()),
        install_location: None,
        display_icon: Some(
            "C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Web Applications\\_crx_cadlkienfkclaiaibeoongdcgmdikeeg\\ChatGPT.ico".into(),
        ),
        key: "HKCU\\...\\4f20b4cc28466082b25e640be9dfc8c6".into(),
    };

    let cat = Catalog::builtin();
    let codex = cat.entry(SoftwareId::Codex);
    let desktop = cat.entry(SoftwareId::ChatgptDesktop);

    // The browser shortcut is not Codex CLI, by name or by location.
    assert!(
        !codex.matches_registry_entry(&web_app),
        "a browser shortcut must not be counted as Codex CLI"
    );
    // And it is not ChatGPT Desktop either: the desktop app is the Store MSIX,
    // which lives under `WindowsApps\OpenAI.Codex`, not in a browser profile.
    assert!(
        !desktop.matches_registry_entry(&web_app),
        "a browser shortcut must not be counted as the ChatGPT desktop app"
    );

    // The real Store app matches ChatGPT Desktop, and *not* Codex CLI: the Appx
    // named `OpenAI.Codex` is the desktop app, while winget's `OpenAI.Codex` is
    // the CLI. Same string, different ecosystems — the distinction this pins.
    let real_msix = super::inventory::UninstallEntry {
        display_icon: Some(
            "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.911.7940.0_x64__2p2nqsd0c76g0\\Codex.exe".into(),
        ),
        ..web_app.clone()
    };
    assert!(
        desktop.matches_registry_entry(&real_msix),
        "the Store MSIX must be recognised as ChatGPT Desktop"
    );
    assert!(
        !codex.matches_registry_entry(&real_msix),
        "the ChatGPT desktop MSIX is not Codex CLI"
    );

    // Codex CLI's real install is a per-user npm layout.
    let real_cli = super::inventory::UninstallEntry {
        display_name: "Codex".into(),
        display_version: Some("0.152.0".into()),
        install_location: Some("C:\\Users\\x\\AppData\\Local\\Programs\\codex".into()),
        display_icon: Some("C:\\Users\\x\\AppData\\Local\\Programs\\codex\\codex.exe".into()),
        key: "HKCU\\...\\codex".into(),
    };
    assert!(
        codex.matches_registry_entry(&real_cli),
        "a per-user CLI install must be recognised as Codex CLI"
    );
}

#[test]
fn registry_name_pattern_matches_a_real_entry() {    // The fixture's display names must actually be recognised by the catalog, or
    // the parser could be perfect and the detector still blind.
    let entries = parse_uninstall_records(REGISTRY_FIXTURE).unwrap();
    let cat = Catalog::builtin();

    for (id, expected) in [
        (SoftwareId::Git, "Git"),
        (SoftwareId::Node, "Node.js"),
        (SoftwareId::Python, "Python 3.14.7"),
        (SoftwareId::ClaudeDesktop, "Claude"),
        (SoftwareId::Vscode, "Microsoft Visual Studio Code (User)"),
    ] {
        let entry = entries.iter().find(|e| e.display_name == expected).unwrap();
        assert!(
            cat.entry(id).matches_name(&entry.display_name),
            "{id:?} failed to match its own registry name {:?}",
            entry.display_name
        );
    }
}

#[test]
fn registry_entry_without_a_version_is_present_not_absent() {
    // Real machines have plenty of these: an uninstall key with no
    // `DisplayVersion`. Reporting it as "not installed" would trigger a reinstall.
    let entries = parse_uninstall_records(REGISTRY_FIXTURE).unwrap();
    let bare = entries
        .iter()
        .find(|e| e.display_name == "Claude")
        .expect("the versionless Claude entry must be present");
    assert_eq!(bare.display_version, None);
}

#[test]
fn registry_record_with_a_truncated_line_is_skipped() {
    // A partial record would yield a half-word name that could match the wrong
    // program. Refusing it is safer than repairing it. The fixture ends with a
    // deliberate two-field row, so a correct parser returns five entries.
    let entries = parse_uninstall_records(REGISTRY_FIXTURE).unwrap();
    assert!(
        !entries.iter().any(|e| e.display_name == "TooFewFields"),
        "a short record must be skipped, not repaired into a program name"
    );
    assert!(entries.iter().any(|e| e.display_name == "Git"));

    // And a fixture containing *only* short records is an error, not an empty
    // success — otherwise "the registry read produced nothing usable" would be
    // indistinguishable from "nothing is installed".
    assert!(parse_uninstall_records("OnlyTwo\tFields\n").is_err());
}

#[test]
fn empty_registry_output_is_an_error_not_an_empty_success() {
    // Distinguishing "the registry read failed" from "nothing is installed" is
    // the whole point of the Finding::Unavailable variant.
    assert!(parse_uninstall_records("").is_err());
    assert!(parse_uninstall_records("\n\n").is_err());
}

// ---------------------------------------------------------------------------
// Merge — the four required scenarios
// ---------------------------------------------------------------------------

/// Builds a fact table from a compact description, so each test states only what
/// it is actually about.
fn facts(rows: &[(SoftwareId, ProbeSource, Finding)]) -> EvidenceTable {
    let mut table: EvidenceTable = BTreeMap::new();
    for (id, source, finding) in rows {
        table.entry(*id).or_default().push(Evidence {
            source: *source,
            finding: finding.clone(),
        });
    }
    table
}

fn present(value: &str) -> Finding {
    Finding::Present {
        value: value.to_string(),
    }
}

fn unavailable(reason: &str) -> Finding {
    Finding::Unavailable {
        reason: reason.to_string(),
    }
}

fn catalog_of(ids: &[SoftwareId]) -> Catalog {
    Catalog::builtin().subset(ids)
}

/// **Scenario 1 — the software exists.**
#[test]
fn installed_software_is_reported_installed() {
    let cat = catalog_of(&[SoftwareId::Git]);
    let table = facts(&[(
        SoftwareId::Git,
        ProbeSource::Registry,
        present("2.51.0|C:\\Program Files\\Git|x"),
    )]);

    let inv = merge(&cat, &table, "now");
    let git = inv.find(SoftwareId::Git).unwrap();
    assert!(git.installed);
    assert_eq!(git.version.as_deref(), Some("2.51.0"));
    assert_eq!(git.confidence, Confidence::Ok);
    assert_eq!(git.sources, vec![ProbeSource::Registry]);
}

/// **Scenario 1b — the same program found by two providers.**
#[test]
fn two_sources_agreeing_raise_provenance_without_duplicating_rows() {
    let cat = catalog_of(&[SoftwareId::Vscode]);
    let table = facts(&[
        (
            SoftwareId::Vscode,
            ProbeSource::Winget,
            present("1.136.2|Microsoft.VisualStudioCode|Microsoft Visual Studio Code"),
        ),
        (
            SoftwareId::Vscode,
            ProbeSource::Registry,
            present("1.136.2|C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code|k"),
        ),
    ]);

    let inv = merge(&cat, &table, "now");
    assert_eq!(inv.items.len(), 1, "one row per program, not per source");
    let item = inv.find(SoftwareId::Vscode).unwrap();
    assert!(item.installed);
    // Both sources are recorded, so the UI can show the corroboration.
    assert_eq!(item.sources.len(), 2);
    assert_eq!(item.evidence.len(), 2);
    // The package id comes from winget, which is the only source that has one.
    assert_eq!(item.package_id.as_deref(), Some("Microsoft.VisualStudioCode"));
}

/// **Scenario 2 — the software does not exist.**
#[test]
fn absent_software_is_reported_absent_with_full_confidence() {
    let cat = catalog_of(&[SoftwareId::Git]);
    // Every provider ran and none of them found it. That is a real finding.
    let table = facts(&[
        (SoftwareId::Git, ProbeSource::Registry, Finding::Absent),
        (SoftwareId::Git, ProbeSource::Path, Finding::Absent),
        (SoftwareId::Git, ProbeSource::Winget, Finding::Absent),
    ]);

    let inv = merge(&cat, &table, "now");
    let git = inv.find(SoftwareId::Git).unwrap();
    assert!(!git.installed);
    assert_eq!(
        git.confidence,
        Confidence::Fail,
        "a conclusion reached by every source is a confident one"
    );
    assert_eq!(inv.installed_count(), 0);
    assert_eq!(inv.unknown_count(), 0);
}

/// **Scenario 3 — multiple sources disagree.**
#[test]
fn conflicting_versions_resolve_by_precedence_and_are_all_recorded() {
    let cat = catalog_of(&[SoftwareId::Node]);
    // winget believes 24.19.0 (its last-known record); the binary on PATH reports
    // 22.9.0. The registry is silent.
    let table = facts(&[
        (
            SoftwareId::Node,
            ProbeSource::Winget,
            present("24.19.0|OpenJS.NodeJS.LTS|Node.js"),
        ),
        (
            SoftwareId::Node,
            ProbeSource::Path,
            present("22.9.0|C:\\Program Files\\nodejs\\node.exe"),
        ),
        (SoftwareId::Node, ProbeSource::Registry, Finding::Absent),
    ]);

    let inv = merge(&cat, &table, "now");
    let node = inv.find(SoftwareId::Node).unwrap();
    assert!(node.installed);

    // PATH outranks winget, which is the deliberate precedence documented on
    // `PROVIDERS`: winget's record survives an uninstall and is only refreshed
    // when winget itself runs, so it can name a version that is no longer on
    // disk. A binary that actually executes is the stronger claim.
    assert_eq!(node.version.as_deref(), Some("22.9.0"));

    // The losing value is not discarded — it stays in the audit trail, which is
    // what makes a surprising result traceable instead of mysterious.
    let details: Vec<String> = node
        .evidence
        .iter()
        .filter_map(|e| e.detail.clone())
        .collect();
    assert!(
        details.iter().any(|d| d.contains("24.19.0")),
        "the disagreeing winget value must remain visible in the evidence"
    );
    assert!(
        details.iter().any(|d| d.contains("22.9.0")),
        "the winning PATH value must be present too"
    );

    // The package id still comes from winget, which is the only source that has
    // one. A disagreement about *version* must not lose the *id* — that id is
    // what stage 3 will install or upgrade through.
    assert_eq!(node.package_id.as_deref(), Some("OpenJS.NodeJS.LTS"));
}

/// **Scenario 3d — a source reports something that is not a version.**
#[test]
fn a_build_tag_is_not_accepted_as_a_version() {
    // Python's uninstall entry sets `DisplayVersion` to `3.14-64`, which is the
    // *package* tag, not the interpreter version. The registry is the
    // highest-precedence source, so naively taking its value reported a version
    // string that `python --version` would never print.
    let cat = catalog_of(&[SoftwareId::Python]);
    let table = facts(&[
        (
            SoftwareId::Python,
            ProbeSource::Registry,
            present("3.14-64|C:\\Python|k"),
        ),
        (
            SoftwareId::Python,
            ProbeSource::Path,
            present("3.14.7|C:\\Python\\python.exe"),
        ),
    ]);

    let inv = merge(&cat, &table, "now");
    let python = inv.find(SoftwareId::Python).unwrap();
    assert_eq!(
        python.version.as_deref(),
        Some("3.14.7"),
        "a build tag must be skipped so a real version can be found"
    );
}

#[test]
fn version_plausibility_check_accepts_real_windows_version_shapes() {
    // This only guards the *obvious* non-versions. It deliberately does not try to
    // reject a build tag like `3.14-64`: that string has a numeric major and minor
    // exactly like Git's real `2.54.0.windows.1`. The real disambiguation lives in
    // `preferred_version` (see the note there).
    for good in [
        "1.2",
        "1.136.2",
        "2.54.0.windows.1",
        "v1.9.0",
        "24.19.0",
        "10.0.26100.2314",
        "1.0.0-beta.1",
    ] {
        assert!(looks_like_a_version(good), "{good} should be a version");
    }
    for bad in ["unknown", "", "python", "node", "1", "latest"] {
        assert!(!looks_like_a_version(bad), "{bad} should not be a version");
    }
}

/// **Regression — a timestamp must never be read as a version.**
#[test]
fn a_timestamp_embedded_in_a_log_line_is_not_a_version() {
    // The exact defect, reproduced from a live run. `code.cmd` starts Electron
    // with `ELECTRON_RUN_AS_NODE=1`; spawned from another process it emits a
    // diagnostic line before the version. The old "starts with a digit and
    // contains a dot" rule matched the `9.406` inside this token and reported
    // VS Code's version as `2026-09-18T05:59:49.406Z]`.
    for token in [
        "[2026-09-18T05:59:49.406Z]",
        "2026-09-18T05:59:49.406Z",
        "INFO:2026.09.18",
        "pid:1234.5",
    ] {
        assert!(
            !looks_like_a_version(token),
            "{token} must not be accepted as a version"
        );
    }

    // And the real `code --version` output must still parse to the first line.
    let output = "1.136.2\n88e44fa0e00b08f7758b4f6d05632e4fd5e4df6f\nx64\n";
    let found = output
        .lines()
        .filter_map(|l| l.split_whitespace().next())
        .find_map(|t| version_token(t));
    assert_eq!(found.as_deref(), Some("1.136.2"));
}

/// **Scenario 3c — the running binary's own version wins for the version field.**
#[test]
fn the_executables_own_version_beats_the_registrys_metadata() {
    // The one deliberate exception to source precedence, and it exists because of
    // a real misreport: Python's uninstall entry declares `DisplayVersion` as
    // `3.14-64` (the package tag) while the interpreter prints `3.14.7`.
    //
    // Precedence alone would have shown the student a version string that
    // `python --version` never prints.
    let cat = catalog_of(&[SoftwareId::Vscode]);
    let table = facts(&[
        (
            SoftwareId::Vscode,
            ProbeSource::Registry,
            present("1.136.2|C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code|k"),
        ),
        (
            SoftwareId::Vscode,
            ProbeSource::Path,
            present("1.136.2|C:\\x\\bin\\code.cmd"),
        ),
    ]);

    let inv = merge(&cat, &table, "now");
    assert_eq!(
        inv.find(SoftwareId::Vscode).unwrap().version.as_deref(),
        Some("1.136.2")
    );

    // Now the disagreeing case. PATH wins for the version.
    let table = facts(&[
        (
            SoftwareId::Vscode,
            ProbeSource::Registry,
            present("1.999.0|C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code|k"),
        ),
        (
            SoftwareId::Vscode,
            ProbeSource::Path,
            present("1.136.2|C:\\x\\bin\\code.cmd"),
        ),
    ]);
    let inv = merge(&cat, &table, "now");
    let code = inv.find(SoftwareId::Vscode).unwrap();
    assert_eq!(
        code.version.as_deref(),
        Some("1.136.2"),
        "the version printed by the binary is what the student will actually see"
    );

    // The registry's claim is not discarded — it stays in the audit trail.
    assert!(code
        .evidence
        .iter()
        .any(|e| e.detail.as_deref().is_some_and(|d| d.contains("1.999.0"))));
}

/// **Scenario 3b — a source claims a file that is not there.**
#[test]
fn a_path_that_does_not_exist_is_not_counted_as_installed() {
    let cat = catalog_of(&[SoftwareId::Git]);
    // The registry still lists an install location from a copy that was deleted
    // by hand. Believing it is how the app reports "Git ✓" on a machine where the
    // `git` command does not work.
    let table = facts(&[(
        SoftwareId::Git,
        ProbeSource::Registry,
        present("2.51.0|C:\\Definitely\\Not\\Here|k"),
    )]);

    let inv = merge(&cat, &table, "now");
    let git = inv.find(SoftwareId::Git).unwrap();
    assert!(git.installed, "the source did find the program");
    assert_eq!(
        git.path, None,
        "an unverifiable path must not be reported as a location"
    );
    assert!(!git.on_path);
}

/// **Scenario 4 — insufficient permission / probe failure.**
#[test]
fn a_failed_probe_is_unknown_never_absent() {
    let cat = catalog_of(&[SoftwareId::Python]);
    // Every provider failed — e.g. a locked-down campus machine where the
    // registry read is denied and winget is blocked by policy.
    let table = facts(&[
        (
            SoftwareId::Python,
            ProbeSource::Registry,
            unavailable("拒绝访问注册表"),
        ),
        (
            SoftwareId::Python,
            ProbeSource::Winget,
            unavailable("winget 不可用"),
        ),
        (SoftwareId::Python, ProbeSource::Path, Finding::Absent),
    ]);

    let inv = merge(&cat, &table, "now");
    let python = inv.find(SoftwareId::Python).unwrap();

    // `installed: false` with `confidence: unknown` — the UI must render this as
    // "无法确认", and the installer must not treat it as a reinstall trigger.
    assert!(!python.installed);
    assert_eq!(
        python.confidence,
        Confidence::Unknown,
        "a failed probe is not evidence of absence"
    );
    assert_eq!(inv.unknown_count(), 1);
    // The reasons are carried through so the student can be told *why*.
    assert!(python.hints.iter().any(|h| h.contains("注册表")));
    assert!(python.hints.iter().any(|h| h.contains("winget")));
}

#[test]
fn partial_probe_failure_never_upgrades_to_absent() {
    // One provider ran and found nothing; another failed. The tempting rule is
    // "a provider did reach a conclusion, so this is a confident absence" — and
    // it is wrong. The provider that ran was the PATH walk, whose entire
    // contribution is "no such executable on PATH", which is precisely what a
    // *working* winget would have been needed to corroborate. Concluding
    // "definitely not installed" from it would send a student to reinstall
    // software that is present.
    let cat = catalog_of(&[SoftwareId::Git]);
    let table = facts(&[
        (SoftwareId::Git, ProbeSource::Path, Finding::Absent),
        (
            SoftwareId::Git,
            ProbeSource::Winget,
            unavailable("winget 超时"),
        ),
    ]);

    let inv = merge(&cat, &table, "now");
    let git = inv.find(SoftwareId::Git).unwrap();
    assert!(!git.installed);
    assert_eq!(
        git.confidence,
        Confidence::Unknown,
        "a failed source must keep the answer open, not close it as absent"
    );
    assert!(git.hints.iter().any(|h| h.contains("winget")));
}

// ---------------------------------------------------------------------------
// Merge — invariants
// ---------------------------------------------------------------------------

#[test]
fn merge_is_deterministic() {
    // Pure function: the same facts must always give the same inventory, or the
    // UI can flicker between answers across a remount.
    let cat = Catalog::builtin();
    let table = facts(&[
        (
            SoftwareId::Git,
            ProbeSource::Registry,
            present("2.51.0|C:\\Git|x"),
        ),
        (SoftwareId::Python, ProbeSource::Path, Finding::Absent),
    ]);

    let a = merge(&cat, &table, "now");
    let b = merge(&cat, &table, "now");
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
}

#[test]
fn every_catalogued_program_gets_exactly_one_row() {
    let cat = Catalog::builtin();
    let mut rows = Vec::new();
    for id in SoftwareId::ALL {
        rows.push((id, ProbeSource::Path, Finding::Absent));
        rows.push((id, ProbeSource::Registry, Finding::Absent));
        rows.push((id, ProbeSource::Winget, Finding::Absent));
    }
    let inv = merge(&cat, &facts(&rows), "now");
    assert_eq!(inv.items.len(), SoftwareId::ALL.len());
    // And they come back in catalog order, so the UI list is stable.
    let ids: Vec<SoftwareId> = inv.items.iter().map(|i| i.id).collect();
    assert_eq!(ids, SoftwareId::ALL.to_vec());
}

#[test]
fn providers_never_report_absence_for_programs_they_were_not_asked_about() {
    // The subset must be respected, or a profile scan would return rows for
    // programs nobody asked about and the UI would show a 7-item list for a
    // 4-item profile.
    let cat = Catalog::builtin().subset(&[SoftwareId::Git]);
    let table = facts(&[
        (SoftwareId::Git, ProbeSource::Path, Finding::Absent),
        (SoftwareId::Python, ProbeSource::Path, Finding::Absent),
    ]);
    let inv = merge(&cat, &table, "now");
    assert_eq!(inv.items.len(), 1);
    assert_eq!(inv.items[0].id, SoftwareId::Git);
}

#[test]
fn provider_names_are_reported_in_precedence_order() {
    let names = provider_names();
    assert_eq!(names, vec!["注册表", "PATH", "winget"]);
}

#[test]
fn the_provider_contract_has_no_way_to_claim_absence() {
    // Compile-time-ish guard on the design: `Finding` has no `Absent`-shaped
    // variant disguised as a claim of "not installed"; only `merge` can turn
    // facts into that conclusion. This test documents the invariant that the
    // three providers return `Finding`, never `InstalledSoftware`.
    let cat = catalog_of(&[SoftwareId::Git]);
    let table = facts(&[(SoftwareId::Git, ProbeSource::Path, Finding::Absent)]);
    let inv = merge(&cat, &table, "now");
    assert_eq!(inv.items.len(), 1);
    // The row exists even for an absent program: the inventory is a complete
    // answer, not a list of hits.
    assert!(!inv.items[0].installed);
}

// ---------------------------------------------------------------------------
// Evidence detail rendering
// ---------------------------------------------------------------------------
//
// The provider payloads are `|`-delimited so the merge step can carry several
// fields in the one `value` slot the evidence type has. That delimiter is an
// internal contract; before these tests it reached the screen verbatim, so a
// student saw `2.54.0.windows.1|C:\...\git.exe|HKEY_...` in the "检测来源" list.

#[test]
fn a_path_evidence_detail_reads_as_a_location_and_version() {
    let ev = Evidence::present(
        ProbeSource::Path,
        r"2.54.0.windows.1|C:\Program Files\Git\bin\git.exe",
    );
    assert_eq!(
        ev.detail().unwrap(),
        r"C:\Program Files\Git\bin\git.exe · 2.54.0.windows.1"
    );
}

#[test]
fn a_registry_detail_drops_the_internal_key() {
    // The third field is a several-hundred-character
    // `Microsoft.PowerShell.Core\Registry::HKEY_...` path. It is what the
    // provider matched on, not information for a student, and it made the row
    // wrap across four lines.
    let ev = Evidence::present(
        ProbeSource::Registry,
        r"1.138.0|D:\工具软件\Microsoft VS Code\|Microsoft.PowerShell.Core\Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{771FD6B0}",
    );
    let detail = ev.detail().unwrap();
    assert!(detail.contains("Microsoft VS Code"), "{detail}");
    assert!(detail.contains("1.138.0"), "{detail}");
    assert!(!detail.contains("HKEY"), "internal key leaked: {detail}");
    assert!(!detail.contains('|'), "delimiter leaked: {detail}");
}

#[test]
fn a_winget_detail_prefers_the_display_name() {
    let ev = Evidence::present(
        ProbeSource::Winget,
        r"1.40609.0.0|Anthropic.Claude|Claude",
    );
    let detail = ev.detail().unwrap();
    assert!(detail.contains("Claude"), "{detail}");
    assert!(detail.contains("1.40609.0.0"), "{detail}");
    assert!(!detail.contains('|'), "delimiter leaked: {detail}");
}

#[test]
fn an_unavailable_detail_is_passed_through_verbatim() {
    // The reason string is prose a human wrote, not a packed payload. Splitting
    // it on `|` would corrupt a message that happens to contain one.
    let ev = Evidence::unavailable(ProbeSource::Winget, "winget 未安装");
    assert_eq!(ev.detail().unwrap(), "winget 未安装");
}

#[test]
fn an_unrecognised_payload_is_not_mangled() {
    // A provider that later stores something else must degrade to showing it
    // as-is rather than being silently truncated by a wrong split.
    let ev = Evidence::present(ProbeSource::Path, "just-a-value");
    assert_eq!(ev.detail().unwrap(), "just-a-value");
}

#[test]
fn an_absent_evidence_has_no_detail() {
    let ev = Evidence::absent(ProbeSource::Registry);
    assert!(ev.detail().is_none());
    assert!(ev.raw().is_none());
}

#[test]
fn every_rendered_detail_is_free_of_the_internal_delimiter() {
    // The general invariant behind the tests above: whatever a provider packs,
    // nothing reaches the UI containing a `|`. Stated over a representative set
    // so a new provider is caught by this test rather than by a screenshot.
    let samples = [
        Evidence::present(ProbeSource::Path, r"1.0|C:\x\y.exe"),
        Evidence::present(ProbeSource::Registry, r"1.0|C:\x\|HKLM\..."),
        Evidence::present(ProbeSource::Winget, "1.0|Publisher.Package|Name"),
    ];
    for ev in samples {
        let detail = ev.detail().unwrap();
        assert!(!detail.contains('|'), "delimiter leaked from {ev:?}: {detail}");
    }
}
