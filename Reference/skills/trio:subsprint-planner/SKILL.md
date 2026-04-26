---
name: trio:subsprint-planner
description: Produce a subsprint plan file under `trio/subsprint/<n>-MMDD-<word>/<n>-subsprint-plan.md` from one of three sources — the latest failing test report (`trio:bugfix-plan`), a triaged URS-PRD gap report (`trio:urs-gap-plan`), or a brand-new fresh subsprint (`trio:subsprint-fresh-plan`). Validates preconditions, enforces the Plan Front-Matter Contract (`source`, `subsprint_id`, `subsprint_folder`, `docs_changes_expected`) and the Plan Checklist Contract (`Execute Coding` / `Update Docs` / `Update Test Case`). After the plan is generated, tells the user the recommended sequence: `/trio:subsprint-runner` (apply edits) → `/trio:subsprint-sync` (TC updates). Writes nothing itself. Invoke when the user wants to draft a plan — execution and sync are separate skills' jobs.
---

You own the **planning** half of the subsprint lifecycle. This skill produces a plan file under `trio/subsprint/<n>-MMDD-<word>/<n>-subsprint-plan.md` from one of three sources. Execution is handled by `/trio:subsprint-runner`.

The skill itself writes nothing. It validates preconditions, routes, dispatches, and relays results.

# Step 0: Ask for the plan source

```
/trio:subsprint-planner — pick a source:

  [2] Failing test report      — trio:bugfix-plan
  [3] URS-PRD gap report       — trio:urs-gap-plan
  [4] Brand-new (fresh) plan   — trio:subsprint-fresh-plan
```

- `2` → Step 2
- `3` → Step 3
- `4` → Step 4

# Step 2: Test-report source → dispatch `trio:bugfix-plan`

## Dispatch

Inputs to pass:

- Project root absolute path
- **`reportTarget`** *(optional)*: folder name or absolute path. Empty → agent auto-selects the latest under `docs/Test-Report/` (no confirmation needed).
- **Output folder root**: `trio/subsprint/`.
- **Front-matter requirement**: plan emits `source: bugfix`.
- **Checklist requirement**: emit the Plan Checklist Contract (below); for bugfix plans, `Update Test Case` defaults to `[ ]` (TC patches are recommended to prevent regression of the failures being fixed).

Expect back: which report was used (announce if auto-selected), plan path, total fix tasks, suggested phase order.

After the plan is generated, tell the user:

```
Plan generated: trio/subsprint/<n>-.../<n>-subsprint-plan.md

Recommended sequence:
  1. `/trio:subsprint-runner <n>`  — apply the code fixes (and any PRD/TDD corrections) in place
  2. `/trio:subsprint-sync <n>`    — afterwards: update test cases to lock in the regression
```

# Step 3: URS-PRD gap source → dispatch `trio:urs-gap-plan`

## Preconditions

- At least one gap-check JSON exists under `trio/iteration/gap-check/` (produced by `/trio:prd-management` → `trio:prd-check-urs-gap`). If none exists, stop and tell the user:

  ```
  No gap-check JSON found under trio/iteration/gap-check/.
  Run /trio:prd-management (URS gap check) first, then come back.
  ```

- The chosen gap-check JSON must have **at least one item in Part 2 or Part 3 whose `decision` field equals `"Plan"`**. The `decision` field is how the human triages which gaps are in-scope for planning. Items with `decision: ""` / `"Defer"` / `"Clarify"` / etc. are ignored.

## Dispatch

Inputs to pass:

- Project root absolute path
- **`gapCheckFile`** *(optional)*: folder-relative file name (e.g. `Gap Check 3-0423-compass.json`) or absolute path. Empty → agent auto-selects the file with the largest `<n>` under `trio/iteration/gap-check/` (no confirmation).
- **Output folder root**: `trio/subsprint/`
- **Front-matter requirement**: plan emits `source: gap`.
- **Checklist requirement**: emit the Plan Checklist Contract (below); for gap-sourced plans, `Update Docs` defaults to `[ ]` (gap tasks almost always need PRD edits — Part 2 adds missing PRD sections; Part 3 removes 待实现 markers as features land). `Update Test Case` defaults to `[ ]` (new features need new TCs).

Precondition-check behavior the agent enforces:

- Refuse to proceed if zero items have `decision: "Plan"`. Report which file was read and suggest the user edit the `decision` fields.
- Accept only Part 2 and Part 3 items for planning. Part 1 items (PRD has, URS missing) are informational — if the user wants to propagate them back into URS, that's a separate conversation, not a subsprint.

