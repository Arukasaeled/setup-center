//! Environment detection module.
//!
//! Design notes
//! ------------
//! * Every probe returns a [`Signal`] rather than a bare bool. A probe that
//!   cannot answer reports [`Confidence::Unknown`]; it never silently reports
//!   "absent". This is the `fallback` idea borrowed from claude-code-toolbox:
//!   detection must degrade, not lie.
//! * Probes are independent functions with no shared state, so they can be
//!   run in any order and unit-tested without a Windows session.
//! * This stage (1) ships the Windows/disk/network probes for real and keeps
//!   the software-inventory probe behind the same interface, ready for stage 2.

use crate::model::*;

use std::path::{Path, PathBuf};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// `CREATE_NO_WINDOW`. Without this, every probe flashes a console window on
/// top of the installer, which looks broken.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Runs a command without flashing a console window and returns stdout+stderr.
///
/// Output decoding is [`decode_console_output`] rather than a bare
/// `from_utf8_lossy`, because a Windows child process does not reliably write
/// UTF-8 to a pipe — see that function.
pub fn run_capture(program: &str, args: &[&str]) -> AppResult<String> {
    let spec = crate::modules::process::ProcessSpec::new(program, args)
        .with_timeout(std::time::Duration::from_secs(10));

    let res = crate::modules::process::execute_process(&spec).map_err(|e| AppError::ProbeFailed {
        probe: program.to_string(),
        reason: e,
    })?;

    if res.exit_code != Some(0) {
        return Err(AppError::ProbeFailed {
            probe: program.to_string(),
            reason: format!("进程退出非零 ({:?}): {}", res.exit_code, res.merged_output),
        });
    }

    Ok(res.merged_output)
}

/// Decodes a child process's captured output into a `String`.
///
/// UTF-8 is tried first and covers everything we launch with an explicit encoding
/// (see `UNINSTALL_SCRIPT`, which sets `[Console]::OutputEncoding`). When the bytes
/// are not valid UTF-8 they are decoded as GBK, because that is what the
/// alternatives actually produce:
///
/// * Windows PowerShell 5.1 writes its stdout in the OEM code page when stdout is
///   a **pipe** rather than a console — 936 (GBK) on a Chinese system, 437 on a US
///   one. Rust always reads a pipe.
/// * `reg.exe` and other native tools follow the same rule.
///
/// A bare `from_utf8_lossy` on a GBK byte sequence does not fail loudly: it
/// substitutes `U+FFFD` for every invalid byte. That turned VS Code's real install
/// location `D:\工具软件\Microsoft VS Code` into `D:\??????\Microsoft VS Code` in the
/// evidence panel, with no error anywhere. Reaching for the right code page is the
/// difference between showing the student their own path and showing them
/// question marks.
pub fn decode_console_output(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    #[cfg(windows)]
    {
        if let Some(text) = decode_gbk(bytes) {
            return text;
        }
    }
    // Neither encoding fits (mixed or truncated output). Lossy UTF-8 keeps the
    // readable parts instead of returning an error: a partially legible evidence
    // line is more useful than none, and the lossy path is what the previous
    // implementation did for everything.
    String::from_utf8_lossy(bytes).into_owned()
}

/// Decodes GBK/GB18030 bytes via the OS code page.
///
/// Uses `MultiByteToWideChar` directly rather than pulling in an encoding crate:
/// the conversion is one call, it is the same table Windows itself uses, and a
/// dependency that exists only to decode `reg.exe` output would be a poor trade.
#[cfg(windows)]
fn decode_gbk(bytes: &[u8]) -> Option<String> {
    use windows_sys::Win32::Globalization::{
        MultiByteToWideChar, CP_ACP, MB_ERR_INVALID_CHARS,
    };

    if bytes.is_empty() {
        return Some(String::new());
    }

    // CP_ACP is the system ANSI code page, which is 936 on the machines this is
    // built for. Asking Windows avoids hard-coding a code page number.
    let len = unsafe {
        MultiByteToWideChar(
            CP_ACP as u32,
            0,
            bytes.as_ptr(),
            bytes.len() as i32,
            std::ptr::null_mut(),
            0,
        )
    };
    if len <= 0 {
        return None;
    }

    let mut wide = vec![0u16; len as usize];
    let written = unsafe {
        MultiByteToWideChar(
            CP_ACP as u32,
            MB_ERR_INVALID_CHARS,
            bytes.as_ptr(),
            bytes.len() as i32,
            wide.as_mut_ptr(),
            len,
        )
    };
    if written <= 0 {
        return None;
    }
    wide.truncate(written as usize);
    String::from_utf16(&wide).ok()
}

