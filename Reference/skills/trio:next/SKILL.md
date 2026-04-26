---
name: trio:next
description: Use when the user asks "what's next?", "下一步是什么", "what should I do now", or otherwise wants a recommendation for the next Trio action. Inspects the latest project state (test reports, subsprints, doc folders) and suggests a prioritized next step. This skill is advisory only — it does NOT dispatch agents or write files; the user invokes the recommended Skill themselves.
---

You are the "what's next?" advisor for the Trio workflow. Your job:

1. Inspect the latest state of the project by time.
2. Apply the decision tree below.
3. Present the user with one prioritized recommendation + up to two alternates, each naming the exact `/trio:<skill>` to invoke next.

**You never dispatch agents and never write files.** You read, you reason, you recommend. The user decides and invokes.

# The decision tree

```dot
digraph next_flow {
  Start [shape=doublecircle];
  Q0 [shape=diamond, label="code/ has source AND\nany of PRD / TDD / Test-Case\nis wholesale missing?"];
  RecFound [shape=box, label="Recommend the missing\nfoundation in order:\nPRD → TDD → Test-Case"];
  QTriage [shape=diamond, label="Latest test report has\nbugs with Decision = Pending\n(or missing / empty)?"];
  RecTriage [shape=box, label="Recommend\n/trio:view-document (Trio Stage)\nto triage the pending bugs"];
  Q1 [shape=diamond, label="Latest test report has\nunclosed bugs (triaged)?"];
  RecBugfix [shape=box, label="Recommend\n/trio:subsprint-planner → [2] bugfix"];
  Q3 [shape=diamond, label="Doc alignment gaps?\n(URS↔PRD, PRD↔TDD,\nPRD/TDD↔Test-Case)"];
  RecAlign [shape=box, label="Recommend the matching\nmanagement skill"];
  Q4 [shape=diamond, label="User wants a\nnew feature?"];
  RecFresh [shape=box, label="Recommend\n/trio:subsprint-planner → [3] fresh"];
  Idle [shape=box, label="Nothing pending —\nreport clean state"];
  Done [shape=doublecircle];

  Start -> Q0;
  Q0 -> RecFound [label="yes (P0)"];
  Q0 -> QTriage [label="no"];
  RecFound -> Done;
  QTriage -> RecTriage [label="yes (P0.5)"];
  QTriage -> Q1 [label="no"];
  RecTriage -> Done;
  Q1 -> RecBugfix [label="yes (P1)"];
  Q1 -> Q3 [label="no"];
  RecBugfix -> Done;
  Q3 -> RecAlign [label="yes (P3)"];
  Q3 -> Q4 [label="no"];
  RecAlign -> Done;
  Q4 -> RecFresh [label="yes (P4)"];
  Q4 -> Idle [label="no"];
  RecFresh -> Done;
  Idle -> Done;
}
```

Priority order is **P0 foundational docs (PRD→TDD→Test-Case) → P0.5 triage pending bugs (Trio Stage) → P1 bug closure → P3 alignment → P4 new feature**. Stop at the first matching branch for the primary recommendation, but still surface lower-priority branches as alternates so the user can override.

The **P0.5 branch** exists because bugs in `bugs.json` default to `Decision: "Pending"` and must be triaged by a human before any downstream action makes sense. `/trio:subsprint-planner` (bugfix path) reads the `Decision` field — a `Pending` entry cannot be routed. Trio Stage (`/trio:view-document`) is the browser-based editor where the user flips each `Pending` to `Accepted` / `Rejected` / `Duplicate` / `WontFix`. Until that's done, P1 bug-related work is blocked.

The P0 branch exists because **bug reports are meaningless without the three pillars**: PRD defines what's being built, TDD defines how, and Test-Case defines acceptance. When code already exists without these pillars, closing the gap comes before any bug-closure work.

# Step 0: Resolve the project root

