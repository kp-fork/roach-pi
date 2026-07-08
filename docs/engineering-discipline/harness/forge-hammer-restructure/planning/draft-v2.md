# DRAFT v2 — Milestone DAG: forge→hammer 재구성

**Revision of v1** applying all accepted Round-1 findings (see `resolution-log.md` rows #1-37). Renumbering: v1 M1 split into v2 M1+M2; v1 M2→M3, M3→M4, M4→M5, M5→M6, M6→M7.

## Core design decisions (v2)

1. **Per-goal gates profile (the old/new-regime discriminator):** optional `GoalItem.gates?: { panel?: boolean; validator?: boolean; review?: boolean }`, set only via a new optional `create_goal` param. Absent/false ⇒ every new invariant is skipped. Old goals, old snapshots, and historical event logs load and replay unchanged (no schemaVersion bump). Each flag starts being set by `autoStartGoalRuntime` only in the milestone that ships that gate's producer: `panel` in M4, `validator` in M5, `review` in M6. Machinery milestones (M1/M2) set flags only inside test fixtures.
2. **Panel primitive with expected membership:** `open_panel` (panelId, purpose, expectedMembers[], round) + `record_panel_verdict` (panelId, member, verdict, findings) + all-of-N invariant: every expected member has APPROVE; missing/partial = NO (fail-closed). Rounds and verdicts persist via the reducer, so a killed process resumes a partial panel.
3. **Distinct gated activation:** new `activate_goal_gated` command carries the panelId and enforces all-of-N; plain `activate_goal` stays unconditional (replay/resume/manual and 5 existing test files untouched).
4. **Gate precedence (decided):** for a subgoal with `gates.validator`, completion requires latest **validator** PASS — the verifier receipt is NOT required at subgoal level (validator replaces it there); the verifier remains the goal-level gate; `gates.review` additionally requires security PASS + qa PASS at goal level.
5. **Multi-turn revise/recycle loops:** on panel REJECT (M4) or review FAIL (M6), the runtime records verdicts, then sends a findings-carrying follow-up so the **model** revises the contract / authors fix subgoals; re-entry re-runs the panel. Round counters live in reducer state; cap 3 checked on re-entry; breach ⇒ escalation follow-up.
6. **Single user approval gate:** the `draft_goal_contract`→autostart bridge confirms with the user for **every** contract (generalizing the high-risk-only confirm), fail-closed in non-interactive mode. This is the brief's "exactly one user gate."
7. **Proportionality escape (flagged for user at lock):** `suggestedSubgoals.length <= 1 && !isHighRiskGoalContract` ⇒ skip the critic panel (approval confirm still required).
8. **Worker identity:** subgoal implementation is performed by a dispatched **worker subagent** (per approved Context Brief), orchestrated by the goal runtime; the validator subagent receives contract/subgoal fields verbatim and never the worker's output.
9. **Assumption marker:** shared literal value-prefix `ASSUMPTION:` inside existing checklist `value` strings (no new status/action/command) — written by the clarification skill (M7), recognized as valid content by the critic checklists (M3), carried into contract text so panels can see it.

**Execution order:** Wave 1: M1 ∥ M3 ∥ M7 → Wave 2: M2 ∥ M5-prereq? no — Wave 2: M2 ∥ M4 → Wave 3: M5 → Wave 4: M6 → Wave 5: M_final.

---

### M1: Panel-verdict reducer machinery + gates profile

- **Goal:** Add the fail-closed all-of-N panel primitive (`open_panel`/`record_panel_verdict`/`activate_goal_gated` with expected membership and persisted rounds) and the per-goal `gates` profile to the reducer — replay-safe, with zero live behavior change (no caller sets any flag yet).
- **Success Criteria:**
  1. `npm test -- tests/goal-state.test.ts`: the all-of-N invariant approves only when EVERY expected member has APPROVE; zero-verdict and partial-verdict panels are rejected (missing = NO).
  2. `npm test -- tests/goal-state.test.ts`: `activate_goal_gated` throws without a satisfied panel and succeeds with one; plain `activate_goal` remains unconditional (existing cases in `session-replay.test.ts`, `goal-command.test.ts`, `goal-continuation.test.ts`, `compaction.test.ts`, `goal-state.test.ts` pass unmodified).
  3. `npm test -- tests/goal-events.test.ts`: `open_panel`, `record_panel_verdict`, `activate_goal_gated`, and the `create_goal` gates param round-trip through replay (allowlist clauses present; nothing dropped as "Ignored invalid goal-state-event").
  4. Full event-log replay with NO snapshot of a fixture log whose activations/completions predate the new commands reconstructs the goal in its original status (gates absent ⇒ invariants skipped) — new test in `tests/goal-events.test.ts`.
  5. `grep -c "schemaVersion" goal-storage.ts` output unchanged and the literal remains `1`; `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None
- **Files affected:** Modify `goal-state.ts` (gates field; panel state incl. round; 3 new commands; new ledger types; all-of-N invariant helper; conditional enforcement wiring), `goal-events.ts` (allowlist clauses + replay fixture test), `goal-storage.ts` (normalization `?? {}`/`?? []` guards), `tests/goal-state.test.ts`, `tests/goal-events.test.ts`.
- **Risk:** High — the all-of-N + gates-conditional enforcement is the novel load-bearing mechanism; a mistake here invalidates every downstream gate.
- **Effort:** Large
- **User Value:** None visible yet by design (zero behavior change); a unit-proven gate vocabulary all later milestones consume.
- **Abort Point:** Yes — honest: nothing changes for the user; the codebase gains a tested, dormant primitive.
- **Evidence:** Lens R "Critic-panel aggregation is NET-NEW"; resolution rows #6 (activate_goal overload), #24 (expected membership), #34-36 (replay retroactivity, gates discriminator, mid-panel resume); Lens R persistence/replay constraints.

### M2: Validator receipts + failure budget reducer machinery

- **Goal:** Add per-subgoal validator receipts (identity, replay clause, and the decided replaces-verifier-at-subgoal-level conditional precondition) and make the dormant `consecutiveFailures` counter live — all writes reducer-owned, gated behind `gates.validator`, zero live behavior change.
- **Success Criteria:**
  1. `npm test -- tests/goal-state.test.ts`: with `gates.validator` set in the fixture, subgoal `complete_target` throws without a latest validator PASS receipt and succeeds with exactly `{validator PASS}` (no verifier receipt required at subgoal level); with gates absent, the existing verifier-receipt rule applies unchanged.
  2. `npm test -- tests/goal-events.test.ts`: a `record_validator_receipt` carrying the new validator agent identity round-trips replay (dedicated `isValidatorReceipt` clause; the goal-events.ts:41 hard-equality no longer drops it).
  3. `npm test -- tests/goal-state.test.ts`: the shared reducer helper increments `consecutiveFailures[targetId]` on FAIL and resets on PASS for ALL THREE receipt commands (`record_verifier_result`, `record_validator_receipt`, `record_panel_verdict`), and the count survives the `clear_continuation`-before-`record` ordering of the `/goal complete` path.
  4. Full event-log replay (no snapshot) of a fixture log with pre-validator-era subgoal completions reconstructs them as completed — new test in `tests/goal-events.test.ts`.
  5. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M1 (same files; counter hooks into `record_panel_verdict`)
- **Files affected:** Modify `goal-state.ts` (validatorReceipts field + `record_validator_receipt` + validator agent identity + conditional subgoal precondition + `bumpFailureBudget` helper wired into all receipt commands), `goal-events.ts` (`isValidatorReceipt` clause + fixtures), `tests/goal-state.test.ts`, `tests/goal-events.test.ts`.
- **Risk:** Medium — extends proven receipt patterns; the precedence decision is made here once, with the pinned-test edits in the same change.
- **Effort:** Medium
- **User Value:** None visible yet by design; the subgoal gate and failure budget exist and are unit-proven, dormant until M5.
- **Abort Point:** Yes — dormant machinery; no behavior change.
- **Evidence:** Lens R "Per-subgoal receipts ALREADY EXIST … thin extension" + "3-failure budget pre-wired but DEAD"; resolution rows #7/#15/#22 (precedence), #21 (planGoalContinuation is pure ⇒ reducer owns writes), #23/#33 (identity + goal-events.ts:41), #9/#20 (single counter owner; clear_continuation ordering), #34 (replay fixture).

### M3: Binary-checklist agent roster + verdict-format contract

- **Goal:** Reframe the three holistic reviewers into binary contract-granularity critics, add security-reviewer + qa-reviewer (impl-critic fraud checks folded in), and create the shared verdict-format module (grammar constants + APPROVE/REJECT parser) that both the .md bodies and the runtime consume — with round-trip fixture tests.
- **Success Criteria:**
  1. `npm test -- tests/agents.test.ts`: pinned roster holds (`reviewer-feasibility/architecture/risk` present under unchanged names; `security-reviewer`/`qa-reviewer` added; `synthesis`/`reviewer-dependency`/`reviewer-user-value` absent); each reframed/new reviewer body contains the mechanical verdict rule ("unchecked is NO") and the `VERDICT:` line spec; no graded scales remain; qa-reviewer contains the folded fraud checks.
  2. `npm test -- tests/agents.test.ts`: each of the three contract-critic bodies contains the shared `ASSUMPTION:` recognition rule (assumption-marked defaults are valid content, not invented decisions/placeholders).
  3. New `tests/verdict-format.test.ts`: a fixture verdict block in the exact format the .md files prescribe parses via the new panel parser to APPROVE; a REJECT fixture parses to REJECT; malformed input is rejected (not silently defaulted); a drift assertion pins each .md's VERDICT-line spec to the shared exported constant.
  4. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None
- **Files affected:** Modify `agents/reviewer-feasibility.md`, `agents/reviewer-architecture.md`, `agents/reviewer-risk.md`; Create `agents/security-reviewer.md`, `agents/qa-reviewer.md`, `verdict-format.ts` (shared grammar + parser), `tests/verdict-format.test.ts`; Modify `tests/agents.test.ts`.
- **Risk:** Low-Medium — content + a pure parser module; no runtime wiring.
- **Effort:** Medium
- **User Value:** Reviewable binary-checklist roster with a machine-verified output contract.
- **Abort Point:** Yes — standalone documentation + a tested parser.
- **Evidence:** Lens S "reviewer-* are holistic/prose … need reframing"; Lens G checklists/receipt format verbatim; resolution rows #13/#26 (format contract + parser ownership), #4 (ASSUMPTION recognition rule).

### M4: Auto-chain + universal approval gate + panel orchestration

- **Goal:** Bridge `draft_goal_contract` into `autoStartGoalRuntime` behind a user confirm for EVERY contract (fail-closed non-interactive), then gate activation on the 3-critic panel via `open_panel`/`record_panel_verdict`/`activate_goal_gated` (setting `gates.panel`), with the multi-turn revise loop (persisted rounds, cap 3, escalation), restart resume, and the trivial-contract escape.
- **Success Criteria:**
  1. `npm test -- tests/goal-workflow.test.ts` (mocked `runAgent` returning M3-format verdicts): drafting a non-trivial contract prompts a confirm; on approval the panel dispatches all 3 critics in parallel; activation occurs only via `activate_goal_gated` after 3 APPROVEs; subgoals then complete through the EXISTING verifier gate (`gates.validator` not yet set) — the post-M4 pipeline is coherent end-to-end.
  2. `npm test -- tests/goal-workflow.test.ts`: any REJECT sends a findings follow-up and re-entry re-dispatches the FULL panel with an incremented persisted round; a 4th round escalates to the user without activation; a killed-and-restored session with a drafted contract, recorded approval, and no active goal re-enters the panel flow.
  3. `npm test -- tests/goal-workflow.test.ts`: a non-high-risk contract without approval does NOT autostart (the confirm is universal); non-interactive mode refuses to autostart (fail-closed); a trivial contract (`suggestedSubgoals.length <= 1 && !high-risk`) skips the panel but still requires the confirm.
  4. `npm test -- tests/verdict-format.test.ts` unchanged-green (the orchestration consumes the M3 parser; drift assertion holds) and `npm test -- tests/extension.test.ts` green for registration/prompt-surface changes.
  5. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M1, M3
- **Files affected:** Modify `index.ts` (bridge at draft_goal_contract handler; universal confirm; panel dispatch via `runAgent` parallel; reducer command calls; follow-up revise loop; restore re-entry; trivial escape), `tests/goal-workflow.test.ts`, `tests/extension.test.ts`.
- **Risk:** High — first live parallel dispatch + the already-pinned auto-chain surface + the multi-turn loop, at one seam (watch-item: task count near the 12 ceiling; parsing/reducer work already offloaded to M1/M3).
- **Effort:** Large
- **User Value:** The single-gate flow ships: contract → one confirm → critic panel → auto-started goal runtime; trivial contracts skip the panel tax.
- **Abort Point:** Yes — honest: a panel-gated one-touch auto-chain whose subgoals complete via the existing verifier gate.
- **Evidence:** Lens R autostart seam + ui.confirm precedent; Lens S programmatic parallel dispatch; resolution rows #8 (multi-turn loop), #29 (universal confirm), #30 (trivial escape), #36 (mid-panel resume), #18 (criterion split — reducer half lives in M1 SC2).

### M5: Worker→validator subgoal loop + 3-strike halt

- **Goal:** Dispatch a worker subagent per subgoal and an information-isolated validator whose PASS satisfies M2's conditional precondition (autostart now sets `gates.validator`), re-dispatching the worker with accumulated verdict feedback on FAIL, and halt auto-continuation with an escalation summary after 3 consecutive FAILs on the same target.
- **Success Criteria:**
  1. `npm test -- tests/goal-workflow.test.ts` (mocked `runAgent`): for a `gates.validator` goal, a subgoal completes only after a validator PASS receipt (worker → validator sequence observed in dispatch order); a validator FAIL re-dispatches the worker with ALL prior verdict feedback included in its prompt; goals without the flag keep the verifier path.
  2. New unit test on the exported validator prompt builder: the prompt contains the subgoal's objective/criteria/evidence texts exactly and does NOT contain an arbitrary worker-output marker string passed to the dispatch layer.
  3. `npm test -- tests/goal-continuation.test.ts` (modify existing 265-line file): the legacy "keeps retrying after repeated failures without a max failure budget" case (line 152) is REPLACED by cases proving `planGoalContinuation` returns a halt/escalation decision (not follow_up) after 3 consecutive FAILs on the same target, and the escalation follow-up carries the blocker summary.
  4. Mini-chain smoke in `tests/goal-workflow.test.ts`: contract → approval → panel APPROVE×3 → autostart → one subgoal worker→validator PASS → subgoal completed, in one scripted sequence.
  5. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M2, M4
- **Files affected:** Modify `index.ts` (worker + validator programmatic dispatch on the subgoal path; accumulated-feedback retry; autostart sets `gates.validator`), Create `subgoal-validator.ts` (exported prompt builder + output parsing into the M2 receipt shape), Modify `goal-continuation.ts` (read-only halt decision), `tests/goal-workflow.test.ts`, `tests/goal-continuation.test.ts`, new `tests/subgoal-validator.test.ts`.
- **Risk:** Medium-High — orchestration of two sequential subagents per subgoal with retry accumulation; reducer machinery already proven in M2.
- **Effort:** Large
- **User Value:** Subgoals now implement-and-independently-validate autonomously, and runaway failure loops self-halt with an escalation summary.
- **Abort Point:** Yes — the autonomous execution loop is complete except the final review panel.
- **Evidence:** Lens S runGoalVerifier as reference + worker roster; Lens G validator template/isolation verbatim + 3-strike rule; resolution rows #3 (worker = subagent), #14 (legacy test replacement), #16 (prompt-builder unit test), #21 (halt is read-only), #5 (mini-chain smoke).

### M6: Final security/qa review panel + completion gate + fix recycling

- **Goal:** Gate goal completion on a parallel security+qa panel via the panel primitive (autostart sets `gates.review`), convert blocking FAIL findings into fix subgoals through the multi-turn follow-up path and re-run the FULL panel after they complete, and update the goal SKILL.md so its gate language matches the new runtime (rules 7/9 + orchestration wording).
- **Success Criteria:**
  1. `npm test -- tests/goal-state.test.ts`: with `gates.review` set, goal-level `complete_target` throws unless the review panel (security + qa expected members) is all-PASS; with the flag absent, existing behavior unchanged.
  2. `npm test -- tests/goal-workflow.test.ts`: a review-panel FAIL produces a follow-up that yields fix subgoals; after they complete through the M5 cycle the FULL panel re-runs; both-PASS completes the goal; a same-finding third failure escalates.
  3. `npm test -- tests/skill-docs.test.ts`: updated goal SKILL.md pins — completion language references validator/review gates (old "Goal PASS: stop" semantics gone), orchestration wording present, legacy negative list still holds.
  4. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M5, M7 (skill-docs.test.ts file-serialization: M7 edits the same test file in Wave 1)
- **Files affected:** Modify `index.ts` (review panel dispatch on the completion path; fix-subgoal materialization follow-up; autostart sets `gates.review`), `skills/agentic-goal/SKILL.md`, `tests/goal-state.test.ts`, `tests/goal-workflow.test.ts`, `tests/skill-docs.test.ts`.
- **Risk:** Medium-High — recycling control flow across turns; panel machinery and follow-up loop both proven by M4/M5 at this point.
- **Effort:** Large
- **User Value:** The full self-terminating pipeline: security/qa gate completion, FAILs auto-recycle into fixes, everything escalates instead of looping.
- **Abort Point:** Yes — this completes the brief's end-to-end Success Criterion 1.
- **Evidence:** Lens G review-panel recycling verbatim; resolution rows #3 (SKILL.md rules 7/9 must move with the runtime), #8 (multi-turn recycling), #35 (gates.review staging).

### M7: Forge-style clarification skill rewrite

- **Goal:** Rewrite `agentic-clarification/SKILL.md` to recon-first + ONE bundled question round (max 4, survivors only) with defensible defaults recorded as `ASSUMPTION:`-prefixed checklist values that flow into the drafted contract — no new reducer action/status, no index.ts changes, clarify name kept.
- **Success Criteria:**
  1. `npm test -- tests/skill-docs.test.ts`: rewritten clarification SKILL.md pins — recon-before-questions, single bundled ≤4-question round, defensible-default language, and the literal `ASSUMPTION:` prefix present; one-question-at-a-time language absent; legacy negative list holds.
  2. `npm test -- tests/clarification-state.test.ts`: an `ASSUMPTION:`-prefixed `mark_checklist_item` value counts toward `canDraftGoalContract`, is retrievable from state with the prefix intact, and appears in the drafted contract text.
  3. `npm test -- tests/clarification-events.test.ts`: the assumption-fill flow replays cleanly with NO new command types (allowlist untouched).
  4. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None (Wave-1 root; file-disjoint from M1/M3)
- **Files affected:** Modify `skills/agentic-clarification/SKILL.md`, `tests/skill-docs.test.ts`, `tests/clarification-state.test.ts`, `tests/clarification-events.test.ts` (clarification-state.ts expected UNCHANGED — value-prefix convention only).
- **Risk:** Low-Medium — substring-pinned prose + convention tests only.
- **Effort:** Medium
- **User Value:** Clarification stops interrogating one question at a time; recon-grounded defaults with at most one bundled round.
- **Abort Point:** Yes — standalone UX improvement.
- **Evidence:** Lens G forge question round verbatim; resolution rows #19 (marker retrievable + in contract), #25/#37 (value-prefix, no index.ts/allowlist changes), #4 (shared prefix with M3).

### M_final: Integration Verification

- **Goal:** Validate that all milestones compose into the brief's single-gate autonomous pipeline with no regressions.
- **Success Criteria:**
  1. New full-chain integration case in `tests/goal-workflow.test.ts` (scripted `runAgent` mock in M3 verdict formats): vague-request contract → user confirm (asserted invoked EXACTLY once) → panel APPROVE×3 → autostart → two subgoals each worker→validator PASS → goal verifier PASS → review panel security+qa PASS → goal status `completed`, with zero additional user-input calls.
  2. Same chain with one injected validator FAIL round and one review-panel FAIL round still converges (retry + fix-subgoal recycling paths exercised) within the failure budget.
  3. `cd extensions/agentic-harness && npm test && npm run build` passes in full (all pinning tests across all milestones).
  4. All M1-M7 success criteria remain met after full integration (spot-check by re-running their named test files).
- **Dependencies:** ALL (M1-M7)
- **Files affected:** Modify `tests/goal-workflow.test.ts` (test-only; no production code)
- **Risk:** Medium (integration defects between independently-verified milestones)
- **Effort:** Small
- **User Value:** Proof the system works as a whole — the brief's Success Criterion 1 demonstrated in CI.
- **Abort Point:** No (final gate)
- **Evidence:** Resolution rows #5/#17 (chain test + confirm-exactly-once specified up front).

---

**DAG summary:** Roots M1, M3, M7 (pairwise file-disjoint: goal reducer+its tests / agents+format module+its tests / clarification skill+its tests). Wave 2: M2 (deps M1) ∥ M4 (deps M1, M3) — disjoint (goal-state/events vs index.ts+workflow/extension tests). Wave 3: M5 (deps M2, M4). Wave 4: M6 (deps M5, M7 — the M7 edge serializes shared `tests/skill-docs.test.ts`). Wave 5: M_final (deps ALL). No cycles. 7 implementation milestones + 1 verification milestone (count guard: 8 > 7 — flagged to the user at lock).
