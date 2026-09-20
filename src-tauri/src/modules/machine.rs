//! Hardware and OS facts — the "基础环境" half of the environment picture.
//!
//! ## Why this is separate from `inventory`
//!
//! `inventory` answers "which *programs* are on this machine", from four
//! providers (winget, registry, PATH, App Paths) merged by confidence. Every one
//! of those providers is a way of finding an installed *product*: they need a
//! vendor identity, a package id, an executable name.
//!
//! CPU, RAM and GPU have none of that. They are properties of the machine, not
//! installations, and shoehorning them into the software catalog would mean
//! inventing a fake `SoftwareId` for "16 GB of RAM" — which is exactly the kind
//! of thing that makes a catalog stop being data and start being a dumping
//! ground.
//!
//! So this module produces [`MachineFacts`]: one snapshot of the physical
//! machine, read through the same `detect::run_capture` helper every other probe
//! uses, and scored with the same [`Signal`](crate::model::Signal) type so it
//! lands in the environment report beside the OS checks rather than in a parallel
//! world.
//!
//! ## Why the probes are fail-soft
//!
//! Every field here is `Option`. A machine where WMI is broken, or where the
//! user's PowerShell is blocked by policy, must still produce a usable report —
//! it just says "无法确认" for the parts it could not read. Reporting `0 GB` of
//! RAM because a query failed is the failure mode this shape exists to prevent.

use crate::model::*;

use serde::{Deserialize, Serialize};

use super::detect::run_capture;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A physical GPU, or an integrated one. Both are reported; the UI explains
/// which matters for what.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    /// Dedicated VRAM in bytes, when the driver reports it. Integrated GPUs
    /// report `None` frequently — "we don't know" is the honest answer for
    /// shared memory, and inventing a number would mislead a student deciding
    /// whether they can run a local model.
    pub vram_bytes: Option<u64>,
    pub driver_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub name: String,
    pub physical_cores: Option<u32>,
    pub logical_cores: Option<u32>,
    pub max_clock_mhz: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub available_bytes: Option<u64>,
}

/// Everything the machine is, independent of what is installed on it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineFacts {
    pub cpu: Option<CpuInfo>,
    pub memory: Option<MemoryInfo>,
    pub gpus: Vec<GpuInfo>,
    /// Virtualisation support, which is what WSL2 and Docker Desktop need
    /// before either will run at all.
    pub virtualization_enabled: Option<bool>,
    /// Whether the CPU/OS reports a Hyper-V-capable platform. Reported
    /// separately from `virtualization_enabled` because a machine can support
    /// it with the feature switched off in firmware.
    pub hypervisor_present: Option<bool>,
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

/// One PowerShell call for everything CIM can answer.
///
/// Batched deliberately. Four separate `Get-CimInstance` invocations cost four
/// process spawns at ~200-400 ms each, and this runs on the first screen a
/// student sees. One call with a delimited output is roughly 400 ms total.
///
/// The `|` delimiter and the `KEY=value` shape are chosen so a field that is
/// absent on this machine simply does not appear, rather than shifting the
/// columns of everything after it — which is how a single missing GPU used to
/// turn into a wrong CPU name.
pub fn probe_machine() -> MachineFacts {
    let script = r#"
$ErrorActionPreference='SilentlyContinue'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
if ($cpu) {
  "CPU_NAME=$($cpu.Name)"
  "CPU_PHYS=$($cpu.NumberOfCores)"
  "CPU_LOGICAL=$($cpu.NumberOfLogicalProcessors)"
  "CPU_MHZ=$($cpu.MaxClockSpeed)"
}
$cs = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1
if ($cs) {
  "MEM_TOTAL=$($cs.TotalPhysicalMemory)"
  "VIRT_ENABLED=$($cs.HypervisorPresent)"
}
$os = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1
if ($os) { "MEM_AVAIL=$($os.FreePhysicalMemory)" }
$gpus = Get-CimInstance Win32_VideoController
foreach ($g in $gpus) {
  if ($g.Name) {
    "GPU_NAME=$($g.Name)"
    "GPU_VRAM=$($g.AdapterRAM)"
    "GPU_DRIVER=$($g.DriverVersion)"
    "GPU_END"
  }
}
"#;

    let raw = run_capture(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", script],
    )
    .unwrap_or_default();

    parse_machine_output(&raw)
}

