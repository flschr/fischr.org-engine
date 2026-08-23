import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { hasGithubAccess } from "./05-github-auth.js";
import { buildMediaThumbImage } from "./07-images.js";
import { chooseSocialImage, copyMediaMarkdown } from "./15-media-references.js";
import { mediaSearchText } from "./15a-media-reference-index.js";
import { mediaMetaText, mediaReferencesSignature, queueMediaDelete, renderMediaReferences } from "./26d-media-metadata.js";
import { hasActiveMediaWork } from "./26d-publish-sync.js";

export function renderMedia() {
  const query = els.mediaSearchInput.value.trim().toLowerCase();
  const filter = els.mediaFilterInput.value;
  const pendingDeletes = new Set(
    Array.from(state.changes.values())
      .filter((change) => change.collection === "media" && change.kind === "delete")
      .map((change) => change.path)
  );

  const items = state.media.filter((item) => {
    const matchesQuery = !query || mediaSearchText(item).includes(query);
    const matchesFilter =
      filter === "all" ||
      (filter === "duplicates" && item.duplicate) ||
      (filter === "pending" && (item.pending || pendingDeletes.has(item.path)));
    return matchesQuery && matchesFilter;
  });

  els.mediaGrid.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "entry-empty";
    empty.textContent = !hasGithubAccess()
      ? "Verbinde GitHub, um Medien zu laden."
      : query ? "No matches." : "No media yet.";
    els.mediaGrid.append(empty);
    return;
  }

  const picking = Boolean(state.socialImagePick);
  if (els.mediaPickBar) els.mediaPickBar.hidden = !picking;

  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    // A social image must be an actual image — hide videos in pick mode.
    if (picking && item.mediaKind === "video") return;

    const isPendingDelete = pendingDeletes.has(item.path);
    const hasPendingChange = item.pending || isPendingDelete;
    const card = document.createElement("article");
    card.className = "media-item";
    card.dataset.mediaPath = item.path;
    card.dataset.mediaReferences = mediaReferencesSignature(item);
    if (hasPendingChange) card.classList.add("has-local-change");

    const thumb = document.createElement("div");
    thumb.className = "media-thumb";
    if (item.mediaKind === "video") {
      const video = document.createElement("video");
      video.src = item.preview || item.publicPath;
      video.poster = item.poster || "";
      video.preload = "none";
      video.muted = true;
      video.playsInline = true;
      thumb.append(video);
    } else {
      thumb.append(buildMediaThumbImage(item));
    }

    const info = document.createElement("div");
    info.className = "media-info";
    const name = document.createElement("div");
    name.className = "media-name";
    name.textContent = item.name;
    name.title = item.name;

    const meta = document.createElement("span");
    meta.className = "entry-meta";
    meta.textContent = mediaMetaText(item, isPendingDelete);

    const references = renderMediaReferences(item.references || []);

    // Pick mode: the whole card selects the image as the post's social image.
    if (picking) {
      card.classList.add("is-picking");
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      card.setAttribute("aria-label", `Als Vorschaubild auswählen: ${item.name}`);
      const choose = () => chooseSocialImage(item);
      card.addEventListener("click", choose);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose();
        }
      });
      info.append(name, meta);
      if (references) info.append(references);
      card.append(thumb, info);
      fragment.append(card);
      return;
    }

    const actions = document.createElement("div");
    actions.className = "media-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "ghost";
    copyButton.textContent = "Kopieren";
    copyButton.title = "Markdown kopieren";
    copyButton.setAttribute("aria-label", "Markdown kopieren");
    copyButton.addEventListener("click", async () => {
      copyButton.disabled = true;
      try {
        await copyMediaMarkdown(item);
      } catch (error) {
        showStatus(`Kopieren fehlgeschlagen: ${error.message}`, "error");
      } finally {
        copyButton.disabled = false;
      }
    });
    actions.append(copyButton);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ghost danger";
    deleteButton.textContent = "Löschen";
    deleteButton.disabled = hasActiveMediaWork();
    deleteButton.addEventListener("click", async () => {
      deleteButton.disabled = true;
      try {
        await queueMediaDelete(item);
      } catch (error) {
        showStatus(`Löschen fehlgeschlagen: ${error.message}`, "error");
      } finally {
        deleteButton.disabled = hasActiveMediaWork();
      }
    });
    actions.append(deleteButton);

    info.append(name, meta);
    if (references) info.append(references);
    info.append(actions);
    card.append(thumb, info);
    fragment.append(card);
  });
  els.mediaGrid.append(fragment);
}
