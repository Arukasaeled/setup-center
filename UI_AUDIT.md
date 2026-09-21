# UI_AUDIT — Setup Center 产品化重构

本文件是任务书**第一阶段**的交付物。它先于本轮的代码改动写成，记录的是**审计当时的真实状态**，
不是事后补写的说明。凡是"已存在"的判断，都在审计时读过对应文件；凡是"缺失"的判断，
都在审计时用 `grep` 确认过字符串不存在。

审计对象：`src/`、`src/components/`、`src/screens/`、`src/styles.css`（任务书写的是 `src/styles/`，
实际是单文件 `src/styles.css`）。
审计时的 git 基线：`f3cae84`，工作区干净，`cargo test --lib` = **469 passed**。
任务书称本版本为 V0.1.5；`package.json` 实际是 **0.1.0**。

---

## 一、审计结论摘要

任务书的十个阶段里，**第二阶段（主框架）已经完成**，第一、三、四、六、七、九阶段未落地，
第五阶段是任务书自己标注的"可选实验"，第八阶段的原则已由既有的 `DESIGN.md` + token 体系确立。

| 阶段 | 任务书要求 | 审计时的真实状态 |
|---|---|---|
| 1 完整 UI 审计 | 输出 `UI_AUDIT.md` | **缺失**（本文件即补齐） |
| 2 主框架重做 | 侧栏 + 主视图，不强制"下一步" | **已完成**（`Dashboard.tsx` 三栏 + `App.tsx` 双 surface） |
| 3 软件网格卡片（重点） | 网格卡片，每卡含图标/名称/说明/状态/推荐/展开 | **缺失**，当前是按分类分组的**行列表** |
| 4 分类系统 | 顶部 Tab：全部/开发基础/AI工具/语言环境/高级工具 | **缺失**，只有分组标题，没有 Tab |
| 5 探索式轮盘 | 可选实验，不得影响主流程 | **缺失**（本轮不做，见 §六） |
| 6 Dashboard 重做 | 个人状态中心：问候语、大分数、已准备/缺少、推荐下一步 | **部分完成**：有分数与推荐，缺问候语与"已准备/缺少"的对置表达 |
| 7 安装流程自由化 | 逐项状态 + 可部分安装，不锁死流程 | **缺失**：`Install.tsx` 由屏幕挂载即自动启动一次全量运行 |
| 8 视觉规范 | Linear/Raycast/Apple/Vercel；禁紫渐变、发光粒子、浮夸动画 | **原则已确立**（`styles.css` 单色阶 + 单强调色，无渐变无粒子），缺细节打磨 |
| 9 组件重构 | 新增 7 个组件 | **缺失**：`components/` 只有 `SoftwareIcon.tsx`、`TitleBar.tsx`、`ui.tsx` |
| 10 验证 | cargo test / build / harness / exe 测试 + UI 测试 | 前四者已有；"卡片渲染/分类切换/状态显示/light-dark/无障碍"**缺失** |

阶段 2 之所以"已完成"而不需要重做：`App.tsx:61-70` 的 `STEPS` 只属于向导，
`App.tsx:139` 明确把 `ProgressRail` 限定为 `!dashboardOpen` 时才渲染；
`Dashboard.tsx:58-64` 的 `SECTIONS` 是独立于 `Screen` 的第二条轴。
也就是说"不强制下一步"的结构在审计时**已经存在**，任务书描述的目标状态与当前代码一致。

---

## 二、当前信息架构

```
App.tsx
├── TitleBar
├── dashboardOpen ?
│      Dashboard
│      ├── DashboardNav（188px，5 个 section，底部主题切换）
│      ├── section 内容（自滚动）
│      └── DetailPane（340px 右侧详情）
│   :  向导：welcome → goal → detect → software → choose → install → bootstrap → done
│      + ProgressRail（8 步）
└── Notice（底部浮层）
```

`Section`（`store.ts:63`）与实际渲染的 section 数**不一致**：

```ts
export type Section = "overview" | "software" | "config" | "aiTools" | "history" | "license";
```

- `SECTIONS`（`Dashboard.tsx:58`）只渲染 `overview / software / config / history / license`，**没有 `aiTools`**。
- `DashboardNav` 的 `badges`（`Dashboard.tsx:178-181`）给 `aiTools` 算了徽标数，
  但该 section 永远不渲染 → **死代码，且每次渲染都白算一遍**。

这是审计发现的第一个真实缺陷，不是风格问题：类型允许了一个界面到不了的状态。

## 三、用户流程

**首次使用**：`welcome` 有两个门（"检查这台电脑"→ dashboard；"直接开始配置"→ 向导）。
第二条门之后是 8 步线性流，`install` 与 `bootstrap` 都由屏幕 `useEffect` **自动启动**。

**回访**：dashboard 冷启动即自足（`Dashboard.tsx:89-99` 并行跑 detection 与 scan），
不需要经过向导。

**流程的真实问题**（对应任务书"不要锁死流程"）：

