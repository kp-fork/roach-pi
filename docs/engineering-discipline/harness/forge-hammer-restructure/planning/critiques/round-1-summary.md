# Round 1 Critiques — verbatim finding statements + key evidence

Full texts live in the planning session transcript. This file preserves each finding's verbatim statement and the load-bearing evidence lines for downstream plan-crafting. Resolutions: see `../resolution-log.md` (rows #1-37).

## Integration & Risk (2 Blocking / 3 Concern)
- [Blocking] "M1 turns on the validator-receipt completion precondition three milestones before its only producer (M4), breaking the existing verifier-only subgoal path in between." Evidence: live path index.ts:2017-2033 writes reviewer-verifier receipts into `SubgoalItem.verifierReceipts` (goal-state.ts:73,310), never `validatorReceipts[]`; M1 SC6 unsatisfiable; replay drops historical complete_target ("Ignored invalid goal-state-event").
- [Blocking] "M3's autostart drives the runtime straight into M1's unsatisfiable precondition, with no failure budget to halt until M5." Evidence: buildGoalAutoPrompt → /goal complete → throw → caught (index.ts:2045) → continuation re-injects → infinite retry; goal-continuation.ts:21-54 has zero failure-count awareness.
- [Concern] goal SKILL.md untouched-claim becomes false after M5 (Core Rule 9 "Goal PASS: stop" vs security/qa panel + fix recycling); worker identity (main agent vs subagent) contradiction unresolved.
- [Concern] M6↔M2 semantic interface: assumption-marked defaults indistinguishable from "invented decisions"/"placeholders" under the critic checklists → panel deadlock → escalation, defeating single-gate promise.
- [Concern] M_final unspecified while being the riskiest integration; pull a thin e2e smoke earlier (post-M4).

