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
import { dictEn } from "./00a2-i18n-en.js";

export const langStorageKey = "rw-admin-lang";

export function currentLang() {
  return localStorage.getItem(langStorageKey) === "en" ? "en" : "de";
}

export function setLang(lang) {
  localStorage.setItem(langStorageKey, lang === "en" ? "en" : "de");
}

// de ist die Vorgabe UND der Ausweich, falls ein Schlüssel im gewählten
// Wörterbuch fehlt — deshalb schreibfehlerfest gegenüber einem vergessenen
// en-Eintrag, nie gegenüber einem vergessenen de-Eintrag.
const dict = { de: dictDe, en: dictEn };

export function t(key, vars) {
  const table = dict[currentLang()] || dict.de;
  let text = table[key] ?? dict.de[key] ?? key;
  if (vars) for (const name of Object.keys(vars)) text = text.replaceAll(`{${name}}`, vars[name]);
  return text;
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
