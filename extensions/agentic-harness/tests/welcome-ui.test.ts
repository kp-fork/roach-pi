import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-coding-agent", () => ({
  keyHint: (key: string, description?: string) => `${key}${description ? ` ${description}` : ""}`,
  keyText: (key: string) => key,
  rawKeyHint: (key: string, description?: string) => `${key}${description ? ` ${description}` : ""}`,
}));

import {
  createWelcomeHeader,
  dismissWelcomeHeader,
  freezeWelcomeShimmer,
  isWelcomeVisible,
  registerWelcomeCommand,
  showWelcomeHeader,
  toggleWelcomeHeader,
  unfreezeWelcomeShimmer,
} from "../welcome-ui.js";
import { SHIMMER_SWEEP_MS } from "../shimmer.js";

function ui() {
  return {
    setHeader: vi.fn(),
    notify: vi.fn(),
  };
}

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

const shimmerTheme = {
  ...theme,
  getFgAnsi: (color: string) => color === "warning" ? "\x1b[33m" : "\x1b[36m",
} as any;

const SHIMMER_HIGHLIGHT_ANSI = "\x1b[38;2;241;248;242m";

function render(component: { render(width: number): string[] }): string {
  return component.render(120).join("\n");
}

afterEach(() => {
  unfreezeWelcomeShimmer();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("welcome header controller", () => {
  it("creates a non-blocking header component", () => {
    const component = createWelcomeHeader()({} as any, theme);
    const rendered = component.render(120).join("\n");

    expect(rendered).toContain("Engineering Discipline Extension");
    expect(rendered).toContain("/clarify");
  });

  it("keeps the banner shimmer running while the header is shown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const component = createWelcomeHeader()({ requestRender: vi.fn() } as any, shimmerTheme);

    const initialRender = render(component);
    expect(initialRender).toContain("\x1b[");
    expect(initialRender).toContain(SHIMMER_HIGHLIGHT_ANSI);
    expect(initialRender).not.toContain("\x1b[33m");

    vi.setSystemTime(350);
    expect(render(component)).not.toBe(initialRender);

    vi.setSystemTime(SHIMMER_SWEEP_MS * 3);
    const laterRender = render(component);

    expect(laterRender).toContain("\x1b[");
    expect(laterRender).toContain("Engineering Discipline Extension");
  });

  it("clears the shimmer timer on dispose", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const requestRender = vi.fn();

    const component = createWelcomeHeader()({ requestRender } as any, shimmerTheme);
    component.dispose?.();
    vi.advanceTimersByTime(80);

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it("freezes the shimmer to a static banner once the conversation starts", () => {
    // Regression guard: once conversation content grows past one screen, the
    // banner lives above the viewport. Every animated shimmer frame then forces
    // pi-tui into fullRender(true), which clears the terminal scrollback
    // (\x1b[3J) ~30x/sec and makes scrolling up impossible.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requestRender = vi.fn();
    const component = createWelcomeHeader()({ requestRender } as any, shimmerTheme);

    freezeWelcomeShimmer();

    const frozenRender = render(component);
    expect(frozenRender).not.toContain("\x1b[38;2;"); // static banner, no truecolor shimmer
    requestRender.mockClear();

    vi.advanceTimersByTime(330); // 10 shimmer frames
    expect(requestRender).not.toHaveBeenCalled();

    vi.setSystemTime(SHIMMER_SWEEP_MS / 2);
    expect(render(component)).toBe(frozenRender); // time-invariant after freeze
  });

  it("creates static headers while frozen (e.g., /welcome on after chatting)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    freezeWelcomeShimmer();

    const requestRender = vi.fn();
    const component = createWelcomeHeader()({ requestRender } as any, shimmerTheme);

    expect(render(component)).not.toContain("\x1b[38;2;");
    vi.advanceTimersByTime(330);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it("self-freezes when content grows taller than the viewport", () => {
    // Even before any conversation, pi's startup context dump can push the
    // banner above the viewport (e.g., 100 content lines on a 28-row screen).
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requestRender = vi.fn();
    const tui = {
      requestRender,
      previousLines: new Array(100).fill(""),
      terminal: { rows: 28 },
    };
    const component = createWelcomeHeader()(tui as any, shimmerTheme);

    vi.advanceTimersByTime(40); // first tick detects banner above viewport
    const callsAfterFreeze = requestRender.mock.calls.length; // freeze paints static once
    vi.advanceTimersByTime(330);
    expect(requestRender.mock.calls.length).toBe(callsAfterFreeze); // no further ticks

    expect(render(component)).not.toContain("\x1b[38;2;"); // static banner
  });

  it("keeps animating while all content fits in the viewport", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requestRender = vi.fn();
    const tui = {
      requestRender,
      previousLines: new Array(20).fill(""),
      terminal: { rows: 28 },
    };
    const component = createWelcomeHeader()(tui as any, shimmerTheme);

    vi.advanceTimersByTime(100);
    expect(requestRender).toHaveBeenCalled();
    expect(render(component)).toContain("\x1b[38;2;");
  });

  it("shows, dismisses, and toggles the header", () => {
    const mockUi = ui();

    showWelcomeHeader(mockUi as any);
    expect(isWelcomeVisible()).toBe(true);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(expect.any(Function));

    dismissWelcomeHeader(mockUi as any);
    expect(isWelcomeVisible()).toBe(false);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);

    expect(toggleWelcomeHeader(mockUi as any)).toBe(true);
    expect(isWelcomeVisible()).toBe(true);
  });

  it("registers /welcome command for show, hide, and toggle", async () => {
    const commands = new Map<string, any>();
    registerWelcomeCommand({ registerCommand: (name: string, def: any) => commands.set(name, def) } as any);

    const command = commands.get("welcome");
    expect(command).toBeDefined();
    expect(command.description).toContain("welcome header");

    const mockUi = ui();
    await command.handler("off", { ui: mockUi });
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header hidden", "info");

    await command.handler("on", { ui: mockUi });
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(expect.any(Function));
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header shown", "info");

    await command.handler("toggle", { ui: mockUi });
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header hidden", "info");
  });
});
