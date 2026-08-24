import { altTextMaxDataUrlLength, altTextMaxImageSide } from "./00-konstanten.js";
import { t } from "./00a-i18n.js";
import { escapeMarkdownAlt, imageMimeType } from "./15a-media-reference-index.js";

import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { fileName, isVideoPath, publicMediaPath } from "./06-paths.js";
import { previewImagePath, rawGitHubImageUrl } from "./07-images.js";
import { localRenderedPath, stripMarkdownForCharacterCount, stripMarkdownUrl } from "./09-frontmatter.js";

export function pendingImageDataUrl(src) {
  const value = localRenderedPath(src);
  const normalized = String(value || "").replace(/^\/+/, "");
  if (!normalized) return "";

  const change = Array.from(state.changes.values()).find((item) => {
    if (item.collection !== "media" || item.kind !== "upsert") return false;
    if (item.mediaKind === "video" || isVideoPath(item.path)) return false;
    const publicPath = item.publicPath || publicMediaPath(item.path);
    return [publicPath, item.path, fileName(item.path)].some((candidate) => {
      const text = String(candidate || "");
      return text === value || text === normalized || text.endsWith(`/${normalized}`);
    });
  });

  if (!change) return "";
  if (change.preview) return change.preview;
  if (change.content) return `data:${imageMimeType(change.path)};base64,${change.content}`;
  return "";
}

export async function imageInputForAltText(src) {
  const value = stripMarkdownUrl(src);
  if (!value) throw new Error("Bildpfad fehlt.");
  if (/^data:image\//i.test(value)) return dataUrlForAltText(value);

  const pending = pendingImageDataUrl(value);
  if (pending) return dataUrlForAltText(pending);

  const rawUrl = rawGitHubImageUrl(value);
  if (rawUrl) return rawUrl;

  const preview = previewImagePath(value);
  const absolute = new URL(preview || value, window.location.origin).toString();
  if (!/^https?:\/\//i.test(absolute)) throw new Error("Bildadresse ist nicht erreichbar.");
  return absolute;
}

async function dataUrlForAltText(dataUrl) {
  try {
    const resized = await resizeImageDataUrl(dataUrl);
    if (resized.length <= altTextMaxDataUrlLength) return resized;
  } catch (error) {
    if (String(dataUrl).length <= altTextMaxDataUrlLength) return dataUrl;
    throw error;
  }
  if (String(dataUrl).length <= altTextMaxDataUrlLength) return dataUrl;
  throw new Error("Das Bild ist für die Alt-Text-Erzeugung zu groß.");
}

function resizeImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        reject(new Error(t("media.imageSizeUnreadable")));
        return;
      }

      const scale = Math.min(1, altTextMaxImageSide / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error(t("media.imagePrepareFailed")));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => reject(new Error(t("media.imageReadFailed")));
    image.src = dataUrl;
  });
}

// The post body (markdown stripped, trimmed) used to ground alt-text in the
// actual article — so a hiking photo reflects the real place, not "a mountain".
function altTextArticleContext() {
  return stripMarkdownForCharacterCount(state.bodyMarkdown || "").replace(/\s+/g, " ").trim().slice(0, 2000);
}

export async function requestAltText(image, src) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch("/api/admin/alt-text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        image,
        context: [els.titleInput.value, altTextArticleContext()].filter(Boolean).join("\n"),
        source: src || ""
      })
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Der Alt-Text-Dienst hat nicht rechtzeitig geantwortet.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.message || `Alt-Text-Dienst ${response.status}`);
  }

  const alt = cleanOpenAiAltText(payload.alt);
  if (!alt) throw new Error("Kein Alt-Text erhalten.");
  return escapeMarkdownAlt(alt);
}

function cleanOpenAiAltText(value) {
  return String(value || "")
    .replace(/^["'“”„]+|["'“”„]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
