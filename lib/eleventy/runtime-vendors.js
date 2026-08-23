const adminVendorBundles = Object.freeze({
  app: "blog/admin/vendor/app/admin.js",
  editor: "blog/admin/vendor/editor/editor.js",
  icons: "blog/admin/vendor/icons/icons.js",
  "markdown-it": "blog/admin/vendor/markdown-it/markdown-it.min.js",
  styles: "blog/admin/vendor/styles/admin.css"
});

const publicStyleBundles = Object.freeze({
  main: "blog/assets/css/generated/main.css"
});

const styleSources = Object.freeze({
  main: Object.freeze([
    "blog/assets/css-src/main/01-tokens.css",
    "blog/assets/css-src/main/02-document-base.css",
    "blog/assets/css-src/main/03-typography.css",
    "blog/assets/css-src/main/04-site-chrome.css",
    "blog/assets/css-src/main/04a-site-brand.css",
    "blog/assets/css-src/main/05-content-primitives.css",
    "blog/assets/css-src/main/09-author-card.css",
    "blog/assets/css-src/main/10-about.css",
    "blog/assets/css-src/main/11-projects.css",
    "blog/assets/css-src/main/12-stream-article.css",
    "blog/assets/css-src/main/13-rich-content-media.css",
    "blog/assets/css-src/main/13a-admonitions.css",
    "blog/assets/css-src/main/14-syntax-highlight.css",
    "blog/assets/css-src/main/20-embed-poster.css",
    "blog/assets/css-src/main/21-search-pagination.css",
    "blog/assets/css-src/main/90-responsive.css"
  ]),
  admin: Object.freeze([
    "blog/admin/css-src/01-tokens.css",
    "blog/admin/css-src/01-base.css",
    "blog/admin/css-src/01-controls.css",
    "blog/admin/css-src/01a-shell.css",
    "blog/admin/css-src/02-layout.css",
    "blog/admin/css-src/02-queue.css",
    "blog/admin/css-src/02-setup.css",
    "blog/admin/css-src/02-queue-progress.css",
    "blog/admin/css-src/03-editor.css",
    "blog/admin/css-src/03-editor-meta.css",
    "blog/admin/css-src/03a-settings.css",
    "blog/admin/css-src/04-social-picker.css",
    "blog/admin/css-src/04-publish-dialog.css",
    "blog/admin/css-src/04-media-library.css",
    "blog/admin/css-src/04-dialogs.css",
    "blog/admin/css-src/05-stats.css",
    "blog/admin/css-src/05a-stats-controls.css",
    "blog/admin/css-src/06-responsive.css"
  ])
});

const generatedAssets = Object.freeze({ ...adminVendorBundles, ...publicStyleBundles });

const leafletRuntimeAssets = Object.freeze([
  ["node_modules/leaflet/dist/leaflet.css", "assets/vendor/leaflet/leaflet.css"],
  ["node_modules/leaflet/dist/leaflet.js", "assets/vendor/leaflet/leaflet.js"],
  ["node_modules/leaflet/dist/images", "assets/vendor/leaflet/images"]
]);

module.exports = {
  adminVendorBundles,
  generatedAssets,
  publicStyleBundles,
  styleSources,
  leafletRuntimeAssets
};
