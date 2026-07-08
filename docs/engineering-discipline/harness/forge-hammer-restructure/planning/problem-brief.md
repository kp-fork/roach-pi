# Problem Brief: roach-pi forge→hammer 자율 파이프라인 재구성

**Source Context Brief:** `docs/engineering-discipline/context/2026-07-08-forge-hammer-restructure-brief.md` (approved 2026-07-08)
**Repo:** `/Users/roach/.pi/agent/git/github.com/tmdgusya/roach-pi` (pi extension suite; all work in `extensions/agentic-harness/`)
**Reference model:** `/Users/roach/glm-hammer` (forge→hammer Claude Code plugin)

## Goal

Restructure roach-pi's clarify→goal workflow to glm-hammer's forge→hammer level of autonomy: the only user gate is Goal Contract approval; after that, critic panel → implementation (worker→validator per subgoal) → verifier → final security/qa panel cycle runs without user input, escalating only on a 3-consecutive-failure budget.

## Scope

**In:**
1. **Forge-style clarification**: rewrite `skills/agentic-clarification/SKILL.md` — recon subagent(s) first, then ONE bundled question round (max 4, only what recon can't answer), defensible defaults for the rest (marked as assumptions). Drop one-question-at-a-time; checklist items get agent-filled with assumption markers.
2. **Anvil critic panel on the Goal Contract**: 3 critics (feasibility/integration/coverage lenses, adapted to contract granularity) run in parallel; all must APPROVE before the goal runtime starts; agent revises contract and re-runs full panel on any REJECT; max 3 rounds then escalate to user.
3. **Auto-chain**: after user approves the contract, hammer starts without a manual `/goal` — wire the `draft_goal_contract` path to `autoStartGoalRuntime()` (preserving the high-risk `ctx.ui.confirm` gate, fail-closed in non-interactive mode).
4. **Agent roster port (glm-hammer style, binary checklists)**: contract critics ×3 + per-subgoal validator + security-reviewer + qa-reviewer. All verdicts mechanical: APPROVE/PASS iff every checklist item YES or N/A; "unchecked is NO". implementation-critic's fraud-hunting checks fold into qa-reviewer's checklist (user decision).
5. **Per-subgoal worker→validator loop (2-stage)**: worker implements subgoal; information-isolated validator (receives contract/subgoal fields verbatim, never worker output) judges; validator receipt is a reducer precondition for subgoal completion.
6. **Final security/qa panel**: at overall goal completion, security + qa reviewers run in parallel; any FAIL converts blocking findings into fix subgoals and recycles; both PASS required for goal completion.
7. **3-consecutive-failure budget**: wire the dead `continuation.consecutiveFailures` field — increment on FAIL receipts, reset on PASS, halt auto-continuation past 3 and escalate with blocker summary.
8. **Enforcement in the reducer**: all new gates are fail-closed state-transition preconditions (receipts required), following the existing `assertCompletionInvariant` pattern.

**Out:**
- Hook-based enforcement (plan seal, dispatch ledger, stop-gate) — pi has no Stop hook; reducer gates replace it
- crucible/design stage; per-task implementation-critic as separate stage (folded into qa); `/team` mode changes
- Renaming skills/commands — **keep clarify/goal names**, port semantics only

## Technical Context

roach-pi = pi extension suite (`pi-engineering-discipline-extension` v1.39.0). Everything relevant lives in `extensions/agentic-harness/`: skills (`skills/*/SKILL.md`, exposed via `resources_discover` hook), agent defs (`agents/*.md`), phase machine + commands + tools (`index.ts`, ~2400 lines), goal runtime (`goal-state.ts`, `goal-command.ts`, `goal-continuation.ts`, `goal-verifier.ts`, storage/events/service files).

**pi has NO turn-end blocking hook** (`agent_end`/`turn_end` are observe-only; `@mariozechner/pi-coding-agent` types.d.ts:485-502). Enforcement levers: `tool_call` (block), `tool_result` (rewrite), `input` (transform). The pi-native enforcement pattern — already proven by the existing verifier gate — is: command/runtime-triggered fail-closed reducer transition + re-injection via `pi.sendUserMessage(prompt, {deliverAs:"followUp"})`. System prompt stays static for prompt-cache stability (index.ts:1279-1290); phase guidance is delivered via follow-up messages.

## Exploration Digest

### Lens R — Reducer & state contracts (goal-state.ts, clarification-state.ts, index.ts wiring)

- **Action union**: `GoalCommand` has 14 variants in a single pure switch (`applyGoalCommand`, goal-state.ts:176-441). Ledger event union is SEPARATE (`GoalLedgerEntry.type`, :83-97, 15 literals); any new command needing audit needs a new ledger type because invariants read the ledger by type.
- **Completion invariant** (`assertCompletionInvariant`, goal-state.ts:541-578) — the template for new gates: latest receipt (`receipts.at(-1)`) must be PASS, target type/id match, `objectiveHash` (SHA-256 over objective+successCriteria+evidenceRequired+evidence, :520-539) must match current state, matching `verifier_pass` ledger entry by receiptId, no evidence/subgoal/completion mutation with higher ledger seq.
- **Per-subgoal receipts ALREADY EXIST**: `SubgoalItem.verifierReceipts[]` (goal-state.ts:51-64), routed by `getTarget` (:302-324). Worker→validator receipts = thin extension: widen `verifierAgent` (hard-typed literal `"reviewer-verifier"`, goal-state.ts:73 / goal-verifier.ts:3) or add parallel `validatorReceipts[]` + `record_validator_receipt`.
- **Critic-panel aggregation is NET-NEW**: no all-of-N concept anywhere; invariant only inspects `.at(-1)`. Needs new state field (e.g. `criticVerdicts`), new command + ledger type, and an all-approve invariant checked before `activate_goal` (autostart) and the final `complete_target`.
- **3-failure budget pre-wired but DEAD**: `continuation.consecutiveFailures: Record<string,number>` (goal-state.ts:10-19) is declared, never incremented, never read. Also `SubgoalItem.attempts` (:59) already counts per-subgoal attempts. `planGoalContinuation` (goal-continuation.ts:21-54) has no failure-count awareness — the halt belongs there.
- **Auto-chain seam**: `autoStartGoalRuntime` (index.ts:1757-1829) reads `loadClarificationState(...).goalContract`, gates high-risk contracts behind `ctx.ui.confirm` (:1777-1784 — THE precedent for a pre-start gate; critic panel slots right there), materializes goal + suggestedSubgoals, activates, sends `buildGoalAutoPrompt`. Currently invoked only from the `/goal` `auto` command kind (:1941). `draft_goal_contract` handler at index.ts:558-561 flips phase to `goal_drafting` and stops — bridging means wiring that handler to the autostart path.
- **Clarification reducer**: 9-item required checklist (`REQUIRED_CLARIFICATION_CHECKLIST`, clarification-state.ts:3-13), `canDraftGoalContract` = zero open issues (:158-160), `draft_goal_contract` throws `ClarificationGateError` unless gate passes, stores `ClarificationGoalContract` (:68-79: objective/scope/nonGoals/successCriteria/constraints/evidenceRequired/risks/suggestedSubgoals/handoffCommand/draftedAt). `clarification_state` tool has 8 actions (index.ts:470-568), each 1:1 with a reducer command.
- **Persistence/replay backward-compat (CRITICAL)**: snapshot `schemaVersion: 1` is a hard equality gate AND a literal type — no migration path exists (goal-storage.ts:49-64, clarification-storage.ts:49-61). Adding OPTIONAL state fields is safe without a bump (normalization never checks full shape; guard new arrays with `?? []`). **Every new command needs an allowlist clause in `isGoalCommand` (goal-events.ts:49-100) / clarification-events.ts validator, or replay silently drops it** ("Ignored invalid goal-state-event"). Replay is best-effort: commands that throw are caught+skipped — new invariants that throw could silently drop replayed history.
- **Verifier flow** (the 4-command sequence to extend): `/goal complete` case (index.ts:2005-2035): `request_completion` → `runGoalVerifier` (:1872-1917) → `record_verifier_result` → on PASS `complete_target` → `maybeQueueGoalContinuation`.

### Lens V — Verification landscape

- Real suite is INSIDE the extension: `cd extensions/agentic-harness && npm test` (vitest run, 71 test files, no vitest.config) and `npm run build` (= `tsc --noEmit` typecheck). CI (`.github/workflows/release.yml`) enforces exactly these on push to main (no PR trigger). Scoped runs pass through: `npm test -- tests/goal-workflow.test.ts`.
- **Pinning tests per planned surface**:
  - `tests/skill-docs.test.ts` — asserts EXACT substrings of both SKILL.md files (`/goal status`, `Goal Contract`, `Gate: PASS`, `verifier subagent returns PASS`…) + negative list of legacy skill names + skill-dir discovery. **Any SKILL.md rewrite must update this in the same change.**
  - `tests/agents.test.ts` — frontmatter parser units + pins bundled roster: must contain `reviewer-feasibility/architecture/risk`, must NOT contain `synthesis`/`reviewer-dependency`/`reviewer-user-value`. Adding agents is safe; renaming/removing pinned ones breaks it.
  - `tests/goal-state.test.ts` — reducer semantics incl. PASS/FAIL/stale-receipt completion gate. New actions = additive/safe; changing existing semantics breaks.
  - `tests/goal-command.test.ts` — `/goal` grammar (incl. Korean free-text triage) + help text.
  - `tests/goal-workflow.test.ts` (452 lines) — **already pins the clarify→goal auto-chain surface**: `/clarify` handoff prompt content, "auto-creates and activates latest drafted Goal Contract with `/goal`", no-duplicate, high-risk confirm, verifier PASS/FAIL/malformed/process-error paths.
  - `tests/extension.test.ts` (1436 lines) — registration contract (tools/commands/handlers per context), `/clarify` delegation prompt substrings, phase auto-reset, system-prompt suffix invariants.
  - `tests/clarification-state.test.ts` + `clarification-events.test.ts` — checklist gate + replay.
- Test style: `createMockPi()` (Maps for tools/commands/events, vi.fn sendUserMessage); highest-fidelity tests drive real extension + real reducers + real temp-dir storage, mocking only `subagent.runAgent` and pi transport. One env-gated real-process e2e (`team-e2e-tmux.test.ts`).

### Lens G — glm-hammer port payload (source: `skills/{forge,hammer}/SKILL.md`, `agents/*.md`)

- **Universal verdict rule**: mechanical, not holistic — APPROVE/PASS iff every check YES or N/A; "If you did not verify a check, the answer is NO." Receipt format: `CHECKS:` block (every item, `<ID>: YES|NO|N/A — <one-line evidence>`) → `VERDICT:` line → `FINDINGS:` (`[REJECT-level]`/`[blocking]` with concrete evidence + `[advisory]`). Judges end with `EVIDENCE_RECORDED: <path>`. Orchestrator confirms on-disk verdict matches reported verdict before advancing state.
- **Forge question round (verbatim)**: "Bundle the survivors (max 4, independent only) into ONE AskUserQuestion round, each grounded in findings… If nothing survives, ask nothing and proceed. Prefer proposing a defensible default over asking."
- **Anvil loop**: 3 critics in parallel; each receives ONLY plan path + original user request verbatim + its evidence output path ("Not your reasoning, not recon summaries — critics re-verify against the codebase themselves"). Any REJECT → revise addressing every finding (disagreements answered in a `## Critic Responses` section, not ignored), re-dispatch FULL panel, round++. Round > 3 → present deadlock to user.
- **Checklists available verbatim** (adapt from plan-granularity to contract-granularity where needed): feasibility-critic C1–C6 (files/symbols/commands exist, no invented decisions, verification proves goal); integration-critic C1–C6 (parallel-task file disjointness, dependency edges, acyclicity, contract matches, call-site coverage, shared-state ordering); coverage-critic C1–C6 (request→task mapping, no placeholders, goals+criteria present, zero-interpretation decidability, verification strategy declared+run, verification exercises success criteria); security-reviewer C1–C7 (injection, authN/Z parity, secrets, data exposure, safe parsing, input bounds, crypto/deps — scoped to changed code only); qa-reviewer C1–C6 (verification command passes when YOU run it, full suite zero regressions, criteria observably met, edge cases sane, callers unbroken, tests unweakened); implementation-critic C1–C6 (genuine bodies, no criteria-shaped hardcoding, tests can fail, no swallowed failures, reachable code, files-list confinement — **folds into qa-reviewer per user decision**).
- **Validator is an inline verbatim prompt template, not an agent file**: "You are an independent validator with no knowledge of how this task was implemented… Treat each criterion as an ISOLATED yes/no question… Verdict = AND of all criteria. No partial credit." Receives Goal/Criteria/Files/Commands **verbatim from the plan — never paraphrase, never mention what the worker did.**
- **FAIL triage**: worker defect (plan right, code wrong) → re-dispatch worker with ALL accumulated verdict feedback verbatim; plan defect (code cannot meet plan as written) → amend the plan (affected tasks only, within Goal; append to Amendment Log; criteria corrected only if factually stale and only to verify the SAME outcome) → fresh worker. 3 strikes (retries + amendments combined) per task → escalate with full history.
- **Review panel recycling**: any FAIL → convert each blocking finding into a fix task with binary criteria, run the full task cycle, then re-run E2E gate AND FULL review panel. Advisory findings reported, not looped. Same finding failing 3× → escalate.

### Lens S — Subagent infrastructure & agent conventions

- **Agent frontmatter** (agents.ts:8-23, hand-rolled line parser — no nested YAML): `name`+`description` required (missing → file silently skipped), plus `tools`, `model`, `maxOutput`, `maxSubagentDepth`, `output`, `defaultReads`, `defaultProgress`, `context: fresh|fork`, `worktree`. Body after frontmatter = systemPrompt. Discovery: bundled (`agents/`) < user (`~/.pi/agent/agents/`) < project (`.pi/agents/`), name-keyed.
- **Current roster**: explorer, planner, worker (full tools), plan-worker, plan-validator, plan-compliance, reviewer-{feasibility,architecture,risk,verifier}. reviewer-feasibility/architecture/risk are **holistic/prose with graded scales** (no pass/fail) — need reframing to binary. plan-validator + reviewer-verifier already have the binary spine (`Verdict: PASS|FAIL` strict format, machine-parsed by goal-verifier.ts:75-86 `parseGoalVerifierOutput`).
- **Programmatic dispatch is proven**: `runGoalVerifier` (index.ts:1872-1917) calls `runAgent` directly from runtime TS (no model tool-call), fresh context, sandboxed, output strictly parsed → `GoalVerifierReceipt` via reducer. **This is the reference implementation for the worker→validator loop and both panels.** Parallel dispatch exists: subagent tool parallel mode, max 12 tasks, concurrency 10 (`mapWithConcurrencyLimit`), also callable programmatically.
- **Prompt augmentation precedent**: `discipline.ts` decorates worker/plan-worker systemPrompts with KARPATHY_RULES at dispatch time (runtime decorator, not in the .md).
- **Receipt persistence (two layers)**: structured `GoalVerifierReceipt` in state + ledger via reducer (goal-state.ts:66-82); per-run artifacts under `<cwd>/.pi/agent/runs/<rootRunId>/subagents/<agentName>-<runId>/` (run.json, output/progress files, worktree diff). Adapt glm-hammer's `.glm-hammer/evidence/` convention onto these two layers rather than inventing a third.
- **Skill→subagent reference style**: clarification SKILL.md instructs conditional single-mode explorer dispatch; goal SKILL.md references the verifier as a runtime-provided GATE, not a model tool-call.

## Constraints

- Session-state snapshot/replay backward compat: new state fields optional (no schemaVersion bump — no migration path exists); every new command gets an events-validator allowlist clause.
- Pinning tests must be updated in the same milestone as the surface they pin (see Lens V list). CI = `npm test && npm run build` in `extensions/agentic-harness/`.
- Subagent limits: max 12 parallel / 10 concurrent; each is a separate pi process. Panel rounds capped at 3.
- Non-interactive mode: high-risk contract confirm must fail closed (refuse to autostart).
- Prompt-cache stability: no per-phase system-prompt mutation; guidance via follow-up messages only.
- Keep clarify/goal naming everywhere (commands, skills, docs).

## Success Criteria

1. End-to-end flow works with exactly one user gate: vague request → recon → bundled question round (≤4) → contract draft → critic panel all-APPROVE (≤3 rounds) → user approves contract → goal runtime auto-starts → per-subgoal worker→validator cycles → verifier PASS → security/qa panel PASS → goal completed — no user input after contract approval.
2. Reducer rejects (fail-closed, tested): subgoal completion without a validator PASS receipt; goal activation via autostart without 3 critic APPROVE verdicts; final completion without security PASS + qa PASS receipts.
3. Auto-continuation halts after 3 consecutive FAIL receipts on the same target and escalates with a blocker summary (tested).
4. `cd extensions/agentic-harness && npm test && npm run build` passes with all pinning tests updated.

## Verification Strategy

- **Level:** test-suite (integration-depth: real extension + real reducers + real temp-dir persistence against mocked pi; `subagent.runAgent` mocked)
- **Command:** `cd extensions/agentic-harness && npm test && npm run build`
- **What it validates:** reducer gate semantics, command flows, clarify→goal auto-chain, skill-doc content, agent roster, registration surface, persistence/replay round-trips — the same gate CI enforces on merge.
