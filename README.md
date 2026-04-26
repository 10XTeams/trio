# Trio

> 一个 Claude Code 插件，把 AI 编码从 "凭感觉写代码" 变成 "三大支柱 + 子冲刺闭环" 的可审计工作流。

Trio 是一套 AI coding 的 **Harness 机制**——但比起"让 AI 更会写代码"，它更关注**人在其中的过程**：怎么让代码、文档、测试用例三者**始终保持一致**，而不是各跑各的。

工作流围绕三种文档（"三大支柱"）+ 一个执行单元展开：

- **PRD**（Product Requirements Document，产品需求文档）—— 写清楚"要做什么、为什么"
- **TDD**（Technical Design Document，技术设计文档）—— 写清楚"怎么实现"
- **Test-Case** + **Test-Report**（测试用例 / 测试报告）—— 验收标准 + 执行证据
- **subsprint**（子冲刺）—— 每次代码改动的最小执行单元，自带"代码改动 / 文档改动 / 测试用例改动"三件套清单

配合契约文件和清单复选框，"AI 说做完了" 变成可机械验证的状态。

---

## 一、AI 编码现在的痛点

如果你和 AI 真正一起写过几周以上的代码，下面这些大概率都中过：

1. **AI 没有 "为什么"。** 没人写 PRD，AI 就只能 "看上去对" 地写代码——能跑、长得像，但和真实需求脱钩。一两个迭代之后开始累积漂移，没人说得清当初为什么这么做。

2. **AI 找不到正确的文件。** 跨模块改动时它会臆造路径、改错文件、把同一个东西在两处分别实现。`src/...` 不一定是 `src/`。

3. **测试通过 ≠ 没 bug。** AI 写的测试很容易 "把现状当作期望"——失败的代码改一下，断言也跟着改一下，绿条永远在，bug 上线了才发现。

4. **每次新对话从零开始。** 上一次会话里达成的约定、走过的弯路、定下的命名，下一次会话全部消失。AI 重新猜，重新错。

5. **大计划悄悄缩水。** AI 说 "我来做 X、Y、Z"，最后只交付了 X，并宣布完成。没人能机械验证 "Z 到底有没有做"。

6. **测试执行把上下文打爆。** 一个 agent 跑 30+ 条用例，Playwright stdio 断连、context window 溢出、跑到一半就糊涂了，最后还是要人来兜底。

7. **测试规格被悄悄削弱。** 原本断言 "登录失败时显示账号被禁用"，后来某次重写之后变成 "返回任何 4xx 即可"。回归测试还在绿，但实际保护已经没了。

Trio 针对的是这些**流程问题**，不是 "让 AI 更聪明"。

---

## 二、Trio 是怎么解决的

| 痛点 | Trio 的应对 |
|------|-------------|
| AI 没 "为什么" | 用 PRD 把"为什么"显式固化下来——先有整体再写模块，AI 做事之前必有依据 |
| 找不到正确文件 | 把项目的"代码地图"（前端路由 / 后端 endpoint / 模块到文件的对应）落成一份契约文档，所有后续动作都从它读起 |
| 测试 = 现状 | 测试用例必须显式列出验收点和禁止状态；后续修改默认只允许"加严"，要放松必须走可见的全量重写 |
| 新对话从零开始 | 三大支柱 + 迭代历史本身就是冷启动地图——新会话直接读已有文档，不重新猜测 |
| 大计划悄悄缩水 | 每个子冲刺顶部都有一份固定结构的执行清单（代码 / 文档 / 测试用例），每个框只有唯一一个责任方能勾完；故意跳过必须写明原因。"做完了"是机械可读的状态，不是嘴上说说 |
| 测试执行打爆上下文 | 测试执行按子模块切片，每段结果立刻落盘成结构化文件；主控随时可以丢弃内存、重新读盘 |
| 规格被悄悄削弱 | 测试用例的修改默认只允许"加严"操作集；任何"删条目 / 放宽断言"在校验阶段就被拒绝，要放松必须走可见的全量重写 |

