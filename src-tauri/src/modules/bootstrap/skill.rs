//! Skill bootstrap — directory copy and registration only.
//!
//! Reuse decision: **we adopt the community's existing skill layout instead of
//! defining one.** A skill is a directory containing `SKILL.md` with YAML
//! frontmatter (`name`, `description`); that is what Anthropic's skills repo and
//! the agent implementations that read it already agree on. So this module has no
//! manifest format, no schema, no registry — it copies a directory to the right
//! place and reports what it found.
//!
//! V1 scope, per the brief: no marketplace, no search, no cloud sync, no
//! versioning. A profile names skills that ship *inside the app's own resources*;
//! nothing is fetched.
//!
//! Why "copy a directory" needs care at all
//! ----------------------------------------
//! Three things make a naive copy wrong:
//!
//! * **A skill that is already there must not be silently overwritten.** A
//!   student may have edited a skill's `SKILL.md` locally. V1 reports the
//!   conflict and leaves the existing directory alone; the alternative is
//!   destroying edits the user cannot recover.
//! * **A directory without `SKILL.md` is not a skill.** Copying it would place a
//!   directory the agent lists but cannot use, which is worse than not copying.
//! * **A partial copy is worse than none.** The copy goes to a temporary sibling
//!   and is moved into place only once complete, so an interrupted run cannot
//!   leave a half-populated skill the agent will try to load.

use std::path::{Path, PathBuf};

/// Why a skill could not be prepared or installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillError {
    /// The source directory is missing.
    SourceMissing { path: String },
    /// The source has no `SKILL.md`, so it is not a skill.
    NotASkill { path: String, reason: String },
    /// A skill with this name is already installed.
    AlreadyInstalled { name: String, path: String },
    /// The copy or the move failed.
    CopyFailed { path: String, reason: String },
}

impl SkillError {
    pub fn message(&self) -> String {
        match self {
            SkillError::SourceMissing { path } => {
                format!("技能源目录不存在：{path}")
            }
            SkillError::NotASkill { path, reason } => {
                format!("{path} 不是一个有效技能：{reason}")
            }
            SkillError::AlreadyInstalled { name, path } => {
                format!("技能 {name} 已存在于 {path}，为保留你的本地修改，本次未覆盖。")
            }
            SkillError::CopyFailed { path, reason } => {
                format!("复制技能到 {path} 失败：{reason}")
            }
        }
    }

    /// Whether this is a "nothing was wrong, we just did not act" case.
    ///
    /// Reported as a *skipped success* rather than a failure: the desired end
    /// state already holds, and making it red would train students to ignore red.
    ///
    /// Takes `&self` so a caller can ask and still use the error afterwards — the
    /// trace needs the message either way.
    pub fn is_benign(&self) -> bool {
        matches!(self, SkillError::AlreadyInstalled { .. })
    }
}

/// One skill the profile asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillRequest {
    /// Directory name, also the registered name.
    pub name: String,
    /// Where it comes from — always inside the app's resources.
    pub source: PathBuf,
}

impl SkillRequest {
    pub fn new(name: impl Into<String>, source: impl Into<PathBuf>) -> Self {
        Self {
            name: name.into(),
            source: source.into(),
        }
    }
}

/// Validates a skill source directory.
///
/// The `SKILL.md` requirement is the one rule the whole community already
/// follows, so checking it is what keeps this compatible: a directory that
/// satisfies it is loadable by every implementation that reads skills.
pub fn validate_source(source: &Path) -> Result<(), SkillError> {
    if !source.is_dir() {
        return Err(SkillError::SourceMissing {
            path: source.to_string_lossy().to_string(),
        });
    }
    let skill_file = source.join("SKILL.md");
    if !skill_file.is_file() {
        return Err(SkillError::NotASkill {
            path: source.to_string_lossy().to_string(),
            reason: "缺少 SKILL.md".into(),
        });
    }
    Ok(())
}

/// Reads the `name:` and `description:` fields from a `SKILL.md` frontmatter.
///
/// Returns `(name, description)`, either of which may be `None`. Parsing is
/// deliberately minimal — a real YAML parser would be a dependency to read two
/// lines, and a skill whose frontmatter is too exotic to parse with this is still
/// installable; the fields are only used for display.
pub fn read_frontmatter(skill_md: &str) -> (Option<String>, Option<String>) {
    let mut name = None;
    let mut description = None;

    // Frontmatter must be the first thing in the file, fenced by `---`.
    let mut lines = skill_md.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("name:") {
            name = Some(unquote(value.trim()));
        } else if let Some(value) = trimmed.strip_prefix("description:") {
            description = Some(unquote(value.trim()));
        }
    }

    (name, description)
}

