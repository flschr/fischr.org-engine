import { t } from "./00a-i18n.js";
import { collections } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { isoFromDateInputValue, localIsoWithOffset, slugify } from "./08-encoding.js";
import { SOCIAL_OFF } from "./10-social-editor.js";
import { collectSchema } from "./12-content-type.js";
import { contentTypeChanged, editorInputChanged } from "./20-editor-fields.js";

export function updateEditorViewTitle() {
  if (!els.editorViewTitle) return;
  const isPage = state.current?.collection === "pages";
  const key = state.current?.isNew
    ? (isPage ? "viewTitle.newPage" : "viewTitle.newArticle")
    : (isPage ? "viewTitle.editPage" : "viewTitle.editArticle");
  els.editorViewTitle.textContent = t(key);
}

export function collectEditorFields() {
  const collection = state.current?.collection || state.collection;
  const fields = {
    title: els.titleInput.value.trim(),
    lang: els.langInput.value || "de",
    draft: els.draftInput.checked,
    __rawFrontmatter: {}
  };
  if (collection === "posts") {
    const originalFields = state.current?.originalFields || {};
    const originalFieldBlocks = state.current?.originalFieldBlocks || {};
    const slugInput = els.slugInput.value.trim();
    const socialImageInput = els.socialImageInput.value;

    if (!editorInputChanged("slug", els.slugInput.value)) {
      fields.slug = originalFields.slug || "";
      if (originalFieldBlocks.slug) fields.__rawFrontmatter.slug = originalFieldBlocks.slug;
    } else {
      // Always store a clean slug — never spaces or stray characters.
      fields.slug = slugify(slugInput || els.titleInput.value);
    }

    if (!editorInputChanged("date", els.dateInput.value) && originalFields.date) {
      fields.date = originalFields.date;
      if (originalFieldBlocks.date) fields.__rawFrontmatter.date = originalFieldBlocks.date;
    } else {
      fields.date = isoFromDateInputValue(els.dateInput.value);
    }

    if (!editorInputChanged("socialImage", socialImageInput) && originalFields.social_image !== undefined) {
      fields.social_image = originalFields.social_image;
      if (originalFieldBlocks.social_image) fields.__rawFrontmatter.social_image = originalFieldBlocks.social_image;
    } else {
      fields.social_image = socialImageInput.trim();
    }

    // Custom post text — reuse the original raw block when untouched so an
    // existing multi-line block scalar round-trips byte-for-byte.
    if (!editorInputChanged("socialText", els.socialTextInput.value) && originalFields.social_text !== undefined) {
      fields.social_text = originalFields.social_text;
      if (originalFieldBlocks.social_text) fields.__rawFrontmatter.social_text = originalFieldBlocks.social_text;
    } else {
      fields.social_text = els.socialTextInput.value.trim();
    }

    // Social template: "" ("Default") means no explicit template — omitted
    // from frontmatter so the post follows the configured default. Only an
    // actual pick is written. "Don't share" (SOCIAL_OFF) isn't a template, so
    // it leaves any existing template untouched and just flags syndicate off.
    const chosenTemplate = els.categorySelect.value;
    const notSharing = chosenTemplate === SOCIAL_OFF;
    if (notSharing || !chosenTemplate) {
      if (notSharing && originalFields.social_template) {
        fields.social_template = originalFields.social_template;
        if (originalFieldBlocks.social_template) fields.__rawFrontmatter.social_template = originalFieldBlocks.social_template;
      } else {
        fields.social_template = "";
      }
    } else if (!editorInputChanged("socialTemplate", chosenTemplate) && originalFields.social_template) {
      fields.social_template = originalFields.social_template;
      if (originalFieldBlocks.social_template) fields.__rawFrontmatter.social_template = originalFieldBlocks.social_template;
    } else {
      fields.social_template = chosenTemplate;
    }

    // Per-post image selection (null → omitted, [] → none, [paths] → explicit).
    fields.social_images = state.current?.socialImages ?? null;

    // Posting toggle only lands in frontmatter when turned off (default = on).
    if (notSharing) fields.syndicate = false;

    // Structured-data type. If the user didn't touch the content-type controls,
    // reuse the original raw block verbatim — so a hand-authored schema (nested
    // recipe arrays, extra keys, itemType: CreativeWorkSeason, exact quoting)
    // round-trips intact. Only an actual edit regenerates the block.
    if (!contentTypeChanged() && originalFieldBlocks.schema) {
      fields.schema = originalFields.schema;
      fields.__rawFrontmatter.schema = originalFieldBlocks.schema;
    } else {
      fields.schema = collectSchema();
    }
  } else {
    const originalFields = state.current?.originalFields || {};
    const originalFieldBlocks = state.current?.originalFieldBlocks || {};
    const permalinkInput = els.permalinkInput.value;
    if (!editorInputChanged("permalink", permalinkInput) && originalFields.permalink !== undefined) {
      fields.permalink = originalFields.permalink;
      if (originalFieldBlocks.permalink) fields.__rawFrontmatter.permalink = originalFieldBlocks.permalink;
    } else {
      fields.permalink = permalinkInput.trim() || `/${slugify(els.titleInput.value)}/`;
    }
  }
  return fields;
}

export function buildEntryPath(fields, collection) {
  if (collection === "pages") {
    // A page keeps its filename once created — its slug is the URL.
    if (state.current?.path) return state.current.path;
    return `${collections.pages.dir}/${slugify(fields.title)}.md`;
  }
  // A post's filename always tracks its date + slug, so the date prefix and
  // slug part stay honest when either changes. A change renames the file on
  // save (see the rename handling in saveEntry). The public URL comes from the
  // `slug` frontmatter, not the filename, so a rename never moves the post.
  const datePrefix = String(fields.date || localIsoWithOffset()).slice(0, 10);
  return `${collections.posts.dir}/${datePrefix}-${fields.slug || slugify(fields.title)}.md`;
}
