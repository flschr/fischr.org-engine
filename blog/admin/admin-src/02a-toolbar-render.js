import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { FORMAT_COMMANDS, icon } from "./02-toolbar.js";
import { showStatus } from "./03-status.js";
import { ensureEditor, setEditorMode, syncEditorFromVisible } from "./17-editor.js";

export function renderFormatToolbar() {
  els.formatToolbar.innerHTML = "";
  FORMAT_COMMANDS.forEach((command) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tb-button";
    button.dataset.command = command.name;
    button.title = command.title;
    button.setAttribute("aria-label", command.title);
    button.innerHTML = icon(command.icon);
    // Formatting controls must not steal the browser selection from either
    // CodeMirror or the inline footnote editor before the click command runs.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", async () => {
      if (state.isBusy) return;
      if (state.editorMode === "preview") setEditorMode("markdown");
      const editor = ensureEditor();
      if (!editor) return;
      try {
        await command.run(editor);
        syncEditorFromVisible();
      } catch (error) {
        showStatus(`Aktion fehlgeschlagen: ${error.message}`, "error");
      }
    });
    els.formatToolbar.append(button);
  });
}
