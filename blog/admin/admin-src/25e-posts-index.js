import { state } from "./01c-state.js";

// The posts index the build writes for the admin: real titles, dates, draft
// flags and media references for everything on the branch, as one small
// auth-protected JSON. Without it the list would need a GitHub blob fetch per
// post, and the media gallery a second one for every reference.

// The build emits each media reference as { url, alt }. An older index — or one
// still in a cache — carries bare path strings; both read as a reference without
// an alt text.
function normalizeIndexMedia(media) {
  if (!Array.isArray(media)) return [];
  return media
    .map((entry) => (typeof entry === "string"
      ? { url: entry, alt: "" }
      : { url: String(entry?.url || ""), alt: String(entry?.alt || "") }))
    .filter((entry) => entry.url);
}

// Real title + date + draft flag for remote posts live in their frontmatter.
// The build emits them all as one small auth-protected JSON, so the list can
// look them up in a single request instead of one GitHub blob fetch per post.
export async function loadPublishedPostsIndex() {
  if (state.postsIndex) return state.postsIndex;
  if (state.postsIndexPromise) return state.postsIndexPromise;
  state.postsIndexPromise = (async () => {
    try {
      const response = await fetch("/admin/posts-index.json", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Index ${response.status}`);
      const list = await response.json();
      const map = new Map();
      list.forEach((item) => {
        const path = String(item.path || "").replace(/^\.\//, "");
        if (!path) return;
        const iso = String(item.date || "");
        map.set(path, {
          title: String(item.title || ""),
          url: String(item.url || ""),
          date: iso.slice(0, 10),
          sortKey: Date.parse(iso) || 0,
          draft: Boolean(item.draft),
          media: normalizeIndexMedia(item.media)
        });
      });
      state.postsIndex = map;
      return map;
    } catch {
      return new Map();
    } finally {
      state.postsIndexPromise = null;
    }
  })();
  return state.postsIndexPromise;
}
