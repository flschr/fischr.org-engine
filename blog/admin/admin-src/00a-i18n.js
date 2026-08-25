// Drei kleine Funktionen, ohne einen einzigen Import auf die eigene Logik — wie
// 00-konstanten.js, aus demselben Grund: fast jedes andere Modul liest hier
// etwas, und ein Zyklus hätte genau dieselbe Klasse Bug ausgelöst, die
// 00-konstanten.js schon einmal hatte (siehe dort). Die beiden Wörterbücher
// stehen in eigenen Dateien (00a1-i18n-de.js, 00a2-i18n-en.js) — reine Werte
// ohne eigene Importe, die dieses Modul importiert —, damit dieses Modul
// unter der 200-Zeilen-Grenze bleibt (tests/admin-source-structure.test.js).
//
// Deckt bisher die statische Auszeichnung ab (index.html, die njk-Partials):
// Überschriften, Dialogtitel, Feldbeschriftungen, aria-label/title/
// placeholder. Die von JS erzeugten Texte (Status-Toasts, dynamisch gebaute
// Dialoginhalte, Kartenlisten) folgen in einem eigenen Schritt — dort ruft
// jede Stelle t() direkt auf, statt über data-i18n zu laufen.

import { dictDe } from "./00a1-i18n-de.js";
import { dictDe2 } from "./00a1b-i18n-de-2.js";
import { dictDe3 } from "./00a1c-i18n-de-3.js";
import { dictDe4 } from "./00a1d-i18n-de-4.js";
import { dictEn } from "./00a2-i18n-en.js";
import { dictEn2 } from "./00a2b-i18n-en-2.js";
import { dictEn3 } from "./00a2c-i18n-en-3.js";
import { dictEn4 } from "./00a2d-i18n-en-4.js";

export const langStorageKey = "rw-admin-lang";

export function currentLang() {
  return localStorage.getItem(langStorageKey) === "en" ? "en" : "de";
}

export function setLang(lang) {
  localStorage.setItem(langStorageKey, lang === "en" ? "en" : "de");
}

// For the handful of spots that build their own Intl.DateTimeFormat (the
// stats view's calendar and axis labels) instead of routing through t() —
// those need a BCP-47 locale, not the "de"/"en" pair t() works with.
export function currentLocale() {
  return currentLang() === "en" ? "en-US" : "de-DE";
}

// de ist die Vorgabe UND der Ausweich, falls ein Schlüssel im gewählten
// Wörterbuch fehlt — deshalb schreibfehlerfest gegenüber einem vergessenen
// en-Eintrag, nie gegenüber einem vergessenen de-Eintrag.
const dict = {
  de: { ...dictDe, ...dictDe2, ...dictDe3, ...dictDe4 },
  en: { ...dictEn, ...dictEn2, ...dictEn3, ...dictEn4 }
};

export function t(key, vars) {
  const table = dict[currentLang()] || dict.de;
  let text = table[key] ?? dict.de[key] ?? key;
  // The replacement is a function, not vars[name] itself: a plain string
  // second argument treats $&, $$, $` and $' in it as special substitution
  // patterns (per spec), so external content (a GitHub error message, a
  // user-typed article title) containing one of those sequences would
  // corrupt the output. A function's return value is always inserted
  // literally.
  if (vars) for (const name of Object.keys(vars)) text = text.replaceAll(`{${name}}`, () => String(vars[name]));
  return text;
}

// Picks singular/plural once instead of repeating the same ternary at every
// call site — six call sites had copy-pasted `count === 1 ? t(base +
// "Singular") : t(base + "Plural", {count})` before this existed.
export function tn(base, count, vars) {
  return t(`${base}${count === 1 ? "Singular" : "Plural"}`, { count, ...vars });
}

// Läuft beim Start einmal über das ganze Dokument und danach erneut, sobald
// die Sprache wechselt — dieselbe Funktion für beide Fälle, damit sie nie
// auseinanderlaufen.
//
// Four attributes instead of one generic format: most spots are plain text
// content (data-i18n); aria-label and title are separate rather than one
// combined attribute because they occasionally carry different wording (a
// fuller aria-label next to a shorter title tooltip) — combining them would
// have forced every such spot to repeat itself, or lost the distinction.
export function applyStaticTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.dataset.i18nTitle));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
  });
}
