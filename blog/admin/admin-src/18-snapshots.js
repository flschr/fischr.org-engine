import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { SOCIAL_OFF } from "./10-social-editor.js";
import { collectSchema } from "./12-content-type.js";

// --- Snapshots / dirty ---------------------------------------------------

export function editorSnapshot() {
  return JSON.stringify({
    current: state.current
      ? { path: state.current.path || "", collection: state.current.collection || "", isNew: Boolean(state.current.isNew), sourceMode: Boolean(state.current.sourceMode) }
      : null,
    fields: {
      title: els.titleInput.value,
      slug: els.slugInput.value,
      permalink: els.permalinkInput.value,
      date: els.dateInput.value,
      socialImage: els.socialImageInput.value,
      socialText: els.socialTextInput.value,
      socialTemplate: els.categorySelect.value,
      socialImages: JSON.stringify(state.current?.socialImages ?? null),
      socialSyndicate: els.categorySelect.value !== SOCIAL_OFF,
      schema: JSON.stringify(collectSchema()),
      lang: els.langInput.value,
      draft: els.draftInput.checked
    },
    body: state.bodyMarkdown || ""
  });
}

export function captureEditorSnapshot() {
  state.savedSnapshot = editorSnapshot();
}
