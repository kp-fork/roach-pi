# DRAFT v3 — Milestone DAG: forge→hammer 재구성

**Revision of v2** applying all accepted Round-2 findings (resolution-log rows #38-66). Change vs v2: M4 split into **M4a/M4b**; M5 takes ownership of the who-implements prompt surface; failure budget scoped to verifier/validator receipts only; migration SCs hardened.

## Core design decisions (v3)

1. **Per-goal gates profile:** optional `GoalItem.gates?: { panel?: boolean; validator?: boolean; review?: boolean }`, set ONLY via a new optional `create_goal` param and **materialized by the reducer** into `goals[].gates`. Absent/false ⇒ every new invariant is skipped; the gates-absent completion branch stays behavior-identical to today (golden test). Flags start being set by autostart in the milestone shipping that gate's producer: `panel` in M4b, `validator` in M5, `review` in M6.
2. **In-flight goals are NOT re-gated** (gates frozen at create). Mitigation: long-run drains active goals at milestone boundaries; M_final starts a fresh goal. A goal straddling a deploy runs the pipeline it was created with — accepted and bounded.
3. **Panel primitive:** top-level `GoalState.panels: PanelState[]` keyed by panelId — `open_panel` (panelId, purpose, expectedMembers[], round) + `record_panel_verdict` (panelId, member, verdict APPROVE|REJECT, findings) + all-of-N invariant (every expected member APPROVE; missing/partial = NO). `createGoalState` initializes it; `cloneState` deep-clones it; snapshot + replayed-events mixed resume covered by test. Panel round-cap (3) is its own counter inside PanelState — **separate from the failure budget**.
4. **Distinct gated activation:** new `activate_goal_gated` (carries panelId) enforces all-of-N; plain `activate_goal` stays unconditional (replay/resume/manual and the 5 existing test files untouched). Forward-compat accepted risk: `activate_goal_gated` replayed on OLDER code is dropped (downgrade unsupported — mirrors the schemaVersion no-migration stance).
5. **Gate precedence:** subgoal with `gates.validator` ⇒ completion requires latest **validator** PASS (verifier NOT required at subgoal level); verifier remains the goal-level gate; `gates.review` additionally requires the review panel all-PASS at goal level.
6. **Failure budget:** `bumpFailureBudget` lives in the reducer, wired into `record_verifier_result` and `record_validator_receipt` ONLY (per-target key; increment on FAIL, reset on PASS; survives clear_continuation ordering). Panel verdicts NEVER touch it — panel rounds have their own cap (#3).
7. **Multi-turn revise/recycle loops:** on panel REJECT (M4b) or review FAIL (M6), the runtime records verdicts then sends a findings follow-up so the **model** revises the contract / authors fix subgoals; re-entry re-runs the panel; persisted round counter, cap 3, breach ⇒ escalation. Phase during the M4b revise loop: `goal_drafting`; during the M6 recycle loop: `goal_active`; both re-derived on restore.
8. **Single user approval gate + drift protection:** the `draft_goal_contract`→autostart bridge confirms with the user for EVERY contract (fail-closed non-interactive). If any panel round revised the contract after that approval, a lightweight **re-confirm with the contract diff** runs before `activate_goal_gated` — the user always approves the artifact that actually activates.
9. **Trivial escape (panel-ONLY):** `suggestedSubgoals.length <= 1 && successCriteria.length <= 2 && !isHighRiskGoalContract` ⇒ skip the contract critic panel (approval confirm still required; `gates.validator`/`gates.review` still set once M5/M6 ship — trivial goals still get validator + review gates).
10. **Who implements (the M5 seam):** for `gates.validator` goals the **runtime worker loop owns implementation**: after activation (and after each subgoal completion) the runtime dispatches worker → validator programmatically for the next runnable subgoal, applies `record_validator_receipt` + `complete_target` itself, and the main agent becomes an orchestrator/observer (its auto/continuation prompts for such goals are rewritten to say so — `buildGoalAutoPrompt`, both goal-continuation prompt builders, goal SKILL.md all move to M5's scope). The worker loop is the **sole retry driver** for validator FAILs (the completion path queues no `verifier_fail` continuation for gates.validator subgoals); the 3-strike halt reads the validator-loop counts. Goals WITHOUT the flag keep today's main-agent-implements flow unchanged.
11. **Old flow survives:** manual `/goal create` → `activate` → `complete` remains an ungated, panel-free, main-agent-implements escape hatch forever. Only the `draft_goal_contract` autostart bridge is gated.
12. **Verdict grammars:** M3's `verdict-format.ts` owns the **panel APPROVE/REJECT** grammar (shared constant referenced by both the critic .md bodies and the runtime parser, with round-trip fixture + drift tests). Validator/verifier receipts keep the existing `Verdict: PASS|FAIL` grammar (goal-verifier.ts). The `ASSUMPTION:` literal is cross-checked in M_final across clarification SKILL.md and the three critic .md files.

**Execution order:** Wave 1: M1 ∥ M3 ∥ M7 ∥ M4a → Wave 2: M2 ∥ M4b → Wave 3: M5 → Wave 4: M6 → Wave 5: M_final.

---

### M1: Panel-verdict reducer machinery + gates profile

- **Goal:** Add the fail-closed all-of-N panel primitive (`GoalState.panels[]`, `open_panel`/`record_panel_verdict`/`activate_goal_gated`, expected membership, persisted rounds) and the per-goal `gates` profile to the reducer — replay-safe, deep-clone-safe, with zero live behavior change.
- **Success Criteria:**
  1. `npm test -- tests/goal-state.test.ts`: the all-of-N invariant approves only when EVERY expected member has APPROVE; zero-verdict and partial-verdict panels are rejected (missing = NO); `activate_goal_gated` throws without a satisfied panel and succeeds with one; plain `activate_goal` remains unconditional (the 5 existing activate-callers' test files pass unmodified).
  2. `npm test -- tests/goal-state.test.ts`: `create_goal` with a `gates` param MATERIALIZES `goals[].gates` in the reducer output; a malformed `gates` value (e.g. a string) is rejected by `isGoalCommand` (negative test); the gates-absent `complete_target` branch is behavior-identical to current (golden test replaying a pre-gates completion sequence).
  3. `npm test -- tests/goal-state.test.ts`: `createGoalState` initializes `panels`; `cloneState` deep-clones it — mutation-isolation test (apply two `record_panel_verdict`, assert the input state object is unmutated).
  4. `npm test -- tests/goal-events.test.ts`: `open_panel`, `record_panel_verdict`, `activate_goal_gated`, and gates-carrying `create_goal` round-trip replay (allowlist clauses; nothing dropped); full event-log replay with NO snapshot of a pre-gates fixture log reconstructs original statuses; MIXED resume test — snapshot taken mid-panel (round 2, one verdict) + one more verdict event replayed on top yields the correct panel state.
  5. `grep` shows `schemaVersion` still `1` in goal-storage.ts; `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None
- **Files affected:** Modify `goal-state.ts` (gates field materialization; `panels` state + init + deep-clone clause; 3 new commands; ledger types; all-of-N invariant helper; conditional enforcement), `goal-events.ts` (allowlist clauses + replay/mixed-resume fixtures), `goal-storage.ts` (normalization guards), `tests/goal-state.test.ts`, `tests/goal-events.test.ts`.
- **Risk:** High — the novel load-bearing mechanism; everything downstream consumes it.
- **Effort:** Large
- **User Value:** None visible by design; a unit-proven, dormant gate vocabulary.
- **Abort Point:** Yes — zero behavior change; tested dormant primitive.
- **Notes:** Forward-compat accepted risk recorded: new commands replayed on older code are dropped (downgrade unsupported).
- **Evidence:** Lens R "Critic-panel aggregation is NET-NEW"; resolution rows #6, #24, #34-36, #41, #54, #56, #58, #60.

### M2: Validator receipts + failure budget reducer machinery

- **Goal:** Add per-subgoal validator receipts (type + identity + replay clause + the replaces-verifier-at-subgoal-level conditional precondition) and make the dormant `consecutiveFailures` counter live for verifier/validator receipts — reducer-owned, gated behind `gates.validator`, zero live behavior change.
- **Success Criteria:**
  1. `npm test -- tests/goal-state.test.ts`: with `gates.validator` set in the fixture, subgoal `complete_target` throws without a latest validator PASS receipt and succeeds with exactly `{validator PASS}` (no verifier receipt at subgoal level); with gates absent, the existing verifier rule applies unchanged.
  2. `npm run build` green with `GoalVerifierReceipt.verifierAgent` widened at goal-state.ts:73 to a union including the named validator identity (or a distinct validator receipt type — decided here); `npm test -- tests/goal-events.test.ts`: `record_validator_receipt` round-trips replay through a NEW `isValidatorReceipt` allowlist branch keyed on the command type (NOT a loosening of `isVerifierReceipt` — a mislabeled verifier receipt must not satisfy the validator gate).
  3. `npm test -- tests/goal-state.test.ts`: `bumpFailureBudget` increments `consecutiveFailures[targetId]` on FAIL and resets on PASS for `record_verifier_result` AND `record_validator_receipt` (panel verdicts excluded by design), and the count survives the `clear_continuation`-before-`record` ordering of the `/goal complete` path.
  4. Full event-log replay (no snapshot) of a pre-validator-era fixture reconstructs its subgoal completions as completed — `tests/goal-events.test.ts`.
  5. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M1 (same files)
- **Files affected:** Modify `goal-state.ts` (validatorReceipts + `record_validator_receipt` + identity union + conditional subgoal precondition + `bumpFailureBudget`), `goal-events.ts` (`isValidatorReceipt` + fixtures), `tests/goal-state.test.ts`, `tests/goal-events.test.ts`.
- **Risk:** Medium — extends proven receipt patterns; precedence decided here once with pinned-test edits in the same change.
- **Effort:** Medium
- **User Value:** None visible by design; dormant until M5.
- **Abort Point:** Yes — dormant machinery.
- **Evidence:** Lens R per-subgoal receipts + dead counter; resolution rows #7/#15/#22, #9/#20/#21, #23/#33, #40/#44/#57 (budget scope), #55 (both widening surfaces), #34/#60 (replay fixtures).

### M3: Binary-checklist agent roster + panel verdict-format contract

- **Goal:** Reframe the three holistic reviewers into binary contract-granularity critics, add security-reviewer + qa-reviewer (impl-critic fraud checks folded in), and create the panel-verdict format module (APPROVE/REJECT grammar constant + parser) that both the critic .md bodies and the runtime consume — with round-trip fixture and drift tests.
- **Success Criteria:**
  1. `npm test -- tests/agents.test.ts`: pinned roster holds (three reviewer-* names unchanged; security-reviewer/qa-reviewer added; excluded legacy names absent); every reframed/new reviewer body contains the mechanical verdict rule ("unchecked is NO") and the `VERDICT:` line spec; no graded scales remain; qa-reviewer contains the folded fraud checks.
  2. `npm test -- tests/agents.test.ts`: each contract-critic body contains the `ASSUMPTION:` recognition rule (assumption-marked defaults are valid content, not invented decisions/placeholders).
  3. New `tests/verdict-format.test.ts`: an APPROVE fixture in the exact .md-prescribed format parses to APPROVE; REJECT parses to REJECT; malformed input errors (not silently defaulted); a drift assertion pins each critic .md's VERDICT-line spec to the shared exported constant.
  4. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None
- **Files affected:** Modify `agents/reviewer-{feasibility,architecture,risk}.md`; Create `agents/security-reviewer.md`, `agents/qa-reviewer.md`, `verdict-format.ts` (panel APPROVE/REJECT grammar ONLY — validator/verifier keep the existing PASS/FAIL grammar), `tests/verdict-format.test.ts`; Modify `tests/agents.test.ts`.
- **Risk:** Low-Medium | **Effort:** Medium
- **User Value:** Reviewable binary-checklist roster with a machine-verified output contract.
- **Abort Point:** Yes.
- **Evidence:** Lens S/G as v2; resolution rows #13/#26, #4, #48 (scope narrowed to panel grammar).

### M4a: Auto-chain bridge + universal approval gate

- **Goal:** Bridge `draft_goal_contract` into `autoStartGoalRuntime` behind a user confirm for EVERY contract (fail-closed non-interactive), activating via the EXISTING unconditional path — no panel yet; subgoals keep the current verifier flow.
- **Success Criteria:**
  1. `npm test -- tests/goal-workflow.test.ts`: drafting a contract prompts a confirm; on approval the goal auto-creates/activates and the auto prompt fires (no manual `/goal`); on decline nothing activates; non-interactive mode refuses to autostart (fail-closed); the high-risk path still confirms.
  2. `npm test -- tests/goal-workflow.test.ts` + `tests/extension.test.ts`: pinned auto-chain/registration assertions updated in the same change; the manual `/goal create→activate→complete` path remains untouched and ungated (explicit test).
  3. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None (Wave-1 root; file-disjoint from M1/M3/M7)
- **Files affected:** Modify `index.ts` (draft_goal_contract handler → autostart; universal confirm generalizing index.ts:1777-1784), `tests/goal-workflow.test.ts`, `tests/extension.test.ts` (named work: update pinned auto-chain/registration assertions).
- **Risk:** Medium — pinned surface, but a small, coherent seam change.
- **Effort:** Medium
- **User Value:** One-touch auto-chain ships immediately: contract → confirm → goal starts (verifier-gated, familiar interactive implementation). Old manual flow survives (decision #11).
- **Abort Point:** Yes — honest: today's pipeline plus a single approval gate and no manual `/goal`.
- **Evidence:** Resolution rows #38 (split), #29 (universal confirm), #51 (old flow); Lens R autostart seam.

### M4b: Contract critic panel orchestration

- **Goal:** Gate autostart activation on the 3-critic panel (`open_panel` → parallel dispatch → `record_panel_verdict` ×3 → `activate_goal_gated`, setting `gates.panel`), with the multi-turn REJECT revise loop (persisted rounds, cap 3, escalation), re-confirm-with-diff when the panel revised the approved contract, restart resume, and the panel-only trivial escape.
- **Success Criteria:**
  1. `npm test -- tests/goal-workflow.test.ts` (mocked `runAgent` returning M3-format verdicts): a non-trivial approved contract dispatches all 3 critics in parallel; activation occurs only via `activate_goal_gated` after 3 APPROVEs; subgoals then complete through the existing verifier gate (`gates.validator` not yet set).
  2. `npm test -- tests/goal-workflow.test.ts`: any REJECT sends a findings follow-up (phase held at `goal_drafting`); re-entry re-dispatches the FULL panel with an incremented persisted round; a 4th round escalates without activation; if any round revised the contract, a re-confirm with the diff runs before activation (no re-confirm when unrevised).
  3. `npm test -- tests/goal-workflow.test.ts`: a killed-and-restored session with a drafted contract, recorded approval, and no active goal re-enters the panel flow; a trivial contract (`suggestedSubgoals.length <= 1 && successCriteria.length <= 2 && !high-risk`) skips the panel but still requires the confirm.
  4. `npm test -- tests/verdict-format.test.ts` and `tests/extension.test.ts` green (parser consumed unchanged; registration pins updated — named work).
  5. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M1, M3, M4a
- **Files affected:** Modify `index.ts` (panel dispatch; reducer command calls; revise loop; re-confirm-on-diff; restore re-entry; trivial escape), `tests/goal-workflow.test.ts`, `tests/extension.test.ts`.
- **Risk:** High — first live parallel dispatch + multi-turn loop on the pinned auto-chain surface.
- **Effort:** Large
- **User Value:** Contracts are adversarially vetted before a goal starts; the user always approves the contract version that activates.
- **Abort Point:** Yes — full forge-equivalent front half (recon→contract→panel→gated start) with familiar execution.
- **Evidence:** Lens G Anvil loop; resolution rows #8 (multi-turn), #49 (re-confirm), #30/#52/#65 (trivial escape, panel-only), #36 (resume), #66 (phase ownership).

### M5: Worker→validator subgoal loop + 3-strike halt

- **Goal:** For `gates.validator` goals, the runtime worker loop owns subgoal implementation (worker subagent → information-isolated validator → `record_validator_receipt` + `complete_target` applied by the runtime), the main agent's prompts are rewritten to orchestrator language, the worker loop is the sole retry driver with accumulated feedback, and the 3-strike budget halts with an escalation summary. Plan cycle starts with a Task-0 design confirmation of the orchestration seam.
- **Success Criteria:**
  1. `npm test -- tests/goal-workflow.test.ts` (mocked `runAgent`): for a `gates.validator` goal, subgoal implementation dispatches worker then validator (order asserted via mock call sequence); the runtime applies the receipt and completion; the auto/continuation prompts sent to the main agent contain orchestrator language and do NOT instruct it to implement; a goal without the flag keeps today's main-agent-implements prompts byte-compatible.
  2. `npm test -- tests/goal-workflow.test.ts`: a validator FAIL re-dispatches the worker with ALL prior verdict feedback in its prompt and queues NO `verifier_fail` continuation (exactly one retry driver — asserted); a trivial-escape goal still requires a validator PASS.
  3. New `tests/subgoal-validator.test.ts`: the exported validator prompt builder output contains the subgoal's objective/criteria/evidence texts exactly and does NOT contain an arbitrary worker-output marker string.
  4. `npm test -- tests/goal-continuation.test.ts` (modify existing 265-line file): the legacy line-152 "keeps retrying … without a max failure budget" case is REPLACED by cases proving the halt fires after 3 consecutive validator FAILs on the same target with a blocker-summary escalation (exercised via the validator dispatch path, not only a synthetic call).
  5. Mini-chain smoke in `tests/goal-workflow.test.ts`: contract → confirm → panel APPROVE×3 → autostart → one subgoal worker→validator PASS → subgoal completed. Then `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M2, M4b, M7 (shared `tests/skill-docs.test.ts` serialization — M7 lands in Wave 1)
- **Files affected:** Modify `index.ts` (worker loop + autostart sets `gates.validator`; `buildGoalAutoPrompt` orchestrator branch), `goal-continuation.ts` (halt read + both continuation prompt builders' who-implements language), `skills/agentic-goal/SKILL.md` (who-implements language for flagged goals), Create `subgoal-validator.ts` (prompt builder + PASS/FAIL parsing into the M2 receipt shape), Modify `tests/goal-workflow.test.ts`, `tests/goal-continuation.test.ts`, `tests/skill-docs.test.ts`, new `tests/subgoal-validator.test.ts`.
- **Risk:** High — changes who implements; mitigated by the flag branch (unflagged goals byte-compatible) and the Task-0 seam confirmation.
- **Effort:** Large
- **User Value & tradeoff (stated):** flagged goals gain isolated implement→validate autonomy and self-halting retries; the COST is live steerability and per-subgoal subprocess latency — implementation moves out of the conversation. Unflagged/manual goals keep the interactive flow (decision #11).
- **Abort Point:** Yes — informed: stop here and you have the full autonomous loop minus the final review panel; stop BEFORE here (at M4b) and you keep interactive implementation with a vetted-contract front half.
- **Evidence:** Lens S runGoalVerifier reference; Lens G validator isolation + 3-strike; resolution rows #39 (seam decision + spike), #61/#62 (prompt ownership, single retry driver), #46 (halt via validator path), #14 (legacy test), #16 (prompt-builder test), #50 (tradeoff), #65 (trivial still validated).

### M6: Final security/qa review panel + completion gate + fix recycling

- **Goal:** Gate goal completion on a parallel security+qa panel via the panel primitive (autostart sets `gates.review`), convert blocking FAIL findings into fix subgoals through the follow-up path (named re-trigger seam: fix-subgoal completion queues a continuation instructing a goal-level completion re-request, which re-runs the FULL panel), and align the goal SKILL.md completion language.
- **Success Criteria:**
  1. `npm test -- tests/goal-state.test.ts`: with `gates.review`, goal-level `complete_target` throws unless the review panel (security+qa expected members) is all-PASS; flag absent ⇒ unchanged (this is the invariant's third edit — named work in goal-state.ts).
  2. `npm test -- tests/goal-workflow.test.ts`: a review FAIL materializes fix subgoals from blocking findings; their completion (through the M5 cycle) queues the re-request continuation; the re-request re-runs the FULL panel; both-PASS completes; a same-finding third failure escalates; phase held at `goal_active` throughout; a trivial-escape goal still requires review PASS.
  3. `npm test -- tests/skill-docs.test.ts`: goal SKILL.md completion language references validator/review gates (old "Goal PASS: stop" semantics gone); legacy negative list holds.
  4. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M5
- **Files affected:** Modify `index.ts` (review panel dispatch; fix-subgoal materialization; autostart sets `gates.review`), `goal-state.ts` (review clause in the completion invariant), `skills/agentic-goal/SKILL.md`, `tests/goal-state.test.ts`, `tests/goal-workflow.test.ts`, `tests/skill-docs.test.ts`.
- **Risk:** Medium-High — cross-turn recycling; panel + follow-up machinery proven by M4b/M5. Flagged as a split candidate if plan-time task count exceeds 12.
- **Effort:** Large
- **User Value:** Self-terminating pipeline: security/qa gate completion; FAILs recycle into fixes; escalation instead of loops. Old manual flow still ungated.
- **Abort Point:** Yes — completes brief Success Criterion 1.
- **Notes:** Accepted residual (documented): if the model never re-requests completion after fixes, the goal stays active until user intervention — identical to today's failure mode; pi has no turn-end hook to force it.
- **Evidence:** Lens G recycling; resolution rows #8, #63 (seam + residual), #42 (invariant third edit), #3 (SKILL.md), #65, #66.

### M7: Forge-style clarification skill rewrite

- **Goal:** Rewrite `agentic-clarification/SKILL.md` to recon-first + ONE bundled question round (max 4, survivors only) with defensible defaults recorded as `ASSUMPTION:`-prefixed checklist values that flow byte-identical into the drafted contract — no new reducer action/status, no index.ts changes, clarify name kept.
- **Success Criteria:**
  1. `npm test -- tests/skill-docs.test.ts`: recon-before-questions, single bundled ≤4-question round, defensible-default language, literal `ASSUMPTION:` present; one-question-at-a-time language absent; legacy negative list holds.
  2. `npm test -- tests/clarification-state.test.ts`: an `ASSUMPTION:`-prefixed value counts toward `canDraftGoalContract`, is retrievable with the prefix intact, and appears BYTE-IDENTICAL in the drafted goalContract text (no strip/normalize — protects the downstream objectiveHash).
  3. `npm test -- tests/clarification-events.test.ts`: the flow replays cleanly with NO new command types.
  4. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None (Wave-1 root)
- **Files affected:** Modify `skills/agentic-clarification/SKILL.md`, `tests/skill-docs.test.ts`, `tests/clarification-state.test.ts`, `tests/clarification-events.test.ts` (clarification-state.ts UNCHANGED).
- **Risk:** Low-Medium | **Effort:** Medium
- **User Value:** Clarification stops interrogating; recon-grounded defaults, at most one bundled round.
- **Abort Point:** Yes.
- **Evidence:** Lens G forge round; resolution rows #19, #25/#37, #59 (byte-identical), #4.

### M_final: Integration Verification

- **Goal:** Validate that all milestones compose into the brief's single-gate autonomous pipeline with no regressions.
- **Success Criteria:**
  1. Full-chain integration case in `tests/goal-workflow.test.ts` (scripted `runAgent` mock in M3/verifier formats): contract → confirm (asserted EXACTLY once, plus one diff re-confirm only if a revision round is scripted) → panel APPROVE×3 → autostart → two subgoals worker→validator PASS → goal verifier PASS → review panel both-PASS → goal `completed`, zero other user-input calls. Runs on a FRESH goal (decision #2: frozen gates on old goals).
  2. Same chain with one injected validator FAIL round and one review FAIL round still converges within the failure budget (retry + fix-recycling exercised).
  3. Cross-file literal check: clarification SKILL.md and the three critic .md files contain the identical pinned `ASSUMPTION:` literal.
  4. `cd extensions/agentic-harness && npm test && npm run build` passes in full; each of M1-M7's named test files re-run green.
- **Dependencies:** ALL (M1-M7)
- **Files affected:** Modify `tests/goal-workflow.test.ts` (+ one cross-file assertion; test-only)
- **Risk:** Medium | **Effort:** Small
- **User Value:** The brief's Success Criterion 1 demonstrated in CI.
- **Abort Point:** No (final gate)
- **Evidence:** Resolution rows #5/#17, #47 (literal cross-check), #64 (fresh goal).

---

**DAG summary:** Wave 1 roots M1, M3, M7, M4a — pairwise file-disjoint (goal reducer+tests / agents+format+tests / clarification skill+tests / index.ts+workflow+extension tests). Wave 2: M2 (deps M1) ∥ M4b (deps M1, M3, M4a) — disjoint (goal-state/events+tests vs index.ts+workflow/extension tests). Wave 3: M5 (deps M2, M4b, M7). Wave 4: M6 (deps M5). Wave 5: M_final (deps ALL). No cycles. **9 milestones total (8 implementation + 1 verification) — exceeds the recommended 7; flagged to the user at lock with the rationale that M4a/M4b and M1/M2 splits were critic-mandated to keep each within a single plan cycle.**