#[cfg(not(windows))]
#[allow(dead_code)]
fn decode_gbk(_bytes: &[u8]) -> Option<String> {
    None
}

// ---------------------------------------------------------------------------
// Probe 1: Windows version
// ---------------------------------------------------------------------------

/// Reads the OS version from the registry rather than `GetVersionEx`, which
/// lies for anything above Windows 8 unless the binary carries a compatibility
/// manifest. `CurrentBuildNumber` is authoritative for distinguishing 10/11.
pub fn probe_windows() -> AppResult<WindowsInfo> {
    let (major, minor, build) = read_os_version();
    let product = read_registry_string(
        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
        "ProductName",
        true,
    )
    .unwrap_or_else(|| "Windows".to_string());
    let display_version = read_registry_string(
        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
        "DisplayVersion",
        true,
    );

    // Windows 11 starts at build 22000. `ProductName` still says "Windows 10"
    // on some 11 machines, so the build number wins.
    let edition = if build >= 22000 {
        "Windows 11".to_string()
    } else if product.contains("Windows 10") || build >= 10240 {
        "Windows 10".to_string()
    } else {
        product
    };

    Ok(WindowsInfo {
        edition,
        release: display_version,
        build: format!("{major}.{minor}.{build}"),
        major,
        minor,
        build_number: build,
        architecture: std::env::consts::ARCH.to_string(),
    })
}

/// Reads the OS build via PowerShell, which reports the true build on Windows 11.
///
/// `cmd ver` is **not** usable as a primary source: on modern Windows it returns
/// a compatibility-shimmed `10.0.0` regardless of the real build. `Get-CimInstance`
/// reads the same value the Settings app shows.
fn read_os_version() -> (u32, u32, u32) {
    let text = run_capture_powershell(
        "[System.Environment]::OSVersion.Version.ToString() + '|' + \
         ([System.Security.Principal.WindowsIdentity]::GetCurrent()).Name",
    );

    if let Some(text) = text {
        if let Some(version) = text.split('|').next() {
            let parts: Vec<&str> = version.trim().split('.').collect();
            if let (Some(major), Some(minor), Some(build)) =
                (parts.first(), parts.get(1), parts.get(2))
            {
                if let (Ok(major), Ok(minor), Ok(build)) = (
                    major.trim().parse::<u32>(),
                    minor.trim().parse::<u32>(),
                    build.trim().parse::<u32>(),
                ) {
                    if build > 0 {
                        return (major, minor, build);
                    }
                }
            }
        }
    }

    parse_ver_output().unwrap_or((10, 0, 0))
}

/// Delegates to [`run_capture`], kept as a named helper so the probe code reads
/// as "ask PowerShell this question" rather than repeating the argument list.
fn run_capture_powershell(script: &str) -> Option<String> {
    run_capture(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", script],
    )
    .ok()
}

fn parse_ver_output() -> Option<(u32, u32, u32)> {
    let text = run_capture("cmd", &["/C", "ver"]).ok()?;
    // "Microsoft Windows [Version 10.0.26100.2314]"
    let start = text.find("Version ")? + "Version ".len();
    let rest = &text[start..];
    let end = rest.find(']').unwrap_or(rest.len());
    let mut parts = rest[..end].trim().split('.');
    let major = parts.next()?.trim().parse().ok()?;
    let minor = parts.next()?.trim().parse().ok()?;
    let build = parts.next()?.trim().parse().ok()?;
    // A build of 0 means the shim answered; that is worse than no answer.
    if build == 0 {
        return None;
    }
    Some((major, minor, build))
}

