import { gotosocialTextLimit } from "./00-konstanten.js";
import { t } from "./00a-i18n.js";
import { findMarkdownImages, markdownAltHasText } from "./15a-media-reference-index.js";

import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { slugify } from "./08-encoding.js";
import { countTextCharacters } from "./09-frontmatter.js";
import { SOCIAL_OFF, socialApplyLinkToggle, socialBodyExcerpt, socialEffectiveRule, socialEffectiveText, socialFillTemplate, socialRuleWantsLink } from "./10-social-editor.js";
import { initSocialPanel, populateSocialCategoryOptions } from "./10a-social-editor-ui.js";
import { syncImageControls } from "./11-social-images.js";
import { syncContentTypeFields } from "./12-content-type.js";
import { generateMissingAltTexts } from "./16a-alt-text-actions.js";
import { syncEditorFromVisible } from "./17-editor.js";
import { saveWithProgress } from "./25b-publish-actions.js";

// --- Publish dialog ---

// Snapshot the dialog's controls so Abbrechen/Esc can fully revert (the
// controls double as the post's record, read by collectEditorFields).
function captureDialogBackup() {
  state.publishBackup = {
    socialTemplate: els.categorySelect.value,
    socialImages: Array.isArray(state.current?.socialImages) ? state.current.socialImages.slice() : (state.current?.socialImages ?? null),
    socialText: els.socialTextInput.value,
    socialImage: els.socialImageInput.value,
    contentType: els.contentTypeSelect.value,
    reviewItemName: els.reviewItemName.value,
    reviewRating: els.reviewRating.value,
    reviewBest: els.reviewBest.value,
    reviewAuthor: els.reviewAuthor.value,
    reviewSameAs: els.reviewSameAs.value
  };
}

export function restoreDialogBackup() {
  const b = state.publishBackup;
  if (!b) return;
  els.categorySelect.value = b.socialTemplate;
  const off = b.socialTemplate === SOCIAL_OFF;
  if (state.current) {
    state.current.socialSyndicate = !off;
    if (!off) state.current.socialTemplate = b.socialTemplate;
    state.current.socialImages = Array.isArray(b.socialImages) ? b.socialImages.slice() : b.socialImages;
  }
  els.socialTextInput.value = b.socialText;
  els.socialImageInput.value = b.socialImage;
  els.contentTypeSelect.value = b.contentType;
  els.reviewItemName.value = b.reviewItemName;
  els.reviewRating.value = b.reviewRating;
  els.reviewBest.value = b.reviewBest;
  els.reviewAuthor.value = b.reviewAuthor;
  els.reviewSameAs.value = b.reviewSameAs;
  populateSocialCategoryOptions();
  syncImageControls();
  syncContentTypeFields();
  updateSocialPanel();
}

// `reopened` = coming back from the gallery picker; keep the original backup
// so Abbrechen still reverts to the pre-open state.
export function openPublishDialog(reopened) {
  if (state.current?.collection !== "posts" || !els.publishDialog) return;
  if (!reopened) captureDialogBackup();
  initSocialPanel();
  syncContentTypeFields();
  updateSocialPanel();
  if (els.publishDialogTitle) els.publishDialogTitle.textContent = t("dialog.publish");
  if (els.publishDialogConfirm) els.publishDialogConfirm.textContent = "Veröffentlichen";
  if (els.publishDialogSocialHint) els.publishDialogSocialHint.hidden = true;
  els.publishDialog.showModal();
  // showModal() auto-focuses the first control (the content-type <select>),
  // which iOS Safari then pops open. Park focus on the non-interactive title.
  els.publishDialogTitle?.focus({ preventScroll: true });
}

export function closePublishDialog(restore) {
  if (restore) restoreDialogBackup();
  if (els.publishDialog?.open) els.publishDialog.close();
}

export async function confirmPublishDialog() {
  syncEditorFromVisible();
  const missingAltTexts = findMarkdownImages(state.bodyMarkdown).filter((image) => {
    return image.src && !markdownAltHasText(image.alt);
  });
  if (missingAltTexts.length) {
    closePublishDialog(false);
    const generate = await askMissingAltTextAction(missingAltTexts.length);
    if (generate) {
      await generateMissingAltTexts();
      return;
    }
  } else {
    closePublishDialog(false);
  }
  const ok = await saveWithProgress("publish");
  if (!ok) openPublishDialog(true); // keep the dialog around to retry
}

function askMissingAltTextAction(count) {
  if (!els.missingAltDialog || !els.missingAltDialogText) return Promise.resolve(false);
  els.missingAltDialogText.textContent = count === 1
    ? t("dialog.missingAltTextSingular")
    : t("dialog.missingAltTextPlural", { count });
  els.missingAltDialog.returnValue = "no";
  return new Promise((resolve) => {
    const resolveWithValue = () => resolve(els.missingAltDialog.returnValue === "generate");
    els.missingAltDialog.addEventListener("close", resolveWithValue, { once: true });
    els.missingAltDialog.showModal();
  });
}

export function updateSocialPanel() {
  if (!els.publishDialog || state.current?.collection !== "posts") return;

  const posting = els.categorySelect.value !== SOCIAL_OFF;
  const rule = socialEffectiveRule();
  const wantsLink = socialRuleWantsLink(rule);

  // "Don't share" greys + disables the share details (text/images/link) while
  // leaving the select live, so nothing collapses and the dialog never jumps.
  if (els.shareDetails) {
    els.shareDetails.classList.toggle("is-disabled", !posting);
    els.shareDetails.inert = !posting;
  }

  // Placeholder shows just the message part of the template — the link is
  // rendered as a pinned suffix inside the field below, so don't repeat it.
  els.socialTextInput.placeholder = rule
    ? socialFillTemplate(socialApplyLinkToggle(rule.template, false), socialBodyExcerpt())
    : t("social.noDefaultText");

  // The link the template appends isn't part of the editable text, so show it
  // as a read-only suffix pinned at the end of the text field — always visible
  // when the template forces a link, whatever the user types above it.
  const text = rule ? socialEffectiveText(rule) : "";
  const custom = els.socialTextInput.value.trim();
  if (rule && wantsLink && !/\{link\}/.test(custom)) {
    const slug = els.slugInput.value || slugify(els.titleInput.value || "");
    const url = `${(state.socialConfig?.siteUrl || "https://mysite.example").replace(/\/$/, "")}/${slug}/`;
    els.socialLinkHint.hidden = false;
    els.socialLinkHint.textContent = url;
  } else {
    els.socialLinkHint.hidden = true;
  }

  const count = countTextCharacters(text);
  const over = count > gotosocialTextLimit ? "over" : "all";
  els.socialTextCount.textContent = rule ? `${count}/${gotosocialTextLimit}` : "";
  els.socialTextCount.dataset.state = over;
}
