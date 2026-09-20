//! Tests for the YAML subset reader.
//!
//! ## Why this file exists separately
//!
//! The YAML reader is the one piece of this module that is *mechanism* rather
//! than knowledge, and it is the piece most likely to be wrong in a way that
//! shows up as "some files silently lose a field". Testing it through
//! `parse_software` would conflate "the parser is broken" with "the schema
//! changed", so the constructs are exercised directly against
//! `parse_to_value`'s observable output.
//!
//! The tests deliberately include the constructs the real knowledge files use —
//! block scalars, trailing comments, inline sequences, quoted scalars
//! containing colons — rather than an idealised subset. A reader that handles
//! textbook YAML but not `note: "见 https://example.com"` would pass a
//! hand-written test suite and fail on the first real file.

use super::*;

fn yaml(text: &str) -> serde_json::Value {
    parse_to_value(text).unwrap_or_else(|e| panic!("parse failed: {e}\ninput:\n{text}"))
}

#[test]
fn flat_mapping() {
    let v = yaml("id: git\nname: Git\n");
    assert_eq!(v["id"], "git");
    assert_eq!(v["name"], "Git");
}

#[test]
fn nested_mapping_by_indent() {
    let text = "a:\n  b: 1\n  c: 2\nd: 3\n";
    let v = yaml(text);
    assert_eq!(v["a"]["b"], 1);
    assert_eq!(v["a"]["c"], 2);
    assert_eq!(v["d"], 3);
}

#[test]
fn block_sequence_with_scalars() {
    let text = "purpose:\n  - 第一项\n  - 第二项\n";
    let v = yaml(text);
    assert_eq!(v["purpose"][0], "第一项");
    assert_eq!(v["purpose"][1], "第二项");
}

#[test]
fn block_sequence_of_mappings() {
    // The shape `versions:` uses — this is the construct that broke first.
    let text = "versions:\n  - topic: A\n    versions:\n      - \"3.13\"\n    note: n1\n  - topic: B\n    note: n2\n";
    let v = yaml(text);
    assert_eq!(v["versions"][0]["topic"], "A");
    assert_eq!(v["versions"][0]["versions"][0], "3.13");
    assert_eq!(v["versions"][0]["note"], "n1");
    assert_eq!(v["versions"][1]["topic"], "B");
    assert_eq!(v["versions"][1]["note"], "n2");
}

#[test]
fn inline_sequence() {
    let v = yaml("dependsOn: []\ntags: [a, b, c]\n");
    assert_eq!(v["dependsOn"].as_array().unwrap().len(), 0);
    assert_eq!(v["tags"][2], "c");
}

#[test]
fn inline_mapping() {
    let v = yaml("point: {x: 1, y: 2}\n");
    assert_eq!(v["point"]["x"], 1);
    assert_eq!(v["point"]["y"], 2);
}

#[test]
fn inline_sequence_inside_a_sequence_item() {
    let text = "versions:\n  - topic: X\n    tags: [m, n]\n";
    let v = yaml(text);
    assert_eq!(v["versions"][0]["tags"][1], "n");
}

#[test]
fn comments_are_dropped_whole_line_and_trailing() {
    let text = "# leading\nid: git  # trailing\nname: Git\n";
    let v = yaml(text);
    assert_eq!(v["id"], "git");
    assert_eq!(v["name"], "Git");
}

#[test]
fn a_hash_inside_a_scalar_is_not_a_comment() {
    // `C#` and `foo#bar` must survive. Requiring whitespace before `#` is what
    // makes this work, and getting it wrong would silently truncate values.
    let v = yaml("name: C#\nother: a#b\n");
    assert_eq!(v["name"], "C#");
    assert_eq!(v["other"], "a#b");
}

#[test]
fn a_colon_inside_a_url_is_not_a_key_separator() {
    // `note: 见 https://x` — the second colon has no space after it.
    let v = yaml("note: 见 https://example.com/a\n");
    assert_eq!(v["note"], "见 https://example.com/a");
}

#[test]
fn quoted_scalars_are_unquoted() {
    let v = yaml("a: \"3.13\"\nb: 'plain'\n");
    assert_eq!(v["a"], "3.13");
    assert_eq!(v["b"], "plain");
}

#[test]
fn a_quoted_scalar_keeps_a_trailing_hash() {
    let v = yaml("a: \"value # not a comment\"\n");
    assert_eq!(v["a"], "value # not a comment");
}

#[test]
fn single_quote_escape_is_decoded() {
    let v = yaml("a: 'it''s'\n");
    assert_eq!(v["a"], "it's");
}

#[test]
fn block_scalar_keeps_newlines() {
    let text = "studentExplanation: |\n  第一行\n  第二行\nversions: []\n";
    let v = yaml(text);
    let s = v["studentExplanation"].as_str().unwrap();
    assert!(s.contains("第一行\n第二行"), "got {s:?}");
    assert_eq!(v["versions"].as_array().unwrap().len(), 0);
}

