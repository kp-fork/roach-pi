import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, type EditorComponent, type EditorTheme, type TUI } from "@mariozechner/pi-tui";
import {
  clearEditorText,
  defaultEditorStash,
  type EditorStash,
  type EditorTextUi,
  restoreEditorFromStash,
  saveEditorToStash,
} from "./editor-stash.js";

export type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: unknown) => EditorComponent;

export type EditorCompositionUi = Partial<EditorTextUi> & {
  getEditorComponent?: () => EditorFactory | undefined;
  setEditorComponent?: (factory: EditorFactory | undefined) => void;
};

export interface EditorCompositionOptions {
  stash?: EditorStash;
}

const SHORTCUT_SAVE = "\x13"; // Ctrl+S
const SHORTCUT_RESTORE = "\x12"; // Ctrl+R
const SHORTCUT_CLEAR = "\x0b"; // Ctrl+K
const SHORTCUT_SAVE_KEY = "ctrl+s";
const SHORTCUT_RESTORE_KEY = "ctrl+r";
const SHORTCUT_CLEAR_KEY = "ctrl+k";

function renderStatusLine(width: number, stash: EditorStash): string {
  const state = stash.hasValue() ? `stash ${stash.getLength()}c` : "stash empty";
  return truncateToWidth(`╰─ ${state}  ^S save  ^R restore  ^K clear`, Math.max(0, width));
}

function colorBorder(editor: EditorComponent, theme: EditorTheme): void {
  const originalBorderColor = editor.borderColor ?? theme.borderColor;
  editor.borderColor = (text: string) => theme.borderColor(originalBorderColor(text));
}

export function decorateEditor(editor: EditorComponent, ui: EditorTextUi, stash: EditorStash = defaultEditorStash): EditorComponent {
  const originalRender = editor.render.bind(editor);
  editor.render = (width: number) => {
    const lines = originalRender(width);
    return [...lines, renderStatusLine(width, stash)];
  };

  const originalHandleInput = editor.handleInput.bind(editor);
  editor.handleInput = (data: string) => {
    if (matchesKey(data, SHORTCUT_SAVE_KEY)) {
      const text = saveEditorToStash(ui, stash);
      ui.notify?.(`Saved editor stash (${text.length} char${text.length === 1 ? "" : "s"}).`, "info");
      return;
    }
    if (matchesKey(data, SHORTCUT_RESTORE_KEY)) {
      if (!restoreEditorFromStash(ui, stash)) {
        ui.notify?.("No editor stash saved yet.", "warning");
      } else {
        ui.notify?.("Restored editor stash.", "info");
      }
      return;
    }
    if (matchesKey(data, SHORTCUT_CLEAR_KEY)) {
      clearEditorText(ui);
      ui.notify?.("Editor cleared. Use Ctrl+R or /stash-restore to restore stash.", "info");
      return;
    }
    originalHandleInput(data);
  };

  return editor;
}

export function installEditorComposition(ui: EditorCompositionUi, options: EditorCompositionOptions = {}): void {
  if (typeof ui.setEditorComponent !== "function") return;
  if (typeof ui.getEditorText !== "function" || typeof ui.setEditorText !== "function") return;

  const editorUi = ui as EditorTextUi;
  const stash = options.stash ?? defaultEditorStash;
  const previousFactory = ui.getEditorComponent?.();

  ui.setEditorComponent((tui, theme, keybindings) => {
    const editor = previousFactory
      ? previousFactory(tui, theme, keybindings)
      : new CustomEditor(tui, theme, keybindings as any);
    colorBorder(editor, theme);
    return decorateEditor(editor, editorUi, stash);
  });
}

export const editorCompositionShortcuts = {
  save: SHORTCUT_SAVE,
  restore: SHORTCUT_RESTORE,
  clear: SHORTCUT_CLEAR,
} as const;
