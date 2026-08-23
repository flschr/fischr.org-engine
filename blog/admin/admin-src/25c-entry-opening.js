import { repo } from "./00-konstanten.js";
import { splitDocument } from "./09-frontmatter.js";
import { github } from "./01-bootstrap.js";
import { loadRenameOriginsFromDrafts } from "./01a-rename-origins.js";
import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { blobShaMap, fetchMainTree, getAllChanges, getBlobText, getChange } from "./04-drafts.js";
import { encodePath } from "./05-github-auth.js";
import { entryInfoFromPath } from "./06-paths.js";
import { decodeBase64 } from "./08-encoding.js";
import { loadEditorRuntime } from "./16b-runtime-loader.js";
import { fillEditor, renderEditorMetaLine } from "./20-editor-fields.js";
import { collectEditorFields } from "./20a-editor-field-actions.js";
import { openSourceEditor } from "./20b-source-pages.js";
import { updateNav } from "./23-routing.js";
import { renderEntryList } from "./25-entries.js";

export async function openEntry(path) {
  setBusy(true);
  try {
    await loadEditorRuntime();
    const info = entryInfoFromPath(path);
    const localChange = await getChange(path);
    if (localChange && localChange.kind !== "delete" && localChange.type === "text" && localChange.content) {
      if (info?.sourceMode) {
        openSourceEditor(localChange.content, { path, local: true, sha: localChange.sha || "" }, "Version mit vorgemerkten Änderungen geöffnet.");
        return;
      }
      const doc = splitDocument(localChange.content || "");
      const collection = localChange.collection || info?.collection || state.collection;
      state.collection = collection;
      updateNav();
      const publication = await postPublicationOnMain(path, collection, doc.fields);
      fillEditor(doc.fields, doc.preserved, doc.body, {
        path, collection, local: true, sha: localChange.sha || "",
        published: publication.published,
        publishedPath: publication.path
      }, doc.fieldBlocks);
      renderEntryList();
      showStatus("Version mit vorgemerkten Änderungen geöffnet.");
      return;
    }

    const payload = await github(`contents/${encodePath(path)}?ref=${encodeURIComponent(repo.branch)}`);
    const content = decodeBase64(payload.content || "");
    if (info?.sourceMode) {
      openSourceEditor(content, { path, local: false, sha: payload.sha || "" }, "Quelltext geöffnet.");
      return;
    }
    const doc = splitDocument(content);
    const collection = info?.collection || state.collection;
    state.collection = collection;
    updateNav();
    const publication = await postPublicationOnMain(path, collection, doc.fields);
    fillEditor(doc.fields, doc.preserved, doc.body, {
      path, collection, local: false, sha: payload.sha || "",
      published: publication.published,
      publishedPath: publication.path
    }, doc.fieldBlocks);
    renderEntryList();
    showStatus("Geöffnet.");
  } catch (error) {
    showStatus(`Datei konnte nicht geöffnet werden: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function publishedMainPost(path, mainMap) {
  const mainSha = mainMap.get(path);
  if (!mainSha) return null;
  try {
    const fields = splitDocument(await getBlobText(mainSha)).fields;
    if (fields.draft) return null;
    const date = Date.parse(String(fields.date || ""));
    return (!Number.isFinite(date) || date <= Date.now()) ? { path, fields } : null;
  } catch {
    return null;
  }
}

async function postPublicationOnMain(path, collection = "posts") {
  if (!path || collection !== "posts") return { published: false, path: "" };
  const mainMap = blobShaMap(await fetchMainTree(false));
  const direct = await publishedMainPost(path, mainMap);
  if (direct) return { published: true, path: direct.path };

  // Rename origins are recorded when the atomic delete/add is created. Never
  // guess identity from editable article fields such as date, title or slug.
  const originPath = (await loadRenameOriginsFromDrafts())[path];
  if (!originPath) return { published: false, path: "" };
  const deletedPosts = (await getAllChanges()).filter((change) =>
    change.kind === "delete" && change.collection === "posts"
  );
  if (!deletedPosts.some((change) => change.path === originPath)) {
    return { published: false, path: "" };
  }
  const origin = await publishedMainPost(originPath, mainMap);
  return origin ? { published: true, path: origin.path } : { published: false, path: "" };
}

export async function refreshCurrentPublishedState() {
  if (!state.current || state.current.collection !== "posts") return;
  const publication = await postPublicationOnMain(
    state.current.path,
    state.current.collection,
    collectEditorFields()
  );
  state.current.published = publication.published;
  state.current.publishedPath = publication.path;
  renderEditorMetaLine();
}
