//! 查码 —— double-click-able code lookup for the vendor's own machine.
//!
//! This exists because the other two tools (`issue`, `license_admin`) are
//! command-line programs: double-clicking them opens a console, prints, and
//! closes before the text can be read. A vendor who keeps 500 codes in a ledger
//! needs one thing most of all — "show me code #137" — without learning argv.
//!
//! Three ways in:
//!   * double-click and type an id / a code / a note when prompted;
//!   * `查码 137` (or `lookup.exe 137`) for anyone who does use a terminal;
//!   * pass `--all` to dump every row.
//!
//! The program never writes: it opens the ledger read-only and the plaintext
//! export read-only. Accidentally double-clicking cannot damage the ledger,
//! which matters more than convenience here — the ledger is the only record of
//! which codes were ever issued.

use std::collections::HashMap;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// A row of `license_inventory.csv`, kept as raw strings.
struct Row {
    id: String,
    code_hash: String,
    tier: String,
    format: String,
    created_at: String,
    status: String,
    activated_at: String,
    device_hash: String,
    note: String,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let interactive = args.is_empty() || args.iter().any(|a| a == "--wait");

    let rc = run(&args);
    if rc != 0 {
        println!();
        println!("（出错了。按回车键关闭本窗口。）");
        let _ = io::stdin().read_line(&mut String::new());
    } else if interactive {
        // Double-clicked: hold the window open so the answer can be read.
        println!();
        print_hold();
    }
    std::process::exit(rc);
}

fn print_hold() {
    print!("按回车键关闭本窗口…");
    let _ = io::stdout().flush();
    let _ = io::stdin().read_line(&mut String::new());
}

fn run(args: &[String]) -> i32 {
    let root = locate_root();
    let ledger = root.join("license_inventory.csv");
    let pages = newest_export_pages(&root);

    println!("================================================");
    println!("  Setup Center  ——  激活码查询");
    println!("================================================");
    println!();
    println!("台账文件 : {}", ledger.display());
    if pages.is_empty() {
        println!("明文码   : （未找到 codes_export_*.txt）");
    } else if pages.len() == 1 {
        println!("明文码   : {}", pages[0].display());
    } else {
        // Report the span rather than one path, so it is obvious that every page
        // was read — the whole point of merging them.
        println!(
            "明文码   : {} 页（{} … {}）",
            pages.len(),
            pages[0]
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("?"),
            pages[pages.len() - 1]
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("?")
        );
    }
    println!();

    let rows = match read_ledger(&ledger) {
        Ok(r) => r,
        Err(e) => {
            println!("读不到台账：{e}");
            println!("请确认 license_inventory.csv 与本程序在同一个文件夹里。");
            return 1;
        }
    };
    println!("台账共 {} 条记录。", rows.len());

    let codes = read_export_pages(&pages);
    if !codes.is_empty() {
        println!("明文码共 {} 条。", codes.len());
    }
    println!();

    let query: Option<String> = if args.is_empty() || args.iter().any(|a| a == "--wait") {
        ask_query(&codes.is_empty())
    } else if args.iter().any(|a| a == "--all") {
        None
    } else {
        Some(args.join(" "))
    };

    match query {
        None => {
            list_all(&rows, &codes);
        }
        Some(q) => {
            let q = q.trim().to_string();
            if q.is_empty() {
                list_all(&rows, &codes);
            } else {
                lookup(&rows, &codes, &q);
            }
        }
    }
    0
}