---

## 三、核心机制

### 3.1 三大支柱（Three Pillars）

Trio 把项目分成三个并行追踪的桶：

- **`docs/`** — 产品文档（PRD / TDD / Test-Case / Test-Report / URS）。独立 git 仓库（`docs/.git`）。
- **`code/`** — 实现 + 配置。独立 git 仓库（`code/.git`）。
- **`trio/`** — 工作流产物（子冲刺计划、URS-PRD gap-check JSON、subsprint notes）。**故意不进 git**——这些是过程产物，不属于产品文档历史。

每个新项目第一步就是 `/trio:init-project`，它会创建这三个文件夹、写好根目录 `CLAUDE.md` 锁住三桶约定，并落下 `tech-stack.md`（必要时再生成 `code-structure.md`）。

### 3.2 契约文件（不能改名）

| 文件 | 谁产出 | 谁读 |
|------|--------|------|
| `docs/TDD/0.common/tech-stack.md` | `/trio:init-project` | 几乎所有下游 skill |
| `docs/TDD/0.common/code-structure.md` | `trio:tdd-code-structure` agent | PRD/TDD/TC/test 全部 |
| `trio/subsprint/<n>-MMDD-<word>/<n>-subsprint-plan.md` | `/trio:subsprint-planner` | runner + sync |
| `docs/Test-Report/<n>-MMDD-<word>/bugs.json` | `/trio:test-management` | bugfix planner + Trio Stage |

文件名是合同的一部分，不可重命名；schema（特别是 Bug schema v1.1）也是显式版本化的。

### 3.3 Skill 编排，Agent 执行

- **Skill** = 决策树 + 前置条件检查 + 派单。skill 自己**不写文件**。
- **Agent** = 真正读写 `docs/` / `code/`、跑 Playwright、生成 PRD 内容的工作单元。

这种分工的实际价值：当流程要调整时，只动 skill；当生成质量要提升时，只动 agent；不用每次改 prompt 都满地图找。

### 3.4 落盘的状态，对抗上下文压缩

凡是会跑很久或可能被 auto-compact 截断的流程，Trio 都把中间结果写到磁盘：

- 测试执行的 `partials/<sub#>.json`
- gap-check JSON
- subsprint plan 本身

主控 skill 在每一步**重新从盘里读**，从不依赖会话内存里 "我刚才看到的"。

### 3.5 计划清单契约（Plan Checklist Contract）

每个 subsprint plan 顶部都是这三行（顺序、字面值都不能变）：

```markdown
## Execution Checklist

- [ ] **Execute Coding** — `/trio:subsprint-runner` (applies code edits in place)
- [ ] **Update Docs** — `/trio:subsprint-sync` (applies doc edits in place)
- [ ] **Update Test Case** — `/trio:tc-management` (patch or audit path)
```

规则：

- 每个框**只有一个 skill 能翻**——runner 翻第一个（代码），sync 翻第二个（文档），tc-management 翻第三个（测试用例）。
- 翻完要写明 trailer：`— completed YYYY-MM-DD HH:MM by <skill>`。
- `[x] N/A` 必须附一句原因，且不能再被翻回 `[ ]`。

整个子冲刺 "做没做完" 是一个机械可读的状态——不是 AI 的口头报告。

---

## 四、主流程

整个 Trio 工作流就是一个循环：**`/trio:next` 告诉你下一步 → 你跑被推荐的 skill → 产物落到 `docs/` `code/` `trio/` → 再问 `/trio:next`**。

下面用一个具体场景走一遍——你刚把 PRD/TDD/TC 都写完了，`code/` 还是空仓库，第一步去问 Trio：

### 4.1 起手：跑 `/trio:next` 看下一步

