import { describe, expect, it } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import { ICONS, RoachFooter, setUseNerdIcons } from "../footer.js";

setUseNerdIcons(false);

const stubTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  getFgAnsi: (_color: string) => "",
} as any;

const ansiTheme = {
  fg: (color: string, text: string) => `${ansiTheme.getFgAnsi(color)}${text}\x1b[39m`,
  bold: (text: string) => text,
  getFgAnsi: (color: string) => {
    const codes: Record<string, number> = {
      accent: 33,
      success: 34,
      warning: 35,
      error: 196,
      dim: 238,
      text: 15,
    };
    return `\x1b[38;5;${codes[color] ?? 15}m`;
  },
} as any;

function footerData(statuses: ReadonlyMap<string, string> = new Map()): ReadonlyFooterDataProvider {
  return {
    getGitBranch: () => "main",
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  };
}

function createFooter(statuses: ReadonlyMap<string, string> = new Map(), preset: "default" | "compact" | "minimal" = "default"): RoachFooter {
  return new RoachFooter(
    stubTheme,
    footerData(statuses),
    {
      cwd: "/tmp/powerline-project",
      getModelName: () => "test-model",
      getContextUsage: () => ({ tokens: 42_000, contextWindow: 200_000, percent: 21 }),
    },
    { totalInput: 100, totalCacheRead: 50 },
    { running: new Map([["tool-1", "read"]]) },
    null,
    null,
    null,
    { preset },
  );
}

function expectAllLinesFit(lines: string[], width: number): void {
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
}

describe("RoachFooter Powerline styling", () => {
  it("renders concrete Nerd Font icons and the Powerline segment separator", () => {
    setUseNerdIcons(true);
    try {
      expect(Object.values(ICONS).every((icon) => icon.length > 0)).toBe(true);

      const rendered = createFooter().render(100).join("\n");

      expect(rendered).toContain("");
      expect(rendered).toContain(ICONS.folder);
      expect(rendered).toContain(ICONS.branch);
      expect(rendered).toContain(ICONS.model);
    } finally {
      setUseNerdIcons(false);
    }
  });

  it("renders the original-style foreground palette without background blocks", () => {
    const footer = new RoachFooter(
      ansiTheme,
      footerData(),
      {
        cwd: "/tmp/powerline-project",
        getModelName: () => "test-model",
        getContextUsage: () => ({ tokens: 42_000, contextWindow: 200_000, percent: 21 }),
      },
      { totalInput: 100, totalCacheRead: 50 },
      { running: new Map() },
    );

    const rendered = footer.render(100).join("\n");

    expect(rendered).toContain("\x1b[38;2;0;175;175m");
    expect(rendered).toContain("\x1b[38;2;215;135;175m");
    expect(rendered).toContain("\x1b[38;5;244m");
    expect(rendered).not.toContain("\x1b[48;");
  });
});

describe("RoachFooter status bridge", () => {
  it("renders the base footer without extension statuses", () => {
    const footer = createFooter();
    const lines = footer.render(80);

    expect(lines.length).toBe(3);
    expect(lines.join("\n")).toContain("powerline-project");
    expect(lines.join("\n")).toContain("main");
    expect(lines.join("\n")).toContain("test-model");
    expect(lines.join("\n")).toContain("ctx");
    expect(lines.join("\n")).toContain("cache 33%");
    expect(lines.join("\n")).toContain("read");
    expectAllLinesFit(lines, 80);
  });

  it("renders one extension status from footerData.getExtensionStatuses", () => {
    const footer = createFooter(new Map([["harness", "Team running"]]));
    const lines = footer.render(100);

    expect(lines.join("\n")).toContain("Team running");
    expectAllLinesFit(lines, 100);
  });

  it("renders multiple extension statuses in stable key order", () => {
    const footer = createFooter(new Map([
      ["zeta", "Zed status"],
      ["alpha", "Alpha status"],
    ]));
    const rendered = footer.render(120).join("\n");

    expect(rendered).toContain("Alpha status");
    expect(rendered).toContain("Zed status");
    expect(rendered.indexOf("Alpha status")).toBeLessThan(rendered.indexOf("Zed status"));
  });

  it("ignores empty and whitespace-only extension statuses", () => {
    const footer = createFooter(new Map([
      ["empty", ""],
      ["spaces", "   "],
      ["ready", "Ready"],
    ]));
    const rendered = footer.render(100).join("\n");

    expect(rendered).toContain("Ready");
    expect(rendered).not.toContain("empty");
    expect(rendered).not.toContain("spaces");
  });

  it("truncates long extension statuses without exceeding width", () => {
    const footer = createFooter(new Map([
      ["harness", "Deploying a very long background operation that should be truncated safely"],
    ]));
    const width = 44;
    const lines = footer.render(width);

    expect(lines.join("\n")).toContain("Dep");
    expectAllLinesFit(lines, width);
  });

  it("keeps every normal footer line within narrow render widths", () => {
    const footer = createFooter(new Map([
      ["harness", "Narrow status"],
      ["memory", "Memory warm"],
    ]));

    for (const width of [24, 32, 40, 60]) {
      expectAllLinesFit(footer.render(width), width);
    }
  });

  it("renders distinct default, compact, and minimal preset layouts", () => {
    const statuses = new Map([["harness", "Ready"]]);
    const defaultLines = createFooter(statuses, "default").render(100);
    const compactLines = createFooter(statuses, "compact").render(100);
    const minimalLines = createFooter(statuses, "minimal").render(100);

    expect(defaultLines.length).toBe(3);
    expect(compactLines.length).toBe(2);
    expect(minimalLines.length).toBe(2);
    expect(defaultLines.join("\n")).toContain("ctx");
    expect(compactLines.join("\n")).toContain("ctx");
    expect(minimalLines.join("\n")).not.toContain("ctx");
    expect(minimalLines.join("\n")).not.toContain("test-model");
    expect(defaultLines.join("\n")).toContain("Ready");
    expect(compactLines.join("\n")).toContain("Ready");
    expect(minimalLines.join("\n")).toContain("Ready");
  });

  it("keeps every preset width-safe at narrow and normal widths", () => {
    const statuses = new Map([["harness", "Preset status that may need truncation"]]);

    for (const preset of ["default", "compact", "minimal"] as const) {
      for (const width of [28, 44, 100]) {
        expectAllLinesFit(createFooter(statuses, preset).render(width), width);
      }
    }
  });
});
