# M5 — Re-entrant worker→validator loop + goal-level ownership + 3-strike halt

> **Worker note:** Execute strictly in task order. **Task 0 is a SEAM CONFORMANCE CHECK, not a test-authoring task** — it produces a go/no-go note against the real code and does NOT redesign. This milestone WIRES the M2 validator machinery (`record_validator_receipt`, `GoalValidatorReceipt`, `bumpFailureBudget`, `assertValidatorCompletionInvariant`) into a re-entrant runtime loop; it does NOT edit any goal reducer/state/storage module (`goal-state.ts`, `goal-events.ts`, `goal-storage.ts`) — every primitive was delivered by M1/M2 and is CONSUMED here. If a step tempts you to add a reducer command or a state field, STOP: M5 is a **wiring/orchestration** milestone (like M4b). The one new module is `subgoal-validator.ts` (prompt/parse/receipt helpers only — no reducer surface). The continuation reason is a free-form `string` in `queue_continuation` (goal-state.ts:194), so the new self-continuation reason needs NO reducer change; the `GoalContinuationDecision` union lives in `goal-continuation.ts` (in scope). Files touched: `index.ts`, `goal-continuation.ts`, `skills/agentic-goal/SKILL.md`, NEW `subgoal-validator.ts`, `tests/goal-workflow.test.ts`, `tests/goal-continuation.test.ts`, `tests/skill-docs.test.ts`, NEW `tests/subgoal-validator.test.ts` — **nothing else**.

**Goal:** Implement draft-v4 decision #10 for `gates.validator` goals. Autostart now sets `gates.validator` on **every** auto-created goal (non-trivial: `{panel:true, validator:true}`; trivial: `{validator:true}` — the trivial escape is panel-only, decision #9). A **re-entrant runtime loop** dispatches a worker subagent to implement the active subgoal, then an **information-isolated** validator subagent (fresh context; receives the subgoal fields verbatim, NEVER the worker output) to judge it; the runtime applies `record_validator_receipt` + `complete_target` itself, then queues a **self-continuation** (new reason `validator_next`) whose orchestrator follow-up re-enters `/goal` next turn — for the next runnable subgoal AND, after the last, for goal-level completion (the existing verifier gate). The worker loop is the **sole retry driver** (accumulated verbatim feedback; NO `verifier_fail` follow-up for flagged subgoals; `buildVerifierFailureContinuationPrompt` branches on the flag). A **3-strike** budget halts with a blocker-summary escalation. Main-agent prompts for flagged goals are pinned orchestrator literals; unflagged/manual goals are byte-compatible.

**Architecture:** All runtime wiring lands in `index.ts` in the goal-command scope (`export default function (pi)`, index.ts:313), reusing the `runGoalVerifier` / `dispatchContractPanel` dispatch pattern (fresh context, sandbox block verbatim). The validator prompt/parse/receipt helpers live in a new pure module `subgoal-validator.ts`. The continuation policy (new `escalate` decision + flagged prompt branch) lives in `goal-continuation.ts`. No new command handler, no new tool, no new reducer command, no new state field.

**Tech Stack:** TypeScript ESM, Pi extension API (`@mariozechner/pi-coding-agent`), Vitest. No new runtime dependencies. New imports into `index.ts`: `buildSubgoalValidatorPrompt`, `parseSubgoalValidatorOutput`, `buildSubgoalValidatorReceipt` from `./subgoal-validator.js`; `GOAL_VALIDATOR_AGENT` and `buildGoalObjectiveHash` are already reachable via `./goal-state.js` (verify the existing import list). `subgoal-validator.ts` imports `parseGoalVerifierOutput` from `./goal-verifier.js` (reuse the existing PASS/FAIL grammar — milestone Notes: "Validator parsing uses the existing PASS/FAIL verifier grammar, NOT M3's panel module") and `GOAL_VALIDATOR_AGENT`, `buildGoalObjectiveHash`, `GoalValidatorReceipt`, `GoalItem`, `SubgoalItem` from `./goal-state.js`.

