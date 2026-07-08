# Plan: MF — Integration Verification

**Milestone:** MF (FINAL) | **Dependencies:** M1, M2, M3, M4a, M4b, M5, M6, M7 (all complete) | **Risk:** Medium | **Effort:** Small
**Milestone def:** `docs/engineering-discipline/harness/forge-hammer-restructure/milestones/MF-integration-verification.md`

---

## Goal
Validate that all milestones compose into the brief's single-gate autonomous pipeline with no regressions — prove brief Success Criterion 1 end-to-end in CI. This is the final gate.

## Architecture
This is a **TEST-ONLY** milestone. It adds integration-level tests that drive the *already-shipped* runtime (M1–M7) through the whole forge→hammer chain with a scripted `runAgent` mock, plus a cross-file documentation-literal pin. No new runtime behavior is introduced; the tests assert that the existing seams compose.

The chain under test (all machinery already live):
- **Forge front half (M4a/M4b/M7):** clarification-drafted Goal Contract → `/goal` (empty) → non-trivial contract opens `goal-contract-panel` → 3 contract critics (`reviewer-feasibility`, `reviewer-architecture`, `reviewer-risk`) dispatched fresh+sandboxed in parallel → `parsePanelVerdictOutput` → `record_panel_verdict` ×3 → `isPanelApproved` → **single** post-convergence `ctx.ui.confirm` → `create_goal(gates:{panel,validator,review})` → `activate_goal_gated`.
- **Hammer loop (M5):** each turn runs one subgoal `runSubgoalWorkerCycle` — karpathy worker → fresh isolated `plan-validator` → `record_validator_receipt`; PASS ⇒ runtime `complete_target` + `validator_next` self-continuation; FAIL ⇒ next-turn worker re-dispatch with accumulated feedback; ≥3 ⇒ escalation halt.
- **Completion gate + review recycling (M6):** after the last subgoal, `runGoalLevelCompletion` drives the goal through `reviewer-verifier` PASS → opens `goal-review-panel` (round++) → parallel `security-reviewer` + `qa-reviewer` → all-PASS ⇒ `complete_target`; any FAIL ⇒ `Fix review finding:` subgoal(s) + `review_fix` continuation, fresh re-verify precedes every re-run; round > 3 ⇒ escalation.
- **Clarification defaults (M7/M3):** defensible defaults are recorded as `ASSUMPTION: `-prefixed values and surfaced in the contract; the three contract critics carry the identical `ASSUMPTION:` recognition rule.

## Tech Stack
- Vitest (`node scripts/run-vitest.cjs`), TypeScript `tsc --noEmit` for the build gate.
- Test file uses the established mock surface already at the top of `tests/goal-workflow.test.ts`: `vi.mock` of `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@mariozechner/pi-ai`, `../subagent.js` (`runAgent`), `../ui-settings.js`; helpers `createMockPi`, `mockGoalCtx`, `draftClarificationContract`, `flaggedChainMock`, `criticResult`, `verifierResult`.
- New literal-pin test reads files via `readFileSync(new URL("../<path>", import.meta.url), "utf-8")` — the exact pattern already used by `tests/skill-docs.test.ts:5` and `tests/agents.test.ts:172`.

## Work Scope
**The ONLY files that may change:**
- `extensions/agentic-harness/tests/goal-workflow.test.ts` — add the two integration chain tests (Tasks 1 & 2).
- `extensions/agentic-harness/tests/assumption-literal.test.ts` — **NEW** tiny file for the cross-file literal pin (Task 3). *Decision & rationale below.*

**NO production code changes.** If any chain test exposes a production bug, **STOP and report** — that is a corrective decision for the orchestrator, not an inline fix in this milestone.

### Decision: Task 3 lives in a new file `tests/assumption-literal.test.ts`
The cross-file check is a pure filesystem documentation pin (read four `.md` files, assert a literal). It has nothing to do with the heavily-mocked runtime chain in `goal-workflow.test.ts` (which `vi.mock`s five modules and never touches the real filesystem for docs). Co-locating a raw `readFileSync` doc-pin among the mocked chain tests would be incongruent and would drag doc-reading concerns into a runtime-behavior file. A dedicated 1-`describe` file mirrors the existing `tests/skill-docs.test.ts` / `tests/agents.test.ts` doc-pin convention exactly. The milestone explicitly permits this file. **Pinned: create `tests/assumption-literal.test.ts`.**

