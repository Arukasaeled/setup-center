//! Knowledge layer — the answer to "what *is* this, and why would I want it?".
//!
//! ## Where this sits
//!
//! The pipeline so far can already answer three questions:
//!
//! ```text
//! inventory  →  what is on this machine?
//! capability →  what can this machine therefore do?
//! bootstrap  →  what would change that?
//! ```
//!
//! Every one of those is about *this machine*. None of them can answer the
//! question a first-year student actually asks when they see a row that says
//! `pnpm · 未安装`:
//!
//! > what is pnpm, do I need it, and what happens if I ignore it?
//!
//! That knowledge is not machine-specific. It is the same on every computer, it
//! changes on a different schedule than the software does, and it is the part a
//! person might reasonably want to edit without recompiling. So it lives in data
//! files, not in `match` arms.
//!
//! ## The rule this module exists to enforce
//!
//! **Knowledge is additive and never load-bearing.**
//!
//! This is the single most important property of the module, and it is why the
//! lookup functions all return `Option` and why nothing in `detect`, `inventory`,
//! `install` or `capability` calls into here for a decision. If every knowledge
//! file were deleted, the app must still detect, plan, install, verify and
//! report — it would simply have less to say. A student's Git installation must
//! not fail because a YAML file about Git has a typo.
//!
//! That constraint is not a stylistic preference. An "explanation layer" that
//! can break the installer is a worse product than one that has no explanations,
//! because the failure is unexplainable to the person experiencing it.
//!
//! ## Why the loader is forgiving
//!
//! Following directly from the above: a malformed knowledge file is a *warning*,
//! not an error. One bad file does not take down its siblings, and a missing
//! directory is not a failure at all — it is the state this app ships in when a
//! build forgets to bundle the resources. See [`Knowledge::load`].
//!
//! The one thing the loader will not do is invent content. An id with no
//! knowledge entry yields `None`, and every consumer is required to handle
//! `None` by showing *less*, never by showing a guess.

pub mod advisor;
pub mod goal;

use crate::model::*;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/// Everything the app knows about one piece of software, as data.
///
/// Deliberately *not* a `SoftwareId` keyed struct: the knowledge file names its
/// subject by string, and the loader resolves that string against the catalog.
/// An entry naming software the catalog does not have is dropped with a warning
/// (see [`Knowledge::load`]) — knowledge may only describe software the app can
/// actually see, or the two would disagree about what exists.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SoftwareKnowledge {
    /// The `SoftwareId::key()` this entry describes.
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// Short category label, e.g. "开发工具". Free text on purpose: the
    /// dashboard groups by *capability*, and this is a secondary label.
    #[serde(default)]
    pub category: String,
    /// What it is, in one sentence, for someone who has never heard of it.
    #[serde(default)]
    pub description: String,
    /// What a student gets from it. A list because most tools do several things
    /// and one of them is usually the one a given student cares about.
    #[serde(default)]
    pub purpose: Vec<String>,
    /// Capability ids this program contributes to, for the "关联能力" row.
    ///
    /// Cross-checked against the capability table at load time: an id the table
    /// does not know is reported as a warning. This is the one place knowledge
    /// *references* another layer, and it references it by id rather than
    /// restating it, so the two cannot disagree about what `python-development`
    /// means. (The reverse direction — capability → software — is derived by
    /// `capability::depending_on`, not written here.)
    #[serde(default)]
    pub related_capabilities: Vec<String>,
    /// Software that must be present first, by `SoftwareId::key()`.
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Other tools that commonly use this one. Purely explanatory: it answers
    /// "why does this keep coming up" without asserting a requirement.
    #[serde(default)]
    pub commonly_used_by: Vec<String>,
    /// The paragraph shown in the detail pane. Written for a student, not a
    /// developer — this is the field most likely to be edited by a school.
    #[serde(default)]
    pub student_explanation: String,
    /// Notes about *versions*, if this tool has any.
    ///
    /// See [`VersionNote`]. Absent for most software, which is the point: a note
    /// exists only where there is something real to say.
    #[serde(default)]
    pub versions: Vec<VersionNote>,
}

