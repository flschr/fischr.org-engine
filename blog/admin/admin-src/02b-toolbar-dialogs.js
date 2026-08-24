import { t } from "./00a-i18n.js";
import { ensureEditor } from "./17-editor.js";

export async function insertLinkFromDialog(editor = ensureEditor()) {
  if (!editor) return;
  const href = await askLinkHref(editor);
  if (!href) {
    editor.focus();
    return;
  }
  editor.insertLink(href);
}

export async function insertFootnoteFromDialog(editor = ensureEditor()) {
  if (!editor) return;
  const text = await askFootnoteText(editor);
  if (!text) {
    editor.focus();
    return;
  }
  editor.insertFootnote(text);
}

function askLinkHref(editor) {
  return new Promise((resolve) => {
    const selected = String(editor?.getSelectedText?.() || "").trim();
    const fallback = /^https?:\/\//i.test(selected) ? selected : "";
    const dialog = document.createElement("dialog");
    dialog.className = "dialog link-dialog";

    const form = document.createElement("form");
    form.method = "dialog";

    const heading = document.createElement("h2");
    heading.textContent = t("link.title");

    const label = document.createElement("label");
    label.className = "dialog-field";

    const labelText = document.createElement("span");
    labelText.textContent = t("link.address");

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "url";
    // iOS shows an "Autofill" accessory bar for autocomplete="url"
    // that overlaps this modal and swallows taps/typing. Disable autofill and
    // the other text assists — a URL field doesn't want any of them.
    input.autocomplete = "off";
    input.autocapitalize = "none";
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
    input.placeholder = "https://example.com";
    input.value = fallback;

    const menu = document.createElement("menu");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost";
    cancel.textContent = t("common.cancel");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary-action";
    submit.textContent = t("common.insert");

    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      dialog.close();
      dialog.remove();
      resolve(String(value || "").trim());
    };

    cancel.addEventListener("click", () => finish(""));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish("");
    });

    label.append(labelText, input);
    menu.append(cancel, submit);
    form.append(heading, label, menu);
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}

function askFootnoteText(editor) {
  return new Promise((resolve) => {
    const selected = String(editor?.getSelectedText?.() || "").trim();
    const dialog = document.createElement("dialog");
    dialog.className = "dialog link-dialog";

    const form = document.createElement("form");
    form.method = "dialog";

    const heading = document.createElement("h2");
    heading.textContent = t("footnote.title");

    const label = document.createElement("label");
    label.className = "dialog-field";

    const labelText = document.createElement("span");
    labelText.textContent = t("footnote.text");

    const input = document.createElement("textarea");
    input.rows = 4;
    input.placeholder = t("footnote.text");
    input.value = selected;

    const menu = document.createElement("menu");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost";
    cancel.textContent = t("common.cancel");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary-action";
    submit.textContent = t("common.insert");

    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      dialog.close();
      dialog.remove();
      resolve(String(value || "").trim());
    };

    cancel.addEventListener("click", () => finish(""));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish("");
    });

    label.append(labelText, input);
    menu.append(cancel, submit);
    form.append(heading, label, menu);
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