```
Trio — 下一步建议（当前时间 2026-04-26）

最近状态：
  - code/ 源文件数：0
  - URS：存在
  - PRD-Overview：存在
  - PRD / TDD / Test-Case 模块数：5 / 5 / 5
    · docs/PRD/        — 5 模块 / 24 子模块 / 29 PRD 文件 ✓
    · docs/TDD/        — 5 模块 / 34 TDD 文件 + tech-stack + code-structure ✓
    · docs/Test-Case/  — 5 模块 / 332 TCs ✓
  - 最新测试报告：（暂无）
  - 最新 subsprint：（暂无）

主建议（P4）：
  三大支柱齐全，code/ 还是空仓库——可以起第一个 iteration 把 P0 TCs（137 条）
  反推成代码任务。建议从 M1 用户注册登录 + M2 PPT 上传/转图入手，作为最薄的
  端到端切片。
  → 运行 /trio:subsprint-planner
  → 关键参数：source=fresh

备选：
  [A] /trio:tdd-management → [3] regenerate code-structure —— 等代码出来再跑
  [B] /trio:test-management —— 现在 332 TCs 全是 BLOCKED，没意义
```

另一种典型起点——刚跑完 `/trio:init-project`，PRD/TDD/TC 全空、URS 也没准备，再问 `/trio:next`：

```
Trio — 下一步建议（当前时间 2026-04-26）

最近状态：
  - code/ 源文件数：0（目录尚未创建）→ P0 基建分支不触发
  - URS：不存在
  - PRD-Overview：缺失
  - PRD / TDD / Test-Case 模块数：0 / 0 / 0
  - tech-stack.md：已存在 ✓
  - 最新测试报告：无（docs/Test-Report/ 为空）→ P0.5 / P1 N/A
  - 最新 subsprint：无 → 无进行中工作
  - URS vs PRD Gap Check：N/A（URS 不存在）

主建议：先准备 PRD 的输入材料
  项目刚完成 bootstrap，三大支柱（PRD/TDD/Test-Case）全空，且既无 URS
  也无 code/。Trio 决策树的所有 P0–P3 分支都不会触发——它们都需要至少
  有 URS 或 code/ 作为输入。
  → 推荐做法：先放一份用户需求说明（URS）进 docs/，再跑 /trio:prd-management
    启动 PRD-Overview 撰写。
```

注意 `/trio:next` 在这种"什么都没有"的状态下不会硬塞一个跑不通的 skill 给你——它会**讲清楚为什么各分支都不触发**，然后指向真正的前置条件（这里是补 URS）。

`/trio:next` **从不替你按 enter**——它只读、只建议，按下面这张路由表挑分支：

| 你看到的状态 | `/trio:next` 通常会推 |
|-------------|----------------------|
| `code/` 有源码但 PRD 整体缺失 | **P0** — `/trio:prd-management` |
| PRD 在但 TDD 缺 | **P0** — `/trio:tdd-management` |
| 最新 `bugs.json` 有 Pending | **P0.5** — `/trio:view-document`（Trio Stage 浏览器三角分类） |
| 有 Accepted 但还没修的 bug | **P1** — `/trio:subsprint-planner` → `[2] bugfix` |
| URS↔PRD / PRD↔TDD / PRD↔TC 有缺口 | **P3** — 对应 management skill |
| 全部干净 | **P4** — 问要不要起新功能 |

### 4.2 选项 1 → 起第一个 fresh subsprint（init 阶段）

跑 `/trio:subsprint-planner`，选 `[4] Brand-new (fresh) plan`。fresh 是两步——先 init 给你骨架，你填好之后再 finalize：

```
Plan source: Fresh
Phase: init
Allocated: trio/subsprint/1-0426-aurora/

Created:
  trio/subsprint/1-0426-aurora/1-subsprint-plan.md   (skeleton, <!-- TODO --> 占位)
  trio/subsprint/1-0426-aurora/notes/                (你把参考资料丢这里)

下一步：编辑 1-subsprint-plan.md，把这几节填好——
  - # Goal
  - # Scope（in / out-of-scope）
  - # Tasks（每个 task 的 Code Paths、Verification）
  - # Test Case Impact（这次改动会影响哪些 TC）

填完再跑一次 `/trio:subsprint-planner` → [4]，进入 finalize。
```

