import { splitDocument } from "./09-frontmatter.js";
import { collections } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { loadChanges } from "./04a-draft-writes.js";
import { fetchTree, hasGithubAccess } from "./05-github-auth.js";
import { baseName, entryInfoFromPath, isSourcePagePath } from "./06-paths.js";
import { escapeHtml } from "./16a-alt-text-actions.js";
import { openEntry } from "./25c-entry-opening.js";
import { loadPublishedPostsIndex } from "./25e-posts-index.js";
import { ensureSearchIndex, entryListEmptyMessage, entrySearchMatch, parseSearchQuery, resetSearchIndex, searchExcerptNode, searchIndexStatus } from "./25d-entry-search.js";
import { refreshMedia } from "./26a-media-library.js";

// --- Entries -------------------------------------------------------------

export async function refreshEntries(force) {
  // Dropped before anything is drawn: the render below asks for what is missing,
  // so a refresh that arrives while a search is open answers with fresh text.
  if (force) { state.postsIndex = null; resetSearchIndex(); }
  if (state.collection === "media") {
    await refreshMedia(force);
    return;
  }
  if (!hasGithubAccess()) {
    const changes = await loadChanges();
    state.entries = changes
      .filter((change) => change.collection === state.collection && change.kind !== "delete")
      .map((change) => ({ path: change.path, title: entryListTitle(change.path, change.label), local: true, kind: change.kind, updatedAt: change.updatedAt, ...entryListMeta(change.path, change) }))
      .sort(collections[state.collection].sort);
    renderEntryList();
    return;
  }
  const collection = collections[state.collection];
  const tree = await fetchTree(force);
  const changes = await loadChanges();
  const deleted = new Set(changes.filter((change) => change.kind === "delete").map((change) => change.path));
  const changeByPath = new Map(
    changes
      .filter((change) => change.collection === state.collection && change.kind !== "delete")
      .map((change) => [change.path, change])
  );
  const localEntries = Array.from(changeByPath.values())
    .map((change) => ({ path: change.path, title: entryListTitle(change.path, change.label), local: true, kind: change.kind, updatedAt: change.updatedAt, ...entryListMeta(change.path, change) }));

  const remoteEntries = tree.tree
    .filter((item) => item.type === "blob")
    .filter((item) => state.collection === "pages"
      ? (item.path.startsWith(`${collection.dir}/`) && item.path.endsWith(".md")) || isSourcePagePath(item.path)
      : item.path.startsWith(`${collection.dir}/`) && item.path.endsWith(".md"))
    .filter((item) => !deleted.has(item.path))
    .map((item) => ({
      path: item.path,
      title: entryListTitle(item.path),
      sha: item.sha,
      local: state.changes.has(item.path),
      ...entryListMeta(item.path, changeByPath.get(item.path))
    }));

  const byPath = new Map(remoteEntries.map((entry) => [entry.path, entry]));
  localEntries.forEach((entry) => byPath.set(entry.path, { ...(byPath.get(entry.path) || {}), ...entry }));
  state.entries = Array.from(byPath.values()).sort(collection.sort);
  renderEntryList();
  attachEntryFrontmatter().catch(() => {});
}

function entryDisplayDate(path) {
  const info = entryInfoFromPath(path);
  return info?.date || "";
}

function entryListTitle(path, label = "") {
  const info = entryInfoFromPath(path);
  if (info?.sourceMode && info.title) return info.title;
  const fallback = String(label || baseName(path).replace(/^\d{4}-\d{2}-\d{2}-/, ""));
  if (info?.collection === "pages") return fallback.charAt(0).toUpperCase() + fallback.slice(1);
  return fallback;
}

// List metadata for an entry. Local edits carry the full document, so we read
// the real date and draft flag from its frontmatter; otherwise we fall back to
// the filename prefix (date) and treat the draft status as unknown.
function entryListMeta(path, change) {
  const info = entryInfoFromPath(path);
  if (change?.type === "text" && change.content) {
    try {
      const fields = splitDocument(change.content).fields;
      const rawDate = String(fields.date || "");
      return {
        date: rawDate.slice(0, 10) || info?.date || "",
        sortKey: Date.parse(rawDate) || info?.sortKey || 0,
        draft: Boolean(fields.draft)
      };
    } catch {
      // Malformed frontmatter — fall back to the filename below.
    }
  }
  return { date: info?.date || "", sortKey: info?.sortKey || 0, draft: false };
}

async function attachEntryFrontmatter() {
  const collection = state.collection;
  if (collection !== "posts") return; // the index currently covers posts only
  const index = await loadPublishedPostsIndex();
  if (!index.size || state.collection !== collection || !state.entries.length) return;

  let changed = false;
  state.entries = state.entries.map((entry) => {
    if (entry.local) return entry; // local edits already carry the real meta
    const meta = index.get(entry.path);
    if (!meta) return entry;
    const title = meta.title || entry.title;
    if (title === entry.title && meta.date === entry.date && meta.sortKey === entry.sortKey && meta.draft === Boolean(entry.draft)) return entry;
    changed = true;
    return { ...entry, title, date: meta.date || entry.date, sortKey: meta.sortKey || entry.sortKey, draft: meta.draft };
  });
  if (!changed) return;
  state.entries.sort(collections[collection].sort);
  renderEntryList();
}

export function renderEntryList() {
  const terms = parseSearchQuery(els.searchInput.value);
  // Asked for once, and only once somebody searches. Every render checks, so a
  // refresh that dropped the payload picks it up again by itself.
  if (terms.length && searchIndexStatus() === "idle") ensureSearchIndex().then(renderEntryList);
  const matches = [];
  for (const entry of state.entries) {
    const result = entrySearchMatch(entry, terms);
    if (result.match) matches.push({ entry, excerpt: result.excerpt });
  }

  els.entryList.innerHTML = "";

  if (!matches.length) {
    const item = document.createElement("li");
    item.className = "entry-empty";
    item.textContent = entryListEmptyMessage(terms, hasGithubAccess());
    els.entryList.append(item);
    return;
  }

  matches.forEach(({ entry, excerpt }) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entry-card";
    if (state.current?.path === entry.path) button.classList.add("is-current");
    if (entry.local) button.classList.add("has-local-change");

    const date = entry.date || entryDisplayDate(entry.path);
    const isDelete = entry.kind === "delete";
    const pills = [
      entry.draft ? `<span class="entry-pill is-draft">Entwurf</span>` : "",
      entry.local ? `<span class="entry-pill${isDelete ? " is-delete" : ""}">${isDelete ? "Löschung vorgemerkt" : "Vorgemerkt"}</span>` : ""
    ].filter(Boolean).join("");
    button.innerHTML = [
      `<span class="entry-title">${escapeHtml(entry.title || baseName(entry.path))}</span>`,
      `<span class="entry-meta">${escapeHtml(date ? `${date} · ` : "")}${escapeHtml(entry.path)}</span>`,
      pills ? `<span class="entry-status">${pills}</span>` : ""
    ].join("");
    if (excerpt) button.append(searchExcerptNode(excerpt)); // nodes, never markup

    button.addEventListener("click", () => openEntry(entry.path));
    item.append(button);
    els.entryList.append(item);
  });
}