## Hidden Complexity (3 Blocking / 3 Concern / 1 Nit)
- [Blocking] "M1's 'additive, optional-field-only' claim is false for the panel gate — a reducer-level activate_goal precondition breaks ≥4 existing test files not in any milestone's scope." Evidence: activate_goal invoked panel-less by session-replay.test.ts:147, goal-command.test.ts:119, goal-continuation.test.ts:113/217, compaction.test.ts:64, goal-state.test.ts:87; replay best-effort drop (goal-events.ts:156-164) silently loses activation.
- [Blocking] "M4 cannot make the validator the subgoal completion gate without modifying assertCompletionInvariant and the /goal complete subgoal branch — reopening goal-state.ts." Evidence: assertCompletionInvariant (goal-state.ts:541-578) already gates subgoals on verifier receipts; stacking deadlocks (nothing produces subgoal verifier receipts in M4's design), replacing changes pinned semantics.
- [Blocking] "M3 and M5 describe the revise/recycle loops as in-function runtime loops, but contract revision and fix-subgoal authoring are model-driven and multi-turn — no runtime mechanism can perform them." Evidence: contract revision requires the model's draft_goal_contract (index.ts:558); an in-function for-loop re-dispatches critics against an unchanged contract, deterministically burning all 3 rounds.
- [Concern] consecutiveFailures increment split across record_verifier_result / record_validator_receipt / record_panel_verdict introduced in three different milestones.
- [Concern] M5 bundles three features; tests/goal-continuation.test.ts already exists (265 lines) and activates goals directly; realistic task count exceeds 12.
- [Concern] M3 Large with two upstream deps, edits the two largest pinned test files (goal-workflow 452 lines, extension 1436 lines) while introducing first live parallel dispatch.
- [Nit] "create if absent" factual error.

## Verifiability (3 Blocking / 4 Concern / 1 Nit)
- [Blocking] "No criterion exercises the verdict-format contract between M2's agent output and the M3/M4/M5 runtime parsers — and the only parser that exists can't read what critics must emit." Evidence: parseGoalVerifierOutput (goal-verifier.ts:88) matches only `/^Verdict:\s*(PASS|FAIL)\s*$/im`; APPROVE/REJECT appears in zero runtime .ts files; runtime prompt-builder (buildGoalVerifierPrompt, goal-verifier.ts:36-84), not the .md body, governs emitted format; mocked runAgent hides drift.
- [Blocking] "M5 mislabels an existing test file and omits updating a test that pins the exact opposite of M5's deliverable." Evidence: goal-continuation.test.ts:152 `it("keeps retrying after repeated failures without a max failure budget")` records five FAILs and asserts follow_up continues.
- [Blocking] "M1 SC2's 'succeeds with one [validator receipt]' is undecidable/possibly-unsatisfiable — supplements vs replaces the verifier gate unresolved."
- [Concern] M4 SC2 ("code inspection … verbatim … no worker-output field") not binary-decidable → exported prompt builder + not.toContain(W) unit test.
- [Concern] Brief SC1 end-to-end flow verified by no milestone; define M_final with the chain test + "confirm/sendUserMessage invoked exactly once".
- [Concern] M3 SC2 "test A or test B" disjunction lets the reducer-level guarantee go unverified.
- [Concern] M6 SC2 vacuous — mark_checklist_item with any non-empty value already clears the gate; assumption marker semantics never proven to exist.
- [Nit] clear_continuation runs BEFORE record_verifier_result on /goal complete; counter must survive that ordering (goal-state.ts:431-438).

## Dependency & Ordering (4 Blocking / 2 Concern / 1 Nit)
- [Blocking] "The consecutiveFailures counter mutation is owned by BOTH M1 and M5, and M5's assigned location physically cannot host it." Evidence: planGoalContinuation is a pure (state, receipt, ctx) → decision function; double-wiring halts after ~1.5 real failures.
- [Blocking] "M1's subgoal 'validator PASS precondition' collides with the existing verifier-PASS precondition that already gates subgoal completion — replace-vs-add unspecified; M4 deadlocks under one reading." Evidence: assertCompletionInvariant reads subgoal.verifierReceipts.at(-1); /goal complete runs runGoalVerifier for subgoal targets (index.ts:2022).
- [Blocking] "The validator receipt's agent-name literal and its replay-allowlist clause are needed by M1 (root) but the literal-widening is assigned to M4 (leaf)." Evidence: isVerifierReceipt hard-equals "reviewer-verifier" (goal-events.ts:41); M1 SC2/SC4 unachievable without owning the widening.
- [Blocking] "M1's 'all-of-N, missing = NO' invariant is unimplementable from the drafted field shape" — a verdict map records only arrivals; zero/one-vote panels pass trivially (fail-open) without declared expected membership.
- [Concern] M6's "avoids index.ts" conditional — mark_checklist_item tool call passes no status param (index.ts:551); a distinct status requires an index.ts edit.
- [Concern] APPROVE/REJECT parser net-new and unassigned; format contract must be a shared literal.
- [Nit] "create if absent."

## Value & Sequencing (2 Blocking / 2 Concern / 1 Nit)
- [Blocking] "M1 activates a subgoal-completion gate whose satisfying receipt is not produced until M4 — breaking a pinned test and the live daily-driver loop for the entire M1→M4 window." Evidence: goal-continuation.test.ts:82-108 drives `goal.handler("complete subgoal-1")` with mocked reviewer-verifier PASS and asserts activeSubgoalId==="subgoal-2"; M1's Files-affected omits the file; daily driver cannot complete any subgoal until M4.
- [Blocking] "M3 deletes the user's only approval checkpoint for non-high-risk contracts, so the common case auto-launches the full autonomous pipeline with zero user gate — the opposite of the brief's promise." Evidence: today's manual /goal IS the approval gate; ctx.ui.confirm fires only for isHighRiskGoalContract (index.ts:1777-1784).
- [Concern] Panels-always = fixed 3-to-9 subagent tax on every goal incl. trivial ones; no proportionality escape.
- [Concern] M3/M4 abort points are traps downstream of Blocking #1.
- [Nit] "create if absent."
- Survived attacks: first-value-too-late (M6 in Wave 1), M6-degrades-daily-driver (it loosens the gate), M2-breaks-flows (additive).

## Migration & Compatibility (3 Blocking / 2 Concern)
- [Blocking] "The hard-coded verifierAgent 'reviewer-verifier' literal drops validator receipts on replay, and neither M1 nor M4 lists the surface that must widen." Evidence: type pin at goal-state.ts:73; replay validator hard-equality at goal-events.ts:41; drop path goal-events.ts:143-145. M4's "goal-verifier.ts (widen literal)" mislocated — that file only holds GOAL_VERIFIER_AGENT const (:3).
- [Blocking] "New completion invariants are applied retroactively during full event-log replay, silently regressing goals completed under old code; M1's backward-compat criterion doesn't cover this path." Evidence: restoreGoalStateFromSnapshotAndEvents uses `snapshot?.state ?? createGoalState(...)` (goal-events.ts:177); null snapshot reachable via worktree/different-cwd/PI_GOAL_STATE_ROOT; old complete_target events throw → caught-and-skipped → completed goals revert.
- [Blocking] "The 'gated behind additive optional fields' strategy is hand-waved; with no schemaVersion bump there is no discriminator between old- and new-regime goals, so new gates apply universally." Fix adopted: per-goal `gates` profile at create_goal, absent/false ⇒ skip.
- [Concern] No durable resume if the process dies mid-panel: currentPhase is module-level, restore does not re-invoke autoStartGoalRuntime; drafted-contract-without-goal stalls silently once the manual /goal gate is gone.
- [Concern] M6's conditionally-worded clarification allowlist changes; isClarificationCommand has the identical default-false allowlist (clarification-events.ts:75). Mitigation: assumption fits inside existing `value` — no schema change.
- Survived attacks: old snapshot loading (normalization is shape-tolerant), objectiveHash unaffected by new fields, live-runtime resumed old goals (runtime regenerates receipts), counter replay (already in persisted shape), forward-compat rollback (acceptable, note as accepted risk).