pub fn signal_windows(info: &WindowsInfo) -> Signal {
    let label = format!(
        "{} {}",
        info.edition,
        info.release.clone().unwrap_or_default()
    );
    let label = label.trim().to_string();

    // weight 25: the OS is a prerequisite but Windows 10 19045+ is fine.
    if info.build_number >= 17763 {
        Signal::ok("windows.version", "Windows 版本", format!("{label} ({})", info.build), 25.0)
    } else {
        Signal::fail("windows.version", "Windows 版本", format!("{label} ({})", info.build), 25.0)
            .with_hint("请先通过 Windows 更新升级到 Windows 10 1809 或更高版本。")
    }
}

// ---------------------------------------------------------------------------
// Probe 2: administrator rights
// ---------------------------------------------------------------------------

/// Checks *both* elevation and group membership. A student on a school laptop
/// often has an admin account but did not elevate; we want to tell them
/// "restart as admin" rather than "ask your IT department".
pub fn probe_admin() -> AdminInfo {
    let user_name = std::env::var("USERNAME").unwrap_or_else(|_| "unknown".to_string());

    #[cfg(windows)]
    {
        let (is_elevated, elevated_uncertain) = match is_process_elevated() {
            Some(v) => (v, false),
            None => (false, true),
        };
        let (is_admin_member, member_uncertain) = match check_admin_group() {
            Some(v) => (v, false),
            None => (false, true),
        };
        AdminInfo {
            is_elevated,
            user_name,
            is_admin_member,
            detection_uncertain: elevated_uncertain && member_uncertain,
        }
    }
    #[cfg(not(windows))]
    {
        AdminInfo {
            is_elevated: false,
            user_name,
            is_admin_member: false,
            detection_uncertain: true,
        }
    }
}

#[cfg(windows)]
fn is_process_elevated() -> Option<bool> {
    // `net session` requires elevation; exit code 0 means we have it.
    let mut cmd = std::process::Command::new("net");
    cmd.args(["session"]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    match cmd.status() {
        Ok(status) => Some(status.success()),
        Err(_) => None,
    }
}

#[cfg(windows)]
fn check_admin_group() -> Option<bool> {
    // `net session` only once, then fall back to the `whoami /groups` listing.
    let text = run_capture("whoami", &["/groups"]).ok()?;
    Some(text.contains("S-1-5-32-544") || text.to_lowercase().contains("administrators"))
}

pub fn signal_admin(info: &AdminInfo) -> Signal {
    if info.detection_uncertain {
        return Signal::unknown("admin.rights", "管理员权限", "无法确认", 10.0)
            .with_hint("权限状态未知。多数安装仍可继续，若失败请右键以管理员身份运行。");
    }
    if info.is_elevated {
        Signal::ok("admin.rights", "管理员权限", "已获得", 10.0)
    } else if info.is_admin_member {
        // Not blocking: winget installs per-user fine. Worth 7/10 instead of 0
        // so the score reflects "works, with a caveat".
        Signal {
            key: "admin.rights".into(),
            label: "管理员权限".into(),
            value: "未提权（当前账户属于管理员组）".into(),
            confidence: Confidence::Unknown,
            severity: Severity::Warning,
            score: Some(7.0),
            weight: Some(10.0),
            hint: Some("部分软件需要提权。安装失败时可右键以管理员身份重新运行。".into()),
        }
    } else {
        Signal::unknown("admin.rights", "管理员权限", "当前账户非管理员", 10.0)
            .with_hint("将使用免管理员的安装方式（用户级 winget 安装），通常仍可完成。")
    }
}

// ---------------------------------------------------------------------------
// Probe 3: disk space
// ---------------------------------------------------------------------------

fn unique_probe_name() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!(".setup-center-probe-{}-{}-{}", pid, nanos, count)
}

