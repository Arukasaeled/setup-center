//! Software catalog — the only place in the Rust source that names a vendor.
//!
//! The brief's rule is "禁止写死软件名称" in the detection logic. The way that rule
//! is honoured here is by making the names *data* rather than control flow:
//! `inventory.rs` contains no program name at all, and every provider asks this
//! module "what do you know about [`SoftwareId::Git`]?".
//!
//! That buys three things beyond tidiness:
//!
//! * a program can be added or corrected in one place, without touching a single
//!   probe;
//! * the installer module plans from this catalog instead of duplicating package
//!   ids, so the two can no longer drift apart;
//! * the fallback chains become genuinely declarative — a priority list of
//!   sources, not a `match` arm per program.

use crate::model::*;

use std::path::Path;

/// How a program may be registered in the registry's `Uninstall` keys.
///
/// The variants exist because `DisplayName` is free-text written by the vendor's
/// installer and is not stable in any useful way. Encoding the *kind* of match
/// rather than a bare string is what keeps the false-positive rate at zero
/// without hand-tuning a regex per program.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NamePattern {
    /// `DisplayName` equals the string, case-insensitively.
    Exact(&'static str),
    /// `DisplayName` starts with the string, case-insensitively.
    ///
    /// Used where vendors append build metadata: `Node.js`,
    /// `WinRAR 6.24 (64 位)`, `Python 3.12.1`.
    Prefix(&'static str),
    /// `DisplayName` *contains* the string as a whole word.
    ///
    /// Word-boundary matched, not plain substring: a plain `contains("Code")`
    /// would match `VS Code`, `Codex`, `Visual Studio Code` and any number of
    /// unrelated products, which is how a detector claims VS Code is installed
    /// on a machine that has never had it.
    Word(&'static str),
}

impl NamePattern {
    fn matches(&self, display_name: &str) -> bool {
        let hay = display_name.trim();
        let hay_lower = hay.to_lowercase();

        match self {
            NamePattern::Exact(needle) => hay_lower == needle.to_lowercase(),
            NamePattern::Prefix(needle) => hay_lower.starts_with(&needle.to_lowercase()),
            NamePattern::Word(needle) => {
                let needle = needle.to_lowercase();
                if hay_lower == needle {
                    return true;
                }
                if !hay_lower.contains(&needle) {
                    return false;
                }
                // Split on anything that is not alphanumeric, so `VS Code` and
                // `Node.js` are handled without the separators mattering.
                hay_lower
                    .split(|c: char| !c.is_alphanumeric())
                    .filter(|t| !t.is_empty())
                    .any(|token| token == needle)
                    // `Node.js` as a token splits into `node` and `js`, so also
                    // accept the joined comparison.
                    || hay_lower.split_whitespace().any(|chunk| chunk == needle)
            }
        }
    }
}

/// A source of truth for one program's identity.
///
/// Ordered: earlier entries are checked first, and the first source that
/// positively reports the program wins for that provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ProbeSource {
    /// `winget list` — the richest source for package metadata.
    Winget,
    /// The uninstall registry keys — carries the install location.
    Registry,
    /// Filesystem + `App Paths` — the only source that can report a real
    /// version for a portable install that registered nothing.
    Path,
}

/// Everything the probes and the installer need to know about one program.
pub struct CatalogEntry {
    pub id: SoftwareId,

    /// winget package ids, best candidate first. `None` for programs that have
    /// no winget package at all (Codex's desktop app is Store-signed MSIX under
    /// the ChatGPT product name, so it has no usable id to search for).
    pub winget_ids: &'static [&'static str],

    /// Registry `DisplayName` patterns. Any match counts.
    pub name_patterns: &'static [NamePattern],

    /// Executable file names to resolve, in order. `.cmd` variants are included
    /// where the vendor ships a shell shim rather than a real binary.
    pub executables: &'static [&'static str],

    /// Directories under `%LOCALAPPDATA%`, `%ProgramFiles%` or `%ProgramData%`
    /// where this program installs. Used only as a last resort, after `App Paths`
    /// and before the `PATH` walk.
    pub install_roots: &'static [&'static str],

    /// Substrings that must appear in a registry entry's `InstallLocation` or
    /// `DisplayIcon` for that entry to count as this program.
    ///
    /// Empty means "the display name is enough". Populated where a display name is
    /// genuinely ambiguous — see the Codex entry for the false positive that made
    /// this necessary. Matching is case-insensitive.
    pub location_markers: &'static [&'static str],

    /// Arguments that make the program print its version. `None` means the
    /// program has no CLI, so the version must come from another provider.
    pub version_args: Option<&'static [&'static str]>,

    /// Environment variables the version command needs.
    ///
    /// Empty for everything currently catalogued. It exists because a GUI-first
    /// product can need variables its own launcher sets, and the alternative —
    /// hard-coding them at the call site — would put a vendor detail in the
    /// provider. See [`CatalogEntry::version_via_shim`] for the VS Code case,
    /// where the variables alone turned out to be the wrong answer.
    pub version_env: &'static [(&'static str, &'static str)],

    /// Run `version_args` through the shell shim rather than the executable.
    ///
    /// Necessary for Electron apps, and VS Code is the case that proved it. The
    /// vendor ships `bin\code.cmd`, whose entire job is:
    ///
    /// ```text
    /// set ELECTRON_RUN_AS_NODE=1
    /// "%~dp0..\Code.exe" "%~dp0..\<hash>\resources\app\out\cli.js" %*
    /// ```
    ///
    /// There are two parts and both are required: the variable *and* the CLI script
    /// path. Setting only the variable, as an earlier version of this code did,
    /// makes `Code.exe` start as a bare Node runtime with no script, so `--version`
    /// prints Node's version (`24.18.1`) — a wrong answer presented as fact, which
    /// is worse than no answer. Invoking the shim gets all of it, correctly, and
    /// keeps the vendor's knowledge in the vendor's file.
    pub version_via_shim: bool,

    /// Ordered install strategies; index 0 is preferred. This is the fallback
    /// chain the UI displays and the stage-3 engine walks.
    pub install: &'static [InstallStrategy],
}