## Verification Strategy
Binary, command-driven. The single milestone command is:
```
cd extensions/agentic-harness && npm test && npm run build
```
Each task below also has a **scoped** command that runs only the new test(s) for fast iteration, plus a final full-suite + build + `git diff --stat` sanity gate (Task 4). Because every milestone's named test files live in the same `tests/` dir and run under the same `npm test`, a green full suite re-runs them all green (SC4).

## Success Criteria (verbatim from milestone MF)
- [ ] Full-chain integration case in tests/goal-workflow.test.ts (scripted runAgent mock; FRESH goal — frozen-gates policy): contract → panel APPROVE×3 → confirm asserted EXACTLY once → autostart → two subgoals worker→validator PASS via re-entrant continuations → goal verifier PASS → review both-PASS → goal `completed`; zero other user-input calls.
- [ ] Same chain with one injected validator-FAIL round and one review-FAIL round (incl. post-fix fresh verifier PASS) converges within the failure budget.
- [ ] Cross-file literal check: clarification SKILL.md + the three critic .md files contain the identical `ASSUMPTION:` literal.
- [ ] `cd extensions/agentic-harness && npm test && npm run build` passes in full; each milestone's named test files re-run green.

---

## Tasks

### Task 1 — Full-chain happy path (FRESH goal, ASSUMPTION field, confirm exactly once, zero other user-input)

**Where:** append a new `it(...)` inside the existing top-level `describe("clarify to goal workflow", ...)` block in `tests/goal-workflow.test.ts` (e.g. after the `mini-chain` test at ~line 1030), OR add a new sibling `describe("MF full-chain integration", ...)`. Either placement is fine; keep it in this file.

**Test name (suggested):** `"MF full-chain: fresh contract (with ASSUMPTION default) → panel APPROVE×3 → single confirm → 2 subgoals worker→validator PASS → verifier PASS → security+qa PASS → completed, zero other user-input"`

**Setup — FRESH goal with an ASSUMPTION:-prefixed field.** Do NOT reuse a run id from any other test (frozen-gates policy — a fresh `mkdtemp` cwd + fresh runId). The default 2-subgoal `draftClarificationContract(...)` is non-trivial, which is required to exercise the contract panel. To inject the ASSUMPTION field without disturbing the widely-shared helper, use a small **inline** contract draft in this test (mirror the body of `draftClarificationContract` at lines 1208–1230) with one field carrying the exact literal, e.g. `constraints: ["ASSUMPTION: no manual create step is required"]` and keep `suggestedSubgoals: ["Implement auto start", "Verify idempotency"]` (2 subgoals ⇒ non-trivial). Prefer inline over editing the shared helper so no other test's fixture shifts.
  - Define a test-local constant for the literal so the assertion is single-sourced: `const ASSUMPTION = "ASSUMPTION:";`
- Mock: `vi.mocked(runAgent).mockImplementation(flaggedChainMock());` — critics APPROVE, `plan-validator` PASS, `reviewer-verifier` PASS, `security-reviewer`/`qa-reviewer` PASS, worker returns the sentinel.
- `ctx = mockGoalCtx(cwd, runId)` (its `ui.confirm` resolves `true`).

**Drive the chain (re-entrant `/goal` turns, matching the mini-integration cadence at lines 1174–1200):**
```
await goal.handler("", ctx);   // turn 1: contract panel (3 critics) + single confirm + gated activation
await goal.handler("", ctx);   // turn 2: subgoal-1 worker→validator PASS → validator_next
await goal.handler("", ctx);   // turn 3: subgoal-2 worker→validator PASS → validator_next
await goal.handler("", ctx);   // turn 4: goal-level verifier PASS → review panel (security+qa) PASS → completed
```