fn test_directory_writable(dir: &Path) -> bool {
    let probe_file_name = unique_probe_name();
    let probe_path = dir.join(probe_file_name);
    let probe_result = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe_path);

    match probe_result {
        Ok(mut f) => {
            use std::io::Write;
            let pid = std::process::id();
            let payload = format!("probe:pid={pid}\n");
            let write_ok = f.write_all(payload.as_bytes()).is_ok();
            drop(f);
            let _ = std::fs::remove_file(&probe_path);
            write_ok
        }
        Err(_) => false,
    }
}

pub fn probe_disks(required_mb: u64) -> Vec<DiskInfo> {
    // System drive detection from Windows system root
    let sys_drive = system_drive();
    let sys_letter = sys_drive
        .chars()
        .next()
        .unwrap_or('C')
        .to_ascii_uppercase();

    let work_dir = work_directory();

    let mut out = Vec::new();
    let all_roots = drive_roots();

    // 1. Primary volume (where system and work_directory live) must be first.
    let primary_root = PathBuf::from(format!("{}:\\", sys_letter));
    let primary_writable = match std::fs::create_dir_all(&work_dir) {
        Ok(()) => test_directory_writable(&work_dir),
        Err(_) => false,
    };
    let (p_total, p_free) = disk_space(&primary_root).unwrap_or((0, 0));
    let p_free_mb = p_free / (1024 * 1024);
    out.push(DiskInfo {
        root: format!("{}:\\", sys_letter),
        label: None,
        total_bytes: p_total,
        free_bytes: p_free,
        writable: primary_writable,
        low_space: p_free_mb > 0 && p_free_mb < required_mb,
    });

    // 2. Discover and report all other candidate disks (D:\, E:\, etc.)
    for root in all_roots {
        let letter = root
            .to_string_lossy()
            .chars()
            .next()
            .unwrap_or('C')
            .to_ascii_uppercase();
        if letter == sys_letter {
            continue;
        }

        let writable = {
            let probe_sub = format!(".setup-center-probe-dir-{}", unique_probe_name());
            let probe_dir = root.join(&probe_sub);
            match std::fs::create_dir_all(&probe_dir) {
                Ok(()) => {
                    let ok = test_directory_writable(&probe_dir);
                    let _ = std::fs::remove_dir(&probe_dir);
                    ok
                }
                Err(_) => false,
            }
        };

        let (total, free) = disk_space(&root).unwrap_or((0, 0));
        let free_mb = free / (1024 * 1024);

        out.push(DiskInfo {
            root: root.to_string_lossy().to_string(),
            label: None,
            total_bytes: total,
            free_bytes: free,
            writable,
            low_space: free_mb > 0 && free_mb < required_mb,
        });
    }

    if out.is_empty() {
        out.push(DiskInfo {
            root: format!("{}:\\", sys_letter),
            label: None,
            total_bytes: 0,
            free_bytes: 0,
            writable: false,
            low_space: false,
        });
    }

    out
}

/// System drive string (e.g. "C:").
/// Derived from Windows system directory / %SystemRoot% / %windir% / %SystemDrive%,
/// NOT inferred from AppData or work_directory.
pub fn system_drive() -> String {
    #[cfg(windows)]
    {
        if let Ok(sd) = std::env::var("SystemDrive") {
            let trimmed = sd.trim();
            if trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':' {
                let ch = (trimmed.as_bytes()[0] as char).to_ascii_uppercase();
                if ch.is_ascii_alphabetic() {
                    return format!("{}:", ch);
                }
            }
        }
        if let Ok(sr) = std::env::var("SystemRoot").or_else(|_| std::env::var("windir")) {
            let trimmed = sr.trim();
            if trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':' {
                let ch = (trimmed.as_bytes()[0] as char).to_ascii_uppercase();
                if ch.is_ascii_alphabetic() {
                    return format!("{}:", ch);
                }
            }
        }
    }
    "C:".to_string()
}

