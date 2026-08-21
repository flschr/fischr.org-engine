function parseFiveStarRating(title = "") {
  const match = String(title).match(/^(.*?)\s*(?:\(([0-5])\s*\/\s*5\)|([0-5])\s*\/\s*5)\s*$/);
  if (!match) return null;

  return {
    title: match[1].trim(),
    rating: Number(match[2] ?? match[3])
  };
}

function renderRatingTitle(title = "") {
  const parsed = parseFiveStarRating(title);
  if (!parsed) return String(title);

  return `${parsed.title} (${"★".repeat(parsed.rating)}${"☆".repeat(5 - parsed.rating)})`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRatingTitleHtml(title = "") {
  const parsed = parseFiveStarRating(title);
  if (!parsed) return escapeHtml(title);

  const stars = `${"★".repeat(parsed.rating)}${"☆".repeat(5 - parsed.rating)}`;
  return `${escapeHtml(parsed.title)} <span class="rating-stars" aria-hidden="true">(${stars})</span>`;
}

function ratingTitleAria(title = "") {
  const parsed = parseFiveStarRating(title);
  if (!parsed) return String(title);

  return `${parsed.title}, ${parsed.rating} von 5 Sternen`;
}

module.exports = {
  parseFiveStarRating,
  ratingTitleAria,
  renderRatingTitle,
  renderRatingTitleHtml
};
