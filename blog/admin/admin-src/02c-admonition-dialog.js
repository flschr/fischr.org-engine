import { ensureEditor } from "./17-editor.js";

export async function insertAdmonitionFromDialog(editor = ensureEditor()) {
  if (!editor) return;
  // Read once and reuse: the dialog pre-fills Titel from it (so a selection
  // makes the dialog confirmable without typing anything), and the same text
  // becomes the admonition body — both need to agree on what was selected at
  // the moment the button was pressed, not re-read it separately later after
  // focus has moved into the dialog's own fields.
  const selectedText = editor.getSelectedText?.() || "";
  const options = await askAdmonitionOptions(selectedText);
  if (!options) {
    editor.focus();
    return;
  }

  const markdown = window.RWAdmonitions.buildAdmonitionMarkdown({
    ...options,
    body: selectedText
  });
  editor.insertText(markdown, { block: true });
}

function askAdmonitionOptions(selectedText = "") {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog link-dialog";
    const form = document.createElement("form");
    form.method = "dialog";

    const heading = document.createElement("h2");
    heading.textContent = "Hinweis einfügen";

    const typeLabel = document.createElement("label");
    typeLabel.className = "dialog-field";
    const typeText = document.createElement("span");
    typeText.textContent = "Typ";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Typ");
    for (const { marker, cmsLabel } of window.RWAdmonitions.types) {
      const option = document.createElement("option");
      option.value = marker;
      option.textContent = cmsLabel;
      select.append(option);
    }
    typeLabel.append(typeText, select);

    const titleLabel = document.createElement("label");
    titleLabel.className = "dialog-field";
    const titleText = document.createElement("span");
    titleText.textContent = "Titel";
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("aria-label", "Titel");
    input.placeholder = "Gut zu wissen";
    input.required = true;
    // A selection already has to be turned into a single line for the title
    // field regardless — collapse newlines/whitespace the same way here.
    if (selectedText.trim()) input.value = selectedText.trim().replace(/\s+/g, " ");
    titleLabel.append(titleText, input);

    const menu = document.createElement("menu");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost";
    cancel.textContent = "Abbrechen";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary-action";
    submit.textContent = "Einfügen";
    menu.append(cancel, submit);

    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      finish({ type: select.value, title });
    });

    form.append(heading, typeLabel, titleLabel, menu);
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