**Assertions (all binary):**
- **Panel APPROVE×3:** after turn 1, the 3 dispatched critic names sorted `=== ["reviewer-architecture","reviewer-feasibility","reviewer-risk"]`; `goal-contract-panel` has exactly 3 APPROVE verdicts (`panel.verdicts.filter(v => v.verdict === "APPROVE")` length 3); `state.goals[0].gates` matches `{ panel: true, validator: true, review: true }`.
- **Confirm EXACTLY once across the WHOLE run:** assert `ctx.ui.confirm` mock call count `=== 1` after ALL four turns (not just after turn 1). This is the load-bearing single-gate assertion.
- **ASSUMPTION field survives:** load the clarification state and assert the persisted contract carries the literal, e.g. `clar.goalContract!.constraints.some(c => c.startsWith(ASSUMPTION))` is true (or `.join(" ").includes(ASSUMPTION)`).
- **Re-entrant continuations (validator_next):** after turn 2 and again after turn 3, `state.continuation.queued === true` and `state.continuation.reason === "validator_next"`; both subgoals end `status === "completed"`.
- **Verifier PASS then review both-PASS, ordered:** in turn 4 the dispatched agents include `reviewer-verifier`, and `indexOf("security-reviewer") > indexOf("reviewer-verifier")` and `indexOf("qa-reviewer") > indexOf("reviewer-verifier")`; `goal-review-panel` exists with `isPanelApproved(reviewPanel) === true` and `round === 1`; the goal has a verifier receipt with `verdict: "PASS"`.
- **Terminal state:** `state.goals[0].status === "completed"` and `state.status === "completed"`.
- **Zero other user-input calls:** `ctx.ui.confirm` count stays 1 (asserted above); assert no follow-up prompt or dispatched agent task references an `ask_user_question` round for THIS goal path — concretely, `mockPi.sendUserMessage.mock.calls` contains no call whose text includes `"ask_user_question"`, and the mock ctx exposes no other input method that was invoked. (The mock ctx has only `notify`/`setStatus`/`confirm`; there is no `ask` seam to call, so "zero other user-input" reduces to: confirm===1 AND no ask_user_question prompt emitted.)

**Acceptance command:**
```
cd extensions/agentic-harness && node scripts/run-vitest.cjs tests/goal-workflow.test.ts -t "MF full-chain"
```
**Pass = green, exit 0, the named test present and passing.** If `state.status !== "completed"` or `confirm` count ≠ 1 due to a runtime behavior (not a test-authoring error): **STOP and report** — do not modify production code.

---

### Task 2 — Failure-injection chain (one validator FAIL + one review FAIL, converges within budget)

**Where:** same file. Add a new `it(...)`, ideally inside/next to the existing `describe("M6 review panel recycling", ...)` block (its `reviewChainMock` is the closest sibling), or as a new `describe("MF failure-injection integration", ...)`.

**Test name (suggested):** `"MF failure-injection: one validator-FAIL round + one review-FAIL round still converge to completed within budget"`

**Setup — FRESH non-trivial goal.** Fresh `mkdtemp` cwd + fresh runId; `draftClarificationContract(cwd, runId, ctx)` (default 2 subgoals ⇒ non-trivial, so the contract panel runs — keeps this a true full-chain variant).

**Scripted stateful mock (extend the `reviewChainMock` pattern at lines 1037–1056).** Track two counters so exactly one validator FAIL round and exactly one review FAIL round occur, then everything converges:
```
let validatorCalls = 0;
let qaCalls = 0;
vi.mocked(runAgent).mockImplementation(async (o: any) => {
  if (o.agentName === "reviewer-feasibility" || o.agentName === "reviewer-architecture" || o.agentName === "reviewer-risk")
    return criticResult("APPROVE");
  if (o.agentName === "plan-validator") {
    validatorCalls += 1;
    // FAIL the FIRST validator round only (subgoal-1 attempt 1); PASS every subsequent round.
    return validatorCalls === 1
      ? verifierResult("Verdict: FAIL\nSummary: attempt 1\nBlockers:\n- validator-finding-A\nCommands Run:\n- npm test\nEvidence Checked:\n- none")
      : verifierResult("Verdict: PASS\nSummary: validated\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
  }
  if (o.agentName === "reviewer-verifier")
    return verifierResult("Verdict: PASS\nSummary: goal complete\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
  if (o.agentName === "security-reviewer")
    return verifierResult("VERDICT: PASS\nSummary: clean\nBlockers:\nFINDINGS:\n- [advisory] none");
  if (o.agentName === "qa-reviewer") {
    qaCalls += 1;
    // FAIL review round 1 only; PASS round 2.
    return qaCalls === 1
      ? verifierResult("VERDICT: FAIL\nSummary: review gap\nBlockers:\n- review-finding-B\nFINDINGS:\n- [blocking] review-finding-B")
      : verifierResult("VERDICT: PASS\nSummary: clean\nBlockers:\nFINDINGS:\n- [advisory] none");
  }
  return verifierResult("worker output"); // worker
});
```