/// What to say about a version, without deciding whether it is wrong.
///
/// **This type carries no verdict.** The brief was explicit that the app should
/// provide knowledge and not judge: a student on Python 3.14 is not making a
/// mistake, they are on a newer release than parts of the AI ecosystem have
/// caught up with. So a note states a *range* and a *reason*, and the UI decides
/// how loudly to say it.
///
/// Concretely: nothing in this struct can mark a row "bad", and
/// [`VersionNote::applies_to`] answers only "does this note describe the version
/// you have" — never "is that version acceptable".
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VersionNote {
    /// What the note is about, e.g. "AI 生态兼容性".
    pub topic: String,
    /// Version prefixes this note applies to, e.g. `["3.13", "3.14"]`.
    ///
    /// Prefix matching rather than semver ranges because that is what the data
    /// actually supports: the claim is "3.13 and 3.14 are newer than what most
    /// packages target", not a precise interval. An empty list means the note is
    /// general and applies to any version.
    ///
    /// Coerced from any scalar — see [`versions_from_value`]. An author who
    /// writes `- 3.14` without quotes gets the string `"3.14"` rather than a
    /// float, so an unquoted version can never fail to load or, worse, match the
    /// wrong release.
    #[serde(default, deserialize_with = "versions_from_value")]
    pub versions: Vec<String>,
    /// The note itself, phrased as information.
    #[serde(default)]
    pub note: String,
}

impl VersionNote {
    /// Whether this note is about `version`.
    ///
    /// A note with no versions listed applies to everything, which is how a
    /// general caveat ("this needs a restart to update PATH") is expressed.
    pub fn applies_to(&self, version: &str) -> bool {
        self.versions.is_empty()
            || self
                .versions
                .iter()
                .any(|v| version.starts_with(v.as_str()))
    }
}

/// Reads a list of versions from any scalar shape.
///
/// ## Why this exists
///
/// A version like `3.10` is textually ambiguous with the float `3.1`, and the
/// obvious heuristic — "if parsing as a number changes the text, it was a
/// version" — is *wrong in a way that hides*: `3.14` round-trips through `f64`
/// unchanged, so it would be accepted as a number, and `serde` would then fail
/// to deserialise a `Number` into `Vec<String>`. The failure lands on whichever
/// version happens to round-trip, which is the worst possible rule.
///
/// So instead of guessing from the text, the *field* decides. Everything in a
/// `versions:` list is a version, whatever YAML made of it — number, string, or
/// bare word — and is normalised to its textual form here. That removes the
/// ambiguity by construction rather than by heuristics that are only correct for
/// the cases someone happened to test.
fn versions_from_value<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;

    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    let Some(value) = value else {
        return Ok(Vec::new());
    };

    Ok(match value {
        serde_json::Value::Array(items) => items
            .into_iter()
            .map(|item| scalar_to_string(&item))
            .collect(),
        // A single scalar is accepted as a one-element list. An author writing
        // `versions: 3.14` rather than a list is making a natural mistake, and
        // silently dropping the note would be a worse response than reading it.
        other => vec![scalar_to_string(&other)],
    })
}

/// Renders a JSON scalar as the text a version is written in.
fn scalar_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null => String::new(),
        // A nested collection in a version list is a mistake; rendering it as
        // JSON keeps the wrongness visible instead of matching nothing silently.
        other => other.to_string(),
    }
}

/// A concept a student will meet but cannot install: MCP, CUDA, PATH.
///
/// Separate from [`SoftwareKnowledge`] because these are the words that make the
/// rest of the app legible, and they have no executable, no version and no
/// installer. Modelling them as software with empty fields would put "PATH" in
/// the software list, where it would render as a permanently-missing program.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptKnowledge {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// Loose grouping label, e.g. "概念". Present so the UI can tag a concept
    /// card the same way it tags a software card without the two needing
    /// different render paths.
    #[serde(default)]
    pub category: String,
    /// One-sentence definition for someone meeting the term for the first time.
    #[serde(default)]
    pub summary: String,
    /// Why it matters, in student terms.
    #[serde(default)]
    pub why_it_matters: String,
    /// Capability ids this concept is part of, if any.
    #[serde(default)]
    pub related_capabilities: Vec<String>,
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/// The loaded knowledge base.
#[derive(Debug, Clone, Default)]
pub struct Knowledge {
    software: BTreeMap<String, SoftwareKnowledge>,
    concepts: BTreeMap<String, ConceptKnowledge>,
    /// Non-fatal problems. Surfaced in the UI rather than logged away, because a
    /// knowledge file that failed to parse is exactly the kind of thing that
    /// otherwise shows up as "the app suddenly stopped explaining things".
    pub warnings: Vec<String>,
    /// Where the files came from, or `None` for the compiled-in set.
    pub source_dir: Option<std::path::PathBuf>,
}

impl Knowledge {
    /// The knowledge for a program, if any.
    ///
    /// `None` is a first-class outcome, not an error. The dashboard renders a row
    /// with the catalog's own name and purpose when this returns `None` — see
    /// [`Knowledge::shown_for`].
    pub fn software(&self, id: SoftwareId) -> Option<&SoftwareKnowledge> {
        self.software.get(id.key())
    }

    pub fn concept(&self, id: &str) -> Option<&ConceptKnowledge> {
        self.concepts.get(id)
    }

