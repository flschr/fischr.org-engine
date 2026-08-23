import { findMarkdownImages, markdownAltHasText } from "./15a-media-reference-index.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { previewImagePath, rawGitHubImageUrl } from "./07-images.js";
import { imageInputForAltText, requestAltText } from "./16-alt-text.js";
import { ensureEditor, setEditorMode, syncEditorFromVisible } from "./17-editor.js";

export async function generateMissingAltTexts() {
  if (!state.current || !["posts", "pages"].includes(state.current.collection)) return;
  if (state.editorMode === "preview") setEditorMode("markdown");
  const editor = ensureEditor();
  if (!editor) return;

  syncEditorFromVisible();
  const images = findMarkdownImages(state.bodyMarkdown).filter((image) => {
    return image.src && !markdownAltHasText(image.alt);
  });

  if (!images.length) {
    showStatus("Alle Bilder haben bereits einen Alt-Text.");
    return;
  }

  const replacements = [];
  const failures = [];
  setBusy(true);

  try {
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      showStatus(`Alt-Text ${index + 1}/${images.length} wird erzeugt …`);

      try {
        const input = await imageInputForAltText(image.src);
        const alt = await requestAltText(input, image.src);
        if (!alt) throw new Error("Leere Antwort.");
        replacements.push({
          from: image.from,
          to: image.to,
          insert: `![${alt}](${image.target})`
        });
      } catch (error) {
        failures.push({ image, error });
        console.warn("[admin] Alt text failed:", image.src, error);
      }
    }

    if (replacements.length) {
      editor.replaceRanges(replacements);
      syncEditorFromVisible();
    }

    const inserted = replacements.length === 1 ? "1 Alt-Text eingefügt" : `${replacements.length} Alt-Texte eingefügt`;
    if (failures.length) {
      const firstError = String(failures[0].error?.message || "Alt-Text konnte nicht erzeugt werden.");
      const message = replacements.length
        ? `${inserted}; ${failures.length} übersprungen.`
        : firstError;
      showStatus(message, replacements.length ? "info" : "error");
    } else {
      showStatus(`${inserted}.`);
    }
  } finally {
    setBusy(false);
  }
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPreview(markdown) {
  return window.RWPreviewRenderer.render(markdown, {
    lang: els.langInput.value || "de",
    imagePreview: previewImagePath,
    imageFallback: rawGitHubImageUrl
  });
}

export function bindPreviewImageFallbacks() {
  Array.from(els.previewPanel.querySelectorAll("img[data-fallback-src]")).forEach((image) => {
    if (image.dataset.fallbackBound) return;
    image.dataset.fallbackBound = "true";
    image.addEventListener("error", () => {
      if (image.dataset.fallbackUsed || !image.dataset.fallbackSrc) return;
      image.dataset.fallbackUsed = "true";
      image.src = image.dataset.fallbackSrc;
    });
  });
}