/// The ledger stores only hashes, so a code typed by the vendor can be turned
/// into the same deterministic digest and matched against the ledger. Both the
/// ledger and the export are canonicalised exactly like the issuer does, so a
/// code copied out of a chat message with stray spaces still matches.
fn lookup(rows: &[Row], codes: &HashMap<String, String>, q: &str) {
    let direct: Vec<&Row> = rows.iter().filter(|r| r.id == q).collect();
    if !direct.is_empty() {
        for r in direct {
            print_row(r, codes);
        }
        return;
    }

    let needle = q.to_ascii_uppercase();
    let by_note: Vec<&Row> = rows
        .iter()
        .filter(|r| !r.note.is_empty() && r.note.to_ascii_uppercase().contains(&needle))
        .collect();
    if !by_note.is_empty() {
        println!("按备注「{}」找到 {} 条：", q, by_note.len());
        println!();
        for r in by_note {
            print_row(r, codes);
        }
        return;
    }

    if q.starts_with("SC-") || q.len() > 20 {
        let canonical = normalise(&q);
        if let Some(row) = rows.iter().find(|r| r.code_hash == code_hash(&canonical)) {
            print_row(row, codes);
            return;
        }
        println!("没找到这个码。可能打错了，或者这个码不是本台账发出的。");
        return;
    }

    println!("没找到编号或备注「{}」的记录。", q);
    println!();
    println!("提示：输入编号（如 137）、备注片段（如 alice）、或者整串激活码。");
}

fn print_row(r: &Row, codes: &HashMap<String, String>) {
    println!("------------------------------------------------");
    println!("  编号      {}", r.id);
    println!("  类型      {}", r.tier);
    println!("  格式      {}", r.format);
    println!("  生成时间  {}", r.created_at);
    println!("  状态      {}", status_cn(&r.status));
    if !r.activated_at.is_empty() {
        println!("  激活时间  {}", r.activated_at);
    }
    if !r.device_hash.is_empty() {
        println!("  设备      {}", r.device_hash);
    }
    if !r.note.is_empty() {
        println!("  备注      {}", r.note);
    }
    println!();
    match codes.get(&r.code_hash) {
        Some(code) => println!("  明文码    {code}"),
        None => println!(
            "  明文码    （导出文件里没有这一条 —— 台账有记录但明文丢失，\n\
             \x20           这个码无法补发。请确认 codes_export_*.txt 是否被删过。）"
        ),
    }
    println!("------------------------------------------------");
}

fn list_all(rows: &[Row], codes: &HashMap<String, String>) {
    let unused = rows.iter().filter(|r| r.status == "unused").count();
    let activated = rows.iter().filter(|r| r.status == "activated").count();
    let revoked = rows.iter().filter(|r| r.status == "revoked").count();

    println!("  已发出未使用 : {unused}");
    println!("  已激活       : {activated}");
    println!("  已作废       : {revoked}");
    println!("  合计         : {}", rows.len());
    println!();
    println!("  编号   状态        类型   明文码");
    println!("  ------------------------------------------------");
    for r in rows {
        let code = codes.get(&r.code_hash).cloned().unwrap_or_else(|| {
            "（明文缺失）".to_string()
        });
        println!(
            "  {:<6} {:<11} {:<6} {}",
            r.id,
            status_cn(&r.status),
            r.tier,
            code
        );
    }
    println!("  ------------------------------------------------");
    println!("  上面就是全部 {}/{} 条记录的明文码。", codes.len(), rows.len());
}

fn status_cn(s: &str) -> &str {
    match s {
        "unused" => "未使用",
        "activated" => "已激活",
        "revoked" => "已作废",
        other => other,
    }
}

