import { state } from "./01c-state.js";
import { isSourcePagePath } from "./06-paths.js";

const { documentText, excerpt, matchesAll, normalize, parseQuery } = RWSearchText;

// Full-text search over the article and page list.
//
// Title and path are matched from what the list already holds, so typing is
// answered without a request. Content comes from /admin/posts-search.json — one
// auth-protected payload the build writes from the same sources the editor opens.
// It is fetched at most once per admin load, and only when someone actually
// searches; the list itself never waits for it.
//
// Pending edits win over the index: an unsaved change carries its full document
// in the queue, so its text is derived in the browser with the very same
// derivation the build used. A queued post that was never published is therefore
// searchable too, and a queued rewrite is searched as it now reads.

const searchIndexUrl = "/admin/posts-search.json";

export function parseSearchQuery(value) {
  return parseQuery(value);
}

export function searchIndexStatus() {
  return state.searchIndexStatus;
}

// Kicks the payload off once. Callers re-render when it resolves; a failure is
// remembered so a broken deployment does not turn every keystroke into a request.
export function ensureSearchIndex() {
  if (state.searchIndexStatus === "ready" || state.searchIndexStatus === "failed") return Promise.resolve(state.searchIndexStatus === "ready");
  if (state.searchIndexPromise) return state.searchIndexPromise;

  const request = ++state.searchIndexRequest;
  state.searchIndexStatus = "loading";
  state.searchIndexPromise = (async () => {
    try {
      const response = await fetch(searchIndexUrl, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Search index ${response.status}`);
      const payload = await response.json();
      // Normalized right here rather than at the first keystroke: a search over
      // four hundred articles touches every entry anyway, and doing it while the
      // payload is being taken in keeps that work out of the typing (~50 ms on a
      // laptop, noticeably more on a phone).
      const index = new Map();
      Object.entries(payload || {}).forEach(([path, text]) => {
        const key = String(path || "").replace(/^\.\//, "");
        if (key && text) index.set(key, { text: String(text), normalized: normalize(String(text)) });
      });
      // A refresh during the request has already declared this answer old.
      if (request !== state.searchIndexRequest) return false;
      state.searchIndex = index;
      state.searchIndexStatus = "ready";
      return true;
    } catch {
      if (request === state.searchIndexRequest) state.searchIndexStatus = "failed";
      return false;
    } finally {
      if (request === state.searchIndexRequest) state.searchIndexPromise = null;
    }
  })();

  return state.searchIndexPromise;
}

// The payload is a build artifact: a change that has just been published is only
// in the next build's copy, and the one in memory would keep answering with the
// text from before. „Aktualisieren“ therefore drops it — which also gives a
// request that failed once a second chance, instead of turning the full-text
// search off for the rest of the session.
export function resetSearchIndex() {
  state.searchIndexRequest += 1;
  state.searchIndex = new Map();
  state.searchIndexStatus = "idle";
  state.searchIndexPromise = null;
  state.searchPendingTexts.clear();
}

function pendingDocument(path) {
  const change = state.changes.get(path);
  if (!change || change.kind === "delete" || change.type !== "text") return null;
  return typeof change.content === "string" ? change.content : null;
}

function pendingSearchText(path, content) {
  const cached = state.searchPendingTexts.get(path);
  if (cached?.source === content) return cached;

  const record = {
    source: content,
    text: documentText(content, { template: isSourcePagePath(path) }),
    normalized: ""
  };
  state.searchPendingTexts.set(path, record);
  return record;
}

// Entries from the payload arrive normalized; a queued document is normalized on
// first use and keeps the result, so an open search costs one pass, not one per
// keystroke.
function normalizedOf(record) {
  if (!record.normalized) record.normalized = normalize(record.text);
  return record.normalized;
}

function searchRecord(path) {
  const pending = pendingDocument(path);
  if (pending !== null) return pendingSearchText(path, pending);
  return state.searchIndex.get(path) || null;
}

// One entry against the query. Title, path and text form a single haystack, so
// "lego münchen" finds the article whose title carries the one word and whose
// body carries the other. The excerpt shows only the words the title could not
// explain — an entry found by its title alone needs none.
export function entrySearchMatch(entry, terms) {
  if (!terms.length) return { match: true, excerpt: null };

  const label = normalize(`${entry.title || ""} ${entry.path || ""}`);
  const remaining = terms.filter((term) => !label.includes(term));
  if (!remaining.length) return { match: true, excerpt: null };

  const record = searchRecord(entry.path);
  if (!record) return { match: false, excerpt: null };
  if (!matchesAll(normalizedOf(record), remaining)) return { match: false, excerpt: null };

  return { match: true, excerpt: excerpt(record.text, remaining) };
}

// True while a query could still gain results from the payload in flight.
export function searchIndexPending(terms) {
  return Boolean(terms.length) && state.searchIndexStatus !== "ready" && state.searchIndexStatus !== "failed";
}

// What an empty list means depends on why it is empty: not connected, still
// waiting for the text, nothing found, or nothing written yet.
export function entryListEmptyMessage(terms, connected) {
  if (!connected) return "Verbinde GitHub, um Inhalte zu laden – oder beginne direkt mit „Neu“.";
  if (!terms.length) return "Noch keine Einträge. Beginne mit „Neu“.";
  if (searchIndexPending(terms)) return "Volltext wird geladen …";
  // Ein gescheiterter Abruf sucht weiter — nur eben nicht im Text. Das muss dastehen: „Keine
  // Treffer“ hieße sonst, der Satz komme nirgends vor, obwohl niemand nachgesehen hat.
  if (state.searchIndexStatus === "failed") return "Keine Treffer im Titel. Der Volltext ließ sich nicht laden – „Aktualisieren“ versucht es erneut.";
  return "Keine Treffer.";
}

// Why an entry is in the list when neither its title nor its path says so: the
// words that matched, in the text around them. Text nodes throughout — article
// text never becomes markup on its way into the card.
export function searchExcerptNode(excerpt) {
  const node = document.createElement("span");
  node.className = "entry-excerpt";
  node.append(excerpt.prefix);
  excerpt.segments.forEach((segment) => {
    if (!segment.match) return node.append(segment.text);
    const mark = document.createElement("mark");
    mark.textContent = segment.text;
    node.append(mark);
  });
  node.append(excerpt.suffix);
  return node;
}