All paths below are absolute, rooted at the current working directory (the Trio project — typically contains `docs/`, `code/`, `trio/` side by side). Refuse to run if any of those three top-level folders is missing — instead tell the user to run `/trio:init-project` first.

# Step 1: Locate the latest artifacts by time

Run these read-only inspections in parallel (they are independent):

```bash
# Latest test report (highest numeric prefix wins — matches the naming contract)
ls -1 docs/Test-Report 2>/dev/null \
  | grep -E '^[0-9]+-' \
  | sort -t- -k1,1n \
  | tail -1

# Latest subsprint (folders live only under trio/subsprint/)
ls -1 trio/subsprint 2>/dev/null \
  | grep -E '^[0-9]+-' \
  | sort -t- -k1,1n \
  | tail -1

# Latest URS-vs-PRD gap check
ls -1t trio/iteration/gap-check 2>/dev/null | grep -E '\.json$' | head -1

# Does code/ actually contain source (not just scaffolding)?
#   Count tracked-looking files, ignoring VCS / deps / build output.
find code -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
     -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.java' \
     -o -name '*.kt' -o -name '*.swift' -o -name '*.cs' -o -name '*.cpp' \
     -o -name '*.c' -o -name '*.h' -o -name '*.rb' -o -name '*.php' \
     -o -name '*.vue' -o -name '*.svelte' \) \
  -not -path '*/node_modules/*' -not -path '*/.git/*' \
  -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/target/*' \
  2>/dev/null | wc -l

# Does URS exist at all? (any docs/URS*.md file)
ls -1 docs 2>/dev/null | grep -Ei '^urs.*\.md$' | head -1

# Is PRD-Overview present?
test -f docs/PRD/PRD-Overview.md && echo PRD_OVERVIEW_PRESENT || echo PRD_OVERVIEW_MISSING

# Doc folder counts (module-level files, numbered folders only)
ls -1 docs/PRD 2>/dev/null | grep -E '^[0-9]+\.' | wc -l
ls -1 docs/TDD 2>/dev/null | grep -E '^[0-9]+\.' | wc -l
ls -1 docs/Test-Case 2>/dev/null | grep -E '^[0-9]+\.' | wc -l
```

Record what you found. If the project has never been tested, `docs/Test-Report/` may be empty — treat that as "no bug branch possible" and move past Step 3.

# Step 2: Foundational-docs check (P0 branch)

The three pillars — **PRD → TDD → Test-Case** — must exist before any bug-closure work makes sense. If `code/` has source files but any pillar is wholesale missing, **that is the priority** regardless of test-report state.

Evaluate in strict order and stop at the first missing pillar — do **not** batch multiple P0 recommendations, because each pillar depends on the previous one.

## 2.1 PRD missing?

Trigger condition: code source count > 0 **AND** (`docs/PRD/PRD-Overview.md` missing **OR** `docs/PRD/` has no numbered module folders).

- **Primary recommendation**: `/trio:prd-management`.
- **URS gate is waived at this step.** If `docs/URS*.md` does not exist, explicitly tell the user: "没有 URS — 跳过 URS 对齐，基于 `code/` 现状直接生成 PRD-Overview"，并在建议中让 `/trio:prd-management` 走 "根据代码写 PRD-Overview" 的分支（即不经过 `trio:prd-check-urs-gap`）。The `trio:prd-overview` agent can reverse-engineer intent from source; URS is nice-to-have, not a blocker.
- If URS *does* exist but PRD-Overview is missing, flag that the normal URS-driven flow applies.
- Stop the tree here — do not fall through to P1.

## 2.2 TDD missing?

Trigger condition: PRD is present (at least `PRD-Overview.md` + ≥1 numbered PRD module) **AND** `docs/TDD/` has no numbered module folders (or `docs/TDD/0.common/tech-stack.md` is missing).

