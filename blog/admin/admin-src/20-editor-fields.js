import { els } from "./01b-elements.js";
import { fieldLabels, state } from "./01c-state.js";
import { ICON } from "./02-toolbar.js";
import { shouldAutoSlug, slugFromPostPath, syncAutoSlug } from "./06-paths.js";
import { dateInputValueFromIso, formatEditorDate, isoFromDateInputValue, localIsoWithOffset, slugify } from "./08-encoding.js";
import { initSocialPanel } from "./10a-social-editor-ui.js";
import { fillContentType } from "./12-content-type.js";
import { ensureEditor, renderEditorBody } from "./17-editor.js";
import { captureEditorSnapshot } from "./18-snapshots.js";
import { maybeOfferRestore } from "./19-recovery.js";
import { updateEditorViewTitle } from "./20a-editor-field-actions.js";
import { setSourceModeUi } from "./20b-source-pages.js";
import { showView } from "./23-routing.js";
import { pushNav } from "./24-history.js";
import { currentPublishState } from "./25b-publish-actions.js";

// --- Editor fields -------------------------------------------------------

function setFieldVisibility(collection) {
  const isPost = collection === "posts";
  const isPage = collection === "pages";
  fieldLabels.slug.hidden = !isPost;
  fieldLabels.date.hidden = !isPost;
  fieldLabels.permalink.hidden = !isPage;
}

export function resizeTitleInput() {
  els.titleInput.style.height = "auto";
  els.titleInput.style.height = `${Math.max(els.titleInput.scrollHeight, 30)}px`;
}

export function renderEditorMetaLine() {
  if (!state.current) return;
  if (state.current.sourceMode) {
    els.editorMetaLine.textContent = "Quelltext · HTML und Nunjucks werden unverändert gespeichert";
    return;
  }
  const parts = [];
  if (state.current.collection === "posts" && els.dateInput.value) {
    parts.push(formatEditorDate(isoFromDateInputValue(els.dateInput.value)));
  }
  const published = Boolean(state.current.published);
  const draftIntent = els.draftInput.checked;
  const status = published
    ? (draftIntent ? "Zurückziehen vorgemerkt" : "Veröffentlicht")
    : (draftIntent ? "Entwurf" : "Veröffentlichung vorgemerkt");
  parts.push(status);
  els.editorMetaLine.textContent = parts.join(" · ");

  syncPublishButton();
}

// One reading of "is the button there right now", so the shortcut below and
// the write further down can never mean different things by it — they did for
// one commit, when the shortcut still asked about the `hidden` attribute after
// the write had already moved to a class.
function publishButtonShown() {
  return !els.publishButton.classList.contains("is-absent") && !els.publishButton.hidden;
}

// Kept apart from the meta line above because it runs on every keystroke: an
// edit to a published article is what brings the button back, so waiting for
// the next full re-render would leave it missing exactly while it is needed.
//
// `fromKeystroke` is what keeps that cheap. Once the button is up, no further
// typing can take it down — only a save or reloading the article can, and both
// re-render the meta line, which calls this without the flag. So on the
// keystroke path there is nothing left to decide and the document never gets
// serialised again.
export function syncPublishButton({ fromKeystroke = false } = {}) {
  if (!els.publishButton || !state.current) return;
  if (fromKeystroke && publishButtonShown()) return;
  const affordance = currentPublishState();
  // Absent, but still taking up its place. The button comes and goes with the
  // first keystroke, and letting the row re-flow around it would shift every
  // other button sideways under the pointer at exactly the moment the eye is
  // on the text. `visibility` keeps it out of the tab order and out of the
  // accessibility tree just as `hidden` would, without moving its neighbours.
  els.publishButton.classList.toggle("is-absent", !affordance.visible);
  if (!affordance.visible) return;
  els.publishButton.innerHTML = ICON.send;
  els.publishButton.setAttribute("aria-label", affordance.label);
  els.publishButton.title = affordance.label;
}