Expect back: which gap-check file was used, plan path, task count (= selected item count), suggested phase order (Part 3 items typically come first since they're already scoped in PRD; Part 2 items come second since they need PRD drafting too).

After the plan is generated, tell the user:

```
Plan generated: trio/subsprint/<n>-.../<n>-subsprint-plan.md
Source gap-check: trio/iteration/gap-check/<file>

Recommended sequence:
  1. `/trio:subsprint-runner <n>`  — implement the gap items, applying PRD/TDD edits
                                       (Part 2 adds sections, Part 3 removes 待实现 markers) in place
  2. `/trio:subsprint-sync <n>`    — afterwards: add test cases for the new features
```

# Step 4: Fresh source → dispatch `trio:subsprint-fresh-plan`

## Two phases

The fresh source is two-step because the user authors the plan content themselves.

First decide which phase:

1. Scan `trio/subsprint/` for folders whose `<n>-subsprint-plan.md` has front-matter `source: fresh` AND is missing any required populated section (the skeleton markers `<!-- TODO -->` still present). If the user explicitly names an existing fresh folder, prefer that.
2. If an incomplete fresh plan is found and the user wants to finalize it → `phase=finalize`.
3. Otherwise → `phase=init`.

If ambiguous, ask:

```
Fresh plan mode:

  [1] Create a new subsprint skeleton (you'll fill it in, then re-run to finalize)
  [2] Finalize an existing skeleton:
      - <existing folder 1>
      - <existing folder 2>
```

## Dispatch `trio:subsprint-fresh-plan`

Inputs to pass:

- Project root absolute path
- **`phase`** — `init` or `finalize`
- **`folder`** — required for `finalize`; absolute or relative to `trio/subsprint/`
- **Output folder root**: `trio/subsprint/` (agent computes `<n>` on init)
- **Front-matter requirement**: plan emits `source: fresh`.
- **Checklist requirement**: on `phase=finalize` emit the Plan Checklist Contract (below); initial state is derived from the user-edited skeleton — `Update Docs` follows `docs_changes_expected`; `Update Test Case` defaults to `[ ]` unless the skeleton explicitly declares no TC impact.

For `phase=init`, expect back: folder path, skeleton file path, `notes/` path, and instructions for the user on what to fill in before re-running.

For `phase=finalize`, expect back: validated-plan path, task count, any gaps the agent refused to fabricate.

After a successful `finalize`, offer TC sync exactly as in Step 1 (fresh plans benefit from a TC pass before running).

# Plan Front-Matter Contract

Every plan under `trio/subsprint/` begins with:

```yaml
---
source: bugfix | gap | fresh
subsprint_id: <n>
subsprint_folder: <n>-MMDD-<word>
docs_changes_expected: true | false
---
```

- `source` marks origin.
- `subsprint_id` is the integer from the folder name.
- `subsprint_folder` is the folder basename (redundant with path but useful for tools scanning flat).
- `docs_changes_expected` is informational. Set `true` whenever any task lists a path under `docs/`.

Planner agents MUST emit the block.

# Plan Checklist Contract

Immediately after the front-matter (before any `# Overview` heading), every plan MUST contain this exact block — literal heading, literal item text, same order. Downstream skills parse and edit it in place, so drift is not allowed.

```markdown
## Execution Checklist

- [ ] **Execute Coding** — `/trio:subsprint-runner` (applies code edits in place)
- [ ] **Update Docs** — `/trio:subsprint-runner` (applies doc edits in place)
- [ ] **Update Test Case** — `/trio:tc-management` (patch or audit path)
```

## Initial state rules (set by the planner agent that emits the plan)

| Item | `[ ]` (todo) | `[x] N/A` (skip) |
|------|--------------|------------------|
| Execute Coding | default — every plan has code tasks | only if the plan genuinely has zero code tasks (rare; usually a docs-only refactor) |
| Update Docs | when `docs_changes_expected: true` | when `docs_changes_expected: false` |
| Update Test Case | `source: bugfix` (TC patch recommended for regression) | when the plan explicitly states no TC impact |

When marking `N/A`, append ` — N/A: <one-sentence reason>` so the reason is auditable. Example:

```markdown
- [x] **Update Docs** — N/A: docs_changes_expected=false; plan has no paths under docs/
```

## Completion rules (written by downstream skills)

When a downstream skill finishes its part of the plan, it flips the box from `[ ]` to `[x]` and appends a trailer:

```markdown
- [x] **Execute Coding** — `/trio:subsprint-runner` (applies code edits in place) — completed 2026-04-23 14:07 by trio:subsprint-runner
```

- `trio:subsprint-runner` flips **Execute Coding** after the code edits are applied, and flips **Update Docs** after the doc edits are applied (independent — one may complete without the other).
- `trio:tc-management` flips **Update Test Case** after a successful audit or patch run that actually modified TCs. If the run concludes "no TC change needed," it flips to `[x]` with trailer `— no change required`.
- Skills MUST NOT flip a box they did not own. They MUST NOT flip a `[x] N/A` back to `[ ]`.

## Planner agents MUST emit this block

Same enforcement level as the front-matter. A plan without the checklist is a contract violation.

# Folder layout

```
trio/subsprint/
└── <n>-MMDD-<word>/
    ├── <n>-subsprint-plan.md      # always (any source)
    └── notes/                      # fresh-source only; user-authored inputs
```

`<n>` increments across ALL subsprint plans regardless of source. When a planner agent allocates `<n>`, it scans `trio/subsprint/` (the single authoritative home for subsprint folders) for entries matching `^(\d+)-` and picks `max(existing) + 1`.

# Agents this skill dispatches

| Agent | Purpose | Key inputs |
|-------|---------|------------|
| `trio:bugfix-plan` | Test report → subsprint plan | project root, optional `reportTarget` |
| `trio:urs-gap-plan` | Triaged URS-PRD gap JSON → subsprint plan | project root, optional `gapCheckFile` |
| `trio:subsprint-fresh-plan` | Fresh subsprint (init + finalize) | project root, `phase`, `folder` (on finalize) |

# Rules

- **Plan, don't run.** This skill never executes plans — that's `/trio:subsprint-runner`.
- Every planner agent emits the Plan Front-Matter Contract AND the Plan Checklist Contract; verify both on ingest. Reject plans that are missing either.
- After a plan is generated, always give the user the choice to sync TCs (fresh / gap) or hand off to the runner (bugfix).
- Never auto-trigger the runner — the user must explicitly invoke `/trio:subsprint-runner`.
- The checklist is the single source of truth for "is this subsprint done?" — the planner never flips boxes; only downstream skills do, and only for the items they own.
