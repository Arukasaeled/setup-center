# Environment Core Subsystem

# Responsibility
环境检测、机器硬件配置（CPU、GPU、显存、虚拟化）读取与学生目标所需能力状态判定。

# Owns
- `CapabilityStatus`, `MachineFacts`, `SoftwareInfo`, `RequirementOutcome`, `ProbeRow` 类型边界。

# Does NOT Own
- 诊断结果的图形化呈现（属于 `screens/Detect.tsx`、`screens/Dashboard.tsx`）。

# Public Entry Points
- `src/core/environment/index.ts`
- 对应后端实现位于 `src-tauri/src/modules/detect.rs`、`machine.rs`、`capability.rs`。
