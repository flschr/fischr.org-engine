const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { adminVendorBundles, generatedAssets, leafletRuntimeAssets, publicStyleBundles } = require("../lib/eleventy/runtime-vendors");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("keeps the private admin app out of public collections and the sitemap", () => {
  const adminTemplate = source("blog/admin/index.html");

  assert.match(adminTemplate, /^---\nsitemap: false\neleventyExcludeFromCollections: true\n---\n/);
});

test("every production deploy uses the shared validation gate", () => {
  const sharedGate = source(".github/actions/validate-site/action.yml");
  const buildWorkflow = source(".github/workflows/build.yml");
  const adminPublishWorkflow = source(".github/workflows/admin-publish.yml");
  const packageScripts = JSON.parse(source("package.json")).scripts;

  for (const command of ["npm run validate:site", "npm run test:smoke:prepared", "npm run check:links", "npm run check:social"]) {
    assert.match(sharedGate, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(packageScripts["validate:site"], /npm run admin:vendor/);
  assert.equal(packageScripts["test:smoke"], "playwright test");
  assert.equal(packageScripts["test:smoke:prepared"], "PLAYWRIGHT_PREPARED_SITE=1 playwright test");
  assert.match(source("playwright.config.js"), /process\.env\.PLAYWRIGHT_PREPARED_SITE === "1"[\s\S]*npm run build && node scripts\/serve-built-site\.js/);
  assert.match(packageScripts["validate:site"], /npm run test:prepared/);
  assert.match(packageScripts["validate:site"], /npm run build:prepared/);
  assert.match(packageScripts["test:prepared"], /npm run admin:vendor:check/);
  assert.match(packageScripts["lint:prepared"], /npm run admin:vendor:check/);
  assert.match(packageScripts["build:prepared"], /npm run build:site/);
  assert.match(packageScripts["build:site"], /npm run check:deployment-vendors/);
  assert.match(packageScripts["validate:content"], /npm run admin:vendor/);
  assert.match(packageScripts["validate:content"], /npm run build:site/);
  assert.doesNotMatch(packageScripts["validate:content"], /test|lint/);
  assert.doesNotMatch(packageScripts["test:prepared"], /npm run admin:vendor(?:\s|$)/);
  assert.doesNotMatch(packageScripts["build:prepared"], /npm run admin:vendor(?:\s|$)/);
  assert.match(buildWorkflow, /uses: \.\/\.github\/actions\/validate-site/);
  assert.match(adminPublishWorkflow, /uses: \.\/\.github\/actions\/validate-site/);
  assert.match(sharedGate, /archive\.ubuntu\.com\/ubuntu/);
  assert.match(sharedGate, /npx playwright install --with-deps chromium webkit/);
  assert.equal((sharedGate.match(/if: inputs\.validation_mode != 'content'/g) || []).length, 4);
  assert.match(sharedGate, /if: inputs\.validation_mode == 'content'[\s\S]*npm run validate:content/);
  assert.match(adminPublishWorkflow, /validation_mode: \$\{\{ steps\.publish\.outputs\.validation_mode \}\}/);
  assert.doesNotMatch(buildWorkflow, /validation_mode:/);
  const responsiveImageCacheKey = /key: responsive-images-q\$\{\{ env\.RESPONSIVE_IMAGE_QUALITY \|\| '70' \}\}-\$\{\{ hashFiles\('lib\/eleventy\/media-assets\.js', 'package-lock\.json'\) \}\}-\$\{\{ hashFiles\('blog\/assets\/images\/\*\*\/\*'\) \}\}/;
  const compatibleRestorePrefix = /restore-keys: \|\s+responsive-images-q\$\{\{ env\.RESPONSIVE_IMAGE_QUALITY \|\| '70' \}\}-\$\{\{ hashFiles\('lib\/eleventy\/media-assets\.js', 'package-lock\.json'\) \}\}-/;
  for (const workflow of [buildWorkflow, adminPublishWorkflow]) {
    assert.match(workflow, responsiveImageCacheKey);
    assert.match(workflow, compatibleRestorePrefix);
    assert.doesNotMatch(workflow, /^\s+responsive-images-\s*$/m);
    assert.doesNotMatch(workflow, /hashFiles\([^\n]*lib\/eleventy\/assets\.js/);
  }
  assert.match(adminPublishWorkflow, /\}\s*&\s*\n\s*done\s*\n\s*wait/);
  assert.ok(buildWorkflow.indexOf("Validate production site") < buildWorkflow.indexOf("Deploy to Cloudflare Pages"));
  assert.ok(adminPublishWorkflow.indexOf("Validate production site") < adminPublishWorkflow.indexOf("Deploy to Cloudflare Pages"));
});

test("production copies only the runtime admin and Leaflet vendor assets", () => {
  const eleventyConfig = source(".eleventy.js");
  const adminTemplate = source("blog/admin/index.html");
  const referencedAdminVendors = [...adminTemplate.matchAll(/['"](\/admin\/vendor\/[^'"?#]+)/g)]
    .map((match) => `blog${match[1]}`)
    .sort();

  assert.deepEqual(referencedAdminVendors, Object.values(adminVendorBundles).sort());
  for (const file of Object.values(adminVendorBundles)) {
    assert.equal(fs.existsSync(path.join(__dirname, "..", file)), true, `${file} must be built`);
  }
  assert.deepEqual(Object.values(generatedAssets).sort(), [...Object.values(adminVendorBundles), ...Object.values(publicStyleBundles)].sort());
  assert.match(eleventyConfig, /"vendor"\]\.includes\(entry\)/);
  assert.doesNotMatch(eleventyConfig, /adminVendorDirectories/);
  assert.deepEqual(leafletRuntimeAssets, [
    ["node_modules/leaflet/dist/leaflet.css", "assets/vendor/leaflet/leaflet.css"],
    ["node_modules/leaflet/dist/leaflet.js", "assets/vendor/leaflet/leaflet.js"],
    ["node_modules/leaflet/dist/images", "assets/vendor/leaflet/images"]
  ]);
  assert.doesNotMatch(eleventyConfig, /addPassthroughCopy\(\{ "node_modules\/leaflet\/dist":/);
});
