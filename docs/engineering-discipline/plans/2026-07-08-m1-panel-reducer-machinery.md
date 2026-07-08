# M1: Panel-verdict reducer machinery + gates profile — Implementation Plan

> **Worker note:** Execute strictly in task order. This is a TDD milestone: Task 0 locks the entire desired surface as failing tests BEFORE any implementation. After each task passes its stated scoped command, flip that task's checkboxes. Do not claim completion while any checkbox remains open. Do NOT touch any file outside the Work Scope — the milestone's `git diff --stat` gate in the final task will reject stray edits.

**Goal:** Add the fail-closed all-of-N panel primitive (top-level `GoalState.panels[]` via `open_panel`/`record_panel_verdict`/`activate_goal_gated`) and the reducer-materialized per-goal `gates` profile — replay-safe, clone-safe, upgrade-safe, with zero live behavior change because no caller sets gates yet.

**Architecture:** The goal runtime is a pure reducer (`applyGoalCommand` in `goal-state.ts`) over a durable `GoalState`, persisted as a `schemaVersion: 1` snapshot (`goal-storage.ts`) and reconstructed by replaying validated `goal-state-event` commands on top of a snapshot (`goal-events.ts`). M1 extends the command union with three dormant commands and one optional `create_goal` param, adds a top-level `panels` array plus optional per-goal `gates`, and widens the `isGoalCommand` replay allowlist — all additive, all optional, no `schemaVersion` bump, no change to any existing command's behavior.

**Tech Stack:** TypeScript ESM, `@mariozechner/pi-coding-agent`, Vitest (`npm test` = `vitest run`, no config file), `tsc --noEmit` (`npm run build`). Node `crypto`/`fs` only.

## Work Scope

