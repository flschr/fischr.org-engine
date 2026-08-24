import { t } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { getChange } from "./04-drafts.js";
import { deleteChange, putChange } from "./04a-draft-writes.js";
import { requireGithubAccess } from "./05-github-auth.js";
import { mediaAltTexts } from "./15a-media-reference-index.js";
import { refreshMedia } from "./26a-media-library.js";
import { commitMediaManifestDelete } from "./26a2-media-manifest-writes.js";
import { renderMedia } from "./26b-media-render.js";
import { queueVideoDelete } from "./26c-video-derivatives.js";
import { guardMediaIdle } from "./26d-publish-sync.js";
import { waitForMediaCommits } from "./26e-media-recovery-state.js";

export function mediaMetaText(item, isPendingDelete = false) {
  const hasPendingChange = item.pending || isPendingDelete;
  return [
    item.entryDate || "",
    item.references?.length ? `${item.references.length}x verwendet` : "",
    formatBytes(item.size),
    item.mediaKind === "video" ? "Video" : "",
    item.duplicate ? "Duplikat" : "",
    isPendingDelete ? "Vorgemerkt: Löschen" : hasPendingChange ? "Vorgemerkt" : ""
  ].filter(Boolean).join(" · ");
}

export function mediaReferencesSignature(item) {
  return JSON.stringify((item.references || []).map((reference) => [
    reference.path || "",
    reference.title || "",
    reference.publicPath || "",
    reference.orderInEntry || 0,
    reference.alt || ""
  ]));
}

// The alt text is what a search for it matched, so the card has to show it —
// otherwise a hit on an image whose filename says nothing looks like a bug.
export function renderMediaAlt(item) {
  const texts = mediaAltTexts(item);
  if (!texts.length) return null;

  const line = document.createElement("div");
  line.className = "media-alt";
  line.textContent = texts.join(" · ");
  line.title = texts.join("\n");
  return line;
}

// Reference discovery can change labels and ordering, but not the media cards
// themselves. Keep their image/video elements alive so the browser does not
// restart decoding or metadata work after the background index completes.
export function refreshRenderedMediaMetadata() {
  const query = els.mediaSearchInput.value.trim().toLowerCase();
  if (query) {
    // References are part of the searchable text, so they may add/remove
    // matches. A filtered result therefore still needs a full reconciliation.
    renderMedia();
    return;
  }

  const filter = els.mediaFilterInput.value;
  const pendingDeletes = new Set(
    Array.from(state.changes.values())
      .filter((change) => change.collection === "media" && change.kind === "delete")
      .map((change) => change.path)
  );
  const picking = Boolean(state.socialImagePick);
  const cards = new Map(
    Array.from(els.mediaGrid.querySelectorAll(".media-item[data-media-path]"))
      .map((card) => [card.dataset.mediaPath, card])
  );
  const visibleItems = state.media.filter((item) => {
    if (picking && item.mediaKind === "video") return false;
    if (filter === "duplicates" && !item.duplicate) return false;
    if (filter === "pending" && !(item.pending || pendingDeletes.has(item.path))) return false;
    return true;
  });
  if (visibleItems.length !== cards.size || visibleItems.some((item) => !cards.has(item.path))) {
    renderMedia();
    return;
  }

  let insertionPoint = els.mediaGrid.firstElementChild;
  visibleItems.forEach((item) => {
    const card = cards.get(item.path);
    const nextSignature = mediaReferencesSignature(item);
    if (card.dataset.mediaReferences !== nextSignature) {
      const info = card.querySelector(".media-info");
      const meta = info?.querySelector(".entry-meta");
      if (meta) meta.textContent = mediaMetaText(item, pendingDeletes.has(item.path));
      info?.querySelector(".media-alt")?.remove();
      info?.querySelector(".media-references")?.remove();
      const alt = renderMediaAlt(item);
      const references = renderMediaReferences(item.references || []);
      const tail = info?.querySelector(".media-actions") || null;
      if (alt && info) info.insertBefore(alt, tail);
      if (references && info) info.insertBefore(references, tail);
      card.dataset.mediaReferences = nextSignature;
    }
    if (card !== insertionPoint) els.mediaGrid.insertBefore(card, insertionPoint);
    insertionPoint = card.nextElementSibling;
  });
}

export function renderMediaReferences(references) {
  if (!references.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "media-references";

  const title = document.createElement("div");
  title.className = "media-reference-title";
  title.textContent = references.length === 1 ? t("media.usedIn") : t("media.usedInCount", { count: references.length });

  const list = document.createElement("div");
  list.className = "media-reference-list";

  references.forEach((reference) => {
    const item = document.createElement(reference.publicPath ? "a" : "span");
    item.className = "media-reference-link";
    item.textContent = reference.title || reference.path;
    item.title = reference.path;
    if (reference.publicPath) item.href = reference.publicPath;
    list.append(item);
  });

  wrap.append(title, list);
  return wrap;
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export async function queueMediaDelete(item) {
  if (!requireGithubAccess(t("action.deletingMedia"))) return;

  await waitForMediaCommits();
  if (!guardMediaIdle(t("action.deleting"))) return;

  const existing = await getChange(item.path);
  if (item.mediaKind === "video") {
    await queueVideoDelete(item, existing);
    showStatus(existing?.kind === "upsert" ? "Upload entfernt." : "Löschung vorgemerkt.");
    await refreshMedia(false);
    return;
  }
  if (existing && existing.kind === "upsert") {
    await deleteChange(item.path, existing.sha);
    showStatus("Upload entfernt.");
  } else if (item.sha) {
    await putChange({
      path: item.path,
      kind: "delete",
      type: "delete",
      encoding: "",
      collection: "media",
      label: item.name,
      publicPath: item.publicPath,
      expectedSha: item.sha || null,
      updatedAt: new Date().toISOString(),
      summary: "Delete"
    });
    showStatus("Löschung vorgemerkt.");
  } else if (await commitMediaManifestDelete(item)) {
    // No blob anywhere: the file lives in R2 and its manifest entry is the thing that gets
    // removed. It leaves the gallery immediately and travels to main with the next publish,
    // which carries automation/media-manifest.json as a managed path.
    showStatus("Löschung vorgemerkt.");
  } else {
    throw new Error(`${item.name} liegt weder im Repository noch im Medien-Manifest.`);
  }
  await refreshMedia(false);
}
