import { gotosocialTextLimit } from "./00-konstanten.js";

import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { countTextCharacters } from "./09-frontmatter.js";
import { ruleImageCount, socialFillTemplate } from "./10-social-editor.js";
import { iconGhostButton, removeSocialCategory, textControl, updateSocialConfigDirty } from "./14a-social-controls.js";

export function renderSocialCategoryCards() {
  const list = els.socialCategoryList;
  const rules = state.socialConfigDraft?.social?.rules || [];
  list.innerHTML = "";
  if (!rules.length) {
    const empty = document.createElement("p");
    empty.className = "social-config-empty";
    empty.textContent = "No post types yet. Add one.";
    list.append(empty);
    return;
  }
  rules.forEach((rule, index) => list.append(buildSocialCategoryCard(rule, index)));
}

function buildSocialCategoryCard(rule, index) {
  const card = document.createElement("div");
  card.className = "social-category-card";

  // Header: editable name + remove. (The id is derived from the name on save.)
  const head = document.createElement("div");
  head.className = "social-category-head";
  const name = textControl(rule.name || "", (value) => { rule.name = value; updateSocialConfigDirty(); }, "Post type name");
  name.classList.add("social-category-name");
  head.append(name);
  const remove = iconGhostButton("trash-2", "Remove post type");
  remove.classList.add("danger");
  remove.addEventListener("click", () => removeSocialCategory(index));
  head.append(remove);
  card.append(head);

  const tpl = document.createElement("label");
  tpl.className = "social-category-template";
  const tplLabel = document.createElement("span");
  const tplCount = document.createElement("span");
  tplCount.className = "social-count";
  tplLabel.append(document.createTextNode("Text template "), tplCount);
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
  imgSpan.textContent = "Images";
  const imgSelect = document.createElement("select");
  // Max images attached to the post (0–4; capped at 4 by GoToSocial).
  [[0, "None"], [1, "1 image"], [2, "2 images"], [3, "3 images"], [4, "4 images"]].forEach(([value, text]) => {
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
  linkSpan.textContent = "Append link";
  linkInput.addEventListener("change", () => {
    if (linkInput.checked) delete rule.link;
    else rule.link = false;
    updateSocialConfigDirty();
  });
  linkLabel.append(linkInput, linkSpan);
  opts.append(linkLabel);

  const hint = document.createElement("span");
  hint.className = "social-category-hint";
  hint.textContent = "Placeholders: {title} · {content} — the checkbox controls the link";
  opts.append(hint);
  card.append(opts);

  return card;
}
