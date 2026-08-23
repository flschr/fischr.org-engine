import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { rawGitHubImageUrl } from "./07-images.js";
import { ruleImageCount, socialEffectiveRule } from "./10-social-editor.js";
import { updateSocialPanel } from "./13-publish-dialog.js";
import { startImagePick } from "./15-media-references.js";
import { pendingImageDataUrl } from "./16-alt-text.js";

// --- Per-post image selection ---
// state.current.socialImages: null = use the category default count, [] = no
// image, [paths] = an explicit ordered selection (max 4).

function socialNormalizePath(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.startsWith("https://mysite.example/")) return new URL(v).pathname;
  return v;
}

function socialBodyImagePaths() {
  const paths = [];
  const re = /!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  let match;
  while ((match = re.exec(state.bodyMarkdown || ""))) {
    const path = socialNormalizePath(match[1]);
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

// Candidate images for a post, in order: the lead (social_image) then body
// images, deduped.
function socialCandidateImagePaths() {
  const paths = [];
  const lead = socialNormalizePath(els.socialImageInput.value);
  if (lead) paths.push(lead);
  socialBodyImagePaths().forEach((path) => { if (!paths.includes(path)) paths.push(path); });
  return paths;
}

// The first-N images the category default would attach.
function socialDefaultImagePaths() {
  const count = ruleImageCount(socialEffectiveRule());
  return count <= 0 ? [] : socialCandidateImagePaths().slice(0, count);
}

// The images that will actually be attached: an explicit per-post selection,
// else the category default (so an untouched post keeps following the
// template, even if its image count changes later — socialImages stays null
// until the first manual toggle materialises it into an explicit list).
function socialEffectiveSelection() {
  return Array.isArray(state.current?.socialImages)
    ? state.current.socialImages
    : socialDefaultImagePaths();
}

// The strip is always visible now, so there is no mode to sync — just redraw.
export function syncImageControls() {
  renderImagePicker();
}

function toggleImageSelection(path) {
  if (!state.current) return;
  // Seed from what is currently lit (template default when untouched) so a
  // click on a pre-selected thumb actually removes it.
  const list = socialEffectiveSelection().slice();
  const index = list.indexOf(path);
  if (index >= 0) list.splice(index, 1);
  else if (list.length >= 4) { showStatus("Maximum 4 images.", "error"); return; }
  else list.push(path);
  state.current.socialImages = list; // now an explicit selection ([] = none)
  renderImagePicker();
  updateSocialPanel();
}

// The publish strip can show a dozen-plus candidate images at once. Pointing
// each <img> straight at the full-resolution original (700KB–1MB webp, several
// megapixels) floods the modal with decoded bitmaps — enough GPU/memory
// pressure that typing in the dialog stutters for seconds. Downscale each
// candidate to a small thumbnail once (off the typing path, cached by path) so
// the strip stays cheap to keep on screen.
const socialThumbCache = new Map();
const SOCIAL_THUMB_MAX_SIDE = 200;

function fillSocialThumb(path, imgEl) {
  const cached = socialThumbCache.get(path);
  if (cached) { imgEl.src = cached; return; }
  // Source order mirrors the gallery: a freshly-uploaded-but-uncommitted image
  // from its local data URL, otherwise the public path, with a raw-GitHub
  // fallback for a draft whose images are committed but not yet deployed.
  const primary = pendingImageDataUrl(path) || path;
  const fallback = rawGitHubImageUrl(path);
  const loader = new Image();
  // No crossOrigin: a same-origin /assets path and a data URL are both
  // canvas-readable without it, while setting it would make the cross-origin
  // raw-GitHub fallback fail to load outright when GitHub omits CORS headers.
  loader.decoding = "async";
  let usedFallback = false;
  loader.onload = () => {
    let src;
    try {
      const longest = Math.max(loader.naturalWidth, loader.naturalHeight) || 1;
      const scale = Math.min(1, SOCIAL_THUMB_MAX_SIDE / longest);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(loader.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(loader.naturalHeight * scale));
      canvas.getContext("2d").drawImage(loader, 0, 0, canvas.width, canvas.height);
      src = canvas.toDataURL("image/jpeg", 0.7);
      socialThumbCache.set(path, src);
    } catch {
      // A cross-origin source without CORS taints the canvas; show the full
      // image for that one rather than nothing (correct, just not downscaled).
      src = loader.src;
    }
    imgEl.src = src;
  };
  loader.onerror = () => {
    if (!usedFallback && fallback && fallback !== loader.src) {
      usedFallback = true;
      loader.src = fallback;
    }
  };
  loader.src = primary;
}

function renderImagePicker() {
  const thumbs = els.socialImageThumbs;
  if (!thumbs) return;
  thumbs.innerHTML = "";
  const selected = socialEffectiveSelection();
  const candidates = socialCandidateImagePaths();
  selected.forEach((path) => { if (!candidates.includes(path)) candidates.push(path); });
  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.className = "social-hint";
    empty.textContent = "No images in the post — add them from the gallery.";
    thumbs.append(empty);
    return;
  }
  // A template that attaches no images shouldn't preview a wall of thumbnails
  // that won't be sent — show a hint and let "+ from gallery" opt in instead.
  if (!selected.length) {
    const none = document.createElement("p");
    none.className = "social-hint";
    none.textContent = "Diese Vorlage teilt keine Bilder.";
    thumbs.append(none);
    return;
  }
  candidates.forEach((path) => {
    const order = selected.indexOf(path);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `social-thumb${order >= 0 ? " is-selected" : ""}`;
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    fillSocialThumb(path, image);
    button.append(image);
    if (order >= 0) {
      const badge = document.createElement("span");
      badge.className = "social-thumb-badge";
      badge.textContent = String(order + 1);
      button.append(badge);
    }
    button.addEventListener("click", () => toggleImageSelection(path));
    thumbs.append(button);
  });
}

export function addGalleryImage() {
  startImagePick((publicPath) => {
    if (!state.current) return;
    const path = socialNormalizePath(publicPath);
    const list = socialEffectiveSelection().slice();
    if (path && !list.includes(path) && list.length < 4) list.push(path);
    state.current.socialImages = list;
    syncImageControls();
    updateSocialPanel();
  });
}
