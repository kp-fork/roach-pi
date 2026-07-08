# DRAFT v4 (FINAL) — Milestone DAG: forge→hammer 재구성

**Revision of v3** applying all accepted Round-3 findings (resolution-log rows #67-92). Round cap reached; 0 Structural across all 3 rounds; all Blocking findings accepted and fixed. This is the lock candidate.

## Core design decisions (v4)

1. **Per-goal gates profile:** optional `GoalItem.gates?: { panel?: boolean; validator?: boolean; review?: boolean }`, set via a new optional `create_goal` param and **materialized by the reducer**. Absent ⇒ every new invariant skipped; gates-absent behavior byte-identical (golden test). Flags set by autostart only in the producer milestone: `panel` M4b, `validator` M5, `review` M6.
2. **In-flight goals are NOT re-gated** (frozen at create). Long-run drains active goals at milestone boundaries; M_final runs a fresh goal.
3. **Panel primitive:** top-level `GoalState.panels: PanelState[]` — `{ panelId, purpose, expectedMembers[], round, verdicts[] }` — via `open_panel` / `record_panel_verdict` (member, APPROVE|REJECT, findings) / all-of-N invariant (every expected member APPROVE; missing = NO). `createGoalState` initializes it; `cloneState` deep-clones it; survives snapshot+events mixed resume AND the pre-panels-snapshot upgrade path (`?? []` everywhere + normalization back-fill). Panel round-cap (3) lives in PanelState — separate from the failure budget.
4. **Distinct gated activation:** `activate_goal_gated` (carries panelId) enforces all-of-N; plain `activate_goal` unconditional forever (replay/resume/manual). Forward-compat accepted risk: new commands replayed on older code are dropped (downgrade unsupported).
5. **Gate precedence:** subgoal + `gates.validator` ⇒ latest **validator** PASS required (verifier not required at subgoal level; new `validator_pass`/`validator_fail` ledger types with a flag-conditional invariant ledger-lookup); verifier remains the goal-level gate; `gates.review` additionally requires the review panel all-PASS at goal level.
6. **Failure budget:** reducer-owned `bumpFailureBudget` wired into `record_verifier_result` + `record_validator_receipt` ONLY, and only when the target goal has `gates.validator` (ungated goals' counters untouched — zero live behavior change). Per-target key; FAIL increments, PASS resets; survives clear_continuation ordering. Panels never touch it.
7. **Single user approval gate — panel-first ordering:** `draft_goal_contract` → (trivial escape? skip panel) → critic panel loop to convergence (multi-turn revise via findings follow-ups, persisted rounds, cap 3, deadlock ⇒ escalate) → present the CONVERGED contract for the **one** user confirm (fail-closed non-interactive) → `activate_goal_gated` in the same turn. No pre-panel confirm, no re-confirm; the user always approves exactly the artifact that activates. (Matches brief SC1 and glm-hammer's Anvil ordering. Cost: critics may run on a contract the user later declines — accepted; the user drove clarification interactively and the trivial escape bounds the tax.)
8. **Restart semantics (consistent everywhere):** restore reconstructs state but sends no follow-up; resuming a mid-pipeline run takes ONE user turn (accepted residual — pi has no turn-end/session-start auto-continuation). Mid-panel restarts are pre-approval, so "no input after approval" holds; the post-confirm/pre-activation crash window re-confirms on restart (documented, tiny).
9. **Trivial escape (panel-ONLY):** `suggestedSubgoals.length <= 1 && successCriteria.length <= 2 && !isHighRiskGoalContract` ⇒ skip the critic panel; the confirm and (once shipped) `gates.validator`/`gates.review` still apply. Goal SKILL.md additionally recommends the manual `/goal` path for small tasks.
10. **Who implements + drive model (decided): re-entrant runtime worker loop.** For `gates.validator` goals: worker subagent implements, information-isolated validator judges (fresh context; receives subgoal fields verbatim, never worker output), the runtime applies `record_validator_receipt` + `complete_target` itself, then queues a **self-continuation** (new continuation reason) that re-enters the loop next turn for the next runnable subgoal — preserving turn boundaries, mid-run visibility, and compaction safety. **The loop also owns goal-level completion**: after the last subgoal, a self-continuation triggers the goal-level completion request (verifier gate); goal-verifier FAIL blockers become fix subgoals driven by the same loop, or 3-strike escalate. The worker loop is the sole retry driver (no `verifier_fail` follow-up for flagged subgoals; `buildVerifierFailureContinuationPrompt` branches on the flag and never tells the observer main agent to implement). Main-agent prompts for flagged goals are rewritten to pinned orchestrator literals (MUST contain the orchestrator marker; MUST NOT contain "Implement the current active subgoal"); unflagged goals keep today's prompts byte-compatible. M5 Task-0 is a cheap conformance check of this decision, not a fork.
11. **Old flow survives:** manual `/goal create → activate → complete` remains ungated, panel-free, main-agent-implements — stated in M4a/M5/M6.
12. **Verdict grammars:** `verdict-format.ts` owns panel APPROVE/REJECT only (shared constant + parser + drift tests); validator/verifier keep the `Verdict: PASS|FAIL` grammar. `ASSUMPTION:` literal cross-checked in M_final across clarification SKILL.md and the three critic .md files; contract→goal field byte-identity asserted at the autostart handoff (protects objectiveHash).

**Execution order:** Wave 1: M1 ∥ M3 ∥ M7 → Wave 2: M2 ∥ M4a → Wave 3: M4b → Wave 4: M5 → Wave 5: M6 → Wave 6: M_final.

---

### M1: Panel-verdict reducer machinery + gates profile
- **Goal:** All-of-N panel primitive (`panels[]` per decision #3, `open_panel`/`record_panel_verdict`/`activate_goal_gated`) and the materialized per-goal `gates` profile — replay-safe, clone-safe, upgrade-safe, zero live behavior change.
- **Success Criteria:**
  1. goal-state tests: all-of-N approves only when EVERY expected member APPROVEs (zero/partial = rejected); `activate_goal_gated` throws without a satisfied panel, succeeds with one; plain `activate_goal` unconditional (5 existing caller test files pass unmodified).
  2. goal-state tests: `create_goal` MATERIALIZES `goals[].gates`; malformed `gates` rejected by `isGoalCommand` (negative test); gates-absent `complete_target` branch behavior-identical (golden pre-gates sequence).
  3. goal-state tests: `createGoalState` initializes `panels`; `cloneState` deep-clones it (mutation-isolation test).
  4. goal-events tests: new commands + gates-carrying create_goal round-trip replay; pre-gates fixture log (no snapshot) reconstructs original statuses; MIXED resume (snapshot mid-panel + verdict event on top) yields correct panel state; **UPGRADE test: a pre-panels snapshot (no `panels`, no `gates`) loaded via the real restore path + one legacy command applied ⇒ no throw**.
  5. `schemaVersion` still `1`; `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None | **Files:** `goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `tests/goal-state.test.ts`, `tests/goal-events.test.ts`
- **Risk:** High | **Effort:** Large (at ceiling — mixed-resume + upgrade fixtures are the long-pole; PanelState shape pinned in decision #3 to prevent mid-cycle discovery)
- **User Value:** none visible by design | **Abort Point:** Yes (safe-merge; no user-visible value)
- **Notes:** Forward-compat drop on downgrade = accepted risk.

### M2: Validator receipts + failure budget reducer machinery
- **Goal:** Distinct per-subgoal validator receipts (type, identity, `validator_pass`/`validator_fail` ledger types, replay clause, flag-conditional replaces-verifier subgoal precondition incl. the invariant's ledger-lookup widening) and the live-but-gated failure budget — zero live behavior change.
- **Success Criteria:**
  1. goal-state tests: with `gates.validator`, subgoal `complete_target` succeeds with exactly `{validator PASS receipt + validator_pass ledger row}` and throws without either (FULL invariant incl. ledger cross-check); gates absent ⇒ existing verifier rule byte-identical.
  2. `npm run build` green with a DISTINCT validator receipt type (preferred over widening the shared literal); `isValidatorReceipt` is a new allowlist branch keyed on the command type AND pinned to the validator identity literal; `isVerifierReceipt` stays identity-strict; forward negative test: a verifier-identity receipt is rejected by the validator gate (and vice versa).
  3. goal-state tests: `bumpFailureBudget` fires only for targets whose goal has `gates.validator` — increments on FAIL / resets on PASS for both receipt commands, survives clear_continuation ordering; an UNGATED FAIL leaves `consecutiveFailures` untouched.
  4. goal-events tests: pre-validator-era fixture replay reconstructs completions; validator receipt round-trips replay.
  5. Full suite + build green.
- **Dependencies:** M1 | **Files:** `goal-state.ts`, `goal-events.ts`, `tests/goal-state.test.ts`, `tests/goal-events.test.ts`
- **Risk:** Medium | **Effort:** Medium
- **User Value:** none visible by design | **Abort Point:** Yes (safe-merge; no user-visible value)

### M3: Binary-checklist agent roster + panel verdict-format contract
- (Unchanged from v3 except scope wording.) Reframe reviewer-feasibility/architecture/risk to binary contract-granularity critics; add security-reviewer + qa-reviewer (impl-critic fraud checks folded); create `verdict-format.ts` (panel APPROVE/REJECT grammar ONLY) + round-trip/drift tests; `ASSUMPTION:` recognition rule in each critic body.
- **Success Criteria:** as v3 M3 SC1-4 (roster pins; mechanical verdict rule; ASSUMPTION rule; fixture round-trip + drift assertion; suite green).
- **Dependencies:** None | **Files:** `agents/*.md` (3 modified, 2 created), `verdict-format.ts` (new), `tests/verdict-format.test.ts` (new), `tests/agents.test.ts`
- **Risk:** Low-Medium | **Effort:** Medium | **Abort Point:** Yes

### M7: Forge-style clarification rewrite + kickoff prompt ownership
- **Goal:** Rewrite the clarification skill AND the runtime clarify-kickoff prompts (the one-question-at-a-time behavior is hardcoded at index.ts:1193/1616/1619, not in the skill) to recon-first + ONE bundled ≤4-question round with `ASSUMPTION:`-prefixed defaults; clarify name kept.
- **Success Criteria:**
  1. skill-docs tests: rewritten SKILL.md pins (recon-first, bundled round, defaults, `ASSUMPTION:` literal; one-at-a-time language absent; legacy list holds).
  2. extension tests: the three index.ts kickoff/delegation prompt strings no longer contain "Ask ONE question" and do contain the bundled-round instruction (pinned substrings updated — M7 owns these pins).
  3. clarification tests: `ASSUMPTION:`-prefixed values don't block the gate and are retrievable with the prefix intact; replay clean with NO new command types.
  4. Full suite + build green.
- **Dependencies:** None (Wave 1) | **Files:** `skills/agentic-clarification/SKILL.md`, `index.ts` (kickoff prompt strings only), `tests/skill-docs.test.ts`, `tests/extension.test.ts`, `tests/clarification-state.test.ts`, `tests/clarification-events.test.ts`
- **Risk:** Medium (now touches index.ts + its pins) | **Effort:** Medium | **Abort Point:** Yes — live clarify behavior actually changes (the v3 SKILL.md-only version would have been non-functional).

### M4a: Auto-chain bridge + approval gate (transitional)
- **Goal:** Bridge `draft_goal_contract` → queued follow-up → confirm + `autoStartGoalRuntime` (existing unconditional activation; no panel yet), fail-closed non-interactive, with contract→goal byte-identity at the handoff.
- **Success Criteria:**
  1. goal-workflow tests: drafting a contract leads (via the queued follow-up path, not inline in the tool handler — ctx.ui.confirm availability verified for the chosen seam) to a confirm; approval ⇒ auto-create/activate + auto prompt (no manual `/goal`); decline ⇒ nothing activates; non-interactive ⇒ refuses (fail-closed); TRANSITIONAL NOTE: the activate-on-approval assertion is superseded by M4b's gated flow.
  2. goal-workflow tests: the autostart-created goal's objective/successCriteria/evidenceRequired equal the contract fields byte-for-byte (objectiveHash protection).
  3. goal-workflow + extension tests: pinned auto-chain/registration assertions updated; manual `/goal create→activate→complete` remains untouched and ungated (explicit test).
  4. Full suite + build green.
- **Dependencies:** M7 (index.ts + extension.test.ts serialization) | **Files:** `index.ts`, `tests/goal-workflow.test.ts`, `tests/extension.test.ts`
- **Risk:** Medium | **Effort:** Medium
- **User Value:** Removes the manual `/goal` step and adds a contract-review confirm (new for low-risk contracts). Old manual flow survives.
- **Abort Point:** Yes — today's pipeline + one approval gate, no manual `/goal`.

### M4b: Contract critic panel orchestration (panel-first single approval)
- **Goal:** Insert the 3-critic panel BEFORE the approval: `open_panel` → parallel dispatch → verdicts → on any REJECT a findings follow-up drives model revision (phase `goal_drafting`, persisted rounds, cap 3, deadlock ⇒ escalate) → on convergence present the converged contract for the ONE confirm → `activate_goal_gated` (sets `gates.panel`); trivial escape (panel-only) included.
- **Success Criteria:**
  1. goal-workflow tests (mocked runAgent, M3-format verdicts): non-trivial contract dispatches 3 critics in parallel; activation only via `activate_goal_gated` after 3 APPROVEs AND the post-convergence confirm; the confirm fires EXACTLY once per run and always on the converged contract text; subgoals then complete via the existing verifier gate.
  2. goal-workflow tests: REJECT ⇒ findings follow-up, re-entry re-runs the FULL panel with incremented persisted round; 4th round escalates without activation; trivial contract skips the panel but still confirms.
  3. goal-workflow tests: a killed-and-restored session mid-panel reconstructs panel state and re-enters the flow on the next goal-routed user turn (one-turn resume residual — decision #8); tests must not assert `consecutiveFailures` emptiness (M2 populates it in parallel wave).
  4. verdict-format + extension tests green (parser consumed; registration pins updated).
  5. Full suite + build green.
- **Dependencies:** M1, M3, M4a | **Files:** `index.ts`, `tests/goal-workflow.test.ts`, `tests/extension.test.ts`
- **Risk:** High | **Effort:** Large
- **User Value:** Contracts adversarially vetted before start; the single approval is of the exact artifact that activates.
- **Abort Point:** Yes — full forge-equivalent front half with familiar interactive execution.

### M5: Re-entrant worker→validator loop + goal-level ownership + 3-strike halt
- **Goal:** Implement decision #10 end-to-end for `gates.validator` goals (autostart sets the flag): re-entrant runtime loop dispatches worker → isolated validator per subgoal, applies receipt+completion, self-continues to the next subgoal AND to goal-level completion; sole retry driver with accumulated feedback; 3-strike halt + escalation; orchestrator prompts with pinned literals. Task-0: conformance check of the re-entrant seam.
- **Success Criteria:**
  1. goal-workflow tests: flagged goal — worker then validator dispatch order per subgoal; runtime applies receipt + completion; a self-continuation re-enters for the NEXT subgoal and, after the last, drives goal-level completion (verifier gate) — the full flagged chain reaches goal `completed` (or review-pending post-M6) with ZERO main-agent implement instructions; unflagged goal keeps today's prompts byte-compatible (golden), incl. both continuation builders.
  2. **Isolation (call-site):** worker mock emits a sentinel string; the validator's runAgent args contain the subgoal objective/criteria/evidence verbatim, do NOT contain the sentinel, and use `contextMode:"fresh"`.
  3. goal-workflow tests: validator FAIL re-dispatches the worker with ALL prior verdict feedback and queues NO `verifier_fail` follow-up (exactly one retry driver); goal-level verifier FAIL routes blockers into fix subgoals via the loop (or escalates); flagged prompts contain the pinned orchestrator marker and NOT "Implement the current active subgoal"; a trivial-escape goal still requires validator PASS.
  4. goal-continuation tests (modify existing 265-line file): legacy line-152 no-budget case REPLACED by the 3-strike halt (via the validator dispatch path) with blocker-summary escalation.
  5. Mini-chain smoke: contract → panel ×3 APPROVE → confirm → autostart → subgoal worker→validator PASS → subgoal completed. Full suite + build green.
- **Dependencies:** M2, M4b, M7 | **Files:** `index.ts`, `goal-continuation.ts` (halt read + new self-continuation reason + prompt builders' who-implements branches), `skills/agentic-goal/SKILL.md` (orchestrator language + manual-path recommendation for small tasks), Create `subgoal-validator.ts`, `tests/goal-workflow.test.ts`, `tests/goal-continuation.test.ts`, `tests/skill-docs.test.ts`, new `tests/subgoal-validator.test.ts`
- **Risk:** High | **Effort:** Large
- **User Value & tradeoff (stated):** flagged goals gain isolated implement→validate autonomy with self-halting retries; the COST is live steerability and per-subgoal subprocess latency. Unflagged/manual goals unchanged (decision #11).
- **Abort Point:** Yes — informed: stop at M4b for interactive execution with a vetted front half; stop here for the full autonomous loop minus the final review panel.

### M6: Final security/qa review panel + completion gate + fix recycling
- **Goal:** Review gate at goal completion (autostart sets `gates.review`) with the FIXED ordering — verifier PASS → open review panel → security+qa parallel → all-PASS ⇒ `complete_target`; any FAIL ⇒ fix subgoals + re-request continuation and NO `complete_target` call; recycling requires a FRESH post-fix verifier PASS before completion; goal SKILL.md completion language aligned.
- **Success Criteria:**
  1. goal-state tests: with `gates.review`, `complete_target` throws unless the review panel is all-PASS (invariant's third edit — named); flag absent ⇒ unchanged.
  2. goal-workflow tests: review FAIL materializes fix subgoals (driven via M5's loop), does NOT call `complete_target` (recycling, not a thrown error); after fixes, a fresh `request_completion` → verifier PASS precedes the FULL panel re-run; both-PASS completes; same-finding third failure escalates; a trivial-escape goal still requires review PASS.
  3. skill-docs tests: goal SKILL.md completion language references validator/review gates (old "Goal PASS: stop" gone); legacy list holds.
  4. Full suite + build green.
- **Dependencies:** M5 | **Files:** `index.ts`, `goal-state.ts`, `goal-continuation.ts` (re-request continuation reason if needed), `skills/agentic-goal/SKILL.md`, `tests/goal-state.test.ts`, `tests/goal-workflow.test.ts`, `tests/skill-docs.test.ts`
- **Risk:** Medium-High (split candidate if plan-time task count exceeds 12) | **Effort:** Large
- **User Value:** Self-terminating pipeline; escalation instead of loops. | **Abort Point:** Yes — completes brief SC1.
- **Notes:** Accepted residual: a model that never re-requests completion leaves the goal active until user intervention (today's failure mode; no turn-end hook).

### M_final: Integration Verification
- **Goal:** Prove the composed single-gate pipeline.
- **Success Criteria:**
  1. Full-chain integration case (scripted runAgent mock; FRESH goal): contract → panel APPROVE×3 → confirm asserted EXACTLY once → autostart → two subgoals worker→validator PASS (re-entrant continuations) → goal verifier PASS → review both-PASS → `completed`; zero other user-input calls.
  2. Same chain with one validator-FAIL round and one review-FAIL round (incl. post-fix fresh verifier PASS) converges within the failure budget.
  3. Cross-file literal check: clarification SKILL.md + three critic .md files contain the identical `ASSUMPTION:` literal.
  4. Full suite + build green; each milestone's named test files re-run green.
- **Dependencies:** ALL | **Files:** `tests/goal-workflow.test.ts` (test-only) | **Risk:** Medium | **Effort:** Small | **Abort Point:** No (final gate)

---

**DAG summary (Phase 4.6 validated):** Wave 1 {M1 ∥ M3 ∥ M7} — pairwise file-disjoint (goal reducer+tests / agents+format+tests / clarification skill + index.ts-kickoff + its tests). Wave 2 {M2 (deps M1) ∥ M4a (deps M7)} — disjoint (goal-state/events+tests vs index.ts+workflow/extension tests). Wave 3 M4b (deps M1, M3, M4a). Wave 4 M5 (deps M2, M4b, M7). Wave 5 M6 (deps M5). Wave 6 M_final (deps ALL). No cycles; every non-root has ≥1 dependency; all non-dependent concurrent pairs are file-disjoint (M7-M4a collision resolved by the M7→M4a edge; skill-docs.test.ts shared by M7/M5/M6 is serialized by the M7→M5→M6 chain). **9 milestones (8 implementation + 1 verification) — exceeds the recommended 7**: the M1/M2 and M4a/M4b splits were critic-mandated to keep each milestone within a single plan cycle; flagged to the user at lock.
