---
name: trio:tc-management
description: Orchestrate the test case lifecycle. Two paths — **audit path**: declares Test Mode, discovers the framework, validates folder alignment with PRD, runs coverage + false-pass audit, and dispatches `trio:tc-write` with `add` / `skip` / `rewrite`. **Patch path**: when the caller supplies `patches: <manifest>` (typically from a subsprint plan's TC-modification tasks), skips audits and dispatches `trio:tc-write` with `decision=patch` to apply explicit, strengthen-only operations (add Verification, add Forbidden State, tighten Precondition, update assertion). Invoke after PRD + TDD are in place, whenever TCs need updating, or to execute a subsprint's determined TC modifications. The skill does not write test cases itself — the `trio:tc-write` agent does.
---

You own the test-case phase. Your job is to make sure the folder structure is aligned to PRD, declare the Test Mode, run the coverage + false-pass audit, and dispatch `trio:tc-write` with a clear scope.

# Paths of operation

This skill runs in one of two paths, decided at invocation time:

- **Audit path** (default) — full flow Step 0 → 1 → 1B → 2. Use when the user wants to add / skip / rewrite TCs or audit coverage. This is the path a human follows when starting a TC phase cold.
- **Patch path** — Step 0P → 2 only. Use when the caller supplies an explicit **patch manifest** listing TC IDs and the operations to apply (typical source: a subsprint plan's TC-modification tasks, or post-execution "Needs hardening" fallout). Skips Test Mode declaration, folder alignment, coverage/false-pass audit — those upstream decisions already happened.

Route:
- If the caller passes `patches: <absolute-path-to-manifest>` → **patch path** (jump to Step 0P).
- Otherwise → **audit path** (continue at Step 0).

# Step 0: Declare Test Mode

Before any folder alignment or TC generation, ask the user to declare the Test Mode for this run.

## Options

- **`ai-driven`** — specs are executed by an agent driving a browser (e.g. Playwright MCP). Spec files may be human-readable playbooks (comments + steps). The `## Automation` block in each TC is optional but recommended.
- **`framework-automated`** — specs are executable code in the project's existing test framework (Playwright / Cypress / pytest-playwright / WebdriverIO). The `## Automation` block is **required** for every TC, and Step 3.4b in `trio:tc-write` will static-check each emitted spec.
- **`hybrid`** — P0 TCs are `framework-automated`; P1/P2 may be `ai-driven`. Each TC's Automation block declares its own mode.

## Record the decision

The chosen mode goes into every TC file produced this run (the agent writes `> Test Mode (this run): <mode>` at the top of each file).

If the user re-runs this skill with a different mode, existing TCs keep their original mode unless they explicitly re-declare. **Never silently downgrade a `framework-automated` TC to `ai-driven`.**

## Discover the framework (when mode != `ai-driven`)

If mode is `framework-automated` or `hybrid`:

1. Scan `code/` for test-runner configs (`playwright.config.*`, `cypress.config.*`, `pytest.ini`, `vitest.config.*`, …).
2. Read one or two existing spec files to learn import style, fixtures, and assertion idioms.
3. If no runnable test framework exists under `code/`, **stop** and report:
   > "framework-automated requested but no test runner found under `code/`; install a runner or re-run with mode=ai-driven."
   Do NOT scaffold a new framework unilaterally.

# Step 0P: Patch path — validate manifest and short-circuit to dispatch

Only enter this step when the caller passed `patches: <path>`. If so, you execute Step 0P in place of Steps 0, 1, and 1B, then jump to Step 2.

## 0P.1 Read and parse the manifest

The manifest is a YAML file. Required shape:

```yaml
# See "Patch manifest reference" section at the end of this file for the full op set.
patches:
  - testCaseId: TC-<X>.<Y>-<NNN>
    source: "<provenance — e.g. trio/subsprint/12-.../plan.md task 3, or bugs.json#id=7>"
    operations:
      - op: add-verification | add-forbidden-state | tighten-precondition | update-automation-assertion | add-selector
        content: |
          <markdown or code snippet>
        verificationIndex: <int>   # required only for update-automation-assertion
```

## 0P.2 Validate

1. File exists and parses as YAML; has non-empty `patches` array.
2. Every `testCaseId` matches `^TC-\d+\.\d+-\d+$` AND resolves to an existing `### TC-...` heading under `docs/Test-Case/`.
3. Every `op` is in the allowed-strengthen set (see "Patch manifest reference"). Any weakening op → STOP with: "patch operation `<op>` weakens TC-X.Y-NNN; use `decision=rewrite` instead of `patch`."
4. For each patched TC, read its header's `> Test Mode (this run): <mode>`. Record per-TC mode; patch path MUST NOT change it. Any `op` that would rewrite the mode line → STOP.
5. For TCs whose recorded mode is `framework-automated`, flag them — `tc-write` Step 3.4b will re-run compile-check on the modified spec.

If any validation fails, STOP and report which patch entry / which field. Do NOT dispatch a partially-valid manifest.

## 0P.3 Skip reasons — be explicit to the user

Print:

```
Patch path active. Skipping:
  - Step 0 (Test Mode declaration) — each patched TC keeps its existing mode
  - Step 1  (folder alignment)      — patches target existing TC IDs, not folders
  - Step 1B (coverage / false-pass) — upstream caller already made these decisions

<N> patches validated across <M> test cases. Dispatching trio:tc-write with decision=patch.
```

Proceed directly to Step 2 with `decision = patch` and `patches = <manifest-path>`.

# Step 1: Validate folder alignment (PRD ↔ Test-Case)

Compare `docs/PRD/` against `docs/Test-Case/`:

| PRD Folder/File | Test-Case Folder/File | Status |
|-----------------|-----------------------|--------|
| <module folder> | <corresponding folder> | Missing / Matched / Extra |
| <sub-module file> | <corresponding file>   | Missing / Matched / Extra |

Handle mismatches:
- **Missing folders/files** → list and ask which to create now.
- **Extra folders/files** (in Test-Case but not PRD) → warn that deleting a folder deletes all TCs inside; ask for confirmation.
- **Name mismatches** (PRD folder was renamed) → suggest renaming the Test-Case folder; ask for confirmation.

Wait for confirmation before proceeding.

# Step 1B: Coverage check + false-pass audit (when TCs already exist)

## 1B.1 Scan existing TCs

For each existing TC file:
- Count all TC IDs (pattern `### TC-X.Y-NNN`)
- List each TC ID with its description + priority

## 1B.2 Discover existing test scripts

Scan `code/` for test-script files (any `test/`, `tests/`, `__tests__/`, `e2e/`, `test-script/`, `spec/` directory). For each script:
- Read and extract TC IDs referenced in comments / test-block titles
- Note test type (API / E2E / Unit) from framework imports

Do NOT assume a fixed path.

## 1B.3 Cross-reference with PRD

For each target module:
1. Read PRD sub-module documents from `docs/PRD/<module>/`.
2. Read `docs/TDD/0.common/code-structure.md` for routes + API endpoints.
3. Walk each Mermaid flowchart and list all branches/paths.
4. Compare against existing TCs:
   - **Covered paths** — branches with ≥1 TC
   - **Uncovered paths** — branches with no TC
   - **Orphan TCs** — TCs with no current PRD requirement (stale)

## 1B.4 Display coverage report

```
=== Test Coverage Check ===

Module: X. <module name>

| Sub-module | PRD Branches | Existing TCs | E2E Covered | API Covered | Uncovered Branches |
|------------|--------------|--------------|-------------|-------------|--------------------|
| X.1 <name> | N            | N            | N / N       | N / N       | <list>             |

Uncovered PRD flow branches:
  - X.1: <branch description> (from flowchart path A → B → C)
  - …

Orphan test cases (no matching PRD requirement):
  - TC-X.Y-NNN: <description>
  - …
```

## 1B.5 User decision

Ask the user which action to take. This is the value passed as `decision` to `trio:tc-write`:

- **`add`** — add missing TCs for uncovered PRD branches
- **`skip`** — proceed to script writing only, no TC changes
- **`rewrite`** — regenerate all TCs from scratch
- **`patch`** — only reachable via the **patch path** (Step 0P). The user does not pick it interactively; the caller supplies `patches: <manifest>` at invocation time.

Wait for the reply before Step 1B.6.

## 1B.6 False-pass audit

For any TC whose covered area has had a field-reported bug since the last execution:

1. Would the TC's current **Verification** items have mechanically detected the bug?
2. Would the TC's **Forbidden States** have prevented the executor from rationalizing the bug as expected behavior?
3. Do the TC's required test types include the layer where the bug lives (e.g., don't rely on API tests to catch a frontend render bug)?

Any TC that fails 1–3 goes on a **"Needs hardening"** list. Present it to the user. Do NOT exit Step 1B until the user approves specific Verification / Forbidden-State additions (or explicitly waives them).

# Step 2: Dispatch `trio:tc-write`

Inputs to the agent (audit path):
- **Project root absolute path**
- **`module`** — the target (confirmed with user) or `all`
- **`testMode`** — from Step 0
- **`framework`** — from Step 0.3 (when mode != `ai-driven`)
- **`decision`** — from Step 1B.5 (`add` / `skip` / `rewrite`)
- **"Needs hardening"** list — from 1B.6; agent must incorporate these Verification / Forbidden-State updates on top of its usual write
- Contract file paths: `docs/TDD/0.common/code-structure.md`, `docs/TDD/0.common/tech-stack.md`, `docs/Test-Case/test-script-mapping.md`
- Hard rules reminder: TC ID stable, UI TCs require E2E, `framework-automated` specs must compile-check, Simplified Chinese for TC text.

Inputs to the agent (patch path):
- **Project root absolute path**
- **`decision`** — literal `patch`
- **`patches`** — absolute path to the validated manifest from Step 0P
- Contract file paths: `docs/TDD/0.common/code-structure.md`, `docs/Test-Case/test-script-mapping.md`
- `testMode` / `framework` / `module` / "Needs hardening" are **NOT** passed — the agent derives mode per-TC from each TC's header, and the manifest itself scopes the work.

Expect back: per-TC patch results (applied / skipped / rejected), recompile-check status on any framework-automated TC touched, mapping-file delta (if a spec path changed), next step.

# Step 2.5: Update the Subsprint Plan Checklist (when driven by a subsprint)

This skill participates in the Plan Checklist Contract defined by `/trio:subsprint-planner`. It owns exactly one box: **`Update Test Case`**.

## When to flip

Flip `Update Test Case` from `[ ]` to `[x]` after a successful `trio:tc-write` dispatch IF either:

1. **Patch path** — any `patches[].source` in the manifest contains the substring `trio/subsprint/<folder>/` — resolve the plan path as `<that folder>/<n>-subsprint-plan.md` and flip its checkbox.
2. **Audit path** — the caller invoked this skill with an explicit `subsprintPlan: <absolute-path>` input. If multiple subsprints motivated the audit, the caller must pick one.

If neither condition holds (e.g., a standalone human-triggered TC audit with no linked subsprint), do nothing — this skill was not invoked on behalf of a plan.

## Trailer format

```markdown
- [x] **Update Test Case** — `/trio:tc-management` (patch or audit path) — completed YYYY-MM-DD HH:MM by trio:tc-management
```

If the run concluded with no actual TC changes (e.g., decision=`skip`, or patch manifest empty after validation), flip to `[x]` with trailer ` — no change required`.

## Rules

- Only flip `Update Test Case`. Never touch `Execute Coding` or `Update Docs` — those belong to `/trio:subsprint-runner`.
- Never flip a `[x] N/A` entry back to `[ ]` — respect planner-declared exclusions. If the planner marked TC as N/A but the user dispatched this skill anyway, flip the N/A to `[x]` with trailer ` — N/A overridden; TC run completed <reason>` only if the user explicitly confirmed the override in this session.
- If the plan has no `## Execution Checklist` section (legacy / hand-written), skip silently and warn once.

# Step 3: Execution Reporting Contract (relay to caller of `trio:test-management`)

The TC docs produced here will be executed by `trio:test-management`. The report-side contract (enforced there):

## 3.1 Per-TC granularity

Each TC gets its own report entry — one entry per TC ID. **Batch lines are FORBIDDEN** (e.g. `TC-1.2-001 ~ TC-1.2-014: all passed`).

## 3.2 Evidence required for PASS

PASS is only legal with concrete evidence:
- **E2E**: screenshot path(s) + the exact selector / literal string asserted (matching Verification)
- **API**: HTTP method + path + response status + body excerpt
- **Unit / service**: test runner's test-ID output line

Any Verification item with no evidence → cannot be PASS.

## 3.3 Evidence for FAIL

- Observed state (screenshot / response body / stack trace)
- Which **Verification** item or **Forbidden State** was violated, quoted verbatim
- MUST NOT be rationalized as "normal behavior" / "expected given current state" / "environment issue" unless PRD or a linked ticket explicitly permits the deviation.

## 3.4 BLOCKED ≠ PASS

Cannot execute (missing seed data, broken dependency, env not ready) → **BLOCKED** with specific reason + required remediation. BLOCKED does NOT count toward PASS.

## 3.5 False-pass re-classification

When a bug is discovered in the field for behavior that a TC was meant to cover:
- Amend the TC's most recent execution entry to `"PASS (false-pass — bug <ID>)"`.
- Add the TC to the next run's "Needs hardening" list (see 1B.6 here).
- If the same executor or phrasing pattern repeatedly false-passes (e.g. "this is normal behavior"), flag it in the report's notes.

# Agents this skill dispatches

| Agent | Purpose | Key inputs |
|-------|---------|------------|
| `trio:tc-write` | Write/update TCs + automation scripts | project root, module, testMode, framework, decision, "Needs hardening" list |

# Patch manifest reference

The manifest is the sole input of the patch path. It is a YAML file living anywhere the caller chooses — for subsprint-driven flows, the conventional location is `trio/subsprint/<folder>/tc-patches.yml`.

## Schema

```yaml
patches:
  - testCaseId: TC-<X>.<Y>-<NNN>
    source: "<provenance string — free-form, but must point back to a plan task, bug ID, or audit finding>"
    operations:
      - op: <one of the allowed ops>
        content: |
          <markdown snippet OR code snippet, depending on op>
        verificationIndex: <int>     # required only for update-automation-assertion
        selector: "<string>"         # required only for add-selector
```

## Allowed operations (strengthen-only)

| op | Effect | Target sub-section of the TC |
|----|--------|------------------------------|
| `add-verification` | Append a new `Verification` bullet | `## Verification` |
| `add-forbidden-state` | Append a new `Forbidden States` bullet | `## Forbidden States` |
| `tighten-precondition` | Replace a `Preconditions` bullet with a stricter one (content is the full replacement) | `## Preconditions` |
| `update-automation-assertion` | Replace the N-th Assertion in the Automation block with a more specific one | `## Automation` → `Assertions` |
| `add-selector` | Add a new selector / test-id entry into the Automation block | `## Automation` → `Selectors / identifiers` |

## Forbidden operations (must use `decision=rewrite` instead)

- Removing any Verification / Forbidden State / Precondition item
- Loosening any condition (stricter→looser fails validation)
- Changing the TC's `> Test Mode (this run): ...` header
- Renumbering / renaming TC IDs
- Adding brand-new TCs (that's `decision=add`)

## Provenance is required

Every `patches[]` entry needs a non-empty `source`. This is how an auditor traces, months later, why TC-1.1-004 grew an extra Verification. Common patterns:

- `"trio/subsprint/12-2026-04-22-20-30/12-subsprint-plan.md#task-3"`
- `"docs/Test-Report/7-.../bugs.json#id=4"`
- `"manual: false-pass audit 2026-04-22, user approved"`

# Rules

- Test Mode declared BEFORE any folder alignment or TC generation (audit path only).
- Coverage check BEFORE writing — never write on top of unchecked state (audit path only).
- Never silently downgrade `framework-automated` → `ai-driven`. Patch path enforces this by refusing to rewrite the mode header.
- Never scaffold a new test framework unilaterally.
- Never dispatch `trio:tc-write` without the `module`, `testMode`, and `decision` fields (audit path) OR without `decision=patch` + `patches` (patch path).
- Contracts (`code-structure.md`) must exist — stop and direct to `/trio:tdd-management` if missing.
- **Patch path is strengthen-only.** Any op that removes or loosens a TC element is rejected at Step 0P.2. Weakening a TC is a conscious decision that belongs in `decision=rewrite`, where it's visible as a full regeneration.
- **Patch manifests require provenance.** A patch without `source` is rejected — drift without a trail is worse than no patch.
- **Subsprint plan checklist.** This skill owns only the `Update Test Case` box in a subsprint plan's `## Execution Checklist`. It flips that box exactly once per subsprint-driven run; it never touches `Execute Coding` or `Update Docs`; it never flips a `[x] N/A` back to `[ ]`.
