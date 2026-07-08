# DRAFT v1 — Milestone DAG: forge→hammer 재구성

**Skeleton choice:** B (risk-first) as base — its risk ordering matches the digest's novelty map (all-of-N aggregation has zero prior art; auto-chain touches an already-pinned test surface) and its file-disjoint clarification milestone enables a parallel root. Grafted from A: (1) the standalone binary-checklist agent-roster milestone (A-M3), pulled out of B's oversized M2/M4 so runtime milestones stay lean and a second parallel root exists; (2) A's reducer-contracts-first discipline — validator receipts and the failure counter join the all-of-N primitive in one reducer milestone, so goal-state.ts/goal-events.ts are opened once, not twice.

**Design decision (critics may attack):** `skills/agentic-goal/SKILL.md` is deliberately NOT modified. Its current gate language ("never claim complete until the verifier subagent returns PASS") remains true; new panel/validator gates are runtime-enforced (reducer + follow-up prompts), which preserves prompt-cache stability and avoids touching its skill-docs pins. Only the clarification SKILL.md is rewritten (M6).

**Execution order:** Wave 1: M1 ∥ M2 ∥ M6 → Wave 2: M3 → Wave 3: M4 → Wave 4: M5 → Wave 5: M_final (integration verification, appended after critique).

---

### M1: Reducer gate contracts (all-of-N primitive + validator receipts + failure counter)

- **Goal:** Extend the goal reducer with every new durable gate contract — a generic fail-closed all-of-N panel-verdict aggregation, per-subgoal validator receipts as completion preconditions, and a live `consecutiveFailures` counter — all additive, optional-field-only, and replay-safe.
- **Success Criteria:**
  1. `npm test -- tests/goal-state.test.ts` passes new cases proving the all-of-N invariant approves ONLY when every expected verdict is APPROVE, and a missing verdict is treated as NO ("unchecked is NO").
  2. `npm test -- tests/goal-state.test.ts` proves subgoal `complete_target` throws without a latest validator PASS receipt (fail-closed) and succeeds with one.
  3. `npm test -- tests/goal-state.test.ts` proves `consecutiveFailures[targetId]` increments on a FAIL receipt and resets on PASS.
  4. `npm test -- tests/goal-events.test.ts` round-trips every new command through replay (allowlist clause present; entry not dropped as "Ignored invalid goal-state-event").
  5. A schemaVersion-1 snapshot lacking the new optional fields loads and replays without throwing (backward-compat test); `grep schemaVersion goal-storage.ts` still shows `1`.
  6. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None
- **Files affected:** Modify `goal-state.ts` (optional `panelVerdicts` keyed by panelId + `record_panel_verdict`; optional `SubgoalItem.validatorReceipts[]` + `record_validator_receipt` + completion precondition mirroring `assertCompletionInvariant`; counter increment/reset; new `GoalLedgerEntry` types), `goal-events.ts` (allowlist clauses per new command), `goal-storage.ts` (normalization `?? []` guards), `tests/goal-state.test.ts`, `tests/goal-events.test.ts`.
- **Risk:** High — all-of-N aggregation has no existing pattern (invariant today reads only `.at(-1)`), and new invariants that throw during best-effort replay can silently drop history; enforcement must be gated behind additive optional fields.
- **Effort:** Large
- **User Value:** The state machine mechanically refuses ungated transitions — provable by unit tests before any runtime consumes it.
- **Abort Point:** Yes — a hardened, replay-safe reducer is a standalone correctness improvement.
- **Evidence:** Lens R "Critic-panel aggregation is NET-NEW"; Lens R "Per-subgoal receipts ALREADY EXIST … thin extension"; Lens R "3-failure budget pre-wired but DEAD"; Lens R "every new command needs an allowlist clause in `isGoalCommand` … new invariants that throw could silently drop replayed history"; Lens R "Adding OPTIONAL state fields is safe without a bump".

### M2: Binary-checklist agent roster

- **Goal:** Reframe the three holistic reviewers into binary contract-granularity critics (feasibility/integration/coverage lenses) and add security-reviewer + qa-reviewer, all emitting the mechanical CHECKS/VERDICT/FINDINGS receipt format, with implementation-critic's fraud checks folded into qa-reviewer.
- **Success Criteria:**
  1. `npm test -- tests/agents.test.ts` passes: `reviewer-feasibility/architecture/risk` still parse under their pinned names; `security-reviewer` and `qa-reviewer` are present; `synthesis`/`reviewer-dependency`/`reviewer-user-value` remain absent.
  2. `npm test -- tests/agents.test.ts` asserts each reframed/new reviewer body contains the mechanical verdict rule ("unchecked is NO"; APPROVE/PASS iff every check YES or N/A) and a strict `VERDICT:` line spec — no graded scales remain.
  3. qa-reviewer's checklist contains the folded fraud checks (genuine bodies / no criteria-shaped hardcoding / tests can fail / no swallowed failures), assertable by substring.
  4. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None
