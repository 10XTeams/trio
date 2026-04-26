---
name: trio:subsprint-runner
description: Execute a subsprint plan in place — pass the plan to `trio:subsprint-execute`, which applies each task's code-path and doc-path edits directly to `code/` and `docs/`. Resolves the plan input (absolute path, folder name, or bare `<n>`), parses front-matter, dispatches the executor, flips `Execute Coding` and `Update Docs` in the plan's checklist, and hands off to `/trio:subsprint-sync` for any remaining TC patches. Writes nothing itself. Invoke when the user wants to execute a plan produced by `/trio:subsprint-planner`.
---

You own the **execution** half of the subsprint lifecycle. This skill resolves a plan, verifies its front-matter, dispatches `trio:subsprint-execute`, flips the relevant checkboxes, and points the user at `/trio:subsprint-sync` for any remaining TC sync work.

The skill itself writes nothing. It validates preconditions, routes, dispatches, and relays results.

# Step 0: Resolve the plan

The `plan` input may be:

- Absolute path to a `<n>-subsprint-plan.md`
- Folder name like `12-0422-aurora` (auto-resolves to `trio/subsprint/<folder>/<n>-subsprint-plan.md`)
- Bare `<n>` (scans `trio/subsprint/` and picks the folder with that leading integer)

If missing, ask the user. Never guess.

# Step 1: Read plan front-matter

Parse the YAML front-matter. Required fields:

```yaml
---
source: bugfix | gap | fresh
subsprint_id: <n>
subsprint_folder: <n>-MMDD-<word>
docs_changes_expected: true | false
---
```

If the plan is missing its front-matter, refuse and tell the user to re-run `/trio:subsprint-planner`. Legacy plans under `trio/iteration/` or `trio/bugfix/` are no longer supported — subsprint folders live only under `trio/subsprint/`.

# Step 2: Dispatch `trio:subsprint-execute`

Inputs to pass:

- Project root absolute path
- **`plan`** — the plan file path (absolute)
- **`source`** — from front-matter (so the agent can tailor narration)
- Contract paths: `docs/TDD/0.common/tech-stack.md`, `docs/TDD/0.common/code-structure.md`

What the agent does:

- Applies each task's code-path edits directly to files under `code/`.
- Applies each task's doc-path edits directly to files under `docs/` (PRD / TDD / Test-Case bullets).
- Verifies each task per the plan's Verification section.
- Returns an execution log: per-task result, files touched, side-edits, any verification failures.

Expect back: execution log, list of files touched per task, any tasks skipped or failed.

# Step 2.5: Update the Plan Checklist

After execution returns, flip the relevant boxes in the plan file — same plan path this skill was handed:

- **Code edits applied** → flip `Execute Coding` from `[ ]` to `[x]`, append trailer ` — completed YYYY-MM-DD HH:MM by trio:subsprint-runner`.
- **Doc edits applied** (any task touched a `docs/` path) → flip `Update Docs` from `[ ]` to `[x]`, append the same style of trailer.

Rules:

- Never flip `Update Test Case` — that belongs to `/trio:tc-management`.
- Never flip a `[x] N/A` entry back to `[ ]` — respect planner-declared exclusions.
- If execution stopped on a verification failure, leave the relevant box(es) as `[ ]` — the user can fix and re-run.
- If the plan has no `## Execution Checklist` section (legacy plan without front-matter, or hand-written file), skip silently and warn the user once.

# Step 3: Hand off to `/trio:subsprint-sync`

Code and doc execution are complete. Any remaining work — test-case updates — lives in `/trio:subsprint-sync`. Present the handoff:

```
Subsprint <n> executed. Remaining sync steps:

  - Update Test Case  — <[ ] pending | [x] N/A>

Run `/trio:subsprint-sync <n>` next to handle TC patches.
```

This skill never dispatches the sync step itself — the user must explicitly invoke `/trio:subsprint-sync`.

# Plan Front-Matter Contract (for reference)

```yaml
---
source: bugfix | gap | fresh
subsprint_id: <n>
subsprint_folder: <n>-MMDD-<word>
docs_changes_expected: true | false
---
```

- `source` marks origin.
- `subsprint_id` / `subsprint_folder` mirror the folder basename.
- `docs_changes_expected` is informational — the executor will apply doc-path edits whenever the plan lists them.

Missing front-matter → this runner warns and proceeds with `docs_changes_expected` treated as `false`. Planner agents are expected to emit the block.

# Folder layout

```
trio/subsprint/
└── <n>-MMDD-<word>/
    ├── <n>-subsprint-plan.md      # input (written by /trio:subsprint-planner)
    └── notes/                      # fresh-source only
```

# Agents this skill dispatches

| Agent | Purpose | Key inputs |
|-------|---------|------------|
| `trio:subsprint-execute` | Apply each task's code-path and doc-path edits in place | project root, `plan`, `source` |

# Rules

- **Run, don't plan.** Plans come from `/trio:subsprint-planner`. TC updates live in `/trio:subsprint-sync`. This skill only dispatches execution.
- Never execute a plan without the user's explicit go.
- Subsprint folders live only under `trio/subsprint/`. Legacy `trio/iteration/` and `trio/bugfix/` folders are no longer resolved by this skill.
- This skill flips `Execute Coding` and `Update Docs`. It never flips `Update Test Case` (owned by `/trio:tc-management`), and never flips a `[x] N/A` entry.