export function rememberEditorInputs() {
  if (!state.current) return;
  state.current.originalInputs = {
    title: els.titleInput.value,
    slug: els.slugInput.value,
    permalink: els.permalinkInput.value,
    date: els.dateInput.value,
    socialImage: els.socialImageInput.value,
    socialText: els.socialTextInput.value,
    socialTemplate: els.categorySelect.value,
    contentType: els.contentTypeSelect.value,
    reviewItemName: els.reviewItemName.value,
    reviewRating: els.reviewRating.value,
    reviewBest: els.reviewBest.value,
    reviewAuthor: els.reviewAuthor.value,
    reviewSameAs: els.reviewSameAs.value,
    lang: els.langInput.value,
    draft: els.draftInput.checked
  };
}

// Did the user touch any content-type control since the post was opened?
export function contentTypeChanged() {
  return ["contentType", "reviewItemName", "reviewRating", "reviewBest", "reviewAuthor", "reviewSameAs"]
    .some((name) => editorInputChanged(name, name === "contentType"
      ? els.contentTypeSelect.value
      : els[name].value));
}

export function editorInputChanged(name, value) {
  const originalInputs = state.current?.originalInputs || {};
  return originalInputs[name] !== value;
}

export function fillEditor(fields, preserved, body, current, fieldBlocks = {}) {
  const defaults = current.collection === "posts"
    ? { title: "", slug: "", date: localIsoWithOffset(), social_image: "", social_text: "", category: "", syndicate: true, lang: "de", draft: true }
    : { title: "", permalink: "", lang: "de", draft: false };

  const merged = { ...defaults, ...fields };
  state.current = {
    ...current,
    preserved: preserved || [],
    originalFields: { ...fields },
    originalFieldBlocks: { ...fieldBlocks },
    originalInputs: {}
  };
  state.autoSlug = current.collection === "posts" && Boolean(current.isNew);
  state.bodyMarkdown = String(body || "").replace(/\r\n/g, "\n").trimEnd();
  setSourceModeUi(false);
  updateEditorViewTitle();

  els.titleInput.value = merged.title || "";
  els.slugInput.value = current.collection === "posts"
    ? (merged.slug || slugFromPostPath(current.path) || slugify(merged.title || ""))
    : "";
  if (shouldAutoSlug()) syncAutoSlug();
  els.permalinkInput.value = merged.permalink || "";
  els.dateInput.value = dateInputValueFromIso(merged.date || localIsoWithOffset());
  els.socialImageInput.value = merged.social_image || "";
  els.socialTextInput.value = merged.social_text || "";
  state.current.socialSyndicate = merged.syndicate !== false;
  state.current.socialTemplate = merged.social_template || merged.category || "";
  // null = use category default; [] = none; [paths] = explicit selection.
  state.current.socialImages = Array.isArray(merged.social_images) ? merged.social_images.slice() : null;
  fillContentType(merged.schema);
  els.langInput.value = merged.lang || "de";
  els.titleInput.lang = els.langInput.value === "en" ? "en" : "de";
  els.draftInput.checked = Boolean(merged.draft);
  initSocialPanel();

  state.editorMode = "markdown";
  setFieldVisibility(current.collection);
  els.metaPanel.hidden = true;
  els.toggleMetaButton.setAttribute("aria-expanded", "false");

  const editor = ensureEditor();
  if (editor) {
    editor.setMode("markdown", els.langInput.value || "de");
    editor.setValue(state.bodyMarkdown);
  }

  renderEditorBody();
  renderEditorMetaLine();
  rememberEditorInputs();
  captureEditorSnapshot();
  // The freshly loaded doc is the clean baseline; only edits past this point
  // are worth autosaving.
  state.autosaveSnapshot = state.savedSnapshot;
  showView("editor");
  pushNav();
  window.requestAnimationFrame(resizeTitleInput);
  maybeOfferRestore(state.current);
}