1. 安装**不可选择**。`Install.tsx:74-78` 在 plan 变化时启动一次全量运行，学生无法说
   "我只要 Git，不要别的"。要跳过某个软件，只能等它自己失败。
2. 安装**不可逐个查看**。屏幕呈现的是"本次运行的步骤状态"，
   而不是任务书要的那种 `[VS Code] 已完成 / [Python] 安装中 / [Git] 等待` 的可读清单。
3. 分类**不可筛选**。21 个程序按 4 个分类顺排，想只看 AI 工具必须滚动找。

## 四、哪些页面像安装向导

| 页面 | 判断 | 依据 |
|---|---|---|
| `Welcome` | 不像 | 两个门，其中一个是纯查看 |
| `Goal` | 边界 | 列表选一项，但属于"首次配置"的正当提问 |
| `Detect` | 像 | `Detect.tsx:50` 直接写 "检测完成" —— 任务书点名禁止的机器语言 |
| `Software` | 像 | "已安装/未安装/无法确认"三段式 + 底部"返回 / 继续" |
| `Choose` | 像是必然的 | 它就是在选方案 |
| `Install` | 最像 | 自动启动 + 进度 + 结束语，任务书 §7 正是针对它 |
| `Bootstrap` | 像 | `Bootstrap.tsx:124-125` "初始化完成" —— 同上机器语言 |
| `Done` | 像 | 终结页 + 报告 |
| `Dashboard` | 不像 | 这一条是阶段 2 已经做对的部分 |

机器语言在**整个前端只有两处**（`Detect.tsx:50`、`Bootstrap.tsx:124-125`），
但两处都在向导的主路径上，所以它是真实存在的问题，不是理论问题。

## 五、哪些地方缺少反馈 / 可以卡片化

**缺少反馈**：

- 软件列表的每一行**没有"推荐度"**。任务书第三节要求每张卡有"是否推荐（★★★★★）"。
  当前只有 `purpose` 一句话（`Dashboard.tsx:936-950`）。`purpose` 解决"这是什么"，
  但不回答"我该不该装"——这正是普通学生最需要的一个信号。
- 分类切换**没有过渡**。分组是直接渲染的，没有"当前在看哪一类"的状态。

**可以卡片化**：软件区是唯一一处需要网格化的地方。其余部分（能力、配置、历史）
在既有设计里刻意保持列表，`Goal.tsx` 的注释写了理由（"六张卡会把一个决定变成一次比较"），
这条理由对能力列表同样成立，因此**本轮不网格化它们**。

## 六、本轮范围决定

遵任务书的"不要一次增加大量新能力"与执行顺序：

```
UI审计 → Dashboard重做 → Software Grid → 分类系统 → 安装流程自由化 → 动效和细节优化 → 全量验证
```

- **做**：阶段 1、9（作为使能件）、6、3、4、7、8（细节）、10。
- **不做：阶段 5（探索式轮盘）**。它不在任务书自己的执行顺序里，被标注为"可选实验"，
  且要求"不要影响主流程"。本轮的价值集中在网格与可选择性上，把一个实验页塞进来
  会同时抬高动效与无障碍的验证面。这是**范围决定，不是遗漏**。

## 七、验收标准替换（任务书 §10 的截图检查）

任务书要求"截图检查：Welcome / Dashboard / Software Grid / Software Detail / Install /
Done / Light Theme / Dark Theme"，本轮**用户明确要求不截图**。因此该条替换为：

| 原要求 | 替换为 |
|---|---|
| 8 张截图的视觉判读 | `ui-verify.mjs` 的结构化断言 + 逐屏 `innerText` 快照 |
| 肉眼确认卡片长什么样 | 断言卡片 DOM 结构、状态文案、分类切换前后的文本变化 |

**代价必须写明**：纯视觉品质（留白比例、卡片间距、动效手感）**本轮无法自我验证**，
只能由用户看实机拍板。断言能证明"卡片渲染了、有名称有状态有说明、切 Tab 后内容变了"，
不能证明"它好看"。

## 八、硬性约束（继承，不得违反）

来自 `DESIGN.md`，本轮全部继续遵守：

- Rust 后端不动、`catalog.rs` 不动、`executor` 不动、`bootstrap` 不动
- 只改 React UI / state / presentation layer
- `executor` 是唯一执行入口，不新建第二套执行框架
- 禁止新增 `xxxManager` / `xxxInstaller` / `xxxSetupEngine`
- 数据驱动，禁止 `match SoftwareId` 写逻辑
- 软件名称只允许出现在 `catalog.rs` 与 `software.ts`（展示层）

**由本轮推导出的一条补充约束**：任务书阶段 7 要求"可选择部分安装"，
但上述约束禁止改动 Rust。经审计，这**不需要改 Rust**：
`run_install(plan)` 接收 plan，`install.rs::execute_steps` 只遍历 `plan.steps`
并以 `plan.steps.len()` 为总数。因此**在前端过滤 `plan.steps` 后再调用 `run_install`
即可实现部分安装**，执行链、验证、会话记录全部不变。
这是本轮唯一一处"能力扩展"，且它落在允许改动的层里。
