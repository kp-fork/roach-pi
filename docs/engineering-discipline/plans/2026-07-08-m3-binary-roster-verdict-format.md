# M3 — Binary-checklist agent roster + panel verdict-format contract

> **Worker note:** This is a documentation-and-contract milestone (agent `.md` bodies + one small TS module + tests). No reducer/runtime wiring — M3 is Wave-1, file-disjoint from M1/M7. Execute strictly in task order. Failing tests are written first (Task 0) and go green as each task lands. Do not flip a task's checkbox until its stated command passes. Do not claim completion while any checkbox remains open.

**Goal:** Reframe `reviewer-feasibility` / `reviewer-architecture` / `reviewer-risk` from holistic graded-scale reviewers into **binary contract-granularity critics** (feasibility / integration / coverage lenses adapted from glm-hammer, attacking a `ClarificationGoalContract`), add **`security-reviewer`** (C1–C7) and **`qa-reviewer`** (C1–C6 qa + folded implementation-critic fraud checks) as new goal-completion review agents, and create **`verdict-format.ts`** — the panel `APPROVE`/`REJECT` grammar constant plus a strict parser (`parsePanelVerdictOutput`) that both the `.md` bodies and the runtime consume. No reducer changes, no `index.ts` changes.

**Architecture:** The three existing reviewers **keep their pinned frontmatter names** (`reviewer-feasibility` / `reviewer-architecture` / `reviewer-risk`) but their bodies are rewritten to numbered binary checklists at **GOAL-CONTRACT granularity** — they attack a drafted `ClarificationGoalContract` (`objective` / `scope` / `nonGoals` / `successCriteria` / `constraints` / `evidenceRequired` / `risks` / `suggestedSubgoals`), **not** a task-level plan file. Lens mapping (from glm-hammer): `reviewer-feasibility` ≈ glm `feasibility-critic` (implementable against the real codebase, no invented decisions), `reviewer-architecture` ≈ glm `integration-critic` (composition, boundaries, shared state), `reviewer-risk` ≈ glm `coverage-critic` (requirement coverage, criteria decidability). Each critic keeps the glm C1..C6 numbered-binary-checklist + "unchecked is NO" + mechanical-AND-verdict mechanics **verbatim in spirit**, with item wording adapted from plan-granularity to contract-granularity. The contract critics emit `APPROVE`/`REJECT`; a new `verdict-format.ts` module owns that grammar (shared constant + `parsePanelVerdictOutput`), mirroring `goal-verifier.ts:88` (`parseGoalVerifierOutput`) but strict — malformed input returns `null`, never a silent default. `security-reviewer` and `qa-reviewer` are created new, scoped to changed code / goal-observable behavior, and emit `PASS`/`FAIL` — they run at goal completion and are parsed by the **existing** `Verdict: PASS|FAIL` grammar (`parseGoalVerifierOutput`), not by `verdict-format.ts` (which is panel `APPROVE`/`REJECT` ONLY, per decision #12). The runtime wiring that dispatches the panel and the review agents is out of scope here (M4b / M6); M3 delivers the vocabulary those milestones consume.

**Tech Stack:** TypeScript ESM (Pi extension), Vitest, hand-rolled frontmatter parser (`agents.ts` — no nested YAML; `tools` is a comma or bracket list). Agent bodies are Markdown after the `---` frontmatter block; `AgentConfig.systemPrompt` is the body, which is how tests read it (`loadAgentsFromDir` → `.systemPrompt`).

**Work Scope:**
- **In scope:** Rewrite 3 reviewer `.md` bodies to binary contract-critic checklists (names unchanged); create `security-reviewer.md` + `qa-reviewer.md`; create `verdict-format.ts` (panel APPROVE/REJECT constant + strict parser); add `tests/verdict-format.test.ts`; add additive assertions to `tests/agents.test.ts`. The `ASSUMPTION:` recognition rule in each of the 3 contract critics.
- **Out of scope:** Any change to `goal-state.ts` / `goal-events.ts` / `index.ts` / `goal-continuation.ts` / `goal-verifier.ts` (M1/M2/M4a/M4b/M5/M6 own those). Panel dispatch, `open_panel` / `record_panel_verdict`, `activate_goal_gated`, autostart wiring, review-panel runtime. Renaming any command or skill. Widening `parseGoalVerifierOutput` — security/qa reuse it unchanged. The glm `EVIDENCE_RECORDED:` on-disk-receipt convention (roach-pi persists verdicts via the reducer receipt + per-run artifact layers per brief Lens S — the M3 bodies emit the CHECKS/VERDICT/FINDINGS block and stop; they do NOT require an evidence-file write).

**Verification Strategy:**
- **Level:** test-suite + build (the same gate CI enforces on push to `main`).
- **Command:** `cd extensions/agentic-harness && npm test && npm run build`
- **Scoped iteration commands (during tasks):** `cd extensions/agentic-harness && npm test -- tests/verdict-format.test.ts tests/agents.test.ts`
- **What it validates:** agent frontmatter parses (names/tools), bundled roster pins hold, every reviewer body carries the mechanical binary-verdict rule + `VERDICT:` spec + (contract critics) the `ASSUMPTION:` rule and no graded scales, qa-reviewer carries the folded fraud checks, and the panel parser round-trips APPROVE/REJECT while erroring on malformed input, with a drift assertion pinning each contract critic's VERDICT line to the shared exported constant.

**Success Criteria (verbatim from milestone M3):**
- [ ] agents tests: pinned roster holds (three reviewer-* names unchanged; security-reviewer/qa-reviewer added; synthesis/reviewer-dependency/reviewer-user-value absent); every reviewer body contains the mechanical verdict rule ("unchecked is NO"; APPROVE/PASS iff every check YES or N/A) and the `VERDICT:` line spec; no graded scales; qa-reviewer contains the folded fraud checks (genuine bodies / no criteria-shaped hardcoding / tests can fail / no swallowed failures).
- [ ] agents tests: each contract-critic body contains the `ASSUMPTION:` recognition rule (assumption-marked defaults are valid content, not invented decisions/placeholders).
- [ ] new verdict-format tests: APPROVE fixture in the exact .md-prescribed format parses to APPROVE; REJECT to REJECT; malformed input errors; drift assertion pins each .md's VERDICT-line spec to the shared exported constant.
- [ ] `cd extensions/agentic-harness && npm test && npm run build` green.

---

## Key adaptations (the crux — read before writing any file)

### A1. Contract granularity, not plan granularity
The glm critics attack a **plan file** with numbered Tasks. The roach-pi contract critics attack a **`ClarificationGoalContract`** — a single object with fields `objective` / `scope` / `nonGoals` / `successCriteria[]` / `constraints[]` / `evidenceRequired[]` / `risks[]` / `suggestedSubgoals[]`. Every glm check that referenced "each Task / Modify list / Files field" is re-anchored onto these contract fields. The critic receives the drafted contract text **plus the original user request verbatim**, and re-verifies against the real codebase itself (it does not trust the contract, and it does not trust upstream recon or reasoning — glm Anvil rule).

### A2. Pinned names kept; bodies replaced
Frontmatter `name:` stays `reviewer-feasibility` / `reviewer-architecture` / `reviewer-risk` (the roster pin in `agents.test.ts:176-178` must keep passing). Only the body (systemPrompt) is rewritten. Frontmatter `tools:` becomes `read,find,grep,bash` (roach-pi lowercase convention — `find` not `glob`; `bash` added because C4-type checks run/verify commands). `description:` is updated to describe the binary contract critic.

### A3. Two verdict vocabularies, deliberately split (decision #12)
- **Contract critics** (feasibility/architecture/risk) → `APPROVE` / `REJECT`, owned by **`verdict-format.ts`** (`parsePanelVerdictOutput`, `PANEL_VERDICT_LINE`). These feed the M4b pre-activation panel.
- **security-reviewer / qa-reviewer** → `PASS` / `FAIL`, parsed by the **existing** `parseGoalVerifierOutput` (`goal-verifier.ts:88`, regex `/^Verdict:\s*(PASS|FAIL)\s*$/im`, case-insensitive so `VERDICT: PASS` on its own line matches). These feed the M6 goal-completion review panel. **State explicitly:** M3 does NOT wire their dispatch; it only guarantees their VERDICT line is grammar-compatible. `verdict-format.ts` scope is panel APPROVE/REJECT ONLY.

### A4. Strict parser, no silent default (contrast with the existing parser)
`parseGoalVerifierOutput` **defaults to FAIL** when no `Verdict:` line is found (`goal-verifier.ts:89`). `parsePanelVerdictOutput` must **NOT** default — malformed input (no `VERDICT:` line matching exactly one of `APPROVE`/`REJECT`, or both present) returns `null`. This is the load-bearing behavioral difference and is directly tested.

### A5. The `ASSUMPTION:` recognition rule (decision #9 + Round-1 concern)
Each of the 3 contract critics must contain a recognition rule stating that a contract line prefixed **`ASSUMPTION:`** is **valid clarified content the user accepted as a defensible default — a settled decision, NOT an invented decision, gap, or placeholder.** This resolves the Round-1 concern (assumption-marked defaults otherwise read as "invented decisions"/"placeholders" under the feasibility C5 and coverage C2 checks → false REJECT → panel deadlock → defeats the single-gate promise). The literal token `ASSUMPTION:` is cross-checked in M_final across `clarification` SKILL.md and these three `.md` files (decision #12), so the token must appear exactly as `ASSUMPTION:` in each contract critic body.

### A6. Shared mechanical-verdict literals (pinned by tests)
Every reviewer body must contain, verbatim so tests can substring-match:
- The "unchecked" rule: the literal **`unchecked is NO`**.
- The mechanical AND rule: **`APPROVE iff every check is YES or N/A`** (contract critics) / **`PASS iff every check is YES or N/A`** (security/qa).
- The VERDICT line spec: **`VERDICT: APPROVE | REJECT`** (contract critics, = `PANEL_VERDICT_LINE`) / **`VERDICT: PASS | FAIL`** (security/qa).
- **No graded scales:** contract critic bodies must NOT contain the old milestone-planning markers `Effort:`, `Feasibility risk:`, `Interface risks:`, `Severity: Low / Medium / High` as a *verdict* scale. (Finding-severity tags like `[high|critical]` on security findings are NOT a verdict scale and are allowed — scope the absence assertion to the 3 contract critics + the specific old markers, per Task 0.)

---

## The checklists to port (authoritative source: `/Users/roach/glm-hammer/agents/*.md`)

### `reviewer-feasibility` — feasibility lens, contract granularity — APPROVE/REJECT, C1–C6
> Single question: *could a worker with zero context deliver this contract's objective exactly as written, against the codebase as it exists right now?*
- **C1:** Does every file / module / path the contract names (in `objective`, `constraints`, `evidenceRequired`, `suggestedSubgoals`) exist on disk? (Grep/Read to confirm — never assume.)
- **C2:** Does every symbol / API / config-key the contract references exist in its stated location?
- **C3:** Does the contract rely only on capabilities (types, functions, commands, integrations) that exist in the codebase or are reachable with the stated tech stack — nothing invented?
- **C4:** Is every command named in `evidenceRequired` / `successCriteria` runnable in this project (test runner / script / path verified against `package.json` or equivalent)?
- **C5:** Is the contract free of decisions a worker would have to invent — `objective` and `suggestedSubgoals` contain no unresolved gap ("figure out X", "handle appropriately", missing wiring)? **A line prefixed `ASSUMPTION:` is a settled clarified default, NOT a gap.**
- **C6:** If `evidenceRequired` and `successCriteria` were all satisfied, would that actually prove the `objective` delivered (verification proves the goal)?

### `reviewer-architecture` — integration lens, contract granularity — APPROVE/REJECT, C1–C6
> Single question: *when the contract is decomposed and executed — some subgoals in parallel — do the pieces compose into a working whole?*
- **C1:** Are the `suggestedSubgoals` that could run in parallel free of shared-file / shared-module conflicts (no two independent subgoals mutating the same surface)?
- **C2:** Does every subgoal that consumes another subgoal's output declare or clearly imply an ordering/dependency (no missing edge)?
- **C3:** Do the `suggestedSubgoals` compose into an executable order — acyclic, each precondition produced before it is consumed?
- **C4:** Are the interface / type / symbol names the contract introduces internally consistent (a name in a `constraint` matches the one in the `objective`/subgoal — no `clearLayers` vs `clearFullLayers` drift)?
- **C5:** For every existing interface the contract changes, are existing external call sites accounted for (Grep them — will the change break callers no subgoal updates)?
- **C6:** Does the contract touch shared state (schema / migrations / config / global fixtures) only with a defined ordering, or does `nonGoals`/`scope` fence it — no unordered concurrent modification?

### `reviewer-risk` — coverage lens, contract granularity — APPROVE/REJECT, C1–C6
> Single question: *if this contract is delivered exactly as written, is the user's request fully covered — and can every success claim be verified without interpretation?*
- **C1:** Does every stated AND reasonably-implied requirement of the user's request map to a `successCriterion` or a `suggestedSubgoal` (nothing in `scope` left unaddressed)?
- **C2:** Is the contract free of placeholder text (TBD / TODO / "appropriate" / "handle edge cases" / prose where a decision belongs)? **A value prefixed `ASSUMPTION:` is a settled default, NOT a placeholder.**
- **C3:** Does the contract have a concrete `objective` and at least one `successCriterion`?
- **C4:** Is every `successCriterion` answerable met/not-met purely by reading code and running listed commands — zero interpretation ("works correctly" / "clean" / "fast" → NO)?
- **C5:** Does `evidenceRequired` declare, for each criterion, the verification (command / artifact) that decides it?
- **C6:** Would satisfying `evidenceRequired` genuinely exercise the `successCriteria` (not merely "it builds")?

### `security-reviewer` — changed-code attack surface — PASS/FAIL, C1–C7 (ported verbatim from glm `security-reviewer`)
> Runs at goal completion. Receives the goal's changed-file list + the contract. Reviews only the changed code and its immediate call boundaries — an attacker's read of the user's own project.
- **C1:** Is every path from untrusted input free of injection (SQL/NoSQL/shell/template/path/eval)?
- **C2:** Does every new endpoint/handler enforce the same authN/authZ its siblings enforce?
- **C3:** Is the change free of hardcoded secrets and of secrets written to logs?
- **C4:** Is the change free of new data exposure (stack traces to clients, PII in logs, whole-object serialization)?
- **C5:** Is all deserialization/parsing of untrusted input safe and bounded?
- **C6:** Is every new external input validated and limited (size/type/range) at its trust boundary?
- **C7:** Is the change free of crypto misuse and risky new dependencies?
- N/A when the changed code has no such surface. `PASS iff every check is YES or N/A`. `unchecked is NO`.

### `qa-reviewer` — QA behavior + folded fraud checks — PASS/FAIL, C1–C12
> Runs at goal completion. Receives the goal's changed-file list, `successCriteria`, and the verification command. Trusts nothing from the run; re-verifies. **C1–C6 = glm qa-reviewer; C7–C12 = folded glm implementation-critic fraud checks (user decision — implementation-critic is NOT a separate agent).**
- **C1:** Does the goal's verification command pass when YOU run it now?
- **C2:** Does the full test suite pass with zero regressions when YOU run it now?
- **C3:** Is every `successCriterion` observably met (traced or exercised, not assumed)?
- **C4:** Do the mainstream edge cases you exercised (empty / boundary / error-path inputs) behave sanely?
- **C5:** Do all existing callers of modified functions/endpoints still get what they expect?
- **C6:** Are existing tests unweakened, and do new tests cover both the happy path and plausible failure paths?
- **C7 (fraud — genuine bodies):** Does every new/modified function have a genuine body (no stubs, no fixed-value returns, no reachable `NotImplemented`)?
- **C8 (fraud — no criteria-shaped hardcoding):** Is the logic free of specialization to the listed tests' exact inputs (no magic constants matching fixtures, no test-only branches)?
- **C9 (fraud — tests can fail):** Can every new/modified test actually fail (real assertions, the unit under test not mocked away)?
- **C10 (fraud — no swallowed failures):** Is error handling free of broad catches that hide errors only to keep tests green?
- **C11 (fraud — reachable):** Is the new code reachable from real entry points (callers exist; added config/flags are read)?
- **C12 (fraud — files confinement):** Are all changes confined to the goal's declared changed-file surface?
- `PASS iff every check is YES or N/A`. `unchecked is NO`.

---

## `verdict-format.ts` module contract (new)

```ts
// extensions/agentic-harness/verdict-format.ts
export type PanelVerdict = "APPROVE" | "REJECT";
export type CheckStatus = "YES" | "NO" | "N/A";

// Shared literal pinned by the drift test into each contract critic .md body.
export const PANEL_VERDICT_LINE = "VERDICT: APPROVE | REJECT";

// The full output-format block the contract critic .md bodies prescribe.
export const PANEL_VERDICT_FORMAT: string; // CHECKS: / VERDICT: / FINDINGS: template

export interface ParsedPanelCheck { id: string; status: CheckStatus; evidence: string }
export interface ParsedPanelFinding { level: "REJECT-level" | "advisory"; text: string }
export interface ParsedPanelVerdict {
  verdict: PanelVerdict;
  checks: ParsedPanelCheck[];
  findings: ParsedPanelFinding[];
  rawOutput: string;
}

// Strict: returns null on malformed input (no VERDICT line matching exactly one of
// APPROVE|REJECT, or both present). NEVER silently defaults — contrast goal-verifier.ts:89.
export function parsePanelVerdictOutput(output: string): ParsedPanelVerdict | null;
```

Parsing rules:
- **Verdict (strict):** match `/^VERDICT:\s*(APPROVE|REJECT)\s*$/im`. Zero matches → `null`. Both an APPROVE line and a REJECT line present → `null`. Exactly one → that verdict.
- **Checks (best-effort):** each `- C<n>: YES|NO|N/A — <evidence>` line → `{id, status, evidence}`.
- **Findings (best-effort):** each `- [REJECT-level] …` / `- [advisory] …` line → `{level, text}`.
- `rawOutput` retains the full input.

---

## Task 0 — Baseline Lock (failing tests first)

**Dependencies:** None
**Files:**
- Create: `extensions/agentic-harness/tests/verdict-format.test.ts`
- Modify: `extensions/agentic-harness/tests/agents.test.ts` (additive only — anchor at the existing `it("bundled agents exclude removed milestone-planning-only agents", …)` block, `tests/agents.test.ts:171`)

- [ ] **Step 1 — Write `tests/verdict-format.test.ts` in full (imports `../verdict-format.js`, which does not exist yet).** Cover:
  - APPROVE round-trip: an all-YES `CHECKS:`/`VERDICT: APPROVE`/`FINDINGS:` fixture (exact `.md`-prescribed format) → `parsePanelVerdictOutput(...).verdict === "APPROVE"`, and `.checks` parsed with correct ids/statuses.
  - REJECT round-trip: a fixture with a `C_: NO` and `VERDICT: REJECT` + a `[REJECT-level]` finding → `.verdict === "REJECT"`, finding parsed.
  - Malformed → `null`: (a) no VERDICT line; (b) both an APPROVE and a REJECT line present; (c) verdict token neither APPROVE nor REJECT (`VERDICT: MAYBE`).
  - **Drift assertion:** read each of `agents/reviewer-feasibility.md`, `reviewer-architecture.md`, `reviewer-risk.md` via `loadAgentsFromDir(bundledDir, "bundled")` and assert `agent.systemPrompt.includes(PANEL_VERDICT_LINE)` for each. (Import `PANEL_VERDICT_LINE` from `../verdict-format.js`.)
- [ ] **Step 2 — Add additive assertions to `tests/agents.test.ts`.** Keep the existing block untouched; add a new `describe`/`it` that loads bundled agents (`loadAgentsFromDir(fileURLToPath(new URL("../agents/", import.meta.url)), "bundled")`) into a `name → systemPrompt` map and asserts:
  - Roster: `names` contains `reviewer-feasibility` / `reviewer-architecture` / `reviewer-risk` / `security-reviewer` / `qa-reviewer`; does NOT contain `synthesis` / `reviewer-dependency` / `reviewer-user-value` / `implementation-critic` / `feasibility-critic` / `integration-critic` / `coverage-critic` (glm source names not ported as roster entries).
  - Every reviewer body (`reviewer-feasibility`, `reviewer-architecture`, `reviewer-risk`, `security-reviewer`, `qa-reviewer`) contains `unchecked is NO`.
  - Contract critics (`reviewer-feasibility`/`architecture`/`risk`) contain `APPROVE iff every check is YES or N/A` and `VERDICT: APPROVE | REJECT`, and the `ASSUMPTION:` recognition rule (assert `.includes("ASSUMPTION:")` AND a recognition phrase, e.g. `not an invented decision`).
  - Contract critics contain NO graded scales: `.includes("Effort:")` false, `.includes("Feasibility risk:")` false, `.includes("Interface risks:")` false.
  - `security-reviewer` + `qa-reviewer` contain `PASS iff every check is YES or N/A` and `VERDICT: PASS | FAIL`.
  - `qa-reviewer` contains the folded fraud checks — assert substrings for all four named in the SC: `genuine body`, `criteria-shaped hardcoding`, `actually fail` (tests-can-fail), `swallowed failure`.
- [ ] **Step 3 — Run and confirm expected FAIL.** `cd extensions/agentic-harness && npm test -- tests/verdict-format.test.ts tests/agents.test.ts`
  - **Acceptance:** `verdict-format.test.ts` fails to import (`../verdict-format.js` missing) and the new `agents.test.ts` assertions fail (agents not yet rewritten/created). The pre-existing `agents.test.ts` roster block still passes. No OTHER test file is touched.

---

## Task 1 — `verdict-format.ts` module

**Dependencies:** Task 0
**Files:**
- Create: `extensions/agentic-harness/verdict-format.ts`

- [ ] **Step 1 — Implement the module** per the contract above: `PanelVerdict`, `CheckStatus`, `PANEL_VERDICT_LINE`, `PANEL_VERDICT_FORMAT`, `ParsedPanelCheck`, `ParsedPanelFinding`, `ParsedPanelVerdict`, `parsePanelVerdictOutput`.
- [ ] **Step 2 — Enforce strict verdict semantics:** null on zero VERDICT matches, null on both-APPROVE-and-REJECT, exactly-one otherwise. No default branch.
- [ ] **Step 3 — Run the parser tests green (drift still red).** `cd extensions/agentic-harness && npm test -- tests/verdict-format.test.ts`
  - **Acceptance:** the APPROVE/REJECT/malformed round-trip cases PASS. The drift assertion still FAILS (critic `.md` bodies not yet rewritten to contain `PANEL_VERDICT_LINE`) — this is expected and closes in Task 2. `npm run build` typechecks the new module clean.

---

## Task 2 — Rewrite the three contract critics (names unchanged)

**Dependencies:** Task 1
**Files:**
- Modify: `extensions/agentic-harness/agents/reviewer-feasibility.md`
- Modify: `extensions/agentic-harness/agents/reviewer-architecture.md`
- Modify: `extensions/agentic-harness/agents/reviewer-risk.md`

- [ ] **Step 1 — Rewrite each body** using the contract-granularity C1–C6 lists above. Each body MUST contain, verbatim: the lens intro (attacks a `ClarificationGoalContract`, receives it + the original user request, re-verifies against the real codebase and does not trust the contract); the six numbered `C1:`–`C6:` binary checks; the `ASSUMPTION:` recognition rule (§A5 — token `ASSUMPTION:` + "not an invented decision, gap, or placeholder"); the output-format block containing `PANEL_VERDICT_LINE` (`VERDICT: APPROVE | REJECT`); the mechanical rule `**VERDICT is mechanical: APPROVE iff every check is YES or N/A.**`; and the literal `unchecked is NO`.
- [ ] **Step 2 — Frontmatter:** keep `name:` unchanged (`reviewer-feasibility` / `reviewer-architecture` / `reviewer-risk`); set `tools: read,find,grep,bash`; update `description:` to describe the binary contract critic. Do NOT add an `EVIDENCE_RECORDED` section (§ Work Scope out-of-scope).
- [ ] **Step 3 — Remove all graded-scale content:** no `Effort:`, `Feasibility risk:`, `Interface risks:`, `Severity: Low / Medium / High` as verdict scales, no `**Name:**`/milestone-boundary output structure.
- [ ] **Step 4 — Run pinning tests.** `cd extensions/agentic-harness && npm test -- tests/agents.test.ts tests/verdict-format.test.ts`
  - **Acceptance:** the `verdict-format.test.ts` drift assertion now PASSES for all three; the `agents.test.ts` contract-critic assertions (mechanical rule, VERDICT line, ASSUMPTION rule, no graded scales) PASS. security/qa assertions still FAIL (agents not yet created).

---

## Task 3 — Create `security-reviewer` and `qa-reviewer`

**Dependencies:** Task 1 (grammar reference), Task 0 (assertions)
**Files:**
- Create: `extensions/agentic-harness/agents/security-reviewer.md`
- Create: `extensions/agentic-harness/agents/qa-reviewer.md`

- [ ] **Step 1 — `security-reviewer.md`:** frontmatter `name: security-reviewer`, `description:` (goal-completion changed-code security gate), `tools: read,find,grep,bash`. Body = the C1–C7 attack-surface checklist above, the mechanical rule `**VERDICT is mechanical: PASS iff every check is YES or N/A.**`, the literal `unchecked is NO`, the scope guard ("only review the changed code and what it touches"), and the output-format block with `VERDICT: PASS | FAIL`. No `EVIDENCE_RECORDED` section.
- [ ] **Step 2 — `qa-reviewer.md`:** frontmatter `name: qa-reviewer`, `description:` (goal-completion QA + fraud gate), `tools: read,find,grep,bash` (keeps `bash` — qa runs the verification command and full suite). Body = the C1–C12 checklist (C1–C6 qa, C7–C12 folded implementation-critic fraud, with the four SC-named phrases present: `genuine body`, `criteria-shaped hardcoding`, tests can `actually fail`, `swallowed failure`), the mechanical rule `**VERDICT is mechanical: PASS iff every check is YES or N/A.**`, the literal `unchecked is NO`, and the output-format block with `VERDICT: PASS | FAIL`.
- [ ] **Step 3 — Run pinning tests green.** `cd extensions/agentic-harness && npm test -- tests/agents.test.ts tests/verdict-format.test.ts`
  - **Acceptance:** both pinning files fully PASS — roster (5 present, 7 absent), all body-content substrings for all five agents, drift assertion, folded fraud checks.

---

## Task 4 (Final) — Full verification gate + diff sanity

**Dependencies:** Tasks 0–3
**Files:** none except fixes surfaced by this task.

- [ ] **Step 1 — Full suite + build.** `cd extensions/agentic-harness && npm test && npm run build`
  - **Acceptance:** entire suite green (71+ files), `tsc --noEmit` clean. No regression in any unrelated test file.
- [ ] **Step 2 — Diff sanity.** `git -C /Users/roach/.pi/agent/git/github.com/tmdgusya/roach-pi diff --stat`
  - **Acceptance:** changed files are EXACTLY: `verdict-format.ts` (new), `tests/verdict-format.test.ts` (new), `agents/security-reviewer.md` (new), `agents/qa-reviewer.md` (new), `agents/reviewer-feasibility.md` / `reviewer-architecture.md` / `reviewer-risk.md` (modified), `tests/agents.test.ts` (modified). **Zero** changes to `goal-state.ts` / `goal-events.ts` / `index.ts` / `goal-continuation.ts` / `goal-verifier.ts` / any skill `.md` (M3 is file-disjoint from M1/M7 in Wave 1 — a diff outside this list means scope leak).
- [ ] **Step 3 — Confirm all Success-Criteria checkboxes flip** (header list) and every task checkbox is closed.

---

## Rollback Plan

M3 is purely additive/rewrite of `.md` bodies + one leaf TS module + two test surfaces — no reducer, no runtime, no persisted-state shape. Rollback is `git checkout` of the eight files; nothing downstream is running yet (M4b/M6 consume this vocabulary but are later waves). If only part lands:
1. **`verdict-format.ts` + its tests pass but a critic rewrite regresses a pin:** keep the module (M4b needs it), revert only the offending `.md` to its prior body, re-run `tests/agents.test.ts`.
2. **A rewritten critic breaks the pre-existing roster block:** you renamed a `name:` — restore the exact `name:` frontmatter (the pin at `agents.test.ts:176-178` is non-negotiable) and rewrite only the body.
3. **Never ship** a state where `agents.test.ts` or `verdict-format.test.ts` is red — CI (`npm test && npm run build`) gates merge to `main`.

## Self-Review

- **Spec coverage:** All four M3 SCs are mapped — roster pins + body mechanics (Task 0 assertions → green Task 2/3), ASSUMPTION rule (Task 2), verdict-format round-trip + malformed + drift (Task 0/1/2), full gate (Task 4). The folded implementation-critic fraud checks land as qa C7–C12 with the four SC-named phrases asserted.
- **Verification strictness:** Failing-tests-first (Task 0), scoped green-ups per task, full `npm test && npm run build` + `git diff --stat` scope check at the gate. The drift assertion ties the `.md` VERDICT line to the exported constant, so a future edit to either side that diverges fails the build.
- **Boundary discipline:** `verdict-format.ts` is panel APPROVE/REJECT ONLY (decision #12); security/qa reuse the existing `parseGoalVerifierOutput` PASS/FAIL grammar unchanged; no reducer/runtime/skill files touched — M3 stays Wave-1 file-disjoint from M1 and M7.
- **Would a staff engineer approve?** The riskiest judgment call is adapting glm's plan-granularity checks to contract fields without losing the mechanical-binary spine; §"checklists to port" pins each C item to a named contract field so the rewrite is transcription, not reinvention. The `ASSUMPTION:` rule is the one semantic addition beyond glm and it directly closes a Round-1 concern.
