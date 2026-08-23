const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { filesBelow } = require("./generated-asset-manifest");
const { adminVendorBundles } = require("./runtime-vendors");

const adminRoot = "blog/admin";
const adminTemplate = "blog/admin/index.html";
const includesRoot = "blog/_includes";

// Everything under blog/admin/ that is never deployed as it stands: index.html is a Nunjucks
// template rendered by Eleventy, the three *-src directories are build inputs, and vendor/ is
// reachable only through the bundles declared in runtime-vendors.js. Anything else at the top
// level is copied through verbatim.
const buildOnlyAdminEntries = Object.freeze(["index.html", "editor-src", "admin-src", "css-src", "vendor"]);

// Finder writes .DS_Store into any directory it is pointed at, and AppleDouble files appear
// beside them on non-native filesystems. Deploying them would be pointless; letting them into
// the version would recreate the very drift this hash exists to avoid, because they exist on
// one machine and not on the next.
const operatingSystemNoise = /^(?:\.DS_Store|\._.*|Thumbs\.db)$/;

// Nunjucks inlines these fragments into the deployed shell, so their content is part of the
// admin the browser receives even though they live outside blog/admin/. Collected from the
// template itself rather than listed by hand: a fragment added later is covered on its own.
const templateReferencePattern = /\{%-?\s*(?:include|extends|import|from)\s+["']([^"']+)["']/g;

function repoRelative(file) {
  return file.split(path.sep).join("/");
}

// Top-level entries of blog/admin/ whose contents Eleventy deploys unchanged.
function adminPassthroughEntries(root) {
  return fs
    .readdirSync(path.join(root, adminRoot))
    .filter((entry) => !buildOnlyAdminEntries.includes(entry))
    .sort();
}

// Every file copied verbatim to /admin/. Drives the passthrough itself, so what is deployed
// and what is hashed are one list rather than two mechanisms that agree today.
function adminDeployedFiles(root) {
  const files = [
    ...adminPassthroughEntries(root).flatMap((entry) => filesBelow(root, path.join(adminRoot, entry))),
    ...Object.values(adminVendorBundles)
  ];
  return [...new Set(files.map(repoRelative))]
    .filter((file) => !operatingSystemNoise.test(path.basename(file)))
    .sort();
}

// The fragments a template pulls in, transitively. An unresolvable reference is left to
// Eleventy, which fails the build over it far more clearly than a missing hash input would.
function templateFragments(root, template, seen = new Set()) {
  const source = fs.readFileSync(path.join(root, template), "utf8");
  return [...source.matchAll(templateReferencePattern)].flatMap(([, reference]) => {
    const fragment = `${includesRoot}/${reference}`;
    if (seen.has(fragment) || !fs.existsSync(path.join(root, fragment))) return [];
    seen.add(fragment);
    return [fragment, ...templateFragments(root, fragment, seen)];
  });
}

// Every file whose content ends up in the deployed admin: the shell template, the fragments it
// inlines, and everything copied verbatim. Deliberately not "everything below blog/admin/":
// build inputs produce the vendor bundles that are hashed anyway, and an ignored leftover in
// vendor/ is not deployed, so neither may move the version.
function adminBundleFiles(root) {
  return [adminTemplate, ...templateFragments(root, adminTemplate), ...adminDeployedFiles(root)].sort();
}

// Registration hash for the admin service worker: changes exactly when the deployed admin does.
function adminBundleVersion(root) {
  const hash = crypto.createHash("sha256");
  for (const file of adminBundleFiles(root)) {
    hash.update(file).update("\0").update(fs.readFileSync(path.join(root, file))).update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

module.exports = { adminBundleFiles, adminBundleVersion, adminDeployedFiles, buildOnlyAdminEntries, templateFragments };
