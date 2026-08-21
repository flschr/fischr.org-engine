const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const postcss = require("postcss");
const { publicStyleBundles, styleSources } = require("../lib/eleventy/runtime-vendors");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const cssFiles = (directory) => fs.readdirSync(path.join(root, directory)).filter((file) => file.endsWith(".css"));

function assertBoundedModules(directory, maxLines = 200) {
  for (const file of cssFiles(directory)) {
    const source = read(`${directory}/${file}`);
    const lines = source.trimEnd().split("\n").length;
    assert.ok(lines <= maxLines, `${file} has ${lines} lines; review and split mixed responsibilities before it exceeds ${maxLines}`);
    assert.doesNotThrow(() => postcss.parse(source, { from: file }), `${file} is not valid standalone CSS`);
  }
}

test("style bundle manifests explicitly own every source file", () => {
  for (const [bundle, directory] of Object.entries({
    main: "blog/assets/css-src/main",
    admin: "blog/admin/css-src"
  })) {
    const actual = styleSources[bundle].map((file) => path.relative(directory, file)).sort();
    assert.deepEqual(actual, cssFiles(directory).sort(), `${bundle} manifest and source directory differ`);
  }
});

test("public CSS modules stay bounded and responsive rules stay centralized", () => {
  const directory = path.join(root, "blog/assets/css-src/main");
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(".css"));

  for (const file of files) {
    const source = read(`blog/assets/css-src/main/${file}`);
    if (file !== "90-responsive.css") {
      assert.doesNotMatch(source, /@media\s*\([^)]*(?:max|min)-width/, `${file} owns a viewport breakpoint`);
    }
  }
  assertBoundedModules("blog/assets/css-src/main");
});

test("public CSS manifest order matches its numbered source order", () => {
  assert.deepEqual(Object.keys(publicStyleBundles), ["main"]);
  assert.deepEqual(styleSources.main, [...styleSources.main].sort((a, b) => a.localeCompare(b)));
});

test("all public page types inherit one page-width contract", () => {
  const sources = styleSources.main.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const documentBase = read("blog/assets/css-src/main/02-document-base.css");
  assert.match(documentBase, /body\s*\{[^}]*max-width:\s*var\(--layout-page-max\)/s);
  assert.doesNotMatch(sources, /--(?:text-measure|layout-readable-max|layout-blog-readable-max)/);
  assert.doesNotMatch(sources, /body\.(?:post|home|about|projects)[^{]*\{[^}]*max-width/s);
  assert.doesNotMatch(sources, /(^|,)\s*main\s+(?:img|video|iframe|figure)(?=\s|,|\{|>)/m);
  assert.doesNotMatch(sources, /identity/);
  assert.doesNotMatch(sources, /--(?:font-secondary|layout-media-max)/);
});

test("page-shell selectors cannot introduce local maximum widths", () => {
  const allowedOwner = "blog/assets/css-src/main/02-document-base.css";
  const shellSelectors = new Set([
    "body", ".site", ".site-header", ".site-main", ".site-footer",
    ".post-stream", ".h-entry", ".about-page", ".projects-page"
  ]);

  for (const file of styleSources.main) {
    const ast = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
    ast.walkRules((rule) => {
      const selectors = rule.selectors?.map((selector) => selector.trim()) || [];
      if (!selectors.some((selector) => shellSelectors.has(selector))) return;
      rule.walkDecls("max-width", (declaration) => {
        assert.equal(file, allowedOwner, `${path.basename(file)} narrows page shell selector ${rule.selector}`);
      });
    });
  }
});

test("admin viewport breakpoints live in the responsive stylesheet", () => {
  const directory = path.join(root, "blog/admin/css-src");
  for (const file of fs.readdirSync(directory).filter((entry) => entry.endsWith(".css") && entry !== "06-responsive.css")) {
    assert.doesNotMatch(read(`blog/admin/css-src/${file}`), /@media\s*\([^)]*(?:max|min)-width/, `${file} owns a viewport breakpoint`);
  }
  // Responsive overrides stay together to preserve cascade order; the file is
  // still bounded below the project's mandatory 350-line split threshold.
  assertBoundedModules("blog/admin/css-src", 250);
});
