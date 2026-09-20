# Setup Center

面向普通大学生的桌面环境与常用工具配置器（Windows 桌面应用）。

它安装的软件里包含 AI 工具（Claude、Codex、ChatGPT 等），但这个工具本身不是
AI 产品：它检测系统环境、按方案安装软件、写入配置并验证结果。

**当前状态：第三阶段完成** —— Execution Engine 已实现并验证：
程序现在可以真实安装软件，并在安装后重新检测验证。四个阶段已全部落地。

---

## 1. 这一版做到了什么

| 能力 | 状态 | 证据 |
|---|---|---|
| 六屏 UI（欢迎 / 检测 / 已装软件 / 方案 / 安装 / 完成） | ✅ 可用 | 34 项界面断言通过，附 11 张截图 |
| 环境检测（Windows、权限、磁盘、网络） | ✅ **真实探测** | 本机实测：Windows 11 25H2 (26200)、106.4 GB 可用 |
| 软件清点（三来源 + 冲突合并） | ✅ **真实探测** | 本机实测 7 个软件，6 个已安装，版本与 PATH 状态全部正确 |
| Profile 系统（JSON 数据驱动） | ✅ 可用 | 3 套内置方案，可从磁盘热加载 |
| 安装计划（方案 + 清点结果 → 步骤） | ✅ 可用 | 已装项被判为 satisfied，不重复安装 |
| **实际执行安装（三个执行器 + fallback 链）** | ✅ **真实执行** | 实机验证：winget 1.29.290 真实调用，见 §3 |
| **执行记录（可追踪 / 可失败 / 可恢复）** | ✅ 可用 | 每次尝试的 command / 时间 / 退出码 / 输出全部留存 |
| **安装后重新验证** | ✅ 可用 | 安装结束自动重跑三来源清点 |
| 中文化配置（数据驱动） | ✅ 计划已生成 | 3 份 localization JSON |
| 验证与报告 | ✅ 引擎已实现 | 已装 / PATH / 版本 三项检查 + 文本报告 |
| 自动登录 / API Key / Claude 自动认证 | ⛔ 按范围排除 | 见 §6 |

---

## 2. 架构与设计理由

### 2.0 执行引擎的分层

```
catalog  →  plan  →  executor  →  verify
   │         │          │            │
   │         │          │            └─ 安装后重新 inventory，而非相信安装器自述
   │         │          └─ 唯一会改变系统的模块：spawn → 等待 → 分类结果
   │         └─ 策略：用哪种方式、什么顺序、如何回退
   └─ 数据：唯一提到厂商名的地方
```

**`executor` 与 `install` 分开，是关键决定。**
`install` 拥有*策略*（优先级、回退顺序），`executor` 只有*机制*（把进程跑起来、等它结束、判断结果）。
分开的好处很具体：fallback 逻辑可以在**不运行任何程序**的前提下被穷举测试 —— 这也是 §4 里那批测试能做到"零副作用"的原因。

### 2.1 为什么要这样分层

```
main.rs        进程引导
commands.rs    ← 唯一的能力出口（19 个 #[tauri::command]）
state.rs       共享模块实例 + 缓存 + 安装会话
modules/       catalog · detect · inventory · install · executor · profiles · verify · config
model.rs       ← 各层共同遵守的数据契约
```

三条规则，每条都解决一个具体问题：

1. **`modules/` 不知道 Tauri 存在。**
   于是可以用 `cargo test` 直接测试全部业务逻辑（113 项断言），不需要开窗口。
   反例：把探测逻辑写在 command 里，就只能靠手点界面验证。

2. **前端不执行任何命令、不读任何文件、不做任何策略决定。**
   想审计这个程序能干什么，`grep -rn '#\[tauri::command\]'` 就是完整清单。
   对"给大学生跑的一个不知名 exe"来说，这是可审计性的下限。

3. **`model.rs` 是唯一契约。**
   模块依赖它、界面依赖它、没有任何东西依赖具体实现。
   这是第三阶段能只替换一个函数体、而不动界面的原因。

### 2.2 Rust 侧的文件结构（与提示词要求对应）

