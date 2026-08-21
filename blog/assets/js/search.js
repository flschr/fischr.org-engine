const form = document.querySelector("#search-form");
const input = document.querySelector("#site-search");
const status = document.querySelector("#search-status");
const results = document.querySelector("#search-results");
const archive = document.querySelector("#archive-list");

let pagefindPromise;
let latestSearchId = 0;
let searchTimer;

function loadPagefind() {
  if (!pagefindPromise) {
    pagefindPromise = import("/pagefind/pagefind.js").then(async (pagefind) => {
      // Run Pagefind in the archive document so its WASM compilation is governed
      // by the archive CSP, even when a CDN retains older worker asset headers.
      await pagefind.options({ excerptLength: 32, noWorker: true });
      return pagefind;
    });
  }

  return pagefindPromise;
}

function setStatus(message) {
  status.textContent = message;
}

function clearResults() {
  results.replaceChildren();
}

function showArchive() {
  archive.hidden = false;
  results.hidden = true;
}

function showResults() {
  archive.hidden = true;
  results.hidden = false;
}

function updateUrl(term) {
  const url = new URL(window.location.href);

  if (term) {
    url.searchParams.set("q", term);
  } else {
    url.searchParams.delete("q");
  }

  window.history.replaceState(null, "", url);
}

function sanitizeExcerpt(target, html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";

  function appendNode(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent || ""));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const nextParent = node.tagName.toLowerCase() === "mark" ? document.createElement("mark") : parent;

    node.childNodes.forEach((child) => appendNode(child, nextParent));

    if (nextParent !== parent) {
      parent.append(nextParent);
    }
  }

  const fragment = document.createDocumentFragment();
  template.content.childNodes.forEach((node) => appendNode(node, fragment));
  target.replaceChildren(fragment);
}

function renderResult(data) {
  const item = document.createElement("li");
  item.className = "search-result";

  const heading = document.createElement("h2");
  const link = document.createElement("a");
  link.href = data.url;
  link.textContent = data.meta?.title || data.url;
  heading.append(link);

  const meta = document.createElement("p");
  meta.className = "search-result-meta";
  meta.textContent = data.meta?.date || "";

  const excerpt = document.createElement("p");
  excerpt.className = "search-result-excerpt";
  sanitizeExcerpt(excerpt, data.excerpt || data.plain_excerpt || "");

  item.append(heading, meta, excerpt);
  return item;
}

async function runSearch(rawTerm) {
  const term = rawTerm.trim();
  const searchId = ++latestSearchId;
  updateUrl(term);

  if (term.length < 2) {
    clearResults();
    setStatus("");
    showArchive();
    return;
  }

  showResults();
  setStatus("Suche läuft...");

  try {
    const pagefind = await loadPagefind();
    const search = await pagefind.debouncedSearch(term);
    if (!search || searchId !== latestSearchId) return;

    const visibleResults = search.results.slice(0, 20);
    const resultData = await Promise.all(visibleResults.map((result) => result.data()));
    if (searchId !== latestSearchId) return;

    clearResults();
    results.append(...resultData.map(renderResult));

    if (search.results.length === 0) {
      setStatus(`Keine Treffer für "${term}".`);
    } else if (search.results.length === 1) {
      setStatus("1 Treffer");
    } else if (search.results.length > visibleResults.length) {
      setStatus(`${search.results.length} Treffer, die ersten ${visibleResults.length} werden angezeigt.`);
    } else {
      setStatus(`${search.results.length} Treffer`);
    }
  } catch (error) {
    clearResults();
    setStatus("Die Suche konnte gerade nicht geladen werden.");
    console.error(error);
  }
}

function scheduleSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => runSearch(input.value), 150);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  window.clearTimeout(searchTimer);
  runSearch(input.value);
});

input.addEventListener("input", scheduleSearch);

const initialQuery = new URLSearchParams(window.location.search).get("q") || "";
if (initialQuery) {
  input.value = initialQuery;
  runSearch(initialQuery);
}
