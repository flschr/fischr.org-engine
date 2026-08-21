const { escapeHtml, normalizeEmbedUrl } = require("./html");

function normalizeSource(value = "") {
  let source = normalizeEmbedUrl(value);
  if (source.startsWith("assets/files/gpx/")) source = `/${source}`;
  if (!source.startsWith("/assets/files/gpx/") || source.includes("\\") || source.split(/[?#]/)[0].split("/").includes("..")) return "";
  return /\.gpx(?:[?#].*)?$/i.test(source) ? source : "";
}

function normalizeActivity(value = "") {
  const activity = String(value).trim().toLowerCase();
  if (["rad", "radfahren", "bike", "cycling"].includes(activity)) return "cycling";
  if (["wandern", "wanderung", "hike", "hiking", "walk", "walking"].includes(activity)) return "hiking";
  if (["laufen", "lauf", "run", "running"].includes(activity)) return "running";
  return "cycling";
}

function createGpxEmbedHelpers(options = {}) {
  const assetUrl = options.assetUrl || ((value) => value);

  function renderEmbed(src = "", renderOptions = {}) {
    const source = normalizeSource(src);
    if (!source) return "";
    const activity = normalizeActivity(renderOptions.activity);
    const label = escapeHtml(source.split("/").pop().replace(/[?#].*$/, "") || "Tour.gpx");
    const escapedSource = escapeHtml(source);

    return `<figure class="gpx-embed" data-gpx-src="${escapedSource}" data-gpx-activity="${activity}">
  <div class="gpx-header">
    <strong class="gpx-title">Tour</strong>
    <a class="gpx-download" href="${escapedSource}" download>GPX herunterladen</a>
  </div>
  <div class="gpx-map-shell">
    <div class="gpx-map-placeholder">
      <p>Die Karte wird von OpenStreetMap geladen.</p>
      <button class="gpx-map-load" type="button">Karte laden</button>
    </div>
    <div class="gpx-map" hidden></div>
  </div>
  <div class="gpx-elevation" aria-label="Höhenprofil"></div>
  <dl class="gpx-stats" aria-label="Tourstatistik"></dl>
  <p class="gpx-status" role="status">Tourdaten werden geladen …</p>
  <noscript><p><a href="${escapedSource}">${label} herunterladen</a></p></noscript>
</figure>`;
  }

  function renderFeed(content = "") {
    return String(content).replace(
      /<figure class="gpx-embed"[^>]*data-gpx-src="([^"]+)"[\s\S]*?<\/figure>/gi,
      (match, src) => `<p><a href="${escapeHtml(src)}">GPX-Tour herunterladen</a></p>`
    );
  }

  function appendLoader(content = "") {
    if (!content.includes("data-gpx-src")) return content;
    const stylesheet = assetUrl("/assets/css/gpx.css");
    const coreScript = assetUrl("/assets/js/gpx-core.js");
    const viewerScript = assetUrl("/assets/js/gpx-viewer.js");
    if (content.includes(viewerScript)) return content;
    const withStyles = content.includes(stylesheet)
      ? content
      : content.replace(/<\/head>/i, `  <link rel="stylesheet" href="${stylesheet}">\n  </head>`);
    return withStyles.replace(
      /<\/body>/i,
      `  <script src="${coreScript}" defer></script>\n  <script src="${viewerScript}" defer></script>\n  </body>`
    );
  }

  return { appendLoader, renderEmbed, renderFeed };
}

module.exports = { createGpxEmbedHelpers, normalizeActivity, normalizeSource };