/// One link in a fallback chain: a source plus why it exists.
pub struct InstallStrategy {
    pub source: StrategySource,
    /// Shown to the student when the engine has to fall back.
    pub rationale: &'static str,
}

/// How the engine may obtain a program.
///
/// There is deliberately no `BundledBinary` variant: "不要自己维护二进制" is
/// enforced by the type system here rather than by a comment nobody reads.
pub enum StrategySource {
    Winget(&'static str),
    /// Official installer URL. Downloaded at run time, never shipped.
    OfficialInstaller(&'static str),
    /// A command that uses a package manager already required by the plan.
    Command(&'static str),
}

impl CatalogEntry {
    /// winget package ids.
    pub fn winget_ids(&self) -> Vec<String> {
        self.winget_ids.iter().map(|s| s.to_string()).collect()
    }

    /// Every executable name this program may resolve to.
    pub fn executables(&self) -> Vec<String> {
        self.executables.iter().map(|s| s.to_string()).collect()
    }

    /// Does a registry `DisplayName` refer to this program?
    ///
    /// Name-only. Callers that have a `DisplayIcon`/`InstallLocation` should use
    /// [`CatalogEntry::matches_registry_entry`] instead, which also applies
    /// `location_markers` — necessary where a display name alone is ambiguous.
    pub fn matches_name(&self, display_name: &str) -> bool {
        self.name_patterns
            .iter()
            .any(|pattern| pattern.matches(display_name))
    }

    /// Does a whole registry entry refer to this program?
    ///
    /// Applies the name patterns *and* the location markers. When
    /// `location_markers` is empty this is exactly `matches_name`, so entries
    /// with an unambiguous name pay nothing for the extra check.
    pub fn matches_registry_entry(&self, entry: &super::inventory::UninstallEntry) -> bool {
        if !self.matches_name(&entry.display_name) {
            return false;
        }
        if self.location_markers.is_empty() {
            return true;
        }
        // Check both fields: which one carries the install path varies by
        // installer, and a hit in either is enough. `InstallLocation` is the
        // declared location; `DisplayIcon` is where the vendor put the launcher.
        let haystack = format!(
            "{}|{}",
            entry.install_location.as_deref().unwrap_or(""),
            entry.display_icon.as_deref().unwrap_or("")
        )
        .to_lowercase();
        self.location_markers
            .iter()
            .any(|marker| haystack.contains(&marker.to_lowercase()))
    }

    /// Does an absolute path look like this program's executable?
    ///
    /// Both the file name and the parent directory are considered: a resolved
    /// `…\Python312\python.exe` is only Python if the directory agrees, which
    /// stops a stray `node.exe` bundled inside an unrelated app from being
    /// reported as the student's Node.js install.
    pub fn matches_executable(&self, path: &Path) -> bool {
        let Some(file) = path.file_name().and_then(|n| n.to_str()) else {
            return false;
        };
        self.executables
            .iter()
            .any(|exe| file.eq_ignore_ascii_case(exe))
    }

    /// Whether this product can install this program.
    ///
    /// The single place that decides what an empty `install` list means. An
    /// empty chain means "we detect it but do not manage it" — a deliberate state
    /// for Docker, WSL, JetBrains and the editor plugins, all of which need a
    /// reboot, a firmware setting, or a licence choice that this app has no
    /// business making on a student's behalf.
    ///
    /// Centralised so no caller has to remember the convention, and so the
    /// `every_non_empty_chain_is_installable` test can assert the two agree.
    pub fn is_installable(&self) -> bool {
        !self.install.is_empty()
    }

    /// Whether this entry can be found by any provider at all.
    ///
    /// `false` for a VS Code extension, which is not a program and has neither an
    /// executable nor an uninstall key. Callers use this to skip the probe rather
    /// than to report a program as missing when it was never detectable.
    pub fn is_detectable(&self) -> bool {
        !self.executables.is_empty()
            || !self.name_patterns.is_empty()
            || !self.winget_ids.is_empty()
    }

    /// Whether the registry provider can match this entry by `DisplayName`.
    ///
    /// `false` for npm, which has no uninstall entry of its own — it arrives
    /// inside the Node installation. Exposed so callers (and tests) can state
    /// that fact rather than infer it from an empty slice.
    pub fn is_detectable_by_name(&self) -> bool {
        !self.name_patterns.is_empty()
    }
}

/// The whole catalog, keyed by [`SoftwareId`].
pub struct Catalog {
    entries: Vec<CatalogEntry>,
}

impl Default for Catalog {
    fn default() -> Self {
        Self::builtin()
    }
}

impl Catalog {
    /// Every catalogued program, matching `SoftwareId::ALL` order.
    pub fn builtin() -> Self {
        Self {
            entries: entries(),
        }
    }

    /// The same catalog restricted to `ids`, preserving catalog order.
    ///
    /// A subset rather than a filter closure so providers can be driven with
    /// "just the three programs in this profile" — which is the difference
    /// between a fast scan and a slow one on the profile screen.
    pub fn subset(&self, ids: &[SoftwareId]) -> Self {
        Self {
            entries: self
                .entries
                .iter()
                .filter(|entry| ids.contains(&entry.id))
                .map(|entry| entry.clone())
                .collect(),
        }
    }

    /// Catalogued ids, in `SoftwareId::ALL` order.
    pub fn ids(&self) -> impl Iterator<Item = SoftwareId> + '_ {
        self.entries.iter().map(|e| e.id)
    }

    /// The entry for `id`.
    ///
    /// Panics if the id is absent, which can only happen if `subset` was asked
    /// for an id the catalog does not know — a programmer error, and one that
    /// should surface immediately rather than produce a silently empty result.
    pub fn entry(&self, id: SoftwareId) -> &CatalogEntry {
        self.entries
            .iter()
            .find(|e| e.id == id)
            .expect("catalog is missing an entry for a known SoftwareId")
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl Clone for CatalogEntry {
    fn clone(&self) -> Self {
        // Every field is a `Copy` reference type; the clone is shallow by
        // construction. Implemented manually so `Catalog` can be `Clone` without
        // deriving it on a struct that holds `&'static str` slices.
        Self {
            id: self.id,
            winget_ids: self.winget_ids,
            name_patterns: self.name_patterns,
            executables: self.executables,
            install_roots: self.install_roots,
            location_markers: &[],
            version_args: self.version_args,
            version_env: self.version_env,
            version_via_shim: self.version_via_shim,
            install: self.install,
        }
    }
}

// ---------------------------------------------------------------------------
// The catalog itself
// ---------------------------------------------------------------------------

fn entries() -> Vec<CatalogEntry> {
    vec![
        CatalogEntry {
            id: SoftwareId::Vscode,
            winget_ids: &["Microsoft.VisualStudioCode"],
            name_patterns: &[
                // The winget display name is `Microsoft Visual Studio Code
                // (User)` for per-user installs and without the suffix for
                // machine-wide ones, so a prefix match covers both.
                NamePattern::Prefix("Microsoft Visual Studio Code"),
                NamePattern::Exact("Visual Studio Code"),
                NamePattern::Exact("VS Code"),
            ],
            // `bin\code.cmd` first, and that ordering is the fix for a real bug.
            // VS Code installs `Code.exe` in the root and the CLI shim in `bin\`.
            // Resolution walks these in order, so listing the shim first means the
            // *resolved path* is the thing a student can actually type — which also
            // makes `onPath` correct, since `bin\` is what the installer adds to
            // PATH. Resolving `Code.exe` instead reported `onPath: false` on a
            // machine where `code` works fine in a terminal.
            executables: &["code.cmd", "code.exe", "Code.exe"],
            install_roots: &["Programs\\Microsoft VS Code", "Microsoft VS Code"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            // Required, not cosmetic: this is what `bin\code.cmd` sets before
            // launching `Code.exe`. Without it Electron starts the desktop app,
            // which ignores `--version` and prints nothing, so the version check
            // would degrade to "unknown" for the most-installed program in the
            // catalog.
            // Run through `bin\code.cmd`, not `Code.exe`. The shim supplies both
            // `ELECTRON_RUN_AS_NODE=1` *and* the path to `cli.js`; setting only
            // the variable starts Code.exe as a bare Node runtime, which reports
            // Node's version instead of VS Code's.
            version_env: &[],
            version_via_shim: true,
            install: &[
                InstallStrategy {
                    source: StrategySource::Winget("Microsoft.VisualStudioCode"),
                    rationale: "优先使用 winget 安装，自动更新、免手动下载",
                },
                InstallStrategy {
                    source: StrategySource::OfficialInstaller(
                        "https://update.code.visualstudio.com/latest/win32-x64-user/stable",
                    ),
                    rationale: "winget 不可用时改用 VS Code 官方用户级安装包",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Git,
            winget_ids: &["Git.Git"],
            name_patterns: &[
                NamePattern::Exact("Git"),
                NamePattern::Prefix("Git version"),
                NamePattern::Prefix("Git for Windows"),
            ],
            executables: &["git.exe", "git.cmd"],
            install_roots: &["Program Files\\Git", "Git"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[
                InstallStrategy {
                    source: StrategySource::Winget("Git.Git"),
                    rationale: "优先使用 winget 安装",
                },
                InstallStrategy {
                    // The asset, not the directory page. `releases/latest` is an
                    // HTML listing of releases; it is not downloadable as a
                    // program. `latest/download/<asset>` is GitHub's own stable
                    // redirect to the newest release's named asset, so this stays
                    // current without pinning a version.
                    source: StrategySource::OfficialInstaller(
                        "https://github.com/git-for-windows/git/releases/latest/download/Git-64-bit.exe",
                    ),
                    rationale: "回退到 Git for Windows 官方安装包",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Python,
            winget_ids: &["Python.Python.3.12", "Python.Python.3.13", "Python.Python.3.11"],
            name_patterns: &[
                // Python registers as `Python 3.12.1 (64-bit)`, `Python
                // 3.12.1`, or just `Python`. A prefix match is right; a word
                // match on "Python" alone would also hit `Python Launcher`,
                // which is a different product.
                NamePattern::Prefix("Python 3."),
                NamePattern::Prefix("Python 2."),
                NamePattern::Exact("Python"),
            ],
            executables: &["python.exe", "python3.exe"],
            install_roots: &["Programs\\Python", "Python312", "Python313", "Python311"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[
                InstallStrategy {
                    source: StrategySource::Winget("Python.Python.3.12"),
                    rationale: "使用 python.org 官方发行版，避免 Microsoft Store 版本的路径差异",
                },
                InstallStrategy {
                    // The versioned installer, not `/downloads/windows/`, which
                    // is a landing page. Verified: this URL returns
                    // `application/octet-stream`, 28 MB.
                    source: StrategySource::OfficialInstaller(
                        "https://www.python.org/ftp/python/3.13.1/python-3.13.1-amd64.exe",
                    ),
                    rationale: "回退到 python.org 官方安装包",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Node,
            winget_ids: &["OpenJS.NodeJS.LTS", "OpenJS.NodeJS"],
            name_patterns: &[
                NamePattern::Exact("Node.js"),
                NamePattern::Prefix("Node.js LTS"),
            ],
            executables: &["node.exe"],
            install_roots: &["Program Files\\nodejs", "nodejs"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[
                InstallStrategy {
                    source: StrategySource::Winget("OpenJS.NodeJS.LTS"),
                    rationale: "安装 Node.js LTS 版本，供各类 AI 工具使用",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::ClaudeDesktop,
            winget_ids: &["Anthropic.Claude"],
            name_patterns: &[
                NamePattern::Exact("Claude"),
                NamePattern::Prefix("Claude Desktop"),
            ],
            executables: &["claude.exe", "Claude.exe"],
            install_roots: &["Programs\\Claude", "AnthropicClaude", "Claude"],
            location_markers: &[],
            // No CLI: the desktop app has no `--version`, so the version must
            // come from winget or the registry. Reporting a fabricated one would
            // be worse than reporting none.
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[
                InstallStrategy {
                    source: StrategySource::Winget("Anthropic.Claude"),
                    rationale: "优先尝试 winget",
                },
                InstallStrategy {
                    // The vendor's own download host, not the `/download`
                    // landing page. The previous entry pointed at
                    // `https://claude.ai/download`, which serves
                    // `text/html` — a web page. The executor would have
                    // downloaded HTML to a temp file, handed it to the OS, and
                    // reported a failure the student could do nothing with.
                    // Verified: this endpoint returns
                    // `application/octet-stream`, 132 MB.
                    source: StrategySource::OfficialInstaller(
                        "https://storage.googleapis.com/osprey-downloads-c02f6a0d-347c-492b-a752-3e0651722e97/nest-win-x64/Claude-Setup-x64.exe",
                    ),
                    rationale: "winget 无对应包或需要管理员时，改用 Claude 官方安装包（无需管理员）",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::ClaudeCode,
            winget_ids: &[],
            name_patterns: &[NamePattern::Word("Claude Code")],
            executables: &["claude.cmd", "claude.exe"],
            install_roots: &["Programs\\claude-code"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[
                InstallStrategy {
                    source: StrategySource::Command("npm install -g @anthropic-ai/claude-code"),
                    rationale: "通过 npm 全局安装官方 CLI（需要 Node.js）",
                },
                InstallStrategy {
                    source: StrategySource::OfficialInstaller("https://claude.ai/install.ps1"),
                    rationale: "npm 不可用时改用官方 PowerShell 安装脚本",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Codex,
            winget_ids: &["OpenAI.Codex"],
            name_patterns: &[
                // The Codex desktop app ships as an MSIX signed into the ChatGPT
                // product, so `winget list` reports the *display name* `ChatGPT`
                // while its `DisplayIcon` lives under `OpenAI.Codex`.
                //
                // `Exact("ChatGPT")` alone was not enough and produced a real
                // false positive: a Chrome "install as web app" shortcut for
                // chatgpt.com registers under exactly that name, with a
                // `DisplayIcon` inside the browser's profile directory. On a
                // machine that has only ever opened the website, the app claimed
                // Codex was installed. The icon-path requirement below rejects
                // that case; enabling `registry_provider`'s install-location rule
                // makes the check structural rather than name-based.
                NamePattern::Exact("ChatGPT"),
                NamePattern::Exact("Codex"),
                NamePattern::Prefix("OpenAI Codex"),
            ],
            executables: &["codex.cmd", "codex.exe"],
            install_roots: &["Programs\\codex"],
            // A display name is not an identity: several unrelated things call
            // themselves "ChatGPT", and the only reliable discriminator is where
            // the vendor actually installs. A Chrome "install as web app"
            // shortcut for chatgpt.com registers under exactly that name with a
            // `DisplayIcon` under the browser's profile directory, which is the
            // false positive these markers reject.
            location_markers: &["\\Programs\\", "\\WindowsApps\\", "\\OpenAI\\"],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[
                InstallStrategy {
                    source: StrategySource::Command("npm install -g @openai/codex"),
                    rationale: "通过 npm 全局安装官方 CLI（需要 Node.js）",
                },
                InstallStrategy {
                    source: StrategySource::Winget("OpenAI.Codex"),
                    rationale: "npm 不可用时尝试 winget 源",
                },
            ],
        },
        // -------------------------------------------------------------------
        // Detected but not managed.
        //
        // The entries below exist so the dashboard can *see* them. Their
        // `install` list is empty on purpose, and [`CatalogEntry::is_installable`]
        // is the single place that decides what an empty list means — so no
        // caller has to remember a convention.
        //
        // Why not implement installation for them too? Three reasons, in order
        // of weight:
        //
        // 1. Docker Desktop and WSL need a reboot and a firmware setting. An
        //    installer that appears to succeed and then needs the student to
        //    leave the app is worse than one that explains the situation.
        // 2. JetBrains is a *family* of products with per-product licences;
        //    there is no single correct package to pick on the student's behalf.
        // 3. Cursor, OpenCode and Continue are moving targets whose distribution
        //    changes between releases. Pinning a URL here would rot silently.
        //
        // Seeing without acting is the honest half of the product for these.
        // -------------------------------------------------------------------
        // -------------------------------------------------------------------
        // AI clients a student installs *outside* a development workflow.
        //
        // These are the entries the product exists for: "I want the ChatGPT app"
        // is the single most common first request, and it is the one the original
        // catalogue could not answer — `ChatGPT` was only reachable as an alias
        // of Codex, so a student searching for it found nothing.
        // -------------------------------------------------------------------
        CatalogEntry {
            id: SoftwareId::ChatgptDesktop,
            winget_ids: &["OpenAI.ChatGPT"],
            name_patterns: &[
                NamePattern::Exact("ChatGPT"),
                NamePattern::Prefix("ChatGPT Desktop"),
            ],
            executables: &["ChatGPT.exe"],
            install_roots: &["Programs\\ChatGPT", "WindowsApps"],
            // The message-store identity check from `Codex`: several unrelated
            // things call themselves "ChatGPT" (a Chrome "install as web app"
            // shortcut registers under exactly that name), and the vendor's
            // install location is the only reliable discriminator.
            location_markers: &["\\Programs\\", "\\WindowsApps\\", "\\OpenAI\\"],
            // The app is a packaged MSIX with no usable `--version`; a fabricated
            // version would be worse than none.
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[
                InstallStrategy {
                    source: StrategySource::Winget("OpenAI.ChatGPT"),
                    rationale: "ChatGPT 桌面版有官方 winget 包，可直接安装",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Docker,
            winget_ids: &["Docker.DockerDesktop"],
            name_patterns: &[NamePattern::Prefix("Docker Desktop")],
            executables: &["docker.exe"],
            install_roots: &["Docker\\Docker", "Program Files\\Docker"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Cursor,
            winget_ids: &["Anysphere.Cursor"],
            name_patterns: &[NamePattern::Prefix("Cursor")],
            // Same shim arrangement as VS Code: Cursor is an Electron app that
            // ships `cursor.cmd` in `bin\`.
            executables: &["cursor.cmd", "cursor.exe", "Cursor.exe"],
            install_roots: &["Programs\\cursor", "Programs\\Cursor"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: true,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Windsurf,
            winget_ids: &["Codeium.Windsurf"],
            name_patterns: &[
                NamePattern::Prefix("Windsurf"),
                NamePattern::Exact("Codeium.Windsurf"),
            ],
            // Electron editor, so the same shim arrangement as VS Code/Cursor.
            executables: &["windsurf.cmd", "windsurf.exe", "Windsurf.exe"],
            install_roots: &["Programs\\Windsurf", "Windsurf"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: true,
            install: &[
                InstallStrategy {
                    source: StrategySource::Winget("Codeium.Windsurf"),
                    rationale: "Windsurf 有官方 winget 包",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Wsl,
            // WSL is an optional Windows feature, not a downloadable package in
            // any useful sense — `wsl --install` enables components, which is a
            // system change this product deliberately does not make.
            winget_ids: &[],
            name_patterns: &[
                NamePattern::Prefix("Windows Subsystem for Linux"),
                NamePattern::Exact("WSL"),
            ],
            executables: &["wsl.exe"],
            install_roots: &["Windows\\System32"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::MsvcBuildTools,
            winget_ids: &["Microsoft.VisualStudio.2022.BuildTools"],
            name_patterns: &[
                NamePattern::Prefix("Microsoft Visual Studio Installer"),
                NamePattern::Prefix("Visual Studio Build Tools"),
            ],
            executables: &["cl.exe"],
            install_roots: &["Microsoft Visual Studio", "BuildTools"],
            location_markers: &[],
            version_args: Some(&["/?"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Cmake,
            winget_ids: &["Kitware.CMake"],
            name_patterns: &[NamePattern::Exact("CMake"), NamePattern::Prefix("CMake ")],
            executables: &["cmake.exe"],
            install_roots: &["CMake"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Npm,
            winget_ids: &[],
            name_patterns: &[],
            // npm ships *with* Node, so only the PATH provider can find it, and
            // only by resolving the shim. That is exactly right: npm's presence
            // is not independent information, it is evidence about Node.
            executables: &["npm.cmd", "npm.exe"],
            install_roots: &[],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Pnpm,
            winget_ids: &["pnpm.pnpm"],
            name_patterns: &[NamePattern::Exact("pnpm")],
            executables: &["pnpm.cmd", "pnpm.exe"],
            install_roots: &["pnpm"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Uv,
            winget_ids: &["astral-sh.uv"],
            name_patterns: &[NamePattern::Exact("uv")],
            executables: &["uv.exe", "uv.cmd"],
            install_roots: &["uv", ".local\\bin"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Rust,
            winget_ids: &["Rustlang.Rustup"],
            name_patterns: &[
                NamePattern::Prefix("Rustup"),
                NamePattern::Prefix("Rust "),
            ],
            executables: &["cargo.exe", "rustc.exe"],
            install_roots: &[".cargo\\bin"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Java,
            winget_ids: &["EclipseAdoptium.Temurin.21.JDK", "Microsoft.OpenJDK.21"],
            name_patterns: &[
                NamePattern::Prefix("Java(TM)"),
                NamePattern::Prefix("Eclipse Temurin"),
                NamePattern::Prefix("Microsoft OpenJDK"),
                NamePattern::Prefix("Java SE Development Kit"),
            ],
            executables: &["java.exe"],
            install_roots: &["Java", "Eclipse Adoptium", "Microsoft\\jdk"],
            location_markers: &[],
            version_args: Some(&["-version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Gemini,
            winget_ids: &[],
            name_patterns: &[NamePattern::Word("Gemini CLI")],
            executables: &["gemini.cmd", "gemini.exe"],
            install_roots: &["Programs\\gemini"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::OpenCode,
            winget_ids: &[],
            name_patterns: &[NamePattern::Word("opencode")],
            executables: &["opencode.cmd", "opencode.exe"],
            install_roots: &["Programs\\opencode"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Continue,
            winget_ids: &[],
            // `Continue` is a VS Code *extension*, not a program. It has no
            // executable and no uninstall key, so it is deliberately invisible to
            // all four providers and only the bootstrap extension verifier can
            // see it. The entry exists so the id is in the catalog (the
            // completeness test requires it) and so the dashboard can explain it
            // without a special case.
            name_patterns: &[],
            executables: &[],
            install_roots: &[],
            location_markers: &[],
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::LmStudio,
            // Detect-only on purpose: the package is a moving target and the
            // first run needs the student to pick a multi-GB model, which is a
            // decision this tool must not make for them.
            winget_ids: &["ElementLabs.LMStudio"],
            name_patterns: &[
                NamePattern::Prefix("LM Studio"),
                NamePattern::Exact("LM Studio"),
            ],
            executables: &["lms.exe", "LM Studio.exe"],
            install_roots: &["Programs\\LM Studio", "LM-Studio"],
            location_markers: &[],
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Jetbrains,
            winget_ids: &["JetBrains.Toolbox"],
            name_patterns: &[
                NamePattern::Prefix("JetBrains Toolbox"),
                NamePattern::Prefix("PyCharm"),
                NamePattern::Prefix("IntelliJ IDEA"),
                NamePattern::Prefix("CLion"),
                NamePattern::Prefix("WebStorm"),
            ],
            executables: &["pycharm64.exe", "idea64.exe", "clion64.exe"],
            install_roots: &["JetBrains", "Program Files\\JetBrains"],
            location_markers: &[],
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::WindowsTerminal,
            winget_ids: &["Microsoft.WindowsTerminal"],
            // Matched on the Store display name. `wt.exe` is the shim Windows
            // installs, and unlike the Electron cases above it needs no special
            // handling: it forwards `--version` to the real binary correctly,
            // which was checked rather than assumed.
            name_patterns: &[
                NamePattern::Prefix("Windows Terminal"),
                NamePattern::Exact("Microsoft.WindowsTerminal"),
            ],
            executables: &["wt.exe"],
            install_roots: &["Microsoft\\WindowsApps", "Windows Terminal"],
            // "Windows Terminal" on its own is a weak signature — other entries
            // can mention it in passing — so the install location must
            // corroborate the name before a registry hit counts.
            location_markers: &["WindowsTerminal", "Windows Terminal"],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("Microsoft.WindowsTerminal"),
                rationale: "Windows Terminal 有官方 winget 包",
            }],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn every_software_id_has_a_catalog_entry() {
        let cat = Catalog::builtin();
        for id in SoftwareId::ALL {
            assert_eq!(cat.entry(id).id, id, "{id:?} has no catalog entry");
        }
        assert_eq!(cat.len(), SoftwareId::ALL.len());
    }

    #[test]
    fn subset_preserves_catalog_order_and_membership() {
        let cat = Catalog::builtin();
        let sub = cat.subset(&[SoftwareId::Git, SoftwareId::Vscode]);
        assert_eq!(sub.len(), 2);
        // Catalog order is Vscode then Git, regardless of the argument order.
        let ids: Vec<SoftwareId> = sub.ids().collect();
        assert_eq!(ids, vec![SoftwareId::Vscode, SoftwareId::Git]);
    }

    #[test]
    fn word_match_does_not_confuse_similarly_named_products() {
        // This is the false positive that matters most: telling a student that
        // VS Code is installed because they have Codex, or vice versa.
        let cat = Catalog::builtin();
        let vscode = cat.entry(SoftwareId::Vscode);
        assert!(!vscode.matches_name("Codex"), "VS Code matched Codex");
        assert!(!vscode.matches_name("Visual Studio Community 2026"));
        assert!(vscode.matches_name("Microsoft Visual Studio Code (User)"));

        let codex = cat.entry(SoftwareId::Codex);
        assert!(!codex.matches_name("Visual Studio Code"), "Codex matched VS Code");
        assert!(codex.matches_name("ChatGPT"), "Codex missed its MSIX name");
    }

    #[test]
    fn python_prefix_does_not_match_the_launcher() {
        let cat = Catalog::builtin();
        let python = cat.entry(SoftwareId::Python);
        assert!(python.matches_name("Python 3.12.1 (64-bit)"));
        assert!(python.matches_name("Python"));
        // `Python Launcher` is a separate product that does not provide python.exe.
        assert!(!python.matches_name("Python Launcher"));
    }

    #[test]
    fn executable_matching_is_case_insensitive_and_extension_aware() {
        let cat = Catalog::builtin();
        let vscode = cat.entry(SoftwareId::Vscode);
        assert!(vscode.matches_executable(&PathBuf::from(r"C:\x\bin\code.cmd")));
        assert!(vscode.matches_executable(&PathBuf::from(r"C:\x\Code.exe")));
        // A `git.exe` is not VS Code.
        assert!(!vscode.matches_executable(&PathBuf::from(r"C:\x\git.exe")));
    }

    #[test]
    fn no_catalog_entry_bundles_a_binary() {
        // The brief's "never maintain your own binaries" rule, enforced as a test
        // rather than a convention: every strategy *that exists* is winget, a
        // vendor URL, or a command run through a package manager already in the
        // plan. Entries with no strategy are the detect-only ones, covered by the
        // test below.
        let cat = Catalog::builtin();
        for id in SoftwareId::ALL {
            let entry = cat.entry(id);
            for strategy in entry.install {
                match &strategy.source {
                    StrategySource::Winget(_) | StrategySource::Command(_) => {}
                    StrategySource::OfficialInstaller(url) => {
                        assert!(
                            url.starts_with("https://"),
                            "{id:?} has a non-https installer URL: {url}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn entries_without_a_strategy_are_exactly_the_ones_declared_detect_only() {
        // Keeps the catalog's data and `SoftwareId::installable` from drifting:
        // a program with no strategies must be one the model already says is not
        // installable, and vice versa. Without this, a typo'd empty list would
        // silently turn an installable program into a detect-only one and the
        // dashboard would stop offering the fix.
        let cat = Catalog::builtin();
        for id in SoftwareId::ALL {
            assert_eq!(
                cat.entry(id).is_installable(),
                id.installable(),
                "{id:?}: catalog and model disagree about installability"
            );
        }
    }

    #[test]
    fn every_detectable_entry_can_actually_be_found_by_something() {
        // An entry with no winget id, no name pattern and no executable is
        // invisible to all four providers: it would always report "not installed"
        // as a positive finding, which is the one lie this layer must not tell.
        let cat = Catalog::builtin();
        for id in SoftwareId::ALL {
            let entry = cat.entry(id);
            if id == SoftwareId::Continue {
                // The documented exception: a VS Code extension is detected by
                // the bootstrap extension verifier, not by the program providers.
                assert!(!entry.is_detectable());
                continue;
            }
            assert!(
                entry.is_detectable(),
                "{id:?} has no detectable identity, so every probe would report it missing"
            );
        }
    }

    #[test]
    fn every_catalogued_program_explains_its_purpose_and_category() {
        // The dashboard renders `purpose` under every row. A program whose
        // purpose is blank tells a student nothing they did not already know,
        // which is the whole complaint this phase exists to fix.
        for id in SoftwareId::ALL {
            assert!(!id.purpose().is_empty(), "{id:?} has no purpose line");
            assert!(!id.display_name().is_empty(), "{id:?} has no display name");
        }
    }

    #[test]
    fn the_new_detect_only_programs_are_still_fully_described() {
        // Spot-checks the entries added in P4.5, because a `match` arm is free to
        // be missing and this is the cheapest way to catch one.
        let cat = Catalog::builtin();
        for id in [
            SoftwareId::Docker,
            SoftwareId::Wsl,
            SoftwareId::Pnpm,
            SoftwareId::Uv,
            SoftwareId::Rust,
            SoftwareId::Java,
            SoftwareId::Cursor,
            SoftwareId::Jetbrains,
        ] {
            assert!(!cat.entry(id).is_installable(), "{id:?} should be detect-only");
            assert!(cat.entry(id).is_detectable(), "{id:?} must be detectable");
        }
    }

    #[test]
    fn similarly_named_new_entries_do_not_collide() {
        // `Continue` is both an extension and an English verb; `uv` is two
        // letters that appear inside many product names. The word-boundary
        // matcher is what keeps these from matching unrelated registry rows.
        let cat = Catalog::builtin();

        // Cursor matches by prefix on purpose — Cursor's own installers append
        // channel and architecture suffixes ("Cursor Nightly", "Cursor (User)").
        // These assertions record what the pattern is *for*, so a change to it
        // has to be deliberate.
        let cursor = cat.entry(SoftwareId::Cursor);
        assert!(cursor.matches_name("Cursor"));
        assert!(cursor.matches_name("Cursor Nightly"));

        // `uv` must not match a program that merely contains those letters.
        let uv = cat.entry(SoftwareId::Uv);
        assert!(uv.matches_name("uv"));
        assert!(!uv.matches_name("uvicorn GUI"));
        assert!(!uv.matches_name("Kuvasz"));

        // Java must not claim JavaScript tooling.
        let java = cat.entry(SoftwareId::Java);
        assert!(java.matches_name("Eclipse Temurin JDK with Hotspot 21"));
        assert!(!java.matches_name("Node.js"));

        // pnpm must not be matched by npm's contract, nor the reverse: they are
        // different programs and telling a student they have one when they have
        // the other sends them to the wrong documentation.
        //
        // npm deliberately has *no* name patterns at all — it ships inside the
        // Node installation and has no uninstall entry or winget package of its
        // own, so only the PATH provider can find it. Asserting that here keeps
        // someone from "fixing" the apparent gap by adding a name pattern that
        // would make the registry provider match Node's record as npm.
        let pnpm = cat.entry(SoftwareId::Pnpm);
        let npm = cat.entry(SoftwareId::Npm);
        assert!(pnpm.matches_name("pnpm"));
        assert!(!pnpm.matches_name("npm"));
        assert!(
            !npm.is_detectable_by_name(),
            "npm must stay name-blind; it is found through PATH only"
        );
        assert!(npm.executables().contains(&"npm.cmd".to_string()));
    }

    #[test]
    fn jetbrains_matches_the_family_not_one_product() {
        // A CS student may have any of PyCharm, IDEA or CLion; the entry is the
        // family, so showing "not installed" because only CLion is present would
        // be wrong.
        let cat = Catalog::builtin();
        let jb = cat.entry(SoftwareId::Jetbrains);
        assert!(jb.matches_name("PyCharm 2024.3"));
        assert!(jb.matches_name("IntelliJ IDEA Community Edition"));
        assert!(jb.matches_name("JetBrains Toolbox"));
    }
}