**Drive the chain (turn count derived from the two injected failures; verify empirically):**
```
await goal.handler("", ctx);   // t1: contract panel + confirm + activation
await goal.handler("", ctx);   // t2: subgoal-1 cycle → validator FAIL A → worker re-dispatch queued (blocked, budget 1)
await goal.handler("", ctx);   // t3: subgoal-1 re-dispatch with feedback → validator PASS → validator_next
await goal.handler("", ctx);   // t4: subgoal-2 cycle → validator PASS → validator_next
await goal.handler("", ctx);   // t5: goal-level verifier PASS → review round 1 → qa FAIL → fix subgoal + review_fix
await goal.handler("", ctx);   // t6: fix subgoal worker→validator PASS
await goal.handler("", ctx);   // t7: fresh re-verify (2nd reviewer-verifier) → review round 2 → all PASS → completed
```
Note: the exact number of turns is a function of the runtime's re-entry cadence. Author the test, run it, and if convergence needs one more/fewer `/goal` turn, adjust the turn count to the observed cadence — the **acceptance is the terminal `completed` state**, not a hardcoded turn number. Do NOT change production code to fit a turn count.

**Assertions (all binary):**
- **Validator FAIL round happened:** subgoal-1 has a `validatorReceipts` entry with `verdict: "FAIL"` and blockers including `"validator-finding-A"`; the retry worker task included accumulated feedback (`workerCalls[1][0].task` contains `"validator-finding-A"` / `"Address these prior validator findings:"` per the M5 pattern at lines 887–891).
- **Within the failure budget:** `state.continuation.consecutiveFailures["subgoal-1"]` reset to 0 (or absent) after the PASS — never reached the 3-strike halt; no `"exhausted its 3-attempt failure budget"` follow-up was emitted.
- **Review FAIL round happened + recycled:** a `Fix review finding:` subgoal was materialized (title starts with `"Fix review finding:"`, objective contains `"review-finding-B"`); after the FAIL turn `state.continuation.reason === "review_fix"` and the goal was NOT completed at that point.
- **Post-fix fresh verifier PASS:** across the whole run, `reviewer-verifier` was dispatched at least twice (fresh re-verify before the 2nd review round), and the last `reviewer-verifier` index precedes the last `security-reviewer`/`qa-reviewer` indices (M6 ordering, mirrors lines 1096–1100).
- **Convergence:** `goal-review-panel` `round === 2`; `state.goals[0].status === "completed"`; `state.status === "completed"`.
- **Single gate preserved:** `ctx.ui.confirm` call count `=== 1` for the whole run (the failure loops never re-prompt the user).

**Acceptance command:**
```
cd extensions/agentic-harness && node scripts/run-vitest.cjs tests/goal-workflow.test.ts -t "MF failure-injection"
```
**Pass = green, exit 0.** A non-converging or over-budget result caused by runtime behavior ⇒ **STOP and report**.

---

### Task 3 — Cross-file ASSUMPTION literal pin (NEW file `tests/assumption-literal.test.ts`)

**Where:** create `extensions/agentic-harness/tests/assumption-literal.test.ts`.

**Intent:** pin that the M7 clarification skill and the three M3 contract critics all carry the identical `ASSUMPTION:` literal, so a future edit that drops or renames it in one place fails CI. Single source-of-truth constant in the test.

**Content (concrete):**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Single source of truth for the pinned literal shared across the clarification
// skill (M7) and the three contract critics (M3).
const ASSUMPTION_LITERAL = "ASSUMPTION:";

const FILES = [
  "../skills/agentic-clarification/SKILL.md",
  "../agents/reviewer-feasibility.md",
  "../agents/reviewer-architecture.md",
  "../agents/reviewer-risk.md",
] as const;