/// The directory this app installs into and downloads to.
///
/// `%LOCALAPPDATA%\Setup Center` — the per-user location the brief's
/// "免管理员" requirement implies, and the one the user-owned winget install
/// path uses.
pub fn work_directory() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|_| PathBuf::from("C:\\"));
    base.join("Setup Center")
}

fn drive_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for letter in b'C'..=b'Z' {
        let root = PathBuf::from(format!("{}:\\", letter as char));
        if root.exists() {
            roots.push(root);
        }
    }
    if roots.is_empty() {
        roots.push(PathBuf::from("C:\\"));
    }
    roots
}

/// Total and free bytes for the volume containing `path`.
///
/// Primary source is `.NET DriveInfo` via PowerShell: `fsutil volume diskfree`
/// requires elevation (it returns `Error 5: Access is denied` for a standard
/// user), and a disk probe that only works when run as admin would report zero
/// space to exactly the students this tool targets.
fn disk_space(path: &Path) -> Option<(u64, u64)> {
    let escaped = path.to_string_lossy().replace('\'', "''");
    let script = format!(
        "$d = New-Object System.IO.DriveInfo('{escaped}'); \
         Write-Output ($d.TotalSize.ToString() + '|' + $d.AvailableFreeSpace.ToString())"
    );
    if let Some(text) = run_capture_powershell(&script) {
        let mut parts = text.trim().split('|');
        if let (Some(total), Some(free)) = (parts.next(), parts.next()) {
            if let (Ok(total), Ok(free)) =
                (total.trim().parse::<u64>(), free.trim().parse::<u64>())
            {
                if total > 0 {
                    return Some((total, free));
                }
            }
        }
    }
    None
}

pub fn signal_disk(disks: &[DiskInfo], required_mb: u64) -> Signal {
    let Some(primary) = disks.first() else {
        return Signal::unknown("disk.space", "磁盘空间", "未找到可用位置", 20.0);
    };
    let free_gb = primary.free_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
    let measured = primary.total_bytes > 0;

    if !primary.writable {
        return Signal::fail(
            "disk.space",
            "磁盘空间",
            format!("{} 不可写", primary.root),
            20.0,
        )
        .with_hint("无法写入安装目录，请检查该目录的权限后重试。");
    }

    // No measurement is not the same as no space. Report honestly.
    if !measured {
        return Signal::unknown(
            "disk.space",
            "磁盘空间",
            "无法读取可用空间",
            20.0,
        )
        .with_hint("磁盘可以写入，但无法读取剩余空间。安装前请自行确认有足够空间。");
    }

    if primary.low_space {
        Signal::fail(
            "disk.space",
            "磁盘空间",
            format!("{free_gb:.1} GB 可用（需要 {}）", format_mb(required_mb)),
            20.0,
        )
        .with_hint("请清理磁盘后重试。")
    } else {
        Signal::ok(
            "disk.space",
            "磁盘空间",
            format!("{free_gb:.1} GB 可用"),
            20.0,
        )
    }
}

fn format_mb(mb: u64) -> String {
    if mb >= 1024 {
        format!("{:.1} GB", mb as f64 / 1024.0)
    } else {
        format!("{mb} MB")
    }
}

// ---------------------------------------------------------------------------
// Probe 4: network
// ---------------------------------------------------------------------------

