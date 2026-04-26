---
name: trio:subsprint-sync
description: After a subsprint's code and doc changes have landed via `/trio:subsprint-runner`, this skill handles the remaining sync step — updating test cases against the plan's TC impact (`trio:tc-management`). It resolves the plan, detects whether TC work applies, dispatches `trio:tc-management`, and lets that skill flip `Update Test Case` in the plan's `## Execution Checklist`. Writes nothing itself. Invoke after the runner has finished, for any plan whose TC impact section has unflipped work.
---

You own the **TC sync** step of the post-execution lifecycle. After `/trio:subsprint-runner` has applied the code and doc edits, this skill dispatches test-case updates against the plan's TC impact.

The skill writes nothing itself. It resolves, detects applicability, dispatches, and relies on `trio:tc-management` to flip the `Update Test Case` checkbox.

# Step 0: Resolve the plan

Same resolver contract as `/trio:subsprint-runner`. The `plan` input may be:

- Absolute path to `<n>-subsprint-plan.md`
- Folder name (e.g., `12-2026-04-22-20-30`) → `trio/subsprint/<folder>/<n>-subsprint-plan.md`
- Bare `<n>` → scan `trio/subsprint/` for the folder whose prefix matches

If missing, ask. Never guess.

# Step 1: Parse the plan

Read:

- Front-matter: `source`, `subsprint_id`, `subsprint_folder`, `docs_changes_expected`.
- `## Execution Checklist` block (strict format from `/trio:subsprint-planner`).
- Task list — each Task's `Code Paths` bullets.
- `## Test Case Impact` section (if present) — used to build a TC patch manifest in Step 3.

Preflight check: `Execute Coding` should already be `[x]` (the runner flipped it). If it's still `[ ]`, warn the user:

```
Warning: Execute Coding is still [ ] — the runner may not have completed.
Continue with sync anyway?  [y] yes  [n] exit and run /trio:subsprint-runner first
```

# Step 2: Detect whether TC work applies

Eligibility for the TC sync action:

- The checklist's `Update Test Case` is `[ ]`, OR
- The plan has a `## Test Case Impact` section with non-trivial entries (listed TC-IDs to patch or new TCs to add).

If `Update Test Case` is already `[x]` (not `[x] N/A`), report "already completed" and exit unless the user passes `--force`.

If neither condition holds, exit cleanly — there is nothing to sync.

# Step 3: Dispatch `trio:tc-management`

Inputs to pass:

- Project root absolute path.
- **`subsprintPlan`** — the plan file path (absolute). This is the signal tc-management uses to decide it should flip `Update Test Case` when done (see that skill's Step 2.5).

Two sub-paths depending on what the plan has:

## 3.i If the plan has `## Test Case Impact` with explicit TC IDs to patch

Build a patch manifest from the impact section:

1. Create a temp file at `trio/subsprint/<folder>/tc-patches.yml` (the conventional location from tc-management's patch path).
2. For each listed impact, emit a `patches[]` entry with:
   - `testCaseId` = the TC ID.
   - `source` = `"trio/subsprint/<folder>/<n>-subsprint-plan.md#test-case-impact"` (provenance requirement).
   - `operations` = derived from the impact description. Prefer `add-verification` and `add-forbidden-state` (safe strengthen ops). If the impact requires a reshape (rename, remove, mode change), STOP and tell the user the plan's TC impact describes a rewrite, which belongs in the audit path (3.ii), not the patch path.

Dispatch `trio:tc-management` with `patches: trio/subsprint/<folder>/tc-patches.yml`.

## 3.ii Otherwise (plan lists new TCs to add, or no explicit impact section)

Dispatch `trio:tc-management` with no `patches` input — this triggers its audit path. Make sure to pass `subsprintPlan` so it can flip the correct plan's checkbox on completion.

Expect back: per-TC result, mapping-file delta, final summary. `trio:tc-management` itself flips `Update Test Case`; this skill does NOT flip it directly.

# Step 4: Print the sync summary

At the end, output a compact summary:

```
Sync complete for subsprint <n> (<folder>):

  Test cases — <N> TCs patched, <M> TCs added — Update Test Case flipped to [x]

Checklist state:
  - [x] Execute Coding
  - [x] Update Docs
  - [x] Update Test Case

Subsprint <n> is fully synced.
```

If the action was skipped or failed, reflect it faithfully — never mark an action complete that wasn't.

# Skills this skill dispatches

| Callee | Purpose | Key inputs |
|--------|---------|------------|
| `trio:tc-management` (skill) | Update test cases (patch path or audit path) | project root, `subsprintPlan`, optional `patches` |

# Rules

- **Sync, don't run.** Code and doc execution is `/trio:subsprint-runner`'s job; this skill does not edit `code/` or `docs/`.
- `Update Test Case` is flipped by `trio:tc-management`, never by this skill directly.
- Never flip a `[x] N/A` entry back to `[ ]`.
- Safe to re-run: if `Update Test Case` is already `[x]`, Step 2 should surface "nothing to do" and exit cleanly.
