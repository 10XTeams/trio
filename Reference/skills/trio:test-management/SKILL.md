---
name: trio:test-management
description: Orchestrate test execution. Picks scope, computes the report number, enforces the ≥90% coverage gate, dispatches `trio:test-testcase-execution-agent` one sub-module at a time (persisting each return to disk), assembles `report.md` + `bugs.json` from the partials. **Stops at report assembly on failures — does NOT auto-chain into bugfix**; the user runs `/trio:subsprint-planner` next if they want. Owns the Bug schema v1.1 contract. Invoke when the user wants to execute tests.
---

You own test execution. Dispatch E2E to `trio:test-testcase-execution-agent` one sub-module at a time, persist partials to disk (survives context compaction), and assemble the final `report.md` + `bugs.json` yourself.

# Step 0: Preparation

## 0.1 List modules and let the user select

1. Scan `docs/Test-Case/` dynamically:
   - List all module folders (whatever numbered folder names exist, e.g. `1. <module>/`, `2. <module>/`)
   - List all sub-module files under each (e.g. `1. <sub-module>.md`)
   - Count test cases per file (`### TC-` headings)
2. Extract module number from folder prefix + sub-module number from file prefix.
3. Display to the user:

```
Select the modules to test (enter numbers, comma-separated for multi-select, or `all` for everything):

  <module#>. <module name>
     <module#>.<sub#> <sub-module name> (N cases)

Example inputs:
  1.1        — test a single sub-module
  1          — test an entire module
  1.1,2.2    — multiple sub-modules
  all        — test every module
```

4. Wait for the user. Do NOT proceed without a selection.

## 0.2 Resolve target modules

Parse into a list of sub-module identifiers (e.g. `1.1`, `1.2`, `2.1`). Module numbers expand to all sub-modules under the module folder. Read each target TC file.

## 0.3 Determine the report base name

Folder name format: **`<n>-MMDD-<word>`**. `<n>` is a 1-based integer incrementing across ALL historical runs. **Module / TC IDs MUST NOT appear in the folder name** — they go in `report.md`'s header.

1. Scan `docs/Test-Report/` for entries matching `^(\d+)-`.
2. Next `<n>` = max existing + 1 (start at `1` if none).
3. `MMDD` = current local month + day, zero-padded (e.g. `0422`).
4. `<word>` = pick uniformly at random from the word list below. Lowercase only.
5. Combine: `<n>-MMDD-<word>` (e.g. `5-0422-aurora`).

**Word list** (positive / exploratory / simple):

`aurora, beacon, bloom, breeze, canyon, cascade, compass, cove, crest, dawn, delta, ember, explorer, fern, forest, galaxy, garden, glacier, harbor, harmony, haven, horizon, journey, lantern, lark, lotus, lumen, meadow, meridian, mist, moonlight, mountain, nectar, oasis, orchard, pathway, peak, petal, pinnacle, pioneer, prism, quest, rainbow, reef, river, sail, seed, shore, sparrow, spark, spring, star, stream, sunrise, tide, trail, trek, vista, voyage, wander, willow, wonder, zenith`

## 0.4 Read code structure + locate test scripts

1. Read `docs/TDD/0.common/code-structure.md`: Frontend Route Map, Backend API Map, Feature Module ↔ Code Mapping.
2. **Discover test scripts** by scanning `code/` (any `test/`, `tests/`, `__tests__/`, `e2e/`, `test-script/`, `spec/` directory). Match to TC IDs via file header / comments / `docs/Test-Case/test-script-mapping.md` (if present).
3. **Cross-reference with PRD** — confirm the scripts cover the routes / endpoints / flows from PRD.
4. **Read test environment info**: test account file in `docs/TDD/0.common/` (or seed/fixtures under `code/`); confirm frontend + backend URLs.

## 0.5 Coverage gate (≥90% required)

1. **Count PRD flow branches** — for each selected module, count all Mermaid branches (each diamond `{}` with N outgoing edges = N branches).
2. **Count test cases** — all `### TC-` headings in target TC files.
3. **Count mappings** — read `test-script-mapping.md` (if present) and count TCs with at least one mapped script. If mapping file absent, scan `code/` for TC-ID references directly.
4. **Calculate**:
   ```
   coverage = (TCs with a script mapping) / (total TCs) × 100%
   ```

5. **Evaluate**:
   - **≥ 90%** — display summary, proceed to 0.6.
   - **< 90%** — **STOP**. Display:
     ```
     ⚠️ Test-script coverage is below threshold; cannot execute.

     === Coverage Check Result ===

     | Module | Total TCs | Covered | Coverage | Status |
     |--------|-----------|---------|----------|--------|
     | X. <name> | N | N | N% | ❌ insufficient / ✅ ok |

     Overall coverage: XX% (required ≥ 90%)

     Uncovered test cases:
       - TC-X.Y-NNN: <description>

     Run /trio:tc-management first to add missing test cases + script mappings, then retry once coverage is ≥ 90%.
     ```