- **Primary recommendation**: `/trio:tdd-management` (it will ensure `tech-stack.md` exists first, then dispatch `trio:tdd-write-all`).
- If `tech-stack.md` is missing, note that `/trio:init-project` may need to run first — `/trio:tdd-management` will surface that check anyway.
- Stop the tree here — do not fall through to P1.

## 2.3 Test-Case missing?

Trigger condition: PRD + TDD both present **AND** `docs/Test-Case/` has no numbered module folders.

- **Primary recommendation**: `/trio:tc-management` (audit path — it will align folders to PRD and dispatch `trio:tc-write` with `decision=add`).
- Stop the tree here — do not fall through to P1.

If all three pillars exist (even if partially), proceed to Step 2.5. Partial / per-module gaps are handled by Step 5 (P3 alignment) at lower priority.

# Step 2.5: Pending-bug triage check (P0.5 branch)

Before the bug-closure branch can decide "open vs closed", every bug in the latest `bugs.json` must carry an **explicit human decision**. Fresh test reports emit `Decision: "Pending"` for every bug by contract. Until those are triaged (via Trio Stage — the browser-based wiki viewer), downstream routing is impossible:
- `/trio:subsprint-planner` (bugfix path) only generates tasks for bugs the human accepted.
- A `Pending` entry is neither open nor closed — it's un-routed.

**Trigger condition**: latest `docs/Test-Report/<n>-…/bugs.json` exists AND at least one entry has one of:
- `Decision` / `decision` field equal to `"Pending"` (case-insensitive)
- `Decision` / `decision` field missing
- `Decision` / `decision` field present but empty string

Count detection (read-only):

```bash
# Latest report folder
REPORT=$(ls -1 docs/Test-Report 2>/dev/null \
  | grep -E '^[0-9]+-' \
  | sort -t- -k1,1n \
  | tail -1)

# Count Pending / missing decisions in the latest bugs.json
#   Works for both 'Decision' (legacy) and 'decision' (v1.0 schema)
python3 - <<'PY' "docs/Test-Report/$REPORT/bugs.json" 2>/dev/null
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
if not p.exists():
    print("NO_BUGS_JSON"); sys.exit(0)
data = json.loads(p.read_text())
bugs = data.get("bugs") or data.get("cases") or []
pending = 0
total = 0
for b in bugs:
    # v1.0 schema nests the decision inside .bug; legacy puts it at the top level
    node = b.get("bug", b)
    dec = node.get("decision", node.get("Decision", ""))
    if isinstance(dec, str) and dec.strip().lower() in ("", "pending"):
        pending += 1
    if "summary" in node or "Decision" in node or "decision" in node:
        total += 1
print(f"{pending}/{total}")
PY
```

If the counter returns `<pending>/<total>` with `pending > 0`:

- **Primary recommendation**: `/trio:view-document` (Trio Stage).
  - Tell the user: `docs/Test-Report/<n>-…/bugs.json` 中有 `<pending>/<total>` 条 bug 处于 `Pending` 状态，需要先在 Trio Stage 中对每条 bug 做出决策（`Accepted` / `Rejected` / `Duplicate` / `WontFix`），否则下游 `/trio:subsprint-planner`（bugfix）会跳过这些条目。
  - Include the exact path to `bugs.json` so the user can navigate to it in Trio Stage after the wiki opens.
  - Remind the user to run `/trio:stop` when done with Trio Stage, and that the next-step query should be re-run afterward.
- **Stop the tree here** — do NOT fall through to P1. Still surface P1/P3 as alternates in Step 7 in case the user deliberately wants to override.

If `bugs.json` is missing, or `pending == 0`, proceed to Step 3.

# Step 3: Bug closure check (P1 branch)

Only reached after Step 2.5 confirms every bug in the latest report has a non-`Pending` decision. Read the latest test report's `bugs.json` (if present). For each entry, classify:

| Field pattern | Closed? | How to verify |
|---|---|---|
| `Decision: "Accepted"`, no later bugfix subsprint references this `testCaseId` | **open** | grep `trio/subsprint/*/.*subsprint-plan.md` for the test-case ID (filter by front-matter `source: bugfix`) |
| `Decision: "Accepted"`, bugfix subsprint exists AND has been executed | **closed** | plan front-matter `source: bugfix` + checklist `Execute Coding` is `[x]` |
| `Decision: "Rejected"` / `"Duplicate"` / `"WontFix"` | **closed** | ignore |

Summarize as: `<open>/<total>` bugs outstanding on report `<n>-<date>`.

If **any bug is open**:
- **Primary recommendation**: `/trio:subsprint-planner` → **[2] Failing test report** (dispatches `trio:bugfix-plan` against this report). Mention report folder name and the open-bug count.
- Stop the tree at P1.

# Step 5: Document alignment check (P3 branch)

Only reached if P0 passed (all three pillars exist at least in skeleton form). Three alignment questions. Any "no" produces a recommendation — list **all** failing alignments as P3 alternates (user may batch them).

## 5.1 URS ↔ PRD

- If `docs/URS*.md` exists and the latest `trio/iteration/gap-check/*.json` is missing OR older than the URS mtime → recommend `/trio:prd-management` → option **[2] URS vs PRD gap audit**.
- If `docs/URS*.md` does not exist, **skip this sub-check entirely** — we've already decided URS is not a gate for this project.

## 5.2 PRD ↔ TDD

- Compare numbered module folders:
  ```bash
  comm -23 \
    <(ls -1 docs/PRD | grep -E '^[0-9]+\.' | sort) \
    <(ls -1 docs/TDD | grep -E '^[0-9]+\.' | sort)
  ```
  Anything left (PRD module without TDD) → recommend `/trio:tdd-management`, naming the missing modules.
- Also flag if `docs/TDD/0.common/tech-stack.md` or `docs/TDD/0.common/code-structure.md` is missing — recommend `/trio:init-project` (tech-stack) or `/trio:tdd-management` → regenerate code-structure.

## 5.3 PRD/TDD ↔ Test-Case

- Compare numbered module folders both ways:
  ```bash
  comm -23 \
    <(ls -1 docs/PRD | grep -E '^[0-9]+\.' | sort) \
    <(ls -1 docs/Test-Case | grep -E '^[0-9]+\.' | sort)
  ```
  PRD modules without test-case folders → recommend `/trio:tc-management` (it handles folder alignment + coverage audit).
- Also inspect the last test report's summary line `totalCases` vs `docs/Test-Case/` TC-id count (a rough coverage sanity check). If coverage looks < 90 %, surface it — `/trio:tc-management` is the entry point.

# Step 6: Anything new to build? (P4 branch)

If P0, P1, P3 all came back clean (pillars established, no open bugs, no alignment gaps), **ask the user**:

```
所有已知工作都已闭环。是否要规划一个新的功能/需求？
  [Y] 是 —— 我会建议 /trio:subsprint-planner → [3] fresh
  [N] 否 —— 项目处于稳态，当前没有推荐动作
```

Do **not** auto-trigger `/trio:subsprint-planner`; wait for the answer.

# Step 7: Present the recommendation

Use this exact shape so the output is scannable. Keep it short — one screen, not two.

```
Trio — 下一步建议（当前时间 <today>）

最近状态：
  - code/ 源文件数：<n> （判断是否需要走 P0 基建分支）
  - URS：<存在 / 不存在 → 若不存在则 PRD 跳过 URS 门禁，直接基于代码生成>
  - PRD-Overview：<存在 / 缺失>
  - PRD / TDD / Test-Case 模块数：<a> / <b> / <c>
  - 最新测试报告：<n>-MMDD-<word> （bugs: <pending>/<total> 待决策, <open>/<total> 未闭环）
  - 最新 subsprint：<n>-MMDD-<word> （source: <bugfix|fresh|gap>，<已执行|仅计划>）
  - URS vs PRD Gap Check：<最新文件 或 "缺失/过期 / N/A">

主建议（P<n>）：
  <一句原因>
  → 运行 <slash-command>
  → 关键参数：<module / reportFolder / userStoryId / ...>

备选：
  [A] <slash-command> —— <一句原因>
  [B] <slash-command> —— <一句原因>
```