fn unquote(value: &str) -> String {
    let trimmed = value.trim();
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        return trimmed[1..trimmed.len() - 1].to_string();
    }
    trimmed.to_string()
}

/// Whether a skill is already present at `target_root/<name>`.
pub fn is_installed(target_root: &Path, name: &str) -> bool {
    target_root.join(name).join("SKILL.md").is_file()
}

/// Copies a skill directory into `target_root/<name>`.
///
/// The move-into-place discipline is the point:
///
/// 1. copy into `<target_root>/.<name>.incoming`;
/// 2. remove the staging directory if anything fails partway;
/// 3. rename into place — an atomic operation on the same volume, so the skill is
///    either absent or complete, never half-written.
///
/// A pre-existing destination is *not* overwritten: see [`SkillError::AlreadyInstalled`].
pub fn install(request: &SkillRequest, target_root: &Path) -> Result<SkillInstalled, SkillError> {
    validate_source(&request.source)?;

    let destination = target_root.join(&request.name);
    if is_installed(target_root, &request.name) {
        return Err(SkillError::AlreadyInstalled {
            name: request.name.clone(),
            path: destination.to_string_lossy().to_string(),
        });
    }

    std::fs::create_dir_all(target_root).map_err(|e| SkillError::CopyFailed {
        path: target_root.to_string_lossy().to_string(),
        reason: e.to_string(),
    })?;

    let staging = target_root.join(format!(".{}.incoming", request.name));
    // A stale staging directory from an interrupted run would make `create_dir`
    // fail; clearing it first is what makes the retry work.
    let _ = std::fs::remove_dir_all(&staging);

    if let Err(e) = copy_tree(&request.source, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(SkillError::CopyFailed {
            path: destination.to_string_lossy().to_string(),
            reason: e.to_string(),
        });
    }

    // An existing *directory* with no SKILL.md is not an installed skill, but
    // `rename` will not replace it either. Clear it so the install can proceed.
    if destination.exists() && !is_installed(target_root, &request.name) {
        let _ = std::fs::remove_dir_all(&destination);
    }

    if let Err(e) = std::fs::rename(&staging, &destination) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(SkillError::CopyFailed {
            path: destination.to_string_lossy().to_string(),
            reason: e.to_string(),
        });
    }

    let files = count_files(&destination);
    Ok(SkillInstalled {
        name: request.name.clone(),
        path: destination,
        files,
    })
}

/// The result of a successful install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillInstalled {
    pub name: String,
    pub path: PathBuf,
    /// How many files were copied, reported so an empty skill is visible in the
    /// trace rather than silently "succeeding".
    pub files: usize,
}

