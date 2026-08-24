import { findHtmlMedia, findMarkdownImages, findMediaShortcuts, visibleMarkdownSource } from "./15a-media-reference-index.js";
import { t } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { hasGithubAccess } from "./05-github-auth.js";
import { baseName, entryInfoFromPath, publicMediaPath } from "./06-paths.js";
import { decodeBasicHtmlEntities, mediaMarkdown, splitDocument, stripMarkdownUrl } from "./09-frontmatter.js";
import { closePublishDialog, openPublishDialog } from "./13-publish-dialog.js";
import { copyText } from "./14a-social-controls.js";
import { writeAutosave } from "./19-recovery.js";
import { showView, updateNav } from "./23-routing.js";
import { refreshMedia } from "./26a-media-library.js";
import { renderMedia } from "./26b-media-render.js";

export async function copyMediaMarkdown(item) {
  await copyText(mediaMarkdown(item));
  showStatus("Markdown kopiert.");
}

// Image selection reuses the real Gallery view instead of a separate (and
// fragile) picker dialog: enter a "pick" mode, let the user choose an image,
// then return to the editor and hand the chosen path to `onChoose`.
export function startImagePick(onChoose) {
  if (!state.current || !["posts", "pages"].includes(state.current.collection)) {
    showStatus("Öffne zuerst einen Artikel, um ein Bild auszuwählen.", "error");
    return;
  }
  if (!hasGithubAccess()) {
    showStatus("Verbinde GitHub, um Bilder aus der Mediathek zu laden.", "error");
    return;
  }
  // Flush a recovery copy before the editor slides behind the gallery, so the
  // article survives even a stray navigation out of the pick.
  writeAutosave();
  // A modal <dialog> sits in the top layer over the gallery; close it for the
  // pick and reopen it afterwards so the thumbnails are actually clickable.
  const reopenPublish = Boolean(els.publishDialog?.open);
  if (reopenPublish) closePublishDialog(false);
  state.socialImagePick = { returnCollection: state.current.collection, onChoose, reopenPublish };
  state.collection = "media";
  updateNav();
  els.mediaSearchInput.value = "";
  els.mediaFilterInput.value = "all";
  showView("media");
  refreshMedia(false).catch((error) => showStatus(t("media.galleryLoadFailed", { error: error.message }), "error"));
}

export function startSocialImagePick() {
  startImagePick((publicPath) => {
    els.socialImageInput.value = publicPath;
    els.socialImageInput.dispatchEvent(new Event("input", { bubbles: true }));
    showStatus(t("social.imageSet"));
  });
}

function exitSocialImagePick() {
  const pick = state.socialImagePick;
  state.socialImagePick = null;
  if (els.mediaPickBar) els.mediaPickBar.hidden = true;
  if (pick?.returnCollection) {
    state.collection = pick.returnCollection;
    updateNav();
  }
  showView("editor");
  renderMedia();
  if (pick?.reopenPublish) openPublishDialog(true);
}

export function chooseSocialImage(item) {
  if (!state.socialImagePick || !item) return;
  const onChoose = state.socialImagePick.onChoose;
  exitSocialImagePick();
  if (onChoose) onChoose(item.publicPath);
}

export function cancelSocialImagePick() {
  if (!state.socialImagePick) return;
  exitSocialImagePick();
}

function normalizeMediaReferencePath(value) {
  let text = decodeBasicHtmlEntities(stripMarkdownUrl(value)).trim();
  if (!text || /^data:/i.test(text)) return "";

  text = text.replace(/[?#].*$/, "").replace(/[.,;:!?]+$/, "");
  if (text.startsWith("/assets/images/") || text.startsWith("/assets/videos/") || text.startsWith("/assets/files/gpx/")) return text;
  if (text.startsWith("assets/images/") || text.startsWith("assets/videos/") || text.startsWith("assets/files/gpx/")) return `/${text}`;
  if (text.startsWith("blog/assets/images/") || text.startsWith("blog/assets/videos/") || text.startsWith("blog/assets/files/gpx/")) return publicMediaPath(text);

  try {
    const url = new URL(text, window.location.href);
    if (/^https?:$/i.test(url.protocol) && url.origin !== window.location.origin) return "";
    text = url.pathname;
  } catch (error) {
    // Plain Markdown/YAML paths are handled below.
  }

  text = text.replace(/[?#].*$/, "").replace(/[.,;:!?]+$/, "");
  if (text.startsWith("/assets/images/") || text.startsWith("/assets/videos/") || text.startsWith("/assets/files/gpx/")) return text;
  return "";
}

export function extractMediaReferences(content) {
  const parsed = splitDocument(content);
  const text = parsed.body || String(content || "");
  const visibleText = visibleMarkdownSource(text);
  const references = new Map();
  const add = (value, orderInEntry, alt = "") => {
    const publicPath = normalizeMediaReferencePath(value);
    if (!publicPath) return;
    const previous = references.get(publicPath);
    // First alt that says something wins: an image used twice in one post may
    // only describe itself in one of the two places.
    const keptAlt = previous?.alt || String(alt || "").trim();
    if (!previous || orderInEntry < previous.orderInEntry) {
      references.set(publicPath, { publicPath, orderInEntry, alt: keptAlt });
    } else if (keptAlt !== previous.alt) {
      references.set(publicPath, { ...previous, alt: keptAlt });
    }
  };

  findMarkdownImages(visibleText).forEach((image) => add(image.src, image.from, image.alt));
  findHtmlMedia(visibleText).forEach((media) => add(media.src, media.from, media.alt));

  findMediaShortcuts(visibleText)
    .filter((shortcut) => ["video", "gpx"].includes(shortcut.type))
    .forEach((shortcut) => add(shortcut.source, shortcut.from));

  visibleText.replace(/(^|[\s'"=])((?:\/assets\/(?:images|videos|files\/gpx)\/|assets\/(?:images|videos|files\/gpx)\/|blog\/assets\/(?:images|videos|files\/gpx)\/)[^\s'"<>)\]]+)/gim, (match, prefix, target, offset) => {
    add(target, offset + prefix.length);
    return match;
  });

  add(parsed.fields?.social_image, text.length + 1);

  return Array.from(references.values()).sort((a, b) => a.orderInEntry - b.orderInEntry);
}

function normalizedPermalink(value) {
  const text = String(value || "").trim();
  if (!text || text === "false") return "";
  if (/^https?:\/\//i.test(text)) return text;
  const withSlash = text.startsWith("/") ? text : `/${text}`;
  return withSlash.endsWith("/") || /\.[a-z0-9]+$/i.test(withSlash) ? withSlash : `${withSlash}/`;
}

function entryPublicPath(info, fields = {}) {
  const explicit = normalizedPermalink(fields.permalink);
  if (explicit) return explicit;
  const slug = String(fields.slug || info?.slug || "").replace(/^\/+|\/+$/g, "");
  return slug ? `/${slug}/` : "";
}

export function entryReferenceFromContent(path, content) {
  const info = entryInfoFromPath(path);
  if (!info) return null;

  let fields = {};
  try {
    fields = splitDocument(content).fields || {};
  } catch (error) {
    fields = {};
  }

  return {
    path,
    collection: info.collection,
    title: String(fields.title || info.title || baseName(path)).trim(),
    publicPath: entryPublicPath(info, fields),
    sortKey: Date.parse(String(fields.date || "")) || info.sortKey || 0
  };
}
