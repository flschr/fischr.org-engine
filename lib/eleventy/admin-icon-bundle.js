const fs = require("fs");
const path = require("path");

const ICONS = ["bar-chart-2", "bold", "chevron-down", "chevron-left", "chevron-right", "chevron-up", "circle-alert", "code", "ellipsis", "external-link", "eye", "eye-off", "file", "file-text", "highlighter", "image", "italic", "link", "route", "pencil-line", "plus", "redo-2", "refresh-cw", "save", "send", "settings", "sliders-horizontal", "sparkles", "strikethrough", "superscript", "trash-2", "undo-2"];

function normalizeIcon(name, raw) {
  const className = `rw-icon rw-icon-${name.replace(/[^a-z0-9-]/g, "-")}`;
  return raw.replace(/<!--[\s\S]*?-->/g, "").trim().replace(/\s+class="[^"]*"/, "").replace(/\s+xmlns="[^"]*"/, "")
    .replace(/\s+width="[^"]*"/, "").replace(/\s+height="[^"]*"/, "").replace(/<svg\b/, `<svg class="${className}" aria-hidden="true"`)
    .replace(/\s+/g, " ").replace(/> </g, "><");
}

function buildIconBundle({ root, outfile }) {
  const iconsDir = path.join(root, "node_modules/lucide-static/icons");
  const packageFile = path.join(root, "node_modules/lucide-static/package.json");
  if (!fs.existsSync(iconsDir)) throw new Error("lucide-static not installed. Run: npm install");
  const icons = Object.fromEntries(ICONS.map((name) => [name, normalizeIcon(name, fs.readFileSync(path.join(iconsDir, `${name}.svg`), "utf8"))]));
  const version = JSON.parse(fs.readFileSync(packageFile, "utf8")).version || "unknown";
  const body = [`/* @license lucide-static v${version} - ISC */`, "(() => {", `  const icons = ${JSON.stringify(icons)};`, "  function svg(name) { return icons[name] || \"\"; }", "  function setIcon(element, name) { const markup = svg(name); if (markup) element.innerHTML = markup; }", "  function inject(root = document) { root.querySelectorAll(\"[data-icon]\").forEach((element) => setIcon(element, element.getAttribute(\"data-icon\"))); }", "  window.RWIcons = { svg, inject, setIcon };", "  if (document.readyState === \"loading\") document.addEventListener(\"DOMContentLoaded\", () => inject());", "  else inject();", "})();", ""].join("\n");
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, body, "utf8");
}

module.exports = { buildIconBundle };
