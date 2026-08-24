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

function relativeLuminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(left, right) {
  const values = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function declarationValues(source, selector, property) {
  const values = [];
  postcss.parse(source).walkRules(selector, (rule) => {
    rule.walkDecls(property, (declaration) => values.push(declaration.value));
  });
  return values;
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

test("actual admonition title colors remain readable on the public site and in admin", () => {
  const publicTokens = read("blog/assets/css-src/main/01-tokens.css");
  const publicAdmonitions = read("blog/assets/css-src/main/13a-admonitions.css");
  const publicBackgrounds = declarationValues(publicTokens, ":root", "--background-color");
  for (const selector of [".admonition-info", ".admonition-warning", ".admonition-caution"]) {
    const accents = declarationValues(publicAdmonitions, selector, "--adm-accent");
    assert.equal(accents.length, publicBackgrounds.length, `${selector} must define one accent per public color scheme`);
    for (let index = 0; index < accents.length; index += 1) {
      assert.ok(contrastRatio(publicBackgrounds[index], accents[index]) >= 4.5, `${accents[index]} lacks text contrast on ${publicBackgrounds[index]}`);
    }
  }

  const adminTokens = read("blog/admin/css-src/01-tokens.css");
  const adminPreview = read("blog/admin/css-src/04-publish-dialog.css");
  // Both schemes, in file order: light first, then the dark block below it.
  const adminBackgrounds = declarationValues(adminTokens, ":root", "--panel-2");
  const adminAssignments = [
    [".editor-preview .admonition", "--accent-ink"],
    [".editor-preview .admonition-warning", "--amber"],
    [".editor-preview .admonition-caution", "--red-ink"]
  ];
  for (const [selector, variable] of adminAssignments) {
    const accents = declarationValues(adminTokens, ":root", variable);
    assert.equal(accents.length, adminBackgrounds.length, `${variable} must define one accent per admin color scheme`);
    for (let index = 0; index < accents.length; index += 1) {
      assert.ok(contrastRatio(adminBackgrounds[index], accents[index]) >= 4.5, `${accents[index]} lacks admin preview contrast on ${adminBackgrounds[index]}`);
    }
    assert.deepEqual(declarationValues(adminPreview, selector, "--adm-accent"), [`var(${variable})`], `${selector} must use the tested accent`);
  }
});

// The split that keeps the two reds honest: --red fills a surface under white
// text, --red-ink writes on a panel. Before they were one token it failed both
// jobs at once — 3.17:1 under white in dark mode, 4.41:1 as text on --red-weak
// in light mode — so this pins each role to the background it actually meets.
test("both red roles stay readable in both admin color schemes", () => {
  const tokens = read("blog/admin/css-src/01-tokens.css");
  const scheme = (name) => declarationValues(tokens, ":root", name);
  const fills = scheme("--red");
  const inks = scheme("--red-ink");
  assert.equal(fills.length, 2, "--red must be defined per color scheme");
  assert.equal(inks.length, 2, "--red-ink must be defined per color scheme");

  // Fill role: white text sits on --red (error toast, delete button, .danger:hover).
  for (const fill of fills) {
    assert.ok(contrastRatio("#ffffff", fill) >= 4.5, `white text lacks contrast on --red ${fill}`);
  }

  // Text role: --red-ink is written on every surface a red label can land on.
  const surfaces = ["--bg", "--panel", "--panel-2", "--red-weak"].map(scheme);
  inks.forEach((ink, index) => {
    for (const values of surfaces) {
      assert.ok(contrastRatio(values[index], ink) >= 4.5, `--red-ink ${ink} lacks contrast on ${values[index]}`);
    }
  });
});

test("formatted admonition titles keep normal inline text flow", () => {
  const publicAdmonitions = read("blog/assets/css-src/main/13a-admonitions.css");
  const adminPreview = read("blog/admin/css-src/04-publish-dialog.css");

  for (const [source, titleSelector, iconSelector] of [
    [publicAdmonitions, ".admonition-title", ".admonition-icon"],
    [adminPreview, ".editor-preview .admonition-title", ".editor-preview .admonition-icon"]
  ]) {
    assert.deepEqual(declarationValues(source, titleSelector, "display"), [], `${titleSelector} must preserve inline child flow`);
    assert.deepEqual(declarationValues(source, titleSelector, "gap"), [], `${titleSelector} must not space inline fragments as flex items`);
    assert.deepEqual(declarationValues(source, iconSelector, "display"), ["inline-block"]);
    assert.deepEqual(declarationValues(source, iconSelector, "margin-right"), ["0.5rem"]);
  }
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

test("admin viewport breakpoints live in the responsive stylesheets", () => {
  // Breakpoints stay in the responsive files so the cascade order of the
  // overrides is one decision, made in runtime-vendors.js, rather than being
  // scattered across the component stylesheets. There are three of them since
  // 06 passed its line budget twice: 07 and 08 each load directly after the
  // one before, so splitting changed the file count and not the order.
  const responsive = new Set(["06-responsive.css", "07-responsive-editor.css", "08-responsive-publish.css"]);
  const directory = path.join(root, "blog/admin/css-src");
  for (const file of fs.readdirSync(directory).filter((entry) => entry.endsWith(".css") && !responsive.has(entry))) {
    assert.doesNotMatch(read(`blog/admin/css-src/${file}`), /@media\s*\([^)]*(?:max|min)-width/, `${file} owns a viewport breakpoint`);
  }
  const bundle = styleSources.admin || [];
  const order = [...responsive].map((file) => bundle.indexOf(`blog/admin/css-src/${file}`));
  assert.ok(order.every((index) => index >= 0), "every responsive stylesheet is part of the admin bundle");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "responsive stylesheets keep their cascade order");
  assert.equal(order.at(-1), bundle.length - 1, "responsive overrides load last");
  assertBoundedModules("blog/admin/css-src", 250);
});
