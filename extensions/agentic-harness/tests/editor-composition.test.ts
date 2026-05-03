import { describe, expect, it, vi } from "vitest";
import { visibleWidth, type EditorComponent } from "@mariozechner/pi-tui";

vi.mock("@mariozechner/pi-coding-agent", () => ({
  CustomEditor: class MockCustomEditor {
    borderColor = (text: string) => text;
    handleInput = vi.fn();
    render = vi.fn((width: number) => ["default".slice(0, width)]);
    getText = vi.fn(() => "");
    setText = vi.fn();
  },
}));

import { decorateEditor, editorCompositionShortcuts, installEditorComposition } from "../editor-composition.js";
import { EditorStash } from "../editor-stash.js";

function createEditor(lines: string[] = ["editor"]): EditorComponent {
  return {
    render: vi.fn((width: number) => lines.map((line) => line.slice(0, width))),
    invalidate: vi.fn(),
    getText: vi.fn(() => ""),
    setText: vi.fn(),
    handleInput: vi.fn(),
    borderColor: (text: string) => text,
  };
}

function createUi(text = "") {
  let editorText = text;
  return {
    getEditorText: vi.fn(() => editorText),
    setEditorText: vi.fn((next: string) => { editorText = next; }),
    notify: vi.fn(),
    get text() { return editorText; },
  };
}

const theme = {
  borderColor: (text: string) => `<border>${text}</border>`,
  selectList: {},
} as any;

describe("editor composition", () => {
  it("composes with an existing editor factory from getEditorComponent", () => {
    const existingEditor = createEditor(["existing"]);
    const previousFactory = vi.fn(() => existingEditor);
    const setEditorComponent = vi.fn();
    const ui = {
      ...createUi("hello"),
      getEditorComponent: vi.fn(() => previousFactory),
      setEditorComponent,
    };

    installEditorComposition(ui as any, { stash: new EditorStash() });

    expect(ui.getEditorComponent).toHaveBeenCalledTimes(1);
    expect(setEditorComponent).toHaveBeenCalledWith(expect.any(Function));

    const factory = setEditorComponent.mock.calls[0][0];
    const decorated = factory({} as any, theme, {} as any);

    expect(previousFactory).toHaveBeenCalledTimes(1);
    expect(decorated).toBe(existingEditor);
    expect(decorated.render(80).join("\n")).toContain("stash empty");
  });

  it("falls back to CustomEditor when no previous factory exists", () => {
    const setEditorComponent = vi.fn();
    const ui = {
      ...createUi(),
      getEditorComponent: vi.fn(() => undefined),
      setEditorComponent,
    };

    installEditorComposition(ui as any, { stash: new EditorStash() });
    const factory = setEditorComponent.mock.calls[0][0];
    const editor = factory({} as any, theme, {} as any);

    expect(editor.render(80).join("\n")).toContain("default");
    expect(editor.render(80).join("\n")).toContain("stash empty");
  });

  it("keeps the appended status line width-safe", () => {
    const stash = new EditorStash();
    stash.save("x".repeat(100));
    const decorated = decorateEditor(createEditor(["abc"]), createUi() as any, stash);

    for (const width of [10, 20, 80]) {
      for (const line of decorated.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("stash shortcuts call the command-tested stash operations", () => {
    const stash = new EditorStash();
    const ui = createUi("saved text");
    const editor = decorateEditor(createEditor(), ui as any, stash);

    editor.handleInput(editorCompositionShortcuts.save);
    expect(stash.get()).toBe("saved text");

    editor.handleInput(editorCompositionShortcuts.clear);
    expect(ui.text).toBe("");

    editor.handleInput(editorCompositionShortcuts.restore);
    expect(ui.text).toBe("saved text");
  });

  it("matches encoded terminal shortcuts for stash operations", () => {
    const stash = new EditorStash();
    const ui = createUi("saved text");
    const editor = decorateEditor(createEditor(), ui as any, stash);

    editor.handleInput("\x1b[115;5u");
    expect(stash.get()).toBe("saved text");

    editor.handleInput("\x1b[27;5;107~");
    expect(ui.text).toBe("");

    editor.handleInput("\x1b[114;5u");
    expect(ui.text).toBe("saved text");
  });

  it("passes through unhandled input to the previous editor", () => {
    const base = createEditor();
    const originalHandleInput = base.handleInput;
    const editor = decorateEditor(base, createUi() as any, new EditorStash());

    editor.handleInput("a");

    expect(originalHandleInput).toHaveBeenCalledWith("a");
  });
});
