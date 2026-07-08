# M6 — Final security/qa review panel + completion gate + fix recycling

> **Worker note:** Execute strictly in task order. This milestone adds the LAST gate: `gates.review` on autostart goals, a two-member security+qa review panel that runs at goal completion, and FAIL→fix-subgoal recycling driven by M5's worker→validator loop. It makes the ONE reducer edit M5 deferred (the completion invariant's THIRD clause — the review-gate check), plus orchestration in `runGoalLevelCompletion` and an aligned goal SKILL.md. It reuses the M1 panel primitive (`open_panel`/`record_panel_verdict`/`isPanelApproved`), the M3 review agents (`security-reviewer`/`qa-reviewer`, `VERDICT: PASS|FAIL` grammar), the M2 completion invariant, and the M5 loop (`runGoalLevelCompletion`, `runFlaggedGoalTurn`, `runnableSubgoal`, `create_subgoal`, `validator_next` self-continuation). If a step tempts you to add a reducer command, a state field, a new tool, or a goal-continuation decision, STOP: M6 is a **reducer-clause + orchestration** milestone. The only reducer edit is the review clause in `assertCompletionInvariant` plus a `REVIEW_PANEL_ID` constant. Every command M6 dispatches (`open_panel`, `record_panel_verdict`, `create_subgoal`, `complete_target`, `request_completion`, `queue_continuation`) is already allowlisted in `goal-events.ts` — verified, no `goal-events.ts` edit. The review-fix continuation reuses the free-form `queue_continuation.reason` string (`review_fix`) and the existing `buildGoalOrchestratorPrompt` follow-up, so **`goal-continuation.ts` is NOT touched** (scope reduction vs. the milestone's allowed set — see Scope Flags). Files touched: `goal-state.ts`, `index.ts`, `skills/agentic-goal/SKILL.md`, `tests/goal-state.test.ts`, `tests/goal-workflow.test.ts`, `tests/skill-docs.test.ts` — **nothing else**.

**Goal:** Implement draft-v4 decision #5/#7/#10 review-gate for `gates.review` goals with the BINDING ordering: goal-verifier PASS → open the review panel (`security-reviewer` + `qa-reviewer`, expected members) → parallel dispatch → all-PASS ⇒ `complete_target(goal)`; any FAIL ⇒ materialize each blocking finding as a fix subgoal (driven by M5's worker→validator loop) + re-request continuation, and **NO `complete_target` call**. Recycling requires a FRESH post-fix `request_completion` → goal-verifier PASS before the FULL panel re-runs — fix subgoals do NOT stale the old goal-verifier receipt at the reducer level (checked), so freshness is guaranteed by orchestration structure (`runGoalLevelCompletion` always re-verifies at the top of every goal-level turn). A same-finding third review failure (persisted review-panel round cap reached) escalates instead of looping. `autostart` sets `gates.review` on both the trivial and non-trivial forks; trivial goals stay review-gated. The manual `/goal create → activate → complete` path (no `gates.review`) is unchanged (golden). Goal SKILL.md completion language references the validator/review gates (old "Goal PASS: stop" semantics gone).

**Architecture:** The reducer edit lands in `goal-state.ts` — `assertCompletionInvariant` gains a third clause: for a GOAL target with `gates.review === true`, additionally require a panel with `panelId === REVIEW_PANEL_ID` to satisfy `isPanelApproved` (fail-closed: missing or partial ⇒ `GoalInvariantError`). `REVIEW_PANEL_ID = "goal-review-panel"` is exported from `goal-state.ts` and imported by `index.ts` as the single source of truth. All orchestration lands in `index.ts` in the goal-command scope (`export default function (pi)`), reusing the `dispatchContractPanel` pattern (parallel, fresh context, sandbox verbatim) for the review dispatch and rewriting `runGoalLevelCompletion` (index.ts:2209) to insert the review panel between verifier PASS and completion. The review panel runs **synchronously within the goal-level completion turn** (mirroring the contract panel in `runContractPanelActivation`, NOT the deferred worker loop). No new command handler, no new tool, no new reducer command, no new state field, no `goal-continuation.ts` change.

**PASS/FAIL → APPROVE/REJECT mapping (pinned decision):** `security-reviewer` and `qa-reviewer` emit `VERDICT: PASS | FAIL` (M3), parsed by the existing `parseGoalVerifierOutput` (`goal-verifier.ts:88`, case-insensitive, fail-closed → FAIL on no match). The M1 panel primitive stores `APPROVE | REJECT` (`record_panel_verdict`) and `isPanelApproved` checks every expected member `APPROVE`. **M6 maps at the ORCHESTRATION layer: `PASS → APPROVE`, `FAIL → REJECT` when calling `record_panel_verdict`. No reducer type change** (`PanelVerdict` stays `"APPROVE" | "REJECT"`; the review agents keep their PASS/FAIL grammar). The reducer's review clause reuses `isPanelApproved` unchanged.

**Tech Stack:** TypeScript ESM, Pi extension API (`@mariozechner/pi-coding-agent`), Vitest. No new runtime dependencies. New import into `index.ts`: `REVIEW_PANEL_ID` from `./goal-state.js` (add to the existing `./goal-state.js` import at index.ts:62). `index.ts` already imports `isPanelApproved`, `parsePanelVerdictOutput` (verdict-format), `parseGoalVerifierOutput` (goal-verifier), `discoverAgents`, `runAgent`, `mapWithConcurrencyLimit`, `MAX_CONCURRENCY`, `getFinalOutput`, `isResultSuccess`, `makeDetails`, `parsedApprovalMode`, `piWritableRoots`, `depthConfig`, `BUNDLED_AGENTS_DIR`.

**Work Scope:**
- **In scope:** `goal-state.ts` — `REVIEW_PANEL_ID` constant + the review clause in `assertCompletionInvariant`. `index.ts` — `gates.review` on both autostart forks; `REVIEW_CRITICS` constant; `buildReviewPanelTask`, `dispatchReviewPanel`, `extractReviewFindings`, `materializeReviewFixSubgoals`, `buildReviewFixFollowUp` / `buildReviewPanelEscalation` helpers; rewrite of `runGoalLevelCompletion`. `skills/agentic-goal/SKILL.md` — completion-language alignment. The three test files.
- **Out of scope (do NOT touch):** `goal-events.ts` (every command is already allowlisted — verified at Task 0), `goal-storage.ts`, `goal-verifier.ts`, `verdict-format.ts`, `subgoal-validator.ts`, `goal-continuation.ts` (review-fix continuation reuses the free-form `queue_continuation.reason` + `buildGoalOrchestratorPrompt` — no decision-union change), every `agents/*.md` (`security-reviewer.md`/`qa-reviewer.md` output format is CONSUMED, not edited), `discipline.ts`, all clarification modules, the manual `/goal create→activate→complete` branches (index.ts:2271-2349), `runContractPanelActivation`'s panel-loop mechanics, `runSubgoalWorkerCycle`, `runGoalVerifier`, `runnableSubgoal`, `activeOrRunnableGoal`, `create_subgoal`/`request_completion`/`complete_target` reducer bodies (they already handle fix-subgoal reactivation correctly — verified at Task 0).

**Verification Strategy:**
- **Level:** test-suite + build (the exact gate CI enforces on push to main).
- **Command:** `cd extensions/agentic-harness && npm test && npm run build`
- **Scoped command (per-task iteration):** `cd extensions/agentic-harness && npm test -- <the task's test file(s)>`
- **What passing proves:** with `gates.review`, the reducer refuses `complete_target(goal)` unless the review panel is all-PASS (flag-absent unchanged); the runtime opens the review panel after a fresh verifier PASS, dispatches security+qa in parallel with fresh isolated context, maps PASS/FAIL→APPROVE/REJECT, completes on all-PASS, and on any FAIL materializes fix subgoals + recycles through the worker loop WITHOUT calling `complete_target`; the post-fix re-run does a fresh `request_completion`→verifier PASS before the full panel re-runs; a same-finding third failure escalates; a trivial-escape goal is still review-gated; phase stays `goal_active`; the manual/ungated path never opens a review panel.

**Success Criteria** (verbatim from milestone M6):
- [ ] goal-state tests: with `gates.review`, `complete_target` throws unless the review panel is all-PASS (the completion invariant's THIRD edit — named work); flag absent ⇒ unchanged.
- [ ] goal-workflow tests: review FAIL ⇒ fix subgoals + recycling (NOT a thrown `complete_target` error); after fixes, a fresh `request_completion` → verifier PASS precedes the FULL panel re-run; both-PASS completes; same-finding third failure escalates; phase held at `goal_active`; a trivial-escape goal still requires review PASS.
- [ ] skill-docs tests: goal SKILL.md completion language references validator/review gates (old "Goal PASS: stop" semantics gone); legacy negative list holds.
- [ ] `cd extensions/agentic-harness && npm test && npm run build` green.

---

## Canonical literals (use these EXACT strings so pins line up)

| Token | Exact literal |
|---|---|
| Review panel stable id (`goal-state.ts` export + `index.ts` import) | `REVIEW_PANEL_ID = "goal-review-panel"` |
| Review panel expected members (`index.ts` `REVIEW_CRITICS`) | `["security-reviewer", "qa-reviewer"]` |
| Reducer review-gate throw message | `Cannot complete goal ${goalId}: review panel is not fully approved` |
| Review-fix self-continuation reason (`queue_continuation.reason`, free-form string) | `review_fix` |
| Review-fix orchestrator follow-up | `buildGoalOrchestratorPrompt(state)` (existing — contains `The runtime is implementing subgoals`) |
| Review-panel round-cap escalation — lead line | `The security/qa review panel did not converge after 3 rounds. Stop the automatic goal start and summarize the unresolved review findings for the user to resolve manually:` |
| Review-fix subgoal title prefix | `Fix review finding: ` |
| SKILL.md completion line (replaces "Goal PASS: stop") — pinned phrase | `the runtime opens the security/qa review panel` |

**Mapping discipline:** the ONLY place PASS/FAIL becomes APPROVE/REJECT is inside `dispatchReviewPanel` when constructing the `record_panel_verdict` verdict (`parsed.verdict === "PASS" ? "APPROVE" : "REJECT"`). The review agents' `.md` bodies and the `PanelVerdict` type are untouched.

**Round-cap discipline:** the review panel's own `PanelState.round` (M1) tracks review attempts, exactly like the contract panel. Check `existingReviewPanel.round >= 3` BEFORE re-opening ⇒ escalate (3 review rounds, then the 4th escalates). Panels never touch the failure budget (decision #6) — the review round cap is separate from the worker-loop 3-strike budget.

---

## Design decisions pinned for this milestone

### D1 — Reducer review clause (`goal-state.ts`, the invariant's THIRD edit — named work)

`assertCompletionInvariant` (goal-state.ts:734) today has exactly two branches: gated-subgoal → `assertValidatorCompletionInvariant` (early return, M2), and everything else → the verifier invariant (goal targets + ungated subgoals, M1/M2). It has **NO review clause** (verified: `grep gates.review goal-state.ts` → none). M6 adds the third clause, layered ON TOP of the verifier invariant for goal targets:

- Add `export const REVIEW_PANEL_ID = "goal-review-panel";` near `isPanelApproved` (goal-state.ts:212).
- After the existing goal-target verifier checks succeed (immediately before the closing brace of `assertCompletionInvariant`, goal-state.ts:775), add:
  ```ts
  if (target.type === "goal" && target.goal.gates?.review === true) {
    const reviewPanel = (state.panels ?? []).find((panel) => panel.panelId === REVIEW_PANEL_ID);
    if (!reviewPanel || !isPanelApproved(reviewPanel)) {
      throw new GoalInvariantError(`Cannot complete goal ${target.goal.id}: review panel is not fully approved`);
    }
  }
  ```
- Consequence: a `gates.review` goal requires BOTH the goal-verifier PASS (existing checks) AND the review panel all-PASS. `gates.review` absent ⇒ clause skipped ⇒ byte-identical to today (golden). The clause is defense-in-depth: even if orchestration attempted `complete_target` without opening the panel, the reducer refuses.
- **Why `isPanelApproved` maps cleanly:** orchestration records `APPROVE` for each PASS reviewer, so an all-PASS review panel satisfies `isPanelApproved` (every expected member APPROVE). No new predicate.

### D2 — Autostart sets `gates.review` on both forks

- Non-trivial (`runContractPanelActivation`, index.ts:1923): `gates: { panel: true, validator: true }` → `gates: { panel: true, validator: true, review: true }`.
- Trivial (`autoStartGoalRuntime` trivial fork, index.ts:1985): `gates: { validator: true }` → `gates: { validator: true, review: true }`.
- Nothing else about the trivial escape changes (still panel-free at the CONTRACT stage, still one confirm). The manual `/goal create` path (index.ts:2271-2280) stays ungated — no `gates.review`.

### D3 — Orchestration: rewrite `runGoalLevelCompletion` (index.ts:2209)

Today (M5):
```ts
const runGoalLevelCompletion = async (ctx, state, goal) => {
  const requested = await applyGoalMutation(ctx, { type: "request_completion", targetType: "goal", targetId: goal.id });
  const receipt = await runGoalVerifier(ctx, requested, "goal", goal.id);
  const verified = await applyGoalMutation(ctx, { type: "record_verifier_result", receipt });
  state = receipt.verdict === "PASS"
    ? await applyGoalMutation(ctx, { type: "complete_target", targetType: "goal", targetId: goal.id })
    : verified;
  return await maybeQueueGoalContinuation(ctx, state, receipt);
};
```

M6 (binding ordering):
1. `request_completion(goal)` → `runGoalVerifier(goal)` → `record_verifier_result` (unchanged; freshness lives here — every goal-level turn re-verifies).
2. **Verifier FAIL** ⇒ `return maybeQueueGoalContinuation(ctx, verified, receipt)` (unchanged M5 path — flagged orchestrator FAIL branch / 3-strike escalation; the review panel NEVER opens on a verifier FAIL).
3. **Verifier PASS + `!goal.gates?.review`** ⇒ `complete_target(goal)` → `maybeQueueGoalContinuation` (the golden/ungated path — e.g. manual goals; kept for byte-compat with the M5 verifier-only completion).
4. **Verifier PASS + `gates.review`** ⇒ run the review panel synchronously in this turn:
   - **Round cap:** `existingReviewPanel = (state.panels ?? []).find(p => p.panelId === REVIEW_PANEL_ID)`; if `existingReviewPanel && existingReviewPanel.round >= 3` ⇒ `sendGoalContinuationFollowUp(buildReviewPanelEscalation(existingReviewPanel))` and RETURN (no `complete_target`, no self-continuation — the loop halts). Mirrors `runContractPanelActivation`'s round cap (index.ts:1889).
   - `open_panel(REVIEW_PANEL_ID, purpose "Goal-completion review (security / qa)", expectedMembers REVIEW_CRITICS)` (round++ on re-run).
   - `verdicts = await dispatchReviewPanel(ctx, goal)` — parallel security+qa (see D4).
   - `record_panel_verdict ×2` (mapped APPROVE/REJECT + findings).
   - re-read the review panel; **all-PASS** (`isPanelApproved`) ⇒ `complete_target(goal)` → `maybeQueueGoalContinuation` (completion follow-up / next queued goal; reuses the existing tail).
   - **any FAIL** ⇒ `materializeReviewFixSubgoals(ctx, state, goal, verdicts)` (create one fix subgoal per REJECT member, see D5) → `queue_continuation({ targetType: "goal", targetId: goal.id, reason: "review_fix" })` → `sendGoalContinuationFollowUp(buildGoalOrchestratorPrompt(state))` → RETURN. **No `complete_target` call** (recycling, not a thrown error).
5. `currentPhase` is NOT changed anywhere in `runGoalLevelCompletion` — it inherits `"goal_active"` from the re-entry set-site (index.ts:2025). This satisfies SC2's "phase held at `goal_active`".

**Freshness (resolution row #92):** after a review FAIL materializes fix subgoals, the goal has runnable fix subgoals. Next `/goal` turn: `runFlaggedGoalTurn` → `runnableSubgoal` finds a fix subgoal → `runSubgoalWorkerCycle` (worker→validator, gated by the goal's `gates.validator`). After all fix subgoals complete, `runnableSubgoal` returns `undefined` → `runGoalLevelCompletion` re-enters → a FRESH `request_completion(goal)` + `runGoalVerifier` runs at step 1 BEFORE the panel re-runs at step 4. So the full panel re-run always follows a fresh verifier PASS — the freshness is a structural consequence of `runGoalLevelCompletion` re-verifying at the top of every goal-level turn, not a special case. **Verified at the reducer level:** fix-subgoal `create_subgoal` emits a `subgoal_created` ledger entry carrying a `subgoalId`, which `entryMatchesTarget` (goal-state.ts:815) rejects for a GOAL target (goal targets require `subgoalId === undefined`), so fix subgoals do NOT stale the goal-verifier receipt — but orchestration re-verifies anyway, which is what SC2 pins.

### D4 — `dispatchReviewPanel` (mirror `dispatchContractPanel`, index.ts:1731)

- `REVIEW_CRITICS = ["security-reviewer", "qa-reviewer"] as const;` near `CONTRACT_CRITICS` (index.ts:1713).
- `buildReviewPanelTask(goal: GoalItem): string` — objective + `successCriteria` + `constraints` + `evidenceRequired` verbatim inside untrusted-data fences (mirror `buildContractCriticTask`/`buildSubgoalWorkerTask` framing), PLUS a **changed-scope summary** approximated from the goal's completed subgoal titles + `goal.evidence` + subgoal `evidence` (no git-diff dependency — documented). The review agents' `.md` bodies define their C1–C7 / C1–C12 checklists; the task supplies only the contract fields + changed-scope summary, matching what `security-reviewer.md`/`qa-reviewer.md` say they receive.
- Dispatch: `mapWithConcurrencyLimit([...REVIEW_CRITICS], MAX_CONCURRENCY, ...)` with `runAgent({ agent: agents.find(a => a.name === name), agentName: name, task: buildReviewPanelTask(goal), contextMode: "fresh", sandbox: <the dispatchContractPanel block verbatim>, cwd, depthConfig, makeDetails: makeDetails("single") })`.
- Parse: `output = isResultSuccess(result) ? getFinalOutput(result.messages) : errorMessage||stderr||"review process failed"`; `parsed = parseGoalVerifierOutput(output)`; if `!isResultSuccess(result)` ⇒ `parsed.verdict = "FAIL"` (fail-closed, mirror `runGoalVerifier`). `try/catch` ⇒ `{ member, verdict: "REJECT", findings: message }` (fail-closed).
- Return `{ member, verdict: parsed.verdict === "PASS" ? "APPROVE" : "REJECT", findings: extractReviewFindings(parsed, output) }[]` — the ONLY mapping site.
- `extractReviewFindings(parsed, output)` — prefer `parsed.blockers.join("; ")` (populated when a reviewer emits a `Blockers:` section); else fall back to the raw `FINDINGS:` section lines (the `[blocking]` lines the real reviewers emit); else a generic `"review finding (see verdict output)"`. Kept small; tests drive it with `Blockers:`-emitting mocks (aligned with the existing verifier-fail mocks).

### D5 — `materializeReviewFixSubgoals` (reuse `create_subgoal`; NO reducer change)

For each REJECT verdict in the review panel, `create_subgoal` one fix subgoal:
```ts
{ id: nextSubgoalId(state), goalId: goal.id, title: `Fix review finding: ${v.member}`, objective: `Fix review finding: ${v.member} — ${v.findings ?? "address the review blocker"}` }
```
- **Reactivation is automatic (verified at Task 0):** when all subgoals completed, `activateNextRunnableSubgoal` (goal-state.ts:821) `delete`s `goal.activeSubgoalId`. `create_subgoal` (goal-state.ts:377-392) then sets the new subgoal `status: goal.activeSubgoalId ? "queued" : "active"` → `"active"` and sets `activeSubgoalId` to it. So `runnableSubgoal(goal)` picks the fix subgoal next turn. Multiple fix subgoals: the first becomes `active`, the rest `queued`, drained in order by the loop — no reducer change needed.
- The goal's `gates.validator` is inherited, so each fix subgoal runs the full worker→validator cycle ("driven via M5's loop", milestone SC2).

### D6 — Escalation + follow-up builders (`index.ts`, NO `goal-continuation.ts`)

- `buildReviewPanelEscalation(panel)` — the round-cap lead line (canonical literal) + the REJECT members' findings (mirror `buildPanelEscalationFollowUp`, index.ts:1781). Sent on the 4th would-be review round.
- Review-fix follow-up is `buildGoalOrchestratorPrompt(state)` (existing, index.ts:1833) — it already contains `The runtime is implementing subgoals` and instructs the main agent to run `/goal`, which is exactly the recycle trigger. No new builder.
- **`goal-continuation.ts` is NOT edited:** the review-fix continuation is queued directly in `index.ts` via `applyGoalMutation({ type: "queue_continuation", reason: "review_fix" })` (free-form reason string — no reducer change), and its follow-up is `buildGoalOrchestratorPrompt`. `planGoalContinuation` is reached only on the verifier-FAIL / non-review completion paths (unchanged from M5).

### D7 — `flaggedChainMock` extension (test helper, `tests/goal-workflow.test.ts`)

`flaggedChainMock` (goal-workflow.test.ts:1076) currently returns PASS for critics / `plan-validator` / `reviewer-verifier` and a sentinel for the worker. It does NOT handle `security-reviewer` / `qa-reviewer`. Extend it: `if (o.agentName === "security-reviewer" || o.agentName === "qa-reviewer") return verifierResult("VERDICT: PASS\nSummary: clean\nBlockers:\nFINDINGS:\n- [advisory] none")`. This keeps the M5 full-chain test (`applies the validator receipt … self-continues`, goal-workflow.test.ts:812) green: turn 4 now runs verifier PASS → review panel (2 PASS dispatches) → `complete_target` in the same turn. That test asserts only `reviewer-verifier` dispatched + goal `completed` + no implement instruction — all still hold.

### D8 — SKILL.md completion language (`skills/agentic-goal/SKILL.md`)

The "Follow the verifier outcome" list (SKILL.md:44-47) currently says `Goal PASS: stop; the active goal is complete.` — the pre-review semantics. Replace the goal-PASS branch so completion references the review gate, e.g. `Goal verifier PASS: the runtime opens the security/qa review panel; the goal completes only when security and qa both PASS, and any review FAIL recycles into fix subgoals.` Keep the M5 "Who Implements" section and every existing pin (`verifier subagent returns PASS`, `verifier returns FAIL`, `todoread`, etc.) intact.

---

## Task 0 — Baseline lock + seam conformance (go/no-go; NO code)

**Dependencies:** None
**Files:** None (read-only; record the note inline in the plan-execution log)

Capture the green baseline and verify M6's seam assumptions against the merged M5 code. Output is a **go/no-go note**, not a redesign. All checks are expected GO (seams verified during planning).

- [ ] **Baseline capture.** `cd extensions/agentic-harness && npm test && npm run build`. Record the file/test counts (M5 post-merge baseline: 73 files / 800 tests green, tsc clean). This is the number Task 6 must meet or exceed.
- [ ] **Check A — review clause absent (M6 owns it).** `grep -n "gates?.review\|gates.review\|REVIEW_PANEL" goal-state.ts index.ts` ⇒ no matches. GO: `assertCompletionInvariant` has no review clause; M6 adds it.
- [ ] **Check B — commands already allowlisted (no `goal-events.ts` edit).** `grep -n '"open_panel"\|"record_panel_verdict"\|"create_subgoal"\|"complete_target"\|"request_completion"\|"queue_continuation"' goal-events.ts` ⇒ all six present (goal-events.ts:92-134). GO: M6 dispatches only allowlisted commands.
- [ ] **Check C — `queue_continuation.reason` is free-form.** Confirm `queue_continuation` carries `reason: string` (goal-state.ts `GoalCommand`) so `review_fix` needs no reducer/type edit. GO.
- [ ] **Check D — fix-subgoal reactivation is automatic.** Confirm `activateNextRunnableSubgoal` (goal-state.ts:821) `delete`s `activeSubgoalId` when no next subgoal, and `create_subgoal` (goal-state.ts:382) sets `status: goal.activeSubgoalId ? "queued" : "active"` + `activeSubgoalId ??= subgoal.id`. GO: a fix subgoal created on an all-complete goal becomes `active` and `runnableSubgoal` picks it — no reducer change.
- [ ] **Check E — review agents + PASS/FAIL grammar.** `ls agents/security-reviewer.md agents/qa-reviewer.md` exist; their bodies end with `VERDICT: PASS | FAIL`; `parseGoalVerifierOutput` (goal-verifier.ts:88) matches `/^Verdict:\s*(PASS|FAIL)\s*$/im` (case-insensitive, so `VERDICT:` parses) and defaults FAIL. GO: dispatch reuses the verifier grammar; map PASS→APPROVE at orchestration.
- [ ] **Check F — `goal-continuation.ts` not needed.** Confirm the review-fix continuation reuses `queue_continuation` + `buildGoalOrchestratorPrompt` (index.ts:1833) and does not route through `planGoalContinuation`. GO: `goal-continuation.ts` stays untouched (scope reduction).
- [ ] **Expected-FAIL note (write into `tests/goal-state.test.ts` as a comment block before Task 1's red, mirroring the M2 Task-0 block at goal-state.test.ts:465):** with `REVIEW_PANEL_ID` unexported the import resolves undefined; with no review clause, `complete_target` on a `gates.review` goal WITHOUT an approved review panel SUCCEEDS today (the new test expects a throw) — that is the red Task 1 turns green; the flag-absent golden already passes (it pins byte-identity).

**Acceptance:** baseline recorded; all six checks GO; the expected-FAIL note is written. Any NO-GO is escalated to the orchestrator before Task 1.

---

## Task 1 — `goal-state.ts` review clause + `REVIEW_PANEL_ID`; goal-state tests (SC1)

**Dependencies:** Task 0
**Files:** Modify `goal-state.ts`, `tests/goal-state.test.ts`

TDD: author the failing goal-state tests first, then the reducer clause.

- [ ] **Step 1 — Tests (failing).** In `tests/goal-state.test.ts`, add a `describe("M6 review-gate completion invariant", …)`. Reuse the existing fixture style (`createGoalState` + `create_goal` with `gates`, `open_panel`, `record_panel_verdict`, `request_completion`, `record_verifier_result` with a `passReceipt`). Import `REVIEW_PANEL_ID` from `../goal-state.js`. Assert:
  - **Throws without an approved review panel:** a `gates: { review: true }` goal with a verifier PASS receipt + `verifier_pass` ledger row but NO review panel ⇒ `complete_target(goal)` throws `/review panel is not fully approved/`.
  - **Throws with a partial review panel:** open `REVIEW_PANEL_ID` (expectedMembers `["security-reviewer","qa-reviewer"]`), record only `security-reviewer` APPROVE ⇒ `complete_target(goal)` throws `/review panel is not fully approved/`.
  - **Throws with a REJECT in the panel:** both members recorded, one REJECT ⇒ throws.
  - **Completes with an all-APPROVE review panel:** both members APPROVE + verifier PASS ⇒ `complete_target(goal)` succeeds; `goals[0].status === "completed"`.
  - **Flag absent ⇒ unchanged (golden):** a goal WITHOUT `gates.review` completes on verifier PASS alone with NO review panel (extend/duplicate the existing golden at goal-state.test.ts:392) — asserts byte-identity of the verifier path.
  - **Verifier still required first:** a `gates.review` goal with an all-APPROVE review panel but NO verifier PASS receipt ⇒ throws `/latest verifier receipt is not PASS/` (the review clause is layered ON TOP of, not instead of, the verifier check).
- [ ] **Step 2 — Reducer.** Add `export const REVIEW_PANEL_ID = "goal-review-panel";` near `isPanelApproved` (goal-state.ts:212). Add the review clause to `assertCompletionInvariant` after the goal-target verifier checks (D1). Do NOT touch `assertValidatorCompletionInvariant` or the subgoal path.
- [ ] **Step 3 — Verify.** `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts` green; `npm run build` clean. The M1/M2 panel/validator/golden tests still pass (the clause fires only for `gates.review === true` goal targets).

**Acceptance:** with `gates.review`, `complete_target(goal)` throws unless a `REVIEW_PANEL_ID` panel is all-APPROVE AND the verifier receipt is PASS; flag-absent completion is byte-identical; `REVIEW_PANEL_ID` is exported.

---

## Task 2 — `index.ts` gates.review + review-panel dispatch + happy-path wiring; extend `flaggedChainMock` (SC2 happy path)

**Dependencies:** Task 1
**Files:** Modify `index.ts`, `tests/goal-workflow.test.ts`

Set the flag AND wire the full review panel into `runGoalLevelCompletion` in the SAME task — otherwise a `gates.review` autostart goal would hit the new reducer clause with no panel and throw. The FAIL path lands here as a safe placeholder (no `complete_target`, orchestrator follow-up); Task 3 adds fix-subgoal materialization + escalation.

- [ ] **Step 1 — Import + constant.** Add `REVIEW_PANEL_ID` to the `./goal-state.js` import (index.ts:62). Add `const REVIEW_CRITICS = ["security-reviewer", "qa-reviewer"] as const;` near `CONTRACT_CRITICS` (index.ts:1713).
- [ ] **Step 2 — Gate both forks (D2).** `runContractPanelActivation` create_goal (index.ts:1923): add `review: true`. Trivial-fork create_goal (index.ts:1985): add `review: true`.
- [ ] **Step 3 — Review-panel helpers.** Add near `dispatchContractPanel` (index.ts:1731): `buildReviewPanelTask(goal)` (D4), `extractReviewFindings(parsed, output)` (D4), `dispatchReviewPanel(ctx, goal)` (D4 — parallel security+qa, fresh context, sandbox verbatim, `parseGoalVerifierOutput`, PASS→APPROVE mapping, fail-closed). Add `buildReviewPanelEscalation(panel)` (D6) near `buildPanelEscalationFollowUp` (index.ts:1781).
- [ ] **Step 4 — Rewrite `runGoalLevelCompletion` (index.ts:2209) per D3 steps 1–4**, with the review-FAIL branch as a Task-2 placeholder: on any FAIL, `queue_continuation({ reason: "review_fix" })` + `sendGoalContinuationFollowUp(buildGoalOrchestratorPrompt(state))` + RETURN (NO `complete_target`), but do NOT materialize fix subgoals yet (Task 3). Include the round-cap escalation branch (D3 step 4a) now. Keep verifier-FAIL (step 2) and non-review-PASS (step 3) exactly as M5.
- [ ] **Step 5 — Extend `flaggedChainMock` (D7).** In `tests/goal-workflow.test.ts:1076`, add the `security-reviewer`/`qa-reviewer` → PASS branch.
- [ ] **Step 6 — Rewrite the M5 full-chain completion assertion.** The M5 test `applies the validator receipt and completion itself and self-continues to the next subgoal` (goal-workflow.test.ts:812) drives to turn 4 goal-level completion. It stays green with the extended `flaggedChainMock` (turn 4 = verifier PASS → review PASS×2 → complete). ADD assertions to it (or a sibling test using the default 2-subgoal contract): after turn 4, `state.panels.find(p => p.panelId === "goal-review-panel")` exists and `isPanelApproved` is true; the turn-4 `runAgent` calls include `security-reviewer` and `qa-reviewer` AFTER `reviewer-verifier`; `state.goals[0].status === "completed"`.
- [ ] **Step 7 — Verify.** `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts` green; `npm run build` clean. The M5 flagged-chain tests (dispatch order, isolation, FAIL retry, goal-level FAIL, 3-strike, trivial, smoke, manual golden) still pass — turns 1–3 are unaffected (the review panel only runs at goal-level completion); the goal-level-verifier-FAIL test (goal-workflow.test.ts:892) is unaffected (verifier FAIL ⇒ no review panel).

**Acceptance:** every auto-created goal carries `gates.review`; on a fresh goal-verifier PASS the runtime opens `goal-review-panel`, dispatches security+qa in parallel (fresh context) AFTER the verifier, maps PASS→APPROVE, and completes on all-PASS in the same turn; the M5 full chain reaches `completed` through the review panel; the FAIL/round-cap branches return without `complete_target`.

---

## Task 3 — `index.ts` review-FAIL recycling: fix-subgoal materialization + fresh re-verify + escalation (SC2 recycling)

**Dependencies:** Task 2
**Files:** Modify `index.ts`, `tests/goal-workflow.test.ts`

- [ ] **Step 1 — `materializeReviewFixSubgoals(ctx, state, goal, verdicts)` (D5).** For each REJECT verdict, `applyGoalMutation({ type: "create_subgoal", subgoal: { id: nextSubgoalId(state), goalId: goal.id, title: \`Fix review finding: ${v.member}\`, objective: \`Fix review finding: ${v.member} — ${v.findings ?? "address the review blocker"}\` } })` (re-read `state`/`nextSubgoalId` between iterations so ids stay unique). Return the updated `state`.
- [ ] **Step 2 — Wire the FAIL branch.** In `runGoalLevelCompletion`, replace the Task-2 placeholder FAIL branch with: `state = await materializeReviewFixSubgoals(ctx, state, goal, verdicts)` → `queue_continuation({ reason: "review_fix" })` → `sendGoalContinuationFollowUp(buildGoalOrchestratorPrompt(state))` → RETURN. No `complete_target`.
- [ ] **Step 3 — Tests: FAIL recycles into fix subgoals (no thrown error).** `it("review FAIL materializes fix subgoals and recycles through the worker loop without completing", …)`: default 2-subgoal contract; a mock where critics APPROVE, `plan-validator` PASS, `reviewer-verifier` PASS, and `qa-reviewer` FAILs the FIRST review round with a `Blockers:\n- missing-edge-case-test` finding then PASSes subsequently, `security-reviewer` always PASS. Drive turns: activation, subgoal-1 cycle, subgoal-2 cycle, goal-level (verifier PASS → review FAIL). Assert: NO throw; `state.goals[0].status !== "completed"`; a new subgoal exists whose title starts `Fix review finding:` and whose text contains `missing-edge-case-test`; `state.continuation.reason === "review_fix"`; the last follow-up contains `The runtime is implementing subgoals`; `currentPhase` stayed `goal_active` (assert via the absence of any `goal_drafting` transition on this path — e.g. no escalation follow-up sent).
- [ ] **Step 4 — Tests: fresh verifier PASS precedes the FULL panel re-run.** Continue the Step-3 run: drive the fix-subgoal worker→validator cycle turn(s), then the goal-level re-entry. Assert: a SECOND `reviewer-verifier` dispatch occurred (fresh re-verify) BEFORE the second review-panel round; `state.panels.find(p => p.panelId === "goal-review-panel").round === 2` (re-opened); with the reviewers now all-PASS, `state.goals[0].status === "completed"` and `state.status === "completed"`. This pins resolution row #92 (fresh `request_completion`→verifier PASS before the full panel re-run).
- [ ] **Step 5 — Tests: same-finding third failure escalates.** `it("escalates after the 3-round review panel cap without completing", …)`: `qa-reviewer` FAILs every review round (worker/validator always PASS so the fix subgoals "complete" but the review keeps failing). Drive enough turns to reach the 4th would-be review round. Assert: a `sendUserMessage` contains `did not converge after 3 rounds`; `state.panels.find(p => p.panelId === "goal-review-panel").round === 3` (capped, not re-opened to 4); `state.goals[0].status !== "completed"`; the final follow-up is the escalation, NOT the orchestrator prompt.
- [ ] **Step 6 — Verify.** `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts` green; `npm run build` clean.

**Acceptance:** a review FAIL materializes `Fix review finding:` subgoals, queues `review_fix`, and returns WITHOUT `complete_target` (recycling, not a thrown error); the fix subgoals drain through the worker→validator loop; the goal-level re-entry re-verifies fresh before re-opening the FULL review panel and completes on all-PASS; a 3-round review cap escalates without completing.

---

## Task 4 — goal-workflow tests: trivial-escape review-gated, phase held, ungated golden, mini-integration (SC2 remainder)

**Dependencies:** Task 3
**Files:** Modify `tests/goal-workflow.test.ts`

- [ ] **Step 1 — Trivial-escape still review-gated.** `it("a trivial-escape goal still runs the security/qa review panel at completion", …)`: draft a TRIVIAL 1-subgoal contract (`suggestedSubgoals` length 1, `successCriteria` length ≤2 ⇒ trivial). Turn 1 confirms + activates ungated-panel but `gates.review === true` (assert `state.goals[0].gates` = `{ validator: true, review: true }`, `gates.panel` undefined, no critic dispatch). Drive to goal-level completion. Assert `security-reviewer` + `qa-reviewer` were dispatched and the goal completed only after the review panel is all-APPROVE.
- [ ] **Step 2 — Phase held at `goal_active`.** Reuse the Task-3 review-FAIL run (or add a focused test): assert that across the review-FAIL recycle turns, `currentPhase` never becomes `goal_drafting` (observable via: no contract-panel/escalation follow-up strings; the orchestrator follow-up is sent). Since `currentPhase` is module-internal, pin it indirectly — the follow-up on a review FAIL is `buildGoalOrchestratorPrompt` (marker present), NOT a drafting/escalation prompt.
- [ ] **Step 3 — Manual/ungated golden (no review panel).** Keep `it("manual /goal create→activate→complete never confirms and stays ungated")` (goal-workflow.test.ts:739) green; ADD an assertion that no `runAgent` call used `agentName === "security-reviewer"` or `"qa-reviewer"` (the ungated manual path never opens a review panel — the reducer's review clause never fires because `gates.review` is absent).
- [ ] **Step 4 — Mini-integration both-PASS.** `it("mini-integration: fresh goal → subgoals PASS → verifier PASS → security+qa PASS → completed", …)`: default 2-subgoal contract, `flaggedChainMock` (all PASS). Drive the full chain to completion. Assert the dispatch sequence includes `reviewer-verifier` THEN `security-reviewer`+`qa-reviewer` on the goal-level turn, exactly one review panel round (`round === 1`), and `state.status === "completed"`. (Front-half-to-first-subgoal is covered by the M5 smoke; this pins the review tail.)
- [ ] **Step 5 — Verify.** `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts` green; `npm run build` clean.

**Acceptance:** a trivial goal is still review-gated; the review-FAIL path holds phase at `goal_active`; the manual/ungated path opens no review panel; the both-PASS mini-integration completes through a single review round.

---

## Task 5 — `skills/agentic-goal/SKILL.md` completion language + skill-docs pins (SC3)

**Dependencies:** Task 0
**Files:** Modify `skills/agentic-goal/SKILL.md`, `tests/skill-docs.test.ts`

- [ ] **Step 1 — Pins first (failing).** In `tests/skill-docs.test.ts` `it("agentic-goal requires durable goal runtime, todos, evidence, and verifier PASS")` (skill-docs.test.ts:28): ADD `expect(src).toContain("the runtime opens the security/qa review panel")` (or the exact review-completion phrase you write) and a review/fix pin (e.g. `expect(src).toContain("review FAIL recycles into fix subgoals")`), and `expect(src).not.toContain("Goal PASS: stop")` (old semantics gone). Keep ALL existing pins (M5 "Who Implements", `verifier subagent returns PASS`, `verifier returns FAIL`, `todoread`, etc.) and the legacy-skill-absence loop.
- [ ] **Step 2 — Skill edits (D8).** In `SKILL.md`, replace the `Goal PASS: stop; the active goal is complete.` line (SKILL.md:46) with review-gate completion language: on goal-verifier PASS the runtime opens the security/qa review panel; the goal completes only when both PASS; any review FAIL recycles into fix subgoals driven by the loop. Do NOT remove the verifier/FAIL language the existing pins depend on, and do NOT touch the M5 "Who Implements" section.
- [ ] **Step 3 — Verify.** `cd extensions/agentic-harness && npm test -- tests/skill-docs.test.ts` green; `npm run build` clean.

**Acceptance:** the skill documents review-gated completion + fix recycling; the old "Goal PASS: stop" line is gone; new pins green; every prior agentic-goal/clarification pin still holds.

---

## Task 6 (Final) — Full verification gate + audit + diff sanity (SC4)

**Dependencies:** Tasks 0-5
**Files:** None (fix only failures this task surfaces)

- [ ] **Step 1 — Full gate.** `cd extensions/agentic-harness && npm test && npm run build`. Expected: entire suite green (≥ M5 baseline 73 files / 800 tests + M6's added tests) and typecheck clean. In particular `tests/goal-events.test.ts`, `tests/agents.test.ts`, `tests/verdict-format.test.ts`, `tests/subgoal-validator.test.ts`, `tests/goal-continuation.test.ts`, `tests/extension.test.ts` stay green (no events/agent/format/validator/continuation/registration change).
- [ ] **Step 2 — Review-wiring audit.** `grep -n 'REVIEW_PANEL_ID\|goal-review-panel\|gates: { panel: true, validator: true, review: true }\|gates: { validator: true, review: true }\|dispatchReviewPanel\|materializeReviewFixSubgoals\|review_fix\|"security-reviewer", "qa-reviewer"' index.ts goal-state.ts`. Expected: the review clause + constant in `goal-state.ts`; `gates.review` on both `create_goal` forks; `dispatchReviewPanel` + `materializeReviewFixSubgoals` + the `review_fix` continuation inside `runGoalLevelCompletion`; `REVIEW_PANEL_ID` referenced (not a raw string) in the reducer clause. `grep -n "PASS.*APPROVE\|APPROVE.*REJECT" index.ts` shows the mapping lives ONLY in `dispatchReviewPanel`.
- [ ] **Step 3 — Diff sanity.** `git diff --stat`. Expected: the ONLY changed files under `extensions/agentic-harness/` are `goal-state.ts`, `index.ts`, `skills/agentic-goal/SKILL.md`, `tests/goal-state.test.ts`, `tests/goal-workflow.test.ts`, `tests/skill-docs.test.ts` (plus this plan doc). Confirm `goal-events.ts`, `goal-storage.ts`, `goal-verifier.ts`, `verdict-format.ts`, `subgoal-validator.ts`, `goal-continuation.ts`, every `agents/*.md`, `discipline.ts`, and every clarification module are NOT in the diff. Any other changed file is out of scope — revert it.

**Acceptance:** all four milestone Success Criteria satisfied; `npm test && npm run build` green; diff limited to the six allowed source/test files (+ this plan). `goal-events.ts` and `goal-continuation.ts` are NOT in the diff (scope reductions confirmed).

---

## Rollback Plan

M6 edits two source files (`goal-state.ts` — one constant + one invariant clause; `index.ts` — two gate literals + the `runGoalLevelCompletion` rewrite + review-panel helpers) plus one skill and three test files. It adds NO reducer command, NO state field, NO tool, and no persisted-schema change — the panel primitive (M1), review agents (M3), completion invariant (M2), and worker loop (M5) are CONSUMED. Blast radius is `runGoalLevelCompletion` + the two `create_goal` gate literals + the one reducer clause.

1. If the full gate fails late and the cause is isolated to the recycling engine, revert Task 3's `materializeReviewFixSubgoals` + the FAIL branch to the Task-2 placeholder (no `complete_target`, orchestrator follow-up) — the review panel still gates completion (all-PASS completes; FAIL stalls at `goal_active` awaiting user), losing only the auto-fix recycling.
2. Fastest safe de-risk WITHOUT full revert: drop `review: true` from both `create_goal` forks (Task 2 Step 2). Every auto-created goal is then review-unflagged ⇒ the reducer clause never fires and `runGoalLevelCompletion` takes the non-review PASS branch (D3 step 3) ⇒ M5 verifier-only completion is restored with zero review dispatch, while the reducer clause + helpers sit dormant. Keeps the pipeline live while the review panel is debugged.
3. If a follow-up/prompt string disturbs a pin, restore the touched file from `HEAD` and re-apply only the non-string helper additions.
4. Because no reducer command/state/storage schema is added (only a completion-time READ of an existing panel), there is no persistence/replay/`schemaVersion` concern — a run created before M6 replays byte-identically; a run with a review panel replays through the M1 panel machinery already proven in that milestone.
5. Full abort: `git checkout -- extensions/agentic-harness/` restores everything. M6 is an abort-point milestone (completes brief SC1); dropping it leaves M1–M5 intact (full autonomous loop minus the final review gate).

## Self-Review

- **Spec coverage:** Maps 1:1 to the four milestone SCs. SC1 (reducer throws with `gates.review` unless the review panel is all-PASS; flag-absent unchanged) → Task 1. SC2 (review FAIL ⇒ fix subgoals + recycling, NOT a thrown error; fresh `request_completion`→verifier PASS before the FULL panel re-run; both-PASS completes; same-finding third failure escalates; phase held `goal_active`; trivial-escape review-gated) → Tasks 2 (happy path) + 3 (recycle/fresh-verify/escalate) + 4 (trivial/phase/golden/mini-integration). SC3 (SKILL.md completion language; "Goal PASS: stop" gone; legacy list holds) → Task 5. SC4 (full gate + build) → Task 6.
- **Task-count discipline:** 7 tasks (0 baseline-lock + 6 impl/test), well under the 12 ceiling and the milestone's split-if->12 threshold — NO split needed. Natural seams if ever required: Task 2/3 both edit `index.ts` (happy path vs. recycling) and end green independently; the goal-workflow assertions split across Tasks 2/3/4 so each closes with a crisp binary check.
- **The riskiest task is Task 3** (the recycling engine): it is the only multi-turn behavioral change, mitigated by (a) fix-subgoal reactivation being reducer-native (Task 0 Check D — `create_subgoal` on an all-complete goal auto-activates), (b) freshness being structural (`runGoalLevelCompletion` always re-verifies at the top of every goal-level turn, so the panel re-run cannot follow a stale verifier — Task 0 confirmed fix subgoals don't stale the goal receipt at the reducer level either), (c) the review dispatch being the proven `dispatchContractPanel` block verbatim, and (d) Task 2 isolating the gating + happy-path blast radius first so Task 3's failures are purely recycling failures.
- **PASS/FAIL → APPROVE/REJECT mapping decision:** map at the ORCHESTRATION layer inside `dispatchReviewPanel` (`parsed.verdict === "PASS" ? "APPROVE" : "REJECT"`), the single mapping site; the reducer's review clause reuses `isPanelApproved` (all expected members APPROVE) with NO `PanelVerdict` type change and NO edit to the review agents' `.md` bodies. Verdict parsing reuses `parseGoalVerifierOutput` (case-insensitive `VERDICT:` match, fail-closed → FAIL), so a non-success dispatch or a malformed reviewer output becomes REJECT — the panel fails closed.
- **Freshness / staleness honesty:** SC2's "fresh `request_completion` → verifier PASS precedes the FULL panel re-run" is guaranteed by `runGoalLevelCompletion`'s structure (every goal-level turn re-verifies before opening the panel), AND is safe at the reducer level (fix-subgoal `subgoal_created` ledger rows carry a `subgoalId` and so never stale the GOAL-target verifier receipt via `entryMatchesTarget`). Both are pinned by Task 3 Step 4 (a second `reviewer-verifier` dispatch + review-panel `round === 2` before completion).
- **Golden/byte-compat honesty:** the reducer review clause fires ONLY for `gates.review === true` GOAL targets, so (a) the manual/ungated path (Task 4 Step 3, one negative assertion — no security/qa dispatch) and (b) every pre-M6 flag-absent completion (Task 1 golden) are byte-identical. The M5 full-chain completion test is rewritten (not merely extended) exactly as M5 rewrote M4b's transitional assertions — turn 4 now routes through the review panel, kept green by the `flaggedChainMock` extension.
- **Scope flags for the orchestrator:** (1) **`goal-events.ts` is NOT touched** — every command M6 dispatches (`open_panel`, `record_panel_verdict`, `create_subgoal`, `complete_target`, `request_completion`, `queue_continuation`) is already allowlisted (Task 0 Check B); the milestone's allowed set lists `goal-events.ts` "ONLY if a new command needs an allowlist clause" — none does. (2) **`goal-continuation.ts` is NOT touched** — the review-fix continuation reuses the free-form `queue_continuation.reason` (`review_fix`) and `buildGoalOrchestratorPrompt`; no new `GoalContinuationDecision` variant is needed (the milestone listed it "if needed"). (3) **The review panel runs synchronously within the goal-level completion turn** (mirroring the contract panel), unlike the deferred worker loop — the fix-subgoal RECYCLING is what spans turns, not the panel dispatch itself. (4) **Changed-scope summary** for the review task is approximated from completed-subgoal titles + recorded evidence (no git-diff integration exists in this harness); the review agents' `.md` checklists still drive the actual review. If a NO-GO surfaces at Task 0 (e.g. a command turns out un-allowlisted, or `create_subgoal` does not auto-activate on an all-complete goal), STOP and flag — those would pull `goal-events.ts` or a reducer body into scope.