- **Files affected:** Modify `agents/reviewer-feasibility.md`, `agents/reviewer-architecture.md`, `agents/reviewer-risk.md`; Create `agents/security-reviewer.md`, `agents/qa-reviewer.md`; Modify `tests/agents.test.ts`.
- **Risk:** Low — additive/content-only; roster pins kept.
- **Effort:** Medium
- **User Value:** A reviewable binary-checklist roster; each `.md` shows mechanical pass/fail criteria instead of prose grades.
- **Abort Point:** Yes — the agent prose is independently useful documentation of review standards.
- **Evidence:** Lens S "reviewer-feasibility/architecture/risk are holistic/prose … need reframing to binary; plan-validator + reviewer-verifier already have the binary spine"; Lens G checklists + receipt format verbatim; Lens V agents.test.ts roster pins; Scope item 4 (impl-critic folds into qa).

### M3: Auto-chain + critic panel gate at autostart

- **Goal:** Bridge `draft_goal_contract` into `autoStartGoalRuntime`, gated by a programmatic parallel 3-critic panel whose all-APPROVE (consuming M1's primitive) is required before `activate_goal`, with revise-and-re-run-full-panel on any REJECT up to 3 rounds then escalation, preserving the fail-closed high-risk confirm.
- **Success Criteria:**
  1. `npm test -- tests/goal-workflow.test.ts` (mocked `runAgent`): drafting a contract auto-starts through the panel; activation is blocked until 3 distinct APPROVE verdicts; any REJECT re-dispatches all 3 critics; round > 3 halts and escalates without activation.
  2. Reducer-level check: autostart activation without 3 APPROVE verdicts throws (asserted via `tests/goal-workflow.test.ts` or `tests/goal-state.test.ts`).
  3. A high-risk contract in non-interactive mode refuses to autostart (fail-closed) — asserted in `tests/goal-workflow.test.ts`.
  4. `npm test -- tests/extension.test.ts` passes for the `/clarify` delegation-prompt and registration-surface changes.
  5. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M1, M2
- **Files affected:** Modify `index.ts` (`draft_goal_contract` handler ~:558 → autostart path; parallel critic dispatch via `runAgent` + `mapWithConcurrencyLimit` inside `autoStartGoalRuntime` ~:1757-1829 ahead of `activate_goal`; `record_panel_verdict` calls; round loop; preserve `ctx.ui.confirm` ~:1777-1784), `tests/goal-workflow.test.ts`, `tests/extension.test.ts`.
- **Risk:** High — touches the auto-chain surface `goal-workflow.test.ts` already pins, plus the first live parallel panel dispatch and the round-cap/fail-closed branches, at one seam.
- **User Value:** Contract approval becomes the single user gate: a drafted contract runs a real 3-critic panel and auto-starts the goal runtime only on unanimous APPROVE.
- **Effort:** Large
- **Abort Point:** Yes — a critic-gated one-touch auto-chain up to activation is a shippable slice.
- **Evidence:** Lens R "Auto-chain seam … critic panel slots right there [ui.confirm precedent] … bridging means wiring that handler to the autostart path"; Lens S "Programmatic dispatch is proven (runGoalVerifier); parallel dispatch exists (max 12/concurrency 10)"; Lens V "goal-workflow.test.ts already pins the clarify→goal auto-chain surface"; Lens G Anvil loop mechanics.

### M4: Per-subgoal worker→validator loop

- **Goal:** Add the information-isolated per-subgoal validator — dispatched programmatically with subgoal fields verbatim (never the worker's output) — whose PASS receipt satisfies M1's completion precondition, with FAIL re-dispatching the worker with accumulated feedback.
- **Success Criteria:**
  1. `npm test -- tests/goal-workflow.test.ts`: a subgoal completes only after a validator PASS receipt; a validator FAIL keeps it open and re-dispatches the worker with accumulated verdict feedback.
  2. Code inspection: the validator dispatch in `index.ts` passes subgoal objective/criteria/evidence verbatim and contains no worker-output field.
  3. `npm test -- tests/goal-state.test.ts` (from M1) still green — no invariant regressions.
  4. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M3
- **Files affected:** Modify `index.ts` (worker→validator dispatch on the subgoal completion path, reusing the `runGoalVerifier` pattern ~:1872-1917 and the `/goal complete` 4-command sequence ~:2005-2035), `goal-verifier.ts` (widen `verifierAgent` literal; parse validator output), `tests/goal-workflow.test.ts`.
- **Risk:** Medium — per-subgoal receipt routing already exists; the novel part (isolated dispatch) follows the proven verifier reference.
- **Effort:** Medium
- **User Value:** Every subgoal auto-runs implement → independent-validate; completion is provably gated on a PASS receipt.
- **Abort Point:** Yes — the per-subgoal cycle works even before the final panel and budget land.
- **Evidence:** Lens R "Per-subgoal receipts ALREADY EXIST … `getTarget` routing"; Lens S "runGoalVerifier … the reference implementation for the worker→validator loop"; Lens G validator template + isolation language ("never mention what the worker did").

### M5: Final security/qa panel + FAIL→fix recycling + 3-failure halt

- **Goal:** Gate overall goal completion on a parallel security+qa panel (both PASS, via M1's all-of-N primitive), convert blocking FAILs into fix subgoals that recycle through the M4 cycle then re-run the full panel, and wire the `consecutiveFailures` budget to halt auto-continuation and escalate after 3 consecutive FAILs.
- **Success Criteria:**
  1. `npm test -- tests/goal-state.test.ts`: final `complete_target` throws without both a security PASS and a qa PASS verdict; succeeds with both.
  2. `npm test -- tests/goal-workflow.test.ts`: a panel FAIL converts each blocking finding into a fix subgoal, re-runs the cycle, then re-runs the FULL panel; both-PASS completes the goal.
  3. `npm test` on a `goal-continuation` test: `planGoalContinuation` returns a halt/escalation (not a follow-up) after 3 consecutive FAIL receipts on the same target, with a blocker summary.
  4. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** M4
- **Files affected:** Modify `index.ts` (final panel dispatch on the completion path; fix-subgoal creation; recycling), `goal-continuation.ts` (increment/reset + 3-strike halt in `planGoalContinuation` ~:21-54), `tests/goal-workflow.test.ts`, `tests/goal-continuation.test.ts` (create if absent), `tests/goal-state.test.ts`.
- **Risk:** Medium-High — the recycling loop is complex control flow; the halt boundary interacts with M1's counter and the panel invariant.
- **Effort:** Large
- **User Value:** The pipeline self-terminates: security/qa gate completion, FAILs auto-recycle into fixes, runaway loops halt after 3 strikes with an escalation summary.
- **Abort Point:** Yes — completes the end-to-end autonomous pipeline (brief Success Criterion 1).
- **Evidence:** Lens R "3-failure budget pre-wired but DEAD … the halt belongs there [planGoalContinuation]"; Lens G "Review panel recycling: any FAIL → convert each blocking finding into a fix task … re-run FULL review panel; same finding failing 3× → escalate"; Lens R verifier 4-command sequence.

### M6: Forge-style clarification skill rewrite

- **Goal:** Rewrite `agentic-clarification/SKILL.md` to recon-first + ONE bundled question round (max 4, survivors only) with defensible defaults and assumption-marked checklist auto-fill, keeping the clarify name and the `/clarify` delegation wrapper untouched.
- **Success Criteria:**
  1. `npm test -- tests/skill-docs.test.ts` passes with updated substring assertions (recon-first, bundled-round, assumption-marker language present; one-question-at-a-time language absent; legacy negative list still holds).
  2. `npm test -- tests/clarification-state.test.ts && npm test -- tests/clarification-events.test.ts` pass: assumption-marked fills count toward `canDraftGoalContract` (gate reaches zero open issues) and replay cleanly.
  3. The skill/command name remains `clarify` (skill-docs name assertions pass).
  4. `cd extensions/agentic-harness && npm test && npm run build` green.
- **Dependencies:** None (file-disjoint parallel root — deliberately avoids `index.ts` and `skills/agentic-goal/SKILL.md`).
- **Files affected:** Modify `skills/agentic-clarification/SKILL.md`, `clarification-state.ts` (assumption-marked fill semantics if a new marker is needed), `clarification-events.ts` (allowlist if a new action is added), `tests/skill-docs.test.ts`, `tests/clarification-state.test.ts`, `tests/clarification-events.test.ts`.
- **Risk:** Low-Medium — mechanical against exact-substring pins; no cross-module integration.
- **Effort:** Medium
- **User Value:** Clarification stops asking one-question-at-a-time; recon-driven defaults with at most one bundled ≤4-question round.
- **Abort Point:** Yes — an improved clarification experience stands alone.
- **Evidence:** Lens G forge question round verbatim; Lens V "skill-docs.test.ts … Any SKILL.md rewrite must update this in the same change"; Lens R clarification checklist gate mechanics; Constraint "keep clarify/goal naming".

---

**DAG summary:** Roots M1, M2, M6 (pairwise file-disjoint: goal reducer+its tests / agents+agents test / clarification+its tests). Chain M1,M2 → M3 → M4 → M5 (serialized on `index.ts`). M_final (Integration Verification) appended after critique, depends on ALL.
