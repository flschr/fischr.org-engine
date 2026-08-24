// Reine Werte + drei kleine Funktionen, ohne einen einzigen Import — wie
// 00-konstanten.js, aus demselben Grund: fast jedes andere Modul liest hier
// etwas, und ein Zyklus hätte genau dieselbe Klasse Bug ausgelöst, die
// 00-konstanten.js schon einmal hatte (siehe dort).
//
// Deckt bisher die statische Auszeichnung ab (index.html, die njk-Partials):
// Überschriften, Dialogtitel, Feldbeschriftungen, aria-label/title/
// placeholder. Die von JS erzeugten Texte (Status-Toasts, dynamisch gebaute
// Dialoginhalte, Kartenlisten) folgen in einem eigenen Schritt — dort ruft
// jede Stelle t() direkt auf, statt über data-i18n zu laufen.

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
const dict = {
  de: {
    "viewTitle.articles": "Artikel",
    "viewTitle.pages": "Seiten",
    "viewTitle.newArticle": "Neuer Artikel",
    "viewTitle.editArticle": "Artikel bearbeiten",
    "viewTitle.newPage": "Neue Seite",
    "viewTitle.editPage": "Seite bearbeiten",
    "viewTitle.media": "Mediathek",
    "viewTitle.queue": "Sync",
    "viewTitle.stats": "Statistik",
    "viewTitle.settings": "Einstellungen",
    "aria.choosePreviewImage": "Vorschaubild aus der Mediathek wählen",
    "aria.chooseFromLibrary": "Aus Mediathek wählen",
    "aria.editorContent": "Inhalt",
    "aria.editorPreview": "Vorschau",
    "dialog.publish": "Veröffentlichen",
    "dialog.contentType": "Inhaltstyp",
    "dialog.sharing": "Teilen",
    "dialog.missingAltText": "Fehlender Alt-Text",
    "dialog.unsavedChanges": "Ungespeicherte Änderungen",
    "dialog.deleteEntry": "Eintrag löschen?",
    "dialog.deleteArticle": "Artikel löschen?",
    "dialog.deletePage": "Seite löschen?",
    "dialog.deleteEntryBody": "Die Löschung wird vorgemerkt und erst beim Veröffentlichen ausgeführt.",
    "dialog.discardChange": "Änderung verwerfen?",
    "dialog.discardChangeBody": "„{item}“ wird dauerhaft aus der Warteschlange entfernt.",
    "settings.githubConnection": "GitHub-Verbindung",
    "settings.publishingDestination": "Veröffentlichungsziel",
    "settings.gotosocialInstance": "GoToSocial-Instanz",
    "settings.postTypes": "Beitragstypen",
    "settings.language": "Sprache",
    "settings.languageHint": "Sprache der Admin-Oberfläche. Gilt nur für dieses Gerät."
  },
  en: {
    "viewTitle.articles": "Articles",
    "viewTitle.pages": "Pages",
    "viewTitle.newArticle": "New article",
    "viewTitle.editArticle": "Edit article",
    "viewTitle.newPage": "New page",
    "viewTitle.editPage": "Edit page",
    "viewTitle.media": "Media",
    "viewTitle.queue": "Sync",
    "viewTitle.stats": "Statistics",
    "viewTitle.settings": "Settings",
    "aria.choosePreviewImage": "Choose preview image from library",
    "aria.chooseFromLibrary": "Choose from library",
    "aria.editorContent": "Content",
    "aria.editorPreview": "Preview",
    "dialog.publish": "Publish",
    "dialog.contentType": "Content type",
    "dialog.sharing": "Sharing",
    "dialog.missingAltText": "Missing alt text",
    "dialog.unsavedChanges": "Unsaved changes",
    "dialog.deleteEntry": "Delete entry?",
    "dialog.deleteArticle": "Delete article?",
    "dialog.deletePage": "Delete page?",
    "dialog.deleteEntryBody": "The deletion is queued and only carried out when you publish.",
    "dialog.discardChange": "Discard change?",
    "dialog.discardChangeBody": "“{item}” is permanently removed from the queue.",
    "settings.githubConnection": "GitHub connection",
    "settings.publishingDestination": "Publishing destination",
    "settings.gotosocialInstance": "GoToSocial instance",
    "settings.postTypes": "Post types",
    "settings.language": "Language",
    "settings.languageHint": "Language of the admin interface. Applies only to this device."
  }
};

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