    /// Every concept, in id order.
    ///
    /// `BTreeMap` iteration order, so the list is stable between runs — an
    /// unstable order would make the UI reshuffle on every mount for no reason
    /// the student could perceive.
    pub fn all_concepts(&self) -> Vec<&ConceptKnowledge> {
        self.concepts.values().collect()
    }

    /// Concepts that name `capability`, for the capability detail pane.
    pub fn concepts_for_capability(&self, capability: &str) -> Vec<&ConceptKnowledge> {
        self.concepts
            .values()
            .filter(|c| c.related_capabilities.iter().any(|x| x == capability))
            .collect()
    }

    /// The best explanatory sentence for a capability, if knowledge has one.
    ///
    /// Picks the longest `studentExplanation` among the software that names this
    /// capability, on the reasoning that the longest one is the one an author
    /// put effort into. Returns `None` when nothing in the knowledge base
    /// mentions the capability, which lets the caller fall back to the
    /// capability table's own one-line description instead of showing a blank.
    pub fn software_note_for_capability(&self, capability: &str) -> Option<String> {
        self.software
            .values()
            .filter(|k| k.related_capabilities.iter().any(|c| c == capability))
            .map(|k| k.student_explanation.trim())
            .filter(|s| !s.is_empty())
            .max_by_key(|s| s.len())
            .map(|s| s.to_string())
    }

    /// Every software entry that names `capability`, for the detail pane's
    /// "用到的工具" list.
    pub fn software_for_capability(&self, capability: &str) -> Vec<&SoftwareKnowledge> {
        self.software
            .values()
            .filter(|k| k.related_capabilities.iter().any(|c| c == capability))
            .collect()
    }

    /// What to show for a program, guaranteed to have something.
    ///
    /// This is the function the dashboard actually calls, and it exists so the
    /// "knowledge may be absent" rule is handled in one place instead of at every
    /// call site. When there is no knowledge entry, the catalog's own
    /// `display_name` and `purpose` are used — which is exactly the information
    /// the app had before this layer existed, so a missing file degrades to the
    /// previous behaviour rather than to a blank row.
    ///
    /// The returned struct borrows nothing from `self`, so a caller can hold it
    /// across a mutation and does not have to think about lifetimes to render a
    /// row.
    pub fn shown_for(&self, id: SoftwareId) -> ShownKnowledge {
        match self.software(id) {
            Some(k) => ShownKnowledge {
                id,
                name: if k.name.trim().is_empty() {
                    id.display_name().to_string()
                } else {
                    k.name.clone()
                },
                category: k.category.clone(),
                description: k.description.clone(),
                purposes: if k.purpose.is_empty() {
                    vec![id.purpose().to_string()]
                } else {
                    k.purpose.clone()
                },
                student_explanation: k.student_explanation.clone(),
                related_capabilities: k.related_capabilities.clone(),
                depends_on: k.depends_on.clone(),
                commonly_used_by: k.commonly_used_by.clone(),
                versions: k.versions.clone(),
                // Whether this came from a knowledge file or from the fallback.
                from_knowledge: true,
            },
            None => ShownKnowledge {
                id,
                name: id.display_name().to_string(),
                category: String::new(),
                description: id.purpose().to_string(),
                purposes: vec![id.purpose().to_string()],
                student_explanation: String::new(),
                related_capabilities: Vec::new(),
                depends_on: Vec::new(),
                commonly_used_by: Vec::new(),
                versions: Vec::new(),
                from_knowledge: false,
            },
        }
    }

    pub fn software_count(&self) -> usize {
        self.software.len()
    }

    pub fn concept_count(&self) -> usize {
        self.concepts.len()
    }

    pub fn is_empty(&self) -> bool {
        self.software.is_empty() && self.concepts.is_empty()
    }

