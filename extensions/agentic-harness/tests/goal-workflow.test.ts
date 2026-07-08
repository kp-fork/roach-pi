import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createBashTool: vi.fn(() => ({
    name: "bash",
    label: "bash",
    description: "mock bash",
    parameters: {},
    execute: vi.fn(),
  })),
  isToolCallEventType: (toolName: string, event: any) => event?.toolName === toolName,
  keyHint: (k: string, d?: string) => `${k}${d ? ` ${d}` : ""}`,
  keyText: (t: string) => t,
  rawKeyHint: (k: string, d?: string) => `${k}${d ? ` ${d}` : ""}`,
  convertToLlm: vi.fn((x: unknown) => x),
}));

vi.mock("@mariozechner/pi-tui", () => ({
  Text: class MockText {},
  truncateToWidth: (text: string, width?: number) => typeof width === "number" ? text.slice(0, width) : text,
  visibleWidth: (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").length,
}));

vi.mock("@mariozechner/pi-ai", () => ({
  complete: vi.fn(),
}));

vi.mock("../subagent.js", async () => {
  const actual = await vi.importActual<typeof import("../subagent.js")>("../subagent.js");
  return {
    ...actual,
    runAgent: vi.fn(),
  };
});

vi.mock("../ui-settings.js", () => ({
  resolveAgenticUiSettings: vi.fn(() => ({ footerPreset: "compact", footerGlyphs: "plain" })),
}));

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../index.js";
import { loadGoalState } from "../goal-state-service.js";
import { isPanelApproved } from "../goal-state.js";
import { defaultGoalStateRoot } from "../goal-storage.js";
import { applyAndPersistClarificationCommand, loadClarificationState } from "../clarification-state-service.js";
import { defaultClarificationStateRoot } from "../clarification-storage.js";
import { runAgent } from "../subagent.js";

function createMockPi() {
  const commands = new Map<string, any>();
  const events = new Map<string, any[]>();
  const tools = new Map<string, any>();

  const mockPi: any = {
    registerTool: (def: any) => {
      tools.set(def.name, def);
    },
    registerCommand: (name: string, def: any) => {
      commands.set(name, def);
    },
    on: (event: string, handler: any) => {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(handler);
    },
    sendUserMessage: vi.fn(),
  };

  return { mockPi, commands, events, tools };
}

beforeEach(() => {
  delete process.env.PI_SUBAGENT_DEPTH;
  delete process.env.PI_TEAM_WORKER;
  process.env.PI_ENABLE_TEAM_MODE = "1";
  vi.mocked(runAgent).mockReset();
});

describe("clarify to goal workflow", () => {
  it("delegates /clarify to a gated Goal Contract handoff", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "clarify-workflow-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);

      const clarify = commands.get("clarify");
      const mockCtx: any = {
        cwd,
        runId: "clarify-workflow",
        sessionManager: { appendCustomEntry: vi.fn() },
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
          setStatus: vi.fn(),
        },
      };

      await clarify.handler("rewrite workflow", mockCtx);

      expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
      const prompt = mockPi.sendUserMessage.mock.calls[0][0];
      expect(prompt).toContain("Goal Contract");
      expect(prompt).not.toContain("an exact /goal handoff and stop");
      expect(prompt).toContain("the runtime queues an automatic /goal start for your review");
      expect(prompt).toContain("clarification_state");
      expect(prompt).toContain("only when the request is clearly implementation/codebase-impacting or technical context is missing/uncertain");
      expect(prompt).toContain("skip explorer for non-code/product/wording clarification");
      expect(prompt).not.toContain("investigate relevant parts of the codebase in parallel");
      expect(prompt).toContain("Gate: PASS");
      expect(prompt).not.toContain(["agentic", "pl", "an", "crafting"].join("-"));
      expect(prompt).not.toContain(["agentic", "milestone", "planning"].join("-"));
      expect(prompt).not.toContain(["/", "pl", "an"].join(""));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("auto-creates and activates latest drafted Goal Contract with /goal", async () => {
    vi.mocked(runAgent).mockResolvedValue(criticResult("APPROVE"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-auto-contract-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-auto");
      await draftClarificationContract(cwd, "run-auto", ctx);

      await goal.handler("", ctx);

      const state = await loadGoalState("run-auto", defaultGoalStateRoot(cwd));
      expect(state.status).toBe("active");
      expect(state.activeGoalId).toBe("goal-1");
      expect(state.goals[0]).toMatchObject({
        objective: "Ship automatic goal runtime",
        successCriteria: ["/goal starts automatically"],
        evidenceRequired: ["goal workflow tests pass"],
      });
      expect(state.goals[0].subgoals).toHaveLength(2);
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
      const autoPrompt = mockPi.sendUserMessage.mock.calls[0][0];
      expect(autoPrompt).toContain("The runtime is implementing subgoals");
      expect(autoPrompt).not.toContain("Implement the current active subgoal");
      expect(state.goals[0].gates?.validator).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not duplicate a goal when /goal is repeated for the same contract", async () => {
    vi.mocked(runAgent).mockImplementation(async (o: any) =>
      o.agentName === "reviewer-feasibility" || o.agentName === "reviewer-architecture" || o.agentName === "reviewer-risk"
        ? criticResult("APPROVE")
        : o.agentName === "plan-validator"
          ? verifierResult("Verdict: PASS\nSummary: ok\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok")
          : verifierResult("worker done"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-auto-idempotent-"));
    try {
      const { mockPi, commands: commandMap } = createMockPi();
      extension(mockPi);
      const goal = commandMap.get("goal");
      const ctx = mockGoalCtx(cwd, "run-idempotent");
      await draftClarificationContract(cwd, "run-idempotent", ctx);

      await goal.handler("", ctx);
      await goal.handler("", ctx);

      const state = await loadGoalState("run-idempotent", defaultGoalStateRoot(cwd));
      expect(state.goals).toHaveLength(1);
      expect(state.goals[0].status).toBe("active");
      // the panel dispatched once (first turn converged + activated); the second /goal
      // found the active flagged goal and ran one worker→validator cycle instead of a panel
      expect(runAgent).toHaveBeenCalledTimes(5);
      const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
      expect(panel.round).toBe(1);
      // the cycle completed subgoal-1 and advanced to subgoal-2; the goal was not duplicated
      expect(state.goals[0].subgoals.find((s) => s.id === "subgoal-1")?.status).toBe("completed");
      expect(state.goals[0].activeSubgoalId).toBe("subgoal-2");
      expect(state.goals[0].subgoals.find((s) => s.id === "subgoal-2")?.status).toBe("active");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("dispatches the full 3-critic panel and activates only via activate_goal_gated after convergence", async () => {
    vi.mocked(runAgent).mockResolvedValue(criticResult("APPROVE"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-panel-converge-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-panel-converge");
      await draftClarificationContract(cwd, "run-panel-converge", ctx);

      await goal.handler("", ctx);

      const state = await loadGoalState("run-panel-converge", defaultGoalStateRoot(cwd));
      expect(runAgent).toHaveBeenCalledTimes(3);
      const dispatched = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName).sort();
      expect(dispatched).toEqual(["reviewer-architecture", "reviewer-feasibility", "reviewer-risk"]);
      expect(state.status).toBe("active");
      expect(state.goals[0].gates?.panel).toBe(true);
      const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
      expect(panel.verdicts.filter((v) => v.verdict === "APPROVE")).toHaveLength(3);
      expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
      expect(ctx.ui.confirm).toHaveBeenCalledWith(
        "Start Goal Contract?",
        expect.stringContaining("Ship automatic goal runtime"),
      );
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("The runtime is implementing subgoals"),
        { deliverAs: "followUp" },
      );
      expect(state.goals[0].gates?.validator).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("records REJECT verdicts and sends a findings follow-up without confirming or activating", async () => {
    vi.mocked(runAgent).mockImplementation(async (opts: any) =>
      opts.agentName === "reviewer-risk"
        ? criticResult("REJECT", "success criteria do not prove the objective")
        : criticResult("APPROVE"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-panel-reject-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-panel-reject");
      await draftClarificationContract(cwd, "run-panel-reject", ctx);

      await goal.handler("", ctx);

      const state = await loadGoalState("run-panel-reject", defaultGoalStateRoot(cwd));
      expect(state.goals).toHaveLength(0);                    // no activation
      expect(ctx.ui.confirm).not.toHaveBeenCalled();          // no confirm on REJECT
      const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
      expect(panel.round).toBe(1);
      expect(panel.verdicts.some((v) => v.verdict === "REJECT")).toBe(true);
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("Revise the Goal Contract to address these blocking findings"),
        expect.anything(),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("treats malformed critic output as REJECT", async () => {
    vi.mocked(runAgent).mockImplementation(async (opts: any) =>
      opts.agentName === "reviewer-architecture"
        ? verifierResult("Summary: I have no clear opinion")
        : criticResult("APPROVE"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-panel-malformed-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-panel-malformed");
      await draftClarificationContract(cwd, "run-panel-malformed", ctx);

      await goal.handler("", ctx);

      const state = await loadGoalState("run-panel-malformed", defaultGoalStateRoot(cwd));
      expect(state.goals).toHaveLength(0);
      const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
      const offender = panel.verdicts.find((v) => v.member === "reviewer-architecture")!;
      expect(offender.verdict).toBe("REJECT");
      expect(offender.findings).toContain("malformed critic output");
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("Revise the Goal Contract to address these blocking findings"),
        expect.anything(),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("re-entry re-opens the same panel with an incremented round and re-dispatches the full panel", async () => {
    let n = 0;
    vi.mocked(runAgent).mockImplementation(async () => (++n <= 3 ? criticResult("REJECT") : criticResult("APPROVE")));
    const cwd = await mkdtemp(join(tmpdir(), "goal-panel-reentry-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-panel-reentry");
      await draftClarificationContract(cwd, "run-panel-reentry", ctx);

      await goal.handler("", ctx);                             // round 1 → REJECT
      await goal.handler("", ctx);                             // round 2 → APPROVE → activate

      const state = await loadGoalState("run-panel-reentry", defaultGoalStateRoot(cwd));
      const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
      expect(panel.round).toBe(2);
      expect(runAgent).toHaveBeenCalledTimes(6);               // full panel re-dispatched
      expect(state.status).toBe("active");
      expect(state.goals[0].gates?.panel).toBe(true);
      // confirm fires EXACTLY once per run: only on the converging round-2 turn, never on the round-1 REJECT turn
      expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("resumes a killed mid-panel session and re-dispatches on the next /goal turn", async () => {
    let n = 0;
    vi.mocked(runAgent).mockImplementation(async () => (++n <= 3 ? criticResult("REJECT") : criticResult("APPROVE")));
    const cwd = await mkdtemp(join(tmpdir(), "goal-panel-restart-"));
    try {
      const runId = "run-panel-restart";
      // First process: draft + one panel round (REJECT) → panel persisted at round 1, no active goal.
      {
        const { mockPi, commands } = createMockPi();
        extension(mockPi);
        const ctx = mockGoalCtx(cwd, runId);
        await draftClarificationContract(cwd, runId, ctx);
        await commands.get("goal").handler("", ctx);
      }
      const mid = await loadGoalState(runId, defaultGoalStateRoot(cwd));
      expect(mid.panels.find((p) => p.panelId === "goal-contract-panel")!.round).toBe(1);
      expect(mid.status).not.toBe("active");
      // Second process (restart): fresh extension instance, same persisted cwd/runId.
      {
        const { mockPi, commands } = createMockPi();
        extension(mockPi);
        const ctx = mockGoalCtx(cwd, runId);
        await commands.get("goal").handler("", ctx);
      }
      const after = await loadGoalState(runId, defaultGoalStateRoot(cwd));
      expect(after.panels.find((p) => p.panelId === "goal-contract-panel")!.round).toBe(2);   // re-opened round 2
      expect(runAgent).toHaveBeenCalledTimes(6);                                               // full panel re-dispatched
      expect(after.status).toBe("active");                                                     // converged + activated
      expect(after.goals[0].gates?.panel).toBe(true);
      // NOTE: do NOT assert continuation/consecutiveFailures state — M2 owns that (SC3).
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("escalates without activating after the 3-round panel cap", async () => {
    vi.mocked(runAgent).mockResolvedValue(criticResult("REJECT"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-panel-escalate-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-panel-escalate");
      await draftClarificationContract(cwd, "run-panel-escalate", ctx);

      await goal.handler("", ctx);
      await goal.handler("", ctx);
      await goal.handler("", ctx);
      await goal.handler("", ctx);

      const state = await loadGoalState("run-panel-escalate", defaultGoalStateRoot(cwd));
      expect(runAgent).toHaveBeenCalledTimes(9);               // 3 rounds × 3 critics; the 4th attempt does NOT dispatch
      expect(state.goals).toHaveLength(0);                     // never activated
      expect(ctx.ui.confirm).not.toHaveBeenCalled();
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("did not converge after 3 rounds"),
        expect.anything(),
      );
      const panel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
      expect(panel.round).toBe(3);                             // capped at 3
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("confirms every drafted contract and activates nothing on decline", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-high-risk-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-high-risk");
      ctx.ui.confirm = vi.fn().mockResolvedValue(false);
      await draftClarificationContract(cwd, "run-high-risk", ctx, []);

      await goal.handler("", ctx);

      const state = await loadGoalState("run-high-risk", defaultGoalStateRoot(cwd));
      expect(ctx.ui.confirm).toHaveBeenCalledWith(
        "Start Goal Contract?",
        expect.stringContaining("Ship automatic goal runtime"),
      );
      expect(state.goals).toHaveLength(0);            // decline ⇒ nothing activates
      expect(runAgent).not.toHaveBeenCalled();        // trivial contract skips the panel
      expect(mockPi.sendUserMessage).not.toHaveBeenCalledWith(expect.stringContaining("Work until verifier PASS"), expect.anything());
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("refuses to autostart when the session is non-interactive (fail-closed)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-non-interactive-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-non-interactive");
      delete (ctx.ui as any).confirm;
      await draftClarificationContract(cwd, "run-non-interactive", ctx, []);

      await goal.handler("", ctx);

      const state = await loadGoalState("run-non-interactive", defaultGoalStateRoot(cwd));
      expect(state.goals).toHaveLength(0);            // nothing activated
      expect(runAgent).not.toHaveBeenCalled();        // trivial contract skips the panel
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("requires interactive confirmation"), "error",
      );
      // contract survives for a later interactive /goal
      const clar = await loadClarificationState("run-non-interactive", defaultClarificationStateRoot(cwd));
      expect(clar.goalContract?.objective).toBe("Ship automatic goal runtime");
      expect(mockPi.sendUserMessage).not.toHaveBeenCalledWith(expect.stringContaining("until the entire active goal is complete"), expect.anything());
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("draft_goal_contract queues a /goal follow-up rather than confirming inline", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-draft-queue-"));
    try {
      const { mockPi, tools } = createMockPi();
      extension(mockPi);
      const tool = tools.get("clarification_state");
      expect(tool).toBeDefined();
      const runId = "run-draft-queue";
      const ctx = mockGoalCtx(cwd, runId);

      // Seed the interview + checklist so the gate passes, then drive the draft through the tool handler.
      const rootDir = defaultClarificationStateRoot(cwd);
      const now = "2026-05-29T00:00:00.000Z";
      await applyAndPersistClarificationCommand(runId, rootDir, { type: "start_interview", topic: "auto goal" }, ctx, now);
      const checklist = ["objective", "scope", "non_goals", "constraints", "success_criteria", "evidence_required", "risks", "edge_cases", "technical_context"] as const;
      for (const id of checklist) {
        await applyAndPersistClarificationCommand(runId, rootDir, { type: "mark_checklist_item", id, value: `${id} clarified` }, ctx, now);
      }

      await tool.execute("call-1", {
        action: "draft_goal_contract",
        contract: {
          objective: "Ship automatic goal runtime",
          scope: ["auto create", "auto activate"],
          nonGoals: ["legacy workflow"],
          successCriteria: ["/goal starts automatically"],
          constraints: ["no manual create"],
          evidenceRequired: ["goal workflow tests pass"],
          risks: ["duplicate goals"],
          suggestedSubgoals: [],
          handoffCommand: "/goal",
        },
      }, undefined, undefined, ctx);

      expect(ctx.ui.confirm).not.toHaveBeenCalled();  // NOT inline in the tool handler
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("Run /goal (no arguments) to review and start"),
        { deliverAs: "followUp" },
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("routes /goal into clarification when no active goal or contract exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-auto-empty-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-empty");

      await goal.handler("", ctx);

      const state = await loadGoalState("run-empty", defaultGoalStateRoot(cwd));
      expect(state.goals).toHaveLength(0);
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("no active goal and no drafted Goal Contract"), { deliverAs: "followUp" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("triages free-text /goal requests without creating a goal immediately", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-free-text-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-free-text");

      await goal.handler("investigate current parser behavior", ctx);

      const state = await loadGoalState("run-free-text", defaultGoalStateRoot(cwd));
      expect(state.goals).toHaveLength(0);
      expect(ctx.ui.setStatus).toHaveBeenCalledWith("harness", "Goal request triage in progress...");
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("First triage the request silently"), { deliverAs: "followUp" });
      const prompt = mockPi.sendUserMessage.mock.calls[0][0];
      expect(prompt).toContain("answer it directly as a normal user prompt");
      expect(prompt).toContain("route it into deep agentic-clarification");
      expect(prompt).toContain("If uncertain, prefer clarification");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("preserves explicit subcommands instead of triaging them as free text", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-status-explicit-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-explicit-status");

      await goal.handler("status", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Active goal: none"), "info");
      expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("routes incomplete objective-only goals to clarification before activation or completion", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-incomplete-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-incomplete");

      await goal.handler("create Ship verifier guard", ctx);
      await goal.handler("activate goal-1", ctx);
      await goal.handler("complete goal-1", ctx);

      const state = await loadGoalState("run-incomplete", defaultGoalStateRoot(cwd));
      expect(runAgent).not.toHaveBeenCalled();
      expect(state.goals[0].status).toBe("queued");
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("not structurally ready"), { deliverAs: "followUp" });
      expect(mockPi.sendUserMessage.mock.calls.at(-1)?.[0]).toContain("missing success criteria, missing evidence required");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("routes incomplete queued goals to clarification instead of auto-starting with empty /goal", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-incomplete-auto-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-incomplete-auto");

      await goal.handler("create Ship verifier guard", ctx);
      await goal.handler("", ctx);

      const state = await loadGoalState("run-incomplete-auto", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).toBe("queued");
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("not structurally ready"), { deliverAs: "followUp" });
      expect(mockPi.sendUserMessage.mock.calls.at(-1)?.[0]).toContain("missing success criteria, missing evidence required");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("completes a goal only when reviewer-verifier returns PASS", async () => {
    vi.mocked(runAgent).mockResolvedValue(verifierResult("Verdict: PASS\nSummary: Complete\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- tests passed"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-pass-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-pass");

      await createReadyGoal(cwd, "run-pass", ctx, goal);
      await goal.handler("", ctx);   // M6: auto goals are review-gated — complete via the runtime turn

      const state = await loadGoalState("run-pass", defaultGoalStateRoot(cwd));
      // verifier PASS first, then the security/qa review panel (M6) — 3 dispatches total
      expect(runAgent).toHaveBeenCalledTimes(3);
      expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
        sandbox: expect.objectContaining({ enabled: true, requireApprovalForAllCommands: true }),
      }));
      expect(state.goals[0].status).toBe("completed");
      expect(state.goals[0].verifierReceipts[0]).toMatchObject({ verdict: "PASS", rawOutput: expect.stringContaining("Verdict: PASS") });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("stores FAIL verifier receipts without completing", async () => {
    vi.mocked(runAgent).mockResolvedValue(verifierResult("Verdict: FAIL\nSummary: Missing evidence\nBlockers:\n- missing test\nCommands Run:\n- npm test\nEvidence Checked:\n- none"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-fail-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-fail");

      await createReadyGoal(cwd, "run-fail", ctx, goal);
      await goal.handler("complete goal-1", ctx);

      const state = await loadGoalState("run-fail", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).toBe("blocked");
      expect(state.goals[0].verifierReceipts[0]).toMatchObject({ verdict: "FAIL", blockers: ["missing test"] });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("clears consumed continuation so verifier retry can proceed to PASS", async () => {
    vi.mocked(runAgent)
      .mockResolvedValueOnce(verifierResult("Verdict: FAIL\nSummary: Missing evidence\nBlockers:\n- missing test\nCommands Run:\n- npm test\nEvidence Checked:\n- none"))
      .mockResolvedValue(verifierResult("Verdict: PASS\nSummary: Complete\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- fixed"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-retry-pass-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-retry-pass");

      await createReadyGoal(cwd, "run-retry-pass", ctx, goal);
      await goal.handler("complete goal-1", ctx);
      let state = await loadGoalState("run-retry-pass", defaultGoalStateRoot(cwd));
      expect(state.continuation.queued).toBe(true);

      await goal.handler("evidence goal-1 fixed blockers", ctx);
      await goal.handler("", ctx);   // M6: review-gated retry — the runtime turn clears the consumed continuation, re-verifies, and runs the review panel

      state = await loadGoalState("run-retry-pass", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).toBe("completed");
      expect(state.continuation.queued).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("treats malformed verifier output as FAIL", async () => {
    vi.mocked(runAgent).mockResolvedValue(verifierResult("Summary: I think it is fine"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-malformed-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-malformed");

      await createReadyGoal(cwd, "run-malformed", ctx, goal);
      await goal.handler("complete goal-1", ctx);

      const state = await loadGoalState("run-malformed", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).toBe("blocked");
      expect(state.goals[0].verifierReceipts[0]).toMatchObject({ verdict: "FAIL", rawOutput: "Summary: I think it is fine" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("treats verifier process errors as FAIL", async () => {
    vi.mocked(runAgent).mockRejectedValue(new Error("spawn failed"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-error-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-error");

      await createReadyGoal(cwd, "run-error", ctx, goal);
      await goal.handler("complete goal-1", ctx);

      const state = await loadGoalState("run-error", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).toBe("blocked");
      expect(state.goals[0].verifierReceipts[0]).toMatchObject({ verdict: "FAIL", rawOutput: "spawn failed" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("created goal fields equal the stored contract byte-for-byte (objectiveHash protection)", async () => {
    // objective/successCriteria/evidenceRequired feed buildGoalObjectiveHash (goal-state.ts:645);
    // drift here would stale the objective hash at completion.
    // Default 2-subgoal contract is non-trivial: converge the panel so the gated path creates the goal.
    vi.mocked(runAgent).mockResolvedValue(criticResult("APPROVE"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-byte-identity-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-byte-identity");
      await draftClarificationContract(cwd, "run-byte-identity", ctx);

      await goal.handler("", ctx);

      const goalState = await loadGoalState("run-byte-identity", defaultGoalStateRoot(cwd));
      const clar = await loadClarificationState("run-byte-identity", defaultClarificationStateRoot(cwd));
      const created = goalState.goals[0];
      const contract = clar.goalContract!;
      expect(created.objective).toBe(contract.objective);
      expect(created.successCriteria).toEqual(contract.successCriteria);
      expect(created.evidenceRequired).toEqual(contract.evidenceRequired);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("a trivial contract activates ungated and completes via the verifier + review gates", async () => {
    vi.mocked(runAgent).mockResolvedValue(verifierResult("Verdict: PASS\nSummary: done\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-trivial-ungated-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-trivial-ungated");

      await createReadyGoal(cwd, "run-trivial-ungated", ctx, goal);

      let state = await loadGoalState("run-trivial-ungated", defaultGoalStateRoot(cwd));
      expect(state.goals[0].gates?.panel).toBeUndefined();     // ungated
      expect(state.panels.find((p) => p.panelId === "goal-contract-panel")).toBeUndefined(); // no panel opened
      expect(runAgent).not.toHaveBeenCalled();                 // no critic dispatch on the trivial path

      await goal.handler("", ctx);   // M6: review-gated — the runtime turn re-verifies then runs the review panel

      state = await loadGoalState("run-trivial-ungated", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).toBe("completed");
      expect(runAgent).toHaveBeenCalledTimes(3);               // verifier + security-reviewer + qa-reviewer
      const dispatched = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName).sort();
      expect(dispatched).toEqual(["qa-reviewer", "reviewer-verifier", "security-reviewer"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("manual /goal create→activate→complete never confirms and stays ungated", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-manual-ungated-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-manual-ungated");

      await goal.handler("create Ship verifier guard", ctx);
      await goal.handler("activate goal-1", ctx);
      await goal.handler("complete goal-1", ctx);

      const state = await loadGoalState("run-manual-ungated", defaultGoalStateRoot(cwd));
      expect(ctx.ui.confirm).not.toHaveBeenCalled();  // no approval gate on the manual path
      expect(state.goals[0].objective).toBe("Ship verifier guard");
      expect(state.goals[0].gates).toBeUndefined();   // manual goals stay ungated
      expect(mockPi.sendUserMessage).not.toHaveBeenCalledWith(expect.stringContaining("until the entire active goal is complete"), expect.anything());
      // the manual path never orchestrates
      expect(mockPi.sendUserMessage.mock.calls.some((c: any[]) => String(c[0]).includes("The runtime is implementing subgoals"))).toBe(false);
      // M6: the ungated manual path never opens a review panel
      expect(vi.mocked(runAgent).mock.calls.some((c: any[]) => c[0].agentName === "security-reviewer" || c[0].agentName === "qa-reviewer")).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("dispatches worker then validator per subgoal for a flagged goal", async () => {
    vi.mocked(runAgent).mockImplementation(flaggedChainMock());
    const cwd = await mkdtemp(join(tmpdir(), "goal-worker-validator-order-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-wv-order");
      await draftClarificationContract(cwd, "run-wv-order", ctx);

      await goal.handler("", ctx);                    // turn 1: panel + confirm + activate (defers the cycle)
      await goal.handler("", ctx);                    // turn 2: subgoal-1 worker→validator cycle

      const dispatched = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName);
      expect(dispatched.slice(3)).toEqual(["worker", "plan-validator"]);   // after the 3 critics: worker THEN validator
      const state = await loadGoalState("run-wv-order", defaultGoalStateRoot(cwd));
      const subgoal1 = state.goals[0].subgoals.find((s) => s.id === "subgoal-1")!;
      expect(subgoal1.status).toBe("completed");
      expect(subgoal1.validatorReceipts?.at(-1)).toMatchObject({ verdict: "PASS", validatorAgent: "plan-validator" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("isolates the validator from worker output (fresh context, subgoal fields verbatim, no sentinel)", async () => {
    const SENTINEL = "WORKER-SIDE-CHANNEL-XYZ";
    vi.mocked(runAgent).mockImplementation(flaggedChainMock(SENTINEL));
    const cwd = await mkdtemp(join(tmpdir(), "goal-validator-isolation-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-isolation");
      await draftClarificationContract(cwd, "run-isolation", ctx);

      await goal.handler("", ctx);
      await goal.handler("", ctx);                    // subgoal-1 cycle: worker emits the sentinel

      const validatorCall = vi.mocked(runAgent).mock.calls.find((c: any[]) => c[0].agentName === "plan-validator")![0] as any;
      expect(validatorCall.task).toContain("Implement auto start");         // subgoal objective verbatim
      expect(validatorCall.task).toContain("/goal starts automatically");   // each success criterion verbatim
      expect(validatorCall.task).toContain("goal workflow tests pass");     // evidence required verbatim
      expect(validatorCall.task).not.toContain(SENTINEL);                   // NEVER the worker output
      expect(validatorCall.contextMode).toBe("fresh");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("applies the validator receipt and completion itself and self-continues to the next subgoal", async () => {
    vi.mocked(runAgent).mockImplementation(flaggedChainMock());
    const cwd = await mkdtemp(join(tmpdir(), "goal-flagged-chain-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-flagged-chain");
      await draftClarificationContract(cwd, "run-flagged-chain", ctx);

      await goal.handler("", ctx);                    // turn 1: activation
      await goal.handler("", ctx);                    // turn 2: subgoal-1 cycle → PASS
      let state = await loadGoalState("run-flagged-chain", defaultGoalStateRoot(cwd));
      expect(state.continuation.queued).toBe(true);   // self-continuation queued by the runtime
      expect(state.continuation.reason).toBe("validator_next");
      expect(mockPi.sendUserMessage.mock.calls.at(-1)?.[0]).toContain("The runtime is implementing subgoals");

      await goal.handler("", ctx);                    // turn 3: subgoal-2 cycle → PASS
      state = await loadGoalState("run-flagged-chain", defaultGoalStateRoot(cwd));
      expect(state.goals[0].subgoals.every((s) => s.status === "completed")).toBe(true);

      await goal.handler("", ctx);                    // turn 4: goal-level completion via the verifier + review panel
      state = await loadGoalState("run-flagged-chain", defaultGoalStateRoot(cwd));
      expect(vi.mocked(runAgent).mock.calls.some((c: any[]) => c[0].agentName === "reviewer-verifier")).toBe(true);
      expect(state.goals[0].status).toBe("completed");
      expect(state.status).toBe("completed");
      // M6: the review panel gated the completion — opened, dispatched AFTER the verifier, all-APPROVE
      const reviewPanel = state.panels.find((p) => p.panelId === "goal-review-panel")!;
      expect(reviewPanel).toBeDefined();
      expect(isPanelApproved(reviewPanel)).toBe(true);
      const turn4Agents = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName);
      const verifierIndex = turn4Agents.indexOf("reviewer-verifier");
      expect(turn4Agents.indexOf("security-reviewer")).toBeGreaterThan(verifierIndex);
      expect(turn4Agents.indexOf("qa-reviewer")).toBeGreaterThan(verifierIndex);

      // ZERO main-agent implement instructions across every follow-up
      const followUps = mockPi.sendUserMessage.mock.calls.map((c: any[]) => String(c[0]));
      expect(followUps.some((p) => p.includes("Implement the current active subgoal"))).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("re-dispatches the worker with accumulated validator feedback and never sends a verifier_fail follow-up", async () => {
    const SENTINEL = "WORKER-RETRY-SENTINEL";
    let validatorCalls = 0;
    vi.mocked(runAgent).mockImplementation(async (o: any) => {
      if (o.agentName === "reviewer-feasibility" || o.agentName === "reviewer-architecture" || o.agentName === "reviewer-risk") {
        return criticResult("APPROVE");
      }
      if (o.agentName === "plan-validator") {
        validatorCalls += 1;
        const finding = validatorCalls === 1 ? "finding-A" : "finding-B";
        return verifierResult(`Verdict: FAIL\nSummary: attempt ${validatorCalls} failed\nBlockers:\n- ${finding}\nCommands Run:\n- npm test\nEvidence Checked:\n- none`);
      }
      return verifierResult(SENTINEL); // worker
    });
    const cwd = await mkdtemp(join(tmpdir(), "goal-fail-retry-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-fail-retry");
      await draftClarificationContract(cwd, "run-fail-retry", ctx);

      await goal.handler("", ctx);                    // activation turn
      await goal.handler("", ctx);                    // cycle A: validator FAIL finding-A
      await goal.handler("", ctx);                    // cycle B: worker re-dispatched with feedback

      const workerCalls = vi.mocked(runAgent).mock.calls.filter((c: any[]) => c[0].agentName === "worker");
      expect(workerCalls).toHaveLength(2);
      expect(workerCalls[0][0].task).not.toContain("finding-A");            // first attempt has no prior feedback
      expect(workerCalls[1][0].task).toContain("Address these prior validator findings:");
      expect(workerCalls[1][0].task).toContain("finding-A");                // ALL accumulated feedback verbatim

      const followUps = mockPi.sendUserMessage.mock.calls.map((c: any[]) => String(c[0]));
      // no ungated verifier_fail body — the worker loop is the sole retry driver
      expect(followUps.some((p) => p.includes("Do not claim complete or request completion again"))).toBe(false);
      expect(followUps.at(-1)).toContain("The runtime is implementing subgoals");

      const state = await loadGoalState("run-fail-retry", defaultGoalStateRoot(cwd));
      expect(state.goals[0].subgoals.find((s) => s.id === "subgoal-1")?.status).toBe("blocked");
      expect(state.continuation.consecutiveFailures["subgoal-1"]).toBe(2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("routes a goal-level verifier FAIL through the flagged orchestrator branch, never the implement prompt", async () => {
    vi.mocked(runAgent).mockImplementation(async (o: any) => {
      if (o.agentName === "plan-validator") {
        return verifierResult("Verdict: PASS\nSummary: subgoal ok\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
      }
      if (o.agentName === "reviewer-verifier") {
        return verifierResult("Verdict: FAIL\nSummary: goal incomplete\nBlockers:\n- integration missing\nCommands Run:\n- npm test\nEvidence Checked:\n- none");
      }
      return verifierResult("worker done");
    });
    const cwd = await mkdtemp(join(tmpdir(), "goal-level-fail-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-goal-level-fail");
      await draftClarificationContract(cwd, "run-goal-level-fail", ctx, ["Only subgoal"]);   // trivial: 1 subgoal, flagged

      await goal.handler("", ctx);                    // activation (trivial escape, still gates.validator)
      await goal.handler("", ctx);                    // subgoal cycle → PASS
      await goal.handler("", ctx);                    // goal-level verifier → FAIL

      const state = await loadGoalState("run-goal-level-fail", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).not.toBe("completed");
      const failFollowUp = mockPi.sendUserMessage.mock.calls.at(-1)?.[0] as string;
      expect(failFollowUp).toContain("The runtime is implementing subgoals");
      expect(failFollowUp).not.toContain("Implement the current active subgoal");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("halts the worker loop with a blocker-summary escalation after 3 validator FAILs", async () => {
    let attempts = 0;
    vi.mocked(runAgent).mockImplementation(async (o: any) => {
      if (o.agentName === "plan-validator") {
        attempts += 1;
        return verifierResult(`Verdict: FAIL\nSummary: attempt ${attempts} failed\nBlockers:\n- persistent-blocker-${attempts}\nCommands Run:\n- npm test\nEvidence Checked:\n- none`);
      }
      return verifierResult("worker attempt");
    });
    const cwd = await mkdtemp(join(tmpdir(), "goal-three-strike-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-three-strike");
      await draftClarificationContract(cwd, "run-three-strike", ctx, ["Only subgoal"]);      // trivial: 1 subgoal, flagged

      await goal.handler("", ctx);                    // activation
      await goal.handler("", ctx);                    // strike 1
      await goal.handler("", ctx);                    // strike 2
      await goal.handler("", ctx);                    // strike 3 → halt + escalate

      const state = await loadGoalState("run-three-strike", defaultGoalStateRoot(cwd));
      expect(state.continuation.consecutiveFailures["subgoal-1"]).toBeGreaterThanOrEqual(3);
      const followUps = mockPi.sendUserMessage.mock.calls.map((c: any[]) => String(c[0]));
      expect(followUps.some((p) => p.includes("exhausted its 3-attempt failure budget"))).toBe(true);
      // the loop STOPPED: no further validator_next self-continuation was queued on the third strike
      expect(state.continuation.queued).toBe(false);
      const lastFollowUp = followUps.at(-1)!;
      expect(lastFollowUp).toContain("The worker→validator loop exhausted its 3-attempt failure budget without a PASS. Stop and summarize the unresolved blockers for the user:");
      expect(lastFollowUp).toContain("persistent-blocker-3");
      expect(lastFollowUp).not.toContain("Run /goal (no arguments) to advance");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("a trivial-escape goal still runs the validator gate on its subgoal", async () => {
    vi.mocked(runAgent).mockImplementation(flaggedChainMock());
    const cwd = await mkdtemp(join(tmpdir(), "goal-trivial-validator-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-trivial-validator");
      await draftClarificationContract(cwd, "run-trivial-validator", ctx, ["Only subgoal"]); // 1 subgoal + 1 criterion ⇒ trivial

      await goal.handler("", ctx);                    // turn 1: confirm + activate, NO panel
      expect(runAgent).not.toHaveBeenCalled();        // trivial escape is panel-free
      expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
      let state = await loadGoalState("run-trivial-validator", defaultGoalStateRoot(cwd));
      expect(state.goals[0].gates?.panel).toBeUndefined();
      expect(state.goals[0].gates?.validator).toBe(true);
      expect(state.goals[0].subgoals[0].status).not.toBe("completed");

      await goal.handler("", ctx);                    // turn 2: worker→validator cycle
      state = await loadGoalState("run-trivial-validator", defaultGoalStateRoot(cwd));
      const dispatched = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName);
      expect(dispatched).toEqual(["worker", "plan-validator"]);
      expect(state.goals[0].subgoals[0].status).toBe("completed");     // only after the plan-validator PASS
      expect(state.goals[0].subgoals[0].validatorReceipts?.at(-1)).toMatchObject({ verdict: "PASS" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("mini-chain: contract → panel ×3 APPROVE → confirm → autostart → subgoal worker→validator PASS → completed", async () => {
    vi.mocked(runAgent).mockImplementation(flaggedChainMock());
    const cwd = await mkdtemp(join(tmpdir(), "goal-mini-chain-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-mini-chain");
      await draftClarificationContract(cwd, "run-mini-chain", ctx);    // default 2-subgoal ⇒ non-trivial

      await goal.handler("", ctx);                    // turn 1: panel + confirm + gated activation
      let state = await loadGoalState("run-mini-chain", defaultGoalStateRoot(cwd));
      const criticCalls = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName).sort();
      expect(criticCalls).toEqual(["reviewer-architecture", "reviewer-feasibility", "reviewer-risk"]);
      expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
      expect(state.goals[0].gates).toMatchObject({ panel: true, validator: true });
      expect(state.status).toBe("active");

      await goal.handler("", ctx);                    // turn 2: subgoal-1 worker→validator PASS
      state = await loadGoalState("run-mini-chain", defaultGoalStateRoot(cwd));
      const turn2 = vi.mocked(runAgent).mock.calls.slice(3).map((c: any[]) => c[0].agentName);
      expect(turn2).toEqual(["worker", "plan-validator"]);
      expect(state.goals[0].subgoals.find((s) => s.id === "subgoal-1")?.status).toBe("completed");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("MF full-chain: fresh contract (with ASSUMPTION default) → panel APPROVE×3 → single confirm → 2 subgoals worker→validator PASS → verifier PASS → security+qa PASS → completed, zero other user-input", async () => {
    // Single source of truth for the pinned recording-convention literal (M7/M3).
    const ASSUMPTION = "ASSUMPTION:";
    const ASSUMPTION_CONSTRAINT = "ASSUMPTION: no manual create step is required";
    vi.mocked(runAgent).mockImplementation(flaggedChainMock());
    const cwd = await mkdtemp(join(tmpdir(), "goal-mf-full-chain-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const runId = "run-mf-full-chain";
      const ctx = mockGoalCtx(cwd, runId);

      // Inline contract draft (mirrors draftClarificationContract) so the shared
      // helper's fixture stays untouched while one constraint carries the
      // ASSUMPTION:-prefixed clarification default. 2 subgoals ⇒ non-trivial.
      const rootDir = defaultClarificationStateRoot(cwd);
      const now = "2026-07-08T00:00:00.000Z";
      await applyAndPersistClarificationCommand(runId, rootDir, { type: "start_interview", topic: "auto goal" }, ctx, now);
      const checklist = ["objective", "scope", "non_goals", "constraints", "success_criteria", "evidence_required", "risks", "edge_cases", "technical_context"] as const;
      for (const id of checklist) {
        await applyAndPersistClarificationCommand(runId, rootDir, { type: "mark_checklist_item", id, value: `${id} clarified` }, ctx, now);
      }
      await applyAndPersistClarificationCommand(runId, rootDir, {
        type: "draft_goal_contract",
        contract: {
          objective: "Ship automatic goal runtime",
          scope: ["auto create", "auto activate"],
          nonGoals: ["legacy workflow"],
          successCriteria: ["/goal starts automatically"],
          constraints: [ASSUMPTION_CONSTRAINT],
          evidenceRequired: ["goal workflow tests pass"],
          risks: ["duplicate goals"],
          suggestedSubgoals: ["Implement auto start", "Verify idempotency"],
          handoffCommand: "/goal",
        },
      }, ctx, now);

      // Turn 1: contract panel (3 critics) + single confirm + gated activation.
      await goal.handler("", ctx);
      let state = await loadGoalState(runId, defaultGoalStateRoot(cwd));
      const criticNames = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName).sort();
      expect(criticNames).toEqual(["reviewer-architecture", "reviewer-feasibility", "reviewer-risk"]);
      const contractPanel = state.panels.find((p) => p.panelId === "goal-contract-panel")!;
      expect(contractPanel.verdicts.filter((v) => v.verdict === "APPROVE")).toHaveLength(3);
      expect(state.goals[0].gates).toMatchObject({ panel: true, validator: true, review: true });

      // ASSUMPTION field survives the drafted contract AND flows byte-identical into the goal.
      const clar = await loadClarificationState(runId, rootDir);
      expect(clar.goalContract!.constraints.some((c) => c.startsWith(ASSUMPTION))).toBe(true);
      expect(clar.goalContract!.constraints).toContain(ASSUMPTION_CONSTRAINT);
      expect(state.goals[0].constraints).toContain(ASSUMPTION_CONSTRAINT);

      // Turn 2: subgoal-1 worker→validator PASS → validator_next self-continuation.
      await goal.handler("", ctx);
      state = await loadGoalState(runId, defaultGoalStateRoot(cwd));
      expect(state.continuation.queued).toBe(true);
      expect(state.continuation.reason).toBe("validator_next");
      expect(state.goals[0].subgoals.find((s) => s.id === "subgoal-1")?.status).toBe("completed");

      // Turn 3: subgoal-2 worker→validator PASS → validator_next self-continuation.
      await goal.handler("", ctx);
      state = await loadGoalState(runId, defaultGoalStateRoot(cwd));
      expect(state.continuation.queued).toBe(true);
      expect(state.continuation.reason).toBe("validator_next");
      expect(state.goals[0].subgoals.every((s) => s.status === "completed")).toBe(true);

      // Turn 4: goal-level verifier PASS → review panel (security+qa) PASS → completed.
      await goal.handler("", ctx);
      state = await loadGoalState(runId, defaultGoalStateRoot(cwd));
      const dispatched = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName);
      const verifierIndex = dispatched.indexOf("reviewer-verifier");
      expect(verifierIndex).toBeGreaterThanOrEqual(0);
      expect(dispatched.indexOf("security-reviewer")).toBeGreaterThan(verifierIndex);
      expect(dispatched.indexOf("qa-reviewer")).toBeGreaterThan(verifierIndex);
      const reviewPanel = state.panels.find((p) => p.panelId === "goal-review-panel")!;
      expect(isPanelApproved(reviewPanel)).toBe(true);
      expect(reviewPanel.round).toBe(1);
      expect(state.goals[0].verifierReceipts.some((r) => r.verdict === "PASS")).toBe(true);

      // Terminal state.
      expect(state.goals[0].status).toBe("completed");
      expect(state.status).toBe("completed");

      // Single gate: confirm called EXACTLY once across the WHOLE run; zero other user-input.
      expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
      const followUps = mockPi.sendUserMessage.mock.calls.map((c: any[]) => String(c[0]));
      expect(followUps.some((p) => p.includes("ask_user_question"))).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("M6 review panel recycling", () => {
  const REVIEW_PASS = "VERDICT: PASS\nSummary: clean\nBlockers:\nFINDINGS:\n- [advisory] none";
  const reviewFail = (finding: string) => `VERDICT: FAIL\nSummary: review gap\nBlockers:\n- ${finding}\nFINDINGS:\n- [blocking] ${finding}`;

  function reviewChainMock(qaVerdictForRound: (round: number) => string) {
    let qaCalls = 0;
    return async (o: any) => {
      if (o.agentName === "reviewer-feasibility" || o.agentName === "reviewer-architecture" || o.agentName === "reviewer-risk") {
        return criticResult("APPROVE");
      }
      if (o.agentName === "plan-validator") {
        return verifierResult("Verdict: PASS\nSummary: validated independently\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
      }
      if (o.agentName === "reviewer-verifier") {
        return verifierResult("Verdict: PASS\nSummary: goal complete\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
      }
      if (o.agentName === "security-reviewer") return verifierResult(REVIEW_PASS);
      if (o.agentName === "qa-reviewer") {
        qaCalls += 1;
        return verifierResult(qaVerdictForRound(qaCalls));
      }
      return verifierResult("worker done");
    };
  }

  it("review FAIL materializes fix subgoals and recycles through the worker loop without completing", async () => {
    vi.mocked(runAgent).mockImplementation(reviewChainMock((round) => round === 1 ? reviewFail("missing-edge-case-test") : REVIEW_PASS));
    const cwd = await mkdtemp(join(tmpdir(), "goal-review-recycle-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-review-recycle");
      await draftClarificationContract(cwd, "run-review-recycle", ctx);   // default 2-subgoal ⇒ non-trivial

      await goal.handler("", ctx);                    // turn 1: panel + confirm + activation
      await goal.handler("", ctx);                    // turn 2: subgoal-1 worker→validator PASS
      await goal.handler("", ctx);                    // turn 3: subgoal-2 worker→validator PASS
      await goal.handler("", ctx);                    // turn 4: goal-level — verifier PASS → review round 1 → qa FAIL

      let state = await loadGoalState("run-review-recycle", defaultGoalStateRoot(cwd));
      // recycling, NOT a thrown complete_target error
      expect(state.goals[0].status).not.toBe("completed");
      const fixSubgoal = state.goals[0].subgoals.find((s) => s.title.startsWith("Fix review finding:"));
      expect(fixSubgoal).toBeDefined();
      expect(fixSubgoal!.title).toBe("Fix review finding: qa-reviewer");
      expect(fixSubgoal!.objective).toContain("missing-edge-case-test");
      expect(state.continuation.queued).toBe(true);
      expect(state.continuation.reason).toBe("review_fix");
      const followUps = mockPi.sendUserMessage.mock.calls.map((c: any[]) => String(c[0]));
      expect(followUps.at(-1)).toContain("The runtime is implementing subgoals");
      // phase held at goal_active: no drafting/escalation follow-up on the review-FAIL path
      expect(followUps.some((p) => p.includes("did not converge"))).toBe(false);
      expect(followUps.some((p) => p.includes("Revise the Goal Contract"))).toBe(false);
      const reviewPanelRound1 = state.panels.find((p) => p.panelId === "goal-review-panel")!;
      expect(reviewPanelRound1.round).toBe(1);

      await goal.handler("", ctx);                    // turn 5: fix subgoal worker→validator PASS
      state = await loadGoalState("run-review-recycle", defaultGoalStateRoot(cwd));
      expect(state.goals[0].subgoals.every((s) => s.status === "completed")).toBe(true);

      await goal.handler("", ctx);                    // turn 6: fresh re-verify → FULL panel re-run (round 2) → all-PASS → completed
      state = await loadGoalState("run-review-recycle", defaultGoalStateRoot(cwd));
      const agentsDispatched = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName);
      // a SECOND reviewer-verifier dispatch (fresh re-verify) preceded the second review round
      expect(agentsDispatched.filter((name) => name === "reviewer-verifier")).toHaveLength(2);
      expect(agentsDispatched.lastIndexOf("reviewer-verifier")).toBeLessThan(agentsDispatched.lastIndexOf("qa-reviewer"));
      expect(agentsDispatched.lastIndexOf("reviewer-verifier")).toBeLessThan(agentsDispatched.lastIndexOf("security-reviewer"));
      expect(state.panels.find((p) => p.panelId === "goal-review-panel")!.round).toBe(2);
      expect(state.goals[0].status).toBe("completed");
      expect(state.status).toBe("completed");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("escalates after the 3-round review panel cap without completing", async () => {
    vi.mocked(runAgent).mockImplementation(reviewChainMock(() => reviewFail("persistent-review-blocker")));
    const cwd = await mkdtemp(join(tmpdir(), "goal-review-cap-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-review-cap");
      await draftClarificationContract(cwd, "run-review-cap", ctx, ["Only subgoal"]);   // trivial: 1 subgoal, flagged + review-gated

      await goal.handler("", ctx);                    // activation (trivial escape)
      await goal.handler("", ctx);                    // subgoal-1 cycle
      await goal.handler("", ctx);                    // goal-level: review round 1 FAIL → fix subgoal
      await goal.handler("", ctx);                    // fix subgoal cycle
      await goal.handler("", ctx);                    // goal-level: review round 2 FAIL → fix subgoal
      await goal.handler("", ctx);                    // fix subgoal cycle
      await goal.handler("", ctx);                    // goal-level: review round 3 FAIL → fix subgoal
      await goal.handler("", ctx);                    // fix subgoal cycle
      await goal.handler("", ctx);                    // goal-level: 4th would-be round ⇒ escalation, NOT a re-open

      const state = await loadGoalState("run-review-cap", defaultGoalStateRoot(cwd));
      const followUps = mockPi.sendUserMessage.mock.calls.map((c: any[]) => String(c[0]));
      expect(followUps.some((p) => p.includes("did not converge after 3 rounds"))).toBe(true);
      expect(state.panels.find((p) => p.panelId === "goal-review-panel")!.round).toBe(3);   // capped, not re-opened to 4
      expect(state.goals[0].status).not.toBe("completed");
      const lastFollowUp = followUps.at(-1)!;
      expect(lastFollowUp).toContain("The security/qa review panel did not converge after 3 rounds. Stop the automatic goal start and summarize the unresolved review findings for the user to resolve manually:");
      expect(lastFollowUp).toContain("persistent-review-blocker");
      expect(lastFollowUp).not.toContain("The runtime is implementing subgoals");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("a trivial-escape goal still runs the security/qa review panel at completion", async () => {
    vi.mocked(runAgent).mockImplementation(flaggedChainMock());
    const cwd = await mkdtemp(join(tmpdir(), "goal-trivial-review-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-trivial-review");
      await draftClarificationContract(cwd, "run-trivial-review", ctx, ["Only subgoal"]); // 1 subgoal + 1 criterion ⇒ trivial

      await goal.handler("", ctx);                    // turn 1: confirm + activate, NO contract panel
      expect(runAgent).not.toHaveBeenCalled();        // trivial escape stays panel-free at the CONTRACT stage
      let state = await loadGoalState("run-trivial-review", defaultGoalStateRoot(cwd));
      expect(state.goals[0].gates).toEqual({ validator: true, review: true });
      expect(state.goals[0].gates?.panel).toBeUndefined();

      await goal.handler("", ctx);                    // turn 2: subgoal worker→validator cycle
      await goal.handler("", ctx);                    // turn 3: goal-level — verifier PASS → review panel → completed

      state = await loadGoalState("run-trivial-review", defaultGoalStateRoot(cwd));
      const dispatched = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName);
      expect(dispatched).toContain("security-reviewer");
      expect(dispatched).toContain("qa-reviewer");
      const reviewPanel = state.panels.find((p) => p.panelId === "goal-review-panel")!;
      expect(isPanelApproved(reviewPanel)).toBe(true);
      expect(state.goals[0].status).toBe("completed");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("mini-integration: fresh goal → subgoals PASS → verifier PASS → security+qa PASS → completed", async () => {
    vi.mocked(runAgent).mockImplementation(flaggedChainMock());
    const cwd = await mkdtemp(join(tmpdir(), "goal-review-mini-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-review-mini");
      await draftClarificationContract(cwd, "run-review-mini", ctx);     // default 2-subgoal ⇒ non-trivial

      await goal.handler("", ctx);                    // turn 1: contract panel + confirm + activation
      await goal.handler("", ctx);                    // turn 2: subgoal-1 cycle
      await goal.handler("", ctx);                    // turn 3: subgoal-2 cycle
      await goal.handler("", ctx);                    // turn 4: goal-level — verifier THEN review panel

      const state = await loadGoalState("run-review-mini", defaultGoalStateRoot(cwd));
      const turn4Agents = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName);
      const verifierIndex = turn4Agents.indexOf("reviewer-verifier");
      expect(verifierIndex).toBeGreaterThanOrEqual(0);
      expect(turn4Agents.indexOf("security-reviewer")).toBeGreaterThan(verifierIndex);
      expect(turn4Agents.indexOf("qa-reviewer")).toBeGreaterThan(verifierIndex);
      expect(state.panels.find((p) => p.panelId === "goal-review-panel")!.round).toBe(1);   // exactly one review round
      expect(state.status).toBe("completed");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("MF failure-injection: one validator-FAIL round + one review-FAIL round still converge to completed within budget", async () => {
    let validatorCalls = 0;
    let qaCalls = 0;
    vi.mocked(runAgent).mockImplementation(async (o: any) => {
      if (o.agentName === "reviewer-feasibility" || o.agentName === "reviewer-architecture" || o.agentName === "reviewer-risk") {
        return criticResult("APPROVE");
      }
      if (o.agentName === "plan-validator") {
        validatorCalls += 1;
        // FAIL the FIRST validator round only (subgoal-1 attempt 1); PASS every subsequent round.
        return validatorCalls === 1
          ? verifierResult("Verdict: FAIL\nSummary: attempt 1\nBlockers:\n- validator-finding-A\nCommands Run:\n- npm test\nEvidence Checked:\n- none")
          : verifierResult("Verdict: PASS\nSummary: validated\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
      }
      if (o.agentName === "reviewer-verifier") {
        return verifierResult("Verdict: PASS\nSummary: goal complete\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
      }
      if (o.agentName === "security-reviewer") return verifierResult(REVIEW_PASS);
      if (o.agentName === "qa-reviewer") {
        qaCalls += 1;
        // FAIL review round 1 only; PASS round 2.
        return qaCalls === 1 ? verifierResult(reviewFail("review-finding-B")) : verifierResult(REVIEW_PASS);
      }
      return verifierResult("worker output"); // worker
    });
    const cwd = await mkdtemp(join(tmpdir(), "goal-mf-failure-injection-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const runId = "run-mf-failure-injection";
      const ctx = mockGoalCtx(cwd, runId);
      await draftClarificationContract(cwd, runId, ctx);                // default 2-subgoal ⇒ non-trivial

      await goal.handler("", ctx);   // t1: contract panel + confirm + activation
      await goal.handler("", ctx);   // t2: subgoal-1 cycle → validator FAIL A → re-dispatch queued (blocked, budget 1)
      await goal.handler("", ctx);   // t3: subgoal-1 re-dispatch with feedback → validator PASS → validator_next

      // Validator FAIL round happened: FAIL receipt with the injected blocker, retry carried feedback.
      let state = await loadGoalState(runId, defaultGoalStateRoot(cwd));
      const subgoal1 = state.goals[0].subgoals.find((s) => s.id === "subgoal-1")!;
      const failReceipt = subgoal1.validatorReceipts!.find((r) => r.verdict === "FAIL")!;
      expect(failReceipt.blockers).toContain("validator-finding-A");
      const workerCalls = vi.mocked(runAgent).mock.calls.filter((c: any[]) => c[0].agentName === "worker");
      expect(workerCalls.length).toBeGreaterThanOrEqual(2);
      expect(workerCalls[0][0].task).not.toContain("validator-finding-A");
      expect(workerCalls[1][0].task).toContain("Address these prior validator findings:");
      expect(workerCalls[1][0].task).toContain("validator-finding-A");
      // Within the failure budget: the PASS reset the strike counter, never the 3-strike halt.
      expect(state.continuation.consecutiveFailures["subgoal-1"] ?? 0).toBe(0);
      expect(subgoal1.status).toBe("completed");

      await goal.handler("", ctx);   // t4: subgoal-2 cycle → validator PASS → validator_next
      await goal.handler("", ctx);   // t5: goal-level verifier PASS → review round 1 → qa FAIL → fix subgoal + review_fix

      // Review FAIL round happened + recycled, goal NOT completed at this point.
      state = await loadGoalState(runId, defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).not.toBe("completed");
      const fixSubgoal = state.goals[0].subgoals.find((s) => s.title.startsWith("Fix review finding:"))!;
      expect(fixSubgoal).toBeDefined();
      expect(fixSubgoal.objective).toContain("review-finding-B");
      expect(state.continuation.queued).toBe(true);
      expect(state.continuation.reason).toBe("review_fix");

      await goal.handler("", ctx);   // t6: fix subgoal worker→validator PASS
      await goal.handler("", ctx);   // t7: fresh re-verify (2nd reviewer-verifier) → review round 2 → all PASS → completed

      state = await loadGoalState(runId, defaultGoalStateRoot(cwd));
      const dispatched = vi.mocked(runAgent).mock.calls.map((c: any[]) => c[0].agentName);
      // Post-fix fresh verifier PASS preceded the second review round (M6 ordering).
      expect(dispatched.filter((name) => name === "reviewer-verifier").length).toBeGreaterThanOrEqual(2);
      expect(dispatched.lastIndexOf("reviewer-verifier")).toBeLessThan(dispatched.lastIndexOf("security-reviewer"));
      expect(dispatched.lastIndexOf("reviewer-verifier")).toBeLessThan(dispatched.lastIndexOf("qa-reviewer"));

      // Convergence within budget: no escalation follow-ups were emitted.
      const followUps = mockPi.sendUserMessage.mock.calls.map((c: any[]) => String(c[0]));
      expect(followUps.some((p) => p.includes("exhausted its 3-attempt failure budget"))).toBe(false);
      expect(followUps.some((p) => p.includes("did not converge"))).toBe(false);
      expect(state.panels.find((p) => p.panelId === "goal-review-panel")!.round).toBe(2);
      expect(state.goals[0].status).toBe("completed");
      expect(state.status).toBe("completed");

      // Single gate preserved: the failure loops never re-prompt the user.
      expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
      expect(followUps.some((p) => p.includes("ask_user_question"))).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function createReadyGoal(cwd: string, runId: string, ctx: any, goalCommand: any) {
  await draftClarificationContract(cwd, runId, ctx, []);
  await goalCommand.handler("", ctx);
}

async function draftClarificationContract(cwd: string, runId: string, ctx: any, suggestedSubgoals = ["Implement auto start", "Verify idempotency"]) {
  const rootDir = defaultClarificationStateRoot(cwd);
  const now = "2026-05-29T00:00:00.000Z";
  await applyAndPersistClarificationCommand(runId, rootDir, { type: "start_interview", topic: "auto goal" }, ctx, now);
  const checklist = ["objective", "scope", "non_goals", "constraints", "success_criteria", "evidence_required", "risks", "edge_cases", "technical_context"] as const;
  for (const id of checklist) {
    await applyAndPersistClarificationCommand(runId, rootDir, { type: "mark_checklist_item", id, value: `${id} clarified` }, ctx, now);
  }
  await applyAndPersistClarificationCommand(runId, rootDir, {
    type: "draft_goal_contract",
    contract: {
      objective: "Ship automatic goal runtime",
      scope: ["auto create", "auto activate"],
      nonGoals: ["legacy workflow"],
      successCriteria: ["/goal starts automatically"],
      constraints: ["no manual create"],
      evidenceRequired: ["goal workflow tests pass"],
      risks: ["duplicate goals"],
      suggestedSubgoals,
      handoffCommand: "/goal",
    },
  }, ctx, now);
}

function mockGoalCtx(cwd: string, runId: string) {
  return {
    cwd,
    runId,
    hasUI: true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn().mockResolvedValue(true),
    },
    sessionManager: {
      appendCustomEntry: vi.fn(),
    },
  };
}

function verifierResult(text: string): any {
  return {
    agent: "reviewer-verifier",
    agentSource: "bundled",
    task: "verify",
    exitCode: 0,
    messages: [{ role: "assistant", content: [{ type: "text", text }] }],
    stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
  };
}

function flaggedChainMock(sentinel = "WORKER-OUTPUT-SENTINEL") {
  return async (o: any) => {
    if (o.agentName === "reviewer-feasibility" || o.agentName === "reviewer-architecture" || o.agentName === "reviewer-risk") {
      return criticResult("APPROVE");
    }
    if (o.agentName === "plan-validator") {
      return verifierResult("Verdict: PASS\nSummary: validated independently\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
    }
    if (o.agentName === "reviewer-verifier") {
      return verifierResult("Verdict: PASS\nSummary: goal complete\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
    }
    if (o.agentName === "security-reviewer" || o.agentName === "qa-reviewer") {
      return verifierResult("VERDICT: PASS\nSummary: clean\nBlockers:\nFINDINGS:\n- [advisory] none");
    }
    return verifierResult(sentinel); // worker output — must NEVER reach the validator
  };
}

function criticResult(verdict: "APPROVE" | "REJECT", finding = "coverage gap in evidenceRequired"): any {
  const text = verdict === "APPROVE"
    ? "CHECKS:\n- C1: YES — verified\n- C2: YES — verified\nVERDICT: APPROVE\nFINDINGS:\n- [advisory] none"
    : `CHECKS:\n- C1: NO — missing\nVERDICT: REJECT\nFINDINGS:\n- [REJECT-level] ${finding}`;
  return { agent: "reviewer-feasibility", agentSource: "bundled", task: "critic", exitCode: 0, messages: [{ role: "assistant", content: [{ type: "text", text }] }], stderr: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 } };
}