describe("MF: cross-file ASSUMPTION literal pin", () => {
  for (const rel of FILES) {
    it(`${rel} contains the pinned ${ASSUMPTION_LITERAL} literal`, () => {
      const text = readFileSync(new URL(rel, import.meta.url), "utf-8");
      expect(text).toContain(ASSUMPTION_LITERAL);
    });
  }
});
```
Notes:
- The `readFileSync(new URL("../…", import.meta.url))` pattern is exactly what `tests/skill-docs.test.ts:5` and `tests/agents.test.ts:172` use — path-robust regardless of vitest's cwd.
- Verified present at authoring time: `SKILL.md` (multiple sites incl. lines 118, 163), `reviewer-feasibility.md:10/26`, `reviewer-architecture.md:10`, `reviewer-risk.md:10/25`. The literal is `ASSUMPTION:` (word + colon); the M7 recording convention uses `ASSUMPTION: ` (trailing space) — pinning the colon-terminated form matches all four files.

**Acceptance command:**
```
cd extensions/agentic-harness && node scripts/run-vitest.cjs tests/assumption-literal.test.ts
```
**Pass = all 4 cases green, exit 0.**

---

### Task 4 — Final full suite + build + diff sanity (test-only)

**Run the milestone gate in full:**
```
cd extensions/agentic-harness && npm test && npm run build
```
Then the diff-scope sanity check from repo root:
```
git diff --stat
git status --porcelain
```

**Acceptance (all binary):**
- `npm test` exits 0, full suite green (previous baseline was 73 files / 811 tests per M6; this milestone adds ≥2 tests in `goal-workflow.test.ts` and a new 4-case file, so expect ≥ 74 files and a higher test count — every prior milestone's named test file re-runs green under the same command).
- `npm run build` (`tsc --noEmit`) exits 0, no type errors.
- `git diff --stat` shows changes ONLY under `extensions/agentic-harness/tests/` — precisely `tests/goal-workflow.test.ts` (modified) and `tests/assumption-literal.test.ts` (new). **Zero production files** (`index.ts`, `goal-state.ts`, `agents/*.md`, `skills/**`, `*.ts` non-test) appear. If any production file shows, STOP — a bug was patched inline, which is forbidden this milestone.
- Pre-existing unrelated dirty file `package-lock.json` (present at session start) is out of scope; note it but do not touch it.

---

## Rollback Plan
Every change is test-only and additive:
- Task 1 & 2: the added `it(...)` blocks in `goal-workflow.test.ts` can be reverted with `git checkout -- extensions/agentic-harness/tests/goal-workflow.test.ts` (no other test depends on them).
- Task 3: `rm extensions/agentic-harness/tests/assumption-literal.test.ts` (or `git clean`/`git checkout`) fully removes it.
- No production, schema, or fixture state is touched, so rollback cannot leave the runtime in a changed state. If a chain test surfaces a production bug, the correct action is **revert the test author's assumptions / STOP and report to the orchestrator**, not to weaken the assertion or patch production.

## Self-Review
- **Scope discipline:** only `tests/goal-workflow.test.ts` and the new `tests/assumption-literal.test.ts` change; Task 4's `git diff --stat` gate mechanically enforces this. The new-file decision is pinned with rationale (doc-pin vs mocked-runtime separation, mirrors existing doc-pin tests, explicitly permitted by MF).
- **No production changes / bug-surfacing protocol:** each runtime-driving task states that a failure caused by runtime behavior ⇒ STOP and report, never an inline fix.
- **Reuses established seams:** tests extend the exact mock helpers already proven by the mini-chain (lines 1004–1030) and mini-integration (lines 1174–1200) tests — `flaggedChainMock`, `reviewChainMock` pattern, `criticResult`, `verifierResult`, `mockGoalCtx`, `draftClarificationContract`. No new mock infrastructure invented.
- **FRESH-goal / frozen-gates policy:** both chain tests use a fresh `mkdtemp` cwd + unique runId, never resuming another test's persisted state.
- **Single-gate proof is load-bearing:** both chain tests assert `ctx.ui.confirm` count `=== 1` across the ENTIRE multi-turn run (not per-turn), which is the crisp expression of the brief's "single approval gate" and "zero other user-input" criteria.
- **Binary acceptance everywhere:** every task has an exact scoped command plus the final `npm test && npm run build` gate; the turn counts in Task 2 are explicitly declared adjustable-to-observed-cadence with the terminal `completed` state (not a turn number) as the real acceptance.
- **Risk noted:** Task 2's turn cadence is the one genuinely uncertain element (re-entry count depends on runtime scheduling). Mitigation: author, run, adjust turn count to observed cadence; if it cannot converge to `completed` within the documented failure budget, that is a real integration finding → STOP and report rather than force it.
