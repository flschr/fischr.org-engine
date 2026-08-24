import { gotosocialTextLimit } from "./00-konstanten.js";
import { t } from "./00a-i18n.js";

import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { countTextCharacters } from "./09-frontmatter.js";
import { ruleImageCount, socialFillTemplate } from "./10-social-editor.js";
import { iconGhostButton, removeSocialCategory, textControl, updateSocialConfigDirty } from "./14a-social-controls.js";

// Which rules are expanded, tracked by object identity rather than index: an
// add/remove elsewhere shifts every later index, but the rule objects
// themselves stay the same references across a renderSocialCategoryCards()
// call, so this survives the rebuild without the list silently re-collapsing
// cards the same edit session already opened. A fresh draft (reset, or the
// new baseline after a save) creates fresh rule objects, so it starts
// everything collapsed again — that reads as "tidied up", not as a bug.
const openCategoryCards = new WeakSet();

export function markSocialCategoryOpen(rule) {
  openCategoryCards.add(rule);
}

export function renderSocialCategoryCards() {
  const list = els.socialCategoryList;
  const rules = state.socialConfigDraft?.social?.rules || [];
  list.innerHTML = "";
  if (!rules.length) {
    const empty = document.createElement("p");
    empty.className = "social-config-empty";
    empty.textContent = t("social.noPostTypes");
    list.append(empty);
    return;
  }
  rules.forEach((rule, index) => list.append(buildSocialCategoryCard(rule, index)));
}

function buildSocialCategoryCard(rule, index) {
  // <details>, not a plain div: a post type's template/options are the kind
  // of detail worth hiding until asked for — a handful of them expanded at
  // once was most of what made this page read as cluttered.
  const card = document.createElement("details");
  card.className = "social-category-card";
  card.open = openCategoryCards.has(rule);
  card.addEventListener("toggle", () => {
    if (card.open) openCategoryCards.add(rule);
    else openCategoryCards.delete(rule);
  });

  const summary = document.createElement("summary");
  summary.className = "social-category-summary";
  const summaryName = document.createElement("span");
  summaryName.className = "social-category-summary-name";
  summaryName.textContent = rule.name || t("social.noName");
  summary.append(summaryName);
  card.append(summary);

  const body = document.createElement("div");
  body.className = "social-category-body";

  // Header: editable name + remove. (The id is derived from the name on save.)
  // Lives in the collapsible body, not the summary — an <input>/<button>
  // inside a <summary> would fight the native click-to-toggle behavior of
  // the element around them.
  const head = document.createElement("div");
  head.className = "social-category-head";
  const name = textControl(rule.name || "", (value) => {
    rule.name = value;
    summaryName.textContent = value || t("social.noName");
    updateSocialConfigDirty();
  }, t("social.postTypeName"));
  name.classList.add("social-category-name");
  head.append(name);
  const remove = iconGhostButton("trash-2", t("social.removePostType"));
  remove.classList.add("danger");
  remove.addEventListener("click", () => removeSocialCategory(index));
  head.append(remove);
  body.append(head);

  const tpl = document.createElement("label");
  tpl.className = "social-category-template";
  const tplLabel = document.createElement("span");
  const tplCount = document.createElement("span");
  tplCount.className = "social-count";
  tplLabel.append(document.createTextNode(`${t("social.textTemplate")} `), tplCount);
  const tplArea = document.createElement("textarea");
  tplArea.rows = 2;
  tplArea.value = rule.template || "";
  const refreshTplCount = () => {
    const count = countTextCharacters(socialFillTemplate(tplArea.value));
    tplCount.textContent = `${count}/${gotosocialTextLimit}`;
    tplCount.dataset.state = count > gotosocialTextLimit ? "over" : "all";
  };
  tplArea.addEventListener("input", () => { rule.template = tplArea.value; refreshTplCount(); updateSocialConfigDirty(); });
  tpl.append(tplLabel, tplArea);
  card.append(tpl);
  refreshTplCount();

  const opts = document.createElement("div");
  opts.className = "social-category-opts";
  const imgLabel = document.createElement("label");
  imgLabel.className = "social-inline-field";
  const imgSpan = document.createElement("span");
  imgSpan.textContent = t("social.images");
  const imgSelect = document.createElement("select");
  // Max images attached to the post (0–4; capped at 4 by GoToSocial).
  [
    [0, t("social.imagesNone")],
    [1, t("social.images1")],
    [2, t("social.images2")],
    [3, t("social.images3")],
    [4, t("social.images4")]
  ].forEach(([value, text]) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = text;
    imgSelect.appendChild(option);
  });
  imgSelect.value = String(ruleImageCount(rule));
  imgSelect.addEventListener("change", () => { rule.images = parseInt(imgSelect.value, 10) || 0; updateSocialConfigDirty(); });
  imgLabel.append(imgSpan, imgSelect);
  opts.append(imgLabel);

  // Link toggle: off → native, linkless post (just text + images, no link card).
  const linkLabel = document.createElement("label");
  linkLabel.className = "social-inline-field social-inline-check";
  const linkInput = document.createElement("input");
  linkInput.type = "checkbox";
  linkInput.checked = rule.link !== false;
  const linkSpan = document.createElement("span");
  linkSpan.textContent = t("social.appendLink");
  linkInput.addEventListener("change", () => {
    if (linkInput.checked) delete rule.link;
    else rule.link = false;
    updateSocialConfigDirty();
  });
  linkLabel.append(linkInput, linkSpan);
  opts.append(linkLabel);

  const hint = document.createElement("span");
  hint.className = "social-category-hint";
  hint.textContent = t("social.templateHint");
  opts.append(hint);
  card.append(opts);

  return card;
}