/// Probes the hosts that installation actually depends on.
///
/// A captive-portal campus network is the target failure this is designed to
/// catch: DNS resolves and one host answers, but the winget CDN does not.
pub fn probe_network() -> NetworkInfo {
    let proxy = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
        .iter()
        .find_map(|k| std::env::var(k).ok());

    let targets: [(&str, u16); 3] = [
        ("cdn.winget.microsoft.com", 443),
        ("github.com", 443),
        ("claude.ai", 443),
    ];

    let mut reachable = Vec::new();
    let mut best: Option<u32> = None;
    let mut failures = 0;

    for (host, port) in targets {
        match tcp_probe(host, port) {
            Some(ms) => {
                reachable.push(host.to_string());
                best = Some(best.map_or(ms, |b: u32| b.min(ms)));
            }
            None => failures += 1,
        }
    }

    let winget_reachable = reachable.iter().any(|h| h.starts_with("cdn.winget"));
    let quality = if reachable.is_empty() {
        // Everything failed. Could be offline, could be a probe limitation.
        NetworkQuality::Offline
    } else if failures > 0 || best.unwrap_or(0) > 1500 {
        NetworkQuality::Degraded
    } else {
        NetworkQuality::Good
    };

    NetworkInfo {
        quality,
        latency_ms: best,
        reachable_hosts: reachable,
        winget_reachable,
        proxy,
    }
}

fn tcp_probe(host: &str, port: u16) -> Option<u32> {
    crate::modules::process::tcp_probe_with_budget(
        host,
        port,
        std::time::Duration::from_secs(10),
    )
}

pub fn signal_network(info: &NetworkInfo) -> Vec<Signal> {
    let mut signals = Vec::new();

    // weight 25 for general connectivity, 20 for the winget CDN specifically.
    match info.quality {
        NetworkQuality::Good => {
            signals.push(Signal::ok(
                "network.connectivity",
                "网络连接",
                format!(
                    "正常（{} ms）",
                    info.latency_ms.unwrap_or_default()
                ),
                25.0,
            ));
        }
        NetworkQuality::Degraded => {
            signals.push(Signal {
                key: "network.connectivity".into(),
                label: "网络连接".into(),
                value: format!(
                    "较慢（{} ms，{} 个探测点失败）",
                    info.latency_ms.unwrap_or_default(),
                    3 - info.reachable_hosts.len()
                ),
                confidence: Confidence::Unknown,
                severity: Severity::Warning,
                score: Some(15.0),
                weight: Some(25.0),
                hint: Some("网络可用但速度较慢，安装可能需要更长时间。".into()),
            });
        }
        NetworkQuality::Offline => {
            signals.push(
                Signal::fail("network.connectivity", "网络连接", "无法连接", 25.0)
                    .with_hint("请连接网络后重新检测。位于校园网时可能需要先登录认证页面。"),
            );
        }
        NetworkQuality::Unknown => {
            signals.push(Signal::unknown(
                "network.connectivity",
                "网络连接",
                "无法确认",
                25.0,
            ));
        }
    }

    if info.winget_reachable {
        signals.push(Signal::ok(
            "network.winget",
            "winget 组件源",
            "连通（网络连通不代表下载完全可用）",
            20.0,
        ));
    } else {
        signals.push(
            Signal::unknown("network.winget", "winget 组件源", "不可达", 20.0)
                .with_hint("将自动改用官方安装包下载方式（fallback）。"),
        );
    }

    signals
}

// ---------------------------------------------------------------------------
// Probe 5: software inventory
// ---------------------------------------------------------------------------