| 提示词要求 | 实际实现 | 说明 |
|---|---|---|
| `modules/` | `src-tauri/src/modules/` | catalog / detect / inventory / install / executor / profiles / verify / config |
| `installers/` | `modules/catalog.rs` 的 `install` 字段 + `modules/executor.rs` | 见下方说明 |
| `profiles/` | `src-tauri/profiles/*.json` | 3 套方案，作为资源打包 |
| `verifier/` | `modules/verify.rs` | 三项检查 + 报告渲染 |
| `localization/` | `src-tauri/localization/*.json` | 3 份配置，数据驱动 |
| `updater` | 未实现 | V0.1 范围外 |

**关于 `installers/`：** 没有做成 `installers/claude/`、`installers/codex/` 这样的目录。
每个 installer 之间**只差数据**（用哪个 winget id、回退顺序是什么），不差行为。
为 7 个只含数据的结构写 7 个模块，增加的是间接层而不是能力。
全部集中在 `catalog.rs` 的 `install` 字段里，反而更容易看出"每个软件到底怎么装"。

第三阶段补上了行为那一半，同样没有按软件拆分：`executor.rs` 里的三个执行器
（Winget / OfficialInstaller / Script）按 **`InstallSource` 枚举**分派，不按软件名。
`executor.rs` 里没有任何一处 `match` 在 `SoftwareId` 上 —— 加第 8 个软件只改 catalog，不动执行引擎。
这条约束有测试守着（`the_execution_engine_never_names_a_software_product`）。

如果将来某个 installer 需要真正的特殊逻辑（例如 Codex 需要交互式登录），
那时再把它单独提出来 —— 而不是现在为对称性提前拆。

### 2.3 软件名只出现在一个地方

提示词要求"禁止写死软件名称"。落实方式是让名字成为**数据**而不是控制流：

```
catalog.rs   ← 唯一提到厂商名的地方
inventory.rs ← 一个软件名都没有
```

`inventory.rs` 里没有任何一处写 `"Git"` 或 `"VS Code"`，所有 provider 都问
`catalog`："关于 `SoftwareId::Git` 你知道什么？"

收益不只是整洁：
- 加一个软件或修正一个识别规则只改一处，不碰任何探测代码
- 安装计划从 catalog 派生，**检测和安装不可能对"什么算 VS Code"产生分歧**
- 回退链变成声明式的优先级列表，而不是每个软件一个 `match` 分支

### 2.4 "不自己维护二进制"是被类型系统强制的

```rust
pub enum InstallSource {
    Winget { package_id: String },
    OfficialInstaller { url: String, sha256: Option<String> },
    Script { command: String },
    ConfigurationOnly,
}
```

没有 `BundledBinary` 变体，所以**写不出**自带安装包这种实现。
测试 `no_installer_bundles_its_own_binary` 把这条规则钉死。

### 2.5 检测为什么返回三态而不是布尔

```rust
pub enum Confidence { Ok, Fail, Unknown, Skipped }
```

"探测不了"是真实且常见的结果，把它折叠成 `false` 就变成了撒谎。
具体到分数上：`Unknown` 拿一半分 —— 既不冒充成功，也不因为程序自己没测出来而惩罚用户。

这条设计直接来自 `claude-code-toolbox` 的 fallback 思想：**降级，而不是伪装。**

---

## 3. Software Intelligence Layer（第二阶段）

### 3.1 三个互相独立的 provider

```
winget   →  winget list，按实测列偏移解析
注册表    →  HKLM/HKCU 四路 Uninstall 键（含 WOW6432Node）
PATH     →  App Paths → PATH → 常见安装目录
```

它们**不共享状态、互不调用**，所以任何一个失败都不会让其他两个失效，
并且每一个都能用 fixture 做单元测试，不需要 Windows 会话。

### 3.2 事实是产品，merge 是唯一做判断的地方

这是整个设计的关键，也是最容易被写错的地方：

```rust
pub enum Finding {
    Present { value: String },      // 这个来源确实找到了
    Unavailable { reason: String }, // 这个来源查不了 ← 不是"没有"
    Absent,                         // 这个来源查了，没有
}
```

provider 只能报"证据"和"没有证据"，**不能报"未安装"** —— 那个结论需要综合全部来源，
只有 `merge` 能下。于是：

- 只有一个函数会把证据变成结论，它是纯函数，可穷举测试
- provider 的 bug 不可能直接变成一个假的"已安装 ✓"显示给用户

