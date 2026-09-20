// Diagnostic: prints how the winget table parser interprets the checked-in
// fixture, so a surprising result can be compared against the raw text instead
// of reasoned about.
//
// Run with:
//   cargo run --example winget_dump
//
// Historical note: this example used to call `column_starts_of`, a helper that
// was removed when the column model changed. It kept `cargo test` red even
// though nothing in the library was broken, which is the one thing a stale
// diagnostic must never do.

use ai_student_setup_lib::modules::inventory::*;

fn main() {
    let fixture = include_str!("../fixtures/winget-list.zh.txt");
    let lines: Vec<&str> = fixture.lines().collect();

    println!("=== winget table fixture ===");
    println!("lines: {}", lines.len());
    if let Some(header) = lines.first() {
        println!("header: {header:?}");
    }

    println!("\n--- column derivation ---");
    match (lines.first(), lines.get(1)) {
        (Some(header), Some(first_row)) => {
            match WingetColumns::from_table(header, first_row).or_else(|| WingetColumns::from_header(header)) {
                Some(cols) => println!("{cols:?}"),
                None => println!("ERR: the header yielded no column model"),
            }
        }
        _ => println!("ERR: fixture has fewer than two lines"),
    }

    println!("\n--- table parse ---");
    match parse_winget_table(fixture) {
        Ok(rows) => {
            println!("{} rows", rows.len());
            for r in rows {
                println!(
                    "name=[{}] id=[{}] ver={:?} avail={:?}",
                    r.name, r.id, r.version, r.available
                );
            }
        }
        Err(e) => println!("ERR: {e}"),
    }
}
