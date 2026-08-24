/* Shared search text for the admin.
 *
 * The article list searches the same text twice over: the build writes it into
 * /admin/posts-search.json for everything that lives in the repository, and the
 * admin derives it in the browser for the few entries with unsaved edits. Both
 * sides must produce the same string, or a queued change would match differently
 * than the published version of the same post — so the derivation lives here and
 * is loaded by both (require from lib/eleventy, window.RWSearchText in /admin/).
 *
 * Two properties matter for the result:
 *   - it stays readable (original case, real words), so a hit can be shown as an
 *     excerpt instead of just a checkmark;
 *   - normalize() is length preserving, so an offset found in the normalized
 *     text points at the same character in the readable one. That is what lets
 *     the list highlight a match without a second, case-insensitive search.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWSearchText = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  // Length-preserving folding: one source character maps to exactly one target
  // character. Multi-character transliterations (ß → ss) would shift every
  // following offset and break the excerpt, so they are deliberately absent.
  const foldedCharacters = new Map(Object.entries({
    "à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a", "ā": "a", "ă": "a", "ą": "a",
    "è": "e", "é": "e", "ê": "e", "ë": "e", "ē": "e", "ĕ": "e", "ė": "e", "ę": "e", "ě": "e",
    "ì": "i", "í": "i", "î": "i", "ï": "i", "ī": "i", "į": "i", "ı": "i",
    "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o", "ø": "o", "ō": "o", "ő": "o",
    "ù": "u", "ú": "u", "û": "u", "ü": "u", "ū": "u", "ů": "u", "ű": "u",
    "ý": "y", "ÿ": "y",
    "ç": "c", "ć": "c", "č": "c",
    "ñ": "n", "ń": "n", "ň": "n",
    "ł": "l", "ś": "s", "š": "s", "ż": "z", "ź": "z", "ž": "z", "ř": "r", "ť": "t", "ď": "d"
  }));

  const htmlEntities = new Map(Object.entries({
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", shy: "", ndash: "–", mdash: "—", hellip: "…"
  }));

  // Lowercase and fold accents so "München" is found by "munchen" — the way the
  // title is typed when the keyboard is in the way.
  //
  // Character by character, and only when lowercasing keeps the width: the
  // Turkish "İ" lowercases to two units in JavaScript ("i" plus a combining
  // dot), which would shift every offset behind it and make the excerpt mark
  // the wrong word. Such a character stays as it is — it is then only found by
  // itself, which is the smaller loss.
  function normalize(value) {
    let result = "";
    for (const character of String(value == null ? "" : value)) {
      const lowered = character.toLowerCase();
      const kept = lowered.length === character.length ? lowered : character;
      result += foldedCharacters.get(kept) || kept;
    }
    return result;
  }

  // A numeric entity outside Unicode makes String.fromCodePoint throw, and this
  // runs inside the build: one malformed "&#x110000;" in one post would fail it.
  // Out of range means "not a character" — the entity stays as written.
  function fromCodePoint(code) {
    if (!Number.isInteger(code) || code < 0 || code > 0x10FFFF) return "";
    return String.fromCodePoint(code);
  }

  function decodeEntities(value) {
    return String(value || "").replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const hex = entity[1] === "x" || entity[1] === "X";
        const decoded = fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
        return decoded || match;
      }
      const named = htmlEntities.get(entity.toLowerCase());
      return named === undefined ? match : named;
    });
  }

  // Markdown to the words a human would read. Link targets survive on purpose —
  // "which post links to that domain" is a question the article list should be
  // able to answer — while media sources do not: which post uses which image is
  // already answered by the media reference index, and the paths would only
  // crowd out the excerpt.
  function plainText(markdown) {
    let text = String(markdown == null ? "" : markdown);

    text = text.replace(/\r\n?/g, "\n");
    text = text.replace(/<!--[\s\S]*?-->/g, " ");
    text = text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*$/gm, " "); // fence lines, not their content
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // image: alt text only
    text = text.replace(/!(?:video|yt|youtube|map|embed|gpx)(?:\[([^\]]*)\])?\([\s\S]*?\)/gi, "$1 ");
    text = text.replace(/\[\^[^\]]+\]:?/g, " "); // footnote markers, definitions keep their text
    text = text.replace(/\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g, "$1 $2");
    text = text.replace(/<((?:https?|mailto):[^>\s]+)>/gi, "$1");
    text = text.replace(/<[^>\n]{0,400}>/g, " "); // html tags, keeping their text
    text = decodeEntities(text);
    text = text.replace(/^ {0,3}>\s?/gm, " "); // blockquote markers
    text = text.replace(/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gi, " ");
    text = text.replace(/^ {0,3}#{1,6}\s+/gm, " ");
    text = text.replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+/gm, " ");
    text = text.replace(/^ {0,3}(?:[-*_]\s*){3,}$/gm, " "); // thematic breaks
    text = text.replace(/^ {0,3}\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*\|?$/gm, " "); // table rules
    text = text.replace(/\|/g, " ");
    text = text.replace(/[*_~`]/g, "");
    text = text.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, "$1"); // markdown escapes
    text = text.replace(/\s+/g, " ");

    return text.trim();
  }

  // Nunjucks pages (about, projects) are edited as source in the admin, so they
  // are searched as source too — minus the template plumbing nobody searches for.
  function plainTextFromTemplate(source) {
    const stripped = String(source == null ? "" : source)
      .replace(/\{#[\s\S]*?#\}/g, " ")
      .replace(/\{%[\s\S]*?%\}/g, " ")
      .replace(/\{\{[\s\S]*?\}\}/g, " ");
    return plainText(stripped);
  }

  function splitFrontmatter(source) {
    const text = String(source == null ? "" : source);
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { frontmatter: "", body: text };
    return { frontmatter: match[1], body: text.slice(match[0].length) };
  }

  // The two frontmatter fields that carry words rather than plumbing. Everything
  // else in there is machinery — dates, slugs, image paths — and searching for it
  // would only put YAML into the excerpt. The title is left out on purpose: the
  // list already knows it, matches it without the index, and knows the newer one
  // while a rename is still queued.
  function frontmatterText(frontmatter) {
    const lines = String(frontmatter || "").split(/\r?\n/);
    const values = [];
    let collecting = "";

    for (const line of lines) {
      const field = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
      if (field) {
        const key = field[1].toLowerCase();
        const inline = (field[2] || "").trim();
        collecting = ["tags", "description", "summary"].includes(key) ? key : "";
        if (!collecting || !inline || /^[|>][-+]?\d*$/.test(inline)) continue;
        values.push(inline.replace(/^\[|\]$/g, "").replace(/,/g, " "));
        continue;
      }
      if (!collecting || !line.trim()) continue;
      values.push(line.replace(/^\s*-\s*/, "").trim());
    }

    return values
      .map((value) => value.replace(/^['"]|['"]$/g, "").trim())
      .filter(Boolean)
      .join(" ");
  }

  // The searchable text of one document, derived from the file as it is stored.
  // Both callers hand in the same bytes — the build reads them from disk, the
  // admin holds them in its queue — so neither can drift into its own parser.
  function documentText(source, { template = false } = {}) {
    const { frontmatter, body } = splitFrontmatter(source);
    const bodyText = template ? plainTextFromTemplate(body) : plainText(body);
    return [plainText(frontmatterText(frontmatter)), bodyText]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // A query is a set of words that must all appear, in any order and anywhere:
  // "lego münchen" finds the post whose title carries the one and whose body
  // carries the other. Quotes hold a phrase together.
  function parseQuery(value) {
    const terms = [];
    const pattern = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = pattern.exec(String(value == null ? "" : value))) !== null) {
      const term = normalize(match[1] || match[2]).trim().replace(/\s+/g, " ");
      if (term) terms.push(term);
    }
    return terms;
  }

  function matchesAll(normalizedText, terms) {
    if (!terms.length) return true;
    return terms.every((term) => normalizedText.includes(term));
  }

  function matchRanges(normalizedText, terms) {
    const ranges = [];
    for (const term of terms) {
      if (!term) continue; // an empty term matches at every position, endlessly
      let from = normalizedText.indexOf(term);
      while (from !== -1) {
        ranges.push([from, from + term.length]);
        if (ranges.length > 200) break;
        from = normalizedText.indexOf(term, from + term.length);
      }
    }
    return ranges.sort((a, b) => a[0] - b[0]);
  }

  // An excerpt around the first hit, with every hit inside the window marked.
  // Offsets come from the normalized text and are used on the readable one —
  // which only holds because normalize() never changes the length.
  function excerpt(text, terms, { length = 160 } = {}) {
    const readable = String(text == null ? "" : text);
    const normalized = normalize(readable);
    const ranges = matchRanges(normalized, terms);
    if (!ranges.length) return null;

    const lead = Math.max(0, ranges[0][0] - Math.floor(length / 3));
    const start = lead === 0 ? 0 : nextBoundary(readable, lead);
    const end = Math.min(readable.length, start + length);
    const stop = end === readable.length ? end : previousBoundary(readable, end, start);

    const segments = [];
    let cursor = start;
    for (const [from, to] of ranges) {
      if (to <= start) continue;
      if (from >= stop) break;
      const markFrom = Math.max(from, start);
      const markTo = Math.min(to, stop);
      if (markFrom > cursor) segments.push({ text: readable.slice(cursor, markFrom), match: false });
      segments.push({ text: readable.slice(markFrom, markTo), match: true });
      cursor = markTo;
    }
    if (cursor < stop) segments.push({ text: readable.slice(cursor, stop), match: false });

    return {
      segments,
      prefix: start > 0 ? "…" : "",
      suffix: stop < readable.length ? "…" : ""
    };
  }

  function nextBoundary(text, index) {
    const space = text.indexOf(" ", index);
    return space === -1 || space > index + 24 ? index : space + 1;
  }

  function previousBoundary(text, index, floor) {
    const space = text.lastIndexOf(" ", index);
    return space <= floor || index - space > 24 ? index : space;
  }

  return { normalize, plainText, plainTextFromTemplate, frontmatterText, splitFrontmatter, documentText, parseQuery, matchesAll, matchRanges, excerpt };
});
