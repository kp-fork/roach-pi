# M2: Validator receipts + failure budget reducer machinery — Implementation Plan

> **Worker note:** Execute strictly in task order. This is a TDD milestone: Task 0 locks the entire desired surface as failing tests BEFORE any implementation. After each task passes its stated scoped command, flip that task's checkboxes. Do not claim completion while any checkbox remains open. Do NOT touch any file outside the Work Scope — the milestone's `git diff --stat` gate in the final task will reject stray edits. M1 is already merged; anchor every change on the REAL current symbols in `goal-state.ts` / `goal-events.ts` (verified below), not on the M1 plan's projected shapes.

**Goal:** Add per-subgoal validator receipts as a DISTINCT receipt type (`GoalValidatorReceipt`, `validatorAgent: "plan-validator"` identity literal, `validator_pass`/`validator_fail` ledger types, an `isValidatorReceipt` replay clause) with a flag-conditional replaces-verifier subgoal completion precondition (the completion invariant's ledger-lookup widened to `validator_pass` for gated subgoals), and wire the dormant `consecutiveFailures` failure budget via a reducer-owned `bumpFailureBudget` helper — everything gated on `gates.validator`, with ZERO live behavior change because no caller sets `gates.validator` until M5.

**Architecture:** The goal runtime is a pure reducer (`applyGoalCommand` in `goal-state.ts`) over a durable `GoalState`, persisted as a `schemaVersion: 1` snapshot (`goal-storage.ts`) and reconstructed by replaying validated `goal-state-event` commands on top of a snapshot (`goal-events.ts`). M1 shipped the dormant `gates` profile (`GoalItem.gates?: { panel?; validator?; review? }`) and panel machinery. M2 consumes `gates.validator`: it adds one new command (`record_validator_receipt`), a distinct receipt type stored on `SubgoalItem.validatorReceipts?`, two audit ledger types, a flag-conditional branch inside `assertCompletionInvariant`, and a reducer helper that mutates the already-present `continuation.consecutiveFailures` map — all additive, all optional/back-filled, no `schemaVersion` bump, no change to any existing command's behavior, no change to any code path when `gates.validator` is absent.

**Tech Stack:** TypeScript ESM, `@mariozechner/pi-coding-agent`, Vitest (`npm test` = `vitest run`, no config file), `tsc --noEmit` (`npm run build`). Node `crypto`/`fs` only.

## Work Scope

**In scope (ONLY these files — the milestone's listed files):**
- `extensions/agentic-harness/goal-state.ts`
- `extensions/agentic-harness/goal-events.ts`
- `extensions/agentic-harness/tests/goal-state.test.ts`
- `extensions/agentic-harness/tests/goal-events.test.ts`

**Explicitly NOT in scope (justification pinned):**
- `goal-storage.ts` — the milestone permits it ONLY if a normalization back-fill proves necessary. It does NOT: `validatorReceipts` is OPTIONAL on `SubgoalItem` and every read is `?? []`-guarded, and `cloneState` uses the `gates`-style `? : undefined` clause (never materializes an empty array on absent input). A pre-M2 snapshot (subgoals with no `validatorReceipts` key) therefore loads, clones, and completes via the verifier path with no throw and no phantom field — the same total-on-old-data property M1 achieved for `panels`, but here achieved purely at the type/clone layer. **If Task 1's clone or Task 4's invariant is found to throw on a `validatorReceipts`-absent subgoal, STOP and re-derive — do not "fix" it by editing `goal-storage.ts` without re-justifying in this plan.**
- `goal-verifier.ts` — `GOAL_VERIFIER_AGENT`/`GoalVerifierReceipt` are untouched; the validator identity literal lives in `goal-state.ts` (`GOAL_VALIDATOR_AGENT`), keeping the receipt type and its identity co-located and in scope.
- `index.ts`, `goal-continuation.ts`, `goal-command.ts`, `goal-state-service.ts`, any skill/agent `.md` — M5 wires the validator loop; M2 ships the vocabulary dormant.
- `activate_goal` / `complete_target` for GOAL targets / `record_verifier_result` for ungated goals — behaviorally identical. The verifier remains the goal-level gate; M2 only changes the SUBGOAL completion path and only when the parent goal has `gates.validator`.
- `schemaVersion` bump or any migration path.

## Verification Strategy

- **Level:** test-suite (real reducers + real temp-dir persistence; no subagent/pi mocking needed at this layer — the feature is dormant vocabulary).
- **Command (full gate):** `cd extensions/agentic-harness && npm test && npm run build`
- **Scoped runs (per task):**
  - `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts`
  - `cd extensions/agentic-harness && npm test -- tests/goal-events.test.ts`
- **Zero-live-behavior proof:** `cd extensions/agentic-harness && npm test -- tests/session-replay.test.ts tests/goal-command.test.ts tests/goal-continuation.test.ts tests/compaction.test.ts` — all four pass UNMODIFIED (none is in the Work Scope; none constructs a validator receipt or sets `gates.validator`). Every PRE-EXISTING case in `tests/goal-state.test.ts` and `tests/goal-events.test.ts` (the M1 `describe` blocks) is additive-only — never edited.

## Success Criteria

Copied verbatim from the M2 milestone definition (`milestones/M2-validator-receipts-budget.md`):

1. goal-state tests: with `gates.validator`, subgoal `complete_target` succeeds with exactly {validator PASS receipt + validator_pass ledger row} and throws without either (FULL invariant incl. ledger cross-check); gates absent ⇒ existing verifier rule byte-identical.
2. `npm run build` green with the distinct validator receipt type; `isValidatorReceipt` keyed on command type AND pinned to the validator identity literal; `isVerifierReceipt` stays identity-strict; forward negative tests both directions (verifier-identity receipt rejected by the validator gate, and vice versa).
3. goal-state tests: `bumpFailureBudget` fires only for targets whose goal has `gates.validator` — FAIL increments / PASS resets for `record_verifier_result` + `record_validator_receipt`; survives the clear_continuation-before-record ordering; an UNGATED FAIL leaves `consecutiveFailures` untouched. Panel verdicts NEVER touch the budget.
4. goal-events tests: pre-validator-era fixture replay reconstructs completions; validator receipt round-trips replay.
5. `cd extensions/agentic-harness && npm test && npm run build` green.

---

## File Structure Mapping

**Modified files (all pre-existing):**
- `goal-state.ts` — add `GoalValidatorReceipt` type + `GOAL_VALIDATOR_AGENT` const; `validatorReceipts?` on `SubgoalItem`; one `GoalCommand` member (`record_validator_receipt`); two ledger types (`validator_pass`/`validator_fail`); `cloneState` subgoal clone + `cloneValidatorReceipt` helper; the `record_validator_receipt` reducer case; `bumpFailureBudget` helper wired into `record_verifier_result` AND `record_validator_receipt`; the flag-conditional validator branch inside `assertCompletionInvariant`.
- `goal-events.ts` — `isValidatorReceipt` helper (identity-strict on `"plan-validator"` + `targetType: "subgoal"`); a `record_validator_receipt` clause in `isGoalCommand`. `isVerifierReceipt` untouched.
- `tests/goal-state.test.ts` — additive `describe("M2 validator receipts + failure budget", …)` block.
- `tests/goal-events.test.ts` — additive fixtures inside the existing `describe("goal-events", …)`.

---

## Design (pinned — do not rediscover mid-cycle)

### Verified current state (M1 merged — anchor here)

- `goal-state.ts:16` — `GoalContinuationState.consecutiveFailures: Record<string, number>` ALREADY EXISTS (dormant, nested under `continuation`). M2 does NOT hoist it (the optional decision #M2-notes hoist is declined — the SC's clear_continuation-ordering test is the regression guard for the nested form, which is cheaper and lower-risk than a hoist). `clear_continuation` (`goal-state.ts:550-558`) preserves it via `consecutiveFailures: { ...next.continuation.consecutiveFailures }`.
- `goal-state.ts:91-104` — `GoalVerifierReceipt` uses `verifierAgent: "reviewer-verifier"` and the timestamp field `verifiedAt`. The NEW validator receipt is DISTINCT: `validatorAgent` + `recordedAt`.
- `goal-state.ts:76-89` — `SubgoalItem` has `verifierReceipts` and `blockers`, NO `validatorReceipts`.
- `goal-state.ts:421-443` — `record_verifier_result` case is where the verifier-side budget bump is wired.
- `goal-state.ts:666-703` — `assertCompletionInvariant` (the verifier ledger cross-check to mirror). `entryMatchesTarget` (705-715) is reused unchanged.
- `goal-state.ts:645-664` — `buildGoalObjectiveHash(goal, subgoal)` is the hash the validator receipt must carry.
- `index.ts:2005-2035` — the `/goal complete` handler clears continuation (line 2007) BEFORE `record_verifier_result` (line 2024). This is the exact ordering the budget must survive.

### Distinct validator receipt type (`goal-state.ts`)

Add after `GoalVerifierReceipt` (line 104). Do NOT widen `GoalVerifierReceipt.verifierAgent`.

```ts
export const GOAL_VALIDATOR_AGENT = "plan-validator" as const;

export interface GoalValidatorReceipt {
  id: string;
  targetType: "subgoal";        // validator gate is subgoal-only; goal-level stays verifier
  targetId: string;
  objectiveHash: string;
  verdict: "PASS" | "FAIL";
  recordedAt: string;           // distinct from GoalVerifierReceipt.verifiedAt
  validatorAgent: typeof GOAL_VALIDATOR_AGENT;  // pinned identity literal "plan-validator"
  summary: string;
  blockers: string[];
  commandsRun: string[];
  evidence: string[];
  rawOutput: string;
}
```

Store on the subgoal (after `verifierReceipts` at `goal-state.ts:85`):
```ts
validatorReceipts?: GoalValidatorReceipt[];   // optional; absent ⇒ ungated / pre-M2
```

### New command + ledger types

`GoalCommand` gains one member (place after `record_verifier_result` at line 163):
```ts
| { type: "record_validator_receipt"; receipt: GoalValidatorReceipt }
```

`GoalLedgerEntry.type` union gains two entries (after `verifier_fail` at line 119):
```ts
| "validator_pass"
| "validator_fail"
```
Neither new ledger type is read by any existing code path, so both are additive/audit-safe; the validator branch of `assertCompletionInvariant` (Task 4) is the sole reader of `validator_pass`.

### `record_validator_receipt` reducer case (mirror `record_verifier_result`, subgoal-only)

```ts
case "record_validator_receipt": {
  const target = getTarget(next, command.receipt.targetType, command.receipt.targetId); // targetType is "subgoal"
  if (target.type !== "subgoal") {
    throw new Error(`Validator receipt target ${command.receipt.targetId} is not a subgoal`);
  }
  target.subgoal.validatorReceipts = [...(target.subgoal.validatorReceipts ?? []), cloneValidatorReceipt(command.receipt)];
  target.subgoal.status = command.receipt.verdict === "PASS" ? "verifying" : "blocked";
  target.subgoal.blockers = [...command.receipt.blockers];
  target.subgoal.updatedAt = now;
  bumpFailureBudget(next, target.goal, target.subgoal.id, command.receipt.verdict);
  const ledgerType = command.receipt.verdict === "PASS" ? "validator_pass" : "validator_fail";
  return withLedger(next, {
    type: ledgerType,
    goalId: target.goal.id,
    subgoalId: target.subgoal.id,
    message: command.receipt.summary,
    createdAt: now,
    data: { receiptId: command.receipt.id },
  });
}
```
`cloneValidatorReceipt` mirrors `cloneReceipt` (deep-copies `blockers`/`commandsRun`/`evidence`).

### `bumpFailureBudget` helper (reducer-owned; gated-only)

```ts
function bumpFailureBudget(
  state: GoalState,
  goal: GoalItem,
  targetId: string,
  verdict: "PASS" | "FAIL",
): void {
  if (goal.gates?.validator !== true) return;           // fires ONLY for gated goals
  const counters = state.continuation.consecutiveFailures; // `state` is the clone → safe to mutate
  if (verdict === "FAIL") {
    counters[targetId] = (counters[targetId] ?? 0) + 1;
  } else {
    delete counters[targetId];                          // PASS resets
  }
}
```

Wiring:
- **`record_validator_receipt`** — `bumpFailureBudget(next, target.goal, target.subgoal.id, command.receipt.verdict)` (shown above).
- **`record_verifier_result`** (`goal-state.ts:421-443`) — add, after the target branch sets status/blockers and before `withLedger`:
  ```ts
  bumpFailureBudget(next, target.goal, target.type === "goal" ? target.goal.id : target.subgoal.id, command.receipt.verdict);
  ```
  This resolves the owning goal for BOTH goal and subgoal verifier targets, so a goal-level verifier FAIL on a gated goal bumps `consecutiveFailures[goalId]` and a subgoal verifier FAIL bumps `consecutiveFailures[subgoalId]`. Ungated goals hit the `goal.gates?.validator !== true` early-return and are untouched (zero live behavior change).

**Survives clear_continuation ordering:** `clear_continuation` preserves `consecutiveFailures`, and `bumpFailureBudget` mutates the cloned `next.continuation.consecutiveFailures` inside the receipt command. In the real handler order (clear first, then record) the counter is preserved across the clear and then incremented — proven by the ordering test.

**Panels never touch it:** `record_panel_verdict` does not call `bumpFailureBudget`; the SC assertion is a guard test, not a code change.

### Flag-conditional completion invariant (`assertCompletionInvariant`)

At the TOP of `assertCompletionInvariant`, early-return through the validator path for gated subgoals; otherwise fall through to the EXISTING verifier code UNCHANGED (byte-identical for every goal target and every ungated subgoal):

```ts
function assertCompletionInvariant(state: GoalState, target: GoalTarget): void {
  if (target.type === "subgoal" && target.goal.gates?.validator === true) {
    assertValidatorCompletionInvariant(state, target.goal, target.subgoal);
    return;
  }
  // ---- existing verifier invariant below: DO NOT EDIT ----
  const targetType = target.type;
  ...
}
```

New helper (mirrors the verifier invariant, keyed on `validatorReceipts` + `validator_pass`; does NOT read `verifierReceipts` and does NOT require a verifier receipt):

```ts
function assertValidatorCompletionInvariant(state: GoalState, goal: GoalItem, subgoal: SubgoalItem): void {
  const receipts = subgoal.validatorReceipts ?? [];
  const latest = receipts.at(-1);
  if (!latest || latest.verdict !== "PASS") {
    throw new GoalInvariantError(`Cannot complete subgoal ${subgoal.id}: latest validator receipt is not PASS`);
  }
  if (latest.targetType !== "subgoal" || latest.targetId !== subgoal.id) {
    throw new GoalInvariantError(`Cannot complete subgoal ${subgoal.id}: validator receipt target mismatch`);
  }
  const expectedHash = buildGoalObjectiveHash(goal, subgoal);
  if (latest.objectiveHash !== expectedHash) {
    throw new GoalInvariantError(`Cannot complete subgoal ${subgoal.id}: validator receipt objective hash is stale`);
  }
  const passEntry = [...state.ledger].reverse().find((entry) =>
    entry.type === "validator_pass"
    && entry.data?.receiptId === latest.id
    && entryMatchesTarget(entry, "subgoal", goal.id, subgoal.id)
  );
  if (!passEntry) {
    throw new GoalInvariantError(`Cannot complete subgoal ${subgoal.id}: validator PASS ledger entry is missing`);
  }
  const staleEntry = state.ledger.find((entry) =>
    entry.seq > passEntry.seq
    && (entry.type === "evidence_added" || entry.type === "subgoal_created" || entry.type === "completion_requested")
    && entryMatchesTarget(entry, "subgoal", goal.id, subgoal.id)
  );
  if (staleEntry) {
    throw new GoalInvariantError(`Cannot complete subgoal ${subgoal.id}: validator receipt is stale after ${staleEntry.type}`);
  }
}
```

Consequences pinned by tests:
- Gated subgoal with a validator PASS receipt AND a matching `validator_pass` ledger row AND a fresh hash ⇒ completes.
- Gated subgoal missing the receipt ⇒ throws (`latest validator receipt is not PASS`).
- Gated subgoal with the receipt but NO ledger row (hand-injected) ⇒ throws (`validator PASS ledger entry is missing`) — the FULL ledger cross-check.
- Gated subgoal with ONLY a verifier PASS receipt (no validator) ⇒ throws (validator gate does not accept a verifier receipt).
- Ungated subgoal ⇒ existing verifier rule byte-identical (a validator-only receipt does NOT complete it; a verifier PASS does).

### Distinct identity strictness (`goal-events.ts`)

Add `isValidatorReceipt` (mirrors `isVerifierReceipt` at lines 40-54 but strict on the DISTINCT identity + subgoal-only target + `recordedAt`):

```ts
function isValidatorReceipt(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && value.targetType === "subgoal"
    && typeof value.targetId === "string"
    && typeof value.objectiveHash === "string"
    && (value.verdict === "PASS" || value.verdict === "FAIL")
    && typeof value.recordedAt === "string"
    && value.validatorAgent === "plan-validator"
    && typeof value.summary === "string"
    && isStringArray(value.blockers)
    && isStringArray(value.commandsRun)
    && isStringArray(value.evidence)
    && typeof value.rawOutput === "string";
}
```

`isGoalCommand` gains one clause (place next to `record_verifier_result` at line 104):
```ts
case "record_validator_receipt":
  return isValidatorReceipt(value.receipt);
```

`isVerifierReceipt` is NOT edited (stays identity-strict on `"reviewer-verifier"`). The two allowlist branches are keyed on DIFFERENT command types AND different identity literals, so:
- A `record_validator_receipt` whose receipt carries `validatorAgent: "reviewer-verifier"` (verifier identity) ⇒ `isValidatorReceipt` false ⇒ event dropped (`"Ignored invalid goal-state-event"`).
- A `record_verifier_result` whose receipt carries `verifierAgent: "plan-validator"` (validator identity) ⇒ `isVerifierReceipt` false ⇒ event dropped.

### Constraints (enforced throughout)
- `schemaVersion` stays `1`; no migration path.
- `validatorReceipts` optional/back-filled; every read is `?? []`; the clone uses the `gates`-style `? map : undefined` form so ungated subgoals stay byte-identical (no phantom `[]`).
- Zero live behavior change: no code path sets `gates.validator`, constructs a `GoalValidatorReceipt`, or emits `record_validator_receipt`; goal-target and ungated-subgoal `complete_target`, `activate_goal`, and all existing commands are behaviorally identical; the two new ledger types are audit-only except the validator invariant which only runs on gated subgoals.
- The 4 external caller test files (session-replay, goal-command, goal-continuation, compaction) and all pre-existing cases in both in-scope test files pass without edits.

---

## Task 0: Baseline Lock — write the full desired surface as FAILING tests

**Goal:** Encode every M2 success criterion as tests across the two in-scope test files, before any implementation, so the surface is pinned and the red→green transition is observable.

**Dependencies:** None

**Files:**
- Modify (additive): `tests/goal-state.test.ts` — new `describe("M2 validator receipts + failure budget", …)` block.
- Modify (additive): `tests/goal-events.test.ts` — new fixtures in the existing `describe("goal-events", …)`.

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts tests/goal-events.test.ts` → the NEW cases FAIL; every PRE-EXISTING case in both files still PASSES.
- **Expected FAIL reasons (state them in the block as a comment so red is understood):** `GoalValidatorReceipt`/`GOAL_VALIDATOR_AGENT`/`type PanelState`-style imports resolve to `undefined` (missing exports); `record_validator_receipt` commands fall through `applyGoalCommand`'s exhaustive switch (TS union has no such member ⇒ the test file references an unknown command literal and the reducer returns/throws unexpectedly); `assertCompletionInvariant` still uses the verifier path for gated subgoals so validator-gated completes throw "latest verifier receipt is not PASS" instead of succeeding; `bumpFailureBudget` assertions see an empty `consecutiveFailures`; `isValidatorReceipt`-dependent replay drops the new command as invalid.

**Steps:**

1. In `tests/goal-state.test.ts`, import the new symbols (`GoalValidatorReceipt` type, `GOAL_VALIDATOR_AGENT`, and `type SubgoalItem` if needed) from `../goal-state.js` — these do not exist yet, so the file fails to compile/resolve. Add helpers alongside the existing `passReceipt`/`failReceipt`:
   - `gatedGoalWithSubgoal()` — `create_goal` with `gates: { validator: true }` → `create_subgoal` (`subgoal-1`) → returns state (subgoal auto-active).
   - `passValidatorReceipt(goal, subgoal, id = "vr-1")` and `failValidatorReceipt(goal, subgoal)` — build a `GoalValidatorReceipt` with `validatorAgent: GOAL_VALIDATOR_AGENT`, `targetType: "subgoal"`, `objectiveHash: buildGoalObjectiveHash(goal, subgoal)`, `recordedAt`, verdict PASS/FAIL.
2. Add the `describe("M2 validator receipts + failure budget", …)` block with these cases:
   - **gated subgoal completes via validator PASS + ledger row** — gated goal+subgoal → `request_completion` subgoal → `record_validator_receipt` PASS → `complete_target` subgoal succeeds (`subgoals[0].status === "completed"`); assert the ledger contains a `validator_pass` entry whose `data.receiptId` matches the receipt id.
   - **gated subgoal throws without a validator receipt** — gated goal+subgoal → `request_completion` → `complete_target` throws `GoalInvariantError` (`/latest validator receipt is not PASS/`).
   - **gated subgoal throws when the validator_pass ledger row is missing (full cross-check)** — hand-build a state (spread a gated goal+subgoal state, inject `subgoals[0].validatorReceipts = [passValidatorReceipt(...)]` WITHOUT emitting `record_validator_receipt`, so no `validator_pass` ledger entry) → `complete_target` throws (`/validator PASS ledger entry is missing/`).
   - **gated subgoal rejects a verifier-only receipt** — gated goal+subgoal, record a VERIFIER PASS on the subgoal (existing `record_verifier_result`) but NO validator receipt → `complete_target` throws (`/latest validator receipt is not PASS/`), proving the validator gate does not accept a verifier receipt.
   - **validator receipt after add_evidence is stale** — gated goal+subgoal → `record_validator_receipt` PASS → `add_evidence` to the subgoal → `complete_target` throws (`/stale/`).
   - **gates absent ⇒ verifier rule byte-identical (golden, positive)** — ungated goal+subgoal → `request_completion` subgoal → `record_verifier_result` PASS (subgoal receipt) → `complete_target` subgoal succeeds; assert `subgoals[0].validatorReceipts` is `undefined` (no phantom field) and the ledger uses `verifier_pass` (not `validator_pass`).
   - **gates absent ⇒ a validator-only receipt does NOT complete** — ungated goal+subgoal, inject a validator PASS receipt only → `complete_target` throws (verifier path unchanged, `/latest verifier receipt is not PASS/`).
   - **budget: gated goal-level verifier FAIL increments, PASS resets** — gated goal → `record_verifier_result` FAIL targeting the GOAL → `continuation.consecutiveFailures[goalId] === 1`; another FAIL → `2`; a PASS → key deleted (`consecutiveFailures[goalId] === undefined`).
   - **budget: gated subgoal validator FAIL increments, PASS resets** — gated goal+subgoal → `record_validator_receipt` FAIL → `consecutiveFailures[subgoalId] === 1`; FAIL again → `2`; PASS → deleted.
   - **budget: survives clear_continuation-before-record ordering** — gated goal+subgoal → `record_validator_receipt` FAIL (`counter === 1`) → `queue_continuation` → `clear_continuation` → `record_validator_receipt` FAIL → assert `consecutiveFailures[subgoalId] === 2` (the clear did NOT wipe the counter; mirrors index.ts:2007-then-2024 ordering).
   - **budget: UNGATED FAIL leaves consecutiveFailures untouched** — ungated goal+subgoal → `record_verifier_result` FAIL (subgoal) AND `record_validator_receipt` FAIL (if the command is accepted for an ungated goal, it still must not bump) → assert `consecutiveFailures` deep-equals `{}`.
   - **budget: panel verdicts never touch it** — gated goal → `open_panel` → `record_panel_verdict` REJECT → assert `consecutiveFailures` deep-equals `{}`.
3. In `tests/goal-events.test.ts`, add these fixtures (they fail to reconstruct until the reducer + allowlist land):
   - **pre-validator-era log replays and reconstructs completions** — a no-snapshot log with NO gates and NO validator receipts: `create_goal` (no gates) → `create_subgoal` → `request_completion` subgoal → `record_verifier_result` PASS (subgoal; hash via a partial-replay like the M1 pre-gates golden test at lines 183-223) → `complete_target` subgoal; assert `errors === []` and `subgoals[0].status === "completed"` (old logs replay through the verifier path unchanged).
   - **validator receipt round-trips replay** — a no-snapshot log: `create_goal` with `gates: { validator: true }` → `create_subgoal` → `request_completion` subgoal → `record_validator_receipt` PASS (hash via partial replay; `validatorAgent: "plan-validator"`) → `complete_target` subgoal; assert `errors === []`, `subgoals[0].status === "completed"`, `subgoals[0].validatorReceipts` has one entry, and the ledger has a `validator_pass` entry.
   - **negative: verifier-identity receipt rejected by the validator command** — a raw `record_validator_receipt` event whose `receipt.validatorAgent` is `"reviewer-verifier"` ⇒ assert `errors` includes `"Ignored invalid goal-state-event at index 0"` and no validator receipt lands.
   - **negative: validator-identity receipt rejected by the verifier command** — a raw `record_verifier_result` event whose `receipt.verifierAgent` is `"plan-validator"` ⇒ assert `errors` includes `"Ignored invalid goal-state-event at index 0"` and no verifier receipt lands.
4. Run `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts tests/goal-events.test.ts`. Confirm the new cases FAIL and pre-existing cases PASS. **Do not run `npm run build` yet** (it will type-error on the missing `GoalValidatorReceipt`/`record_validator_receipt`/`GOAL_VALIDATOR_AGENT` symbols — expected).

---

## Task 1: Validator receipt type, subgoal field, and deep-clone

**Goal:** Add the distinct receipt type surface and make `cloneState` deep-clone `validatorReceipts` without materializing a phantom array on ungated subgoals.

**Dependencies:** Task 0

**Files:**
- Modify: `goal-state.ts` — `GOAL_VALIDATOR_AGENT`, `GoalValidatorReceipt`; `SubgoalItem.validatorReceipts?`; `cloneValidatorReceipt`; `cloneState` subgoal clause.

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts` → the **gates-absent golden (positive)**, **gates-absent validator-only does NOT complete**, and any purely type/clone-dependent case compile and pass; command-dependent cases still fail until Tasks 2-4.
- `cd extensions/agentic-harness && npm run build` still type-errors ONLY on the not-yet-added `record_validator_receipt` command / ledger types (no error on the receipt type itself).

**Steps:**
1. Add `export const GOAL_VALIDATOR_AGENT = "plan-validator" as const;` and the `GoalValidatorReceipt` interface exactly as pinned (after `GoalVerifierReceipt`).
2. Add `validatorReceipts?: GoalValidatorReceipt[];` to `SubgoalItem` (after `verifierReceipts`).
3. Add `cloneValidatorReceipt` mirroring `cloneReceipt` (deep-copy `blockers`/`commandsRun`/`evidence`).
4. In `cloneState`, inside the `goal.subgoals.map((subgoal) => ({ ... }))`, add:
   ```ts
   validatorReceipts: subgoal.validatorReceipts ? subgoal.validatorReceipts.map(cloneValidatorReceipt) : undefined,
   ```
   The `? : undefined` form (NOT `?? []`) keeps ungated subgoals byte-identical.
5. Run the scoped command; confirm the two golden gates-absent cases behave (they exercise only the verifier path + the clone) and no pre-existing case regresses.

---

## Task 2: `record_validator_receipt` command + ledger types

**Goal:** Implement the new command case and its two ledger types (bump wiring lands in Task 3; invariant branch in Task 4).

**Dependencies:** Task 1

**Files:**
- Modify: `goal-state.ts` — `GoalCommand` (+1 member); `GoalLedgerEntry.type` (+2); the `record_validator_receipt` reducer case (WITHOUT the `bumpFailureBudget` call yet — add a `// budget wired in Task 3` placeholder, or land Task 3's helper first if executing together).

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts` → the **gated subgoal completes via validator PASS + ledger row**, **throws without a validator receipt**, **throws when ledger row missing**, **rejects a verifier-only receipt**, and **validator receipt after add_evidence is stale** cases PASS ONLY AFTER Task 4 also lands (they depend on the invariant branch). The reducer-mechanics assertions (a `validator_pass`/`validator_fail` ledger entry is emitted; `validatorReceipts` gains the entry) PASS now.
- `cd extensions/agentic-harness && npm run build` is green (the union is now exhaustive again).

**Steps:**
1. Add `| { type: "record_validator_receipt"; receipt: GoalValidatorReceipt }` to the `GoalCommand` union (after `record_verifier_result`).
2. Add `| "validator_pass"` and `| "validator_fail"` to `GoalLedgerEntry.type` (after `verifier_fail`).
3. Add the `record_validator_receipt` case exactly as pinned in the Design section (subgoal-only guard; `?? []` init; status/blockers mirror verifier; `validator_pass`/`validator_fail` ledger with `data.receiptId`). Leave the `bumpFailureBudget(...)` call in place if Task 3 is executed in the same pass; otherwise stub and land in Task 3.
4. Keep the switch exhaustive (no `default`) so `tsc` forces coverage. Run the scoped command; confirm ledger-mechanics assertions pass and the build is green.

---

## Task 3: `bumpFailureBudget` helper + wiring into both receipt commands

**Goal:** Add the reducer-owned budget helper and wire it into `record_verifier_result` and `record_validator_receipt`, gated on `gates.validator`.

**Dependencies:** Task 2

**Files:**
- Modify: `goal-state.ts` — `bumpFailureBudget` helper; one call in `record_verifier_result` (line ~433, before `withLedger`); one call in `record_validator_receipt`.

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts` → the five **budget** cases PASS (gated goal-level verifier FAIL/PASS; gated subgoal validator FAIL/PASS; clear_continuation-ordering survival; UNGATED untouched; panel-verdict untouched); every pre-existing case still passes.

**Steps:**
1. Add `bumpFailureBudget(state, goal, targetId, verdict)` exactly as pinned (early-return unless `goal.gates?.validator === true`; FAIL increments, PASS `delete`s the key; mutates `state.continuation.consecutiveFailures` on the clone).
2. In `record_verifier_result`, after the target branch and before `withLedger`, add:
   `bumpFailureBudget(next, target.goal, target.type === "goal" ? target.goal.id : target.subgoal.id, command.receipt.verdict);`
3. Confirm `record_validator_receipt` calls `bumpFailureBudget(next, target.goal, target.subgoal.id, command.receipt.verdict)`.
4. Run the scoped command; confirm all budget cases green and the UNGATED / panel-verdict guards prove zero bleed.

---

## Task 4: Flag-conditional validator completion invariant

**Goal:** Route gated-subgoal `complete_target` through a validator invariant that requires a validator PASS receipt + matching `validator_pass` ledger row + fresh hash, leaving the verifier invariant byte-identical for all other targets.

**Dependencies:** Task 1 (field), Task 2 (ledger type + command)

**Files:**
- Modify: `goal-state.ts` — top-of-`assertCompletionInvariant` early return; new `assertValidatorCompletionInvariant` helper (reuses `entryMatchesTarget`, `buildGoalObjectiveHash`).

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts` → ALL M2 goal-state cases PASS (validator happy path, all four throw cases, both gates-absent golden cases); every pre-existing case still PASSES.

**Steps:**
1. Add the early-return guard at the top of `assertCompletionInvariant`: if `target.type === "subgoal" && target.goal.gates?.validator === true`, call `assertValidatorCompletionInvariant(state, target.goal, target.subgoal)` and `return`. Do NOT edit any line of the existing verifier body below it.
2. Add `assertValidatorCompletionInvariant` exactly as pinned (latest `validatorReceipts` PASS; target match; `buildGoalObjectiveHash(goal, subgoal)` freshness; reverse-scan for the `validator_pass` ledger row via `entryMatchesTarget`; forward stale-scan for `evidence_added`/`subgoal_created`/`completion_requested`).
3. Run the scoped command; confirm the full M2 goal-state block is green and the M1 + `goal-state reducer` blocks are untouched-green (gates-absent byte-identity).

---

## Task 5: Replay allowlist for `record_validator_receipt` + identity negatives

**Goal:** Widen `isGoalCommand` so `record_validator_receipt` replays only with a well-formed, identity-pinned validator receipt, and prove both-direction identity rejection.

**Dependencies:** Task 2 (command type exists)

**Files:**
- Modify: `goal-events.ts` — `isValidatorReceipt` helper; `record_validator_receipt` clause in `isGoalCommand`.

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test -- tests/goal-events.test.ts` → the **pre-validator-era log**, **validator receipt round-trip**, and both **identity-negative** cases PASS; every pre-existing goal-events case still PASSES.

**Steps:**
1. Add `isValidatorReceipt` exactly as pinned (identity-strict on `"plan-validator"`, `targetType: "subgoal"`, `recordedAt`). Do NOT edit `isVerifierReceipt`.
2. Add `case "record_validator_receipt": return isValidatorReceipt(value.receipt);` to the `isGoalCommand` switch.
3. Run the scoped command; confirm the four targeted goal-events cases pass (the round-trip proves acceptance; the two negatives prove `isValidatorReceipt`/`isVerifierReceipt` reject the swapped identity in each direction).

---

## Task 6: Full milestone verification gate + scope sanity check

**Goal:** Prove the whole milestone green and confirm only the four in-scope files changed.

**Dependencies:** Tasks 0–5

**Files:** None (verification only; fix in the owning task if anything fails).

**Acceptance criteria (binary):**
- `cd extensions/agentic-harness && npm test && npm run build` exits 0.
- `cd extensions/agentic-harness && npm test -- tests/session-replay.test.ts tests/goal-command.test.ts tests/goal-continuation.test.ts tests/compaction.test.ts` exits 0 (four caller files pass UNMODIFIED).
- `git diff --stat` shows changes confined to exactly: `goal-state.ts`, `goal-events.ts`, `tests/goal-state.test.ts`, `tests/goal-events.test.ts` (plus the incidental pre-existing `package-lock.json` if `npm` touched it). **`goal-storage.ts` MUST NOT appear** — if it does, the Work-Scope justification was violated; revert it and re-derive the clone/invariant totality at the type layer.
- `schemaVersion` still `1`: `grep -n "GOAL_STATE_SCHEMA_VERSION = 1" extensions/agentic-harness/goal-state.ts` matches; no `schemaVersion` literal changed.

**Steps:**
1. Run the full gate `cd extensions/agentic-harness && npm test && npm run build`. If red, return to the owning task; do not patch around failures here.
2. Run the four unmodified caller files; confirm green (zero-live-behavior proof).
3. From the repo root run `git diff --stat` and confirm the changed-file set is exactly the four Work-Scope files (plus possibly `package-lock.json`). Any stray file ⇒ revert it.
4. Confirm `schemaVersion` is untouched via the grep above.

---

## Rollback Plan

Every change is additive and dormant (no caller sets `gates.validator`, constructs a `GoalValidatorReceipt`, or emits `record_validator_receipt`), so partial delivery is safe to leave or revert:
1. If the full gate fails late, keep any task whose scoped tests pass independently — the type/clone (Task 1), command+ledger (Task 2), budget (Task 3), invariant (Task 4), and events (Task 5) changes are orthogonal, though Task 3/4/5 each depend on Task 2's command existing; if Task 2 is reverted, revert 3/4/5 with it.
2. To fully revert, `git checkout` the four in-scope files; because `schemaVersion` never changed, `validatorReceipts` is optional, and `gates.validator` is never set, any snapshot written during the branch still loads on the pre-M2 reducer (old code ignores the extra `validatorReceipts` key and never emits `validator_*` ledger entries). No migration or data cleanup required.
3. Do NOT ship a state where `isGoalCommand` accepts `record_validator_receipt` but the reducer lacks its case (or vice versa) — that pairing is enforced by Tasks 2+5 landing together; if only one lands, revert both.
4. Do NOT ship the `bumpFailureBudget` wiring (Task 3) without the `goal.gates?.validator` early-return — an unguarded bump would mutate ungated goals' counters and break the zero-live-behavior contract.

## Self-Review

- **Spec coverage:** All 5 SCs mapped to tasks — SC1 (validator-gated complete succeeds/throws incl. ledger cross-check + gates-absent byte-identity) → Tasks 0/2/4; SC2 (distinct type builds; `isValidatorReceipt` command+identity keyed; `isVerifierReceipt` untouched; both-direction negatives) → Tasks 0/1/2/5; SC3 (budget gated-only, FAIL/PASS both commands, clear_continuation-ordering survival, ungated untouched, panels never touch) → Tasks 0/3; SC4 (pre-validator-era replay + validator round-trip) → Tasks 0/5; SC5 (full gate) → Task 6.
- **Distinct-type discipline:** `GoalVerifierReceipt.verifierAgent` is NOT widened; `GoalValidatorReceipt` is a separate interface with its own `validatorAgent`/`recordedAt`; the two allowlist branches key on different command types AND different identity literals — the swap is rejected in both directions.
- **Byte-identity discipline:** the verifier body of `assertCompletionInvariant` is untouched (guarded by an early return); the clone uses `? : undefined` so ungated subgoals gain no phantom `validatorReceipts`; goal-target and ungated-subgoal completion and all existing commands are behaviorally identical; the two new ledger types are unread outside the gated validator invariant. Proof = four unmodified caller test files + additive-only pre-existing cases + the two gates-absent golden goal-state cases + the pre-validator-era goal-events replay.
- **Ordering integrity:** `clear_continuation` preserves `consecutiveFailures` (verified at goal-state.ts:554), and the real handler order (index.ts:2007 clear → 2024 record) is reproduced by the survival test; the counter increments across the clear rather than resetting.
- **Storage restraint:** `goal-storage.ts` is deliberately NOT modified — totality on pre-M2 snapshots is achieved at the optional-field + `?? []`-guard + `? : undefined`-clone layer, and Task 6's `git diff --stat` gate enforces its absence; the milestone's "goal-storage only if a back-fill proves necessary" allowance is consumed by a written justification, not an edit.
- **Risk residual:** the riskiest task is Task 4 (the flag-conditional invariant branch — a wrong guard would either leak the validator rule onto ungated/goal targets or fail to replace the verifier for gated subgoals); mitigated by Task 0 pinning all four throw messages + both gates-absent golden cases before implementation, and by structuring the branch as a top-of-function early return that leaves the proven verifier body literally unedited.
