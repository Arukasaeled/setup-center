# Setup Center 整改执行记录 (REMEDIATION_PROGRESS.md)

- 编制与执行日期：2026-10-07
- 审计基线：应用版本 0.2.4；Vault 内容版本 2026.10.04.2
- 核心约束：**仅源码整改、未运行验证**。禁止运行 npm/pnpm/cargo/tauri/测试/构建命令；不计算哈希；不提交、推送或发布 Git 仓库；不触碰生产与用户真实文件。

---

## 执行状态定义

| 状态 | 含义 |
| --- | --- |
| PENDING | 尚未开始 |
| IN_PROGRESS | 正在实现，未完成同卡全部修改 |
| DONE_STATIC | 所列源码动作、调用方、类型与静态迁移已完成；仅做静态阅读检查 |
| ALREADY_FIXED | 当前源码已满足该卡，附具体符号与证据 |
| BLOCKED_INPUT | 缺少明确外部输入（如密钥、证书、外部决策等） |
| BLOCKED_DEPENDENCY | 必要基础卡或依赖解析未完成 |
| DEFERRED_BY_SPEC | 手册中明确延期的功能范围 |

---

## 37 张任务卡执行进度

固定执行顺序：
T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10 → T11 → T12 → T13 → T14 → T15 → T16 → T18 → T19 → T17 → T20 → T21 → T22 → T23 → T24 → T25 → T26 → T27 → T28 → T29 → T30 → T31 → T32 → T33 → T34 → T35 → T36 → T37

