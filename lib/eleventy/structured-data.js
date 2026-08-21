const { decodeHtmlAttribute, stripHtml } = require("./html");

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;

  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function normalizeRating(value) {
  const number = toNumber(value);
  if (number === null) return null;

  return Number.isInteger(number) ? number : Number(number.toFixed(2));
}

function parseTitleRating(title = "") {
  const match = String(title).match(/(?:\(|\s)(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)(?:\))?\s*$/);
  if (!match) return {};

  return {
    rating: normalizeRating(match[1]),
    bestRating: normalizeRating(match[2])
  };
}

function cleanItemName(title = "") {
  return String(title)
    .replace(/^[^\p{L}\p{N}"']+/u, "")
    .replace(/\s*\(?\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?\)?\s*$/, "")
    .trim();
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function decodeHtmlText(value = "") {
  return decodeHtmlAttribute(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value = "") {
  return decodeHtmlText(stripHtml(value)).replace(/\s+([,.;:!?])/g, "$1").trim();
}

function normalizeHeadingText(value = "") {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractSection(content = "", headingMatcher = () => false) {
  const html = String(content);
  const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings = [...html.matchAll(headingRegex)];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const level = Number(heading[1]);
    const headingText = normalizeHeadingText(heading[2]);
    if (!headingMatcher(headingText)) continue;

    const sectionStart = heading.index + heading[0].length;
    const nextHeading = headings.slice(index + 1).find((candidate) => Number(candidate[1]) <= level);
    const sectionEnd = nextHeading ? nextHeading.index : html.length;

    return {
      heading: cleanText(heading[2]),
      html: html.slice(sectionStart, sectionEnd)
    };
  }

  return null;
}

function extractListItems(content = "") {
  return [...String(content).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean);
}

function extractRecipeYield(content = "", ingredientsHeading = "") {
  const candidates = [ingredientsHeading, ...String(content).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi).map((match) => cleanText(match[1]))];
  const yieldValue = String.raw`((?:ungef[äa]hr\s+|ca\.\s+|gut\s+)?(?:\d+|ein(?:e|en)?)(?:\s*[-–]\s*\d+)?(?:\s+[a-zäöüß]+){0,3}\s+(?:personen|portionen|gl[äa]ser|bleche|blech|st[üu]cke|laibe|laib|brote|brot|pizza|pizzen|pizzab[öo]den|schnecken))`;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const text = cleanText(candidate);
    const match =
      (index === 0 && text.match(new RegExp(`\\bf[üu]r\\s+${yieldValue}(?:\\)|$)`, "i"))) ||
      (/^ergibt\b/i.test(text) && text.match(new RegExp(`\\bergibt\\s+${yieldValue}`, "i"))) ||
      (/\bmenge\b.*\breicht\b/i.test(text) &&
        text.match(new RegExp(`\\breicht(?:\\s+normalerweise)?\\s+f[üu]r\\s+${yieldValue}`, "i")));

    if (match) return match[1].replace(/\s+/g, " ").trim();
  }

  return "";
}

function buildRecipeStructuredData(
  schema = {},
  content = "",
  title = "",
  canonical = "",
  imageUrl = "",
  description = "",
  datePublished = "",
  dateModified = "",
  language = "",
  author = {},
  authorUrl = ""
) {
  schema = schema || {};

  // Recipe structured data is driven solely by an explicit `schema: { type:
  // recipe }` — the same mechanism as book/film reviews. No tag/category magic.
  if (schema.type !== "recipe") return null;

  const ingredientSection = extractSection(content, (heading) => heading.startsWith("zutaten"));
  const instructionSection = extractSection(content, (heading) => heading.startsWith("zubereitung"));
  const recipeIngredient = normalizeArray(schema.recipeIngredient).length
    ? normalizeArray(schema.recipeIngredient)
    : extractListItems(ingredientSection?.html);
  const instructionTexts = normalizeArray(schema.recipeInstructions).length
    ? normalizeArray(schema.recipeInstructions)
    : extractListItems(instructionSection?.html);

  if (!title || !imageUrl || recipeIngredient.length === 0 || instructionTexts.length === 0) return null;

  const recipeAuthor = typeof author === "string" ? { name: author, url: authorUrl } : { ...author, url: authorUrl || author.url };
  const recipeYield = schema.recipeYield || extractRecipeYield(content, ingredientSection?.heading);

  return compactObject({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: schema.name || title,
    url: canonical,
    image: imageUrl,
    description,
    datePublished: datePublished ? new Date(datePublished).toISOString() : "",
    dateModified: dateModified ? new Date(dateModified).toISOString() : "",
    inLanguage: language,
    author: buildPerson(recipeAuthor),
    recipeYield,
    prepTime: schema.prepTime,
    cookTime: schema.cookTime,
    totalTime: schema.totalTime,
    recipeCategory: schema.recipeCategory,
    recipeCuisine: schema.recipeCuisine,
    keywords: normalizeArray(schema.keywords).join(", "),
    recipeIngredient,
    recipeInstructions: instructionTexts.map((text) => ({
      "@type": "HowToStep",
      text
    }))
  });
}

function buildPerson(author = {}) {
  if (typeof author === "string") {
    return compactObject({
      "@type": "Person",
      name: author
    });
  }

  return compactObject({
    "@type": "Person",
    name: author.name,
    url: author.url
  });
}

function buildPeople(value) {
  const people = normalizeArray(value).map(buildPerson).filter((person) => person.name);
  if (people.length === 0) return undefined;

  return people.length === 1 ? people[0] : people;
}

function buildReviewStructuredData(
  schema = {},
  title = "",
  canonical = "",
  imageUrl = "",
  description = "",
  datePublished = "",
  dateModified = "",
  language = "",
  author = {},
  authorUrl = ""
) {
  if (!schema || schema.type !== "review") return null;

  const parsedRating = parseTitleRating(title);
  const ratingValue = normalizeRating(schema.rating) ?? parsedRating.rating;
  const bestRating = normalizeRating(schema.bestRating) ?? parsedRating.bestRating ?? 5;
  const worstRating = normalizeRating(schema.worstRating) ?? 0;
  const itemName = schema.itemName || cleanItemName(title);
  const itemType = schema.itemType || "Movie";

  if (!itemName || ratingValue === null) return null;

  const itemReviewed = compactObject({
    "@type": itemType,
    name: itemName,
    alternateName: schema.alternateName,
    author: buildPeople(schema.itemAuthor),
    image: imageUrl
  });

  const sameAs = normalizeArray(schema.sameAs);
  if (sameAs.length === 1) itemReviewed.sameAs = sameAs[0];
  if (sameAs.length > 1) itemReviewed.sameAs = sameAs;

  const reviewAuthor = typeof author === "string" ? { name: author, url: authorUrl } : { ...author, url: authorUrl || author.url };

  return compactObject({
    "@context": "https://schema.org",
    "@type": "Review",
    name: `${itemName} (${ratingValue}/${bestRating})`,
    url: canonical,
    datePublished: datePublished ? new Date(datePublished).toISOString() : "",
    dateModified: dateModified ? new Date(dateModified).toISOString() : "",
    inLanguage: language,
    author: buildPerson(reviewAuthor),
    reviewBody: description,
    reviewRating: {
      "@type": "Rating",
      ratingValue,
      bestRating,
      worstRating
    },
    itemReviewed
  });
}

module.exports = {
  buildRecipeStructuredData,
  buildReviewStructuredData,
  cleanItemName,
  parseTitleRating
};