## 0.6 Create the report folder

```
docs/Test-Report/<report-base-name>/
├── report.md              ← assembled in Step 2
├── bugs.json              ← assembled in Step 3 (only if failures exist)
└── screenshots/
    ├── TC-1.1-001.png     ← one per TC
    ├── TC-1.1-002.png
    └── TC-1.1-003-fail.png   ← failures also get a -fail.png
```

```bash
mkdir -p "docs/Test-Report/<report-base-name>/screenshots"
mkdir -p "docs/Test-Report/<report-base-name>/partials"
```

# Step 1: Dispatch execution — ONE sub-module at a time

Do NOT pass all sub-modules to a single dispatch. A single agent running >45 min (or >~30 cases) is the root cause of Playwright MCP stdio "disconnected" — by the time it returns, the pipe has dropped and Chromium `Singleton*` locks block the next launch.

**Dispatch one agent per sub-module sequentially AND persist each return to disk before the next dispatch.** Persisting lets you prune context-memory after each sub-module — so a full-module run is safe under auto-compaction.

## 1.1 Dispatch loop

For each resolved sub-module (sequential, NOT parallel):

1. Invoke the `Agent` tool with `subagent_type: "trio:test-testcase-execution-agent"` scoped to ONLY that one sub-module's test cases. Wait for return.
2. **Immediately on return, persist the structured result to `docs/Test-Report/<report-base-name>/partials/<sub#>.json`** — one file per sub-module (e.g. `partials/1.1.json`). Shape:

   ```json
   {
     "schemaVersion": "1.1",
     "subModule": "1.1",
     "subModuleName": "Employee Account Management",
     "continuationNeeded": false,
     "cases": [
       {
         "testCaseId": "TC-1.1-001",
         "result": "PASS",
         "severity": "P0",
         "actions": "...",
         "actualResult": "...",
         "screenshot": "screenshots/TC-1.1-001.png"
       },
       {
         "testCaseId": "TC-1.1-004",
         "result": "FAIL",
         "severity": "P1",
         "actions": "...",
         "actualResult": "...",
         "screenshot": "screenshots/TC-1.1-004.png",
         "bug": {
           "testCaseId": "TC-1.1-004",
           "module": "1. Authentication / 1.1 Employee Account Management",
           "severity": "P1",
           "summary": "Disabled account can still log in",
           "url": "http://localhost:5174/login",
           "reproSteps": ["Step 1: ...", "Step 2: ..."],
           "expectedResult": "...",
           "actualResult": "...",
           "screenshot": "screenshots/TC-1.1-004-fail.png",
           "decision": "Pending"
         }
       }
     ],
     "notes": "environment / data / anomaly notes"
   }
   ```

   Field order inside `cases[*]` and `cases[*].bug` is part of the contract — write in the order shown. Keys absent from the schema MUST NOT be emitted. Pre-schema partials from older runs (`id` instead of `testCaseId`, `priority` instead of `severity`, `failScreenshot` / `deviation` / `Decision`) are tolerated on read but never emitted by a fresh run.

3. If the sub-module returns `"continuationNeeded": true`, dispatch a follow-up agent for the remaining cases and **merge** its cases into the same `partials/<sub#>.json` before moving on.

4. **Prune working memory.** After persisting, discard per-case detail. A one-line ack ("sub-module 1.1 done, 15/15 passed, wrote partials/1.1.json") is enough. Step 2 and Step 3 re-read partials from disk.

Each dispatch's prompt carries:
- **Target test cases** — TC IDs for THIS sub-module + TC file path
- **Report folder** — absolute path; screenshots go into `<report>/screenshots/`
- **Environment** — frontend URL, backend URL, test-account file path
- **Test-script mapping** — E2E/API script paths + covered routes/APIs for this sub-module
- **PRD references** — PRD sub-module file path
- **Reminder** — agent must run Pre-flight (stale-lock cleanup) at start, Teardown (`browser_close`) at end. Both non-optional.

## 1.2 Handle outcomes

- Agent reports frontend/backend not running → STOP, tell user to start services. Do NOT proceed to Step 2. Leave any already-written `partials/*.json` in place.
- Otherwise → Step 2.

The agent does NOT write `report.md` or `bugs.json` — this skill does, by reading partials.

# Step 2: Generate Markdown report

**Read all `docs/Test-Report/<report-base-name>/partials/*.json`** (sorted by sub-module number). Assemble from them — do NOT rely on in-memory data.

Write to `docs/Test-Report/<report-base-name>/report.md`:

