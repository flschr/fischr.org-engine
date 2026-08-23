import { imageExtensions, videoExtensions } from "./00-konstanten.js";
import { collections } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { slugify } from "./08-encoding.js";
import { primaryMediaReference } from "./15a-media-reference-index.js";

// --- Path helpers --------------------------------------------------------

export function isSourcePagePath(path) {
  return RWSourcePages.has(path);
}

export function isEntryPath(path) {
  return /^(?:blog\/posts|blog\/pages)\/.+\.md$/.test(String(path || "")) || isSourcePagePath(path);
}

export function fileName(path) {
  return path.split("/").pop() || path;
}

export function baseName(path) {
  return fileName(path).replace(/\.[^.]+$/, "");
}

export function extension(path) {
  return (path.split(".").pop() || "").toLowerCase();
}

export function entryInfoFromPath(path) {
  const sourcePage = RWSourcePages.get(path);
  if (sourcePage) {
    return {
      collection: "pages",
      date: "",
      path,
      slug: sourcePage.slug,
      sortKey: 0,
      title: sourcePage.title,
      sourceMode: true
    };
  }
  const post = String(path || "").match(/^blog\/posts\/(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  if (post) {
    return {
      collection: "posts",
      date: post[1],
      path,
      slug: post[2],
      sortKey: Date.parse(`${post[1]}T00:00:00Z`) || 0,
      title: post[2]
    };
  }
  const page = String(path || "").match(/^blog\/pages\/(.+)\.md$/);
  if (page) {
    return { collection: "pages", date: "", path, slug: page[1], sortKey: 0, title: page[1] };
  }
  return null;
}

export function buildEntryLookup(treeItems = []) {
  const lookup = new Map();
  treeItems
    .filter((item) => item.type === "blob")
    .map((item) => entryInfoFromPath(item.path))
    .filter(Boolean)
    .forEach((entry) => lookup.set(entry.slug, entry));
  return lookup;
}

export function referencedEntryFromMediaPath(path, lookup = state.entryLookup) {
  const imported = String(path || "").match(/^blog\/assets\/(?:images|videos)\/imported\/([^/]+)/);
  if (!imported) return null;
  return lookup.get(imported[1]) || null;
}

export function mediaDateSortValue(path) {
  const text = String(path || "");
  const timestamp = text.match(/(20\d{2})(\d{2})(\d{2})[t_-]?(\d{2})(\d{2})(\d{2})/i);
  if (timestamp) {
    return Date.UTC(Number(timestamp[1]), Number(timestamp[2]) - 1, Number(timestamp[3]), Number(timestamp[4] || 0), Number(timestamp[5] || 0), Number(timestamp[6] || 0));
  }
  const dashed = text.match(/(20\d{2})-(\d{2})-(\d{2})(?:[t_](\d{2})(\d{2})(\d{2})?)?/i);
  if (dashed) {
    return Date.UTC(Number(dashed[1]), Number(dashed[2]) - 1, Number(dashed[3]), Number(dashed[4] || 0), Number(dashed[5] || 0), Number(dashed[6] || 0));
  }
  const compact = text.match(/(20\d{2})(\d{2})(\d{2})/i);
  if (compact) {
    return Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]));
  }
  return 0;
}

// Sort value for a media item: the date of the article it is linked in (its
// post date) if known, otherwise the upload date. Both live on one timeline,
// newest first. Falling back to the upload date means a fresh upload still
// shows near the top before the reference index has linked it to its post.
function mediaSortValue(item) {
  return primaryMediaReference(item)?.sortKey || item.entrySort || item.uploadSort || 0;
}

export function mediaSort(a, b) {
  const diff = mediaSortValue(b) - mediaSortValue(a);
  if (diff) return diff;
  const aReference = primaryMediaReference(a);
  const bReference = primaryMediaReference(b);
  if (aReference && bReference && aReference.path === bReference.path) {
    const orderDiff = (aReference.orderInEntry || 0) - (bReference.orderInEntry || 0);
    if (orderDiff) return orderDiff;
  }
  return b.path.localeCompare(a.path);
}

export function isImagePath(path) {
  return imageExtensions.has(extension(path));
}

export function isVideoPath(path) {
  return videoExtensions.has(extension(path));
}

export function isGpxPath(path) {
  return extension(path) === "gpx";
}

export function isMediaPath(path) {
  return isImagePath(path) || isVideoPath(path);
}

export function isVideoPosterPath(path) {
  return String(path || "").startsWith(`${collections.media.dir}/video-posters/`);
}

// Build output, never a source file: responsive variants are derived from an original during
// the build and only exist in _site and R2, but carry manifest entries like any other object.
function isGeneratedMediaVariantPath(path) {
  return String(path || "").startsWith(`${collections.media.dir}/responsive/`);
}

export function isRepositoryMediaPath(path) {
  const value = String(path || "");
  return value.startsWith(`${collections.media.dir}/`) || value.startsWith(`${collections.media.videoDir}/`);
}

export function isMediaLibraryPath(path) {
  return isMediaPath(path) && !isVideoPosterPath(path) && !isGeneratedMediaVariantPath(path);
}

export function publicImagePath(path) {
  if (path.startsWith("/")) return path;
  if (path.startsWith("blog/assets/images/")) return path.replace(/^blog\/assets\/images/, "/assets/images");
  if (path.startsWith("assets/images/")) return `/${path}`;
  if (/^https?:\/\//i.test(path)) return path;
  return `/assets/images/${path.replace(/^\/+/, "")}`;
}

function publicVideoPath(path) {
  if (path.startsWith("/")) return path;
  if (path.startsWith("blog/assets/videos/")) return path.replace(/^blog\/assets\/videos/, "/assets/videos");
  if (path.startsWith("assets/videos/")) return `/${path}`;
  if (/^https?:\/\//i.test(path)) return path;
  return `/assets/videos/${path.replace(/^\/+/, "")}`;
}

export function publicMediaPath(path) {
  if (path.startsWith("blog/assets/files/gpx/")) return path.replace(/^blog\/assets\/files/, "/assets/files");
  if (path.startsWith("assets/files/gpx/")) return `/${path}`;
  return isVideoPath(path) ? publicVideoPath(path) : publicImagePath(path);
}

// Hier stand eine Vorhersage der Auslieferungsadresse eines frisch hochgeladenen Bildes. Sie
// ist entfallen: Seit die Adresse aus dem Inhalt entsteht, lässt sie sich vor dem Hochladen
// nicht mehr kennen. Eingefügt wird der lokale /assets/…-Pfad wie bei Mediathek und Video.
// Warum das keine Notlösung ist, steht in docs/architecture.md unter "Media boundary (R2)".

export function videoPosterPath(path) {
  return `/assets/images/video-posters/${baseName(path)}.webp`;
}

export function currentEntrySlug() {
  const path = state.current?.path || "";
  return baseName(path).replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

export function slugFromPostPath(path) {
  return baseName(path).replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

export function shouldAutoSlug() {
  return state.current?.collection === "posts" && state.autoSlug;
}

function slugFromTitleInput() {
  const title = els.titleInput.value.trim();
  return title ? slugify(title) : "";
}

export function syncAutoSlug() {
  if (!shouldAutoSlug()) return;
  els.slugInput.value = slugFromTitleInput();
}
