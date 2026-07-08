# M4b — Contract critic panel orchestration (panel-first single approval)

> **Worker note:** Execute strictly in task order. Task 0 locks the test surface first — it BOTH authors new failing assertions AND rewrites the M4a transitional assertions in the SAME file (`tests/goal-workflow.test.ts`), so read it carefully (some assertions FAIL at baseline, some are characterization guards that pass). After each task passes its stated verification, flip its checkbox. This milestone is **`index.ts` + two test files only** (`tests/goal-workflow.test.ts`, `tests/extension.test.ts`). Do NOT edit any goal reducer/state/storage module (`goal-state.ts`, `goal-events.ts`, `goal-storage.ts`), any clarification module, `verdict-format.ts`, or any `agents/*.md` — every primitive this milestone needs (`open_panel` / `record_panel_verdict` / `activate_goal_gated` / `isPanelApproved` / `PanelState` / `gates`, the `parsePanelVerdictOutput` parser, and the three critic agent bodies) was delivered dormant by M1 / M3 and is CONSUMED here, not modified. If a step tempts you to add a reducer command or a state field, STOP: M4b is a **wiring/orchestration** milestone. This milestone finalizes the panel-first ordering: **draft → panel loop to convergence → the ONE confirm of the converged contract → `activate_goal_gated`**. It relocates the M4a universal confirm from *before* activation to *after* panel convergence and rewrites the M4a activate-on-approval assertions accordingly.

**Goal:** Insert the 3-critic contract panel BEFORE the single user approval, inside `autoStartGoalRuntime` (or helpers it calls). For a **non-trivial** drafted contract: `open_panel` (stable per-run panelId, round from persisted state) → parallel programmatic dispatch of `reviewer-feasibility` / `reviewer-architecture` / `reviewer-risk` via `runAgent` + `mapWithConcurrencyLimit` (fresh context, sandboxed — the `runGoalVerifier` pattern) → parse each with `parsePanelVerdictOutput` (null ⇒ REJECT + malformed finding) → `record_panel_verdict` per member → **all APPROVE** ⇒ present the converged contract → the **one** universal `ctx.ui.confirm` (moved here from M4a) → `create_goal` with `gates: { panel: true }` → `activate_goal_gated`; **any REJECT** ⇒ keep phase `goal_drafting`, send a findings-carrying follow-up so the MODEL revises via `draft_goal_contract`, re-entry re-opens the SAME panel with `round + 1` and re-dispatches the FULL panel; **round > 3** ⇒ escalation follow-up, no confirm, no activation. **Trivial escape** (`suggestedSubgoals.length <= 1 && successCriteria.length <= 2 && !isHighRiskGoalContract(contract)`): skip the panel entirely, keep the exact M4a path — confirm (still universal, still fail-closed) then plain `activate_goal`, `gates.panel` unset, no panelId.

**Architecture:** All changes land inside `index.ts` in the goal-command scope (`export default function (pi)`, index.ts:313). No new command handler, no new tool, no new reducer command.

1. **New pure helpers** near `isHighRiskGoalContract` (index.ts:1696): a `CONTRACT_CRITICS` constant, a `CONTRACT_PANEL_ID` constant, an `isTrivialGoalContract(contract)` predicate, a `buildContractCriticTask(contract)` task-serializer, and a `dispatchContractPanel(ctx, contract)` orchestrator that discovers the three critic agents (`discoverAgents`, index.ts:1879 pattern), dispatches them with `runAgent` + `mapWithConcurrencyLimit` (contextMode `"fresh"`, the verifier sandbox block verbatim), and returns each member's parsed verdict.
2. **`autoStartGoalRuntime` rewrite** (index.ts:1758-1829): the `if (!goal) { … }` no-existing-goal branch forks on `isTrivialGoalContract`. Trivial → the current M4a body byte-for-byte (fail-closed → confirm → create_goal (no gates) → fall through to the shared queued→`activate_goal` tail). Non-trivial → the panel-first orchestration (fail-closed up-front → `open_panel`/round-cap → dispatch → record verdicts → converge-confirm-`create_goal`(gates.panel)-`activate_goal_gated`-autoprompt-`return`, OR reject/escalate follow-up + `return`). The existing-active-goal short-circuit at the top (`goal = activeOrRunnableGoal(state)`) is UNTOUCHED, so repeated `/goal` after activation still skips the panel (idempotency preserved with zero extra dispatch).
3. **Confirm relocation.** The M4a universal confirm + fail-closed guard (index.ts:1778-1784) is REMOVED from its pre-`create_goal` position and re-expressed on both forks: trivial keeps it pre-`create_goal` (unchanged semantics); non-trivial fires the `ctx.ui.confirm` only AFTER `isPanelApproved`, on the converged contract. The fail-closed *capability* check (no `ctx.ui.confirm` or `hasUI === false`) is asserted up-front on BOTH forks (cheap; avoids dispatching a panel for a contract that can never be confirmed) — but the actual user-facing `ctx.ui.confirm()` call still happens exactly once per successful run, after convergence.

**Tech Stack:** TypeScript ESM, Pi extension API (`@mariozechner/pi-coding-agent`), Vitest. No new runtime dependencies, no new reducer commands, no new state fields. New imports into `index.ts`: `parsePanelVerdictOutput` from `./verdict-format.js` and `isPanelApproved` from `./goal-state.js`.

