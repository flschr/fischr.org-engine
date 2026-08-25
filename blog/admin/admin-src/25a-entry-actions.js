import { renameOriginsPath } from "./00-konstanten.js";
import { t } from "./00a-i18n.js";
import { buildDocument } from "./09-frontmatter.js";
import { collections } from "./01-bootstrap.js";
import { prepareRenameOriginChange } from "./01a-rename-origins.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { blobShaMap, getChange } from "./04-drafts.js";
import { deleteChange, putChange } from "./04a-draft-writes.js";
import { requireGithubAccess } from "./05-github-auth.js";
import { baseName } from "./06-paths.js";
import { localIsoWithOffset } from "./08-encoding.js";
import { loadEditorRuntime } from "./16b-runtime-loader.js";
import { syncEditorFromVisible } from "./17-editor.js";
import { captureEditorSnapshot } from "./18-snapshots.js";
import { clearAutosave, docKeyFor } from "./19-recovery.js";
import { askDeleteAction } from "./19a-editor-dialogs.js";
import { fillEditor, rememberEditorInputs, renderEditorMetaLine } from "./20-editor-fields.js";
import { buildEntryPath, collectEditorFields, updateEditorViewTitle } from "./20a-editor-field-actions.js";
import { queueSourcePage } from "./20b-source-pages.js";
import { backToLibrary } from "./23-routing.js";
import { replaceNav } from "./24-history.js";
import { refreshEntries } from "./25-entries.js";
import { resolveFailedMediaForDocument } from "./26c-media-jobs.js";
import { waitForMediaCommits } from "./26e-media-recovery-state.js";

export async function newEntry(forcedCollection) {
  // The dashboard's "New post" always makes a post, regardless of the
  // last-viewed list. Adopt that collection so the editor's sidebar highlight
  // and the library it returns to both match (otherwise a leftover "pages"
  // state would light up Pages while you write a post).
  if (forcedCollection) {
    state.collection = forcedCollection;
    els.libraryTitle.textContent = t(collections[forcedCollection].titleKey);
    els.searchInput.placeholder = t(forcedCollection === "pages" ? "entry.searchPages" : "entry.searchArticles");
  }
  const collection = state.collection === "media" ? "posts" : state.collection;
  const fields = collection === "posts"
    ? { title: "", slug: "", date: localIsoWithOffset(), social_image: "", lang: "de", draft: true }
    : { title: "", permalink: "", lang: "de", draft: false };
  try {
    await loadEditorRuntime();
  } catch (error) {
    showStatus(error.message, "error");
    return;
  }
  fillEditor(fields, [], "", { path: "", collection, local: true, isNew: true, published: false });
  els.titleInput.focus();
}