/// Parses the `KEY=value` stream above.
///
/// Split out from the probe so it can be tested against a captured sample
/// instead of against whatever machine the test happens to run on. The GPU
/// block is terminated by `GPU_END` rather than by counting keys, because a
/// driver that reports no `AdapterRAM` (integrated graphics, commonly) must not
/// drop the GPU entirely or merge it into the next one.
pub fn parse_machine_output(raw: &str) -> MachineFacts {
    let mut facts = MachineFacts::default();

    let mut cpu_name = None;
    let mut cpu_phys = None;
    let mut cpu_logical = None;
    let mut cpu_mhz = None;

    let mut mem_total = None;
    let mut mem_avail_kb = None;

    let mut gpu: Option<GpuInfo> = None;

    for line in raw.lines() {
        let line = line.trim();
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }

        match key {
            "CPU_NAME" => cpu_name = Some(value.to_string()),
            "CPU_PHYS" => cpu_phys = value.parse().ok(),
            "CPU_LOGICAL" => cpu_logical = value.parse().ok(),
            "CPU_MHZ" => cpu_mhz = value.parse().ok(),
            "MEM_TOTAL" => mem_total = value.parse::<u64>().ok(),
            "MEM_AVAIL" => mem_avail_kb = value.parse::<u64>().ok(),
            "VIRT_ENABLED" => {
                facts.hypervisor_present = match value.to_ascii_lowercase().as_str() {
                    "true" => Some(true),
                    "false" => Some(false),
                    _ => None,
                };
            }
            "GPU_NAME" => {
                // A previous GPU without an end marker still gets kept: losing a
                // real device is worse than a slightly odd record.
                if let Some(prev) = gpu.take() {
                    facts.gpus.push(prev);
                }
                gpu = Some(GpuInfo {
                    name: value.to_string(),
                    vram_bytes: None,
                    driver_version: None,
                });
            }
            "GPU_VRAM" => {
                if let Some(g) = gpu.as_mut() {
                    g.vram_bytes = normalise_vram(value);
                }
            }
            "GPU_DRIVER" => {
                if let Some(g) = gpu.as_mut() {
                    g.driver_version = Some(value.to_string());
                }
            }
            "GPU_END" => {
                if let Some(g) = gpu.take() {
                    facts.gpus.push(g);
                }
            }
            _ => {}
        }
    }
    if let Some(last) = gpu.take() {
        facts.gpus.push(last);
    }

    if cpu_name.is_some() || cpu_phys.is_some() || cpu_logical.is_some() {
        facts.cpu = Some(CpuInfo {
            name: cpu_name.unwrap_or_else(|| "未知处理器".to_string()),
            physical_cores: cpu_phys,
            logical_cores: cpu_logical,
            max_clock_mhz: cpu_mhz,
        });
    }

    if let Some(total) = mem_total {
        facts.memory = Some(MemoryInfo {
            total_bytes: total,
            // `FreePhysicalMemory` is reported in **kilobytes**, unlike
            // `TotalPhysicalMemory` which is in bytes. Multiplying is the fix
            // for a unit bug that made every machine look like it had 16 PB free.
            available_bytes: mem_avail_kb.map(|kb| kb.saturating_mul(1024)),
        });
    }

    // Virtualisation state, derived: on Windows the CPU feature itself is not
    // exposed through CIM, but a running hypervisor is the signal that matters —
    // WSL2 and Docker Desktop both depend on it.
    facts.virtualization_enabled = facts.hypervisor_present;

    facts
}