    /// Loads every knowledge file in `dir`, falling back to the compiled-in set.
    ///
    /// Mirrors `ProfileStore::load` on purpose — same fallback rule, same
    /// warning-not-error stance — because a maintainer who understands one
    /// should not have to learn a second policy for the other.
    pub fn load(dir: Option<&Path>) -> Self {
        let mut software = BTreeMap::new();
        let mut concepts = BTreeMap::new();
        let mut warnings = Vec::new();
        let mut source_dir = None;

        if let Some(dir) = dir {
            if dir.is_dir() {
                let mut any_file = false;
                for (sub, is_concept) in [("software", false), ("concept", true)] {
                    let sub_dir = dir.join(sub);
                    if !sub_dir.is_dir() {
                        continue;
                    }
                    match std::fs::read_dir(&sub_dir) {
                        Ok(entries) => {
                            let mut files: Vec<std::path::PathBuf> = entries
                                .flatten()
                                .map(|e| e.path())
                                .filter(|p| {
                                    p.extension()
                                        .is_some_and(|e| e == "yaml" || e == "yml" || e == "json")
                                })
                                .collect();
                            files.sort();
                            for file in files {
                                any_file = true;
                                let name = file
                                    .file_name()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .to_string();
                                match std::fs::read_to_string(&file) {
                                    Ok(text) => {
                                        if is_concept {
                                            match parse_concept(&text) {
                                                Ok(c) => {
                                                    concepts.insert(c.id.clone(), c);
                                                }
                                                Err(e) => warnings.push(format!(
                                                    "概念知识 {name} 解析失败，已跳过: {e}"
                                                )),
                                            }
                                        } else {
                                            match parse_software(&text) {
                                                Ok(s) => {
                                                    software.insert(s.id.clone(), s);
                                                }
                                                Err(e) => warnings.push(format!(
                                                    "软件知识 {name} 解析失败，已跳过: {e}"
                                                )),
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        warnings.push(format!("无法读取 {name}: {e}"));
                                    }
                                }
                            }
                        }
                        Err(e) => warnings.push(format!("无法读取目录 {}: {e}", sub_dir.display())),
                    }
                }
                if any_file {
                    source_dir = Some(dir.to_path_buf());
                }
            }
        }

        if software.is_empty() && concepts.is_empty() {
            if source_dir.is_some() {
                warnings.push("磁盘上的知识文件均不可用，已回退到内置知识。".into());
                source_dir = None;
            }
            for (text, is_concept) in BUILTIN {
                let parsed = if *is_concept {
                    parse_concept(text).map(|c| concepts.insert(c.id.clone(), c)).map(|_| ())
                } else {
                    parse_software(text).map(|s| software.insert(s.id.clone(), s)).map(|_| ())
                };
                if let Err(e) = parsed {
                    warnings.push(format!("内置知识解析失败（这是程序缺陷）: {e}"));
                }
            }
        }

        let mut store = Self {
            software,
            concepts,
            warnings,
            source_dir,
        };
        store.cross_check();
        store
    }

    /// Reports knowledge that names something the app does not have.
    ///
    /// Runs against the real catalog and the real capability table, so a typo in
    /// a hand-written YAML file is visible rather than silently inert. Warnings
    /// only — see the module doc for why none of this may fail a load.
    fn cross_check(&mut self) {
        let mut warnings = Vec::new();

        for (id, entry) in &self.software {
            // A knowledge file may only describe software the catalog knows. The
            // check is against `SoftwareId::key()`, which is the same spelling the
            // profile files use, so a maintainer has one string to get right.
            if !SoftwareId::ALL.iter().any(|s| s.key() == id) {
                warnings.push(format!(
                    "知识文件 {id}.yaml 描述了一个目录里没有的软件，该条目不会显示。"
                ));
                continue;
            }
            for cap in &entry.related_capabilities {
                if crate::modules::capability::lookup_by_str(cap).is_none() {
                    warnings.push(format!(
                        "{id}.yaml 关联了未知能力 “{cap}”，该关联不会显示。"
                    ));
                }
            }
            for dep in &entry.depends_on {
                if !SoftwareId::ALL.iter().any(|s| s.key() == dep) {
                    warnings.push(format!("{id}.yaml 依赖了未知软件 “{dep}”。"));
                }
            }
        }

        for (id, concept) in &self.concepts {
            for cap in &concept.related_capabilities {
                if crate::modules::capability::lookup_by_str(cap).is_none() {
                    warnings.push(format!(
                        "概念 {id}.yaml 关联了未知能力 “{cap}”，该关联不会显示。"
                    ));
                }
            }
        }

        self.warnings.extend(warnings);
    }

    /// The catalogued software with no knowledge entry.
    ///
    /// Exposed so a test can assert coverage, and so the app can report its own
    /// incomplete knowledge rather than leaving a maintainer to diff two files.
    pub fn software_without_knowledge(&self) -> Vec<SoftwareId> {
        SoftwareId::ALL
            .iter()
            .copied()
            .filter(|id| !self.software.contains_key(id.key()))
            .collect()
    }
}

/// What the dashboard shows for one program.
///
/// An owned struct rather than `&SoftwareKnowledge` because the fallback path
/// synthesises values that exist in no file. Making the caller handle two shapes
/// would spread the "knowledge might be missing" branch across every render site,
/// which is the bug this type exists to prevent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShownKnowledge {
    pub id: SoftwareId,
    pub name: String,
    pub category: String,
    pub description: String,
    /// Always non-empty: an empty purpose list falls back to the catalog's.
    pub purposes: Vec<String>,
    pub student_explanation: String,
    pub related_capabilities: Vec<String>,
    pub depends_on: Vec<String>,
    pub commonly_used_by: Vec<String>,
    pub versions: Vec<VersionNote>,
    /// `false` when this came from the catalog fallback rather than a file.
    ///
    /// Sent to the UI so it can decline to show an empty "为什么需要" section
    /// rather than rendering a heading with nothing under it.
    pub from_knowledge: bool,
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Parses one software knowledge file.
///
/// Accepts JSON as well as YAML, and that is not gold-plating: the knowledge
/// files are YAML for readability, but a maintainer debugging a parse failure can
/// paste the document into any JSON tool once converted, and more importantly the
/// **tests** build fixtures as JSON literals. Supporting both means the fixtures
/// exercise the same parser the product uses, rather than a bypass.
pub fn parse_software(text: &str) -> Result<SoftwareKnowledge, String> {
    let value: serde_json::Value = parse_to_value(text)?;
    let parsed: SoftwareKnowledge =
        serde_json::from_value(value).map_err(|e| format!("字段不合法: {e}"))?;
    if parsed.id.trim().is_empty() {
        return Err("缺少 id".into());
    }
    Ok(parsed)
}

pub fn parse_concept(text: &str) -> Result<ConceptKnowledge, String> {
    let value: serde_json::Value = parse_to_value(text)?;
    let parsed: ConceptKnowledge =
        serde_json::from_value(value).map_err(|e| format!("字段不合法: {e}"))?;
    if parsed.id.trim().is_empty() {
        return Err("缺少 id".into());
    }
    Ok(parsed)
}

/// Turns either YAML or JSON into a `serde_json::Value`.
///
/// The YAML subset handled here is deliberately small — mappings, sequences,
/// scalars, comments, block strings — because the alternative is a full YAML
/// engine as a dependency. Rather than pretend otherwise, [`yaml_to_json`]
/// returns a clear error for anything outside the subset, so an author who uses
/// an unsupported feature finds out immediately instead of silently getting a
/// half-parsed document.
fn parse_to_value(text: &str) -> Result<serde_json::Value, String> {
    let trimmed = text.trim_start();
    if trimmed.starts_with('{') {
        return serde_json::from_str(text).map_err(|e| format!("JSON 语法错误: {e}"));
    }
    yaml_to_json(text)
}

// ---------------------------------------------------------------------------
// A minimal YAML reader
// ---------------------------------------------------------------------------

/// Converts the supported YAML subset into JSON.
///
/// ## Why not a YAML crate
///
/// The knowledge files are authored by hand and read by one program. Pulling in
/// a YAML implementation would add a dependency with its own parser, its own
/// security surface and its own version churn, to read documents that are
/// structurally JSON with nicer quoting. The subset below covers every construct
/// the files use.
///
/// ## What is supported
///
/// * nested mappings by indentation
/// * block sequences (`- item`) and inline sequences (`[a, b]`)
/// * inline mappings (`{a: 1}`)
/// * `#` comments, whole-line and trailing
/// * quoted and unquoted scalars; numbers and booleans
/// * block scalars (`|` and `>`) for the long explanation paragraphs
/// * documents starting with `---`
///
/// ## What is not
///
/// Anchors, aliases, tags, multiple documents, flow sequences spanning lines, and
/// non-string mapping keys. Each produces an error naming the line, which is more
/// useful than a silently wrong parse.
fn yaml_to_json(text: &str) -> Result<serde_json::Value, String> {
    let mut lines: Vec<Line> = Vec::new();
    let mut raw = text.lines().peekable();

    while let Some(line) = raw.next() {
        let without_comment = strip_comment(line);
        let trimmed = without_comment.trim();
        if trimmed.is_empty() || trimmed == "---" {
            continue;
        }
        let indent = without_comment.len() - without_comment.trim_start().len();

        // Block scalars need the following more-indented lines, so they are
        // consumed here rather than in the recursive descent — by the time the
        // parser sees this line it no longer has access to the raw input.
        if let Some(rest) = strip_key(trimmed).map(|(_, v)| v) {
            if rest == "|" || rest == ">" || rest == "|-" || rest == ">-" {
                let folded = rest.starts_with('>');
                let strip_trailing = rest.ends_with('-');
                let mut body: Vec<String> = Vec::new();
                let mut block_indent: Option<usize> = None;
                while let Some(next) = raw.peek() {
                    let next_clean = strip_comment(next);
                    if next_clean.trim().is_empty() {
                        body.push(String::new());
                        raw.next();
                        continue;
                    }
                    let next_indent = next_clean.len() - next_clean.trim_start().len();
                    if next_indent <= indent {
                        break;
                    }
                    let bi = *block_indent.get_or_insert(next_indent);
                    if next_indent < bi {
                        break;
                    }
                    body.push(next_clean[bi..].to_string());
                    raw.next();
                }
                // `>` folds newlines into spaces (but keeps blank-line breaks);
                // `|` keeps them. `-` strips the trailing newline.
                while body.last().is_some_and(|l| l.trim().is_empty()) {
                    body.pop();
                }
                let joined = if folded {
                    body.join(" ")
                } else {
                    body.join("\n")
                };
                let value = if strip_trailing {
                    joined
                } else {
                    format!("{joined}\n")
                };
                lines.push(Line {
                    indent,
                    text: format!("{}: {}", strip_key(trimmed).unwrap().0, json_string(&value)),
                });
                continue;
            }
        }

        lines.push(Line {
            indent,
            text: trimmed.to_string(),
        });
    }

    if lines.is_empty() {
        return Err("文档为空".into());
    }

    let mut cursor = 0usize;
    let value = parse_node(&lines, &mut cursor, lines[0].indent)?;
    if cursor < lines.len() {
        return Err(format!(
            "第 {} 行无法解析（缩进不一致？）: {}",
            cursor + 1,
            lines[cursor].text
        ));
    }
    Ok(value)
}

struct Line {
    indent: usize,
    text: String,
}

fn parse_node(lines: &[Line], cursor: &mut usize, indent: usize) -> Result<serde_json::Value, String> {
    if *cursor >= lines.len() {
        return Ok(serde_json::Value::Null);
    }
    if lines[*cursor].text.starts_with("- ") || lines[*cursor].text == "-" {
        return parse_sequence(lines, cursor, indent);
    }
    parse_mapping(lines, cursor, indent)
}

fn parse_sequence(
    lines: &[Line],
    cursor: &mut usize,
    indent: usize,
) -> Result<serde_json::Value, String> {
    let mut out = Vec::new();
    while *cursor < lines.len() {
        let line = &lines[*cursor];
        if line.indent != indent || !(line.text.starts_with("- ") || line.text == "-") {
            break;
        }
        let rest = line.text[1..].trim().to_string();
        *cursor += 1;

        if rest.is_empty() {
            // `-` alone: the item is the indented block that follows.
            if *cursor < lines.len() && lines[*cursor].indent > indent {
                let child_indent = lines[*cursor].indent;
                out.push(parse_node(lines, cursor, child_indent)?);
            } else {
                out.push(serde_json::Value::Null);
            }
            continue;
        }

        // `- key: value` starts a mapping whose first key sits on this line. The
        // remaining keys of that mapping are indented to the column of the key,
        // not to the dash, so the synthetic line is given the deeper indent.
        if let Some((key, value)) = strip_key(&rest) {
            let key_column = indent + 2;
            out.push(parse_inline_mapping_start(lines, cursor, key_column, key, value)?);
        } else {
            out.push(scalar_to_json(&rest));
        }
    }
    Ok(serde_json::Value::Array(out))
}

/// Handles `- key: value` plus any further keys belonging to the same item.
fn parse_inline_mapping_start(
    lines: &[Line],
    cursor: &mut usize,
    key_column: usize,
    first_key: String,
    first_value: String,
) -> Result<serde_json::Value, String> {
    let mut map = serde_json::Map::new();
    insert_entry(&mut map, &first_key, &first_value)?;

    // Any following line indented to (at least) the key column continues this
    // mapping. A line at the dash's own indent or shallower ends the item.
    while *cursor < lines.len() && lines[*cursor].indent >= key_column {
        let line_indent = lines[*cursor].indent;
        let text = lines[*cursor].text.clone();
        let Some((key, value)) = strip_key(&text) else {
            break;
        };
        *cursor += 1;
        if value.is_empty() {
            if *cursor < lines.len() && lines[*cursor].indent > line_indent {
                let child = parse_node(lines, cursor, lines[*cursor].indent)?;
                map.insert(key, child);
            } else {
                map.insert(key, serde_json::Value::Null);
            }
        } else {
            insert_entry(&mut map, &key, &value)?;
        }
    }
    Ok(serde_json::Value::Object(map))
}

fn parse_mapping(
    lines: &[Line],
    cursor: &mut usize,
    indent: usize,
) -> Result<serde_json::Value, String> {
    let mut map = serde_json::Map::new();
    while *cursor < lines.len() {
        let line = &lines[*cursor];
        if line.indent != indent {
            break;
        }
        let text = line.text.clone();
        let Some((key, value)) = strip_key(&text) else {
            return Err(format!("第 {} 行不是“键: 值”形式: {text}", *cursor + 1));
        };
        *cursor += 1;

        if value.is_empty() {
            if *cursor < lines.len() && lines[*cursor].indent > indent {
                let child = parse_node(lines, cursor, lines[*cursor].indent)?;
                map.insert(key, child);
            } else {
                map.insert(key, serde_json::Value::Null);
            }
        } else {
            insert_entry(&mut map, &key, &value)?;
        }
    }
    Ok(serde_json::Value::Object(map))
}

/// Stores one scalar, decoding an inline collection when present.
fn insert_entry(
    map: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    raw: &str,
) -> Result<(), String> {
    map.insert(key.to_string(), scalar_to_json(raw));
    Ok(())
}

/// Splits `key: value`, honouring a quoted key.
///
/// Returns `None` when the line has no top-level colon, which is how a bare
/// sequence item is told apart from a mapping entry.
fn strip_key(text: &str) -> Option<(String, String)> {
    let bytes = text.as_bytes();
    let mut in_single = false;
    let mut in_double = false;
    for (i, b) in bytes.iter().enumerate() {
        match b {
            b'\'' if !in_double => in_single = !in_single,
            b'"' if !in_single => in_double = !in_double,
            b':' if !in_single && !in_double => {
                // A colon only starts the value when followed by a space or EOL;
                // otherwise it is part of a URL or an unquoted scalar like
                // `https://example.com`.
                let rest = &text[i + 1..];
                if rest.is_empty() || rest.starts_with(' ') {
                    let key = text[..i].trim().trim_matches('"').trim_matches('\'').to_string();
                    return Some((key, rest.trim().to_string()));
                }
            }
            _ => {}
        }
    }
    None
}

/// Removes a trailing `#` comment that is not inside quotes.
fn strip_comment(line: &str) -> &str {
    let mut in_single = false;
    let mut in_double = false;
    for (i, c) in line.char_indices() {
        match c {
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            '#' if !in_single && !in_double => {
                // A `#` only starts a comment at a word boundary; `foo#bar` is a
                // scalar. Requiring whitespace (or start-of-line) matches what
                // the YAML spec actually does for unquoted scalars.
                if i == 0 || line[..i].ends_with(char::is_whitespace) {
                    return &line[..i];
                }
            }
            _ => {}
        }
    }
    line
}

/// Converts one scalar (or inline collection) to JSON.
fn scalar_to_json(raw: &str) -> serde_json::Value {
    let raw = raw.trim();
    if raw.is_empty() {
        return serde_json::Value::Null;
    }

    if raw.starts_with('[') && raw.ends_with(']') {
        let inner = &raw[1..raw.len() - 1];
        let items: Vec<serde_json::Value> = split_inline(inner)
            .into_iter()
            .map(|s| scalar_to_json(&s))
            .collect();
        return serde_json::Value::Array(items);
    }
    if raw.starts_with('{') && raw.ends_with('}') {
        let inner = &raw[1..raw.len() - 1];
        let mut map = serde_json::Map::new();
        for part in split_inline(inner) {
            if let Some((k, v)) = strip_key(part.trim()) {
                map.insert(k, scalar_to_json(&v));
            }
        }
        return serde_json::Value::Object(map);
    }

    if raw.len() >= 2
        && ((raw.starts_with('"') && raw.ends_with('"'))
            || (raw.starts_with('\'') && raw.ends_with('\'')))
    {
        let inner = &raw[1..raw.len() - 1];
        if raw.starts_with('"') {
            // A double-quoted scalar is JSON-escaped by the writer, so decode it
            // rather than keeping the backslashes visible in the UI.
            if let Ok(s) = serde_json::from_str::<String>(raw) {
                return serde_json::Value::String(s);
            }
        }
        // Single quotes are literal in YAML, except `''` for an embedded quote.
        return serde_json::Value::String(inner.replace("''", "'"));
    }

    match raw {
        "true" => return serde_json::Value::Bool(true),
        "false" => return serde_json::Value::Bool(false),
        "null" | "~" => return serde_json::Value::Null,
        _ => {}
    }

    // A dotted scalar is always text.
    //
    // This looks like a lossy rule and is the opposite. Every dotted scalar in
    // this format is a version, and versions are text: `3.10` and `3.1` are
    // different releases that a float cannot tell apart, and `3.14` happens to
    // round-trip through `f64` so no amount of round-trip checking separates the
    // two cases reliably.
    //
    // Treating them all as text means the only cost is that a hypothetical
    // `size: 1.5` arrives as `"1.5"` — and nothing in this schema reads a
    // dotted value as a number. Whereas the alternative cost is a version note
    // silently attached to the wrong release, which is the kind of failure a
    // student cannot see and cannot report.
    if raw.contains('.') && raw.parse::<f64>().is_ok() {
        return serde_json::Value::String(raw.to_string());
    }

    if let Ok(n) = raw.parse::<i64>() {
        return serde_json::Value::Number(n.into());
    }
    if let Ok(f) = raw.parse::<f64>() {
        if let Some(n) = serde_json::Number::from_f64(f) {
            return serde_json::Value::Number(n);
        }
    }
    serde_json::Value::String(raw.to_string())
}

/// Splits an inline collection on commas that are not inside quotes.
fn split_inline(inner: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    for c in inner.chars() {
        match c {
            '\'' if !in_double => {
                in_single = !in_single;
                current.push(c);
            }
            '"' if !in_single => {
                in_double = !in_double;
                current.push(c);
            }
            ',' if !in_single && !in_double => {
                out.push(std::mem::take(&mut current));
            }
            _ => current.push(c),
        }
    }
    if !current.trim().is_empty() {
        out.push(current);
    }
    out
}

/// Encodes a string as a JSON literal, for round-tripping block scalars.
fn json_string(s: &str) -> String {
    serde_json::Value::String(s.to_string()).to_string()
}

// ---------------------------------------------------------------------------
// Compiled-in knowledge
// ---------------------------------------------------------------------------

/// The knowledge files compiled into the binary.
///
/// Compiled in for the same reason profiles are: the app must be able to explain
/// itself even when the resource directory is missing. The `.yaml` files on disk
/// remain the editable source of truth — `src-tauri/knowledge/` is what ships as
/// a resource, and a `knowledge_matches_builtin` test asserts the two do not
/// drift, exactly as the profile store does.
///
/// The second tuple element marks concept files. Carrying it here rather than
/// inferring from the id keeps the two namespaces — software and concepts —
/// explicitly separate, which is what stops "PATH" turning up in the software
/// list.
const BUILTIN: &[(&str, bool)] = &[
    (include_str!("../../../knowledge/concept/cuda.yaml"), true),
    (include_str!("../../../knowledge/concept/mcp.yaml"), true),
    (include_str!("../../../knowledge/concept/path.yaml"), true),
    (include_str!("../../../knowledge/concept/virtualenv.yaml"), true),
    (include_str!("../../../knowledge/concept/wsl.yaml"), true),
    (include_str!("../../../knowledge/software/capcut.yaml"), false),
    (include_str!("../../../knowledge/software/cc_switch.yaml"), false),
    (include_str!("../../../knowledge/software/chatbox.yaml"), false),
    (include_str!("../../../knowledge/software/chatgpt_desktop.yaml"), false),
    (include_str!("../../../knowledge/software/cherry_studio.yaml"), false),
    (include_str!("../../../knowledge/software/claude_code.yaml"), false),
    (include_str!("../../../knowledge/software/claude_desktop.yaml"), false),
    (include_str!("../../../knowledge/software/cmake.yaml"), false),
    (include_str!("../../../knowledge/software/codex.yaml"), false),
    (include_str!("../../../knowledge/software/comfyui.yaml"), false),
    (include_str!("../../../knowledge/software/continue.yaml"), false),
    (include_str!("../../../knowledge/software/crush.yaml"), false),
    (include_str!("../../../knowledge/software/cursor.yaml"), false),
    (include_str!("../../../knowledge/software/docker.yaml"), false),
    (include_str!("../../../knowledge/software/doubao.yaml"), false),
    (include_str!("../../../knowledge/software/gemini.yaml"), false),
    (include_str!("../../../knowledge/software/gemini_desktop.yaml"), false),
    (include_str!("../../../knowledge/software/git.yaml"), false),
    (include_str!("../../../knowledge/software/java.yaml"), false),
    (include_str!("../../../knowledge/software/jianying_pro.yaml"), false),
    (include_str!("../../../knowledge/software/jetbrains.yaml"), false),
    (include_str!("../../../knowledge/software/kimi_cli.yaml"), false),
    (include_str!("../../../knowledge/software/lm_studio.yaml"), false),
    (include_str!("../../../knowledge/software/msvc_build_tools.yaml"), false),
    (include_str!("../../../knowledge/software/node.yaml"), false),
    (include_str!("../../../knowledge/software/npm.yaml"), false),
    (include_str!("../../../knowledge/software/opencode.yaml"), false),
    (include_str!("../../../knowledge/software/pnpm.yaml"), false),
    (include_str!("../../../knowledge/software/python.yaml"), false),
    (include_str!("../../../knowledge/software/qwen_code.yaml"), false),
    (include_str!("../../../knowledge/software/rust.yaml"), false),
    (include_str!("../../../knowledge/software/uv.yaml"), false),
    (include_str!("../../../knowledge/software/vscode.yaml"), false),
    (include_str!("../../../knowledge/software/windows_terminal.yaml"), false),
    (include_str!("../../../knowledge/software/windsurf.yaml"), false),
    (include_str!("../../../knowledge/software/wsl.yaml"), false),
];

#[cfg(test)]
mod tests;

#[cfg(test)]
mod yaml_tests;

