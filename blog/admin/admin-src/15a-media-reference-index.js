import { state } from "./01c-state.js";
import { extension, isVideoPosterPath, publicMediaPath } from "./06-paths.js";
import { stripMarkdownUrl } from "./09-frontmatter.js";
import { entryReferenceFromContent, extractMediaReferences } from "./15-media-references.js";
import { loadPublishedPostsIndex } from "./25e-posts-index.js";

function addMediaReference(index, publicPath, reference) {
  if (!publicPath || !reference?.path) return;
  if (!index.has(publicPath)) index.set(publicPath, new Map());
  index.get(publicPath).set(reference.path, reference);
}

function addMediaReferencesFromEntry(index, path, content) {
  const entryReference = entryReferenceFromContent(path, content);
  if (!entryReference) return;
  extractMediaReferences(content).forEach((mediaReference) => {
    addMediaReference(index, mediaReference.publicPath, {
      ...entryReference,
      orderInEntry: mediaReference.orderInEntry,
      alt: mediaReference.alt || ""
    });
  });
}

// Which post uses which image: built from the build-time index for published
// posts (one request — the build already extracted each post's images) and
// from the queued content for the few pending edits. No per-post scan.
export async function refreshMediaReferenceIndex(tree, changes = []) {
  const indexData = await loadPublishedPostsIndex();
  const pendingEntries = changes.filter((change) => ["posts", "pages"].includes(change.collection));
  const signature = `${indexData.size}::${pendingEntries.map((change) => `${change.path}:${change.kind}:${change.sha || ""}`).sort().join("|")}`;
  if (state.mediaReferenceSignature === signature) return state.mediaReferenceIndex;

  const request = ++state.mediaReferenceRequest;
  const index = new Map();
  const pendingPaths = new Set(pendingEntries.map((change) => change.path));

  for (const [path, meta] of indexData) {
    if (pendingPaths.has(path)) continue; // a pending edit overrides its index entry
    const reference = { path, title: meta.title, sortKey: meta.sortKey, publicPath: meta.url || "", collection: "posts" };
    (meta.media || []).forEach((media, order) => {
      addMediaReference(index, media.url, { ...reference, orderInEntry: order, alt: media.alt || "" });
    });
  }
  for (const change of pendingEntries) {
    if (change.kind === "delete") continue;
    addMediaReferencesFromEntry(index, change.path, change.content || "");
  }

  if (request !== state.mediaReferenceRequest) return state.mediaReferenceIndex;
  state.mediaReferenceSignature = signature;
  state.mediaReferenceIndex = index;
  return index;
}

export function mediaReferencesForItem(item, referenceIndex = state.mediaReferenceIndex) {
  const publicPath = item.publicPath || publicMediaPath(item.path || "");
  const references = Array.from(referenceIndex.get(publicPath)?.values() || []);
  return references.sort((a, b) => {
    const sortDiff = (b.sortKey || 0) - (a.sortKey || 0);
    if (sortDiff) return sortDiff;
    if (a.path === b.path) return (a.orderInEntry || 0) - (b.orderInEntry || 0);
    return String(a.title || a.path).localeCompare(String(b.title || b.path), "de", { sensitivity: "base" });
  });
}

export function primaryMediaReference(item) {
  return item?.references?.[0] || null;
}

// A queued media upload is "orphaned" when no post/page (published or pending)
// references it. Uploads commit to drafts the moment they're inserted, so one
// that never lands in a saved article lingers in the queue on its own. Both
// sides normalize to the /assets/... public path, so a Map lookup is enough.
function mediaChangeIsReferenced(change) {
  const publicPath = change.publicPath || publicMediaPath(change.path);
  return state.mediaReferenceIndex.has(publicPath);
}

export function isOrphanMediaChange(change) {
  return change.collection === "media"
    && change.kind !== "delete"
    && !isVideoPosterPath(change.path)
    && !mediaChangeIsReferenced(change);
}

export function orphanMediaChanges() {
  return Array.from(state.changes.values()).filter(isOrphanMediaChange);
}

export function mediaSearchText(item) {
  return [
    item.path,
    item.publicPath,
    item.name,
    ...(item.references || []).flatMap((reference) => [reference.title, reference.path, reference.publicPath, reference.alt])
  ].filter(Boolean).join(" ").toLowerCase();
}

// The same image can be described differently in each post that uses it, and
// most images carry no alt at all. Show the descriptions that exist, once each.
export function mediaAltTexts(item) {
  const texts = [];
  (item?.references || []).forEach((reference) => {
    const alt = String(reference.alt || "").trim();
    if (alt && !texts.includes(alt)) texts.push(alt);
  });
  return texts;
}

export const { findHtmlMedia, findMarkdownImages, findMediaShortcuts, visibleMarkdownSource, markdownAltHasText, escapeMarkdownAlt, imageMimeType } = RWMarkdownMedia.create({
  stripMarkdownUrl,
  extension
});

// Welche Medien ein Eintrag benennt — als Karte über die Warteschlange.
//
// Der Referenz-Index oben beantwortet die andere Richtung (welcher Artikel benutzt dieses Bild)
// und stützt sich dafür auf den Bau-Index für alles Veröffentlichte. Für die Auswahl in der
// Warteschlange zählt nur, was in der *anstehenden* Fassung steht: Ein Bild, das der Artikel
// gerade verloren hat, muss nicht mitreisen, und eines, das er gerade bekommen hat, sehr wohl.
// Beides steht im Inhalt, den die Warteschlange ohnehin geladen hat.
export function medienJeAenderung(changes = []) {
  const karte = new Map();
  changes.forEach((change) => {
    if (change.collection === "media" || !change.content) return;
    karte.set(change.path, extractMediaReferences(change.content).map((referenz) => referenz.publicPath));
  });
  return karte;
}