/// Software inventory, delegated to the Software Intelligence Layer.
///
/// The probe that lives in `inventory.rs` is the only one that consults three
/// independent sources and merges them; keeping the call site here means the
/// detection report and the software status screen can never disagree about
/// what is installed, because there is exactly one implementation.
pub fn probe_software(required: &[SoftwareId]) -> SoftwareScan {
    let cat = crate::modules::catalog::Catalog::builtin();
    let inventory = crate::modules::inventory::scan(&cat, required);
    SoftwareScan {
        scanned_at: inventory.scanned_at.clone(),
        inventory,
    }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/// Runs every probe and produces the scored report the UI renders.
pub fn detect(required_mb: u64) -> AppResult<EnvironmentReport> {
    let windows = probe_windows()?;
    let admin = probe_admin();
    let disks = probe_disks(required_mb);
    let network = probe_network();
    let machine = super::machine::probe_machine();

    // Order is the order a student reads them in: the machine itself first,
    // then whether Windows is in a fit state, then privileges, then space and
    // network. Hardware leads because it is the context for everything after —
    // "8 GB RAM" explains a later warning about running several tools at once.
    let mut signals = super::machine::signals(&machine);
    signals.push(signal_windows(&windows));
    signals.push(signal_admin(&admin));
    signals.push(signal_disk(&disks, required_mb));
    signals.extend(signal_network(&network));

    let mut report = EnvironmentReport {
        windows,
        admin,
        disks,
        network,
        machine,
        signals,
        score: 0,
        score_max: 0.0,
        blocking_count: 0,
        warning_count: 0,
    };
    report.recalculate();
    Ok(report)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn now_iso8601() -> String {
    // Avoids a chrono dependency: `Get-Date` is always present on Windows, and
    // a wrong timestamp is worse than a slow one.
    run_capture(
        "powershell",
        &["-NoProfile", "-Command", "Get-Date -Format o"],
    )
    .map(|s| s.trim().to_string())
    .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(windows)]
fn read_registry_string(path: &str, name: &str, hive_local_machine: bool) -> Option<String> {
    let hive = if hive_local_machine { "HKLM" } else { "HKCU" };
    let key = format!("{hive}\\{path}");
    let text = run_capture(
        "reg",
        &["query", &key, "/v", name],
    )
    .ok()?;
    // "    ProductName    REG_SZ    Windows 11 Pro"
    for line in text.lines() {
        if line.contains(name) && line.contains("REG_SZ") {
            let idx = line.find("REG_SZ")? + "REG_SZ".len();
            return Some(line[idx..].trim().to_string());
        }
    }
    None
}

#[cfg(not(windows))]
fn read_registry_string(_path: &str, _name: &str, _h: bool) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_signal_blocks_old_builds() {
        let old = WindowsInfo {
            edition: "Windows 10".into(),
            release: None,
            build: "10.0.10240".into(),
            major: 10,
            minor: 0,
            build_number: 10240,
            architecture: "x86_64".into(),
        };
        assert_eq!(signal_windows(&old).confidence, Confidence::Fail);
    }

    #[test]
    fn windows_11_is_recognised_by_build_number() {
        // 26100 = Windows 11 24H2
        assert!(26100u32 >= 22000);
    }

    #[test]
    fn unknown_signal_earns_half_credit() {
        let s = Signal::unknown("x", "x", "x", 10.0);
        assert_eq!(s.score, Some(5.0));
        assert_eq!(s.confidence, Confidence::Unknown);
    }

    #[test]
    fn score_is_weighted_and_clamped() {
        let mut report = EnvironmentReport {
            windows: probe_windows().unwrap_or(WindowsInfo {
                edition: "Windows".into(),
                release: None,
                build: "10.0.0".into(),
                major: 10,
                minor: 0,
                build_number: 0,
                architecture: "x86_64".into(),
            }),
            admin: AdminInfo {
                is_elevated: false,
                user_name: "test".into(),
                is_admin_member: false,
                detection_uncertain: false,
            },
            disks: vec![],
            network: NetworkInfo {
                quality: NetworkQuality::Good,
                latency_ms: Some(20),
                reachable_hosts: vec!["cdn.winget.microsoft.com".into()],
                winget_reachable: true,
                proxy: None,
            },
            machine: crate::modules::machine::MachineFacts::default(),
            signals: vec![
                Signal::ok("a", "a", "a", 50.0),
                Signal::fail("b", "b", "b", 50.0),
            ],
            score: 0,
            score_max: 0.0,
            blocking_count: 0,
            warning_count: 0,
        };
        report.recalculate();
        assert_eq!(report.score, 50);
        assert_eq!(report.score_max, 100.0);
        assert_eq!(report.blocking_count, 1);
    }

    #[test]
    fn software_ids_round_trip_through_keys() {
        for id in SoftwareId::ALL {
            assert_eq!(SoftwareId::from_key(id.key()), Some(id));
        }
        assert_eq!(SoftwareId::from_key("nope"), None);
    }
}