### 3.3 置信度规则

| 情况 | installed | confidence | 理由 |
|---|---|---|---|
| 任一来源找到 | 是 | `Ok` | 正面证据不需要旁证才成立 |
| 都没找到，但有来源失败 | *未知* | `Unknown` | "查不了" ≠ "没有" |
| 都没找到，全部来源都查完了 | 否 | `Fail` | 这是真实、可行动的结论 |

第二行是此模块**最不能写错的一条**。把"注册表读取失败"变成"Python 未安装"，
会让学生去重装一个本来就装着的软件。

### 3.4 来源冲突怎么解决

`ProbeSource` 的枚举顺序就是优先级：`注册表 > PATH > winget`。

- **注册表**最优先：它是厂商自己声明的安装记录，也是唯一带安装位置的信息源
- **PATH** 次之：一个真的能跑起来的二进制，比一条会在卸载后继续存在的包管理记录更能说明"学生现在能用什么"
- **winget** 最后：它的记录只在 winget 自己运行时刷新

**唯一例外是版本号字段**：如果 `PATH` 报出了版本，它赢。因为那是程序自己打印的
版本 —— 正是学生执行 `--version` 会看到的那个。这条规则来自实机踩坑，见 §7 第 3 条。

所有冲突值都**保留在 evidence 里**，不会因为"选了一个"就丢另一个。
界面上每一项展开后能看到三个来源分别说了什么，这就是"为什么它说我没装 Git"
这个问题可被用户自己回答的原因。

### 3.5 为什么所有 provider 都不返回 bool

`Finding` 没有 `Installed`/`NotInstalled` 这种变体。这是刻意的：
一旦 provider 有权下"未安装"的结论，它就会在不该下的时候下。

---

## 4. 界面设计

参考 Linear / Raycast / Apple Setup Assistant / Claude Desktop，规则：

- **深色 + 玻璃**：`.glass` 用 blur + 1px 顶部高光模拟受光边缘，这是"高级深色"与"灰色方块"的区别
- **无卡片堆叠**：方案选择和软件列表都用列表 + 展开，不是卡片网格。
  七个软件正是卡片网格最诱人的地方，也正因如此要避免
- **无蓝紫渐变**：唯一强调色是一个克制的青色 `#6ee7d0`，只用于状态，不用于装饰
- **动效只表达状态变化**：140–420ms，不弹跳，`prefers-reduced-motion` 下全部关闭
- **背景粒子是确定性的**（种子化 LCG，非 `Math.random`），避免重渲染时重新洗牌

### 4.1 软件状态页的三条规则

1. **`unknown` 是一等状态。** 所有探测都失败的软件显示橙色"?"，不是红色叉。
   渲染成"缺失"等于叫学生重装一个可能已经装好的软件 —— 这是这一屏能犯的最严重的错。
2. **证据要能展开看。** 每一行展开后列出三个来源分别说了什么。
   这是让一个意外结果变得可追问、而不是神秘的关键。
3. **不折叠成一句话。** 顶部只说"检查了 7 个软件，6 个已安装"，
   具体每一个的事实留在列表里，不做二次概括。

### 4.2 安装页为什么不是滚动日志

提示词明确要求"不要滚动日志"。做法：
- 主视图只有**当前一项**、一个步骤导轨、一行中文说明
- 原始输出仍然捕获（`StepProgress.detail`），放在**高级模式**里，默认折叠

这是"隐藏日志"的诚实做法：需要的人一键可见，不需要的人完全看不到。

### 4.3 Profile 是**数据**而不是代码

`claude-toolbox` 的 profile 思想，在图形程序里的正确落点是：**运行时加载的 JSON 文件**，
作为 Tauri 资源打包。

好处：
- 学校可以自己丢一个 `campus.json` 进来，不需要重新编译
- 第三阶段往已有方案里加 MCP / Skills，不用改 Rust
- 改坏了有编译进二进制的兜底副本（`include_str!`）

失败行为：资源目录读不到 → 回退到内置副本；单个文件坏了 → 记 warning 并跳过它，
其余方案照常加载。**永远不允许因为一个配置文件的语法错误而打不开程序。**

---

## 5. 检测模块（第一阶段已落地）

四项探测全部**真实执行**，无 mock：