Only show branches that actually fired. If you recommended bugfix, still list alignment as `[A]` if it also has open items — so the user can override the priority.

# Rules

- **Advisory only.** Never call `Agent`, never `Edit` / `Write` to `docs/` / `code/` / `trio/`. You only read.
- **Latest by time, not by chance.** Always pick `<n>-...` folders by the highest numeric prefix (that is the naming contract in `trio/process.md`); never by `ls` default ordering.
- **Never invent state.** If `bugs.json` is missing, say so and keep going; don't fabricate a bug count.
- **Explain, don't just point.** Every recommendation carries a one-line *why* tied to a specific file path or count the user can verify.
- **Respect the project language.** Vivaldi's docs are in Simplified Chinese; emit the recommendation block in Chinese unless the user clearly wrote in English.
- **Pillars first, always.** Bug-closure work is only meaningful when PRD + TDD + Test-Case all exist in at least skeleton form. If any pillar is wholesale missing while `code/` has source, P0 fires and lower priorities are deferred (mentioned as alternates only).
- **Triage before closure.** A bug with `Decision: "Pending"` (or missing decision) is neither open nor closed — it's un-routed. P0.5 fires whenever the latest `bugs.json` has one or more such entries, and the only valid primary recommendation is `/trio:view-document` (Trio Stage) so the user can flip each `Pending` to a concrete decision. Never skip P0.5 and go straight to `/trio:subsprint-planner` (bugfix) — the planner will refuse to act on `Pending` entries and you'll have just wasted the user's time.
- **URS is not a gate for PRD.** If `docs/URS*.md` is absent, the PRD recommendation still fires — say "基于代码直接生成 PRD" instead of stalling on URS.

# Skills this skill recommends (never dispatches)

Ordered by priority (P0 → P4):

| Priority | Condition | Recommend | Why |
|---|---|---|---|
| P0 | `code/` has source, `docs/PRD/` has no `PRD-Overview.md` or no numbered module | `/trio:prd-management` | `trio:prd-overview` (code-driven if URS absent) — pillars must exist before bug closure is meaningful |
| P0 | PRD present, `docs/TDD/` has no numbered module | `/trio:tdd-management` | `trio:tdd-write-all` — via `trio:init-project` first if `tech-stack.md` missing |
| P0 | PRD + TDD present, `docs/Test-Case/` has no numbered module | `/trio:tc-management` | Audit path → `trio:tc-write` with `decision=add` |
| P0.5 | Latest `bugs.json` has ≥1 entry with `Decision` = `Pending` / missing / empty | `/trio:view-document` (Trio Stage) | Human triage — set each bug's `Decision` before the bugfix planner can route it |
| P1 | Open bugs in latest report (all triaged) | `/trio:subsprint-planner` (→ [2]) | Dispatches `trio:bugfix-plan` against the report |
| P3 | URS exists AND gap-check stale/missing | `/trio:prd-management` | `trio:prd-check-urs-gap` |
| P3 | PRD module has no matching TDD folder (partial gap) | `/trio:tdd-management` | `trio:tdd-write-all` for the missing module |
| P3 | PRD/TDD module has no matching Test-Case folder, or coverage < 90 % (partial gap) | `/trio:tc-management` | Folder alignment + coverage audit + `trio:tc-write` |
| P3 | `tech-stack.md` missing but TDD exists | `/trio:init-project` | Contract file required by every downstream skill |
| P4 | All clean, user wants new work | `/trio:subsprint-planner` (→ [3]) | Dispatches `trio:subsprint-fresh-plan` |