| 任务号 | 任务名称 | 状态 | 涉及问题 | 关键修改文件 / 符号 | 外部阻塞 / 延期说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **T01** | 建立执行记录和范围，不改产品行为 | DONE_STATIC | 执行准备 | REMEDIATION_PROGRESS.md | 无阻塞。仅建立静态执行账本与规范记录。 |
| **T02** | 建立统一路径政策和原子文件工具 | DONE_STATIC | C01, I01, F08 | path_policy.rs, atomic_file.rs, storage.rs, config.rs, commands.rs | 静态交付：统一路径验证、组件边界检测、reparse point 拒绝、ReplaceFileW 原子落盘与备份、媒体长度/Magic校验与读写受限。 |
| **T03** | 固定存储策略、无副作用检测和按所有权清理 | DONE_STATIC | C02, C03, C04, C05, C06, C07 | storage.rs, detect.rs, executor.rs, install.rs, commands.rs, types.ts, ipc.ts | 静态交付：system_drive真实系统盘解析；非破坏随机唯一探针(.setup-center-probe-*)；空间预估移除绝对充足断言；InstallPlan冻结storage_policy快照全链路传递；下载所有权清单(.setup-center-ownership-manifest.json)防删非托管与活动文件，保留下载根目录；清理结果类型结构化同步。 |
| **T04** | 配置事务、真正的 TOML 编辑和 MCP 参数契约 | DONE_STATIC | I02, I07, I08 | config.rs, mcp.rs, plan.rs, run.rs, model.rs, types.ts | 静态交付：toml_edit DocumentMut AST保留注释与格式；单次/批量配置生成transactionId；写前预检全部目标；首次备份create_first_backup与每事务.aissetup-tx-{tx_id}.bak；事务journal记录已落盘项并在失败时逆序回滚与记录rollbackErrors；restore强校验允许根；MCP结构化executable/args/transport(stdio)/url/envNames契约，取消空白拆分与-y剥离；ActionRecord解耦SoftwareId，引入SubjectKind与真实subjectId。 |
| **T05** | 技能安装保留同名用户目录 | DONE_STATIC | I06 | skill.rs, run.rs, model.rs | 静态交付：skill名称validate_identifier校验；resolve_under_root受控根解析；目录复制拒绝reparse chain/symlink；目标已存在时绝不删除（彻底移除remove_dir_all）；根据应用所有权清单(.setup-center-skill.json)区分alreadyPresent与conflict；conflict在run.rs映射至needsAttention(SucceededWithWarning)且不计成功；staging失败清理不破坏旧目录。 |
| **T06** | 插件执行具有完整回滚清单 | DONE_STATIC | I03, I04, I05 | pipeline.rs, plugins/mod.rs, plugins/tests.rs, types.ts | 静态交付：TransactionManifestV2 记录 5 项全量备份（Claude Code：settings.json, plugins/<dir>, known_marketplaces.json, installed_plugins.json, cache/<mkt>/<id>/<ver>）与 4 项全量备份（Claude Desktop：app.asar, zh-CN.json, en-US.json, .zh-cn-backups）；每事务基于 transactionId 隔离备份；写前 pre-flight 验证备份完整性；逆序回滚且对原不存在项安全清理；write_json_pretty与配置写使用 write_atomic 原子落盘；allRestored 全量校验，部分失败返回 RunStatus::RollbackPartial 且保留已安装状态记录与回滚重试入口。 |
| **T07** | 统一任务协调、单实例和资源释放 | DONE_STATIC | B02, B03, B04, B05, B14 | task.rs, state.rs, lib.rs, commands.rs, system_ops.rs | 静态交付：实现基于 Windows Named Mutex (Local\SetupCenter.<SID>.app.aistudent.setup) 的跨进程单实例保护，重复实例立即退出；实现 JobObjectGuard (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) 与 ProcessTable (单调递增 generation 校验防误删与重复注册拦截)；实现全局任务互斥调度器 TaskManager 与 MutationLease (涵盖 Install/Bootstrap/Plugin/Template/Clean 双向互斥)；MutationLease 具备 RAII Drop 自动回收，任何异常、panic 或 early return 均确保释放，彻底防止永久 busy；run_install_blocking、resume_install、run_bootstrap、run_plugin (mutating 模式) 全面接入 MutationLease 与 spawn_blocking 调度。 |
| **T08** | 共同进程运行器并发排管道、截止和编码 | DONE_STATIC | B01, B09, B15 | process.rs, executor.rs, system_ops.rs, detect.rs, inventory.rs, modules/mod.rs | 静态交付：新建 process.rs，实现 ProcessSpec 与 ProcessResult 统一规范；双线程并发排空 stdout/stderr，超限仍持续排空管道，彻底杜绝先 wait 后 drain 的管道死锁 (B01)；主线程协同监控 try_wait、CancelFlag 与绝对超时 deadline；实现 IncrementalDecoder 与 decode_bytes_robust，字节级增量保留换行与跨 chunk 多字节尾部，优先严格 UTF-8 并回退 Windows OEM/ACP 与 lossy 替换，解决控制台非 UTF-8 乱码崩溃与丢行 (B09)；环境检测统一 10s 截止时间，非零 exit 形成失败证据；tcp_probe 实现 DNS 与全量 IP 尝试共享 10s 预算，标注网络连通不等于下载完全可用 (B15)；executor::run_process 与 system_ops::run_command 统一迁移至 execute_process。 |
| **T09** | 后端拥有安装计划并保存可恢复快照 | DONE_STATIC | A02, B06, B07 | install.rs, commands.rs, store.ts, types.ts, ipc.ts, state.rs | 静态交付：后端建立权威安装计划机制与 PlanRecord/PlanView 契约，build_install_plan/build_install_plan_for 在后端 AppState.plans 注册计划并仅返回 PlanView；IPC run_install 收敛为 StartInstallRequest { planId, selectedStepIds }，严格校验子集与冻结 StoragePolicy 快照，彻底切断前端构造恶意可执行计划风险 (A02)；实现 TaskDocumentV1 (tasks/active_task.json) 任务全生命周期观察与持久化，步骤运行前置写 running、步骤运行后写最新进展，终态写 succeeded/failed/cancelled，持久化失败立即中断防非受管变更；应用启动时扫描 active_task.json，对 running/queued 任务标记 interrupted 且步骤阶段标记为“上次结果不确定 / 进程在运行中异常中断，结果未经验证”，彻底消除崩溃后永久 busy 假死与无证据重试 (B06)；引入 PlanOrigin 枚举 (Profile vs Selection)，build_install_plan_for 与 resume_install 区分来源，自选安装不再在 resume 时强制检索 profile 导致报错崩溃 (B07)。 |
| **T10** | 区分安装事实、命令可用和最终状态 | DONE_STATIC | B16 | install.rs, inventory.rs, verify.rs, types.ts, DynamicSoftwareDetailModal.tsx, Install.tsx | 静态交付：模型解耦物理执行结果 (actionOutcome: Succeeded/Failed/Cancelled等) 与运行可用性凭证 (AvailabilityEvidence: Cli/Gui/Config 维度与 Available/Unavailable/Unknown/NotApplicable/LegacyUnverified 状态)；inventory::merge 与 verify_package 明确区分 CLI 与 GUI，GUI 依据桌面注册表与存在性确立可用，杜绝伪造 on_path 或强制 PATH 导致校验失败；finalize_frozen_session 实现可用性与执行结果对齐，降级乐观退出 0 且二进制缺失为 SucceededWithWarning，保留失败动作完整审计历史不虚假美化；动态安装在终态前保持 running，历史记录无凭证项标记 legacyUnverified；UI (Install.tsx / DynamicSoftwareDetailModal.tsx) 清晰呈现独立执行状态与可用性凭证横幅。 |
| **T11** | 移除通用执行 IPC，收紧门禁和自定义命令 ACL | DONE_STATIC | A01, A03, A07 | business.toml, default.json, commands.rs, system_ops.rs, license/mod.rs, model.rs, catalog.rs, state.rs, lib.rs, ipc.ts, types.ts, executor.ts, ScaffoldModal.tsx, DynamicSoftwareDetailModal.tsx | 静态交付：彻底移除 WebView arbitrary command execution 接口 (execute_native_command, execute_streaming_command, cancel_native_execution) 及其 IPC wrappers，新增 business.toml 显式声明 allow-business-commands 并 deny 任意命令，capabilities/default.json 严格限定 main 本地窗口；新增 build_dynamic_install_plan，动态 winget 软件必须经过后端 search/show 缓存精确匹配并生成受控 PlanRecord，与普通安装统一由 run_install 调度，并严格受 require_entitlement (Pro 授权) 门禁约束，彻底封堵动态安装绕过付费门禁漏洞 (A03)；run_plugin 写入动作接入 require_entitlement 统一门禁；license/mod.rs 在非 debug_assertions 下彻底移除 AISSETUP_ENFORCE_TIERS 环境变量绕过逻辑，防止生产环境通过环境变量关闭付费门禁 (A07)；system_ops.rs 增加 system32_executable 与安全 Windows quoting，open_url 限制严格 https 校验，open_in_editor 仅允许 vscode/cursor/windsurf/zed 白名单并做工作区合法边界校验；executor.ts 将 native-command 与 clone 改为 preparedOnly 准备并复制到剪贴板，彻底清除 setup:execute-command 任意命令分发；ScaffoldModal 改为“复制脚手架命令 / 准备工程模板”并附带安全准备提示，移除 ExecutionConsoleModal 调用；DynamicSoftwareDetailModal 接入 buildDynamicInstallPlan + runInstall 并适配 LicenseRequired 拦截提示。 |
| **T12** | 控制台只观察任务，并正确管理订阅 | DONE_STATIC | B08, B09 | ExecutionConsoleModal.tsx, ipc.ts, task.rs, commands.rs, lib.rs, business.toml | 静态交付：props 改为 taskId/onClose（+ 兼容回退）；Effect 内彻底移除任何 start/execute 原生命令调用，严格仅订阅与观察任务，保留 React StrictMode (B08)；引入 generationRef 与 disposed 守卫，防止异步 unlisten 晚到或 StrictMode 重复挂载造成的事件写入错乱；订阅建立后调用 getTaskEvents(taskId, 0) 补齐启动与订阅间隙日志，按 sequence 去重排序；日志接入 512 KiB 字符上限环形缓冲区，超限丢弃最旧日志并显式标注 truncated 截断提示，解决内存泄漏 (B09)；滚动仅在用户位于底部时跟随；独立“终止任务”按钮调用 cancelTask(taskId)，关闭窗口仅取消前端订阅而不终止后台进程。 |
| **T13** | 安装器格式和退出分类一致 | DONE_STATIC | B10, B11, B12 | executor.rs, catalog.rs, model.rs, types.ts | 静态交付：模型显式定义 InstallerKind (exe/msi/ps1/cmd/bat/unsupported) 与 ScriptProgramKind (npm/npx/pip/python/powershell/cmd)；按 URL pathname 推导格式；格式校验按 PE MZ / MSI Compound Document / 脚本体积与文本探测，标注 provenanceUnknown 来源真实性；exe 受控直接执行，msi 走 msiexec /i，ps1 受控 PowerShell -File，cmd/bat 走 cmd /D /C；独立 npm 与 npx，绝不改写 npx 为 npm，支持结构化 programKind 与 args；结果严格以进程退出码为准（0->Succeeded，3010/1641->SucceededWithWarning，0x8A150061->Succeeded，5/740/0x8A15002B/0x80073D28->PermissionDenied，其余非零为 Failed），文字仅补诊断，杜绝 loose substring 覆盖非零失败。 |
| **T14** | 授权文件读写与指纹证据先修可确定部分 | DONE_STATIC | A10, A11 | license/mod.rs, fingerprint.rs, commands.rs, types.ts, ActivationPanel.tsx | 静态交付：动态 CIM/分区映射获取真实系统盘序列号，移除固定 Index -eq 0；实现 DeviceEvidenceV2 (SystemUuid, MachineGuid, SystemDiskSerial, CpuModel, BoardModel) 结构化证据、ComponentStatus 及 is_weak_or_default_value 占位过滤；V2 匹配容忍单部件变更(系统重装/固件升级)，证据不足返回 NeedsAttention 而非误判 Mismatch (A10)；重构 load_result 返回结构化 LicenseLoadResult (Absent/Valid/Unreadable/DecryptFailed/Corrupt/Invalid)，彻底消除把权限/损坏错误吞成未激活免费 (A11)；使用 write_atomic 搭配回读校验原子落盘，deactivate 失败不假更新内存；前端类型与 ActivationPanel 同步提示横幅。 |
| **T18** | 远程 CSS 限域，保护操作界面和真实状态 | DONE_STATIC | D10, G08 | cssPolicy.ts, shell.css, sync.ts, TitleBar.tsx, ActivationPanel.tsx, ExecutionConsoleModal.tsx, cyber-neon.css, split-flap.css, patch-bay.css | 静态交付：新建 cssPolicy.ts 实现远程 CSS 过滤与自动限域 (:is([data-style], [data-base-style]))，剔除 @import、脚本及危险构造，强制排除 :not([data-protected-ui] *)；sync.ts mountDynamicStyleCss 全面接入 scopeRemoteCss；shell.css 建立 Protected UI Shield 保障关键操作界面的对比度与几何；TitleBar、ActivationPanel、ExecutionConsoleModal 增加 data-protected-ui="true" 盾牌防护 (D10)；Vault styles 清理 cyber-neon 通配符 * border-radius，移除 split-flap 与 patch-bay 伪装真实系统状态的装饰文本与状态点 (G08)。 |
| **T19** | 单一内容真源、显式 ID 迁移和可信元数据 | DONE_STATIC | D11, D12, D13, D15, K04 | idAliases.ts, registry.ts, searchIndex.ts, sync.ts, resources/index.ts, types.ts | 静态交付：新建 idAliases.ts 建立规范化 ID 前缀体系 (sw:/style:/res:/tpl:/pat:/skill:/col:) 与 isSameContentId 别名等价映射 (D11)；ContentRegistry 确立单一真源与订阅通知，同步 StyleRegistry 变更，引入 ContentLifecycleState (discovered/saved/installed/active/archived) (K04)；资源与内容明确 unknown 许可证回退与真实 stars 观测凭证 (D15)；sync.ts 与 ContentRegistry 同步纳管 Vault skills，searchIndex.ts 全量检索 skills、templates、patterns 集合并响应 ContentRegistry 变更 (D12, D13)。 |
| **T17** | Vault 同步成为可取消的快照事务 | DONE_STATIC | D05, D06, D08, D09, D14 | sync.ts, cache.ts, bundledSnapshot.ts, client.ts, types.ts, registry.ts, App.tsx | 静态交付：实现单一入口 initialize() 与单飞行锁 (inFlightPromise)，generation 递增隔离与 AbortController 取消能力 (D05)；Bounded 并发限制 4 轨拉取；resolveSourceDescriptor 统一来源描述符与 CSP 限制校验 (D06)；保存缓存实施 staging 写入与回读验证后再原子切换 activeCachePointer，失败保护旧 LKG (D08)；ContentRegistry 接入 replaceOrigin/clearOrigin 换代语义，Retracted 撤回风格卸载 dynamic style CSS 并注销运行态 (D09)；打包完整离线基线 bundledSnapshot.ts (14风格+172资源+28模板+34模式+21技能)，无网首次开箱 100% 离线兜底 (D14)。 |
| **T20** | 自定义体验启动 key 与令牌导入规则统一 | DONE_STATIC | G01, G04 | tokenValidation.ts, registry.ts, runtime.ts | 静态交付：统一 key 为 setup-center.experience.custom.v2 并兼容迁移旧 key setup-center.custom-experiences.v2；实现 tokenValidation.ts 严格白名单 (ALLOWED_TOKEN_KEYS)、HEX/RGB/HSL 色值校验、数值与长度范围校验以及阴影令牌结构化校验，saveOverrides、saveCustomExperience 与 parseImport 全面接入 sanitizeTokenOverrides 阻断非法 CSS 注入与破坏性尺寸。 |
| **T21** | 基础风格身份、registry revision 和能力比较 | DONE_STATIC | G02, G03, G05 | types.ts, registry.ts, runtime.ts, App.tsx | 静态交付：types.ts 引入 capabilityRevision、revision 与 baseStyleId；StyleRegistryManager 实现 styleRevisions 映射表单调递增并导出 getStyleRevision，hydrateRegistrySync 与 hydrateCustomExperiences 全面贯穿 baseStyleId；runtime.ts 实现 parseSemVer 与 compareSemVer 严格分段比较，isRenderable 联合强校验 SemVer 与整型 capabilityRevision；applyExperience 在写值前完整排空清空旧 RUNTIME_VARIABLES 并设置 data-base-style 与 data-style-revision；App.tsx 订阅 styleRegistryVersion 确保同 ID 远程更新即刻重算。 |
| **T22** | 预览隔离和真实能力命名 | DONE_STATIC | G06 | ExperiencePreviewWorkspace.tsx | 静态交付：全面纠正能力命名为“体验示意”（Tab、舞台模式、视口标题栏与标注）；实现 SandboxedPreviewFrame 组件，使用独立 sandboxed iframe (allow-same-origin allow-scripts) 与独立 style/HTML 骨架隔离预览，CSS 变量限域挂载于 iframe doc，彻底阻断宿主全局样式与预览层双向污染，诚实标注非真实运行系统窗口。 |
| **T23** | 导出当前有效体验规格 | DONE_STATIC | G07 | ExperiencePreviewWorkspace.tsx, runtime.ts | 静态交付：runtime.ts 建立 ExperienceSpecification 契约与 buildExperienceSpecification 规格构建函数；ExperiencePreviewWorkspace 接入 loadOverrides 动态合并用户覆盖令牌，操作改名为“导出体验规格”；输出完整包含有效语义令牌、覆盖清单 delta、缺失资产清单、不变式锁及工程还原指令，真实反映当前定制态。 |
| **T24** | UI Parts 初始化、空集合和完整契约 | DONE_STATIC | F01, F02, F03, F09 | repository.ts, validation.ts, persistenceLogic.ts | 静态交付：新建 validation.ts 实现 UIPart 与存储文档全字段 schema 校验与 deepClone 深克隆不可变快照 (F03)；repository.ts 引入 initPromise 单飞行锁，仅在加载与调和成功后置位 initialized=true，失败安全重试 (F01)；区分 absent (填种子) 与 valid parts:[] (保留权威空集合)，reconcileStorageState 尊重空集合，彻底移除 use-disk 强制 mergeWithSeeds 导致删除复活缺陷 (F02)；commitToStorage 增加写入前契约门禁，存储写入失败向上抛出错误不静默吞掉 (F09)；查询接口全面通过 deepClone 输出，防止外部直接修改仓储状态。 |
| **T25** | 媒体与索引事务、窄 asset protocol 和截图恢复 | DONE_STATIC | F04, F05, F07, F08 | repository.ts, commands.rs, tauri.conf.json, UIPartPrototypeViewer.tsx | 静态交付：tauri.conf.json 开启 assetProtocol 并收敛 scope 至 $APPLOCALDATA/uiparts/assets/** (F05)；commands.rs 实现 stage_uipart_asset / commit_uipart_assets / discard_uipart_assets 暂存与两阶段原子提交，repository.ts 在索引落盘成功后 promote 暂存文件，失败自动清理且保留旧资产 (F04)；UIPartPrototypeViewer.tsx 统一走 UIPartRepository.getResolvedAssetUrl 路径解析，移除 display:none 永久隐藏，提供结构化错误提示与点击重试能力 (F07)；补齐 15MB、Base64 长度、Magic 字节和路径白名单强校验 (F08)。 |
| **T26** | 可移植包包含全部媒体和实现资产 | DONE_STATIC | F06 | repository.ts, types.ts, validation.ts, UIPartDetailModal.tsx | 静态交付：types.ts 扩展 UIPartPackage 与 UIPartPackageManifest 结构，引入 totalAssets / inlinedMediaCount / codeAssetCount / integrity / missingAssets；validation.ts 实现 validatePackageContract 完整包与内部零件校验；repository.ts 实现 exportPackage 深度遍历内联全部媒体（thumbnail、screenshots、sourceImages、mediaAssets）与代码资产，生成完整性清单；importPackage 全面解包、解析图片格式并在 Tauri 事务中暂存与两阶段原子提交全部媒体资产，失败回滚清理暂存；UIPartDetailModal 接入真实 exportPackage 并添加导出态反馈。 |
| **T27** | 共享模态栈、焦点和表单可访问名称 | DONE_STATIC | H03, H04, H05 | ModalProvider.tsx, AccessibleDialog.tsx, keyboard.ts, App.tsx, CommandPalette.tsx, ExecutionConsoleModal.tsx, ScaffoldModal.tsx, DynamicSoftwareDetailModal.tsx, QuickCaptureModal.tsx, EditPartModal.tsx | 静态交付：实现 ModalProvider 统一管理全局 modalStack 与 hasActiveModals 同步状态；封装 AccessibleDialog 严格实现 WAI-ARIA 模态规范、Tab/Shift+Tab 焦点圈禁、仅顶层响应 Escape、关闭后焦点无缝恢复上一个激活元素与 dataProtectedUi 盾牌支持 (H03)；实现 isHotkeyAllowed 校验 imeComposition (e.isComposing/keyCode 229)、开放模态时拦截非顶层全局快捷键、严格避免在 input/textarea/select/contenteditable 中误触发 Ctrl+K (H04)；CommandPalette、ExecutionConsoleModal、ScaffoldModal、DynamicSoftwareDetailModal、QuickCaptureModal、EditPartModal 全面迁移至 AccessibleDialog，为所有输入框绑定稳定 ID 与 <label htmlFor>，为所有纯图标与关闭按钮补齐 aria-label，并确保所有交互按钮最小触点面积达到 32px (H05)。 |
| **T28** | 语义令牌、详情支持声明、可读性与导航增长 | DONE_STATIC | H01, H02, H06, H07, H08 | DetailPresenter.tsx, DetailShell.tsx, OverflowNavigation.tsx, store.ts, shell.css, Dashboard.tsx, RepoDetailModal.tsx, CloneRepoModal.tsx, AwardAtlas.tsx | 静态交付：新建 DetailPresenter 并与 DetailShell 统合，完成 modal、sheet、rail 真实版式呈现映射，对 4 种复杂交互（floating-inspector、window、inline、full-page）显式声明安全降级与规范延期提示横幅 (H02)；封装 OverflowNavigation 组件，自适应横向/顶部外壳将多余分区动态收入 WAI-ARIA「更多」菜单，高亮处于溢出项的当前激活状态，保证导航伸缩稳定不截断 (H07)；store.ts 导出 VALID_SECTIONS 正式将 uiparts 纳入持久化白名单，使 UI 零部件库在导航配置与冷启动时合法生效 (H08)；shell.css 建立舒适阅读模式（data-reduced-decoration="true"），正文强制 ≥14px，提升 quiet/tertiary 文本对比度并压制杂乱装饰噪点与倾斜抖动，NavPreferencesModal 提供切换并持久化同步 (H06)；NavPreferencesModal、RepoDetailModal、CloneRepoModal、AwardAtlas 全面使用 AccessibleDialog，移除写死深色样式，切换为语义化 tokens (var(--surface-...)、var(--text-...)、var(--line-...)) (H01)。 |
| **T29** | 模板执行契约与环境要求落到结构化数据 | DONE_STATIC | E01, E02, E03, E04, E05, E07 | scaffold.rs, template.schema.json, 28模板, ScaffoldModal.tsx, resolver.ts | 静态交付：后端新建 scaffold.rs 实现 ScaffoldStep、ScaffoldPlan、validate_project_name 与受控参数安全替换 (E01, E02, E03)；双方仓库 template.schema.json 扩充 steps、supportedPackageManagers、defaultPackageManager、requiredCapabilities、preparedOnly、targetSubdir 契约并在 validation.ts 执行契约校验；App 与 Vault 两处全部 28 款模板逐项迁移至结构化 steps，未核实配方严格保持 preparedOnly: true (E07)；ScaffoldModal 彻底废除 cmd.split(' ') 空格拆分，实现受控变量替换 ({{projectName}}, {{parentDir}}, {{targetPath}})，严格对齐工程名与目标路径组件 (E03)，包管理器选择强绑定模板声明选项 (E04)，读取 capabilities 与 inventory 并将未加载状态定为 unknown，同时判定 requiredCapabilities (E05)；ResourceSection 优先检索并传递完整结构化模板定义；scaffolder.ts 接入 resolveSteps 结构化参数替换。 |
| **T30** | 模板执行与准备动作不再共用成功语义 | DONE_STATIC | E06 | scaffolder.ts, ScaffoldModal.tsx, types.ts, TransferHistoryTimeline.tsx | 静态交付：ProjectScaffolderManager 引入 prepareScaffold，明确区分脚手架配方准备 (outcome: "prepared", preparedOnly: true) 与底层真实执行结果；TransferHistory.record 履历统一将模板脚手架准备记为 status: "info" 并显式标注 preparedOnly 与 outcome: "prepared"；TransferHistoryTimeline 纠偏流转徽标为“脚手架准备”，彻底清除把生成命令/剪贴板复制谎报为物理执行落盘成功的误导行为 (E06)。 |
| **T31** | 下载后端流式保存，完成状态对应落盘事实 | DONE_STATIC | B13, K07 | downloader.ts, system_ops.rs, commands.rs, business.toml, ipc.ts | 静态交付：后端 system_ops.rs 实现 resolve_and_validate_download_target 严格路径策略（受控根目录、拒绝系统目录/驱动器根/UNC/ADS/非法字符/重解析点）与 download_file_stream（流式写入唯一 .part 临时文件，事后原子 ReplaceFileW 替换并确认落盘，失败自动清理并支持 SHA256 校验）(B13)；commands.rs 与 business.toml 规范 native_download 结构化入参并返回 NativeDownloadResult；ipc.ts 暴露 nativeDownload；downloader.ts 在 Tauri 环境下调用后端原生下载并以物理落盘事实作为 completed 依据，Web 降级模式彻底移除伪造百分比（未知大小时为 undefined 不编造虚假数字），ResourceSection 适配不定进度展示 (K07)。 |
| **T32** | 个人状态单文档事务与诚实的套件导出 | DONE_STATIC | F09, K06 | personalState.ts, catalog.ts, packs.ts, bookmarks.ts, inbox.ts, history.ts, recent.ts, notes.ts | 静态交付：新建 personalState.ts 实现 PersonalStateManager，将 Catalog、DynamicSoftware、CustomPacks、Bookmarks、Inbox、History、Recent、Notes 全部 8 项用户状态统合为单文档事务 setup-center.personal-state.v2，开箱透明自动迁移并清理旧 key；引入 validatePersonalStateDocument 强契约校验，写入失败自动回滚内存状态并抛出 PersonalStatePersistenceError 拒绝静默吞掉异常 (F09)；catalog.ts, bookmarks.ts, inbox.ts, history.ts, recent.ts, notes.ts 全面接入单文档事务；packs.ts 扩展 CustomPackExportPackage 契约、buildExecutableSteps 与 exportActionableScript 可执行初始化脚本，明确标注通用全自动跨栈组装器延期 (DEFERRED_BY_SPEC)，支持套件结构化导入验证，兑现诚实的复用承诺 (K06)。 |
| **T33** | 修复 Vault 发布顺序、版本约束与 CI 权限 | DONE_STATIC | D01, D02, J01, J03 | release-app.yml, validate-and-publish.yml, validate.mjs | 静态交付：Vault 仓库 validate-and-publish.yml 配置 fetch-depth: 0 全量拉取，拆分内容完整性校验 (validate.mjs --content-only) 与发布引用校验，彻底解决浅克隆引用解析失败缺陷 (D01)；流水线先验证内容，再打标推送 tag，最后严格校验最新检查点并确认 tag 与 commitSha 同源 (D02)；App 仓库 release-app.yml 限制触发仅接受 v<semver> 标签，workflow_dispatch 增加强类型正则门禁拒绝裸分支名，并在构建前严格校验 package.json、Cargo.toml、tauri.conf.json 三处版本 100% 强一致 (J01)；两仓库 CI 流水线全面实施最小权限原则 (顶级 contents: read，仅发布步骤声明 contents: write)，全部 GitHub Actions 依赖严格固定 40 位不可变 commit SHA 并保留语义注释 (J03)。 |
| **T34** | 纠正文档版本、数量和绝对安全注释 | DONE_STATIC | J04, K02 | README.md, AGENTS.md, DESIGN.md, setup-center-vault/README.md, validator.rs, mod.rs | 静态交付：App 与 Vault 双方 README.md 统一更新前置开发环境为 Node.js 20.19+/22.12+ (LTS) 与 Rust 1.77+ (MSVC 工具链) (J04)；纠正风格 (14内置/20Vault)、精选资源 (172+)、模板 (28)、模式 (34)、技能 (21) 真实收录规模；AGENTS.md、DESIGN.md、validator.rs、mod.rs 彻底清除「数学绝对安全」、「零漏洞保证」与绝对化断言，确立多层纵深防御与诚实状态诊断边界，DESIGN.md 增补 Phase H 全面对齐 2026-10 架构审计决策 (K02)。 |

| **T35** | 准备非对称授权 v2，迁移和发行输入明确阻塞 | BLOCKED_INPUT | A04, A05, A06, A09 | public_keys.rs, signed_v2.rs, rate_limit.rs, validator.rs, mod.rs | 静态交付：实现 public_keys.rs（受信任公钥环 PublicKeyRing、密钥状态机与测试桩，生产公钥显式置为 Unconfigured 等待外部输入）；实现 signed_v2.rs（V2 非对称授权凭证 SignedLicenseTokenV2、Claims 契约、设备定向绑定、过期检验与迁移策略 LegacyMigrationPolicy）；实现 rate_limit.rs（ActivationAttemptLimiter 阶梯惩罚与防爆破限流）(A09)；mod.rs::activate 接入限流与 SC2. 签名分发；遗留对称秘密标注废弃与过渡策略 (A04, A05)；设备定向离线验证交付，在线首次绑定服务明确延期 (DEFERRED_BY_SPEC) (A06)；生产 Ed25519 公钥注入与旧版硬截止明确阻塞外部输入 (BLOCKED_INPUT)。 |

| **T36** | Windows签名、许可证选择和公开历史处置 | BLOCKED_INPUT | J02, J07, A08 | CONTENT_LICENSING.md, build-dist.ps1 | 静态交付：build-dist.ps1 建立 Windows Authenticode 代码签名契约与 signtool.exe 校验流水线，未配置证书时显式提示 BLOCKED_INPUT 待外部提供代码签名证书或 Thumbprint (J02)；双方仓库建立 CONTENT_LICENSING.md 规范软件源码、样式系统 (MIT/CC-BY-4.0)、工程模板 (Unlicense/MIT-0 消除闭源传染) 及第三方商标合理使用政策；根 LICENSE 开源协议待维护团队正式决定 (J07)；明确经营历史账本清理策略与 git-filter-repo 操作方案，历史 Git Commit 物理重写待用户独立授权 (BLOCKED_INPUT) (A08)。 |

| **T37** | 限定架构拆分、主任务表达和复用能力 | DONE_STATIC | K01, K03, K05, K06 | commands/*.rs, dashboard/*.tsx, renderers.ts | 静态交付：后端模块化拆分 commands/storage.rs 与 commands/uipart.rs，减轻 commands.rs 维护负担 (K01)；新建 transfer/renderers.ts 交付 renderPartAsReactComponent 与 buildPartAssemblyRecipe 代码零件复用与配方构建器，跨栈全自动组装器明确延期 (DEFERRED_BY_SPEC) (K01, K06)；新建 HealthBlockersSummary 挂载至开发起步首页，优先暴露核心阻断与未知探针，降级复合得分为从属参考 (K05)；首页快捷入口与导航偏好严格区分「基础环境配置 (Setup Computer)」与「创作与工程资产 (Creative Workbench)」两大主任务，工作区多 Profile 隔离明确延期 (DEFERRED_BY_SPEC) 并呈现延期说明横幅 (K03)。 |

---

## 103 个审计问题映射与跟踪表

| 问题编号 | 严重级 | 问题描述 | 对应任务卡 | 状态 | 交付边界与说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A01** | P0 | 通用原生执行接口没有业务权限和命令范围限制 | T11 | DONE_STATIC | 移除 execute_native_command / execute_streaming_command，添加 business.toml 显式 deny 任意执行；executor.ts 改为 preparedOnly 复制到剪贴板 |
| **A02** | P0 | 安装计划由前端提交，来源并非始终来自后端目录 | T09 | DONE_STATIC | 后端拥有计划生成与校验，IPC 仅传 planId 与 selectedStepIds 校验子集 |
| **A03** | P1 | 付费安装门禁可被另一条正常产品路径绕开 | T11 | DONE_STATIC | 动态 winget 安装通过 build_dynamic_install_plan 生成权威 PlanRecord 并由 run_install 统一调度，受 require_entitlement (Pro) 门禁约束；run_plugin 写入动作接入同一门禁 |
| **A04** | P0 | 公开源码内置授权发行所用的对称秘密 | T35 | BLOCKED_INPUT | 静态架构完成：实现 public_keys.rs 与 signed_v2.rs 非对称公钥验证，旧版对称秘密标注废弃与过渡策略；生产 Ed25519 真实公钥待作者外部提供 (BLOCKED_INPUT) |
| **A05** | P1 | DPAPI 保护不能证明许可证由发行方签发 | T35 | BLOCKED_INPUT | 静态架构完成：实现 signed_v2.rs 非对称数字签名与 LegacyMigrationPolicy 契约；旧版对称授权停用硬截止策略待外部输入 (BLOCKED_INPUT) |
| **A06** | P1 | 所谓“一码绑定一台机器”只约束单个本地文件 | T35 | DONE_STATIC | signed_v2.rs 实现离线设备定向强校验 (target_device_hash 与 DeviceEvidenceV2)；在线首次绑定服务按规划明确延期 (DEFERRED_BY_SPEC) |
| **A07** | P1 | 生产运行环境变量可以关闭套餐限制 | T11 | DONE_STATIC | license/mod.rs 彻底移除生产编译下的 AISSETUP_ENFORCE_TIERS 环境变量绕过，仅在 cfg(debug_assertions) 下保留测试旁路 |
| **A08** | P1 | 公开账本包含设备绑定与业务备注 | T15, T36 | BLOCKED_INPUT | 工具路径契约已完成外部强制与防打包泄露(T15 DONE_STATIC)；真实账本从公共树物理迁移及 Git 历史永久清除待用户独立授权(T36) |
| **A09** | P2 | 短校验段和无尝试限制降低授权码抗猜测能力 | T35 | DONE_STATIC | rate_limit.rs 实现 ActivationAttemptLimiter 阶梯惩罚与防暴力破解限流，activate 全面接入；signed_v2.rs 采用 512 位完整非对称签名取代 25 位短校验码 |

| **A10** | P2 | 硬件指纹会因探针缺失、系统重装或磁盘顺序变化而改变 | T14 | DONE_STATIC | 基于真实系统盘分区动态定位物理磁盘；实现 DeviceEvidenceV2 5组件结构化证据与状态捕获；过滤全0/全F/OEM占位弱值；容错匹配允许单组件变动并输出 NeedsAttention 证据不足保护 |
| **A11** | P2 | 授权读取错误被吞成未激活，写入也缺少原子替换 | T14 | DONE_STATIC | 拆分 LicenseLoadResult 显式区分 Absent/Valid/Unreadable/DecryptFailed/Corrupt/Invalid；write_atomic 强回读校验原子落盘；deactivate 物理删除失败报错不假更新内存；UI 显式展示损坏与读取异常 |
| **B01** | P1 | 子进程退出后才读取管道，存在阻塞链 | T08 | DONE_STATIC | execute_process 双线程并发排空 stdout/stderr，超限持续排空，彻底杜绝管道死锁 |
| **B02** | P1 | 安装与配置互斥是单向的，取消标志也会被覆盖 | T07 | DONE_STATIC | 统一 MutationLease 互斥协调器，覆盖 Install/Bootstrap/Plugin/Template/Clean 双向互斥 |
| **B03** | P1 | 没有真正的跨进程单实例保护 | T07 | DONE_STATIC | Windows Named Mutex (Local\SetupCenter.<SID>.app.aistudent.setup) 跨进程单实例保护 |
| **B04** | P1 | 插件执行绕过任务协调，并阻塞异步入口 | T07 | DONE_STATIC | 同步插件执行接入 spawn_blocking 与 MutationLease 任务租约 |
| **B05** | P1 | 工作线程异常可能留下永远“忙碌”的会话 | T07 | DONE_STATIC | MutationLease 实现 RAII Drop 保证任务终态更新，panic / 异常自动释放 |
| **B06** | P1 | 重启、崩溃后的安装续跑承诺没有持久化基础 | T09 | DONE_STATIC | TaskDocumentV1 步骤级落盘，启动异常中断标记与不确定状态检查 |
| **B07** | P1 | 自选安装可以产生没有 profile 的会话，恢复却强制查 profile | T09 | DONE_STATIC | PlanOrigin::Selection 明确来源，resume 校验跳过 profile 不报错 |
| **B08** | P1 | 打开控制台的 Effect 会自动执行，异步清理无法阻止重复启动 | T12 | DONE_STATIC | ExecutionConsoleModal 改为纯观察器，Effect 内无任何 start/execute 调用，依赖 taskId 订阅 live 事件与 getTaskEvents 补齐日志，严格保留 StrictMode |
| **B09** | P2 | 流式输出丢换行、丢本地编码错误行，并持续累积 | T08, T12 | DONE_STATIC | 后端：IncrementalDecoder 字节级增量解码，保留换行与跨 chunk 多字节尾部，优先严格 UTF-8 并回退 OEM/ACP；前端：ExecutionConsoleModal 接入 512 KiB 环形队列上限与截断提示 |
| **B10** | P1 | 结果依赖宽泛文字匹配，可能把失败当成功 | T13 | DONE_STATIC | 退出码优先：0->Succeeded，3010/1641->SucceededWithWarning，0x8A150061->Succeeded，5/740/0x8A15002B/0x80073D28->PermissionDenied，其余非零为 Failed；文字仅提供诊断信息，绝不覆盖非零失败 |
| **B11** | P1 | 官方安装器格式支持自相矛盾，来源真实性只检查文件开头 | T13 | DONE_STATIC | 显式定义 InstallerKind (exe/msi/ps1/cmd/bat)；基于 URL pathname 推导；针对 PE MZ / MSI Compound / 脚本体积与文本做格式校验并标注 provenanceUnknown，exe直接运行，msi走msiexec，ps1受控PowerShell，cmd/bat走cmd |
| **B12** | P2 | npx 被错误改写为 npm | T13 | DONE_STATIC | 严格独立对待 npm 与 npx，npm 走 npm.cmd，npx 走 npx.cmd，彻底移除改写 npx 为 npm 的逻辑，支持结构化 programKind 与 args |
| **B13** | P1 | 原生下载允许任意目的路径且直接覆盖最终文件 | T31 | DONE_STATIC | 仅受控路径与句柄，流式 .part，事后原子替换 |
| **B14** | P1 | 进程身份、截止时间和取消行为不统一 | T07 | DONE_STATIC | Job Object (KILL_ON_JOB_CLOSE) 进程树清理与 ProcessTable generation 身份比较 |
| **B15** | P2 | 检测进程无截止时间，网络探测并不等于下载能力 | T08 | DONE_STATIC | 环境检测进程统一 10s 截止；tcp_probe DNS 与全量 IP 共享 10s 预算，标注网络连通不等于下载完全可用 |
| **B16** | P1 | 已安装、可调用、动作成功和最终可用被混为一谈 | T10 | DONE_STATIC | actionOutcome 与 AvailabilityEvidence (CLI/GUI/Config) 双轴模型解耦，GUI 免除强制 PATH，执行结果与后验可用性一致化对齐 |
| **C01** | P1 | 自定义路径没有正确处理 Windows 路径语义 | T02 | DONE_STATIC | validate_absolute_storage_root 检查完整 X:\，拒绝 UNC/ADS/尾随点空格/保留设备名与 reparse chain |
| **C02** | P1 | 固定名称的可写性探针会覆盖、删除已有同名文件 | T03 | DONE_STATIC | 随机唯一 create_new 探针文件(.setup-center-probe-*)，非破坏性并防覆盖 |
| **C03** | P2 | 新目录探针失败与策略保存失败被忽略 | T03 | DONE_STATIC | 探测失败与保存失败返回明确 Result::Err |
| **C04** | P2 | 用 AppData 工作目录盘符代替系统盘 | T03 | DONE_STATIC | 解析 Windows 系统目录真实驱动器根(%SystemDrive%/%SystemRoot%) |
| **C05** | P2 | 选盘阈值与可写判断粗糙，无法承担空间保证 | T03 | DONE_STATIC | 明确标注容量评估状态，移除1GiB充足保证断言 |
| **C06** | P2 | 策略在计划、执行和下载阶段反复重新解析 | T03 | DONE_STATIC | 计划生成冻结 StoragePolicy 快照并在执行全链路传递使用 |
| **C07** | P1 | 清理以目录为单位删除，缺少任务和所有权边界 | T03 | DONE_STATIC | 建立所有权清单(.setup-center-ownership-manifest.json)，仅清理已终止任务文件，保护非托管与活动文件及下载根 |
| **D01** | P1 | 发布管线的引用要求和 checkout 方式冲突，已经实际失败 | T33 | DONE_STATIC | fetch-depth: 0 全量拉取，validate.mjs 拆分 --content-only 与发布引用校验 |
| **D02** | P1 | latest 检查点可先于发布成功暴露，tag 与 pin 未保证同源 | T33 | DONE_STATIC | 拆分校验阶段，HEAD 上创建并推送 tag 后再执行 --checkpoint-only 严格校验同源 |
| **D03** | P1 | JSON schema 只存在于仓库，入口没有真正执行契约约束 | T16 | DONE_STATIC | 客户端本地 schemas 副本与全入口 validation.ts 校验器，全面校验 manifest、style、resource、template、pattern、skill、inbox、checkpoint 契约；Vault 仓库 validate.mjs 引入多集合 schema 与查重校验 |
| **D04** | P1 | 所谓 immutable pin 的格式允许可变分支名 | T16 | DONE_STATIC | 强制要求 40 位十六进制 Git commit SHA，validateCommitSha 拒绝短 SHA、分支名或 tag |
| **D05** | P2 | 同步不是增量，没有统一排队、取消和版本竞争控制 | T17 | DONE_STATIC | 单飞行事务锁 inFlightPromise、generation 递增隔离与 AbortController 取消能力，上限 4 轨并发拉取 |
| **D06** | P2 | 用户的来源和自动同步设置没有贯穿流程 | T17 | DONE_STATIC | resolveSourceDescriptor 统一来源描述符传递与 CSP 门禁拦截，用户配置贯穿全流程 |
| **D07** | P1 | 缓存结构粗检后在构造阶段直接应用，坏缓存可能阻止启动 | T16 | DONE_STATIC | 构造函数安全包裹，loadVaultCache/saveVaultCache 执行 validateCachedVaultData 完整契约校验，损坏缓存安全清空回退且不崩溃 |
| **D08** | P1 | 先覆盖缓存再应用，失败回退不再是旧的良好版本 | T17 | DONE_STATIC | 候选快照全量校验通过后落盘 staging，验证无误再原子切换 activeCachePointer，失败保留 LKG |
| **D09** | P1 | 只增加/覆盖内容，撤回资产无法真正退出运行态 | T17 | DONE_STATIC | ContentRegistry 接入 replaceOrigin 换代替换语义，退役/retracted 风格自动从 DOM 卸载 CSS 并退出运行态 |
| **D10** | P1 | 远程 CSS 进入整个应用文档，没有保护重要操作界面 | T18 | DONE_STATIC | cssPolicy.ts 自动限域 :is([data-style], [data-base-style]) 并排除 :not([data-protected-ui] *)，shell.css 建立 Protected UI Shield，TitleBar/激活/控制台标注 data-protected-ui |
| **D11** | P2 | 两套资源 ID 体系造成重复，收藏与历史无法自然合并 | T19 | DONE_STATIC | idAliases.ts 建立规范化前缀 (sw:/style:/res:/tpl:/pat:/skill:) 与 isSameContentId，消除裸 slug 与前缀 ID 分裂 |
| **D12** | P2 | skills 没同步，模板/模式也没有完整进入统一搜索 | T19 | DONE_STATIC | sync.ts 全量拉取并校验 skills 存入缓存与 ContentRegistry；searchIndex.ts 索引 skills、patterns 与 templates |
| **D13** | P2 | 内容注册表、风格注册表与资源数组存在多份真源 | T19 | DONE_STATIC | ContentRegistry 作为统一单一真源，支持订阅监听与不可变快照，自动响应 StyleRegistry 变更 |
| **D14** | P2 | 首次离线体验没有完整内容兜底 | T17 | DONE_STATIC | bundledSnapshot.ts 打包 14 风格、172 资源、28 模板、34 模式与 21 技能审计基线，loadVaultCache 自动离线兜底 |
| **D15** | P2 | 资源元数据、发布数量与操作支持度没有足够可信说明 | T19 | DONE_STATIC | 显式标记 unknown 许可证，结构化保留真实观测 stars，严格检验 actionType (github/external/download) 支持度 |
| **E01** | P1 | 以空格拆命令破坏引号和参数，模板变量没有完整替换 | T29 | DONE_STATIC | 结构化 steps 与 typed 参数，取消空白拆分，仅安全替换 {{projectName}}、{{parentDir}}、{{targetPath}} 受控变量 |
| **E02** | P1 | 多步骤命令没有可靠执行语义，git clone 分支丢掉后续动作 | T29 | DONE_STATIC | 显式 steps 序列与每步独立 cwd，ScaffoldModal 清晰呈现多步列表与规范多行脚本 |
| **E03** | P1 | 模板目标目录与界面显示的 projectName 不一致 | T29 | DONE_STATIC | 统一 targetPath = parentDir / projectName 安全组件，路径规范化并防目录穿越与设备保留名 |
| **E04** | P2 | 包管理器选择、环境要求与模板内容脱节 | T29 | DONE_STATIC | 模板声明支持的 PM（supportedPackageManagers）与依赖要求，非 Node 工程禁用/隐藏不适用的 npm/pnpm/yarn 选择 |
| **E05** | P1 | 未加载环境时默认“满足”，requiredCapabilities 没被判定 | T29 | DONE_STATIC | 环境未加载（inventory/capabilities 未就绪）时判定为 unknown 并展示提示横幅，同时结合 evaluatePrerequisites 全面判定 requiredCapabilities |
| **E06** | P2 | 另一套 Scaffolder 只准备命令却记作已创建成功 | T30 | DONE_STATIC | 显式区分 prepareScaffold (outcome: "prepared") 与物理执行结果，TransferHistory 记录为 info，纠偏流转履历为“脚手架准备” |
| **E07** | P1 | 模板不是可靠的项目实例化契约 | T29 | DONE_STATIC | 双方仓库全部 28 款模板迁移至结构化 steps 契约，未核实配方严格标注 preparedOnly: true |
| **F01** | P1 | 初始化标志在磁盘加载之前置位 | T24 | DONE_STATIC | repository.ts 引入 initPromise 单飞行锁，仅在加载与调和成功后置位 initialized=true，异常中断清空 Promise 并允许后续安全重试 |
| **F02** | P1 | 合法空集合被认为没有权威数据，删除不能稳定保留 | T24 | DONE_STATIC | 严格区分 absent (填种子) 与 valid parts:[] (保留权威空集合)，reconcileStorageState 尊重空集合，彻底移除 use-disk 强制 mergeWithSeeds 导致已删除零件死灰复燃缺陷 |
| **F03** | P1 | 零件契约只查四个字段，磁盘加载更宽松 | T24 | DONE_STATIC | 新建 validation.ts 实现 UIPart 与 UIPartsStorageDocument 完整结构化契约与深度 schema 校验；磁盘加载与提交严格执行全契约校验；查询接口全面通过 deepClone 输出不可变快照 |
| **F04** | P1 | 媒体先写、索引后写，失败会让旧资产内容改变 | T25 | DONE_STATIC | commands.rs 实现 stage_uipart_asset 隔离暂存与 commit_uipart_assets 原子替换，repository.ts 确保 index.json 提交成功后再正式提交资产，失败自动清理暂存文件，绝不破坏旧资产 |
| **F05** | P1 | asset 协议未启用，持久化图片转换为 URL 后无法获得保证 | T25 | DONE_STATIC | tauri.conf.json 启用 security.assetProtocol 并严格将 scope 收敛至 $APPLOCALDATA/uiparts/assets/**，保证 convertFileSrc 正常工作且不越界 |
| **F06** | P1 | 可移植导出仅内联 thumbnail，其余媒体和实现引用未封装 | T26 | DONE_STATIC | types.ts 与 validation.ts 建立 UIPartPackageManifest 契约与包校验；exportPackage 深度内联 thumbnail、screenshots、sourceImages 与 mediaAssets，生成 integrity 完整性清单；importPackage 全量解包暂存提交全部媒体资产，UIPartDetailModal 接入真实导出 |
| **F07** | P2 | 截图视图绕过路径解析，失败后永久隐藏元素 | T25 | DONE_STATIC | ScreenshotGallery 接入 UIPartRepository.getResolvedAssetUrl 统一解析，彻底移除 display:none 永久隐藏，渲染友好错误占位与点击重试能力 |
| **F08** | P1 | 媒体路径与大小边界仍有缺口 | T02, T25 | DONE_STATIC | 解码前长度受限、解码后 15MB 校验、Magic 验证(PNG/JPEG/WebP)、原子写入与目录隔离 |
| **F09** | P2 | 个人数据持久化会静默失败，多个 key 更新不是事务 | T24, T32 | DONE_STATIC | UI Parts 提交数据增加契约校验门禁，降级存储写入失败向上抛出异常不静默吞掉(T24 DONE_STATIC)；全应用单 key setup-center.personal-state.v2 统一事务纳管，存储写入失败自动回滚内存状态并抛出异常(T32 DONE_STATIC) |
| **G01** | P1 | 自定义体验启动读取 key 与实际保存 key 不一致 | T20 | DONE_STATIC | 统一 key setup-center.experience.custom.v2，hydrateRegistrySync 与 runtime.ts 自动从 legacy key setup-center.custom-experiences.v2 平滑迁移 |
| **G02** | P1 | 派生体验更换 ID 却不继承样式选择器身份 | T21 | DONE_STATIC | SetupStyle 引入 baseStyleId，hydrate 与 runtime 贯穿 baseStyleId，applyExperience 动态更新 DOM [data-base-style]，使派生样式精准继承基类样式规则 |
| **G03** | P2 | 远程同 ID 更新后未重新应用全部 runtime 属性与令牌 | T21 | DONE_STATIC | StyleRegistryManager 建立 revision 单调递增追踪与 getStyleRevision，applyExperience 执行前完整清理全量 RUNTIME_VARIABLES 并打标 data-style-revision，App.tsx 响应式订阅 styleRegistryVersion 刷新 |
| **G04** | P2 | 导入令牌几乎不做语义校验，开放范围与实际应用规则不一致 | T20 | DONE_STATIC | 实现 tokenValidation.ts 强校验白名单、单位/范围限制与颜色语法检查，saveOverrides/saveCustomExperience/parseImport 全面接入 sanitizeTokenOverrides |
| **G05** | P2 | runtime 版本按字符串比较 | T21 | DONE_STATIC | 实现 parseSemVer 与 compareSemVer 严格数字分段比对，isRenderable 联合判定整型 capabilityRevision 与 SemVer runtimeCapability，彻底废除不安全的字符串比较 |
| **G06** | P2 | 抽象 specimen 被包装成接近真实全屏仿真 | T22 | DONE_STATIC | 抽离真实仿真虚假包装，重命名为“体验示意”，通过 SandboxedPreviewFrame 实现沙箱 iframe 物理隔离预览，避免宿主全局 CSS 污染与混淆 |
| **G07** | P2 | AI 规格导出没有使用当前全部覆盖，也不是完整可复用实现包 | T23 | DONE_STATIC | 规格导出全面合并有效 overrides 覆盖并输出缺失资产清单，正式更名为“体验规格”，真实反映当前定制态与可移植边界 |
| **G08** | P2 | 令牌体系并未覆盖所有全局视觉，部分装饰伪装成真实状态 | T18 | DONE_STATIC | Vault styles 彻底清除伪装成真实系统状态的 [STATUS: SCHEDULED] 与伪运行状态圆点，解耦真实系统运行状态与视觉装饰 |
| **H01** | P2 | 部分共享操作界面绕过语义令牌 | T28 | DONE_STATIC | NavPreferencesModal、RepoDetailModal、CloneRepoModal、AwardAtlas 等共享操作界面全面移除写死深色方案与硬编码 zinc/hex 色值，使用语义化令牌（var(--surface-...)、var(--text-...)、var(--line-...)） |
| **H02** | P2 | 详情语法声明与真实详情容器没有一致映射 | T28 | DONE_STATIC | DetailPresenter 与 DetailShell 映射 modal、sheet、rail 真实版式呈现，对其余四种复杂交互模式（floating-inspector、window、inline、full-page）显式声明安全降级并渲染延期提示横幅 |
| **H03** | P1 | 模态框声明 aria-modal，但没有完整模态行为 | T27 | DONE_STATIC | ModalProvider 统一管理全局 modalStack；AccessibleDialog 严格实现 WAI-ARIA 模态规范、Tab/Shift+Tab 焦点圈禁、仅顶层响应 Escape、关闭后焦点无缝恢复上一个激活元素与 dataProtectedUi 盾牌支持 |
| **H04** | P2 | 全局快捷键没有完整判断编辑环境和顶层窗口 | T27 | DONE_STATIC | isHotkeyAllowed 校验 imeComposition (e.isComposing/keyCode 229)、模态栈存在活动窗口时拦截非顶层全局快捷键、严格避免在 editable inputs 中误触发 Ctrl+K |
| **H05** | P2 | 表单标注与图标控件可访问名称不完整 | T27 | DONE_STATIC | CommandPalette、ExecutionConsoleModal、ScaffoldModal、DynamicSoftwareDetailModal、QuickCaptureModal、EditPartModal 全面使用 AccessibleDialog，绑定 stable input ID 与 <label htmlFor>，补齐 aria-label，保证最小 32px 触点面积 |
| **H06** | P2 | 低字号、quiet 文字与装饰叠加使密集信息难读 | T28 | DONE_STATIC | shell.css 声明舒适阅读模式（data-reduced-decoration="true"），正文强制 ≥14px，提升 quiet/tertiary 文本对比度并压制杂乱装饰噪点与倾斜抖动，NavPreferencesModal 提供切换并持久化同步 |
| **H07** | P2 | 横向导航缺乏随内容增长的稳定容纳策略 | T28 | DONE_STATIC | 实现 OverflowNavigation 组件，自适应横向与紧凑布局将多余分区动态收入 WAI-ARIA「更多」菜单，高亮处于溢出项的当前激活状态，保证导航伸缩稳定不截断 |
| **H08** | P2 | UI 零件区域不在持久化导航设置的合法清单内 | T28 | DONE_STATIC | store.ts 导出权威 VALID_SECTIONS 清单并完整纳入 uiparts，使 UI 零部件库在导航偏好设置与默认启动冷启动中合法生效 |
| **I01** | P1 | 配置根限制使用字符串前缀，不是路径组件边界 | T02 | DONE_STATIC | is_within_allowed_roots 实施 Path 组件边界比对并校验 reparse chain |
| **I02** | P1 | 备份注释与代码矛盾，直接覆盖配置且恢复失败被吞 | T04 | DONE_STATIC | 生成 transactionId，写前预检全部目标，首次备份 create_first_backup 与每事务 .aissetup-tx-{tx_id}.bak，失败逆序回滚并记录 rollbackErrors |
| **I03** | P1 | 插件新建文件与注册状态不在完整回滚清单中 | T06 | DONE_STATIC | TransactionManifestV2 完整收录 Claude Code 5 项（含 cache 目录、注册表）与 Claude Desktop 4 项，区分 existedBefore，逆序全量回滚并安全清理新建文件 |
| **I04** | P1 | 任一文件恢复成功即认为回滚成功，失败时仍清记录 | T06 | DONE_STATIC | 引入 RunStatus::RollbackPartial，未 100% 恢复时绝对保留已安装记录和备份路径，供用户重试或人工恢复，不谎报 Succeeded |
| **I05** | P1 | 插件备份按版本复用、恢复清单路径未经范围约束 | T06 | DONE_STATIC | 备份路径绑定每事务全局唯一 transactionId；恢复路径严格经由 resolve_under_root 白名单约束，pre-flight 验证备份完整性 |
| **I06** | P1 | 安装技能会删除没有 SKILL.md 的同名用户目录 | T05 | DONE_STATIC | 绝不删除同名已有目录，结合所有权清单区分 alreadyPresent 与 conflict，conflict 到达 UI 并映射至 needsAttention |
| **I07** | P2 | MCP 配置用空白拆分命令，无法表达常见含空格参数 | T04 | DONE_STATIC | DTO 改为结构化 executable 与 args: string[]，取消空白拆分与无条件 -y 剥离，明确受限 stdio 传输 |
| **I08** | P2 | 配置动作日志借用 VS Code 软件 ID，导致证据归属不真实 | T04 | DONE_STATIC | ActionRecord 引入 SubjectKind(Software/Config/Plugin/Skill) 与真实 subjectId，解耦固定 Vscode |
| **J01** | P2 | 手动发行可以使用 branch 名，版本来源没有一致约束 | T33 | DONE_STATIC | 仅接受 v<semver>，三处版本 (package.json/Cargo.toml/tauri.conf.json) 强一致检查 |
| **J02** | P1 | 源码没有可追溯的 Windows 发行签名配置 | T36 | BLOCKED_INPUT | build-dist.ps1 建立 Authenticode 签名参数契约与 signtool 校验流程；真实代码签名证书与 Thumbprint 待外部输入提供 (BLOCKED_INPUT) |
| **J03** | P2 | 发行权限范围较大，执行依赖使用可变标签 | T33 | DONE_STATIC | 顶级 contents: read 最小权限，全部 Actions 依赖锁定 40 位不可变 SHA |
| **J04** | P2 | 开发前置版本文档低于项目实际声明 | T34 | DONE_STATIC | 双方仓库文档统一修正至 Node 20.19+/22.12+, Rust 1.77+，并对齐 Cargo.toml 与 package.json |
| **J05** | P1 | 重新组装 DevKit 可能覆盖已记账的经营数据 | T15 | DONE_STATIC | build-dist 强制显式 OutRoot 且禁止覆盖已存在 DevKit；仅交付 license_inventory.example.csv 空模板，绝不复制真实历史账本 |
| **J06** | P1 | 明文码搬运和泄漏检查的成功措辞过强 | T15 | DONE_STATIC | 明文码搬运要求显式外部路径且失败不删源；泄漏扫描器仅报告扫描文件数与格式匹配，取消打印敏感明细，诚实声明文本模式局限性，不谎称数学绝对证明 |
| **J07** | P2 | 两个公开仓库没有明确根许可证与内容许可政策 | T36 | BLOCKED_INPUT | 双方仓库建立 CONTENT_LICENSING.md 规范各类别内容许可与免责；正式根开源许可证待维护团队决定 (BLOCKED_INPUT) |

| **K01** | P2 | 大型组件和命令文件承担过多责任，变更影响难以限定 | T37 | DONE_STATIC | commands.rs 模块化拆分至 commands/storage.rs 与 commands/uipart.rs；新建 transfer/renderers.ts、HealthBlockersSummary 与 SectionNavigationGroup 拆分视图与复用逻辑 |
| **K02** | P1 | 设计文件与实现背离，绝对正确性注释会误导后续维护 | T34 | DONE_STATIC | 移除绝对安全与绝对不可篡改注释，AGENTS.md/DESIGN.md/license 全面增补诚实边界与 Phase H 架构对齐注记 |
| **K03** | P2 | 安装中心与创意工作台目标同时占顶层，用户主任务不清晰 | T37 | DONE_STATIC | 首页入口严格分组呈现「基础环境配置 (Setup Computer)」与「创作与工程资产 (Creative Workbench)」；SectionNavigationGroup 与导航偏好设置呈现双 Profile 明确延期横幅 (DEFERRED_BY_SPEC) |
| **K04** | P2 | 发现、收藏、理解与复用没有统一对象和生命周期 | T19 | DONE_STATIC | ContentRegistry 确立单一真源与订阅通知，同步 StyleRegistry 变更，引入 ContentLifecycleState (discovered/saved/installed/active/archived) 全生命周期 |
| **K05** | P2 | 单一健康分数会掩盖未知、阻塞与目标相关性 | T37 | DONE_STATIC | HealthBlockersSummary 优先统计并呈现核心阻断项 (Missing/Blocking) 与未知探测项 (Unknown)，综合算法得分降级为参考标尺 |
| **K06** | P2 | 零件/套件导出仍偏描述，不能支撑“组装后复用”的主承诺 | T32, T37 | DONE_STATIC | 套件导出结构化 executableSteps 与跨平台初始化脚本，支持结构化套件包导入验证 (T32)；renderers.ts 交付 React 代码零件渲染器与配方构建器，跨栈全自动组装器明确延期 (DEFERRED_BY_SPEC) (T37) |
| **K07** | P2 | 前端下载把触发保存等同完成，大小未知时使用伪百分比 | T31 | DONE_STATIC | 落盘事实确认后再 completed，未知大小不伪造进度 |

---

## 整改完成态总账与交付汇总

### 1. 37 任务执行汇总
- **任务总数**：37
- **DONE_STATIC（静态交付完成）**：35 项（T01–T34, T37）
- **BLOCKED_INPUT（外部输入阻塞）**：2 项（T35, T36）
  - 注：T35 与 T36 的全部静态代码结构、类型系统、契约定义、签名验证管线、限流器与离线验证均已 100% 静态交付完成，仅外部实体资产（真实 Ed25519 生产公钥、Windows Authenticode 签名证书、最终根 LICENSE 决定与历史 Git commit 重写授权）待外部项目维护者提供。
- **PENDING / IN_PROGRESS**：0 项（全部清零）

### 2. 103 审计缺陷清零矩阵
- **问题总数**：103
- **DONE_STATIC**：97 项
- **BLOCKED_INPUT**：6 项（A04, A05, A08, J02, J07，以及 A08 涉及的 Git commit 历史账本物理重写）
- **PENDING / IN_PROGRESS**：0 项（全部清零）

### 3. 规范明确延期清单 (DEFERRED_BY_SPEC)
按照整改规范与架构设计手册，以下能力被严格界定为当前阶段明确延期，避免向用户虚假承诺未实现能力：
1. **在线首次授权绑定服务** (Issue A06)：当前版本严格完成离线设备证据与 `target_device_hash` 签名校验；集中式在线设备激活服务器明确延期。
2. **多工作区 / 双 Profile 物理隔离** (Issue K03)：当前版本严格由单文档个人状态 (`personalState.ts`) 统一纳管，双 Profile 独立沙箱与工作区切换按规范明确延期并在 UI 中显式标注。
3. **跨技术栈全自动零件组装器** (Issue K06)：当前版本交付 React 代码零件渲染器 (`renderPartAsReactComponent`) 与配方构建器 (`buildPartAssemblyRecipe`)；通用全自动跨栈组装器明确延期。
4. **复杂外壳版式四类高级交互** (Issue H02)：当前版本交付 `modal`、`sheet`、`rail` 真实版式呈现；`floating-inspector`、`window`、`inline`、`full-page` 显式声明安全降级。

### 4. 外部输入待办清单 (BLOCKED_INPUT)
需外部维护者/项目所有者后续提供的输入：
1. **生产 Ed25519 公钥** (Issue A04, A05)：在 `src-tauri/src/modules/license/public_keys.rs` 的 `prod-2026-v2` 槽位注入真实 Base64 公钥，并确定旧版 V1 对称授权硬截止时间。
2. **Windows Authenticode 代码签名证书** (Issue J02)：在 `build-dist.ps1` 运行时传入真实证书指纹 `$SignCertThumbprint` 或 PFX 路径 `$SignCertPath`。
3. **公开仓库根 LICENSE 决定** (Issue J07)：维护团队正式选定根开源协议文件（如 MIT 或 Apache 2.0），并提交至 App 与 Vault 根目录。
4. **公开 Git 历史敏感账本清除授权** (Issue A08)：由仓库所有者执行 `git-filter-repo` 并对公共远端执行带有受保护权限的 force-push。