填完之后再跑 `/trio:subsprint-planner [4]`：

```
Phase: finalize
Source folder: trio/subsprint/1-0426-aurora/

Validated:
  - Front-matter ✓ (source: fresh, subsprint_id: 1, docs_changes_expected: true)
  - Execution Checklist ✓ (3 boxes initialized)
  - 7 Tasks parsed
  - Test Case Impact: 14 TCs scoped (M1: 8, M2: 6)

Plan ready: trio/subsprint/1-0426-aurora/1-subsprint-plan.md

Recommended sequence:
  1. /trio:subsprint-runner 1   — 应用 code 改动
  2. /trio:subsprint-sync 1     — 同步 doc 改动 + 回写 14 条 TC patch
```

### 4.3 跑 runner，把代码落地

`/trio:subsprint-runner 1` 按 task 顺序把代码改动写进 `code/`，每完成一个 task 立刻本地 verify：

```
Subsprint 1 (1-0426-aurora) executing...

[Task 1/7] Auth · register endpoint scaffold
  Code: code/src/auth/register.ts, code/src/auth/schema.ts
  → applied
  → verify: cd code && pnpm test auth/register → 4/4 PASS
  ✓ Task 1 done

[Task 2/7] Auth · login endpoint
  ...
  ✓ Task 2 done

...

[Task 7/7] PPT · thumbnail conversion worker
  ✓ Task 7 done

Checklist updated:
  - [x] Execute Coding — completed 2026-04-26 14:32 by trio:subsprint-runner
  - [ ] Update Docs    — pending
  - [ ] Update Test Case — pending

下一步：/trio:subsprint-sync 1
```

任何一个 task 的 verify 失败都会**当场停下**——不会带着红条跑完七步还假装一切顺利。

### 4.4 跑 sync，同步文档 + 回写测试用例

`/trio:subsprint-sync 1` 干两件事：先把 plan 里 doc 改动应用到 `docs/`，再调 `/trio:tc-management`（patch 路径）按 Test Case Impact 给受影响的 TC 加严：

```
Subsprint 1 sync starting...

[1/2] Docs sync
  Doc paths: docs/PRD/1.Auth/1.1.register.md, docs/TDD/2.PPT/2.1.upload.md
  → applied (2 files)
  ✓ Update Docs flipped

[2/2] TC sync · dispatching trio:tc-management (patch path)
  Manifest: trio/subsprint/1-0426-aurora/tc-patches.yml
  14 patches → 14 TCs

  TC-1.1-001 ← add-verification        ✓
  TC-1.1-002 ← add-forbidden-state     ✓
  TC-1.2-007 ← tighten-precondition    ✓
  ...
  TC-2.3-006 ← add-verification        ✓

Checklist updated:
  - [x] Execute Coding
  - [x] Update Docs    — completed 2026-04-26 14:48 by trio:subsprint-sync
  - [x] Update Test Case — completed 2026-04-26 14:48 by trio:tc-management

Subsprint 1 fully synced.
```

到这步整个清单都是 `[x]`——这个 subsprint **机械意义上完成了**，不是嘴上说说。

### 4.5 跑测试，出 bug → 回到循环

代码已经落地，`/trio:test-management` 一次派一个子模块给执行 agent：

```
Selected: 1.1, 1.2, 2.1
Report folder: docs/Test-Report/1-0426-aurora/

[1/3] sub-module 1.1 — 14 cases
  → wrote partials/1.1.json (14 PASS / 0 FAIL)

[2/3] sub-module 1.2 — 13 cases
  → TC-1.2-007 FAIL: 禁用账号居然路由到 /dashboard
  → wrote partials/1.2.json (12 PASS / 1 FAIL)

[3/3] sub-module 2.1 — 11 cases
  → wrote partials/2.1.json (11 PASS / 0 FAIL)

Assembled:
  docs/Test-Report/1-0426-aurora/report.md
  docs/Test-Report/1-0426-aurora/bugs.json   (1 bug, decision: Pending)

This run found 1 failure. Run /trio:next 看下一步。
```