| 探测 | 机制 | 为什么用这个机制 |
|---|---|---|
| Windows 版本 | `[System.Environment]::OSVersion` | `cmd ver` 在现代 Windows 上被兼容性垫片固定返回 `10.0.0`，**不可用**；注册表 `CurrentBuildNumber` 是 `REG_SZ` 在部分版本上类型不一致 |
| 管理员权限 | `net session` + `whoami /groups` | 同时区分"已提权"与"在管理员组但没提权"，后者能给出更准确的建议 |
| 磁盘空间 | `.NET DriveInfo` | `fsutil volume diskfree` **需要管理员权限**，普通学生会拿到 `Error 5`；写入测试针对 `%LOCALAPPDATA%\Setup Center` 而不是盘根（盘根写入被系统拒绝，会把健康机器误判为不可用） |
| 网络 | 裸 TCP 连接（无 HTTP 依赖） | 分别探测 winget CDN / github / claude.ai；校园网认证墙是真实故障场景 |

---

## 6. 已知边界（如实说明）

1. **安装执行已实现，但只在被点击时发生。** 本 README 的测试**不会**安装任何软件：
   所有执行测试都指向一个不可能存在的包 id，验证的是"能启动 → 能捕获 → 能分类 → 能记录"。
   自动化测试去装一个 Git 是学生机器上不可接受的副作用。

2. **不接管账号与认证。** 按提示词要求，不做自动登录、不管理 API Key、
   不做 Claude / Codex 的自动认证。安装完软件即结束，登录由学生自己在软件里完成。

3. **报告里的中文软件名**仍同时存在于 Rust（`SoftwareId::display_name`）与前端
   （`software.ts`）。前端那份是展示用途（含 `mark` 字母），Rust 那份是数据契约；
   两者由各自的断言覆盖，但确实是一处需要同步的冗余。

4. **`Anthropic.Claude` 的 winget 包确实存在**（本机实测命中 `1.40609.0.0`），
   但 `OpenAI.Codex` 命中的是注册在同一 product 下的 MSIX（显示名 `ChatGPT`），
   因此 Codex 的首选策略是 npm，winget 列为回退。

5. **Claude Code 无 winget 包**，只能走 npm 或官方脚本，因此它的安装项依赖 Node.js
   先就位。计划里的顺序来自 catalog 的 profile 定义；
   **执行引擎目前不单独校验这项依赖** —— 若 Node 缺失，npm 策略会以
   `Unavailable` 失败并回退到官方 PowerShell 脚本，而不是提前拦下。

6. **取消是协作式的，不是强杀。** `cancel_install` 置一个标志位，
   引擎在**每次尝试之间**与**下载循环中**检查它。刻意不去 kill 子进程：
   中途杀掉 `winget` 会留下半装的包和锁住的 MSI。
   代价是取消有延迟（最长约 400 ms，即下载轮询间隔）。

7. **管理员权限失败会中止整轮，而不是继续。** 后续每一步都会撞同一面墙，
   继续只会产出同样的一串失败并让学生干等。中止后剩余步骤保留在
   `remaining` 里，"以管理员身份重跑 → 继续安装"即可接着做。

8. **`registry_version` 的取舍**：`preferred_version` 只对版本字段破例，
   不影响 `installed` 判定与包 id 的来源优先级。

---

## 7. 验证记录

### 7.1 后端
```
cargo test --lib → 113 passed; 0 failed
```

第一阶段的环境探测与第二阶段的三来源清点之外，第三阶段新增覆盖：

- **五个指定场景**：安装成功 / 安装失败 / winget 不存在 / 权限不足 / 中途失败恢复
- fallback 链走查：`Unavailable` 与 `Failed` 可续链，`PermissionDenied` 与 `Cancelled` 不可
- 续装语义：会话身份与起始时间保持、引起中断的失败记录必须存活、
  已装程序不得出现在续装集合里、空续装集合不得执行任何动作
- 输出截断同时保留头尾（只保留头部会把错误丢掉）
- 退出码渲染：负数按 `0x8A150014` 形式附带（winget 用 HRESULT，打印成十进制无法检索）
- **结构性断言**：`install.rs` 与 `executor.rs` 的生产代码里不得出现任何产品名