export async function queueCurrent(mode) {
  if (!state.current || !["posts", "pages"].includes(state.current.collection)) return false;
  if (!requireGithubAccess(mode === "publish" ? t("action.publishing") : t("action.saving"))) return false;

  const collection = state.current.collection;
  if (state.current.sourceMode) {
    if (mode !== "save") return false;
    return queueSourcePage();
  }
  const previousDocKey = docKeyFor(state.current);
  const fields = collectEditorFields();

  if (!fields.title) {
    showStatus("Titel fehlt.", "error");
    els.titleInput.focus();
    return false;
  }

  if (mode === "draft") {
    fields.draft = true;
    els.draftInput.checked = true;
  }
  if (mode === "publish") {
    fields.draft = false;
    els.draftInput.checked = false;
  }

  syncEditorFromVisible();
  renderEditorMetaLine();

  // Media appears in the editor immediately and finishes uploading in the
  // background. A Git save must serialize behind that work so both operations
  // cannot race while advancing the drafts branch.
  await waitForMediaCommits();
  if (!await resolveFailedMediaForDocument(docKeyFor(state.current))) {
    throw new Error("Ein fehlgeschlagenes Medium muss erneut versucht oder entfernt werden.");
  }
  const unresolved = Array.from(state.pendingMediaUploads.values())
    .filter((item) => item.docKey === docKeyFor(state.current));
  if (unresolved.length) throw new Error("Ein eingefügtes Medium ist noch nicht gespeichert. Wiederhole den Upload oder entferne es.");

  const previousPath = state.current.path || "";
  const path = buildEntryPath(fields, collection);
  const content = buildDocument(fields, state.current.preserved || [], state.bodyMarkdown, collection);
  const now = new Date().toISOString();

  const renamed = Boolean(previousPath && previousPath !== path);
  const renameOrigin = renamed && state.current.published
    ? await prepareRenameOriginChange(path, state.current.publishedPath || previousPath, previousPath)
    : null;
  const expectedBlobs = renamed
    ? { [previousPath]: state.current.sha || null, [path]: null }
    : { [path]: state.current.sha || null };
  if (renameOrigin) expectedBlobs[renameOriginsPath] = renameOrigin.expectedSha;
  const savedChange = {
    path,
    kind: "upsert",
    type: "text",
    encoding: "utf-8",
    collection,
    label: fields.title,
    content,
    sha: state.current.sha || "",
    updatedAt: now,
    summary: mode === "publish" ? "Publish" : mode === "draft" ? "Draft" : "Save",
    previousPath,
    additionalEntries: renameOrigin ? [renameOrigin.entry] : [],
    expectedBlobs
  };
  await putChange(savedChange);
  if (renameOrigin) {
    state.renameOrigins = renameOrigin.origins;
    state.renameOriginsLoadedSha = renameOrigin.entry.sha || "";
  }
  state.current.sha = blobShaMap(state.tree).get(path) || savedChange.sha;

  state.current.path = path;
  if (renamed && state.current.published) state.current.publishedPath ||= previousPath;
  state.current.local = true;
  state.current.isNew = false;
  const savedDocKey = docKeyFor(state.current);
  state.mediaUploadItems.forEach((item) => {
    if (item.docKey === previousDocKey) item.docKey = savedDocKey;
  });
  updateEditorViewTitle();
  // The change is committed at this point — mark the editor clean now, so a
  // hiccup in the (best-effort) list refresh below can't leave it "unsaved".
  captureEditorSnapshot();
  rememberEditorInputs();
  renderEditorMetaLine();
  // The save landed in the drafts queue, so the local recovery copy is no
  // longer needed and must not resurface as a stale "restore?" prompt.
  clearAutosave();
  state.autosaveSnapshot = state.savedSnapshot;
  if (state.view === "editor") replaceNav();
  try {
    await refreshEntries(false);
  } catch {
    // The save already landed on drafts; the queue will catch up on the next refresh.
  }
  showStatus(mode === "publish" ? "Veröffentlichen vorgemerkt." : "In GitHub gespeichert.");
  return true;
}

export async function queueEntryDelete() {
  if (!state.current || !["posts", "pages"].includes(state.current.collection)) return false;
  if (!requireGithubAccess(t("action.deleting"))) return false;

  const fields = collectEditorFields();
  const path = state.current.path || (fields.title ? buildEntryPath(fields, state.current.collection) : "");

  if (!path) {
    showStatus("Es wurde noch nichts gespeichert, das gelöscht werden könnte.", "error");
    return false;
  }

  const action = await askDeleteAction();
  if (action !== "delete") return false;

  await waitForMediaCommits();

  const existing = await getChange(path);
  if ((state.current.isNew || !state.current.sha) && existing?.kind === "upsert") {
    await deleteChange(path, existing.sha);
    clearAutosave();
    await refreshEntries(false);
    backToLibrary();
    showStatus("Entwurf entfernt.");
    return true;
  }

  await putChange({
    path,
    kind: "delete",
    type: "delete",
    encoding: "",
    collection: state.current.collection,
    label: fields.title || baseName(path),
    sha: state.current.sha || existing?.sha || "",
    expectedSha: state.current.sha || existing?.sha || null,
    updatedAt: new Date().toISOString(),
    summary: "Delete"
  });

  clearAutosave();
  await refreshEntries(false);
  backToLibrary();
  showStatus("Löschung vorgemerkt.");
  return true;
}