**Work Scope:**
- **In scope:** `index.ts` — new panel helpers, the `autoStartGoalRuntime` fork/rewrite, the confirm relocation, the two new imports. `tests/goal-workflow.test.ts` — extend the mock harness (a `criticResult` builder), rewrite the two M4a non-trivial autostart assertions, add the convergence / parallel-dispatch / REJECT / malformed / re-entry-round / escalation / trivial-skip / restart-resume assertions. `tests/extension.test.ts` — a source-level registration pin that the panel roster wires exactly the three M3 contract critics (SC4 "registration pins updated").
- **Out of scope (do NOT touch):** `goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `verdict-format.ts`, `agents/*.md`, all clarification modules, the manual `/goal create→activate→complete` command branches (index.ts:1965-2019 — left byte-identical, ungated, panel-free), `isHighRiskGoalContract`'s definition (it is CONSUMED by `isTrivialGoalContract`), `runGoalVerifier` (the read-only dispatch reference), `skills/**`, `tests/skill-docs.test.ts`, `tests/agents.test.ts`, `tests/verdict-format.test.ts` (already green; must STAY green).

**Verification Strategy:**
- **Level:** test-suite + build (the exact gate CI enforces on push to main).
- **Command:** `cd extensions/agentic-harness && npm test && npm run build`
- **Scoped command (per-task iteration):** `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts tests/extension.test.ts`
- **What passing proves:** a non-trivial contract dispatches the three critics in parallel with fresh sandboxed context; activation happens ONLY via `activate_goal_gated` after all-3-APPROVE AND the single post-convergence confirm; the confirm fires exactly once, on the converged contract; any REJECT drives a findings follow-up (phase `goal_drafting`) with no activation and no confirm; re-entry re-opens the same panel with an incremented persisted round and re-dispatches the full panel; a 4th round escalates without activating; a trivial contract skips the panel yet still confirms and activates ungated; a killed-and-restored mid-panel session re-enters and re-dispatches on the next `/goal` turn; and no other suite regressed.

**Success Criteria** (verbatim from milestone M4b):
- [ ] goal-workflow tests (mocked runAgent, M3-format verdicts): non-trivial contract dispatches 3 critics in parallel; activation only via `activate_goal_gated` after 3 APPROVEs AND the post-convergence confirm; the confirm fires EXACTLY once per run and always on the converged contract text; subgoals then complete via the existing verifier gate.
- [ ] goal-workflow tests: REJECT ⇒ findings follow-up, re-entry re-runs the FULL panel with incremented persisted round; 4th round escalates without activation; trivial contract skips the panel but still confirms.
- [ ] goal-workflow tests: a killed-and-restored session mid-panel reconstructs panel state and re-enters the flow on the next goal-routed user turn (one-turn resume residual — decision #8); tests must not assert `consecutiveFailures` emptiness (M2 populates it in parallel wave).
- [ ] verdict-format + extension tests green (parser consumed; registration pins updated).
- [ ] `cd extensions/agentic-harness && npm test && npm run build` green.

---

## Canonical literals (use these EXACT strings so pins line up)

| Token | Exact literal |
|---|---|
| `CONTRACT_CRITICS` roster (order-pinned) | `["reviewer-feasibility", "reviewer-architecture", "reviewer-risk"]` |
| `CONTRACT_PANEL_ID` (stable per-run) | `goal-contract-panel` |
| Panel `purpose` | `Contract critic review (feasibility / architecture / risk)` |
| Universal confirm — title (reused from M4a) | `Start Goal Contract?` |
| Universal confirm — message prefix (then `\n\n${contract.objective}`) | `Review this Goal Contract and start the durable goal runtime now?` |
| Non-interactive fail-closed notify (reused from M4a) | `Goal Contract requires interactive confirmation before it can start. The drafted contract remains — run /goal in an interactive session to review and start it.` |
| REJECT findings follow-up — lead line | `The contract critic panel returned REJECT. Revise the Goal Contract to address these blocking findings, then call clarification_state with action=draft_goal_contract again:` |
| Escalation follow-up — lead line (round > 3) | `The contract critic panel did not converge after 3 rounds. Stop the automatic goal start and summarize the unresolved blocking findings for the user to resolve manually:` |
| Malformed-output synthetic finding text | `malformed critic output (no parseable VERDICT line) — treated as REJECT` |

**Panel round cap:** `3`. Rounds 1–3 dispatch the panel; a re-entry that would be round 4 escalates instead (guard: `existingPanel && existingPanel.round >= 3`).

---

## Design decisions pinned for this milestone

- **The panelId is a STABLE per-run constant, NOT `draftedAt` and NOT a uuid.** The milestone brief offers "panelId derived from contract `draftedAt` or a uuid" — both are WRONG here and the worker must use the constant `CONTRACT_PANEL_ID = "goal-contract-panel"` instead. Reason (load-bearing): on REJECT the MODEL re-drafts the contract through `draft_goal_contract`, which stamps a **fresh** `draftedAt` (clarification-state.ts:228 `draftedAt: now`) and revises the objective — so nothing contract-derived is stable across revisions. `open_panel` increments the round only when it finds an EXISTING panel with the same `panelId` (goal-state.ts:296-303: existing ⇒ `round += 1` and `verdicts = []`; else round 1). A per-draft or random panelId would create a new panel every round, pin the round at 1 forever, and defeat both the cap-3 escalation and the persisted-round resume. A per-run constant is correct because the pipeline vets exactly one contract to activation at a time (decisions #2/#8: one goal per run; `activeOrRunnableGoal` short-circuits the panel once a goal is active). Accepted residual (documented): a second, genuinely different contract drafted later in the SAME run would reuse the constant panelId with a stale round — out of scope for M4b, and M_final runs a FRESH run (decision #2).
- **Round-cap check precedes `open_panel`.** Read the persisted panel (`state.panels.find(p => p.panelId === CONTRACT_PANEL_ID)`) BEFORE opening. If it exists and `round >= 3`, escalate and return WITHOUT dispatching (do not let `open_panel` bump to 4 and waste 3 subagent runs). Otherwise `open_panel` (round becomes `existing ? existing.round + 1 : 1`) then dispatch.
- **Fail-closed capability check up-front on both forks; the user confirm stays post-convergence on the non-trivial fork.** Refuse to autostart when `!ctx?.ui?.confirm || (ctx as any).hasUI === false` — `notifyGoal(ctx, <fail-closed literal>, "error")` + `return state`. On the non-trivial fork this guard runs BEFORE `open_panel` (no point vetting a contract that can never be confirmed); the actual `ctx.ui.confirm(...)` call fires exactly once, AFTER `isPanelApproved`, on the converged contract. This preserves "confirm fires exactly once per successful run" while avoiding a wasted panel dispatch in a non-interactive host.
- **`gates.panel` is set on the non-trivial `create_goal` only.** The non-trivial `create_goal` command carries `gates: { panel: true }`; the trivial `create_goal` omits `gates` entirely (stays `undefined`). Activation on the non-trivial fork uses `activate_goal_gated` (carrying `CONTRACT_PANEL_ID`); the trivial fork uses plain `activate_goal` via the shared queued tail. This is exactly decision #4/#9.
- **Trivial escape is panel-ONLY and preserves the M4a path byte-for-byte.** `isTrivialGoalContract(contract) = contract.suggestedSubgoals.length <= 1 && contract.successCriteria.length <= 2 && !isHighRiskGoalContract(contract)`. A trivial contract still confirms (universal, fail-closed) and still activates — it just skips the panel and stays ungated (`gates.panel` unset). This is what keeps every existing `createReadyGoal`-based completion test green (that helper drafts with `suggestedSubgoals = []` ⇒ trivial ⇒ the verifier is the only `runAgent` caller, so `toHaveBeenCalledTimes(1)` at goal-workflow.test.ts:377 still holds).
- **Confirm relocation rewrites the M4a transitional assertions.** M4a asserted activate-on-approval through the pre-`create_goal` confirm on EVERY contract. Under M4b the default 2-subgoal contract used by "auto-creates and activates" (goal-workflow.test.ts:117) and "does not duplicate" (:150) is NON-TRIVIAL, so those two tests MUST be rewritten to mock the 3-critic panel and assert gated activation. This is the "rewrite the M4a transitional assertions accordingly" work called out in the milestone and decision #7.
- **Dispatch mirrors `runGoalVerifier` exactly.** Fresh context (`contextMode: "fresh"`), the identical `sandbox` block (index.ts:1892-1899: `enabled: true`, `workspaceRoot`, `networkMode: "on"`, `additionalWritableRoots: piWritableRoots`, `approvalMode: parsedApprovalMode.mode`, `requireApprovalForAllCommands: true`), `depthConfig`, `makeDetails("single")`, agent discovered via `discoverAgents(ctx?.cwd || process.cwd(), "user", BUNDLED_AGENTS_DIR)`. Output extracted with `isResultSuccess(result) ? getFinalOutput(result.messages) : (result.errorMessage || result.stderr || …)`; a non-success result OR a `null` parse is treated as REJECT.
- **Tests must NOT assert `consecutiveFailures` emptiness / continuation-counter state.** M2 (parallel wave) wires the failure budget; M4b assertions must not depend on those counters being empty or present. Assert only panel state, goal status/activation, confirm calls, `runAgent` call counts, and follow-up message content.

---

## File Structure Mapping

**Modify (source):**
- `extensions/agentic-harness/index.ts` — anchored by symbol:
  - imports (top of file, near index.ts:62-64): add `parsePanelVerdictOutput` from `./verdict-format.js`, `isPanelApproved` from `./goal-state.js`.
  - new helpers immediately after `isHighRiskGoalContract` (index.ts:1696-1710): `CONTRACT_CRITICS`, `CONTRACT_PANEL_ID`, `isTrivialGoalContract`, `buildContractCriticTask`, `dispatchContractPanel`.
  - `autoStartGoalRuntime` (index.ts:1758-1829): the `if (!goal) { … }` branch fork + confirm relocation.

**Modify (tests):**
- `extensions/agentic-harness/tests/goal-workflow.test.ts` — add a `criticResult(...)` builder; rewrite the ":117" and ":150" non-trivial autostart tests; add the new panel behavior tests; add the trivial-skip and restart-resume characterization tests.
- `extensions/agentic-harness/tests/extension.test.ts` — add a source-level pin (readFile `../index.ts`) that the panel roster equals the three M3 contract critics.

**Must NOT change:** `goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `verdict-format.ts`, `agents/*.md`, all clarification modules, `tests/skill-docs.test.ts`, `tests/agents.test.ts`, `tests/verdict-format.test.ts`, the manual `/goal` command branches, `runGoalVerifier`, `isHighRiskGoalContract`'s definition.

---

## Task 0 — Baseline Lock (author the test surface first)

**Dependencies:** None
**Files:** Modify `tests/goal-workflow.test.ts`, `tests/extension.test.ts`

Author the new/updated assertions BEFORE editing any source. The failing-at-baseline set below fails because the baseline (M4a) code has no panel logic. The two characterization guards that PASS at baseline (trivial-skip, restart-resume-shape) are deferred to Task 5 so this task's FAIL signal stays clean.

- [ ] **Step 1 — Record the reconfirmed baseline count.** Run `cd extensions/agentic-harness && npm test 2>&1 | tail -5` and record the file/test totals (expected ≈ 72 files / 779 tests per the M4a checkpoint). The final task must match this modulo M4b's added tests.
- [ ] **Step 2 — Test-infra: add a `criticResult` builder.** In `tests/goal-workflow.test.ts`, add near `verifierResult` (:567) a helper that returns a `SingleResult`-shaped object whose assistant text is a valid panel block. Signature `criticResult(verdict: "APPROVE" | "REJECT", finding?: string)`:
  ```ts
  function criticResult(verdict: "APPROVE" | "REJECT", finding = "coverage gap in evidenceRequired"): any {
    const text = verdict === "APPROVE"
      ? "CHECKS:\n- C1: YES — verified\n- C2: YES — verified\nVERDICT: APPROVE\nFINDINGS:\n- [advisory] none"
      : `CHECKS:\n- C1: NO — missing\nVERDICT: REJECT\nFINDINGS:\n- [REJECT-level] ${finding}`;
    return { agent: "reviewer-feasibility", agentSource: "bundled", task: "critic", exitCode: 0, messages: [{ role: "assistant", content: [{ type: "text", text }] }], stderr: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 } };
  }
  ```
  (No malformed helper needed — for the malformed case mock a `verifierResult("Summary: I have no opinion")`, which has no `VERDICT:` line and parses to `null`.) Run the scoped command. **Expected:** still green (adding an unused helper changes nothing).
- [ ] **Step 3 — Rewrite the ":117" non-trivial autostart test (FAILS until Task 2).** The test `it("auto-creates and activates latest drafted Goal Contract with /goal", …)` (goal-workflow.test.ts:117) uses the default 2-subgoal contract ⇒ non-trivial. Prepend `vi.mocked(runAgent).mockResolvedValue(criticResult("APPROVE"));` and add, after the existing activation assertions:
  ```ts
  // 3 critics dispatched in parallel, fresh + sandboxed
  expect(runAgent).toHaveBeenCalledTimes(3);
  const dispatched = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName).sort();
  expect(dispatched).toEqual(["reviewer-architecture", "reviewer-feasibility", "reviewer-risk"]);
  expect(vi.mocked(runAgent).mock.calls.every((c: any[]) => c[0].contextMode === "fresh" && c[0].sandbox?.enabled === true)).toBe(true);
  // gated activation with the panel approved
  expect(state.goals[0].gates?.panel).toBe(true);
  const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
  expect(panel.verdicts.filter((v) => v.verdict === "APPROVE")).toHaveLength(3);
  expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
  ```
  Keep the existing `state.status === "active"`, `activeGoalId === "goal-1"`, subgoal, and auto-prompt assertions. **FAILS at baseline** (baseline never calls `runAgent` here, never sets `gates.panel`, never opens a panel).
- [ ] **Step 4 — Rewrite the ":150" no-duplicate test (FAILS until Task 2).** `it("does not duplicate a goal when /goal is repeated for the same contract", …)` (:150) is non-trivial. Prepend `vi.mocked(runAgent).mockResolvedValue(criticResult("APPROVE"));`. After the two `goal.handler("", ctx)` calls, keep `expect(state.goals).toHaveLength(1)` and `state.goals[0].status === "active"`, and add:
  ```ts
  // the panel dispatched once (first turn converged + activated); the second /goal found the active goal and skipped the panel
  expect(runAgent).toHaveBeenCalledTimes(3);
  const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
  expect(panel.round).toBe(1);
  ```
  **FAILS at baseline** (baseline calls `runAgent` 0 times, no panel).
- [ ] **Step 5 — Add the convergence dispatch/gated-activation test (FAILS until Task 2).** Add `it("dispatches the full 3-critic panel and activates only via activate_goal_gated after convergence", …)`: `vi.mocked(runAgent).mockResolvedValue(criticResult("APPROVE"))`; `draftClarificationContract(cwd, runId, ctx)` (default 2-subgoal ⇒ non-trivial); `await goal.handler("", ctx)`. Load goal state; assert `runAgent` called 3× with the 3 critic `agentName`s, `state.status === "active"`, `state.goals[0].gates?.panel === true`, the panel has 3 APPROVE verdicts, `ctx.ui.confirm` called exactly once with `("Start Goal Contract?", expect.stringContaining("Ship automatic goal runtime"))`, and the auto-prompt follow-up was sent. **FAILS at baseline.**
- [ ] **Step 6 — Add the REJECT findings-follow-up test (FAILS until Task 2).** Add `it("records REJECT verdicts and sends a findings follow-up without confirming or activating", …)`: mock one critic REJECT via `vi.mocked(runAgent).mockImplementation(async (opts: any) => opts.agentName === "reviewer-risk" ? criticResult("REJECT", "success criteria do not prove the objective") : criticResult("APPROVE"))`; non-trivial draft; `await goal.handler("", ctx)`. Assert:
  ```ts
  expect(state.goals).toHaveLength(0);                    // no activation
  expect(ctx.ui.confirm).not.toHaveBeenCalled();          // no confirm on REJECT
  const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
  expect(panel.round).toBe(1);
  expect(panel.verdicts.some((v) => v.verdict === "REJECT")).toBe(true);
  expect(mockPi.sendUserMessage).toHaveBeenCalledWith(
    expect.stringContaining("Revise the Goal Contract to address these blocking findings"),
    expect.anything(),
  );
  ```
  **FAILS at baseline.**
- [ ] **Step 7 — Add the malformed-output-is-REJECT test (FAILS until Task 2).** Add `it("treats malformed critic output as REJECT", …)`: mock one critic to return `verifierResult("Summary: I have no clear opinion")` (no `VERDICT:` line ⇒ `parsePanelVerdictOutput` returns `null`) and the others APPROVE, via `mockImplementation` keyed on `agentName`. Non-trivial draft; `await goal.handler("", ctx)`. Assert the offending member has a recorded `REJECT` verdict whose `findings` contains `"malformed critic output"`, `state.goals` length 0, and the findings follow-up fired. **FAILS at baseline.**
- [ ] **Step 8 — Add the re-entry round-increment test (FAILS until Task 2).** Add `it("re-entry re-opens the same panel with an incremented round and re-dispatches the full panel", …)`: a call-count mock — first 3 `runAgent` calls REJECT (round 1), calls 4-6 APPROVE (round 2):
  ```ts
  let n = 0;
  vi.mocked(runAgent).mockImplementation(async () => (++n <= 3 ? criticResult("REJECT") : criticResult("APPROVE")));
  await draftClarificationContract(cwd, runId, ctx);       // non-trivial
  await goal.handler("", ctx);                             // round 1 → REJECT
  await goal.handler("", ctx);                             // round 2 → APPROVE → activate
  const state = await loadGoalState(runId, defaultGoalStateRoot(cwd));
  const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
  expect(panel.round).toBe(2);
  expect(runAgent).toHaveBeenCalledTimes(6);               // full panel re-dispatched
  expect(state.status).toBe("active");
  expect(state.goals[0].gates?.panel).toBe(true);
  ```
  **FAILS at baseline.**
- [ ] **Step 9 — Add the 4th-round escalation test (FAILS until Task 2).** Add `it("escalates without activating after the 3-round panel cap", …)`: `vi.mocked(runAgent).mockResolvedValue(criticResult("REJECT"))`; non-trivial draft; call `await goal.handler("", ctx)` FOUR times. Assert:
  ```ts
  expect(runAgent).toHaveBeenCalledTimes(9);               // 3 rounds × 3 critics; the 4th attempt does NOT dispatch
  expect(state.goals).toHaveLength(0);                     // never activated
  expect(ctx.ui.confirm).not.toHaveBeenCalled();
  expect(mockPi.sendUserMessage).toHaveBeenCalledWith(
    expect.stringContaining("did not converge after 3 rounds"),
    expect.anything(),
  );
  const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
  expect(panel.round).toBe(3);                             // capped at 3
  ```
  **FAILS at baseline.**
- [ ] **Step 10 — Update the ":170"/":194" trivial tests with a panel-skip assertion (PASSES at baseline — characterization).** The existing `it("confirms every drafted contract and activates nothing on decline", …)` (:170) and `it("refuses to autostart when the session is non-interactive (fail-closed)", …)` (:194) both draft with `suggestedSubgoals = []` ⇒ trivial. Add to each `expect(runAgent).not.toHaveBeenCalled();` (the trivial escape skips the panel). These PASS at baseline already (baseline calls no `runAgent` on the autostart path), so they are characterization, not failing signal — but they belong here because they pin the trivial-escape contract. Keep all existing assertions intact.
- [ ] **Step 11 — Add the extension registration pin (FAILS until Task 1).** In `tests/extension.test.ts`, inside `describe("/clarify Command")` or a new adjacent `describe("contract critic panel roster")`, add a source-level pin mirroring the existing readFile pattern (extension.test.ts:882-894):
  ```ts
  it("wires the panel roster to exactly the three M3 contract critics (source-level pin)", async () => {
    const { readFile } = await import("fs/promises");
    const src = await readFile(new URL("../index.ts", import.meta.url), "utf-8");
    expect(src).toContain('["reviewer-feasibility", "reviewer-architecture", "reviewer-risk"]');
    expect(src).toContain("goal-contract-panel");
  });
  ```
  **FAILS at baseline** (index.ts has no `CONTRACT_CRITICS` roster literal yet).
- [ ] **Step 12 — Run and record.** Run `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts tests/extension.test.ts`. **Expected:** Steps 3-9 (panel behavior) and Step 11 (registration pin) FAIL for the stated reasons; Step 10 characterization guards PASS; NO previously-green assertion outside the two rewritten tests fails. If a pre-existing pin fails, you disturbed a pinned substring or the mock harness change is wrong — fix before proceeding.

**Acceptance:** the newly added/rewritten panel + registration assertions fail for the stated reasons; the trivial-skip characterization guards pass; every other previously-green assertion in both files still passes.

---

## Task 1 — Panel helpers + predicate + imports

**Dependencies:** Task 0
**Files:** Modify `index.ts`

Add the pure helpers and the dispatch orchestrator. `autoStartGoalRuntime` is NOT rewired yet (Task 2) — after this task the panel code exists but is unreferenced from the autostart path, so only the Step-11 registration pin flips green; behavior is unchanged.

- [ ] **Step 1 — Imports.** Add `parsePanelVerdictOutput` to the `./verdict-format.js` import (create the import if none exists) and `isPanelApproved` to the existing `./goal-state.js` import (index.ts:62). Build-check will confirm the paths.
- [ ] **Step 2 — Constants + predicate.** Immediately after `isHighRiskGoalContract` (index.ts:1710) add:
  ```ts
  const CONTRACT_CRITICS = ["reviewer-feasibility", "reviewer-architecture", "reviewer-risk"] as const;
  const CONTRACT_PANEL_ID = "goal-contract-panel";
  const isTrivialGoalContract = (contract: ClarificationGoalContract): boolean =>
    contract.suggestedSubgoals.length <= 1 && contract.successCriteria.length <= 2 && !isHighRiskGoalContract(contract);
  ```
- [ ] **Step 3 — Task serializer.** Add `buildContractCriticTask(contract: ClarificationGoalContract): string` that serializes every contract field verbatim (objective / scope / nonGoals / successCriteria / constraints / evidenceRequired / risks / suggestedSubgoals) into a labelled block, then instructs the critic to run its fixed checklist and return the CHECKS / VERDICT / FINDINGS format (the critic `.md` systemPrompt already prescribes the checklist and grammar — the task supplies the CONTRACT as the artifact to attack). Do not embed the grammar rules (they live in the agent body); just supply the fields + a one-line reminder to emit the panel format.
- [ ] **Step 4 — Dispatch orchestrator.** Add `dispatchContractPanel(ctx, contract)` returning `Promise<{ member: string; verdict: "APPROVE" | "REJECT"; findings?: string }[]>`. It:
  - discovers agents once: `const agents = await discoverAgents(ctx?.cwd || process.cwd(), "user", BUNDLED_AGENTS_DIR);`
  - builds one task via `buildContractCriticTask(contract)` (shared across critics),
  - runs `await mapWithConcurrencyLimit([...CONTRACT_CRITICS], MAX_CONCURRENCY, async (name) => { … })`, where each iteration calls `runAgent({ agent: agents.find(a => a.name === name), agentName: name, task, cwd: ctx?.cwd || process.cwd(), depthConfig, makeDetails: makeDetails("single"), contextMode: "fresh", sandbox: { enabled: true, workspaceRoot: ctx?.cwd || process.cwd(), networkMode: "on" as const, additionalWritableRoots: piWritableRoots, approvalMode: parsedApprovalMode.mode, requireApprovalForAllCommands: true } })` — the `runGoalVerifier` block verbatim,
  - extracts output `const output = isResultSuccess(result) ? getFinalOutput(result.messages) : (result.errorMessage || result.stderr || getFinalOutput(result.messages) || "critic process failed");`
  - parses `const parsed = parsePanelVerdictOutput(output);` — if `parsed === null`, return `{ member: name, verdict: "REJECT", findings: "malformed critic output (no parseable VERDICT line) — treated as REJECT" }`; else return `{ member: name, verdict: parsed.verdict, findings: parsed.findings.filter(f => f.level === "REJECT-level").map(f => f.text).join("; ") || undefined }`.
  - Wrap each iteration's `runAgent` in try/catch so a thrown dispatch error becomes a REJECT with the error message as findings (mirror `runGoalVerifier`'s catch).
- [ ] **Step 5 — Verify.** Run `cd extensions/agentic-harness && npm run build` (typecheck) and `npm test -- tests/extension.test.ts`. **Expected:** build clean; the Step-11 registration pin now PASSES; goal-workflow panel tests still FAIL (autostart not yet rewired — Task 2).

**Acceptance:** `npm run build` clean; the extension registration pin is green; `isHighRiskGoalContract` still defined and now CONSUMED by `isTrivialGoalContract`; the helpers are present but the goal-workflow panel tests remain red.

---

## Task 2 — Rewrite `autoStartGoalRuntime`: trivial fork + panel-first orchestration

**Dependencies:** Task 1
**Files:** Modify `index.ts`

Anchor on `autoStartGoalRuntime` (index.ts:1758). Rework ONLY the `if (!goal) { … }` no-existing-goal branch (index.ts:1764-1815) and the confirm placement. Everything above (`clear_continuation`, `activeOrRunnableGoal`) and the shared tail (`if (goal.status === "queued") { … activate_goal … }`, `currentPhase = "goal_active"`, `buildGoalAutoPrompt`) stays for the trivial + reuse paths.

- [ ] **Step 1 — Load the contract (unchanged).** Keep the existing contract-load block (index.ts:1765-1776) verbatim, including the `if (!contract) { … clarify … return state; }` early return.
- [ ] **Step 2 — Remove the M4a pre-`create_goal` confirm block.** Delete the current universal confirm + fail-closed lines (index.ts:1778-1784). They are re-expressed per-fork below.
- [ ] **Step 3 — Fork on triviality.** Replace the `existing = findGoalForContract(...)` / `create_goal` block (index.ts:1786-1814) with:
  ```ts
  if (isTrivialGoalContract(contract)) {
    // TRIVIAL escape (decision #9): skip the panel; confirm (universal, fail-closed) then plain activation, ungated.
    if (!ctx?.ui?.confirm || (ctx as any).hasUI === false) {
      notifyGoal(ctx, "Goal Contract requires interactive confirmation before it can start. The drafted contract remains — run /goal in an interactive session to review and start it.", "error");
      return state;
    }
    if (!(await ctx.ui.confirm("Start Goal Contract?", `Review this Goal Contract and start the durable goal runtime now?\n\n${contract.objective}`))) return state;
    const existing = findGoalForContract(state, contract);
    if (existing) { goal = existing; }
    else {
      state = await applyGoalMutation(ctx, { type: "create_goal", goal: { id: nextGoalId(state), title: contract.objective, objective: contract.objective, successCriteria: contract.successCriteria, constraints: contract.constraints, evidenceRequired: contract.evidenceRequired } });
      goal = state.goals.at(-1)!;
      for (const title of contract.suggestedSubgoals) { state = await applyGoalMutation(ctx, { type: "create_subgoal", subgoal: { id: nextSubgoalId(state), goalId: goal.id, title, objective: title } }); }
      goal = state.goals.find((candidate) => candidate.id === goal!.id)!;
    }
    // falls through to the shared queued→activate_goal tail
  } else {
    return await runContractPanelActivation(ctx, state, contract);   // non-trivial: panel-first, returns fully
  }
  ```
  (Keep the `create_goal`/`create_subgoal` mapping byte-identical to M4a for the trivial branch — it is the transitional path preserved.)
- [ ] **Step 4 — Non-trivial orchestrator.** Add `runContractPanelActivation(ctx, state, contract): Promise<GoalState>` (a helper defined alongside `dispatchContractPanel`, or inline the body — helper is cleaner). It performs, in order:
  1. **Fail-closed up-front:** `if (!ctx?.ui?.confirm || (ctx as any).hasUI === false) { notifyGoal(ctx, <fail-closed literal>, "error"); return state; }`.
  2. **Round cap:** `const existingPanel = (state.panels ?? []).find(p => p.panelId === CONTRACT_PANEL_ID);` — `if (existingPanel && existingPanel.round >= 3) { currentPhase = "goal_drafting"; await sendGoalContinuationFollowUp(buildPanelEscalationFollowUp(existingPanel)); return state; }`.
  3. **Open panel:** `state = await applyGoalMutation(ctx, { type: "open_panel", panel: { panelId: CONTRACT_PANEL_ID, purpose: "Contract critic review (feasibility / architecture / risk)", expectedMembers: [...CONTRACT_CRITICS] } });`.
  4. **Dispatch:** `const verdicts = await dispatchContractPanel(ctx, contract);`.
  5. **Record each:** `for (const v of verdicts) { state = await applyGoalMutation(ctx, { type: "record_panel_verdict", panelId: CONTRACT_PANEL_ID, member: v.member, verdict: v.verdict, findings: v.findings }); }`.
  6. **Evaluate:** `const panel = state.panels.find(p => p.panelId === CONTRACT_PANEL_ID)!;` — `if (!isPanelApproved(panel)) { currentPhase = "goal_drafting"; await sendGoalContinuationFollowUp(buildPanelRejectFollowUp(verdicts)); return state; }`.
  7. **Converged → confirm ONCE:** `if (!(await ctx.ui.confirm("Start Goal Contract?", \`Review this Goal Contract and start the durable goal runtime now?\n\n${contract.objective}\`))) return state;`.
  8. **Create gated goal:** `create_goal` with `gates: { panel: true }` (+ subgoals) — same mapping as trivial but with the extra `gates` key; `goal = state.goals.find(...)!`.
  9. **Gated activation:** `state = await applyGoalMutation(ctx, { type: "activate_goal_gated", goalId: goal.id, panelId: CONTRACT_PANEL_ID });`.
  10. **Auto prompt:** `currentPhase = "goal_active"; await sendGoalContinuationFollowUp(buildGoalAutoPrompt(state)); return state;`.
- [ ] **Step 5 — Follow-up builders.** Add `buildPanelRejectFollowUp(verdicts)` (lead line = the REJECT literal, then a numbered list of `${member}: ${findings}` for every REJECT verdict, then a closing "Do not activate a goal until the panel approves the revised contract.") and `buildPanelEscalationFollowUp(panel)` (lead line = the escalation literal, then the latest recorded REJECT findings from `panel.verdicts`). Keep them near `buildGoalContractRequiredPrompt` (index.ts:1711).
- [ ] **Step 6 — Verify.** Run `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts`. **Expected:** Steps 3-9 from Task 0 (convergence / no-duplicate / dispatch / REJECT / malformed / re-entry / escalation) now PASS; the trivial tests (:170/:194 decline + fail-closed) still PASS; the complete-path verifier tests (`createReadyGoal`, `toHaveBeenCalledTimes(1)`) still PASS (trivial ⇒ verifier is the only `runAgent` caller). Then `npm run build` as a spot check.

**Acceptance:** all panel-behavior goal-workflow tests green; trivial + completion tests green; `activate_goal_gated` is the sole activation on the non-trivial path and `activate_goal` remains the trivial path; `npm run build` clean.

---

## Task 3 — Restart-resume + confirm-once characterization

**Dependencies:** Task 2
**Files:** Modify `tests/goal-workflow.test.ts`

These pin decision #8 (one-turn resume residual) and SC1's "confirm fires EXACTLY once". A killed-and-restored mid-panel session is exercised by driving a REJECT round, then a fresh `extension(mockPi)` instance (new module-scope state, simulating a process restart) over the SAME persisted `cwd`/`runId`, and asserting the next `/goal` turn re-opens the panel at round 2 and re-dispatches.

- [ ] **Step 1 — Restart-resume test.** Add `it("resumes a killed mid-panel session and re-dispatches on the next /goal turn", …)`:
  ```ts
  let n = 0;
  vi.mocked(runAgent).mockImplementation(async () => (++n <= 3 ? criticResult("REJECT") : criticResult("APPROVE")));
  const cwd = await mkdtemp(join(tmpdir(), "goal-panel-restart-"));
  try {
    const runId = "run-panel-restart";
    // First process: draft + one panel round (REJECT) → panel persisted at round 1, no active goal.
    { const { mockPi, commands } = createMockPi(); extension(mockPi);
      const ctx = mockGoalCtx(cwd, runId); await draftClarificationContract(cwd, runId, ctx);
      await commands.get("goal").handler("", ctx); }
    let mid = await loadGoalState(runId, defaultGoalStateRoot(cwd));
    expect(mid.panels.find((p) => p.panelId === "goal-contract-panel")!.round).toBe(1);
    expect(mid.status).not.toBe("active");
    // Second process (restart): fresh extension instance, same persisted cwd/runId.
    { const { mockPi, commands } = createMockPi(); extension(mockPi);
      const ctx = mockGoalCtx(cwd, runId);
      await commands.get("goal").handler("", ctx); }
    const after = await loadGoalState(runId, defaultGoalStateRoot(cwd));
    expect(after.panels.find((p) => p.panelId === "goal-contract-panel")!.round).toBe(2);   // re-opened round 2
    expect(runAgent).toHaveBeenCalledTimes(6);                                               // full panel re-dispatched
    expect(after.status).toBe("active");                                                     // converged + activated
    expect(after.goals[0].gates?.panel).toBe(true);
    // NOTE: do NOT assert continuation/consecutiveFailures state — M2 owns that (SC3).
  } finally { await rm(cwd, { recursive: true, force: true }); }
  ```
  This drops the redraft between rounds (the persisted CONSTANT panelId is what carries the round across the "restart"), which is exactly the resume mechanism the milestone specifies: the `/goal` auto path finds the drafted contract (persisted clarification state) and the persisted panel and continues. **Verify** that no source change is required beyond Task 2 — the resume works because `panelId` is a stable constant and `loadGoalState` reconstructs `panels[]` from the persisted snapshot/events. If it does not resume, STOP: the panelId is not stable (re-check Task 1 Step 2).
- [ ] **Step 2 — Confirm-once on convergence (guard).** In the Task 0 Step 8 re-entry test, add `expect(ctx.ui.confirm).toHaveBeenCalledTimes(1)` (the confirm fires only on the converging round-2 turn, never on the round-1 REJECT turn) — this pins "confirm fires EXACTLY once per run" across a multi-round run.
- [ ] **Step 3 — Verify.** Run `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts`. **Expected:** the restart-resume test and the confirm-once guard PASS; whole file green.

**Acceptance:** restart-resume green with round 2 re-dispatch and no `consecutiveFailures`/continuation assertions; confirm-once guard green; no source touched in this task.

---

## Task 4 — Trivial-path byte-identity + completion-gate characterization

**Dependencies:** Tasks 0-2
**Files:** Modify `tests/goal-workflow.test.ts`

Confirm the trivial escape preserves the M4a guarantees (byte-identity, ungated completion via the existing verifier gate) — SC1's "subgoals then complete via the existing verifier gate" and SC2's "trivial contract skips the panel but still confirms".

- [ ] **Step 1 — Trivial byte-identity guard.** The existing byte-identity test (goal-workflow.test.ts:475) uses the default 2-subgoal (non-trivial) contract — add `vi.mocked(runAgent).mockResolvedValue(criticResult("APPROVE"))` to it so the panel converges, and confirm the three hashed fields (`objective` / `successCriteria` / `evidenceRequired`) still equal the stored contract after gated creation. (`buildGoalObjectiveHash` hashes exactly those three, goal-state.ts:645; the panel path must not mutate them.)
- [ ] **Step 2 — Trivial completes via the verifier gate (explicit).** Add `it("a trivial contract activates ungated and completes via the existing verifier gate", …)`: `vi.mocked(runAgent).mockResolvedValue(verifierResult("Verdict: PASS\nSummary: done\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok"))`; `createReadyGoal(cwd, runId, ctx, goal)` (trivial, `[]` subgoals); assert the created goal has `gates?.panel` undefined and NO panel was opened (`state.panels.find(p => p.panelId === "goal-contract-panel")` is undefined); then `await goal.handler("complete goal-1", ctx)` and assert `state.goals[0].status === "completed"` with exactly one `runAgent` call (the verifier only). **Passes at authoring** (characterizes the trivial path).
- [ ] **Step 3 — Verify.** Run `cd extensions/agentic-harness && npm test -- tests/goal-workflow.test.ts`. **Expected:** both guards PASS; whole file green.

**Acceptance:** byte-identity holds across the gated path; trivial goals stay ungated and complete via the verifier gate; file green.

---

## Task 5 (Final) — Full verification gate + diff sanity

**Dependencies:** Tasks 0-4
**Files:** None (fix only failures this task surfaces)

- [ ] **Step 1 — Full gate.** Run `cd extensions/agentic-harness && npm test && npm run build`. **Expected:** entire suite green (Task 0 baseline count plus M4b's added tests) and typecheck clean. In particular `tests/verdict-format.test.ts` and `tests/agents.test.ts` stay green (parser + roster consumed, not modified).
- [ ] **Step 2 — Panel-wiring audit.** Run `grep -n "activate_goal_gated\|open_panel\|record_panel_verdict\|dispatchContractPanel\|CONTRACT_PANEL_ID\|isTrivialGoalContract\|gates: { panel: true }" index.ts`. **Expected:** `activate_goal_gated` and `gates: { panel: true }` appear ONLY on the non-trivial path; `isHighRiskGoalContract` is still defined (`grep -n "const isHighRiskGoalContract" index.ts` returns one match) and consumed by `isTrivialGoalContract`. Confirm plain `activate_goal` is still present for the trivial + manual paths.
- [ ] **Step 3 — Diff sanity (only M4b's files).** Run `git diff --stat`. **Expected:** the ONLY changed files under `extensions/agentic-harness/` are `index.ts`, `tests/goal-workflow.test.ts`, `tests/extension.test.ts` (plus this plan doc). Confirm `goal-state.ts`, `goal-events.ts`, `goal-storage.ts`, `verdict-format.ts`, every `agents/*.md`, every clarification module, `tests/skill-docs.test.ts`, `tests/agents.test.ts`, and `tests/verdict-format.test.ts` are NOT in the diff. Any other changed file is out of scope — revert it.

**Acceptance:** all five milestone Success Criteria satisfied; `npm test && npm run build` green; diff limited to `index.ts`, `tests/goal-workflow.test.ts`, `tests/extension.test.ts`.

---

## Rollback Plan

M4b touches one source file and two test files, adds no reducer command and no state field, and changes no persisted schema — the panel primitives (M1) and the parser/critics (M3) already exist; M4b only wires them. Blast radius is the `autoStartGoalRuntime` no-existing-goal branch.
1. If the full gate fails late and the cause is isolated to the panel orchestration, revert `autoStartGoalRuntime` to `HEAD` (restoring the M4a universal-confirm-then-`activate_goal` body) and drop the `CONTRACT_*` / `dispatchContractPanel` / `runContractPanelActivation` helpers; the trivial path collapses back to M4a exactly (both are the same code).
2. If the panel dispatch misbehaves (wrong verdict handling, hung subagents), the fastest safe patch is to make `isTrivialGoalContract` return `true` unconditionally — every contract then takes the M4a path (confirm + plain activation, no panel) with zero panel dispatch. This is a legitimate temporary de-risking that keeps the pipeline live while the panel is debugged (it reduces M4b to M4a behavior).
3. If a follow-up string disturbs a pinned substring, restore `index.ts` from `HEAD` and re-apply only the helper additions + the branch fork.
4. Because no reducer/state/storage module is edited, there is no persistence/replay/`schemaVersion` concern — a run created before M4b replays byte-identically; a run with a persisted panel replays through the M1 machinery already proven in that milestone.
5. Full abort: `git checkout -- extensions/agentic-harness/` restores everything. M4b is an abort-point milestone (full forge-equivalent front half with interactive execution); it can be dropped without affecting M1/M2/M3/M4a, though M5 depends on it.

## Self-Review

- **Spec coverage:** Maps 1:1 to the five milestone SCs. SC1 (parallel dispatch; `activate_goal_gated` only after 3 APPROVE + one post-convergence confirm; confirm exactly once on the converged text; subgoals via the existing verifier gate) → Task 0 Steps 3/5 author, Task 2 turns green, Task 3 Step 2 pins confirm-once, Task 4 Step 2 pins the verifier-gate completion. SC2 (REJECT follow-up; re-entry full-panel re-run with incremented round; 4th-round escalation; trivial skips-but-confirms) → Task 0 Steps 6-10, Task 2 Steps 4-5. SC3 (restart resume on the next goal turn; no `consecutiveFailures` assertion) → Task 3 Step 1. SC4 (verdict-format + extension green; registration pins updated) → Task 0 Step 11 / Task 1 Step 5, Task 5 Step 1. SC5 (full gate) → Task 5.
- **Failing-first discipline:** Task 0 authors the panel-behavior + registration assertions that FAIL at baseline; the characterization guards that pass at baseline (trivial-skip Step 10, restart-resume shape, trivial byte-identity/completion) are quarantined into Task 0 Step 10 / Tasks 3-4 so the Task 0 FAIL signal stays clean — the same structure M4a used.
- **The panelId catch is the riskiest decision and is defended explicitly:** the brief's "draftedAt or uuid" would break the round-persistence + cap-3 + resume because the model re-stamps `draftedAt` on every REJECT re-draft; a per-run constant `CONTRACT_PANEL_ID` is the only key stable across revisions and across restart, and it is testable without a live model (Task 0 Steps 8/9 and Task 3 drive multiple rounds by re-invoking `/goal` on the persisted panel). The single-contract-per-run assumption that makes the constant safe is decisions #2/#8, with the multi-contract-per-run residual documented.
- **Confirm ordering is honest:** the fail-closed *capability* check runs up-front on both forks (cheap, avoids a wasted panel dispatch), but the user-facing `ctx.ui.confirm()` fires exactly once, after `isPanelApproved`, on the converged contract — pinned by Task 3 Step 2. The M4a activate-on-approval assertions are rewritten (not merely extended) at Task 0 Steps 3-4, satisfying "rewrite the M4a transitional assertions accordingly."
- **Diff minimalism defended:** no reducer/parser/agent file is touched (all consumed dormant from M1/M3); `isHighRiskGoalContract` is kept and now consumed by `isTrivialGoalContract`; the trivial escape is the literal M4a code path, which is what keeps ~10 existing completion/decline/fail-closed tests green with a one-line panel-skip assertion; `activate_goal` survives for trivial + manual.
- **Known residual:** the REJECT/escalation follow-ups depend on the model re-drafting via `draft_goal_contract`; in a non-interactive host the up-front fail-closed guard refuses before any dispatch, and the drafted contract survives for a later interactive `/goal` (decision #8's one-turn resume residual). The post-confirm/pre-`activate_goal_gated` crash window re-confirms on restart (documented in the milestone Notes, tiny).
- **Risk:** High — the non-trivial `autoStartGoalRuntime` rewrite is the only substantial behavioral change, mitigated by (a) the trivial fork preserving M4a byte-for-byte, (b) the dispatch block being copied verbatim from the proven `runGoalVerifier`, and (c) the panel primitives being unit-proven in M1. The reducer surface is untouched, so replay/persistence risk is nil.
