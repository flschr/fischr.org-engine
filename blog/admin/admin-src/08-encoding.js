// --- Encoding & slugs ----------------------------------------------------

export function decodeBase64(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

// Spell German characters out before the NFD pass strips diacritics. "ß" has no canonical
// decomposition, so without this it fell through to [^a-z0-9] and became a hyphen —
// "Bratwürste an den Füßen" produced the slug "bratwurste-an-den-fu-en". Umlauts follow the
// same convention so a slug reads the way the word is spelled out. NFC first, because a
// composed "ü" and a "u" plus combining diaeresis must map alike.
// Deliberately NOT shared with slugifyTag in lib/eleventy/content.js: tag URLs are live and
// must keep their current spelling (the "ernährung" tag stays /tags/ernahrung/).
function transliterateGerman(value) {
  return String(value || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

export function slugify(value) {
  const normalized = transliterateGerman(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "new-post";
}

// Like slugify but keeps a trailing "-" so it can sanitize the slug field
// while the user is still typing (spaces become "-" live).
export function slugifyLive(value) {
  return transliterateGerman(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "");
}

export function localIsoWithOffset(date = new Date()) {
  const pad = (number) => String(Math.trunc(Math.abs(number))).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = pad(offsetMinutes / 60);
  const minutes = pad(offsetMinutes % 60);
  return [
    date.getFullYear(), "-", pad(date.getMonth() + 1), "-", pad(date.getDate()),
    "T", pad(date.getHours()), ":", pad(date.getMinutes()), ":", pad(date.getSeconds()),
    sign, hours, ":", minutes
  ].join("");
}

export function dateInputValueFromIso(value) {
  const text = String(value || "").trim();
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return localIsoWithOffset(parsed).slice(0, 16);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (match) return `${match[1]}T${match[2]}`;
  return localIsoWithOffset().slice(0, 16);
}

export function isoFromDateInputValue(value) {
  const parsed = new Date(String(value || "").trim());
  return Number.isNaN(parsed.getTime()) ? localIsoWithOffset() : localIsoWithOffset(parsed);
}

export function formatEditorDate(value) {
  const parsed = new Date(String(value || "").trim());
  if (Number.isNaN(parsed.getTime())) return String(value || "").slice(0, 10);
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export function todayPrefix() {
  return localIsoWithOffset().slice(0, 10);
}

export function uploadStamp() {
  return localIsoWithOffset().replace(/[-:]/g, "").replace(/[+].*$/, "").slice(0, 15).toLowerCase();
}
