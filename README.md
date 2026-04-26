# Trio

> 一个 Claude Code 插件，把 AI 编码从 "凭感觉写代码" 变成 "三大支柱 + 子冲刺闭环" 的可审计工作流。

Trio 不是又一个 "更聪明的 prompt"，而是一组**强约束的协作流程**：用 PRD/TDD/Test-Case 三个产物当作 AI 的导航地图，用子冲刺（subsprint）当作每次代码改动的执行单元，用契约文件和清单复选框把 "AI 说做完了" 变成可机械验证的状态。

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

| 痛点 | Trio 的对应机制 |
|------|------------------|
| AI 没 "为什么" | `/trio:prd-management` 强制先有 PRD-Overview 再写模块 PRD；`trio:prd-check-urs-gap` 把 URS 漏项落到 JSON 里逐条决策 |
| 找不到正确文件 | `docs/TDD/0.common/code-structure.md` 是契约文件——前端路由、后端 endpoint、模块到代码路径的映射，所有下游 skill 都从这里读 |
| 测试 = 现状 | TC 必须显式列出 Verification + Forbidden States + Preconditions；patch 只能 "加紧"，不能 "放松"，要放松必须走可见的 rewrite |
| 新对话从零开始 | 三大支柱 + `trio/` 里的迭代历史就是 AI 的冷启动地图；新会话直接读这些文件 |
| 大计划悄悄缩水 | 每个 subsprint plan 顶部都是 **Execution Checklist**（Execute Coding / Update Docs / Update Test Case），每个框由唯一一个 skill 负责翻 `[x]`，N/A 必须写明原因 |
| 测试执行打爆上下文 | `/trio:test-management` 一次只派一个子模块给执行 agent，每个子模块结果立刻落盘成 `partials/<sub#>.json`，主控随时可以剪枝内存 |
| 规格被悄悄削弱 | TC patch 操作集合是 strengthen-only：`add-verification` / `add-forbidden-state` / `tighten-precondition`；任何 "删条目 / 放宽断言" 在 manifest 校验阶段就被拒绝 |

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
- [ ] **Update Docs** — `/trio:subsprint-runner` (applies doc edits in place)
- [ ] **Update Test Case** — `/trio:tc-management` (patch or audit path)
```

规则：

- 每个框**只有一个 skill 能翻**——runner 翻前两个，tc-management 翻第三个。
- 翻完要写明 trailer：`— completed YYYY-MM-DD HH:MM by <skill>`。
- `[x] N/A` 必须附一句原因，且不能再被翻回 `[ ]`。

整个子冲刺 "做没做完" 是一个机械可读的状态——不是 AI 的口头报告。

---

## 四、主流程

```
                ┌──────────────────────────────────────────┐
                │  /trio:init-project                      │
                │   → docs/, code/, trio/ skeleton         │
                │   → tech-stack.md (+ code-structure.md)  │
                └────────────────────┬─────────────────────┘
                                     │
                                     ▼
            ┌────────────────────────────────────────────┐
            │  三大支柱构建（顺序敏感）                   │
            │                                            │
            │  /trio:prd-management   → PRD              │
            │  /trio:tdd-management   → TDD              │
            │  /trio:tc-management    → Test-Case        │
            └────────────────────┬───────────────────────┘
                                 │
                                 ▼
            ┌────────────────────────────────────────────┐
            │  /trio:test-management                     │
            │   一次一个 sub-module，落 partials/         │
            │   汇总 → report.md + bugs.json             │
            └────────────────────┬───────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
       Trio Stage           子冲刺循环          /trio:next
   /trio:view-document       (见下方)          下一步建议
   逐条决策 bugs.json
                                 │
                                 ▼
            ┌────────────────────────────────────────────┐
            │  Subsprint 三件套                           │
            │                                            │
            │  /trio:subsprint-planner   规划             │
            │     ├─ [2] bugfix  (从 test report)         │
            │     ├─ [3] gap     (从 URS-PRD gap)         │
            │     └─ [4] fresh   (新功能)                 │
            │  /trio:subsprint-runner    执行             │
            │  /trio:subsprint-sync      TC 回写          │
            └────────────────────────────────────────────┘
```

### 4.1 子冲刺生命周期（核心闭环）

每次代码改动都走这个三步：

1. **`/trio:subsprint-planner`** — 选源（bugfix / gap / fresh），生成 `<n>-subsprint-plan.md`，自带 front-matter + Execution Checklist。**只写计划，不动代码。**
2. **`/trio:subsprint-runner`** — 把每个 task 的 code path 改动应用到 `code/`，doc path 改动应用到 `docs/`，本地 verify 一遍，翻 `Execute Coding` / `Update Docs` 两个框。
3. **`/trio:subsprint-sync`** — 跑 `/trio:tc-management` 把测试用例回写（patch 路径 or audit 路径），翻 `Update Test Case` 框。

### 4.2 "下一步该干啥" — `/trio:next`

不知道下一步该做什么时，跑 `/trio:next`。它读项目最新状态，按这个优先级给建议：

- **P0** — `code/` 有源码但 PRD/TDD/Test-Case 任一桶整体缺失 → 先补支柱
- **P0.5** — 最新 `bugs.json` 还有 `Pending` 决策 → 先去 Trio Stage 三角分类
- **P1** — 有未闭环的 bug → `/trio:subsprint-planner` bugfix
- **P3** — 文档对齐有缺口（URS↔PRD / PRD↔TDD / PRD↔TC） → 对应 management skill
- **P4** — 全部干净 → 问要不要起新功能

`/trio:next` 是**只读 + 只建议**——它从不替你按 enter。

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
| `/trio:subsprint-runner` | 子冲刺执行 | 在 `code/` `docs/` 内联改动 + 翻清单 |
| `/trio:subsprint-sync` | 子冲刺收尾（TC 回写） | TC patch / 新增 + 翻 `Update Test Case` |
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
