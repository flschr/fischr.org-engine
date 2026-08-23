import { els } from "./01b-elements.js";

// --- Content type (structured data: recipe / book / film / series) ---

function contentTypeFromSchema(schema) {
  if (!schema || !schema.type) return "";
  if (schema.type === "recipe") return "recipe";
  if (schema.type === "review") {
    if (schema.itemType === "Book") return "book";
    if (schema.itemType === "TVSeries") return "series";
    return "movie";
  }
  return "";
}

// Pull "Das Werk (4/5)" → { name: "Das Werk", rating: 4, best: 5 }.
function reviewTitleGuess() {
  const title = els.titleInput.value || "";
  const match = title.match(/\((\d+(?:[.,]\d+)?)\s*\/\s*(\d+)\)\s*$/);
  return {
    name: title.replace(/\s*\(\d+(?:[.,]\d+)?\s*\/\s*\d+\)\s*$/, "").trim(),
    rating: match ? Number(match[1].replace(",", ".")) : null,
    best: match ? Number(match[2]) : null
  };
}

export function fillContentType(schema) {
  if (!els.contentTypeSelect) return;
  els.contentTypeSelect.value = contentTypeFromSchema(schema);
  els.reviewItemName.value = schema?.itemName || "";
  els.reviewRating.value = schema?.rating ?? "";
  els.reviewBest.value = schema?.bestRating ?? "";
  els.reviewAuthor.value = schema?.itemAuthor || "";
  els.reviewSameAs.value = schema?.sameAs || "";
  syncContentTypeFields();
}

// Visibility only — never mutates field values (so opening the dialog can't
// inject guessed structured-data into an existing post).
export function syncContentTypeFields() {
  if (!els.contentTypeSelect) return;
  const ct = els.contentTypeSelect.value;
  const isReview = ct === "book" || ct === "movie" || ct === "series";
  els.reviewFields.hidden = !isReview;
  if (els.reviewAuthorField) els.reviewAuthorField.hidden = ct !== "book";
}

// Only when the user actively picks a review type do we prefill empty fields
// from the title (e.g. "Echo Valley (4/5)" → name + rating).
export function onContentTypeChange() {
  syncContentTypeFields();
  const ct = els.contentTypeSelect.value;
  if (ct === "book" || ct === "movie" || ct === "series") {
    const guess = reviewTitleGuess();
    if (!els.reviewItemName.value) els.reviewItemName.value = guess.name;
    if (els.reviewRating.value === "" && guess.rating != null) els.reviewRating.value = guess.rating;
    if (els.reviewBest.value === "") els.reviewBest.value = guess.best != null ? guess.best : 5;
  }
}

// Build the schema object from the dialog inputs (null = no structured data).
export function collectSchema() {
  if (!els.contentTypeSelect) return null;
  const ct = els.contentTypeSelect.value;
  if (!ct) return null;
  if (ct === "recipe") return { type: "recipe" };
  const itemType = ct === "book" ? "Book" : ct === "series" ? "TVSeries" : "Movie";
  const schema = { type: "review", itemType };
  const name = els.reviewItemName.value.trim();
  if (name) schema.itemName = name;
  if (ct === "book") {
    const author = els.reviewAuthor.value.trim();
    if (author) schema.itemAuthor = author;
  }
  const rating = parseFloat(els.reviewRating.value);
  if (Number.isFinite(rating)) schema.rating = rating;
  const best = parseInt(els.reviewBest.value, 10);
  if (Number.isFinite(best)) schema.bestRating = best;
  const link = els.reviewSameAs.value.trim();
  if (link) schema.sameAs = link;
  return schema;
}