/// Recursive directory copy.
///
/// Follows no symlinks: a link inside a skill directory that pointed outside it
/// would copy unrelated files into the agent's skill folder. Skipping links is
/// the conservative choice, and no real skill needs one.
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;

    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = to.join(entry.file_name());

        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn count_files(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                count_files(&path)
            } else {
                1
            }
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aissetup-skill-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_skill(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: A test skill.\n---\n\nBody.\n"),
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("resources")).unwrap();
        std::fs::write(dir.join("resources").join("data.txt"), "payload").unwrap();
        dir
    }

    #[test]
    fn installs_a_skill_directory() {
        let dir = tempdir("install");
        let source = make_skill(&dir.join("source"), "my-skill");
        let target = dir.join("target");

        let result = install(&SkillRequest::new("my-skill", &source), &target).unwrap();
        assert_eq!(result.name, "my-skill");
        assert_eq!(result.files, 2, "SKILL.md plus one resource");
        assert!(target.join("my-skill").join("SKILL.md").is_file());
        assert!(target.join("my-skill").join("resources").join("data.txt").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_existing_skill_is_not_overwritten() {
        // A student may have edited the skill locally. Overwriting would destroy
        // edits with no recovery path.
        let dir = tempdir("conflict");
        let source = make_skill(&dir.join("source"), "my-skill");
        let target = dir.join("target");
        make_skill(&target, "my-skill");
        std::fs::write(target.join("my-skill").join("SKILL.md"), "---\nname: mine\n---\nEDITED").unwrap();

        let err = install(&SkillRequest::new("my-skill", &source), &target).unwrap_err();
        assert!(matches!(err, SkillError::AlreadyInstalled { .. }));
        assert!(err.is_benign(), "a conflict is not a failure");
        assert!(
            std::fs::read_to_string(target.join("my-skill").join("SKILL.md"))
                .unwrap()
                .contains("EDITED"),
            "the student's edit was overwritten"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_without_skill_md_is_rejected() {
        let dir = tempdir("notaskill");
        let source = dir.join("source");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("readme.txt"), "hello").unwrap();

        let err = install(&SkillRequest::new("bad", &source), &dir.join("target")).unwrap_err();
        assert!(matches!(err, SkillError::NotASkill { .. }));
        assert!(err.message().contains("SKILL.md"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_source_is_reported() {
        let dir = tempdir("missing");
        let err = install(
            &SkillRequest::new("gone", dir.join("does-not-exist")),
            &dir.join("target"),
        )
        .unwrap_err();
        assert!(matches!(err, SkillError::SourceMissing { .. }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_copy_leaves_no_partial_skill_behind() {
        // The staging-and-rename discipline. Here the staging directory is made
        // unusable by creating a *file* where it needs to be a directory, so the
        // copy fails after it starts.
        let dir = tempdir("partial");
        let source = make_skill(&dir.join("source"), "my-skill");
        let target = dir.join("target");
        std::fs::create_dir_all(&target).unwrap();
        // Block the staging path with a file.
        std::fs::write(target.join(".my-skill.incoming"), "blocker").unwrap();

        let result = install(&SkillRequest::new("my-skill", &source), &target);
        assert!(result.is_err(), "the install should have failed");
        assert!(
            !target.join("my-skill").exists(),
            "a failed install must not leave a skill directory behind"
        );
        // And the blocker is cleared, so a retry can succeed.
        std::fs::remove_file(target.join(".my-skill.incoming")).unwrap();
        assert!(install(&SkillRequest::new("my-skill", &source), &target).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_bare_directory_where_the_skill_goes_is_replaced() {
        // A directory with no SKILL.md is not an installed skill, so it must not
        // block the install.
        let dir = tempdir("barerename");
        let source = make_skill(&dir.join("source"), "my-skill");
        let target = dir.join("target");
        std::fs::create_dir_all(target.join("my-skill")).unwrap();

        assert!(!is_installed(&target, "my-skill"));
        assert!(install(&SkillRequest::new("my-skill", &source), &target).is_ok());
        assert!(is_installed(&target, "my-skill"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nested_directories_are_copied() {
        let dir = tempdir("nested");
        let source = make_skill(&dir.join("source"), "deep");
        std::fs::create_dir_all(source.join("a").join("b")).unwrap();
        std::fs::write(source.join("a").join("b").join("c.txt"), "x").unwrap();
        let target = dir.join("target");

        let result = install(&SkillRequest::new("deep", &source), &target).unwrap();
        assert_eq!(result.files, 3);
        assert!(target.join("deep").join("a").join("b").join("c.txt").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_the_frontmatter() {
        let text = "---\nname: my-skill\ndescription: Does a thing.\n---\n\n# Body\n";
        let (name, description) = read_frontmatter(text);
        assert_eq!(name.as_deref(), Some("my-skill"));
        assert_eq!(description.as_deref(), Some("Does a thing."));
    }

    #[test]
    fn reads_quoted_frontmatter_values() {
        let text = "---\nname: \"my skill\"\ndescription: 'Has: a colon'\n---\n";
        let (name, description) = read_frontmatter(text);
        assert_eq!(name.as_deref(), Some("my skill"));
        assert_eq!(description.as_deref(), Some("Has: a colon"));
    }

    #[test]
    fn a_file_without_frontmatter_yields_nothing() {
        // Not an error: the fields are only used for display, and a skill without
        // them is still installable.
        let (name, description) = read_frontmatter("# Just a heading\n");
        assert!(name.is_none());
        assert!(description.is_none());
    }

    #[test]
    fn installed_detection_requires_skill_md() {
        let dir = tempdir("detect");
        let target = dir.join("target");
        std::fs::create_dir_all(target.join("present")).unwrap();
        std::fs::write(target.join("present").join("SKILL.md"), "---\n").unwrap();
        std::fs::create_dir_all(target.join("empty")).unwrap();

        assert!(is_installed(&target, "present"));
        assert!(!is_installed(&target, "empty"));
        assert!(!is_installed(&target, "absent"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