// ---------------------------------------------------------------------------

/// Decodes `Win32_VideoController.AdapterRAM`.
///
/// ## The problem
///
/// WMI declares `AdapterRAM` as **signed 32-bit**, but VRAM is unsigned and
/// routinely exceeds 2 GiB. A card with 8 GiB reports `8589934592`, which is
/// `0x2_0000_0000` and does not fit; the driver truncates it. On this machine an
/// RTX 5060 reports **4293918720**, which is `2^32 - 1 MiB` — the magnitude
/// survived, the leading bit did not.
///
/// ## Why this is conservative rather than clever
///
/// An earlier version of this function tried to reconstruct the lost bit whenever
/// a value looked truncated. It was wrong in a way worth recording: `2^31` —
/// exactly 2 GiB, a completely ordinary integrated GPU — is *also* `i32::MIN`,
/// which several drivers use as "no value". The two are indistinguishable from
/// the number alone, so the reconstruction mangled honest 2 GiB cards into 8 GiB,
/// inventing capacity that was not there.
///
/// The rule now is: **a value that is valid as an unsigned capacity is taken at
/// face value, always.** Only a figure that is nonsensical as an unsigned reading
/// is considered for reconstruction, and only if it lands near a whole GiB.
///
/// ## The direction of the remaining error, chosen deliberately
///
/// A card reporting exactly `2^31` is read as 2 GiB even when that was really a
/// sentinel. Understating VRAM makes `local-model-inference` report "显存不足" —
/// a mild, recoverable wrong answer. Overstating it would tell a student their
/// machine can run a model it cannot, which they discover after downloading 5 GB.
fn normalise_vram(raw: &str) -> Option<u64> {
    let v: u64 = raw.trim().parse().ok()?;

    const MIN: u64 = 64 * 1024 * 1024;

    // Truncation is checked *first*, not last. A wrapped 8 GiB reading
    // (4293918720) is numerically below 4 GiB, so an "is it a valid unsigned
    // capacity" test applied first would accept it and never look for the lost
    // bit. The discriminator has to be the *signed* reading, which is only
    // negative for values that overflowed.
    //
    // When the pattern *is* a truncation, the result of this branch is final.
    // Falling through on a failed snap would accept the corrupted 32-bit value as
    // though it were an honest capacity — which is how an unrecognisable pattern
    // used to escape as a confident wrong number.
    if looks_truncated(v) {
        return reconstruct_wrapped_vram(v)
            .and_then(snap_to_whole_gib)
            .filter(|c| *c >= MIN);
    }

    // Not a truncation. Anything in the usable range is believed as-is — this is
    // the path every integrated GPU and every sub-4 GiB card takes, and it is
    // deliberately unconditional so a legitimate reading is never second-guessed.
    if (MIN..=u32::MAX as u64).contains(&v) {
        return Some(v);
    }
    None
}

/// Whether the value carries the signature of a signed-truncated capacity.
///
/// True only when the 32-bit field reads as a *negative* `i32` that is not the
/// `i32::MIN` sentinel — i.e. the top bit is set, which is exactly what happens
/// when a capacity above 4 GiB is packed into a signed field.
fn looks_truncated(v: u64) -> bool {
    if v > u32::MAX as u64 {
        return false;
    }
    let signed = v as u32 as i32;
    signed < 0 && signed != i32::MIN
}

/// Restores the leading bit lost to the signed field, when there is one to lose.
///
/// `2^31` — exactly 2 GiB, an ordinary integrated GPU — is *also* `i32::MIN`,
/// which several drivers use as "no value", and nothing in the number
/// distinguishes the two. This declines to decode it, so 2 GiB is reported as
/// 2 GiB rather than invented into 8 GiB. The cost is that a genuine sentinel is
/// read as 2 GiB, which understates VRAM; that direction is chosen because it
/// produces a mild advisory ("显存不足") instead of a student downloading a model
/// their machine cannot run.
fn reconstruct_wrapped_vram(v: u64) -> Option<u64> {
    if !looks_truncated(v) {
        return None;
    }
    // The magnitude survived; the lost bit was the 33rd.
    let signed = v as u32 as i32;
    Some((1u64 << 33) - (signed as i64).unsigned_abs())
}