### 7.2 前端界面
```
node tools/ui-verify.mjs → 34/34 assertions passed
```
无头浏览器驱动完整六屏流程，用**真实 Rust 产出的 payload**
（`cargo run --example probe` → `tools/fixtures.json`）作为后端，
逐屏断言并检查零 console error。

安装页断言覆盖三个分支，且每个分支都对应一个真实会发生的状态：

| 截图 | 分支 | 断言要点 |
|---|---|---|
| `05-install` | 正常完成 | 引擎被启动且**只启动一次**（防 React 双调用起两个 winget） |
| `06-install-advanced` | 高级模式 | 执行记录含真实命令与退出码 |
| `06b-install-failed` | 部分失败 | 失败步骤被报为失败，且提供"继续安装" |
| `06c-install-halted` | 权限中止 | 中止原因明确、"继续安装（还剩 N 项）" |

### 7.3 实机执行验证
```
cargo run --example execute_smoke
```
真实调用本机 winget（实测 `1.29.290`），对一个不可能存在的包 id 发起安装：
进程真实启动、真实捕获输出、1890 ms 后真实返回失败、退出码被记录、
被判为可续链（于是回退链会继续）。**未安装任何软件。**

### 7.4 本机实测结果
```
Windows 11 25H2 (10.0.26200)      ✅
VS Code         1.136.2           onPath ✅    D:\工具软件\Microsoft VS Code\bin\code.cmd
Git             2.54.0.windows.1  onPath ✅    …\AI Switch\PortableGit\bin\git.exe
Python          3.14.7            onPath ✅    C:\Program Files\WindowsApps\…\python.exe
Node.js         22.23.2           onPath ✅    …\hermes\node\node.exe
Claude Desktop  1.40609.0.0       onPath —     （GUI 程序，无 CLI）
Claude Code     —                 未安装
Codex           0.153.4           onPath ✅    …\hermes\node\codex.cmd
```

### 7.4 开发过程中发现并修复的真实缺陷

**第一阶段：**

| # | 缺陷 | 后果 | 修复 |
|---|---|---|---|
| 1 | `currentBuildNumber` 按 `REG_DWORD` 读取 | 识别为 Windows 10 / build 10.0.0 | 改用 `OSVersion`，并在 `cmd ver` 回退里拒绝 build==0 |
| 2 | `fsutil` 需要提权 | 磁盘显示 0 GB，误报"不可写" | 改用 `.NET DriveInfo` |
| 3 | 写测试打在盘根 | 健康机器被判"系统盘不可写" | 改测 `%LOCALAPPDATA%\Setup Center` |
| 4 | `index.html` 内联脚本 | 打包后 CSP 拦截，且削弱 CSP 是更差的交换 | 移到 `main.tsx` |
| 5 | 当前步骤回退用 `findIndex(...)` 的 `-1` | 面板显示"…"且计数变成 7/7 | 显式处理 `firstPending < 0` |
| 6 | 计数器用 preview 长度 | 方案 4 项时显示 7/7 | 改用 plan 长度 |

**第二阶段（全部由实机运行暴露，不是猜出来的）：**