**Work Scope:**
- **In scope:** `index.ts` — gates.validator on both autostart forks; `buildGoalOrchestratorPrompt`, `buildSubgoalWorkerTask`, `runnableSubgoal`, `runSubgoalWorkerCycle`, `runGoalLevelCompletion`; post-activation follow-up fork; re-entry detection in the `autoStartGoalRuntime` tail. `goal-continuation.ts` — `escalate` decision, 3-strike branch in `planGoalContinuation`, `gates.validator` branch in `buildVerifierFailureContinuationPrompt`, an escalation prompt builder. NEW `subgoal-validator.ts`. `skills/agentic-goal/SKILL.md` — orchestrator who-implements language + manual-`/goal` recommendation for small tasks. The four test files.
- **Out of scope (do NOT touch):** `goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `goal-verifier.ts`, `verdict-format.ts`, every `agents/*.md` (including `agents/worker.md` and `agents/plan-validator.md` — the validator output format is driven by the PROMPT, not by editing the agent body), `discipline.ts` (`augmentAgentWithKarpathy` is CONSUMED, not modified), all clarification modules, the manual `/goal create→activate→complete` command branches (index.ts:2108-2185), `runContractPanelActivation`'s panel-dispatch mechanics (its `create_goal`/follow-up lines change; its panel loop does not), `runGoalVerifier`.

**Verification Strategy:**
- **Level:** test-suite + build (the exact gate CI enforces on push to main).
- **Command:** `cd extensions/agentic-harness && npm test && npm run build`
- **Scoped command (per-task iteration):** `cd extensions/agentic-harness && npm test -- <the task's test file(s)>`
- **What passing proves:** a flagged goal dispatches worker→validator per subgoal in that order; the validator is information-isolated (fresh context, subgoal fields verbatim, no worker sentinel); the runtime applies the receipt + completion itself and self-continues to the next subgoal and to goal-level completion with ZERO main-agent implement instructions; validator FAIL re-dispatches the worker with all accumulated feedback and is the sole retry driver; the 3-strike budget halts with a blocker summary; unflagged/manual goals and both continuation builders stay byte-compatible.

**Success Criteria** (verbatim from milestone M5):
- [ ] goal-workflow tests: flagged goal — worker then validator dispatch order per subgoal; runtime applies receipt + completion; a self-continuation re-enters for the NEXT subgoal and, after the last, drives goal-level completion (verifier gate) — the full flagged chain reaches goal `completed` (or review-pending post-M6) with ZERO main-agent implement instructions; unflagged goal keeps today's prompts byte-compatible (golden), incl. both continuation builders.
- [ ] **Isolation (call-site):** worker mock emits a sentinel string; the validator's runAgent args contain the subgoal objective/criteria/evidence verbatim, do NOT contain the sentinel, and use `contextMode:"fresh"`.
- [ ] goal-workflow tests: validator FAIL re-dispatches the worker with ALL prior verdict feedback and queues NO `verifier_fail` follow-up (exactly one retry driver); goal-level verifier FAIL routes blockers into fix subgoals via the loop (or escalates); flagged prompts contain the pinned orchestrator marker and NOT "Implement the current active subgoal"; a trivial-escape goal still requires validator PASS.
- [ ] goal-continuation tests (modify existing 265-line file): legacy line-152 no-budget case REPLACED by the 3-strike halt (via the validator dispatch path) with blocker-summary escalation.
- [ ] Mini-chain smoke: contract → panel ×3 APPROVE → confirm → autostart → subgoal worker→validator PASS → subgoal completed. Full suite + build green.

---

## Canonical literals (use these EXACT strings so pins line up)

| Token | Exact literal |
|---|---|
| Orchestrator marker (in `buildGoalOrchestratorPrompt` AND the flagged `buildVerifierFailureContinuationPrompt` branch) | `The runtime is implementing subgoals` |
| Forbidden in ALL flagged prompts (present ONLY in `buildGoalAutoPrompt`, the unflagged path) | `Implement the current active subgoal` |
| New self-continuation reason (`queue_continuation.reason`, free-form string) | `validator_next` |
| New `GoalContinuationDecision` action / reason (3-strike halt) | action `escalate`, reason `failure_budget_exhausted` |
| Subgoal-loop 3-strike escalation follow-up — lead line | `The worker→validator loop exhausted its 3-attempt failure budget without a PASS. Stop and summarize the unresolved blockers for the user:` |
| Goal-level 3-strike escalation (`planGoalContinuation`) — lead line | `The durable goal exhausted its 3-attempt failure budget. Stop the automatic runtime and summarize the unresolved blockers for the user:` |
| Validator prompt information-barrier lead (in `buildSubgoalValidatorPrompt`) | `You are an independent subgoal validator. You have NO knowledge of how the subgoal was implemented; judge only the codebase against the fields below.` |

**Failure budget cap:** `3`. `bumpFailureBudget` (M2, goal-state.ts:649) already increments `continuation.consecutiveFailures[targetId]` on each gated FAIL receipt and resets on PASS. M5 only READS that counter (`>= 3` ⇒ halt); it never writes it.

**Marker discipline:** every flagged main-agent-facing prompt (`buildGoalOrchestratorPrompt`, the flagged `buildVerifierFailureContinuationPrompt` branch, both escalation prompts) MUST contain `The runtime is implementing subgoals` OR be an escalation prompt (which instructs "Stop and summarize … for the user"), and MUST NOT contain `Implement the current active subgoal`. The ONLY prompt that keeps `Implement the current active subgoal` is `buildGoalAutoPrompt` (index.ts:1823), reached only by unflagged active goals.

---

## Design decisions pinned for this milestone (decision #10 adapted to the real seams)

- **Autostart sets `gates.validator` on both forks.** The non-trivial `create_goal` in `runContractPanelActivation` (index.ts:1865-1876) changes `gates: { panel: true }` → `gates: { panel: true, validator: true }`. The trivial `create_goal` in the `autoStartGoalRuntime` `if (!goal)` trivial fork (index.ts:1928-1938) changes from no `gates` → `gates: { validator: true }`. Nothing else about the trivial escape changes (still panel-free, still one universal fail-closed confirm). Consequence: EVERY auto-created goal is flagged; only the manual `/goal create` path (index.ts:2108-2117) stays ungated.

- **One worker→validator pair per `/goal` turn (turn boundaries preserved — decision #10).** The activation turn does panel/confirm/create/activate and sends the orchestrator follow-up, then RETURNS — it does NOT dispatch the worker in the same turn. The worker cycle runs on the NEXT `/goal` turn (re-entry), and each self-continuation drives exactly one more turn. This mirrors how M4b defers work across turns via `sendGoalContinuationFollowUp` and keeps mid-run visibility + compaction safety.

- **The trigger is `/goal` auto re-entry (mirrors M4b panel re-entry).** A self-continuation queues `continuation.queued = true` and sends `buildGoalOrchestratorPrompt`, whose text instructs the main agent to run `/goal` (no args). Next turn, `autoStartGoalRuntime` clears the continuation at entry (index.ts:1896-1898), finds the active flagged goal via `activeOrRunnableGoal`, and — in the tail — detects `gates.validator` + a runnable subgoal and runs the cycle. This is exactly the mechanism M4b uses to re-open the panel across turns; in tests it is driven by calling `goal.handler("", ctx)` again.

- **`runSubgoalWorkerCycle(ctx, state, goal, subgoal)`** (new helper in index.ts, defined near `runGoalVerifier`):
  1. `feedback = accumulatedValidatorFeedback(subgoal)` — the verbatim `summary`+`blockers` of every prior FAIL entry in `subgoal.validatorReceipts` (empty on the first attempt).
  2. **Worker dispatch:** `runAgent({ agent: augmentAgentWithKarpathy(agents.find(a => a.name === "worker")), agentName: "worker", task: buildSubgoalWorkerTask(goal, subgoal, feedback), contextMode: "fresh", sandbox: <the runGoalVerifier block verbatim>, cwd, depthConfig, makeDetails: makeDetails("single") })`. The worker's output is discarded (the validator never sees it).
  3. **Validator dispatch (information-isolated):** `runAgent({ agent: agents.find(a => a.name === GOAL_VALIDATOR_AGENT), agentName: GOAL_VALIDATOR_AGENT, task: buildSubgoalValidatorPrompt(goal, subgoal), contextMode: "fresh", sandbox: <same block> })`. `buildSubgoalValidatorPrompt` is built ONLY from persisted subgoal/goal fields — it MUST NOT receive any worker return value.
  4. Extract output (`isResultSuccess ? getFinalOutput(result.messages) : errorMessage||stderr||…`, `!isResultSuccess ⇒ verdict FAIL`, mirror `runGoalVerifier`), `parseSubgoalValidatorOutput`, `buildSubgoalValidatorReceipt(goal, subgoal, parsed, { id: \`validator-${Date.now()}\`, recordedAt })`, then `record_validator_receipt` via `applyGoalMutation`. M2's `bumpFailureBudget` fires inside the reducer (goal-state.ts:476) — do NOT count failures here.
  5. **PASS ⇒** `complete_target` (subgoal) via `applyGoalMutation` (assertValidatorCompletionInvariant is satisfied: latest validator PASS receipt + `validator_pass` ledger row + fresh `buildGoalObjectiveHash(goal, subgoal)` + no stale evidence/subgoal/completion after — the loop adds none), then queue `validator_next` self-continuation + `sendGoalContinuationFollowUp(buildGoalOrchestratorPrompt(state))` and RETURN.
  6. **FAIL ⇒** read `state.continuation.consecutiveFailures[subgoal.id]`; `>= 3` ⇒ `sendGoalContinuationFollowUp(buildSubgoalLoopEscalation(subgoal, state))` (blocker summary; NO self-continuation — the loop halts) and RETURN; else queue `validator_next` self-continuation + `sendGoalContinuationFollowUp(buildGoalOrchestratorPrompt(state))` and RETURN (next turn re-dispatches the worker with the now-larger accumulated feedback). No `verifier_fail` follow-up is ever sent for a flagged subgoal — the loop is the sole retry driver.
  - **Re-dispatch cadence pinned: NEXT turn** (not same turn). This keeps one worker+validator per turn, makes "re-dispatches with ALL prior feedback" observable across `goal.handler` calls, and cannot spin inside a single turn.

- **`runGoalLevelCompletion(ctx, state, goal)`** (new helper) mirrors the `case "complete"` goal path (index.ts:2148-2178) for the goal target: `request_completion(goal)` → `runGoalVerifier(ctx, …, "goal", goal.id)` → `record_verifier_result` → PASS ⇒ `complete_target(goal)`; then `maybeQueueGoalContinuation(ctx, state, receipt)`. Goal-level ALWAYS uses the verifier (not the validator) — decision #10 / milestone Notes. On PASS with no next target `planGoalContinuation` returns `none`; the goal reaches `completed`.

- **Tail of `autoStartGoalRuntime` (index.ts:1960-1971) forks on the flag.** Capture the pre-existing goal at entry (`activeOrRunnableGoal(state)`) so the tail can tell "just activated this turn" from "re-entry on an already-active goal":
  - A `queued` goal (trivial fork just created it, or a pre-existing queued goal) is activated (existing `activate_goal`), then the post-activation follow-up is sent and the function RETURNS: `sendPostActivationFollowUp(state, goal)` = `gates.validator ? buildGoalOrchestratorPrompt : buildGoalAutoPrompt`. (Deferring the first cycle to the next turn.)
  - An already-active goal (re-entry) with `gates.validator` ⇒ `return runFlaggedGoalTurn(ctx, state, goal)` where `runFlaggedGoalTurn` = `runnableSubgoal(goal) ? runSubgoalWorkerCycle(…) : runGoalLevelCompletion(…)`.
  - An already-active goal WITHOUT `gates.validator` ⇒ today's `buildGoalAutoPrompt` (byte-identical — the golden unflagged path).
  - `runnableSubgoal(goal)` = the subgoal matching `goal.activeSubgoalId`, else the first with status `active` or `blocked` (a validator FAIL leaves the subgoal `blocked` with `activeSubgoalId` intact, so it stays runnable for the retry). Same predicate `buildGoalAutoPrompt` already uses (index.ts:1807).

- **`runContractPanelActivation` step-10 fork.** Its final `sendGoalContinuationFollowUp(buildGoalAutoPrompt(state))` (index.ts:1892) becomes the orchestrator follow-up because the goal is now `gates.validator` — either call `sendPostActivationFollowUp(state, goal)` or inline the flagged branch. The panel loop, confirm, `activate_goal_gated`, and every M4b literal are otherwise UNTOUCHED.

- **`subgoal-validator.ts` (new, pure, no reducer surface):**
  - `buildSubgoalValidatorPrompt(goal: GoalItem, subgoal: SubgoalItem): string` — information-barrier lead (canonical literal), the subgoal `objective` + goal `successCriteria` + goal `evidenceRequired` verbatim inside untrusted-data fences (mirroring `buildGoalVerifierPrompt`'s `<objective>`/`<success_criteria>`/`<evidence>` framing, goal-verifier.ts:43-83), instructions to inspect the repo independently and judge the criteria, and the strict `Verdict: PASS|FAIL` / `Summary:` / `Blockers:` output format so the existing parser reads it. It MUST NOT reference any worker output.
  - `parseSubgoalValidatorOutput(output: string)` — thin re-use of `parseGoalVerifierOutput` (import from `./goal-verifier.js`); returns the same `{ verdict, summary, blockers, … }` shape.
  - `buildSubgoalValidatorReceipt(goal, subgoal, parsed, { id, recordedAt }): GoalValidatorReceipt` — constructs the M2 receipt shape: `targetType:"subgoal"`, `targetId: subgoal.id`, `objectiveHash: buildGoalObjectiveHash(goal, subgoal)`, `verdict`, `recordedAt`, `validatorAgent: GOAL_VALIDATOR_AGENT`, `summary`, `blockers`, `commandsRun`, `evidence`, `rawOutput`.

- **`goal-continuation.ts` — new `escalate` decision + flag branch.**
  - Extend `GoalContinuationDecision` with `{ action: "escalate"; reason: "failure_budget_exhausted"; targetType; targetId; blockers; prompt; leaseId }`.
  - In `planGoalContinuation`, AFTER the queued/subagent/team guards and BEFORE the `receipt.verdict === "FAIL"` branch: find the goal owning `receipt.targetId`; if it has `gates.validator` and `state.continuation.consecutiveFailures[receipt.targetId] >= 3`, return the `escalate` decision with a blocker summary (goal-level escalation lead line). `maybeQueueGoalContinuation` (index.ts:1671) already routes ANY non-`none` decision through `queue_continuation` + `sendGoalContinuationFollowUp` — an `escalate` decision flows through it unchanged (it carries `reason`/`prompt`/`leaseId` like a `follow_up`).
  - `buildVerifierFailureContinuationPrompt(state, receipt)`: branch on the target goal's `gates.validator`. Ungated ⇒ TODAY'S TEXT byte-for-byte (the "Continue working on the blockers … Do not claim complete" body). Gated ⇒ orchestrator wording containing the marker `The runtime is implementing subgoals` (blockers will be routed to fix subgoals / retried by the loop; "Run /goal … Do not implement or verify anything yourself"). NEVER contains `Implement the current active subgoal`.
  - `buildNextTargetContinuationPrompt` is UNTOUCHED (byte-identical — flagged subgoal PASS is handled by the worker cycle's own self-continuation, so this builder is only reached for unflagged/next-goal targets).

- **Goal-level fix-subgoal materialization is M6's job (scope boundary — flagged, not a blocker).** Decision #10 says goal-verifier FAIL blockers "become fix subgoals driven by the same loop, or 3-strike escalate." M5 delivers the concrete, testable half: the flagged orchestrator FAIL prompt + the 3-strike escalation (SC3's binary assertions are exactly the marker, the absence of `Implement the current active subgoal`, and the escalation). Materializing goal-level fix subgoals reuses M6's `review FAIL ⇒ fix subgoals` recycling machinery and is deferred there; M5 does not add a `create_subgoal` on goal-verifier FAIL. (See Scope Flags.)

---

## File Structure Mapping

**Create (source):** `extensions/agentic-harness/subgoal-validator.ts` — `buildSubgoalValidatorPrompt`, `parseSubgoalValidatorOutput`, `buildSubgoalValidatorReceipt`.

**Modify (source):**
- `extensions/agentic-harness/index.ts` — anchored by symbol:
  - imports (near index.ts:14-22): add the three `./subgoal-validator.js` symbols; confirm `GOAL_VALIDATOR_AGENT`/`buildGoalObjectiveHash` are on the `./goal-state.js` import.
  - `runContractPanelActivation` (index.ts:1832) — `create_goal` gates + step-10 follow-up fork.
  - `autoStartGoalRuntime` (index.ts:1895) — trivial-fork `create_goal` gates + tail fork (pre-existing capture, `runFlaggedGoalTurn`, `sendPostActivationFollowUp`).
  - new helpers near `runGoalVerifier` (index.ts:2015) / `buildGoalAutoPrompt` (index.ts:1805): `buildGoalOrchestratorPrompt`, `buildSubgoalWorkerTask`, `accumulatedValidatorFeedback`, `runnableSubgoal`, `runSubgoalWorkerCycle`, `runGoalLevelCompletion`, `buildSubgoalLoopEscalation`, `sendPostActivationFollowUp`, `runFlaggedGoalTurn`.
- `extensions/agentic-harness/goal-continuation.ts` — `GoalContinuationDecision` union; `planGoalContinuation` 3-strike branch; `buildVerifierFailureContinuationPrompt` flag branch; a goal-level escalation prompt builder.
- `extensions/agentic-harness/skills/agentic-goal/SKILL.md` — orchestrator who-implements language + manual-`/goal` recommendation.

**Modify (tests):** `tests/subgoal-validator.test.ts` (new), `tests/goal-workflow.test.ts`, `tests/goal-continuation.test.ts`, `tests/skill-docs.test.ts`.

**Must NOT change:** `goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `goal-verifier.ts`, `verdict-format.ts`, every `agents/*.md`, `discipline.ts`, all clarification modules, the manual `/goal` command branches, `runGoalVerifier`, `tests/agents.test.ts`, `tests/verdict-format.test.ts`, `tests/goal-state.test.ts`, `tests/goal-events.test.ts`, `tests/extension.test.ts`.

---

## Task 0 — Seam conformance check (go/no-go; NO code)

**Dependencies:** None
**Files:** None (read-only verification; record the note inline in the plan-execution log)

Verify the re-entrant design assumptions against the real merged code. Output is a **go/no-go note**, not a redesign — if every check is GO, proceed to Task 1; if any is NO-GO, STOP and flag to the orchestrator.

- [ ] **Check A — continuation reason is free-form (no reducer change).** `grep -n "queue_continuation" goal-state.ts` and confirm the command shape carries `reason: string` (goal-state.ts:190-197). GO if `reason` is `string` (so `validator_next` needs no reducer/type edit). NO-GO if it is a closed union in `goal-state.ts` → then the reason union would require a goal-state.ts edit (out of scope) — flag it.
- [ ] **Check B — the decision union is in an in-scope file.** `grep -n "GoalContinuationDecision" goal-continuation.ts` — confirm the union type is declared in `goal-continuation.ts` (it is, lines 9-19). GO: the new `escalate` action is an in-scope edit. NO-GO if it lives in `goal-state.ts`.
- [ ] **Check C — the runtime can apply the M2 primitives.** Confirm `record_validator_receipt` and `complete_target` are dispatchable via `applyGoalMutation` (they are `GoalCommand` variants, goal-state.ts:184-185) and that `assertValidatorCompletionInvariant` needs ONLY a latest validator PASS receipt + `validator_pass` ledger row + fresh `buildGoalObjectiveHash(goal, subgoal)` + no stale `evidence_added`/`subgoal_created`/`completion_requested` after (goal-state.ts:778-807). GO: the loop can `record_validator_receipt(PASS)` → `complete_target(subgoal)` with NO `request_completion` and NO evidence writes in between.
- [ ] **Check D — re-entry seam exists.** Confirm the `autoStartGoalRuntime` tail (index.ts:1960-1971) is reached on re-entry for an already-active goal (`activeOrRunnableGoal` returns it, the `if (!goal)` block is skipped, `goal.status === "queued"` is false, control reaches the final `buildGoalAutoPrompt`). GO: the tail is where `runFlaggedGoalTurn` hooks in. Confirm `runnableSubgoal` can find a `blocked` subgoal via `activeSubgoalId` (record_validator_receipt FAIL sets status `blocked` but leaves `activeSubgoalId`, goal-state.ts:473 + no reset).
- [ ] **Check E — the self-continuation re-triggers `/goal`.** Confirm `sendGoalContinuationFollowUp` delivers a follow-up user message (index.ts:1664-1670) that, in production, prompts the main agent to run `/goal`, and in tests is simulated by re-invoking `goal.handler("", ctx)` — the SAME mechanism M4b uses for panel re-entry (`buildGoalAutoPrompt` follow-up). GO.
- [ ] **Check F — dispatch primitives + agents in scope.** Confirm `runAgent`, `mapWithConcurrencyLimit`, `MAX_CONCURRENCY`, `getFinalOutput`, `isResultSuccess`, `makeDetails`, `parsedApprovalMode`, `piWritableRoots`, `depthConfig`, `discoverAgents`, `BUNDLED_AGENTS_DIR`, `augmentAgentWithKarpathy` are all in `index.ts` scope, and that agents `worker` and `plan-validator` (`GOAL_VALIDATOR_AGENT`) exist under `agents/` (`ls agents/worker.md agents/plan-validator.md`). GO.

**Acceptance:** all six checks GO (expected — the seams were verified during planning). The go/no-go note records that `validator_next` needs no reducer change, the `escalate` decision is an in-scope `goal-continuation.ts` edit, and the re-entry tail + M2 primitives support the loop. Any NO-GO is escalated to the orchestrator before Task 1.

---

## Task 1 — `subgoal-validator.ts` module + unit tests

**Dependencies:** Task 0
**Files:** Create `subgoal-validator.ts`, `tests/subgoal-validator.test.ts`

Author `tests/subgoal-validator.test.ts` first (failing), then the module.

- [ ] **Step 1 — Tests (failing).** In the new test file, build a `GoalItem`/`SubgoalItem` fixture (objective, successCriteria, evidenceRequired). Assert:
  - `buildSubgoalValidatorPrompt(goal, subgoal)` contains the information-barrier lead literal `You are an independent subgoal validator. You have NO knowledge of how the subgoal was implemented; judge only the codebase against the fields below.`, contains the subgoal `objective`, each `successCriteria` entry, each `evidenceRequired` entry verbatim, and the strict output line `Verdict: PASS|FAIL`; and does NOT contain the words "worker" output/sentinel (no worker-derived text).
  - `parseSubgoalValidatorOutput("Verdict: PASS\nSummary: done\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok")` → `verdict: "PASS"`; a no-`Verdict:` string → `verdict: "FAIL"` (parser defaults FAIL, matching `parseGoalVerifierOutput`).
  - `buildSubgoalValidatorReceipt(goal, subgoal, parsed, { id: "v1", recordedAt: "2026-…" })` → `{ targetType: "subgoal", targetId: subgoal.id, validatorAgent: "plan-validator", verdict, objectiveHash: buildGoalObjectiveHash(goal, subgoal), recordedAt: "2026-…" }` (assert `objectiveHash` equals a locally computed `buildGoalObjectiveHash(goal, subgoal)`).
- [ ] **Step 2 — Module.** Implement the three exports (see Design). `parseSubgoalValidatorOutput` = `parseGoalVerifierOutput` re-used. `buildSubgoalValidatorReceipt` fills the M2 `GoalValidatorReceipt` shape.
- [ ] **Step 3 — Verify.** `cd extensions/agentic-harness && npm test -- tests/subgoal-validator.test.ts` green; `npm run build` clean.

**Acceptance:** the three helpers exist and are unit-proven; the receipt objectiveHash matches `buildGoalObjectiveHash(goal, subgoal)`; the validator prompt contains the subgoal fields verbatim and the strict PASS/FAIL grammar; no `index.ts` wiring yet.

---

## Task 2 — `goal-continuation.ts`: 3-strike escalation + flagged FAIL branch; replace the legacy no-budget test

**Dependencies:** Task 0
**Files:** Modify `goal-continuation.ts`, `tests/goal-continuation.test.ts`

- [ ] **Step 1 — Replace the legacy line-152 test (failing until Step 3).** In `tests/goal-continuation.test.ts`, DELETE `it("keeps retrying after repeated failures without a max failure budget", …)` (lines 152-169) and REPLACE with `it("halts with a blocker-summary escalation after the 3-strike failure budget (validator path)", …)`: build a GATED goal (`gates: { validator: true }`) with a subgoal; record THREE `record_validator_receipt` FAILs for the subgoal (each bumps `consecutiveFailures[subgoal-1]` via M2's `bumpFailureBudget`); build a subgoal-target verifier-shaped receipt (`getGoalVerifierTarget(state, "subgoal", "subgoal-1")` + `parseGoalVerifierOutput("Verdict: FAIL…")`), then assert `planGoalContinuation(state, receipt, rootContext())` returns `{ action: "escalate", reason: "failure_budget_exhausted", targetType: "subgoal", targetId: "subgoal-1" }` and its `prompt` contains the blocker summary. (Use `applyGoalCommand` directly — this is a pure-reducer/policy unit test, no `runAgent`.)
- [ ] **Step 2 — Golden guard for the unflagged builders.** Add `it("keeps ungated verifier-fail and next-target prompts byte-identical (golden)", …)`: for an UNGATED goal, assert `buildVerifierFailureContinuationPrompt` still contains `Continue working on the blockers` and `Do not claim complete`, and does NOT contain `The runtime is implementing subgoals`; and `buildNextTargetContinuationPrompt` still emits `Next subgoal:` / `Next goal:` unchanged. (The existing `it("sends a FAIL follow-up with blockers")` and next-target tests remain untouched and are part of this golden.)
- [ ] **Step 3 — Policy code.** In `goal-continuation.ts`:
  - Extend `GoalContinuationDecision` with the `escalate` variant (Design).
  - In `planGoalContinuation`, after the existing guards (lines 26-29) and before the FAIL branch (line 31): resolve the target's goal via `findTarget`; if `goal.gates?.validator === true && (state.continuation.consecutiveFailures[receipt.targetId] ?? 0) >= 3`, return the `escalate` decision (blockers = `receipt.blockers.length ? receipt.blockers : [receipt.summary]`, prompt = a new `buildFailureBudgetEscalationPrompt(state, receipt)` using the goal-level escalation lead line, `leaseId = buildContinuationLeaseId(state, receipt, "escalate")`).
  - Branch `buildVerifierFailureContinuationPrompt` on the target goal's `gates.validator` (Design): ungated → today's exact text; gated → orchestrator text with the marker `The runtime is implementing subgoals`, NEVER `Implement the current active subgoal`.
  - `buildNextTargetContinuationPrompt` unchanged.
- [ ] **Step 4 — Verify.** `cd extensions/agentic-harness && npm test -- tests/goal-continuation.test.ts` green; `npm run build` clean. Confirm the four pre-existing continuation tests (FAIL follow-up, PASS next-target ×2, lease/subagent guards) still pass byte-for-byte.

**Acceptance:** the legacy no-budget test is replaced by the 3-strike escalation (via the validator dispatch path); the escalate decision surfaces a blocker summary; unflagged builders are byte-identical; `buildNextTargetContinuationPrompt` untouched.

---

## Task 3 — `index.ts` gating + orchestrator prompts (NO loop yet); rewrite M4b transitional auto-prompt assertions

**Dependencies:** Tasks 0-2
**Files:** Modify `index.ts`, `tests/goal-workflow.test.ts`

Set the flag and the activation-turn follow-up; the worker cycle arrives in Task 4. This isolates the gating blast radius (the M4b auto-prompt assertions) from the loop engine.

- [ ] **Step 1 — Imports.** Add `buildSubgoalValidatorPrompt`, `parseSubgoalValidatorOutput`, `buildSubgoalValidatorReceipt` from `./subgoal-validator.js`; ensure `GOAL_VALIDATOR_AGENT` and `buildGoalObjectiveHash` are imported from `./goal-state.js`.
- [ ] **Step 2 — Gate the non-trivial goal.** In `runContractPanelActivation` (index.ts:1865-1876) change `gates: { panel: true }` → `gates: { panel: true, validator: true }`.
- [ ] **Step 3 — Gate the trivial goal.** In the `autoStartGoalRuntime` trivial fork `create_goal` (index.ts:1928-1938) add `gates: { validator: true }`.
- [ ] **Step 4 — Orchestrator prompt + post-activation fork.** Add `buildGoalOrchestratorPrompt(state)` (Design; contains `The runtime is implementing subgoals`, instructs "Run /goal" and "Do not implement … yourself", NO `Implement the current active subgoal`). Add `sendPostActivationFollowUp(state, goal)` = sets `currentPhase = "goal_active"` then sends `goal.gates?.validator ? buildGoalOrchestratorPrompt(state) : buildGoalAutoPrompt(state)`. Use it in `runContractPanelActivation` step-10 (replace index.ts:1891-1892) and in the `autoStartGoalRuntime` tail queued→activate branch (replace index.ts:1969-1970). The already-active re-entry path still falls to `buildGoalAutoPrompt` for now (Task 4 adds the flagged fork).
- [ ] **Step 5 — Add `buildSubgoalWorkerTask` (defined, unused until Task 4).** `buildSubgoalWorkerTask(goal, subgoal, feedback: string[])` serializes the subgoal `objective`, goal `successCriteria`/`constraints`/`evidenceRequired` verbatim, and — when non-empty — an "Address these prior validator findings:" block of the accumulated feedback verbatim. (Adding it now keeps Task 4 focused on wiring.)
- [ ] **Step 6 — Rewrite the M4b transitional auto-prompt assertions.** In `tests/goal-workflow.test.ts`:
  - `it("auto-creates and activates latest drafted Goal Contract with /goal")` (:117): the post-activation follow-up is now the orchestrator prompt. REPLACE the `autoPrompt` assertions (lines 148-155) with: `expect(autoPrompt).toContain("The runtime is implementing subgoals")`, `expect(autoPrompt).not.toContain("Implement the current active subgoal")`, and `expect(state.goals[0].gates?.validator).toBe(true)`. Keep the status/activeGoalId/subgoal/critic/gates.panel/confirm assertions.
  - `it("dispatches the full 3-critic panel and activates only via activate_goal_gated after convergence")` (:186): REPLACE the follow-up assertion (lines 211-214) `stringContaining("until the entire active goal is complete")` with `stringContaining("The runtime is implementing subgoals")`; add `expect(state.goals[0].gates?.validator).toBe(true)`.
- [ ] **Step 7 — Verify.** `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts` green; `npm run build` clean. The re-entry/round/restart/escalate panel tests (:161 second turn is a no-op today, :280, :307, :342) still pass because the worker cycle is not wired yet; the trivial/byte-identity/completion tests still pass (gates.validator on a goal target does not gate goal-level completion, which stays on the verifier).

**Acceptance:** every auto-created goal carries `gates.validator`; the activation-turn follow-up is the orchestrator prompt for flagged goals (marker present, forbidden literal absent); the two rewritten M4b assertions are green; no worker cycle runs yet.

---

## Task 4 — `index.ts` re-entrant worker→validator loop engine

**Dependencies:** Task 3
**Files:** Modify `index.ts`, `tests/goal-workflow.test.ts`

Wire the loop. After this task `/goal` re-entry on an active flagged goal runs the cycle.

- [ ] **Step 1 — Helpers.** Add near `runGoalVerifier` (index.ts:2015): `accumulatedValidatorFeedback(subgoal)` (verbatim `summary`+`blockers` of every FAIL `validatorReceipts` entry), `runnableSubgoal(goal)` (Design predicate), `runSubgoalWorkerCycle(ctx, state, goal, subgoal)` (Design steps 1-6: augmented worker dispatch, isolated validator dispatch, `record_validator_receipt`, PASS ⇒ `complete_target` + `validator_next` self-continuation + orchestrator follow-up, FAIL ⇒ 3-strike read → escalation OR `validator_next` self-continuation + orchestrator follow-up), `buildSubgoalLoopEscalation(subgoal, state)` (subgoal-loop escalation lead line + accumulated FAIL blockers), `runGoalLevelCompletion(ctx, state, goal)` (mirror the goal-path of `case "complete"`; verifier gate + `maybeQueueGoalContinuation`), `runFlaggedGoalTurn(ctx, state, goal)` = `runnableSubgoal(goal) ? runSubgoalWorkerCycle(…) : runGoalLevelCompletion(…)`.
  - Worker + validator `runAgent` calls use `contextMode: "fresh"` and the `runGoalVerifier` sandbox block verbatim; worker agent = `augmentAgentWithKarpathy(agents.find(a => a.name === "worker"))` with `agentName: "worker"`; validator agent = `agents.find(a => a.name === GOAL_VALIDATOR_AGENT)` with `agentName: GOAL_VALIDATOR_AGENT`. Wrap each dispatch's output extraction like `runGoalVerifier` (non-success ⇒ FAIL).
  - The self-continuation is `applyGoalMutation({ type: "queue_continuation", targetType: "subgoal", targetId: subgoal.id, reason: "validator_next" })` (reason is a free-form string — Task 0 Check A).
- [ ] **Step 2 — Tail fork.** In `autoStartGoalRuntime`, capture `const preexisting = activeOrRunnableGoal(state)` at entry. In the tail: the queued→activate branch keeps `sendPostActivationFollowUp` (Task 3). Add, for an already-active goal (the `preexisting` re-entry case): `if (goal.gates?.validator) return await runFlaggedGoalTurn(ctx, state, goal);` BEFORE the final `buildGoalAutoPrompt` (which now serves only unflagged active goals).
- [ ] **Step 3 — Update the idempotency test.** `it("does not duplicate a goal when /goal is repeated for the same contract")` (:161) does TWO `/goal` turns; the second is now a worker cycle, not a panel no-op. Change the mock to `vi.mocked(runAgent).mockImplementation(async (o: any) => o.agentName === "reviewer-feasibility" || o.agentName === "reviewer-architecture" || o.agentName === "reviewer-risk" ? criticResult("APPROVE") : o.agentName === "plan-validator" ? verifierResult("Verdict: PASS\nSummary: ok\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok") : verifierResult("worker done"))`. Keep `expect(state.goals).toHaveLength(1)` and `panel.round === 1`; REPLACE `expect(runAgent).toHaveBeenCalledTimes(3)` with `toHaveBeenCalledTimes(5)` (3 critics turn 1 + worker+validator turn 2) and assert the second subgoal is still active / the goal is not duplicated.
- [ ] **Step 4 — Verify.** `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts` green; `npm run build` clean. The panel re-entry/round/restart/escalate tests (:280, :307, :342) still pass (their activation turn defers the cycle; they never re-enter an active goal).

**Acceptance:** `/goal` re-entry on an active flagged goal runs exactly one worker→validator pair (or goal-level verifier when no subgoal is runnable); PASS applies receipt+completion and self-continues; FAIL self-continues (below budget) or escalates (≥3); the idempotency test reflects the new second-turn cycle; `npm run build` clean.

---

## Task 5 — goal-workflow tests: flagged chain, dispatch order, isolation, golden

**Dependencies:** Task 4
**Files:** Modify `tests/goal-workflow.test.ts`

Add a flagged-goal mock builder and the SC1/SC2 assertions. Suggested helper: `flaggedChainMock(sentinel)` returning a `mockImplementation` keyed on `agentName` — critics APPROVE, `worker` returns `verifierResult(sentinel)`, `plan-validator` returns a `Verdict: PASS` block, `reviewer-verifier` returns a `Verdict: PASS` block.

- [ ] **Step 1 — Dispatch order per subgoal.** `it("dispatches worker then validator per subgoal for a flagged goal", …)`: default 2-subgoal (non-trivial) contract; turn 1 `/goal` (panel+activate), turn 2 `/goal` (subgoal-1 cycle). Assert the turn-2 `runAgent` calls in order are `agentName: "worker"` then `agentName: "plan-validator"` (filter `mock.calls` after the 3 critics), the subgoal-1 status becomes `completed`, and `subgoal.validatorReceipts` has a PASS receipt.
- [ ] **Step 2 — Isolation (SC2).** `it("isolates the validator from worker output (fresh context, subgoal fields verbatim, no sentinel)", …)`: worker mock emits `const SENTINEL = "WORKER-SIDE-CHANNEL-XYZ"`. After the subgoal cycle turn, find the `runAgent` call with `agentName === "plan-validator"`; assert its `task` contains the subgoal `objective` and each success criterion verbatim, does NOT contain `SENTINEL`, and `contextMode === "fresh"`.
- [ ] **Step 3 — Runtime applies receipt + completion; self-continuation advances.** `it("applies the validator receipt and completion itself and self-continues to the next subgoal", …)`: after turn 2 (subgoal-1 PASS) assert `state.continuation.queued === true` and the orchestrator follow-up was sent (marker present); after turn 3 assert subgoal-2 completed; after turn 4 assert goal-level verifier ran (`reviewer-verifier` dispatched) and the goal reached `completed`. Assert across all follow-ups: NONE contains `Implement the current active subgoal` (zero main-agent implement instructions).
- [ ] **Step 4 — Unflagged golden (SC1).** Keep `it("manual /goal create→activate→complete never confirms and stays ungated")` (:732) unchanged and green (no gates, no confirm, no orchestrator prompt). Add an assertion there that no `sendUserMessage` call contains `The runtime is implementing subgoals` (the manual path never orchestrates). The ungated continuation-builder golden is covered by Task 2 Step 2 + the untouched goal-continuation tests.
- [ ] **Step 5 — Verify.** `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts` green; `npm run build` clean.

**Acceptance:** worker→validator order per subgoal is pinned; the validator is call-site-isolated (fresh, subgoal fields verbatim, no sentinel); the runtime applies receipt+completion and self-continues across both subgoals to goal-level completion with zero implement instructions; the manual path stays ungated and non-orchestrating.

---

## Task 6 — goal-workflow tests: FAIL retry, goal-level FAIL routing, 3-strike halt, trivial-escape, smoke

**Dependencies:** Tasks 4-5
**Files:** Modify `tests/goal-workflow.test.ts`

- [ ] **Step 1 — Validator FAIL re-dispatches with ALL feedback; no verifier_fail follow-up (SC3).** `it("re-dispatches the worker with accumulated validator feedback and never sends a verifier_fail follow-up", …)`: mock the validator to FAIL twice with distinct findings (`"finding-A"` then `"finding-B"`), keyed by a call counter, worker returns a sentinel. Drive activation turn, then subgoal-cycle turn A (FAIL A), then turn B. Assert turn B's `worker` `runAgent` `task` contains `finding-A` (accumulated from turn A's persisted FAIL receipt); assert NO `sendUserMessage` contains `Do not claim complete or request completion again` (the ungated verifier_fail body) — the follow-up is the orchestrator prompt (marker present).
- [ ] **Step 2 — Goal-level verifier FAIL routes via the orchestrator branch (SC3).** `it("routes a goal-level verifier FAIL through the flagged orchestrator branch, never the implement prompt", …)`: a flagged goal whose single subgoal PASSes, then goal-level verifier FAILs once. Assert the FAIL follow-up contains `The runtime is implementing subgoals` and does NOT contain `Implement the current active subgoal`, and the goal did NOT `complete_target` (status not `completed`).
- [ ] **Step 3 — 3-strike worker-loop halt (SC3/SC4 companion).** `it("halts the worker loop with a blocker-summary escalation after 3 validator FAILs", …)`: validator FAILs every attempt. Drive activation + three subgoal-cycle turns. Assert `state.continuation.consecutiveFailures["subgoal-1"] >= 3`, a `sendUserMessage` contains `exhausted its 3-attempt failure budget`, and the third cycle queued NO further `validator_next` self-continuation (the loop stopped — assert the follow-up is the escalation, not the orchestrator prompt).
- [ ] **Step 4 — Trivial-escape still requires validator PASS (SC3).** `it("a trivial-escape goal still runs the validator gate on its subgoal", …)`: draft a TRIVIAL contract with exactly ONE subgoal (`suggestedSubgoals` length 1, `successCriteria` length ≤2 ⇒ trivial). Turn 1 (`/goal`) confirms + activates ungated-panel but `gates.validator === true`, no critic dispatch (`runAgent` not called on the panel path). Turn 2 runs the subgoal worker→validator cycle; a validator PASS completes the subgoal. Assert `state.goals[0].gates?.panel` undefined, `gates?.validator === true`, the subgoal completed only after the `plan-validator` dispatch.
- [ ] **Step 5 — Mini-chain smoke (SC5).** `it("mini-chain: contract → panel ×3 APPROVE → confirm → autostart → subgoal worker→validator PASS → completed", …)`: default 2-subgoal contract; turn 1 asserts 3 critic dispatches + gated activation + `confirm` once; turn 2 asserts `worker` then `plan-validator` dispatched and subgoal-1 `completed`. (Full-chain-to-goal-completion is Task 5 Step 3; this smoke pins the end-to-end front-to-first-subgoal path in one test.)
- [ ] **Step 6 — Verify.** `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts` green; `npm run build` clean.

**Acceptance:** validator FAIL re-dispatch carries all accumulated feedback with no verifier_fail follow-up; goal-level FAIL uses the orchestrator branch; the 3-strike halt escalates with a blocker summary and stops self-continuing; a trivial goal still passes the validator gate; the mini-chain smoke is green.

---

## Task 7 — `skills/agentic-goal/SKILL.md` orchestrator language + skill-docs pins

**Dependencies:** Task 0
**Files:** Modify `skills/agentic-goal/SKILL.md`, `tests/skill-docs.test.ts`

- [ ] **Step 1 — Pins first (failing).** In `tests/skill-docs.test.ts` `it("agentic-goal requires durable goal runtime, todos, evidence, and verifier PASS")` (:28), ADD pins: the skill states that for flagged (worker→validator) goals the RUNTIME implements subgoals via an isolated worker→validator loop and the main agent only advances `/goal` (an orchestrator sentence — e.g. `expect(src).toContain("the runtime implements")` or a pinned phrase you also write into the skill), and that small tasks should prefer the manual `/goal` path (`expect(src).toContain("manual /goal")` or an equivalent pinned phrase). Keep ALL existing pins (`/goal status`, `todoread`, `verifier subagent returns PASS`, etc.) and the legacy-skill-absence loop.
- [ ] **Step 2 — Skill edits.** Add a short "Who implements" subsection to `SKILL.md`: for goals started via autostart (flagged), the durable runtime dispatches an isolated worker to implement each subgoal and an information-isolated validator to judge it — the main agent does NOT implement; it advances the runtime by running `/goal`. Add one line recommending the manual `/goal create → activate → complete` path for small tasks. Do NOT remove the existing verifier/FAIL language the pins depend on.
- [ ] **Step 3 — Verify.** `cd extensions/agentic-harness && npm test -- tests/skill-docs.test.ts` green; `npm run build` clean.

**Acceptance:** the skill documents runtime-implements-for-flagged-goals + manual-path-for-small-tasks; new pins green; every prior agentic-goal pin still holds.

---

## Task 8 (Final) — Full verification gate + diff sanity

**Dependencies:** Tasks 0-7
**Files:** None (fix only failures this task surfaces)

- [ ] **Step 1 — Full gate.** `cd extensions/agentic-harness && npm test && npm run build`. Expected: entire suite green (M4b baseline 72 files / 787 tests + M5's added tests) and typecheck clean. In particular `tests/goal-state.test.ts`, `tests/goal-events.test.ts`, `tests/agents.test.ts`, `tests/verdict-format.test.ts`, `tests/extension.test.ts` stay green (no reducer/agent/format/registration change).
- [ ] **Step 2 — Loop-wiring audit.** `grep -n "gates: { panel: true, validator: true }\|gates: { validator: true }\|runSubgoalWorkerCycle\|runGoalLevelCompletion\|record_validator_receipt\|validator_next\|The runtime is implementing subgoals" index.ts`. Expected: `gates: { panel: true, validator: true }` on the non-trivial path, `gates: { validator: true }` on the trivial path; `record_validator_receipt` + `complete_target` applied inside `runSubgoalWorkerCycle`; the orchestrator marker present; `buildGoalAutoPrompt` still holds `Implement the current active subgoal` (unflagged path intact). `grep -n "Implement the current active subgoal" index.ts` returns exactly ONE match (inside `buildGoalAutoPrompt`).
- [ ] **Step 3 — Diff sanity.** `git diff --stat`. Expected: the ONLY changed files under `extensions/agentic-harness/` are `index.ts`, `goal-continuation.ts`, `subgoal-validator.ts`, `skills/agentic-goal/SKILL.md`, `tests/goal-workflow.test.ts`, `tests/goal-continuation.test.ts`, `tests/skill-docs.test.ts`, `tests/subgoal-validator.test.ts` (plus this plan doc). Confirm `goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `goal-verifier.ts`, `verdict-format.ts`, every `agents/*.md`, `discipline.ts`, and every clarification module are NOT in the diff. Any other changed file is out of scope — revert it.

**Acceptance:** all five milestone Success Criteria satisfied; `npm test && npm run build` green; diff limited to the eight allowed files.

---

## Rollback Plan

M5 edits three source files (`index.ts`, `goal-continuation.ts`, new `subgoal-validator.ts`) plus one skill and four test files; it adds NO reducer command and NO state field, and changes no persisted schema — the validator receipt/budget primitives (M2) already exist and are only CONSUMED. Blast radius is the `autoStartGoalRuntime` tail + the two `create_goal` gate literals.
1. If the full gate fails late and the cause is isolated to the loop engine, revert Task 4's helpers + tail fork; the goal reverts to the M4b interactive-execution behavior (flagged goals still set `gates.validator` but no cycle drives them — so also revert Tasks 2-3's gate literals to fully restore M4b). The trivial/manual paths are unaffected.
2. Fastest safe de-risk WITHOUT full revert: drop `gates.validator` from both `create_goal` forks (Task 3 Steps 2-3). Every auto-created goal is then unflagged ⇒ the tail always takes `buildGoalAutoPrompt` ⇒ M4b interactive execution is restored with zero worker/validator dispatch, while `subgoal-validator.ts` and the loop helpers sit dormant. This keeps the pipeline live while the loop is debugged.
3. If a follow-up/prompt string disturbs a pin, restore the touched file from `HEAD` and re-apply only the non-string helper additions.
4. Because no reducer/state/storage module is edited, there is no persistence/replay/`schemaVersion` concern — a run created before M5 replays byte-identically; a run with validator receipts replays through the M2 machinery already proven in that milestone.
5. Full abort: `git checkout -- extensions/agentic-harness/` restores everything. M5 is an abort-point milestone (full autonomous loop minus the final review panel); dropping it leaves M1-M4b intact, though M6 depends on it.

## Self-Review

- **Spec coverage:** Maps 1:1 to the five milestone SCs. SC1 (worker→validator order per subgoal; runtime applies receipt+completion; self-continuation to next subgoal AND goal-level; zero implement instructions; unflagged golden incl. both builders) → Task 4 engine + Task 5 Steps 1/3/4 + Task 2 Step 2. SC2 (call-site isolation: sentinel absent, subgoal fields verbatim, fresh) → Task 5 Step 2. SC3 (validator FAIL re-dispatch with ALL feedback + no verifier_fail follow-up; goal-level FAIL orchestrator routing; flagged marker present + forbidden literal absent; trivial-escape requires validator PASS) → Task 6 Steps 1/2/4 + Task 3 marker discipline. SC4 (legacy line-152 replaced by 3-strike halt via validator path + blocker escalation) → Task 2 Step 1 + Task 6 Step 3. SC5 (mini-chain smoke; full gate) → Task 6 Step 5 + Task 8.
- **Task-count discipline:** 9 tasks (0 seam-check + 8 impl/test), under the 12 ceiling. Natural split seams if ever needed: Task 5/6 both edit `tests/goal-workflow.test.ts` and could merge or split further, and Task 3/4 both edit `index.ts` (gating vs engine) — kept separate so each task ends green with a crisp binary check.
- **The riskiest task is Task 4** (the loop engine + tail fork): it is the only substantial behavioral change, mitigated by (a) the worker/validator dispatch being the proven `runGoalVerifier` block verbatim, (b) the M2 completion invariant being unit-proven and satisfied by `record_validator_receipt(PASS) → complete_target` with no interleaved writes, (c) the reducer surface untouched (replay/persistence risk nil), and (d) Task 3 isolating the gating blast radius first so Task 4's failures are purely engine failures.
- **Seam/trigger decisions pinned:** (1) the trigger is `/goal` auto re-entry — a `validator_next` self-continuation's orchestrator follow-up prompts the main agent to re-run `/goal`, which the `autoStartGoalRuntime` tail detects via `gates.validator` + `runnableSubgoal`; (2) one worker→validator pair per turn, FAIL re-dispatch on the NEXT turn (accumulated feedback observable across `goal.handler` calls, no in-turn spin); (3) `validator_next` is a free-form `queue_continuation.reason` (no reducer change — Task 0 Check A), and the new `escalate` decision lives in `goal-continuation.ts` (in scope — Check B); (4) goal-level completion always uses the verifier (not the validator); (5) the trivial escape is panel-only but still `gates.validator`, so trivial goals run the validator gate on their subgoal.
- **Golden/byte-compat honesty:** all auto-created goals are now flagged, so the "unflagged golden" is (a) the manual `/goal` path (Task 5 Step 4, untouched + one negative assertion) and (b) the ungated continuation builders (Task 2 Step 2 + the four untouched goal-continuation tests). `buildGoalAutoPrompt` and `buildNextTargetContinuationPrompt` are byte-identical; the flagged branches only diverge when `gates.validator` is set. The M4b transitional auto-prompt assertions (:117, :186) are rewritten — not merely extended — exactly as M4b rewrote M4a's.
- **Scope flags for the orchestrator:** (1) **Goal-level fix-subgoal materialization is deferred to M6.** Decision #10 mentions goal-verifier FAIL blockers "become fix subgoals driven by the same loop"; M5 delivers the flagged orchestrator FAIL prompt + 3-strike escalation (the "or escalates" half, which is what SC3's binary assertions require) but does NOT `create_subgoal` on goal-verifier FAIL — that reuses M6's review-FAIL fix-recycling machinery. (2) **No goal-state.ts change is needed** (Task 0 Checks A/B confirmed the continuation reason is free-form and the decision union is in `goal-continuation.ts`); if Task 0 finds otherwise, STOP and flag — the reason union would then be a `goal-state.ts` type edit, which is out of the allowed file set.