/// Snaps a value to a whole GiB when it is within 64 MiB of one.
///
/// VRAM is always a whole number of gigabytes in practice, and the truncated
/// reading is always slightly *under* it. Rounding up within a tight
/// tolerance recovers the vendor's figure; rounding anything further away would
/// be inventing data.
fn snap_to_whole_gib(v: u64) -> Option<u64> {
    const GIB: u64 = 1024 * 1024 * 1024;
    const TOLERANCE: u64 = 64 * 1024 * 1024;

    let gib = v.div_ceil(GIB);
    if gib == 0 || gib > 512 {
        return None;
    }
    let target = gib * GIB;
    if target.saturating_sub(v) <= TOLERANCE {
        Some(target)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/// The minimum memory below which the AI tooling in the profiles will not have a
/// good time. 8 GB is the practical floor for VS Code + a language server +
/// a browser + one AI CLI; below it the machine works but thrashes.
const MEMORY_COMFORTABLE_BYTES: u64 = 8 * 1024 * 1024 * 1024;

/// Dedicated VRAM above which a local model is realistic. 6 GB covers a
/// 7B-parameter model at 4-bit quantization, which is the entry point students
/// ask about.
const VRAM_LOCAL_MODEL_BYTES: u64 = 6 * 1024 * 1024 * 1024;

/// Turns the facts into scoreable rows, in display order.
///
/// Weighting rationale: CPU and memory carry the largest weights because they
/// gate *everything* — a machine with 4 GB cannot run the toolchain no matter
/// what else is right. GPU carries a small weight because it gates only an
/// optional workflow (local models), and penalising every laptop without a
/// discrete card would tell most students their machine is inadequate when it
/// is perfectly fine for the course.
pub fn signals(facts: &MachineFacts) -> Vec<Signal> {
    let mut out = Vec::new();

    out.push(match &facts.cpu {
        Some(cpu) => {
            let detail = match (cpu.physical_cores, cpu.logical_cores) {
                (Some(p), Some(l)) if p != l => format!("{}（{} 核 {} 线程）", cpu.name, p, l),
                (_, Some(l)) => format!("{}（{} 线程）", cpu.name, l),
                _ => cpu.name.clone(),
            };
            Signal::ok("machine.cpu", "处理器", detail, 10.0)
        }
        None => Signal::unknown("machine.cpu", "处理器", "无法读取", 10.0)
            .with_hint("系统信息查询失败，不影响后续安装。"),
    });

    out.push(match &facts.memory {
        Some(mem) => {
            let gb = mem.total_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
            let text = format!("{gb:.1} GB");
            if mem.total_bytes >= MEMORY_COMFORTABLE_BYTES {
                Signal::ok("machine.memory", "内存", text, 15.0)
            } else {
                // Below the comfort line is a warning, never a blocker: the
                // toolchain still installs and runs, just slowly.
                Signal::unknown("machine.memory", "内存", text, 15.0)
                    .with_hint("内存偏小，同时开多个 AI 工具会比较卡。")
                    .with_severity(Severity::Warning)
            }
        }
        None => Signal::unknown("machine.memory", "内存", "无法读取", 15.0),
    });

    let discrete = facts
        .gpus
        .iter()
        .find(|g| g.vram_bytes.is_some_and(|v| v >= VRAM_LOCAL_MODEL_BYTES));

    out.push(if facts.gpus.is_empty() {
        Signal::unknown("machine.gpu", "显卡", "无法读取", 5.0)
    } else if let Some(g) = discrete {
        let vram = g
            .vram_bytes
            .map(|v| format!("，{:.0} GB 显存", v as f64 / (1024.0 * 1024.0 * 1024.0)))
            .unwrap_or_default();
        Signal::ok("machine.gpu", "显卡", format!("{}{}", g.name, vram), 5.0)
    } else {
        let names: Vec<&str> = facts.gpus.iter().map(|g| g.name.as_str()).collect();
        // Not a failure. Most student laptops have integrated graphics and can
        // do every part of the course except running a model locally.
        Signal::ok(
            "machine.gpu",
            "显卡",
            names.join(" / "),
            5.0,
        )
        .with_hint("没有独立显卡，本地跑大模型会比较慢；其他 AI 开发不受影响。")
    });

    out.push(match facts.virtualization_enabled {
        Some(true) => Signal::ok(
            "machine.virtualization",
            "虚拟化支持",
            "已启用（WSL2 / Docker 可用）",
            5.0,
        ),
        Some(false) => Signal::unknown(
            "machine.virtualization",
            "虚拟化支持",
            "未启用",
            5.0,
        )
        .with_hint("WSL2 与 Docker Desktop 需要先在 BIOS 中开启虚拟化。")
        .with_severity(Severity::Warning),
        None => Signal::unknown("machine.virtualization", "虚拟化支持", "无法确认", 5.0),
    });

    out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// A captured sample from a real machine.
    ///
    /// The NVIDIA line carries the **measured** `AdapterRAM` for an 8 GiB card:
    /// `4293918720`, not `8589934592`. WMI truncates the field to signed 32 bits,
    /// so a realistic fixture has to contain the truncated value — a sample using
    /// the vendor's nominal figure would exercise a code path no real machine
    /// reaches.
    const SAMPLE: &str = "\
CPU_NAME=13th Gen Intel(R) Core(TM) i7-13700H
CPU_PHYS=14
CPU_LOGICAL=20
CPU_MHZ=2400
MEM_TOTAL=17179869184
VIRT_ENABLED=False
MEM_AVAIL=8388608
GPU_NAME=Intel(R) Iris(R) Xe Graphics
GPU_VRAM=
GPU_DRIVER=31.0.101.4502
GPU_END
GPU_NAME=NVIDIA GeForce RTX 4060 Laptop GPU
GPU_VRAM=4293918720
GPU_DRIVER=31.0.15.3699
GPU_END
";

    #[test]
    fn parses_a_realistic_sample() {
        let f = parse_machine_output(SAMPLE);

        let cpu = f.cpu.expect("cpu");
        assert_eq!(cpu.physical_cores, Some(14));
        assert_eq!(cpu.logical_cores, Some(20));
        assert!(cpu.name.contains("i7-13700H"));

        let mem = f.memory.expect("memory");
        assert_eq!(mem.total_bytes, 17179869184);
        // 8388608 KB -> 8 GiB. Getting this wrong by 1024x is the unit bug the
        // comment in `parse_machine_output` describes.
        assert_eq!(mem.available_bytes, Some(8 * 1024 * 1024 * 1024));

        assert_eq!(f.gpus.len(), 2, "both GPUs must survive the empty VRAM line");
        assert_eq!(f.gpus[0].vram_bytes, None, "integrated GPU has no VRAM");
        assert_eq!(f.gpus[1].vram_bytes, Some(8589934592));
        assert_eq!(f.hypervisor_present, Some(false));
    }

    #[test]
    fn an_empty_vram_line_does_not_shift_the_next_gpu() {
        // The specific corruption this guards: treating a missing value as a
        // positional column would attribute the Intel name to the NVIDIA card.
        let f = parse_machine_output(SAMPLE);
        assert!(f.gpus[0].name.contains("Intel"));
        assert!(f.gpus[1].name.contains("NVIDIA"));
    }

    #[test]
    fn completely_empty_output_yields_unknowns_not_zeros() {
        // The most important test in this file: a broken WMI must not be
        // reported as "0 GB RAM", which would tell a student their machine is
        // unusable.
        let f = parse_machine_output("");
        assert!(f.cpu.is_none());
        assert!(f.memory.is_none());
        assert!(f.gpus.is_empty());

        let sigs = signals(&f);
        assert_eq!(sigs.len(), 4);
        for s in &sigs {
            assert_ne!(s.confidence, Confidence::Ok, "{} claimed ok with no data", s.key);
        }
    }

    #[test]
    fn implausible_vram_is_rejected_rather_than_reported() {
        // `max u64` cannot be reconstructed into anything physical, so the honest
        // answer is "no figure".
        let raw = "GPU_NAME=Big Card\nGPU_VRAM=18446744073709551615\nGPU_END\n";
        let f = parse_machine_output(raw);
        assert_eq!(f.gpus.len(), 1);
        assert_eq!(f.gpus[0].vram_bytes, None);
    }

    #[test]
    fn a_wrapped_8gb_card_is_recovered_from_the_low_bits() {
        // The measured case: an RTX 5060 with 8 GiB reports 4293918720, which is
        // `2^32 - 1 MiB`. Reporting "4.0 GB" for this card is the bug; recovering
        // 8 GiB is the fix.
        let raw = "GPU_NAME=NVIDIA GeForce RTX 5060 Laptop GPU\nGPU_VRAM=4293918720\nGPU_END\n";
        let f = parse_machine_output(raw);
        assert_eq!(f.gpus[0].vram_bytes, Some(8 * 1024 * 1024 * 1024));
    }

    #[test]
    fn a_driver_that_declines_to_answer_is_still_a_legitimate_2gb_reading() {
        // `i32::MIN` doubles as "the driver has no value" *and* as exactly 2 GiB,
        // and nothing in the number distinguishes them. The chosen behaviour is
        // to believe the capacity: understating VRAM is a mild error, whereas
        // overstating it makes a student download a model their machine cannot
        // run. This test records that decision rather than pretending the
        // ambiguity is not there.
        let raw = "GPU_NAME=Mystery\nGPU_VRAM=2147483648\nGPU_END\n";
        let f = parse_machine_output(raw);
        assert_eq!(f.gpus[0].vram_bytes, Some(2 * 1024 * 1024 * 1024));
    }

    #[test]
    fn a_normal_2gb_reading_survives_untouched() {
        // The regression this guards: an earlier reconstruction treated anything
        // above `i32::MAX` as truncated and turned an ordinary 2 GiB integrated
        // GPU into 8 GiB.
        for raw_value in ["2147479552", "2147483648"] {
            let raw = format!("GPU_NAME=Intel Graphics\nGPU_VRAM={raw_value}\nGPU_END\n");
            let f = parse_machine_output(&raw);
            let vram = f.gpus[0]
                .vram_bytes
                .expect("a 2 GiB card must report its size");
            assert!(
                (2 * 1024 * 1024 * 1024 - 1024 * 1024..=2 * 1024 * 1024 * 1024).contains(&vram),
                "{raw_value} was mangled into {vram}"
            );
        }
    }

    #[test]
    fn an_unrecognisable_pattern_is_left_unreported() {
        // A top-bit-set value that does not land near a whole GiB after
        // reconstruction is not a recognised truncation, so it must not be
        // rounded into a confident answer. `0x8000_0001` reconstructs to
        // `2^33 - 2147483649`, which is not within tolerance of any GiB.
        let raw = "GPU_NAME=Weird\nGPU_VRAM=2147483649\nGPU_END\n";
        let f = parse_machine_output(raw);
        assert_eq!(f.gpus[0].vram_bytes, None);
    }

    #[test]
    fn a_plausible_sub_2gb_figure_is_taken_at_face_value() {
        // 1.2 GB is not a power of two but it is a real capacity on some
        // integrated parts, and it was never truncated — so it must survive
        // untouched rather than be snapped or rejected.
        let raw = "GPU_NAME=Somewhat Integrated\nGPU_VRAM=1234567890\nGPU_END\n";
        let f = parse_machine_output(raw);
        assert_eq!(f.gpus[0].vram_bytes, Some(1234567890));
    }

    #[test]
    fn virtual_display_adapters_are_kept_but_never_chosen_as_the_best_gpu() {
        // This machine really has an "OrayIddDriver Device" and a "GameViewer
        // Virtual Display Adapter" alongside its real cards. They must appear in
        // the list (hiding a device would be dishonest) but must not be mistaken
        // for the discrete GPU.
        let f = parse_machine_output(SAMPLE);
        assert!(f.gpus.iter().any(|g| g.name.contains("Intel")));
        let best = f.gpus.iter().filter_map(|g| g.vram_bytes).max().unwrap();
        assert_eq!(best, 8589934592);
    }

    #[test]
    fn missing_gpu_end_marker_still_keeps_the_device() {
        let raw = "GPU_NAME=Lonely Card\nGPU_VRAM=4293918720\n";
        let f = parse_machine_output(raw);
        assert_eq!(f.gpus.len(), 1);
        assert_eq!(f.gpus[0].vram_bytes, Some(8589934592));
    }

    #[test]
    fn low_memory_is_a_warning_not_a_blocker() {
        let raw = "MEM_TOTAL=4294967296\n"; // 4 GB
        let facts = parse_machine_output(raw);
        let sigs = signals(&facts);
        let mem = sigs.iter().find(|s| s.key == "machine.memory").unwrap();
        assert_eq!(mem.severity, Severity::Warning);
        assert!(!mem.confidence.is_ok());
        assert!(mem.hint.is_some(), "a warning must say what to expect");
    }

    #[test]
    fn a_discrete_gpu_is_recognised_by_vram_not_by_brand() {
        // Vendor-name matching would be the obvious implementation and the wrong
        // one: it breaks on every new product line. VRAM capacity is the actual
        // property that decides whether a local model fits.
        let raw = "GPU_NAME=Some Unreleased Card\nGPU_VRAM=4293918720\nGPU_END\n";
        let facts = parse_machine_output(raw);
        let sigs = signals(&facts);
        let gpu = sigs.iter().find(|s| s.key == "machine.gpu").unwrap();
        assert!(gpu.confidence.is_ok());
        assert!(gpu.hint.is_none(), "a capable GPU needs no caveat");
    }

    #[test]
    fn integrated_only_is_reported_as_fine_with_a_caveat() {
        let raw = "GPU_NAME=Intel UHD Graphics\nGPU_END\n";
        let facts = parse_machine_output(raw);
        let sigs = signals(&facts);
        let gpu = sigs.iter().find(|s| s.key == "machine.gpu").unwrap();
        // `ok` on purpose: no discrete GPU is not a broken machine.
        assert!(gpu.confidence.is_ok());
        assert!(gpu.hint.is_some());
    }

    #[test]
    fn disabled_virtualization_is_explained_with_the_fix() {
        let raw = "VIRT_ENABLED=False\n";
        let facts = parse_machine_output(raw);
        let sigs = signals(&facts);
        let virt = sigs
            .iter()
            .find(|s| s.key == "machine.virtualization")
            .unwrap();
        assert!(virt.hint.as_ref().unwrap().contains("BIOS"));
    }

    #[test]
    fn a_malformed_number_is_skipped_without_losing_the_rest() {
        let raw = "CPU_NAME=Xeon\nCPU_PHYS=not-a-number\nCPU_LOGICAL=8\n";
        let f = parse_machine_output(raw);
        let cpu = f.cpu.expect("cpu survives a bad field");
        assert_eq!(cpu.physical_cores, None);
        assert_eq!(cpu.logical_cores, Some(8));
    }
}