```markdown
# <Module name> — E2E Test Report

> Test Date: YYYY-MM-DD HH:MM
> Environment: <frontend URL> (Frontend) / <backend URL> (Backend)
> Tool: Playwright MCP
> PRD Reference: `docs/PRD/<module>/<sub-module>.md`
> Test Case Reference: `docs/Test-Case/<module>/<sub-module>.md`

## Summary

| Metric | Value |
|--------|-------|
| Total cases | N |
| Passed | N |
| Failed | N |
| Blocked / Skipped | N |
| **Pass rate** | **X%** |

| Category | Total | Passed | Failed |
|----------|-------|--------|--------|
| Happy path | N | N | N |
| Boundary / Edge case | N | N | N |
| Error handling | N | N | N |

## Bugs

> If no bugs were found, write: "No bugs found in this run."

| # | Test Case | Severity | Summary | Decision |
|---|-----------|----------|---------|----------|
| 1 | TC-X.X-XXX | P0 | Brief description | Pending |

## Detailed Results

### TC-X.X-001: <description>

- **Result**: PASS / FAIL
- **Priority**: P0 / P1 / P2
- **Actions**: <summary of what was actually executed>
- **Actual Result**: <what was observed>
- **Screenshot**: ![TC-X.X-001.png](screenshots/TC-X.X-001.png)

(if FAIL, add:)
- **Expected Result**: <verbatim from the TC>
- **Deviation**: <how the actual differed from expected>

## Notes

<observations, environment notes, test data notes>
```

Rules:
- Include ALL test cases, not just failures.
- Screenshots use relative paths from the report file: `screenshots/TC-X.X-XXX.png`.
- For multi-module runs, group results under module / sub-module headings.
- All paths relative to the report folder.

# Step 3: Generate JSON bug report

**Read all partials**; extract every case with `result == "FAIL"` → `bugs.json`.

Only generate this file if there are FAIL results. If all tests pass, skip and note in the markdown report.

## Bug schema v1.1 — stable contract

Every entry in `bugs.json → bugs[]` — and every `cases[*].bug` sub-object in `partials/<sub#>.json` — conforms to exactly this shape. This is a **stable, versioned contract**: producers (this skill + `trio:test-testcase-execution-agent`) MUST emit these fields, in this order, with these types. Consumers (`trio:bugfix-plan`, downstream triage) MUST NOT depend on any field outside this table.

| Field | Type | Required | Allowed values | How to derive |
|-------|------|----------|----------------|---------------|
| `id` | integer | yes | ≥ 1 | 1-based sequential within THIS `bugs.json`, assigned in sub-module traversal order (sorted by `subModule` ascending, then `cases[]` document order). **NOT stable across re-runs** — use `testCaseId` as the cross-run join key. |
| `testCaseId` | string | yes | matches `^TC-\d+\.\d+-\d+$` | From the TC heading `### TC-X.Y-NNN: ...`. Stable identifier. |
| `module` | string | yes | `"<module#>. <module name> / <sub#>. <sub-module name>"` | Derived from the TC file path — module folder name before ` / `, sub-module file stem after. |
| `severity` | string | yes | `P0` \| `P1` \| `P2` | Inherited from the TC's priority. No separate bug-priority field exists. |
| `summary` | string | yes | non-empty, ≤ 120 chars, no trailing punctuation | Description portion after `:` in `### TC-X.Y-NNN: <description>`, trimmed. Mechanically extracted from the TC title — stable across runs. |
| `subject` | string | yes (v1.1+) | non-empty, single line, **< 30 words**, no leading/trailing whitespace | **Generated at bug-record time** by the executing agent. A readable one-liner describing the *observed* failure (not the TC title). Example: `"Login form accepts a disabled account and routes to /dashboard."` Used by consumers as the human-facing headline. If a v1.0 file is read and `subject` is missing, consumers may fall back to `summary`. |
| `url` | string | yes | non-empty URL | Final URL at the moment of failure (NOT the starting URL). |
| `reproSteps` | string[] | yes | length ≥ 1, each entry prefixed `"Step N: "` | Steps the agent actually executed, in order. |
| `expectedResult` | string | yes | non-empty | Verbatim from TC's expected result. |
| `actualResult` | string | yes | non-empty | What was directly observed. No inferred causes — only witnessed behavior. |
| `screenshot` | string | yes | relative path under the report folder | Always the fail-specific screenshot `screenshots/<TC-ID>-fail.png`. |
| `decision` | string | yes | `Pending` \| `Accepted` \| `Rejected` \| `Duplicate` \| `WontFix` | Producers always emit `"Pending"`. Later triage updates in place; assembly re-runs MUST preserve non-`Pending` values. |

**Stability contract**:

- **Field set is closed.** Only the 12 fields above (v1.1). No extra keys. No null values for required fields — genuinely unknown → mark case `BLOCKED`, not `FAIL`.
- **Field order is part of the contract.** Diffs between `bugs.json` versions are semantic, not cosmetic.
- **Determinism.** Same partials on disk → running Step 3 twice produces byte-identical `bugs.json` except for summary counts when partials change.
- **Preserve triage state.** If `bugs.json` already exists (e.g., user re-executed failing cases), read old `bugs.decision` values keyed by `testCaseId` first; carry forward non-`Pending` decisions.
- **Casing is camelCase.** `decision`, not `Decision`. Older `"Decision"` files are read-compatible but rewrite as `"decision"`.
- **Evolution.** Adding a field or new enum → bump `schemaVersion` to the next minor (additive) or major (breaking) and document it here before any producer emits it. **History**: v1.1 added `subject` (readable < 30-word headline generated at bug-record time); v1.0 files without `subject` are read-tolerant — consumers fall back to `summary`.

## JSON structure

```json
{
  "schemaVersion": "1.1",
  "reportName": "<report-base-name>",
  "testDate": "YYYY-MM-DD HH:MM",
  "environment": {
    "frontend": "<frontend URL>",
    "backend": "<backend URL>"
  },
  "summary": {
    "totalCases": 0,
    "passed": 0,
    "failed": 0,
    "blocked": 0,
    "passRate": "0%"
  },
  "bugs": [
    {
      "id": 1,
      "testCaseId": "TC-1.1-004",
      "module": "1. Authentication / 1.1 Employee Account Management",
      "severity": "P1",
      "summary": "Disabled account can still log in",
      "subject": "Login form accepts a disabled account and routes to /dashboard instead of blocking the request.",
      "url": "http://localhost:5174/login",
      "reproSteps": [
        "Step 1: Open /login",
        "Step 2: Enter credentials for a disabled account",
        "Step 3: Click the login button"
      ],
      "expectedResult": "Show \"Account is disabled\" and remain on the login page",
      "actualResult": "Redirects to /dashboard; login succeeds",
      "screenshot": "screenshots/TC-1.1-004-fail.png",
      "decision": "Pending"
    }
  ]
}
```

## Assembly algorithm (deterministic)

```
1. existing = read bugs.json if present, else {}
2. bugs = []
3. for each partials/<sub#>.json sorted by numeric sub-module ascending:
     for each case in cases[] in document order:
       if case.result == "FAIL":
         bug = deep-copy case.bug           # Bug schema v1.1, verbatim
         bug.id = len(bugs) + 1             # assign here, nowhere else
         prior = existing.bugs find by testCaseId
         if prior and prior.decision != "Pending":
           bug.decision = prior.decision    # preserve human triage
         bugs.append(bug)
4. write { schemaVersion: "1.1", reportName, testDate, environment, summary, bugs }
   with keys in this exact order, and each bug's keys in the table's order.
```

Validate before writing: every bug has all 12 required fields (v1.1), every enum uses an allowed value, `screenshot` path exists on disk, `subject` is a single line ≤ 30 words. If validation fails, stop and report which bug + which field — do NOT emit a partially-valid file.

# Step 4: Report completion — STOP on failures

After all test cases are executed and reports are generated:

1. Print a summary table: pass/fail counts per module.
2. List bugs found with their severity.
3. Show the generated file paths.
4. **If there are failures**, tell the user:
   > "This run found N failures. Next step: run `/trio:subsprint-planner` → option 2 to turn the report into a subsprint plan (`source: bugfix`), then `/trio:subsprint-runner` to execute it."
5. **Do NOT auto-chain** into bugfix. The user explicitly runs `/trio:subsprint-planner` when ready.

# Agents this skill dispatches

| Agent | Purpose | Key inputs |
|-------|---------|------------|
| `trio:test-testcase-execution-agent` | E2E execution via Playwright MCP, one sub-module per dispatch | project root, TC list, absolute report folder, environment URLs, account file path, script mapping, PRD ref |

# Rules

- Execute TCs in document order.
- Do NOT skip TCs unless explicitly BLOCKED by environment issues.
- Screenshots for EVERY TC, not just failures.
- Report content is written in English. (Quoted identifiers — TC IDs, API endpoints, file paths, URLs, expected/actual strings verbatim from the TC — stay in their original form.)
- Credentials from `docs/TDD/0.common/` account file or `code/` seed/fixtures — NEVER hardcoded.
- Routes + endpoints from `docs/TDD/0.common/code-structure.md`.
- Scripts under whichever `code/*` directories actually exist — no fixed-path assumptions.
- App not running → STOP, instruct user to start services.
- Test data setup via API before execution when needed; clean up after when possible.
- Multi-module runs: complete one module before starting the next.
- **Partials on disk are the source of truth** — Steps 2 + 3 re-read from disk, never rely on chat memory.
- **Stop and notify on failures** — auto-chaining to bugfix is explicitly NOT the behavior.