fn ask_query(no_plaintext: &bool) -> Option<String> {
    if *no_plaintext {
        println!("注意：没有找到 codes_export_*.txt，只能看到台账状态，看不到明文码。");
        println!();
    }
    println!("查什么？（输入编号 / 备注片段 / 整串码；直接回车列出全部）");
    print!("> ");
    let _ = io::stdout().flush();
    let mut line = String::new();
    if io::stdin().read_line(&mut line).is_err() {
        return None;
    }
    let t = line.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

/// Walk up from the executable to find the ledger. `cargo run --example` puts
/// the binary in `target/debug/examples`, a shipped DevKit keeps the ledger
/// beside the exe, and this lets one binary serve both layouts.
fn locate_root() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(Path::to_path_buf);
        while let Some(d) = dir {
            if d.join("license_inventory.csv").is_file() {
                return d;
            }
            dir = d.parent().map(Path::to_path_buf);
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// All export pages that belong to the newest batch, in page order.
///
/// ## Why this must return *all* pages, not the newest file
///
/// The earlier version picked a single `codes_export_*.txt` by name. Once the
/// export became paged that silently degraded: it would load only the last page,
/// so codes 001–450 would report "明文缺失" even though their plaintext was
/// sitting in pages 1–9. Returning every page of the newest date and merging
/// them fixes that, and merging is the correct model regardless — a page is a
/// filing convenience, the batch is the unit.
fn newest_export_pages(root: &Path) -> Vec<PathBuf> {
    // The export deliberately lives OUTSIDE the DevKit so that copying the kit
    // anywhere cannot leak plaintext codes. That means searching from the exe
    // directory alone is wrong: the kit at `D:\license-export\开发端\
    // SetupCenter-DevKit\` keeps its export two levels up in
    // `D:\license-export\`. Walk up a few levels, then also try a couple of
    // conventional sibling locations.
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        let mut d = exe.parent().map(Path::to_path_buf);
        for _ in 0..4 {
            match d {
                Some(ref p) => {
                    dirs.push(p.clone());
                    d = p.parent().map(Path::to_path_buf);
                }
                None => break,
            }
        }
    }
    dirs.push(root.to_path_buf());
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd);
    }

    for d in &dirs {
        let found = export_pages_in(d);
        if !found.is_empty() {
            return found;
        }
    }
    Vec::new()
}

/// Every export page in one directory, restricted to the newest batch date.
///
/// `root` is directory-scanned once, the newest `codes_export_<date>` prefix is
/// chosen, and only pages sharing that prefix are returned — so a stale batch
/// from an earlier day cannot mix into today's lookup.
fn export_pages_in(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };

    let mut all: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.starts_with("codes_export_") && name.ends_with(".txt")
        })
        .collect();
    all.sort();
    if all.is_empty() {
        return Vec::new();
    }

    // The batch key is everything up to the page suffix: `codes_export_20260921`.
    // Both `…_p03.txt` and a legacy unpaged `….txt` map to the same key, so an
    // old export and a new paged one are not mixed.
    let key_of = |p: &Path| -> String {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let stem = name.trim_end_matches(".txt");
        match stem.rfind("_p") {
            // Only treat `_pNN` at the end as a page suffix.
            Some(i) if stem[i + 2..].chars().all(|c| c.is_ascii_digit()) => stem[..i].to_string(),
            _ => stem.to_string(),
        }
    };

    let newest = all.iter().map(|p| key_of(p)).max().unwrap_or_default();
    let mut pages: Vec<PathBuf> = all.into_iter().filter(|p| key_of(p) == newest).collect();
    pages.sort();
    pages
}

fn split_csv(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted => {
                if chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            }
            '"' => quoted = true,
            ',' if !quoted => {
                out.push(std::mem::take(&mut cur));
            }
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out
}

fn read_ledger(path: &Path) -> Result<Vec<Row>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut lines = text.lines();
    let header = lines.next().ok_or("台账是空的")?;
    let cols: Vec<String> = split_csv(header)
        .into_iter()
        .map(|c| c.trim().to_ascii_lowercase())
        .collect();

    let idx = |name: &str| cols.iter().position(|c| c == name);
    let (i_id, i_hash) = (
        idx("id").ok_or("台账缺少 id 列")?,
        idx("code_hash").ok_or("台账缺少 code_hash 列")?,
    );
    let (i_tier, i_fmt) = (idx("tier"), idx("format"));
    let (i_created, i_status) = (idx("created_at"), idx("status"));
    let (i_act, i_dev, i_note) = (idx("activated_at"), idx("device_hash"), idx("note"));

    let get = |f: &[String], i: Option<usize>| -> String {
        i.and_then(|i| f.get(i)).cloned().unwrap_or_default()
    };

    let mut rows = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let f = split_csv(line);
        rows.push(Row {
            id: get(&f, Some(i_id)),
            code_hash: get(&f, Some(i_hash)),
            tier: get(&f, i_tier),
            format: get(&f, i_fmt),
            created_at: get(&f, i_created),
            status: get(&f, i_status),
            activated_at: get(&f, i_act),
            device_hash: get(&f, i_dev),
            note: get(&f, i_note),
        });
    }
    Ok(rows)
}