再跑一次 `/trio:next`，因为 `bugs.json` 里有 `Pending`，路由到 **P0.5**：

```
主建议（P0.5）：
  docs/Test-Report/1-0426-aurora/bugs.json 里有 1/1 条 bug 处于 Pending。
  → 运行 /trio:view-document（Trio Stage）
  → 在浏览器里打开 bugs.json，把那条 bug 的 decision 从 Pending 改成
    Accepted / Rejected / Duplicate / WontFix
  完成后再跑 /trio:stop 关掉 Trio Stage，然后重新问 /trio:next。
```

triage 完（这条 bug 决定 Accepted），再问 `/trio:next` → 路由到 **P1**：

```
主建议（P1）：
  最新报告 1-0426-aurora 有 1 条 Accepted bug 还未闭环。
  → 运行 /trio:subsprint-planner → [2] bugfix
  → 自动选最新 test report 作为来源
```

—— 然后回到 4.2/4.3/4.4，每条 bug 用一个 subsprint 闭环。**整个工作流不需要你记顺序，`/trio:next` 永远告诉你站在哪一步。**

---

## 五、Skills 一览

| Skill | 作用 | 关键产出 |
|-------|------|----------|
| `/trio:init-project` | 项目初始化 | `docs/` `code/` `trio/` 骨架、`tech-stack.md`、根 `CLAUDE.md` |
| `/trio:prd-management` | PRD 生命周期编排 | PRD-Overview、模块 PRD、URS gap-check JSON |
| `/trio:tdd-management` | TDD 生命周期编排 | `code-structure.md`、模块 TDD（database / api / per-function） |
| `/trio:tc-management` | 测试用例编排（audit + patch 双路径） | TC 文件、test-script-mapping |
| `/trio:test-management` | 测试执行（按 sub-module 分批 + 落盘 partials） | `report.md`、`bugs.json`、screenshots |
| `/trio:subsprint-planner` | 子冲刺规划（bugfix / gap / fresh） | `<n>-subsprint-plan.md` |
| `/trio:subsprint-runner` | 子冲刺执行（代码） | 在 `code/` 内联改动 + 翻 `Execute Coding` |
| `/trio:subsprint-sync` | 子冲刺收尾（文档 + TC） | 在 `docs/` 内联改动、TC patch / 新增 + 翻 `Update Docs` 和 `Update Test Case` |
| `/trio:next` | 下一步建议（只读、只推荐） | 控制台优先级建议 |

## 六、Agents 一览

| Agent | 作用 |
|-------|------|
| `trio:prd-overview` | 写 `PRD-Overview.md` + 模块文件夹骨架 |
| `trio:prd-by-module` | 写单个模块的 PRD |
| `trio:prd-check-urs-gap` | URS↔PRD gap 审查，输出 JSON 待人工决策 |
| `trio:prd-add-screenshot` | 用 Playwright 给 PRD 加截图 |
| `trio:tdd-code-structure` | 生成 `code-structure.md` |
| `trio:tdd-write-all` | 写整套或单模块 TDD |
| `trio:tc-write` | 写/改 TC（add / skip / rewrite / patch 四种 decision） |
| `trio:bugfix-plan` | 从 failing test report 生成 bugfix subsprint plan |
| `trio:urs-gap-plan` | 从 gap-check JSON 生成 gap subsprint plan |
| `trio:subsprint-fresh-plan` | 全新 subsprint plan（init / finalize 两阶段） |
| `trio:subsprint-execute` | 把 plan 内联应用到 `code/` `docs/` |
| `trio:test-testcase-execution-agent` | Playwright 驱动的子模块级测试执行 |

