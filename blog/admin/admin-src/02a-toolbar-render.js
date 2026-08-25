import { t } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { MORE_COMMANDS, PRIMARY_COMMANDS, icon } from "./02-toolbar.js";
import { showStatus } from "./03-status.js";
import { ensureEditor, setEditorMode, syncEditorFromVisible } from "./17-editor.js";

// Runs a toolbar command against the editor. Shared by the bar and the "+"
// sheet so a command behaves identically wherever it was reached from.
async function runCommand(command) {
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
}

function commandButton(command, { className, withLabel = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.command = command.name;
  button.title = t(command.titleKey);
  button.setAttribute("aria-label", t(command.titleKey));
  button.dataset.i18nTitle = command.titleKey;
  button.dataset.i18nAria = command.titleKey;
  button.innerHTML = icon(command.icon);
  if (withLabel) {
    const label = document.createElement("span");
    label.className = "tb-sheet-label";
    label.textContent = t(command.titleKey);
    label.dataset.i18n = command.titleKey;
    button.append(label);
  }
  // Formatting controls must not steal the browser selection from either
  // CodeMirror or the inline footnote editor before the click command runs.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  return button;
}

export function closeMoreCommands() {
  if (els.moreCommandsDialog?.open) els.moreCommandsDialog.close();
}

function openMoreCommands() {
  if (!els.moreCommandsDialog) return;
  els.moreCommandsDialog.showModal();
}

export function renderFormatToolbar() {
  els.formatToolbar.innerHTML = "";
  PRIMARY_COMMANDS.forEach((command) => {
    const button = commandButton(command, { className: "tb-btn" });
    button.addEventListener("click", () => runCommand(command));
    els.formatToolbar.append(button);
  });

  const more = document.createElement("button");
  more.type = "button";
  more.className = "tb-btn tb-more";
  more.dataset.command = "more";
  more.title = t("dialog.moreInsertions");
  more.setAttribute("aria-label", t("dialog.moreInsertions"));
  more.dataset.i18nTitle = "dialog.moreInsertions";
  more.dataset.i18nAria = "dialog.moreInsertions";
  more.setAttribute("aria-haspopup", "dialog");
  more.innerHTML = icon("plus");
  more.addEventListener("mousedown", (event) => event.preventDefault());
  more.addEventListener("click", openMoreCommands);
  els.formatToolbar.append(more);

  renderMoreCommandsSheet();
}

function renderMoreCommandsSheet() {
  if (!els.moreCommandsList) return;
  els.moreCommandsList.innerHTML = "";
  MORE_COMMANDS.forEach((command) => {
    const button = commandButton(command, { className: "tb-sheet-button", withLabel: true });
    button.addEventListener("click", async () => {
      // Close first: several commands open a dialog of their own, and two
      // stacked <dialog>s leave the sheet's backdrop over the new one.
      closeMoreCommands();
      await runCommand(command);
    });
    els.moreCommandsList.append(button);
  });
}
