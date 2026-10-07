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

    /// How this software handles custom/secondary installation paths.
    pub install_location: InstallLocationSupport,

    /// Default subfolder under the custom root (e.g. "VSCode", "Git", "Python").
    pub storage_subdir: Option<&'static str>,

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
    /// Official installer URL with explicit installer kind and vendor id. Downloaded at run time, never shipped.
    OfficialInstaller {
        url: &'static str,
        kind: InstallerKind,
        vendor_id: &'static str,
    },
    /// A command that uses a package manager already required by the plan.
    Command {
        command: &'static str,
        program_kind: ScriptProgramKind,
        args: &'static [&'static str],
    },
}

impl StrategySource {
    /// The winget package id, if this strategy uses winget at all.
    ///
    /// The id a strategy would actually hand to winget. Exists so a test can
    /// assert *which package* an entry installs without matching on the enum
    /// shape — which is what makes the ChatGPT regression testable.
    pub fn winget_package_id(&self) -> Option<&'static str> {
        match self {
            StrategySource::Winget(id) => Some(id),
            _ => None,
        }
    }
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

    /// Does a `winget list` row refer to this program?
    ///
    /// The winget counterpart of [`CatalogEntry::matches_registry_entry`], and it
    /// exists for the same reason: a display name alone is ambiguous for some
    /// programs. `winget list` gives us no `DisplayIcon`, but the id column
    /// carries the identifying structure instead — `MSIX\OpenAI.Codex_26.915…`
    /// for a Store app, `ARP\User\X64\4f20b4cc…` for a Chrome web-app shim. So
    /// `location_markers` are matched against the id.
    ///
    /// Returns `false` for a name match whose id contradicts the markers, which
    /// is what stops the Chrome shim from being reported as ChatGPT Desktop.
    /// With no markers declared this is exactly `matches_name`.
    pub fn matches_winget_row(&self, display_name: &str, package_id: &str) -> bool {
        if !self.matches_name(display_name) {
            return false;
        }
        if self.location_markers.is_empty() {
            return true;
        }
        let haystack = package_id.to_lowercase();
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
    pub const REVISION: &'static str = "2026.10.07.1";

    pub fn revision(&self) -> &'static str {
        Self::REVISION
    }

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
        if id == SoftwareId::Dynamic {
            static DYNAMIC_ENTRY: std::sync::OnceLock<CatalogEntry> = std::sync::OnceLock::new();
            return DYNAMIC_ENTRY.get_or_init(|| CatalogEntry {
                id: SoftwareId::Dynamic,
                install_location: InstallLocationSupport::DefaultOnly,
                storage_subdir: None,
                winget_ids: &[],
                executables: &[],
                name_patterns: &[],
                location_markers: &[],
                install_roots: &[],
                version_args: None,
                version_env: &[],
                version_via_shim: false,
                install: &[],
            });
        }
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
        Self {
            id: self.id,
            install_location: self.install_location,
            storage_subdir: self.storage_subdir,
            winget_ids: self.winget_ids,
            name_patterns: self.name_patterns,
            executables: self.executables,
            install_roots: self.install_roots,
            location_markers: self.location_markers,
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
            install_location: InstallLocationSupport::WingetLocation,
            storage_subdir: Some("VSCode"),
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
                    source: StrategySource::OfficialInstaller {
                        url: "https://update.code.visualstudio.com/latest/win32-x64-user/stable",
                        kind: InstallerKind::Exe,
                        vendor_id: "microsoft",
                    },
                    rationale: "winget 不可用时改用 VS Code 官方用户级安装包",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Git,
            install_location: InstallLocationSupport::WingetLocation,
            storage_subdir: Some("Git"),
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
                    source: StrategySource::OfficialInstaller {
                        url: "https://github.com/git-for-windows/git/releases/latest/download/Git-64-bit.exe",
                        kind: InstallerKind::Exe,
                        vendor_id: "git-for-windows",
                    },
                    rationale: "回退到 Git for Windows 官方安装包",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Python,
            install_location: InstallLocationSupport::WingetLocation,
            storage_subdir: Some("Python"),
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
                    source: StrategySource::OfficialInstaller {
                        url: "https://www.python.org/ftp/python/3.13.1/python-3.13.1-amd64.exe",
                        kind: InstallerKind::Exe,
                        vendor_id: "python-software-foundation",
                    },
                    rationale: "回退到 python.org 官方安装包",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Node,
            install_location: InstallLocationSupport::FixedDefault,
            storage_subdir: None,
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
            install_location: InstallLocationSupport::InstallerManaged,
            storage_subdir: None,
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
                    source: StrategySource::OfficialInstaller {
                        url: "https://storage.googleapis.com/osprey-downloads-c02f6a0d-347c-492b-a752-3e0651722e97/nest-win-x64/Claude-Setup-x64.exe",
                        kind: InstallerKind::Exe,
                        vendor_id: "anthropic",
                    },
                    rationale: "winget 无对应包或需要管理员时，改用 Claude 官方安装包（无需管理员）",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::ClaudeCode,
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
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
                    source: StrategySource::Command {
                        command: "npm install -g @anthropic-ai/claude-code",
                        program_kind: ScriptProgramKind::Npm,
                        args: &["install", "-g", "@anthropic-ai/claude-code"],
                    },
                    rationale: "通过 npm 全局安装官方 CLI（需要 Node.js）",
                },
                InstallStrategy {
                    source: StrategySource::OfficialInstaller {
                        url: "https://claude.ai/install.ps1",
                        kind: InstallerKind::Ps1,
                        vendor_id: "anthropic",
                    },
                    rationale: "npm 不可用时改用官方 PowerShell 安装脚本",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Codex,
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
            // **Intentionally empty**, for the same reason ChatGPT's is.
            //
            // This entry used to declare `OpenAI.Codex`, which does not exist in
            // the *ID column of `winget list`* — measured live, the declared id
            // resolves to nothing while the real row is
            // `MSIX\OpenAI.Codex_26.915.4065.0_x64__2p2nqsd0c76g0`. winget only
            // ever prints the package-family form for an installed MSIX, so the
            // declared id was dead: it could never match, and the entry silently
            // relied on the name fallback the whole time.
            //
            // `OpenAI.Codex` *is* a real `winget search` id (the Codex CLI), and
            // it is kept below as the install strategy — installing a package and
            // detecting an installed one are different questions, and only the
            // latter uses this field.
            winget_ids: &[],
            name_patterns: &[
                // Codex exists in two genuinely different forms and both are
                // named here, because a student who installed either one should
                // see it detected:
                //
                // * `Codex CLI` — npm, `@openai/codex`. Ships `codex.cmd` and is
                //   what the install strategy below creates.
                // * `Codex` the desktop app — ships inside the ChatGPT MSIX, so
                //   `winget list` reports the display name `ChatGPT` for it (an
                //   OpenAI packaging decision, not our guess: the Appx is named
                //   `OpenAI.Codex` and installed from the ChatGPT Store listing).
                //
                // `Exact("ChatGPT")` alone was not enough and produced a real
                // false positive: a Chrome "install as web app" shortcut for
                // chatgpt.com registers under exactly that name, with a
                // `DisplayIcon` inside the browser's profile directory. On a
                // machine that has only ever opened the website, the app claimed
                // Codex was installed. The icon-path requirement below rejects
                // that case; enabling `registry_provider`'s install-location rule
                // makes the check structural rather than name-based.
                NamePattern::Exact("Codex"),
                NamePattern::Prefix("OpenAI Codex"),
            ],
            executables: &["codex.cmd", "codex.exe"],
            install_roots: &["Programs\\codex"],
            // **Not** `\WindowsApps\` and **not** `Exact("ChatGPT")` any more.
            //
            // This entry used to claim both, on the belief that Codex ships as
            // an MSIX inside the ChatGPT product. It does not: `winget`'s
            // `OpenAI.Codex` is Codex **CLI** (Apache-2.0, `github.com/openai/codex`,
            // installed via npm), while the Appx named `OpenAI.Codex` under
            // `WindowsApps\` is **ChatGPT Desktop**. Keeping the old markers made
            // both entries match the same registry row, so ChatGPT Desktop was
            // reported as Codex CLI *and* as itself. `the_three_chatgpt_lookalikes_stay_distinct`
            // fails if that overlap returns.
            //
            // What remains is the location a real CLI installs to. The Chrome
            // "install as web app" false positive is still rejected: its icon
            // lives under the browser profile, which matches nothing here.
            location_markers: &["\\Programs\\", "\\OpenAI\\"],

            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[
                InstallStrategy {
                    source: StrategySource::Command {
                        command: "npm install -g @openai/codex",
                        program_kind: ScriptProgramKind::Npm,
                        args: &["install", "-g", "@openai/codex"],
                    },
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
        // ## This list shrank in 0.1.2, deliberately
        //
        // Docker, Cursor, MSVC, CMake, Java, Rust, uv and pnpm *used* to be here.
        // They are not any more: every one of them has a working `winget` package
        // (verified live with `winget show`, versions in the comments below), and
        // "this tool cannot install it" was the single most common complaint about
        // the previous build — on a product whose whole promise is "一键安装".
        // Refusing to run `winget install Docker.DockerDesktop` while displaying
        // the package id on the same screen was not caution, it was a gap.
        //
        // What remains genuinely unmanaged, and why:
        //
        // 1. WSL is an optional Windows *feature*, not a package —
        //    `wsl --install` enables components and changes boot configuration,
        //    which is a system change this product does not make on its own.
        // 2. JetBrains is a *family* of products with per-product licences; there
        //    is no single correct package to pick on the student's behalf.
        // 3. The npm/uv/pnpm-less CLIs (Gemini CLI, OpenCode, Continue, Moonshot)
        //    publish no `winget` package at all — `winget search` returns nothing
        //    — so there is no honest one-click route yet. They stay detectable.
        //
        // Seeing without acting is the honest half of the product for those.
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
            install_location: InstallLocationSupport::SystemManaged,
            storage_subdir: None,
            // **Intentionally empty.** Read this before "fixing" it with an id.
            //
            // These ids are matched against the **ID column of `winget list`**
            // (`inventory.rs:271`), and only fall back to the display-name column
            // (`:277`) when every id misses. So an id is useful here only if
            // `winget list` actually prints it.
            //
            // Neither candidate does. Measured on a machine with the Store app
            // installed, the three rows matching `ChatGPT` report:
            //
            //   ARP\User\X64\4f20b4cc28466082b25e640be9dfc8c6          1.0        ← web-app shim
            //   MSIX\OpenAI.Codex_26.915.4065.0_x64__2p2nqsd0c76g0     26.915...  ← the real app
            //   ARP\User\X64\ChatGPT账号工具                             2.2.33     ← unrelated tool
            //
            // * `OpenAI.ChatGPT` (the original value) does not exist at all —
            //   `winget search` exits 0x8A150014.
            // * `9PLM9XGG6VKS` is the Store *product* id, which `winget list`
            //   never prints: the installed MSIX reports its package-family name
            //   `MSIX\OpenAI.Codex_…` instead. Putting it here would be a no-op
            //   dressed as a fix — it could never match.
            //
            // So the honest value is the empty list, and detection runs on the
            // name + `location_markers` path, which is what genuinely works today.
            // `chatgpt_desktop_declares_no_winget_id_and_that_is_deliberate` and
            // `the_three_chatgpt_lookalikes_stay_distinct` pin the consequence so
            // a future reader does not rediscover this.
            winget_ids: &[],
            name_patterns: &[
                NamePattern::Exact("ChatGPT"),
                NamePattern::Prefix("ChatGPT Desktop"),
            ],
            executables: &["ChatGPT.exe"],
            // The Appx package is named `OpenAI.Codex`, not `ChatGPT` — measured
            // on a machine with the Store app installed:
            //
            //   Name:            OpenAI.Codex
            //   PackageFullName: OpenAI.Codex_26.915.4065.0_x64__2p2nqsd0c76g0
            //   InstallLocation: C:\Program Files\WindowsApps\OpenAI.Codex_...
            //
            // A name-based Appx probe for "*ChatGPT*" therefore returns nothing,
            // and a bare `WindowsApps` root cannot be an identity: it is the same
            // directory every Store app lives in. `WindowsApps\OpenAI.Codex` is
            // the specific path, so it is named.
            install_roots: &[
                "Programs\\ChatGPT",
                "WindowsApps\\OpenAI.Codex",
                "WindowsApps",
            ],
            // Identity, not decoration. Three unrelated things match a naive
            // `*ChatGPT*` search on a real machine:
            //
            //   ChatGPT             ARP\User\X64\4f20b4cc...  1.0            ← impostor
            //   ChatGPT             9PLM9XGG6VKS               26.915...      ← the real app
            //   ChatGPT账号工具     ARP\User\X64\ChatGPT账号工具  2.2.33       ← unrelated tool
            //
            // `Exact("ChatGPT")` alone therefore matches the first and matches
            // the real app's *display* name — the ARP entry is what the markers
            // must reject. A real Store app installs under `WindowsApps\` with
            // the vendor namespace in the path; an ARP shim of the same display
            // name does not. `\OpenAI.Codex` is the Appx namespace observed live.
            location_markers: &[
                "\\WindowsApps\\",
                "\\OpenAI.Codex",
                "\\OpenAI\\",
                "\\Programs\\",
            ],
            // The app is a packaged MSIX with no usable `--version`; a fabricated
            // version would be worse than none.
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[
                // The product id of the ChatGPT desktop app in the Microsoft
                // Store. This entry previously read `OpenAI.ChatGPT`, which does
                // not exist in the winget community source — `winget search
                // OpenAI.ChatGPT` returns "找不到与输入条件匹配的程序包" and exit
                // code 0x8A150014, so every ChatGPT Desktop install failed at the
                // first step, with an error that read to a student as "this
                // software does not exist".
                //
                // A Store product id, resolved by winget's *default* source
                // resolution. Verified on winget 1.29.290: the `msstore` source
                // is registered and non-explicit (`显式: false`), so a bare
                // `winget install --id 9PLM9XGG6VKS -e` resolves it correctly —
                // and conversely, pinning `--source winget` breaks it with
                // 0x8A150014. No `--source` is passed, deliberately.
                InstallStrategy {
                    source: StrategySource::Winget("9PLM9XGG6VKS"),
                    rationale: "从 Microsoft Store 安装 ChatGPT 桌面版（官方 MSIX 包）",
                },
                // No second strategy: OpenAI publishes no direct-download
                // installer for this app (it ships only through the Store), so a
                // URL here would be a guess, and a guessed URL is worse than no
                // fallback. A machine with the `msstore` source stripped (LTSC,
                // Store removed by policy) has no route yet — tracked as a
                // follow-up rather than papered over with an invented link.
            ],
        },
        CatalogEntry {
            id: SoftwareId::Docker,
            install_location: InstallLocationSupport::FixedDefault,
            storage_subdir: None,
            winget_ids: &["Docker.DockerDesktop"],
            name_patterns: &[NamePattern::Prefix("Docker Desktop")],
            executables: &["docker.exe"],
            install_roots: &["Docker\\Docker", "Program Files\\Docker"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("Docker.DockerDesktop"),
                rationale: "从 winget 安装 Docker Desktop（官方包，安装后需重启并开启虚拟化）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::Cursor,
            install_location: InstallLocationSupport::FixedDefault,
            storage_subdir: None,
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
            install: &[InstallStrategy {
                source: StrategySource::Winget("Anysphere.Cursor"),
                rationale: "从 winget 安装 Cursor（官方包，装完即可打开）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::Windsurf,
            install_location: InstallLocationSupport::FixedDefault,
            storage_subdir: None,
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
            install_location: InstallLocationSupport::SystemManaged,
            storage_subdir: None,
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
            install_location: InstallLocationSupport::FixedDefault,
            storage_subdir: None,
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
            install: &[InstallStrategy {
                source: StrategySource::Winget("Microsoft.VisualStudio.2022.BuildTools"),
                rationale: "从 winget 安装 MSVC 生成工具（官方包，体积约 2 GB，耗时最长）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::Cmake,
            install_location: InstallLocationSupport::FixedDefault,
            storage_subdir: None,
            winget_ids: &["Kitware.CMake"],
            name_patterns: &[NamePattern::Exact("CMake"), NamePattern::Prefix("CMake ")],
            executables: &["cmake.exe"],
            install_roots: &["CMake"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("Kitware.CMake"),
                rationale: "从 winget 安装 CMake（官方包）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::Npm,
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
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
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
            winget_ids: &["pnpm.pnpm"],
            name_patterns: &[NamePattern::Exact("pnpm")],
            executables: &["pnpm.cmd", "pnpm.exe"],
            install_roots: &["pnpm"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("pnpm.pnpm"),
                rationale: "从 winget 安装 pnpm（官方包）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::Uv,
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
            winget_ids: &["astral-sh.uv"],
            name_patterns: &[NamePattern::Exact("uv")],
            executables: &["uv.exe", "uv.cmd"],
            install_roots: &["uv", ".local\\bin"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("astral-sh.uv"),
                rationale: "从 winget 安装 uv（官方包，Python 包管理器）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::Rust,
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
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
            install: &[InstallStrategy {
                source: StrategySource::Winget("Rustlang.Rustup"),
                rationale: "从 winget 安装 Rust 工具链（rustup，官方包）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::Java,
            install_location: InstallLocationSupport::FixedDefault,
            storage_subdir: None,
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
            install: &[
                // Temurin first: it is the build the course ecosystem assumes
                // (Adoptium, LTS 21) and it is the id the entry already declares.
                InstallStrategy {
                    source: StrategySource::Winget("EclipseAdoptium.Temurin.21.JDK"),
                    rationale: "从 winget 安装 Eclipse Temurin JDK 21（官方包，课程通用 LTS）",
                },
                InstallStrategy {
                    source: StrategySource::Winget("Microsoft.OpenJDK.21"),
                    rationale: "改用微软构建的 OpenJDK 21（Temurin 不可用时）",
                },
            ],
        },
        CatalogEntry {
            id: SoftwareId::Gemini,
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
            // No `winget` package exists at all: `winget search "Gemini CLI"`
            // returns 找不到与输入条件匹配的程序包. The CLI ships through npm
            // (`@google/gemini-cli`), which is a Node-dependent install route this
            // version does not wire up for it yet — so it stays detect-only rather
            // than getting an invented package id.
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
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
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
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
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
            install_location: InstallLocationSupport::FixedDefault,
            storage_subdir: None,
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
            install_location: InstallLocationSupport::FixedDefault,
            storage_subdir: None,
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
            install_location: InstallLocationSupport::SystemManaged,
            storage_subdir: None,
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
        CatalogEntry {
            id: SoftwareId::QwenCode,
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
            // No winget package exists for it. An invented winget id would fail
            // with "no such package" instead of falling through to the npm
            // strategy, so the list stays empty on purpose.
            winget_ids: &[],
            name_patterns: &[NamePattern::Word("Qwen Code")],
            // The npm package is `@qwen-code/qwen-code` and its `bin` field is
            // `qwen` (confirmed against the registry), so the command a student
            // types is `qwen`. npm writes `.cmd` shims on Windows.
            executables: &["qwen.cmd", "qwen.exe", "qwen"],
            install_roots: &["npm\\qwen", "Programs\\qwen"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Command {
                    command: "npm install -g @qwen-code/qwen-code",
                    program_kind: ScriptProgramKind::Npm,
                    args: &["install", "-g", "@qwen-code/qwen-code"],
                },
                rationale: "通过官方 npm 包安装（@qwen-code/qwen-code，官方仓库 QwenLM/qwen-code）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::KimiCli,
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
            winget_ids: &[],
            name_patterns: &[NamePattern::Word("Kimi")],
            // Official distribution is the GitHub release archive at
            // `MoonshotAI/kimi-cli`, which contains `kimi.exe`. There is no
            // official npm package — the unscoped `kimi-cli` on npm is an
            // unrelated placeholder — so it is never an install source here.
            executables: &["kimi.exe", "kimi.cmd", "kimi"],
            install_roots: &["Kimi", "kimi-cli", "Programs\\kimi"],
            location_markers: &["kimi"],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::CcSwitch,
            install_location: InstallLocationSupport::FixedDefault,
            storage_subdir: None,
            // No winget package at the time of writing, and this product
            // deliberately does **not** install it: CC Switch rewrites other
            // tools' configuration and PATH, so an unattended install that
            // replaced a student's existing Claude/Codex setup would be the
            // exact harm the brief forbids. Detection and explanation only.
            winget_ids: &[],
            name_patterns: &[
                NamePattern::Word("CC Switch"),
                NamePattern::Word("cc-switch"),
            ],
            // Confirmed on the author's machine as a *portable* build
            // (`D:\工具软件\cc-switch.exe`, product name "CC Switch", company
            // "ccswitch", v3.19.2) with **no** registry uninstall entry — so the
            // executable probe is the one that fires there. The name patterns
            // cover the signed-MSI install case.
            executables: &["cc-switch.exe", "cc_switch.exe", "CC Switch.exe"],
            install_roots: &["cc-switch", "CC Switch"],
            location_markers: &["cc-switch", "CC Switch"],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[],
        },
        CatalogEntry {
            id: SoftwareId::Crush,
            install_location: InstallLocationSupport::ScriptManaged,
            storage_subdir: None,
            winget_ids: &[],
            name_patterns: &[NamePattern::Word("Crush")],
            // The official scope is `@charmland/crush`; the unscoped `crush`
            // package belongs to an unrelated project, so the scope is part of
            // the identity rather than a detail.
            executables: &["crush.exe", "crush.cmd", "crush"],
            install_roots: &["npm\\crush", "Programs\\crush"],
            location_markers: &[],
            version_args: Some(&["--version"]),
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Command {
                    command: "npm install -g @charmland/crush",
                    program_kind: ScriptProgramKind::Npm,
                    args: &["install", "-g", "@charmland/crush"],
                },
                rationale: "通过官方 npm 包安装（@charmland/crush，官方仓库 charmbracelet/crush）",
            }],
        },
        // -------------------------------------------------------------------
        // 0.1.2 — AI chat clients and AIGC creation tools.
        //
        // Every id here was verified with `winget show` on the reference machine
        // before being written down; the observed version is quoted so a future
        // reader can tell a live id from a remembered one.
        //
        // Two entries carry no `location_markers`, and that is not laziness: an
        // unambiguous vendor package id (`ByteDance.Doubao`) already *is* the
        // identity. Markers exist for the cases where a display name is shared
        // with something else — see ChatGPT vs the Chrome web-app shim.
        // -------------------------------------------------------------------
        CatalogEntry {
            id: SoftwareId::Doubao,
            install_location: InstallLocationSupport::InstallerManaged,
            storage_subdir: None,
            // Verified live: `winget show --id ByteDance.Doubao -e` → 2.30.4.
            // Already installed on the reference machine, where `winget list`
            // printed exactly this id — the strongest form of the evidence.
            winget_ids: &["ByteDance.Doubao"],
            name_patterns: &[NamePattern::Exact("豆包"), NamePattern::Exact("Doubao")],
            executables: &["Doubao.exe"],
            install_roots: &["Programs\\Doubao"],
            location_markers: &[],
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("ByteDance.Doubao"),
                rationale: "从 winget 安装豆包官方桌面版",
            }],
        },
        CatalogEntry {
            id: SoftwareId::CherryStudio,
            install_location: InstallLocationSupport::InstallerManaged,
            storage_subdir: None,
            // Verified live: `winget show --id kangfenmao.CherryStudio -e` → 2.1.2.
            //
            // The `msstore` source also lists a Cherry Studio (`XPDDXMTVP41MPH`).
            // The community `winget` id is preferred because it is the one that
            // resolved cleanly here; the Store build is a separate product id and
            // mixing the two would make detection disagree with installation.
            winget_ids: &["kangfenmao.CherryStudio"],
            name_patterns: &[NamePattern::Prefix("Cherry Studio")],
            executables: &["Cherry Studio.exe"],
            install_roots: &["Programs\\Cherry Studio", "Programs\\cherry-studio"],
            location_markers: &[],
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("kangfenmao.CherryStudio"),
                rationale: "从 winget 安装 Cherry Studio（官方包）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::Chatbox,
            install_location: InstallLocationSupport::InstallerManaged,
            storage_subdir: None,
            // Verified live: `winget show --id Bin-Huang.Chatbox -e` → 1.23.3.
            winget_ids: &["Bin-Huang.Chatbox"],
            name_patterns: &[NamePattern::Prefix("Chatbox")],
            executables: &["Chatbox.exe"],
            install_roots: &["Programs\\Chatbox"],
            location_markers: &[],
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("Bin-Huang.Chatbox"),
                rationale: "从 winget 安装 Chatbox（官方包）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::JianyingPro,
            install_location: InstallLocationSupport::InstallerManaged,
            storage_subdir: None,
            // Verified live: `winget show --id ByteDance.JianyingPro -e` →
            // 11.5.0.14471. Already installed on the reference machine, where
            // `winget list` printed this exact id against the display name
            // 剪映专业版 — so both the id and the name pattern below are observed,
            // not assumed.
            winget_ids: &["ByteDance.JianyingPro"],
            name_patterns: &[
                NamePattern::Exact("剪映专业版"),
                NamePattern::Exact("剪映"),
            ],
            executables: &["JianyingPro.exe"],
            install_roots: &["Programs\\JianyingPro"],
            location_markers: &[],
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("ByteDance.JianyingPro"),
                rationale: "从 winget 安装剪映专业版（字节官方包）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::CapCut,
            install_location: InstallLocationSupport::InstallerManaged,
            storage_subdir: None,
            // Verified live: `winget show --id ByteDance.CapCut -e` → 9.4.0.4015.
            winget_ids: &["ByteDance.CapCut"],
            name_patterns: &[NamePattern::Prefix("CapCut")],
            executables: &["CapCut.exe"],
            install_roots: &["Programs\\CapCut"],
            location_markers: &[],
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("ByteDance.CapCut"),
                rationale: "从 winget 安装 CapCut（剪映国际版，官方包）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::ComfyUi,
            install_location: InstallLocationSupport::InstallerManaged,
            storage_subdir: None,
            // Verified live: `winget show --id Comfy.ComfyUI-Desktop -e` → 1.0.47.
            winget_ids: &["Comfy.ComfyUI-Desktop"],
            name_patterns: &[NamePattern::Prefix("ComfyUI")],
            executables: &["ComfyUI.exe"],
            install_roots: &["Programs\\ComfyUI", "ComfyUI"],
            location_markers: &[],
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("Comfy.ComfyUI-Desktop"),
                rationale: "从 winget 安装 ComfyUI Desktop（官方包）",
            }],
        },
        CatalogEntry {
            id: SoftwareId::GeminiDesktop,
            install_location: InstallLocationSupport::InstallerManaged,
            storage_subdir: None,
            // Verified live on this machine: `winget show --id Google.GoogleDesktop -e`
            // → 名称 "Google App for Desktop", 版本 152.0.7933.0, 发布者 Google,
            // tags include `google-gemini`.
            //
            // The id was *confirmed*, not guessed: the user's own download from
            // Google's site (`GeminiSetup.exe`) reports version 152.0.7933.0,
            // the same version winget serves for this id, so the two name the
            // same product. `Google.Gemini` does not exist in the source; this
            // is the desktop app.
            winget_ids: &["Google.GoogleDesktop"],
            name_patterns: &[NamePattern::Prefix("Google App"), NamePattern::Prefix("Gemini")],
            executables: &["GoogleAppInstaller.exe"],
            install_roots: &[],
            location_markers: &["Google\\Google App"],
            version_args: None,
            version_env: &[],
            version_via_shim: false,
            install: &[InstallStrategy {
                source: StrategySource::Winget("Google.GoogleDesktop"),
                rationale: "从 winget 安装 Gemini 桌面客户端（Google 官方包）",
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

    /// Closes the gap between the Rust model and its TypeScript mirror.
    ///
    /// `model.rs` and `types.ts` both describe this contract in prose ("the two
    /// must name the same ids in the same order"), and until this test nothing
    /// read the TypeScript file at all — the mirror could drift arbitrarily and
    /// only a human reading both files would notice. The frontend's
    /// `SOFTWARE_IDS` array exists for the same reason; the icon-coverage check
    /// in `tools/ui-verify.mjs` enumerates from it, so an id missing there means
    /// an id that can render without an icon and nobody notices.
    ///
    /// The parse is deliberately dumb — it reads the `SOFTWARE_IDS` array's
    /// quoted strings in order and compares against `SoftwareId::ALL`'s keys.
    /// A tolerant parser that "helpfully" skipped malformed lines would defeat
    /// the purpose.
    #[test]
    fn typescript_id_list_matches_the_rust_enum_in_order() {
        let src = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("src")
                .join("lib")
                .join("types.ts"),
        )
        .expect("src/lib/types.ts must be readable from the crate");

        let start = src
            .find("export const SOFTWARE_IDS")
            .expect("types.ts must export SOFTWARE_IDS");
        let body = &src[start..];
        let end = body.find("] as const").expect("SOFTWARE_IDS must be an array literal");
        let body = &body[..end];

        let ts: Vec<String> = body
            .match_indices('"')
            .filter(|(i, _)| {
                // Keep only opening quotes: an even number of quote chars precede
                // it, ignoring any that are part of the `export const` line's
                // identifier (there are none).
                body[..*i].matches('"').count() % 2 == 0
            })
            .filter_map(|(i, _)| {
                let rest = &body[i + 1..];
                let close = rest.find('"')?;
                let value = &rest[..close];
                // Skip prose: only ids are lowercase snake_case with no spaces.
                if value.is_empty() || value.contains(' ') || value.contains('.') {
                    None
                } else {
                    Some(value.to_string())
                }
            })
            .collect();

        let rust: Vec<String> = SoftwareId::ALL.iter().map(|id| id.key().to_string()).collect();

        assert_eq!(
            ts, rust,
            "src/lib/types.ts SOFTWARE_IDS and SoftwareId::ALL disagree; \
             the Rust enum is authoritative and the TS list mirrors it in order"
        );
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

        // This assertion used to read `assert!(codex.matches_name("ChatGPT"))`
        // with the note "Codex missed its MSIX name". That requirement is
        // withdrawn, because the premise behind it was wrong.
        //
        // It assumed Codex ships as an MSIX inside the ChatGPT product, so the
        // Appx would report the display name `ChatGPT`. Verified against the
        // real machine: the Appx named `OpenAI.Codex` **is ChatGPT Desktop**, and
        // winget's `OpenAI.Codex` is **Codex CLI** — a different product in a
        // different ecosystem. So a registry row called `ChatGPT` is ChatGPT
        // Desktop, and claiming it for Codex made both entries match one row.
        assert!(
            !codex.matches_name("ChatGPT"),
            "a row called ChatGPT is ChatGPT Desktop, not Codex CLI"
        );
        assert!(codex.matches_name("Codex"), "Codex must match its own name");
        assert!(codex.matches_name("OpenAI Codex"));
        // And the desktop app keeps the name Codex gave up.
        assert!(cat.entry(SoftwareId::ChatgptDesktop).matches_name("ChatGPT"));
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
                    StrategySource::Winget(id) => {
                        assert!(
                            !id.trim().is_empty(),
                            "{id:?} has an empty winget package id"
                        );
                    }
                    StrategySource::Command { .. } => {}
                    StrategySource::OfficialInstaller { url, .. } => {
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
        //
        // ## Rewritten in 0.1.2, and the rewrite is the point
        //
        // This test used to assert that Docker, Pnpm, Uv, Rust, Java and Cursor
        // are detect-only. They are not any more — each has a working winget
        // package that was verified live, and refusing to install them on a
        // "one-click install" product was the complaint 0.1.2 exists to fix.
        //
        // The list below is what remains *genuinely* undetectable-by-installer,
        // and both halves are asserted so a future edit cannot quietly move a
        // program from one side to the other without a deliberate test change.
        let cat = Catalog::builtin();

        // Promoted to installable in 0.1.2: real winget packages, verified live.
        for id in [
            SoftwareId::Docker,
            SoftwareId::Pnpm,
            SoftwareId::Uv,
            SoftwareId::Rust,
            SoftwareId::Java,
            SoftwareId::Cursor,
            SoftwareId::MsvcBuildTools,
            SoftwareId::Cmake,
        ] {
            assert!(
                cat.entry(id).is_installable(),
                "{id:?} has a real winget package and must be installable"
            );
            assert!(cat.entry(id).is_detectable(), "{id:?} must be detectable");
        }

        // Still detect-only, and each for a reason that is not laziness:
        //   WSL         — a Windows optional feature, not a package.
        //   JetBrains   — a product *family*; no single correct package exists.
        for id in [SoftwareId::Wsl, SoftwareId::Jetbrains] {
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

    // -----------------------------------------------------------------------
    // ChatGPT Desktop — a named regression case
    //
    // The bug this pins, reproduced on a real machine:
    //
    //   winget search OpenAI.ChatGPT  → 找不到与输入条件匹配的程序包
    //                                   exit -1978335212 / 0x8A150014
    //
    // `OpenAI.ChatGPT` is not a winget community package id. It was this
    // entry's *only* install strategy, so every ChatGPT Desktop install failed
    // at the first step with a message that reads to a student as "this software
    // does not exist" — the single most common first request in the product.
    //
    // The real distribution is the Microsoft Store MSIX `9PLM9XGG6VKS`:
    //
    //   winget search --id 9PLM9XGG6VKS -e  → 找到 ChatGPT, source msstore, exit 0
    //
    // These assertions exist so a future catalogue or executor change cannot
    // silently reintroduce the dead id.
    // -----------------------------------------------------------------------

    /// The dead id must never come back as an install strategy.
    #[test]
    fn chatgpt_desktop_never_installs_via_the_nonexistent_community_id() {
        let cat = Catalog::builtin();
        let entry = cat.entry(SoftwareId::ChatgptDesktop);

        for strategy in entry.install {
            // `winget_package_id()` is the id that would actually be handed to winget.
            let id = strategy.source.winget_package_id();
            assert_ne!(
                id,
                Some("OpenAI.ChatGPT"),
                "ChatGPT Desktop is installing via `OpenAI.ChatGPT`, which does not exist in the \
                 winget community source (exit 0x8A150014). This is the regression."
            );
        }
    }

    /// The Store id is the real package, and it must be paired with its source.
    #[test]
    fn chatgpt_desktop_uses_the_real_store_id_with_its_source() {
        let cat = Catalog::builtin();
        let entry = cat.entry(SoftwareId::ChatgptDesktop);

        let store = entry
            .install
            .iter()
            .find(|s| s.source.winget_package_id() == Some("9PLM9XGG6VKS"))
            .expect("ChatGPT Desktop must install from the Store id 9PLM9XGG6VKS");

        // It is a `Winget` strategy with *no* pinned source. Verified on winget
        // 1.29.290: `msstore` is registered and non-explicit, so a bare
        // `--id 9PLM9XGG6VKS` resolves correctly, while pinning
        // `--source winget` breaks it with 0x8A150014. The type deliberately
        // cannot express a source, so an accidental pin is impossible.
        assert!(
            matches!(store.source, StrategySource::Winget("9PLM9XGG6VKS")),
            "the Store id must be installed through winget's default source resolution"
        );
    }

    /// ChatGPT Desktop ships through the Store only, so it has exactly one
    /// strategy — and specifically must not carry an invented fallback URL.
    ///
    /// This test replaces an earlier one that required a second strategy. That
    /// requirement was withdrawn: OpenAI publishes no direct-download installer
    /// for this app, so any URL here would be a guess, and a guessed URL that
    /// rots is worse than an honest gap. The gap is a recorded follow-up (a
    /// machine with the `msstore` source stripped currently has no route), not
    /// something to paper over with a link that may not resolve.
    ///
    /// The `OfficialInstaller` assertion stays because that is the concrete
    /// mistake this guards: `execute_official_installer` downloads a URL and
    /// then *runs* it, so pointing it at a product or store page would save an
    /// HTML document and try to execute it.
    #[test]
    fn chatgpt_desktop_ships_one_store_strategy_and_no_guessed_fallback() {
        let cat = Catalog::builtin();
        let entry = cat.entry(SoftwareId::ChatgptDesktop);

        let winget: Vec<&StrategySource> = entry
            .install
            .iter()
            .map(|s| &s.source)
            .filter(|s| s.winget_package_id().is_some())
            .collect();

        assert_eq!(
            winget.len(),
            1,
            "ChatGPT Desktop must install from exactly one winget id; found {}",
            winget.len()
        );
        assert_eq!(winget[0].winget_package_id(), Some("9PLM9XGG6VKS"));
        assert_eq!(
            entry.install.len(),
            1,
            "no fallback is shipped: OpenAI publishes no direct-download \
             installer, and an unverified URL would be worse than a known gap"
        );
        assert!(
            !entry
                .install
                .iter()
                .any(|s| matches!(s.source, StrategySource::OfficialInstaller(_))),
            "an OfficialInstaller here would be downloaded and executed; no such \
             installer exists for this app"
        );
    }

    /// ChatGPT Desktop's `winget_ids` must stay empty, and here is why.
    ///
    /// The ids are matched against the **ID column of `winget list`**
    /// (`inventory.rs:271`). `winget list` does not print the Store product id
    /// for an installed Store app — it prints the MSIX package-family name:
    ///
    /// ```text
    /// ChatGPT  MSIX\OpenAI.Codex_26.915.4065.0_x64__2p2nqsd0c76g0  26.915.4065.0
    /// ```
    ///
    /// So neither `OpenAI.ChatGPT` (which does not exist at all — `winget search`
    /// exits `0x8A150014`) nor `9PLM9XGG6VKS` (a Store *product* id, which never
    /// appears in that column) can ever match. An id here would be untestable
    /// decoration that reads like a fix.
    ///
    /// What actually detects this program is the name plus `location_markers`
    /// path, which is asserted by the neighbouring lookalike test.
    #[test]
    fn chatgpt_desktop_declares_no_winget_id_and_that_is_deliberate() {
        let cat = Catalog::builtin();
        let entry = cat.entry(SoftwareId::ChatgptDesktop);

        assert!(
            entry.winget_ids.is_empty(),
            "ChatGPT Desktop must declare no winget ids: the ID column of \
             `winget list` contains neither `OpenAI.ChatGPT` (nonexistent) nor \
             the Store product id. Found {:?}",
            entry.winget_ids
        );

        // And the replacement id must not sneak back in as an install strategy
        // or a detection id: the install route is the Store id resolved by
        // winget's own source handling, which is a different mechanism.
        assert_eq!(
            entry.install[0].source.winget_package_id(),
            Some("9PLM9XGG6VKS"),
            "the *install* strategy uses the Store id; only the *detection* list \
             must stay empty, because the two are matched against different things"
        );
    }

    /// Three unrelated things answer to a naive `*ChatGPT*` search. Pin them
    /// apart, using the real entries read off this machine.
    ///
    /// Observed:
    ///
    /// | where | what it really is |
    /// |---|---|
    /// | winget `OpenAI.Codex` | **Codex CLI** — a terminal agent, Apache-2.0 |
    /// | winget `9PLM9XGG6VKS` / Appx `OpenAI.Codex` | **ChatGPT Desktop** — the MSIX app |
    /// | ARP `ChatGPT` (DisplayIcon under Chrome's profile) | an "install as web app" shortcut |
    /// | ARP `ChatGPT账号工具` | an unrelated third-party tool |
    ///
    /// The winget id and the Appx name collide *across ecosystems*: the string
    /// `OpenAI.Codex` is ChatGPT Desktop in Appx terms and Codex CLI in winget
    /// terms. Treating either spelling as one identity is the error this pins
    /// shut, and it is a live one — it was committed in review earlier today.
    #[test]
    fn the_three_chatgpt_lookalikes_stay_distinct() {
        use crate::modules::inventory::UninstallEntry;

        let cat = Catalog::builtin();
        let desktop = cat.entry(SoftwareId::ChatgptDesktop);
        let codex = cat.entry(SoftwareId::Codex);

        // 1. The two products are different ids with different install routes.
        assert_ne!(desktop.id, codex.id);
        assert!(desktop
            .install
            .iter()
            .any(|s| s.source.winget_package_id() == Some("9PLM9XGG6VKS")));
        assert!(codex
            .install
            .iter()
            .any(|s| s.source.winget_package_id() == Some("OpenAI.Codex")));

        // 2. The real Store app is found, by its Appx path.
        let real = UninstallEntry {
            display_name: "ChatGPT".into(),
            display_version: Some("26.915.4065.0".into()),
            install_location: Some(
                r"C:\Program Files\WindowsApps\OpenAI.Codex_26.915.4065.0_x64__2p2nqsd0c76g0".into(),
            ),
            display_icon: None,
            key: "test".into(),
        };
        assert!(
            desktop.matches_registry_entry(&real),
            "the real Store install must be recognised by its WindowsApps\\OpenAI.Codex path"
        );

        // 3. The Chrome "install as web app" impostor must NOT satisfy it.
        //    Real DisplayIcon, read from the registry on this machine.
        let impostor = UninstallEntry {
            display_name: "ChatGPT".into(),
            display_version: Some("1.0".into()),
            install_location: None,
            display_icon: Some(
                r"C:\Users\35074\AppData\Local\Google\Chrome\User Data\Default\Web Applications\_crx_cadlkienfkclaiaibeoongdcgmdikeeg\ChatGPT.ico".into(),
            ),
            key: "test".into(),
        };
        assert!(
            !desktop.matches_registry_entry(&impostor),
            "a Chrome web-app shortcut called ChatGPT is not an installed desktop app"
        );

        // 4. The unrelated 账号工具 is rejected on name as well as path.
        let other_tool = UninstallEntry {
            display_name: "ChatGPT账号工具".into(),
            display_version: Some("2.2.33".into()),
            install_location: Some(r"D:\工具软件\ChatGPT账号工具".into()),
            display_icon: Some(r"D:\工具软件\ChatGPT账号工具\lucky-yaoyao-codex.exe".into()),
            key: "test".into(),
        };
        assert!(
            !desktop.matches_registry_entry(&other_tool),
            "an unrelated third-party ChatGPT tool must not satisfy ChatGPT Desktop"
        );

        // 5. And the separations hold in the other direction: neither the Store
        //    app nor the impostor satisfies Codex CLI.
        assert!(
            !codex.matches_registry_entry(&real),
            "ChatGPT Desktop must not be reported as Codex CLI"
        );
    }

    /// Presence-only version handling: the package publishes no readable
    /// version, so a version *floor* must not be enforced.
    ///
    /// Asserted at the catalogue level by checking the entry declares no
    /// `version_args` to probe with — the observable half of the decision.
    /// `verify::minimum_version` encodes the other half and is exhaustive by
    /// design, so a version floor appearing there would be a deliberate change.
    #[test]
    fn chatgpt_desktop_declares_no_version_probe() {        let cat = Catalog::builtin();
        let entry = cat.entry(SoftwareId::ChatgptDesktop);

        assert!(
            entry.version_args.is_none(),
            "`winget show 9PLM9XGG6VKS` reports 版本: Unknown; probing for a version would \
             produce a fabricated or empty one"
        );
    }

    /// ChatGPT Desktop and Codex are different products **at the winget-source
    /// layer**, and both call themselves "ChatGPT" on disk.
    ///
    /// Deliberately scoped. Measured on a real machine, the *installed MSIX* for
    /// the ChatGPT desktop app has package family `OpenAI.Codex_26.915.4065.0_x64__2p2nqsd0c76g0`.
    /// So "OpenAI.Codex is never ChatGPT" would be FALSE and must not be
    /// asserted. What *is* true, and all this test claims, is the source layer:
    /// two distinct winget packages, with different installer types.
    #[test]
    fn chatgpt_desktop_and_codex_are_distinct_winget_packages() {
        let cat = Catalog::builtin();
        let desktop = cat.entry(SoftwareId::ChatgptDesktop);
        let codex = cat.entry(SoftwareId::Codex);

        assert_ne!(
            desktop.id, codex.id,
            "ChatGPT Desktop and Codex are different catalogue entries"
        );
        // Source layer: desktop is the Store MSIX, Codex is the CLI as a
        // portable zip (`winget show`: 0.152.0 portable vs Unknown msstore).
        assert!(desktop
            .install
            .iter()
            .any(|s| s.source.winget_package_id() == Some("9PLM9XGG6VKS")));
        assert!(codex
            .install
            .iter()
            .any(|s| s.source.winget_package_id() == Some("OpenAI.Codex")));
        // And the unresolvable id is used by neither.
        for entry in [desktop, codex] {
            for s in entry.install {
                assert_ne!(s.source.winget_package_id(), Some("OpenAI.ChatGPT"));
            }
        }
    }

    /// The **property** a `winget_ids` value must satisfy, asserted instead of a
    /// value.
    ///
    /// `inventory.rs:266-281` uses `winget_ids()` as the *preferred* match key
    /// against `winget list`'s ID column, falling back to `matches_name` only
    /// when every id misses. `OpenAI.ChatGPT` resolves against nothing, so the
    /// preferred key always misses and detection silently depends on the name
    /// fallback.
    ///
    /// The correct replacement is install-engineer's call (a hardcoded Store id
    /// has its own portability problems), so this test deliberately does **not**
    /// pin one. It pins the invariant that decided the bug: a declared id must not
    /// be one that `winget search` provably cannot resolve.
    #[test]
    fn no_winget_id_advertises_the_unresolvable_chatgpt_id() {
        let cat = Catalog::builtin();

        // Measured: `winget search OpenAI.ChatGPT` on a real machine returns
        // "找不到与输入条件匹配的程序包" and exits -1978335212 / 0x8A150014.
        // It is not a package in any source, so no entry may advertise it.
        const UNRESOLVABLE: &str = "OpenAI.ChatGPT";

        for id in cat.ids() {
            let entry = cat.entry(id);
            for declared in entry.winget_ids() {
                assert_ne!(
                    declared, UNRESOLVABLE,
                    "{:?} advertises `{UNRESOLVABLE}`, which `winget search` cannot \
                     resolve (exit 0x8A150014). The preferred lookup key misses and \
                     detection silently falls back to display-name matching.",
                    id
                );
            }
        }
    }
}