/// `NN SC-XXXXX-XXXXX-XXXXX-CCCCC` per line — the issued format.
fn read_export(path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(text) = std::fs::read_to_string(path) else {
        return map;
    };
    for line in text.lines() {
        let code = line
            .split_whitespace()
            .last()
            .unwrap_or("")
            .trim()
            .to_string();
        if code.starts_with("SC-") {
            map.insert(code_hash(&normalise(&code)), code);
        }
    }
    map
}

/// Merges every export page into one hash → plaintext map.
///
/// A later page cannot overwrite an earlier one's code, because a code appears in
/// exactly one page; inserting is therefore safe and the order only affects
/// iteration, which nothing depends on.
fn read_export_pages(pages: &[PathBuf]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for page in pages {
        map.extend(read_export(page));
    }
    map
}

/// Canonicalise exactly as `license::validator::normalise` does.
///
/// This MUST stay byte-identical to the library: the ledger's `code_hash` is
/// `sha256("inventory:v1:" || normalise(code))`, so any difference here — even
/// one character — makes every lookup miss. Two details are easy to get wrong
/// and both were wrong in the first version of this file:
///
///   * Crockford folding: `O` folds to `0`, and `I`/`L` fold to `1`, because a
///     human reading a code aloud cannot distinguish them.
///   * Re-grouping, not stripping: the canonical spelling keeps its dashes in
///     groups of five (`SC-ABCDE-…`), so the hash input contains dashes. Simply
///     deleting separators produces a different digest and never matches.
fn normalise(input: &str) -> String {
    const PREFIX: &str = "SC";
    const GROUP: usize = 5;

    let mut cleaned = String::with_capacity(input.len());
    for ch in input.chars() {
        // Full-width hyphen and the em/en dashes an IME or chat client may
        // substitute for the ASCII one.
        if matches!(ch, '-' | '‐' | '‑' | '–' | '—' | '−' | '－') {
            continue;
        }
        if ch.is_ascii_alphanumeric() {
            let upper = ch.to_ascii_uppercase();
            cleaned.push(match upper {
                'O' => '0',
                'I' | 'L' => '1',
                other => other,
            });
        }
    }

    let body = cleaned.strip_prefix(PREFIX).unwrap_or(&cleaned).to_string();

    let mut out = String::from(PREFIX);
    for chunk in body.as_bytes().chunks(GROUP) {
        out.push('-');
        out.push_str(&String::from_utf8_lossy(chunk));
    }
    out
}

/// `sha256("inventory:v1:" || canonical_code)`, hex. Duplicated from the issuer
/// deliberately: this tool must keep working even if it is copied alone to a
/// USB stick and must not depend on the library crate.
fn code_hash(canonical: &str) -> String {
    let mut msg = b"inventory:v1:".to_vec();
    msg.extend_from_slice(canonical.as_bytes());
    hex(&sha256(&msg))
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn sha256(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let mut msg = data.to_vec();
    let bitlen = (data.len() as u64) * 8;
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bitlen.to_be_bytes());

    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let (mut a, mut b, mut c, mut d) = (h[0], h[1], h[2], h[3]);
        let (mut e, mut f, mut g, mut hh) = (h[4], h[5], h[6], h[7]);

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}