| # | 缺陷 | 后果 | 修复 |
|---|---|---|---|
| 7 | `token_at` 与 `column_starts` 用字符下标切字节 | 中文表头下 ID 列解析错位 | 全程改用字符下标；`&text[start..]` 是字节切片 |
| 8 | 表头与数据行列偏移不同（表头 59、数据 61） | 整张表读错两格，package id 全部丢失 | 偏移从**数据行**派生，表头只提供列数与顺序 |
| 9 | `from_utf8_lossy` 解码 PowerShell 输出 | `D:\工具软件\…` 变成 `D:\??????\…` | 加了按系统代码页的 GBK 解码；脚本内也显式设 `[Console]::OutputEncoding` |
| 10 | `path` 按来源优先级取，注册表给的是目录 | VS Code 显示 `path: —`，尽管 `bin\code.cmd` 就在 PATH 上 | path 改为"取第一个真能通过 `is_file` 的候选" |
| 11 | 注册表 `DisplayVersion` 是包标签 | Python 版本显示 `3.14-64` | 版本字段改用 `preferred_version`：程序自己打印的版本优先 |
| 12 | `Exact("ChatGPT")` 匹配到 Chrome 网页快捷方式 | 只有网页版 ChatGPT 的机器被判为装了 Codex | 加 `location_markers`，按安装位置二次校验 |
| 13 | 版本扫描"以数字开头且含点" | 把 Electron 诊断行里的时间戳 `…49.406Z]` 当成 VS Code 版本 | `version_token` 要求**整个 token** 都是版本 |
| 14 | `ELECTRON_RUN_AS_NODE` 只设一半 | `Code.exe` 变成裸 Node，报出 Node 的版本 `24.18.1` | 改走厂商自带的 `code.cmd`（它同时提供变量与 `cli.js` 参数） |
| 15 | 候选与位置的双重循环嵌套顺序 | `code.exe` 抢在 `code.cmd` 前面被解析 | 候选放外层，`candidates` 的优先级才真正生效 |
| 16 | 精确路径比较判定 on PATH | Python 因 Store 别名被判 `onPath: false` | 增加重解析点识别与版本回退比较 |
| 17 | `find_in_dir` 走 `is_file()` 快路径 | 返回按输入拼写的 `Code.cmd`（真实为 `code.cmd`） | 一律回读目录，返回磁盘上的真实拼写 |

第 4 项是**打包后才会暴露**的（开发模式下 CSP 不生效）。
第 7–17 项全部由**在真机上跑 `cargo run --example probe`** 发现 ——
其中 9、11、12、13、14、16 都是"fixture 全绿但真机报告错误"的类型，
说明前面几轮把测试写成了在断言自己的假设（见 §8）。

---

## 8. 这一轮最值得记的一条经验

测试通过 ≠ 功能正确。本阶段出现了两类假绿灯：

1. **断言写错了对象。** 我手打了一份表头字符串来测列偏移，但打出来的空格数与
   真实 fixture 不同，于是断言在验证我的笔误。改用 fixture 自己的表头后立刻暴露了
   真正的 bug（第 7、8 项）。
2. **fixture 是构造的，覆盖不到真实形状。** 前面几轮 fixture 里的路径都是 ASCII，
   所以编码 bug（第 9 项）一直不出现，直到在真机上跑。

因此本阶段的验证分工是：
- **fixture 测试**负责边界与容错（截断行、缺字段、Unicode、非法输出）
- **真机 probe**负责"真实世界里三来源是否能给出正确答案"

两类都必须有，只靠任何一类都会漏。

---

## 9. 构建与运行

```powershell
# 需要：Rust (MSVC 工具链)、Node 18+、WebView2 运行时
npm install
npm run tauri:dev        # 开发
npm run tauri:build      # 产出 exe + NSIS 安装包
```

产物：`src-tauri/target/release/ai-student-setup.exe`（约 3.2 MB）

验证工具：
```powershell
# 后端断言
cargo test --manifest-path src-tauri/Cargo.toml

# 用真实探测结果刷新前端 fixture（会打印每个软件的三来源证据到 stderr）
cargo run --manifest-path src-tauri/Cargo.toml --example probe > tools/fixtures.json

# 界面断言 + 截图（另开终端跑 npm run dev，或先 npm run build 再 vite preview）
node tools/ui-verify.mjs
```

---

## 10. 下一步计划

第三阶段已完成，剩下的两处是"计划已生成但尚未执行"的部分：

- **第四阶段（本阶段范围内）：配置落地。**
  `ConfigAction` 目前只被规划，没有被执行。要做的依次是：
  VS Code 中文语言包、Claude / Codex 的中文模块接口、Git 基础配置。
  执行入口应该复用 `executor`，而不是新写一套 —— 这些动作同样只是
  "跑一个命令并记录结果"，`ConfigurationOnly` 只是没有对应命令的特例。

- **执行引擎的一处已知缺口：步骤间依赖。**
  目前 Claude Code / Codex 的 npm 策略若遇 Node 缺失，会以 `Unavailable` 失败并回退。
  更正确的做法是在 `build_plan` 里把 Node 提为前置步骤。
  这属于真实功能，不在本次"不要增加其他功能"的范围内，因此留待明确要做时再动。

架构上的预留已就位：`executor.rs` 按 `InstallSource` 枚举分派，
新增执行方式只需加一个枚举变体与一个分支，不需要碰计划、清点或验证。