**In scope (ONLY these files — the milestone's listed files):**
- `extensions/agentic-harness/goal-state.ts`
- `extensions/agentic-harness/goal-events.ts`
- `extensions/agentic-harness/goal-storage.ts`
- `extensions/agentic-harness/tests/goal-state.test.ts`
- `extensions/agentic-harness/tests/goal-events.test.ts`

**Out of scope:**
- `index.ts` wiring, `goal-continuation.ts`, `goal-command.ts`, `goal-verifier.ts`, `goal-state-service.ts`, any skill/agent `.md`, footer/render — later milestones consume this vocabulary; M1 ships it dormant.
- Any gate ENFORCEMENT on `complete_target` (that is M2 `gates.validator` / M6 `gates.review`). M1 adds the `gates` field and the panel commands only; `complete_target` is untouched.
- `activate_goal` behavior — plain `activate_goal` stays unconditional forever.
- `schemaVersion` bump or any migration path.

## Verification Strategy

- **Level:** test-suite (real reducers + real temp-dir persistence; no subagent/pi mocking needed at this layer).
- **Command (full gate):** `cd extensions/agentic-harness && npm test && npm run build`
- **Scoped runs (per task):**
  - `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts`
  - `cd extensions/agentic-harness && npm test -- tests/goal-events.test.ts`
- **Zero-live-behavior proof:** `cd extensions/agentic-harness && npm test -- tests/session-replay.test.ts tests/goal-command.test.ts tests/goal-continuation.test.ts tests/compaction.test.ts` — all four pass UNMODIFIED (none is in the Work Scope). Existing cases in `tests/goal-state.test.ts` are additive-only (never edited).

## Success Criteria

Copied verbatim from the M1 milestone definition:

1. goal-state tests: all-of-N approves ONLY when every expected member has APPROVE; zero/partial verdicts rejected (missing = NO); `activate_goal_gated` throws without a satisfied panel, succeeds with one; plain `activate_goal` unconditional — the 5 existing caller test files (session-replay, goal-command, goal-continuation, compaction, goal-state) pass unmodified.
2. goal-state tests: `create_goal` MATERIALIZES `goals[].gates`; malformed `gates` rejected by `isGoalCommand`; gates-absent `complete_target` branch behavior-identical (golden pre-gates sequence).
3. goal-state tests: `createGoalState` initializes `panels`; `cloneState` deep-clones it (mutation-isolation test).
4. goal-events tests: new commands + gates-carrying create_goal round-trip replay; pre-gates fixture log (no snapshot) reconstructs statuses; MIXED resume (snapshot mid-panel + verdict event on top); UPGRADE test — pre-panels snapshot (no `panels`, no `gates`) loaded via the real restore path + one legacy command ⇒ no throw.
5. `schemaVersion` still `1`; `cd extensions/agentic-harness && npm test && npm run build` green.

---

## File Structure Mapping

**Modified files (all pre-existing):**
- `goal-state.ts` — add `PanelState`/`PanelMemberVerdict`/`GoalGates` types + `panels` on `GoalState` + optional `gates` on `GoalItem`; three new `GoalCommand` members and their reducer cases; three new ledger types; `isPanelApproved` export; `createGoalState` inits `panels`; `cloneState` deep-clones `panels` + `gates`; `create_goal` materializes `gates`.
- `goal-events.ts` — extend `isGoalCommand` with allowlist clauses for `open_panel`, `record_panel_verdict`, `activate_goal_gated`, and optional-`gates` validation inside `create_goal`; add `isGates` helper.
- `goal-storage.ts` — `normalizeGoalStateSnapshot` back-fills `state.panels = []` when absent (upgrade safety).
- `tests/goal-state.test.ts` — additive: all-of-N, gated activation throw/succeed, gates materialization + golden pre-gates, panels init + mutation-isolation deep-clone.
- `tests/goal-events.test.ts` — additive: new-command round-trip replay, pre-gates golden log replay, MIXED mid-panel resume, UPGRADE pre-panels snapshot restore, malformed-gates negative replay.

---

## Design (pinned — do not rediscover mid-cycle)

### State shape additions (`goal-state.ts`)

```ts
export type PanelVerdict = "APPROVE" | "REJECT";

export interface PanelMemberVerdict {
  member: string;
  verdict: PanelVerdict;
  findings?: string;
  recordedAt: string;
}

export interface PanelState {
  panelId: string;
  purpose: string;
  expectedMembers: string[];
  round: number;
  verdicts: PanelMemberVerdict[];
}

export interface GoalGates {
  panel?: boolean;
  validator?: boolean;
  review?: boolean;
}
```

- `GoalState` gains `panels: PanelState[]` (typed required to match `createGoalState`; runtime-guarded with `?? []` everywhere for pre-panels snapshots). **No `schemaVersion` change.**
- `GoalItem` gains `gates?: GoalGates` (optional; absent ⇒ every future invariant skipped).

### Commands (three new `GoalCommand` members) — panels are goal-agnostic in state; `activate_goal_gated` ties `panelId ↔ goalId` at activation time

```ts
| { type: "open_panel"; panel: { panelId: string; purpose: string; expectedMembers: string[] } }
| { type: "record_panel_verdict"; panelId: string; member: string; verdict: PanelVerdict; findings?: string }
| { type: "activate_goal_gated"; goalId: string; panelId: string }
```

Plus `create_goal.goal` gains optional `gates?: GoalGates`.

**Command semantics (reducer-owned):**
- `open_panel` — new `panelId` ⇒ create `{round: 1, verdicts: []}`. Re-opening an existing `panelId` ⇒ `round += 1`, refresh `purpose`/`expectedMembers`, clear `verdicts` (round-cap ENFORCEMENT is M4b's concern; M1 only owns the counter mechanics). Round-cap (3) lives in `PanelState.round`, SEPARATE from the failure budget.
- `record_panel_verdict` — throw if `panelId` unknown. Upsert one verdict per member (re-recording the same member replaces its entry). `findings` optional.
- `activate_goal_gated` — `getGoal(goalId)` (throws if missing); find panel by `panelId` (throw `GoalInvariantError` if missing); assert `isPanelApproved(panel)` (throw `GoalInvariantError` otherwise); then perform the SAME activation transition as `activate_goal` (inlined, so plain `activate_goal` stays literally untouched) and emit `goal_activated_gated`. **Does NOT mutate `gates`** — `create_goal` is the single materialization point for `gates`.

**All-of-N invariant (exported for M4b + tests):**
```ts
export function isPanelApproved(panel: PanelState): boolean {
  if (panel.expectedMembers.length === 0) return false; // fail-closed: empty panel never approves
  return panel.expectedMembers.every(
    (member) => panel.verdicts.find((v) => v.member === member)?.verdict === "APPROVE",
  );
}
```
Missing member ⇒ `find` returns `undefined` ⇒ NO. Zero/partial verdicts ⇒ NO.

### New ledger types (`GoalLedgerEntry.type` union)
`"panel_opened" | "panel_verdict_recorded" | "goal_activated_gated"`. None is read by `assertCompletionInvariant`, so they are audit-only and safe to add.

### Replay allowlist (`goal-events.ts`)
Every new command MUST get an `isGoalCommand` clause or replay silently drops it. Add clauses for `open_panel`, `record_panel_verdict`, `activate_goal_gated`, and widen the `create_goal` clause to validate optional `gates` via a new `isGates` helper. Malformed `gates` (e.g. `{ panel: "yes" }`) ⇒ `isGoalCommand` returns `false` ⇒ event dropped with `"Ignored invalid goal-state-event"`.

### Upgrade safety (`goal-storage.ts`)
`normalizeGoalStateSnapshot` back-fills `state.panels = []` when a pre-panels snapshot (no `panels` key) is read. Combined with `?? []` guards in `cloneState`/reducer, this makes the real restore path total on old snapshots. Forward-compat drop on downgrade (new commands replayed on older code) = accepted risk, no action.

### Constraints (enforced throughout)
- `schemaVersion` stays `1`; no migration path introduced.
- All new state fields optional/back-filled; guard every read with `?? []` / `?? undefined`.
- Zero live behavior change: no code path sets `gates`; `complete_target`, `activate_goal`, and all existing commands are behaviorally identical.
- The 4 external caller test files (session-replay, goal-command, goal-continuation, compaction) and all pre-existing cases in goal-state.test.ts pass without edits.

---

## Task 0: Baseline Lock — write the full desired surface as FAILING tests

**Goal:** Encode every M1 success criterion as tests across the two in-scope test files, before any implementation, so the surface is pinned and the red→green transition is observable.

**Dependencies:** None

**Files:**
- Modify (additive): `tests/goal-state.test.ts` — new `describe("M1 panels + gates", …)` block.
- Modify (additive): `tests/goal-events.test.ts` — new fixtures in the existing `describe("goal-events", …)`.

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts tests/goal-events.test.ts` → the NEW cases FAIL (missing commands/types resolve to `undefined` reducer results or unmet assertions); every PRE-EXISTING case in both files still PASSES.

**Steps:**

1. In `tests/goal-state.test.ts`, add a `describe("M1 panels + gates", …)` block with these cases (import `isPanelApproved`, `type PanelState` from `../goal-state.js` — these do not exist yet, so the file will fail):
   - **all-of-N: full approve** — `open_panel` (`expectedMembers: ["a","b"]`), record `a=APPROVE`, `b=APPROVE`; assert the panel's `isPanelApproved` is `true` and `activate_goal_gated` succeeds (goal `active`, `state.activeGoalId` set, ledger ends `goal_activated_gated`).
   - **all-of-N: partial rejected** — same panel, only `a=APPROVE`; assert `activate_goal_gated` throws `GoalInvariantError` and the goal stays `queued`.
   - **all-of-N: zero verdicts rejected** — panel with no verdicts; `activate_goal_gated` throws.
   - **all-of-N: a REJECT blocks** — `a=APPROVE`, `b=REJECT`; `activate_goal_gated` throws.
   - **missing panel** — `activate_goal_gated` with an unknown `panelId` throws `GoalInvariantError`.
   - **re-record upsert** — record `a=REJECT` then `a=APPROVE`; assert exactly one verdict entry for `a` and it is `APPROVE`.
   - **re-open increments round** — `open_panel` twice on the same `panelId`; assert `round === 2` and `verdicts === []`.
   - **gates materialization** — `create_goal` with `gates: { panel: true, validator: true }`; assert `state.goals[0].gates` deep-equals `{ panel: true, validator: true }`.
   - **golden pre-gates sequence** — `create_goal` WITHOUT gates → `request_completion` → `record_verifier_result` PASS → `complete_target`; assert `goals[0].gates` is `undefined`, `goals[0].status === "completed"`, and the ledger type sequence equals the pre-gates expectation (`["goal_created","completion_requested","verifier_pass","goal_completed"]`). This proves the gates-absent branch is behavior-identical.
   - **panels init** — `createGoalState("run-1", START).panels` deep-equals `[]`.
   - **mutation-isolation deep-clone** — build a state with an open panel + one verdict; call `applyGoalCommand` once more (returns a clone); mutate the returned state's `panels[0].expectedMembers` and `panels[0].verdicts` (push); assert the ORIGINAL state's `panels[0]` is unchanged (arrays not shared).
   - **plain `activate_goal` still unconditional** — with NO panel present, `activate_goal` succeeds (guards the "untouched" contract).

2. In `tests/goal-events.test.ts`, add these fixtures (they will fail to reconstruct until the reducer + allowlist land):
   - **new-command round-trip replay** — a no-snapshot event log: `create_goal` (with `gates: { panel: true }`) → `open_panel` (`["a","b"]`) → `record_panel_verdict a=APPROVE` → `record_panel_verdict b=APPROVE` → `activate_goal_gated`; ordered by ascending `createdAt`. Assert `result.errors === []`, goal `active`, `state.panels[0]` has both verdicts, and `state.goals[0].gates` is `{ panel: true }`.
   - **pre-gates golden log replay** — a no-snapshot log of the classic `create_goal`/`activate_goal`/`request_completion`/`record_verifier_result` PASS/`complete_target` sequence with NO gates/panels; assert `errors === []` and `goals[0].status === "completed"` (proves old logs replay unchanged).
   - **MIXED mid-panel resume** — replay-build a base state (`create_goal`, `open_panel ["a","b"]`, `record_panel_verdict a=APPROVE`); snapshot it via `createGoalStateSnapshot(..., { now: T2 })` + `writeGoalStateSnapshot`; then `restoreGoalStateFromSnapshotAndEvents(root, "run-1", [record_panel_verdict b=APPROVE @T3])`; assert the restored panel has BOTH verdicts and `isPanelApproved` is `true`.
   - **UPGRADE pre-panels snapshot** — write a RAW pre-panels snapshot JSON to `goalStateSnapshotPath(root,"run-1")` via `node:fs writeFile` (a `GoalStateSnapshot` whose `state` has NO `panels` and whose goal has NO `gates`, `schemaVersion: 1`); call `restoreGoalStateFromSnapshotAndEvents` with ONE legacy event on top (e.g. `add_evidence` or `activate_goal`); assert it does NOT throw, `result.state.panels` deep-equals `[]`, and `result.errors === []`.
   - **malformed-gates negative** — a `create_goal` event whose `goal.gates` is `{ panel: "yes" }`; assert `replayGoalStateEvents` records `"Ignored invalid goal-state-event at index 0"` and the goal is NOT created.

3. Run `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts tests/goal-events.test.ts`. Confirm the new cases FAIL and the pre-existing cases PASS. **Do not run `npm run build` yet** (it will type-error on missing symbols — expected).

---

## Task 1: Panel + gates types, state init, and deep-clone

**Goal:** Add the panel/gates type surface, initialize `panels` in `createGoalState`, and deep-clone `panels` + `gates` in `cloneState`.

**Dependencies:** Task 0

**Files:**
- Modify: `goal-state.ts` — `PanelVerdict`, `PanelMemberVerdict`, `PanelState`, `GoalGates` types; `GoalState.panels`; `GoalItem.gates?`; `isPanelApproved` export; `createGoalState`; `cloneState`.

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts` → the **panels init**, **mutation-isolation deep-clone**, and **plain `activate_goal` still unconditional** cases PASS. (Command-dependent cases still fail until Task 2.)

**Steps:**

1. Add the four exported types (`PanelVerdict`, `PanelMemberVerdict`, `PanelState`, `GoalGates`) exactly as pinned in the Design section.
2. Add `panels: PanelState[]` to the `GoalState` interface (after `goals`); add `gates?: GoalGates` to `GoalItem` (after `blockers`).
3. Add the exported `isPanelApproved(panel: PanelState): boolean` function per the Design section.
4. In `createGoalState`, add `panels: []` to the returned object.
5. In `cloneState`, guard and deep-clone panels, and clone per-goal gates:
   ```ts
   // inside the goals.map((goal) => ({ ... }))
   gates: goal.gates ? { ...goal.gates } : undefined,
   // add a top-level field on the returned object:
   panels: (state.panels ?? []).map((panel) => ({
     ...panel,
     expectedMembers: [...panel.expectedMembers],
     verdicts: panel.verdicts.map((v) => ({ ...v })),
   })),
   ```
   The `?? []` guard is load-bearing: an in-memory or pre-panels state with `panels === undefined` must clone to `[]`, never crash.
6. Run the scoped command; confirm the three targeted cases pass.

---

## Task 2: Reducer commands + all-of-N + gates materialization

**Goal:** Implement the three new command cases, the `create_goal` gates materialization, and the three new ledger types.

**Dependencies:** Task 1

**Files:**
- Modify: `goal-state.ts` — `GoalCommand` union (+3 members, `create_goal.gates?`); `GoalLedgerEntry.type` (+3); reducer cases; `create_goal` case.

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts` → ALL M1 goal-state cases PASS; every pre-existing case still PASSES.

**Steps:**

1. Extend the `create_goal` command shape with optional `gates?: GoalGates` on `goal`; add the three new members to the `GoalCommand` union exactly as pinned in the Design section.
2. Add `"panel_opened" | "panel_verdict_recorded" | "goal_activated_gated"` to the `GoalLedgerEntry.type` union.
3. In the `create_goal` case, materialize gates onto the new `GoalItem`:
   ```ts
   gates: command.goal.gates ? { ...command.goal.gates } : undefined,
   ```
   (Place after `blockers`.) Absent ⇒ `undefined` ⇒ dormant.
4. Add the `open_panel` case: guard `next.panels ?? []`; re-open increments `round` and clears `verdicts`; new panel gets `round: 1`. Emit `panel_opened` (data: `{ panelId, round }`).
5. Add the `record_panel_verdict` case: throw `Error(\`Panel ${command.panelId} not found\`)` if unknown; upsert one `PanelMemberVerdict` per member (`recordedAt: now`, `findings: command.findings`); emit `panel_verdict_recorded`.
6. Add the `activate_goal_gated` case per the Design section: `getGoal`, find panel (`GoalInvariantError` if missing), `isPanelApproved` (`GoalInvariantError` if not), inline the same activation transition as `activate_goal`, set `next.status`/`next.activeGoalId`, emit `goal_activated_gated` (data: `{ panelId }`). Do NOT modify `gates`.
7. Confirm the switch remains exhaustive (no `default`) so `tsc` forces coverage; run the scoped command; all goal-state cases green.

---

## Task 3: Replay allowlist for new commands + malformed-gates rejection

**Goal:** Widen `isGoalCommand` so the three new commands replay and malformed `gates` is rejected.

**Dependencies:** Task 2

**Files:**
- Modify: `goal-events.ts` — `isGates` helper; `create_goal` clause widened; `open_panel`/`record_panel_verdict`/`activate_goal_gated` clauses.

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-events.test.ts` → the **new-command round-trip**, **pre-gates golden log**, and **malformed-gates negative** cases PASS; every pre-existing goal-events case still PASSES.

**Steps:**

1. Add an `isGates` helper:
   ```ts
   function isGates(value: unknown): boolean {
     return isRecord(value)
       && (value.panel === undefined || typeof value.panel === "boolean")
       && (value.validator === undefined || typeof value.validator === "boolean")
       && (value.review === undefined || typeof value.review === "boolean");
   }
   ```
2. In the `create_goal` clause, append `&& (goal.gates === undefined || isGates(goal.gates))`.
3. Add the three clauses to the `switch (value.type)` in `isGoalCommand`:
   ```ts
   case "open_panel": {
     const panel = value.panel;
     return isRecord(panel)
       && typeof panel.panelId === "string"
       && typeof panel.purpose === "string"
       && isStringArray(panel.expectedMembers);
   }
   case "record_panel_verdict":
     return typeof value.panelId === "string"
       && typeof value.member === "string"
       && (value.verdict === "APPROVE" || value.verdict === "REJECT")
       && (value.findings === undefined || typeof value.findings === "string");
   case "activate_goal_gated":
     return typeof value.goalId === "string" && typeof value.panelId === "string";
   ```
4. Run the scoped command; the three targeted goal-events cases pass. (MIXED + UPGRADE still depend on Task 4.)

---

## Task 4: Upgrade-safe snapshot normalization

**Goal:** Make the real restore path total on pre-panels snapshots by back-filling `panels: []` during normalization.

**Dependencies:** Task 2 (types), Task 3 (events)

**Files:**
- Modify: `goal-storage.ts` — `normalizeGoalStateSnapshot`.

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-events.test.ts` → the **MIXED mid-panel resume** and **UPGRADE pre-panels snapshot** cases PASS; the whole file is green.

**Steps:**

1. In `normalizeGoalStateSnapshot`, after the existing `snapshotSeq`/`writtenAt` validation and before `return snapshot`, back-fill panels on the state:
   ```ts
   const normalizedState = state as GoalState;
   if (!Array.isArray(normalizedState.panels)) {
     normalizedState.panels = [];
   }
   ```
   (`state` is already narrowed by the guard above; `GoalState` is imported.) This guarantees a pre-panels snapshot read via `readGoalStateSnapshot` → `restoreGoalStateFromSnapshotAndEvents` yields `panels: []` even with zero replayed events.
2. Do NOT touch `schemaVersion`, `createGoalStateSnapshot`, or the write path.
3. Run the scoped command; `tests/goal-events.test.ts` fully green.

---

## Task 5: Full milestone verification gate + scope sanity check

**Goal:** Prove the whole milestone green and confirm only the five in-scope files changed.

**Dependencies:** Tasks 0–4

**Files:** None (verification only; fix in the owning task if anything fails).

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test && npm run build` exits 0.
- `cd extensions/agentic-harness && npm test -- tests/session-replay.test.ts tests/goal-command.test.ts tests/goal-continuation.test.ts tests/compaction.test.ts` exits 0 (four caller files pass UNMODIFIED).
- `git diff --stat` shows changes confined to exactly: `goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `tests/goal-state.test.ts`, `tests/goal-events.test.ts` (plus the incidental pre-existing `package-lock.json` if `npm` touched it — no other source/test file).
- `schemaVersion` still `1`: `grep -n "GOAL_STATE_SCHEMA_VERSION = 1" extensions/agentic-harness/goal-state.ts` matches; no `schemaVersion` literal changed.

**Steps:**

1. Run the full gate `cd extensions/agentic-harness && npm test && npm run build`. If red, return to the owning task; do not patch around failures here.
2. Run the four unmodified caller files; confirm green (zero-live-behavior proof).
3. From the repo root run `git diff --stat` and confirm the changed-file set is exactly the Work Scope (plus possibly `package-lock.json`). Any stray file ⇒ revert it.
4. Confirm `schemaVersion` is untouched via the grep above.

---

## Rollback Plan

Every change is additive and dormant (no caller constructs `gates`, `open_panel`, `record_panel_verdict`, or `activate_goal_gated`), so partial delivery is safe to leave or revert:
1. If the full gate fails late, keep any task whose scoped tests pass independently — the reducer/types/events/storage changes are orthogonal and each stands alone.
2. To fully revert, `git checkout` the five in-scope files; because `schemaVersion` never changed and all fields are optional/back-filled, any snapshot written during the branch still loads on the pre-M1 reducer (old code ignores the extra `panels`/`gates` keys). No migration or data cleanup required.
3. Do NOT ship a state where `isGoalCommand` accepts a new command but the reducer lacks its case (or vice versa) — that pairing is enforced by Tasks 2+3 landing together; if only one lands, revert both.

## Self-Review

- **Spec coverage:** All 5 SCs mapped to tasks — SC1 (all-of-N + gated activation + untouched `activate_goal` + 5 caller files) → Tasks 0/2/5; SC2 (gates materialization + malformed rejection + golden pre-gates) → Tasks 0/2/3; SC3 (panels init + deep-clone isolation) → Tasks 0/1; SC4 (round-trip + pre-gates log + MIXED + UPGRADE) → Tasks 0/3/4; SC5 (schemaVersion + full gate) → Task 5.
- **Long-pole handled:** the MIXED-resume and UPGRADE fixtures (the milestone's stated long-pole) are locked in Task 0 and satisfied by the Task 4 normalization back-fill combined with `?? []` clone guards — belt-and-suspenders so both the zero-event snapshot path and the events-on-top path are total.
- **Zero-live-behavior discipline:** `complete_target`/`activate_goal`/all existing commands are byte-unchanged; `activate_goal_gated` inlines activation rather than refactoring `activate_goal`; gates default to `undefined`; ledger additions are audit-only and unread by `assertCompletionInvariant`. Proof = four unmodified caller test files + additive-only goal-state cases.
- **Replay integrity:** every new command has a matching `isGoalCommand` clause (Task 3), preventing silent replay drops; malformed `gates` fails closed. Forward-compat drop on downgrade is the documented accepted risk.
- **Risk residual:** highest-risk task is Task 2 (reducer semantics for all-of-N + re-open round mechanics); mitigated by Task 0 pinning the exact expected behavior (upsert, round increment, fail-closed empty panel) before implementation.
