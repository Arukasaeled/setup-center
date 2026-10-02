# Installer Core Subsystem

# Responsibility
负责执行方案构建（`EnvironmentPlan`）、单软件自选安装计划（`build_install_plan_for`）、多步异步安装跟踪与恢复会话。

# Owns
- `EnvironmentPlan`, `PlanStep`, `InstallSession`, `StepResult`, `ActionTrace`。

# Does NOT Own
- 安装流程向导视图（属于 `screens/Install.tsx`）。
- 按钮外观与动效（属于 `ui/`、`styles/`）。

# Public Entry Points
- `src/core/installer/index.ts`
- 对应后端执行引擎位于 `src-tauri/src/modules/executor.rs`、`install.rs`。