---

## 七、快速开始

### 安装

在 Claude Code 终端里依次跑：

```
/plugin marketplace add https://github.com/10XTeams/trio
/plugin install trio@trio
```

> 注意：直接用 `/plugin marketplace add 10XTeams/trio` 简写形式 Claude Code 会按 SSH 解析（`git@github.com:...`），如果你这台机器没配过 GitHub SSH key 就会失败。**显式给完整 HTTPS URL 最稳。**

第二步里的两个 `trio` 不是写错——左边是 plugin 名，右边是 marketplace 名，本仓库恰好同名。

验证：

- `/plugin` 进交互菜单，切到 **Installed** 标签页能看到 `trio`
- 或者 `/help`，看 `/trio:*` 命令是否出现

更新 / 卸载：

```
/plugin marketplace update trio
/plugin uninstall trio@trio
```

### 最短路径示例

新项目从零开始：

```
/trio:init-project          # 拉骨架
/trio:prd-management        # 写 PRD-Overview + 模块 PRD
/trio:tdd-management        # 写 TDD
/trio:tc-management         # 写 TC
/trio:test-management       # 跑测试
/trio:next                  # 看下一步
```

已有代码库接入：

```
/trio:init-project          # Case A：自动从 code/ 反推 tech-stack.md + code-structure.md
/trio:next                  # 跟着 P0 建议补支柱
```

### 要求

- macOS（Trio Stage 浏览器查看用到本地 Python HTTP 服务器）
- Python 3 在 `PATH`（仅 Trio Stage 需要）
- Google Chrome（Trio Stage 优先用 Chrome，找不到时回退到默认浏览器）

> **Trio Stage**（`/trio:view-document`）是一个本地 Markdown wiki，把当前文件夹当 wiki 浏览：文件树、Markdown 预览、便签高亮、Risk 跳转、轮廓面板。日常用法是浏览 PRD/TDD/TC，以及在 P0.5 阶段逐条改 `bugs.json` 的 `decision`。

---

## 八、目录布局

```
你的项目/
├── code/                      # 实现（独立 git）
├── docs/                      # 产品文档（独立 git）
│   ├── URS*.md
│   ├── PRD/
│   ├── TDD/
│   │   └── 0.common/
│   │       ├── tech-stack.md
│   │       └── code-structure.md
│   ├── Test-Case/
│   └── Test-Report/
│       └── <n>-MMDD-<word>/
│           ├── report.md
│           ├── bugs.json
│           ├── screenshots/
│           └── partials/
├── trio/                      # 工作流产物（不进 git）
│   ├── iteration/gap-check/
│   └── subsprint/
│       └── <n>-MMDD-<word>/
│           └── <n>-subsprint-plan.md
└── CLAUDE.md                  # 三桶约定
```

---

## 九、设计原则总结

- **Plan, run, sync 三段分离。** 不让规划阶段偷偷动代码，不让执行阶段偷偷加用例。每段责任单一。
- **契约文件 > 自由文本。** 关键流转点都是固定文件名 + 固定 schema；想改先升 schema 版本。
- **磁盘是真相，不是 chat memory。** 任何长流程的中间结果都落盘，下一步从盘读。
- **机械可验证的 "做完了"。** Checklist `[x]` + trailer = 完成证据；`[x] N/A` + 原因 = 故意跳过。两者都不是嘴说的。
- **Strengthen-only。** TC、Verification、Forbidden State 只能加严，不能放松；要放松必须走可见的 rewrite。
- **Skills 只编排，agents 只执行。** 想改流程改 skill；想改产出改 agent。

---

## License

[PolyForm Noncommercial 1.0.0](./LICENSE)。允许个人、教育、研究、慈善 / 政府机构等**非商业用途**自由使用、修改、分发；**不允许商业使用**。商业授权请联系仓库拥有者。
