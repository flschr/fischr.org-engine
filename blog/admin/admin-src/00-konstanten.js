// Reine Werte, ohne einen einzigen Import.
//
// Das ist der Punkt: Ein Modul ohne Importe steht in keinem Zyklus und wird deshalb immer vor
// allen ausgewertet, die es benutzen. Solange diese Werte in 01-bootstrap.js standen — einem
// Modul, das selbst viel importiert — konnte ein Zyklus dazu führen, dass ein Nutzer sie noch
// uninitialisiert sieht. Genau das ist am 2026-08-23 passiert: Der Content-Service bekam eine
// undefinierte Schlüsselmenge und jeder Beitrag liess sich nicht mehr öffnen; und state.token
// las aus sessionStorage unter einem undefinierten Schlüssel, was den angemeldeten Zustand
// stillschweigend verworfen hätte.
//
// Wer hier etwas ergänzt, ergänzt nur einen Wert. Sobald etwas importiert werden müsste, gehört
// es nicht mehr hierher.

export const repo = {
  owner: "example",
  name: "mysite.example",
  // `branch` is the working branch the admin reads & writes (cross-device
  // draft store); `publishBranch` is what Cloudflare builds & serves.
  branch: "drafts",
  publishBranch: "main"
};

// Die einzige Stelle im Admin, die den Auslieferungs-Host kennt. Er wird ausschliesslich zum
// *Nachschlagen* gebraucht (siehe mediaDisplayUrl) — eine Adresse aus einem Pfad abzuleiten
// ist seit der Inhaltsadressierung falsch und wird von tests/admin-media-address.test.js
// verhindert.
export const mediaDeliveryOrigin = "https://media.mysite.example";

export const tokenKey = "rw-admin-github-token";
// Crash-safe local copy of the editor doc (one slot — there is one editor at a
// time). It survives navigation, tab close and browser crash, so unsaved work
// is never lost between explicit Save/Publish clicks. Offered back on reopen.
export const autosaveKey = "rw-admin-editor-autosave";
export const renameOriginsPath = "automation/admin-rename-origins.json";
export const publishRequestKey = "rw-admin-publish-request-v1";
export const imageExtensions = new Set(["avif", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
export const videoExtensions = new Set(["m4v", "mov", "mp4", "webm"]);
export const maxVideoUploadBytes = 20 * 1024 * 1024;
export const maxGpxUploadBytes = 10 * 1024 * 1024;
export const editableFrontmatterKeys = new Set(["title", "slug", "date", "lang", "draft", "permalink", "social_image", "social_text", "social_images", "social_template", "category", "syndicate", "schema"]);
export const altTextMaxImageSide = 1400;
export const altTextMaxDataUrlLength = 7 * 1024 * 1024;
export const gotosocialTextLimit = 500;
// Since DB-1129 the media bytes live in R2, not in Git. This manifest is their only
// record in the repository: scripts/admin-normalize-image.js writes an entry for every
// upload, the media library reads it as its index, and a deletion removes an entry from it.