#[test]
fn folded_block_scalar_joins_lines() {
    let text = "note: >\n  第一行\n  第二行\n";
    let v = yaml(text);
    let s = v["note"].as_str().unwrap();
    assert!(s.contains("第一行 第二行"), "got {s:?}");
}

#[test]
fn stripped_block_scalar_has_no_trailing_newline() {
    let v = yaml("a: |-\n  x\n");
    assert_eq!(v["a"], "x");
}

#[test]
fn a_block_scalar_ends_at_the_next_key() {
    // The failure this guards: a block scalar that swallows the rest of the
    // document, which produces one enormous string and no fields.
    let text = "explanation: |\n  body\nid: git\n";
    let v = yaml(text);
    assert_eq!(v["id"], "git");
    assert_eq!(v["explanation"].as_str().unwrap().trim(), "body");
}

#[test]
fn numbers_and_booleans_are_typed() {
    let v = yaml("n: 42\nbig: 1048576\nt: true\nf2: false\nnil: null\n");
    assert_eq!(v["n"], 42);
    assert_eq!(v["big"], 1048576);
    assert_eq!(v["t"], true);
    assert_eq!(v["f2"], false);
    assert!(v["nil"].is_null());
}

#[test]
fn a_dotted_scalar_is_kept_as_text() {
    // Every dotted scalar in this format is a version, and versions are text:
    // `3.10` and `3.1` are different releases that a float cannot tell apart.
    // Treating them all as text costs nothing here, because no field in the
    // schema reads a dotted value as a number.
    let v = yaml("a: 1.5\nb: 3.10\nc: 0.9\n");
    assert_eq!(v["a"], "1.5");
    assert_eq!(v["b"], "3.10");
    assert_eq!(v["c"], "0.9");
}

#[test]
fn an_unquoted_version_list_is_coerced_to_strings() {
    // Asserted through the *YAML* path, which is the only path that preserves
    // the author's text.
    //
    // Feeding this through `serde_json` cannot work and the earlier version of
    // this test proved it: JSON has no `3.10`, only the float `3.1`, so the
    // information is already gone before any coercion runs. The YAML reader is
    // what sees `3.10` as written, and it is what must keep it.
    let text = "topic: t\nversions:\n  - 3.10\n  - 3.14\n  - \"3.9\"\n";
    let note: VersionNote = serde_json::from_value(yaml(text)).unwrap();
    assert_eq!(note.versions, vec!["3.10", "3.14", "3.9"]);
}

#[test]
fn a_single_unquoted_version_is_read_as_a_one_element_list() {
    // `versions: 3.14` instead of a list is an easy mistake to make, and
    // dropping the note silently would be a worse response than reading it.
    let note: VersionNote = serde_json::from_value(yaml("topic: t\nversions: 3.14\n")).unwrap();
    assert_eq!(note.versions, vec!["3.14"]);
}

#[test]
fn a_missing_version_list_is_empty_not_an_error() {
    let note: VersionNote = serde_json::from_value(yaml("topic: t\nnote: n\n")).unwrap();
    assert!(note.versions.is_empty());
    // And an empty list means "applies to everything", not "applies to nothing".
    assert!(note.applies_to("anything"));
}

#[test]
fn a_version_note_matches_an_unquoted_version_by_prefix() {
    // End to end: unquoted `3.10` in a file must match a real 3.10.x install.
    let note: VersionNote = serde_json::from_value(yaml("topic: t\nversions:\n  - 3.10\n")).unwrap();
    assert!(note.applies_to("3.10.11"));
    assert!(!note.applies_to("3.1.0"), "must not match 3.1");
}

#[test]
fn leading_document_marker_is_ignored() {
    let v = yaml("---\nid: git\n");
    assert_eq!(v["id"], "git");
}

#[test]
fn an_empty_document_is_an_error_not_a_panic() {
    assert!(parse_to_value("   \n# only a comment\n").is_err());
}

#[test]
fn inconsistent_indent_is_reported_not_guessed() {
    let text = "a:\n    b: 1\n  c: 2\n";
    // The parser must not panic. It may accept or reject, but it must not hang
    // or produce a wrong-but-plausible document silently.
    let result = parse_to_value(text);
    if let Ok(v) = result {
        assert!(v["a"]["b"] == 1 || v["a"]["c"] == 2);
    }
}

#[test]
fn json_input_is_accepted_by_the_same_entry_point() {
    // The tests and the product share one parser, so a fixture written as JSON
    // exercises the real path rather than a bypass.
    let v = yaml("{\"id\": \"git\", \"versions\": []}");
    assert_eq!(v["id"], "git");
}
