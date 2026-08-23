const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  adminBundleFiles,
  adminBundleVersion,
  adminDeployedFiles,
  templateFragments
} = require("../lib/eleventy/admin-bundle");
const { adminVendorBundles } = require("../lib/eleventy/runtime-vendors");

const repoRoot = path.join(__dirname, "..");

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// A stand-in for blog/admin/: the shell, one shipped file, one shipped directory, the build
// inputs, the declared vendor bundles — plus the kind of ignored leftover that a long-replaced
// dependency leaves behind in a working checkout, and the litter Finder adds to both.
function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "admin-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  write(root, "blog/admin/index.html", "<html data-v=\"{{ '' | adminBundleVersion }}\">{% include \"admin/dialogs.njk\" %}</html>");
  write(root, "blog/_includes/admin/dialogs.njk", "<dialog id=\"deleteDialog\"></dialog>\n");
  write(root, "blog/_includes/admin/nested.njk", "<p>pulled in by the fragment</p>\n");
  write(root, "blog/_includes/admin/unused.njk", "<p>no template references this</p>\n");
  write(root, "blog/admin/sw.js", "// service worker\n");
  write(root, "blog/admin/icons/icon-192.png", "png bytes");
  write(root, "blog/admin/admin-src/app.js", "source\n");
  write(root, "blog/admin/css-src/01-tokens.css", ":root {}\n");
  write(root, "blog/admin/editor-src/editor.js", "editor source\n");
  for (const bundle of Object.values(adminVendorBundles)) write(root, bundle, `built ${bundle}\n`);
  write(root, "blog/admin/vendor/.build-manifest.json", "{}\n");
  write(root, "blog/admin/vendor/vditor/dist/index.min.js", "23 MB of a replaced editor\n");
  write(root, "blog/admin/vendor/vditor 2/.keep", "");

  return root;
}

test("the bundle version covers exactly the files the admin deploys", (t) => {
  const root = createFixture(t);

  assert.deepEqual(adminDeployedFiles(root), [
    "blog/admin/icons/icon-192.png",
    "blog/admin/sw.js",
    ...Object.values(adminVendorBundles)
  ].sort());

  // The hash is the deployed set plus the two things Eleventy renders rather than copies.
  assert.deepEqual(adminBundleFiles(root), [
    "blog/_includes/admin/dialogs.njk",
    "blog/admin/icons/icon-192.png",
    "blog/admin/index.html",
    "blog/admin/sw.js",
    ...Object.values(adminVendorBundles)
  ].sort());
});

// The whole change rests on one invariant: Eleventy copies exactly the list the hash covers.
// A regex over .eleventy.js only checks that the right function is named — this runs the
// configuration and compares what it actually registered.
test("Eleventy copies precisely the files the version hashes", () => {
  const copied = [];
  const stub = new Proxy({}, {
    get: (_target, property) => {
      if (property === "addPassthroughCopy") return (mapping) => copied.push(mapping);
      if (property === "ignores") return new Set();
      return () => {};
    }
  });
  require(path.join(repoRoot, ".eleventy.js"))(stub);

  const admin = copied
    .filter((mapping) => Object.keys(mapping).some((source) => source.startsWith("blog/admin/")))
    .map((mapping) => Object.entries(mapping)[0]);

  assert.deepEqual(admin.map(([source]) => source).sort(), adminDeployedFiles(repoRoot));
  for (const [source, destination] of admin) {
    assert.equal(destination, source.replace(/^blog\//, ""), `${source} must keep its path under /admin/`);
  }

  // Everything copied is hashed; the shell and its fragments are hashed on top.
  const hashed = new Set(adminBundleFiles(repoRoot));
  const unhashed = admin.map(([source]) => source).filter((source) => !hashed.has(source));
  assert.deepEqual(unhashed, [], "a deployed file outside the hash would drift between checkouts");
});

// dialogs.njk and settings.njk are inlined into the deployed shell but live outside
// blog/admin/, so a hash built from that directory alone misses them: the dialog markup
// changes, the browser receives different HTML, and the service worker keeps its old version.
test("fragments inlined into the shell are part of the version", (t) => {
  const root = createFixture(t);
  const before = adminBundleVersion(root);

  write(root, "blog/_includes/admin/dialogs.njk", "<dialog id=\"deleteDialog\"><p>reworded</p></dialog>\n");
  assert.notEqual(adminBundleVersion(root), before, "an inlined fragment must move the version");

  const after = adminBundleVersion(root);
  write(root, "blog/_includes/admin/unused.njk", "<p>still unreferenced</p>\n");
  assert.equal(adminBundleVersion(root), after, "an unreferenced fragment must not move the version");
});

test("fragments are followed transitively and cannot recurse forever", (t) => {
  const root = createFixture(t);

  write(root, "blog/_includes/admin/dialogs.njk", "<dialog></dialog>{% include \"admin/nested.njk\" %}\n");
  assert.ok(adminBundleFiles(root).includes("blog/_includes/admin/nested.njk"), "a nested fragment is deployed too");

  write(root, "blog/_includes/admin/nested.njk", "{% include \"admin/dialogs.njk\" %}\n");
  assert.deepEqual(templateFragments(root, "blog/admin/index.html"), [
    "blog/_includes/admin/dialogs.njk",
    "blog/_includes/admin/nested.njk"
  ]);
});

test("an ignored leftover under vendor/ leaves the bundle version alone", (t) => {
  const root = createFixture(t);
  const before = adminBundleVersion(root);

  write(root, "blog/admin/vendor/vditor/dist/index.min.js", "a different leftover\n");
  write(root, "blog/admin/vendor/legacy-editor/bundle.js", "another one\n");
  fs.rmSync(path.join(root, "blog/admin/vendor/vditor 2"), { recursive: true });
  write(root, "blog/admin/vendor/.build-manifest.json", '{"sourceHash":"changed"}\n');

  assert.equal(adminBundleVersion(root), before, "undeployed files must not move the version");
});

// The same class of failure as the leftover editor, but one that reappears whenever Finder
// opens the folder: present on one machine, absent on the build runner.
test("Finder litter is neither deployed nor hashed", (t) => {
  const root = createFixture(t);
  const before = adminBundleVersion(root);
  const deployed = adminDeployedFiles(root);

  write(root, "blog/admin/.DS_Store", "finder state");
  write(root, "blog/admin/icons/.DS_Store", "finder state");
  write(root, "blog/admin/icons/._icon-192.png", "apple double");
  write(root, "blog/admin/Thumbs.db", "windows thumbnails");

  assert.deepEqual(adminDeployedFiles(root), deployed, "os litter must not be copied to /admin/");
  assert.equal(adminBundleVersion(root), before, "os litter must not move the version");
});

test("build inputs move the version only through the bundles they produce", (t) => {
  const root = createFixture(t);
  const before = adminBundleVersion(root);

  write(root, "blog/admin/admin-src/app.js", "changed source\n");
  write(root, "blog/admin/css-src/01-tokens.css", ":root { --x: 1; }\n");
  write(root, "blog/admin/editor-src/editor.js", "changed editor source\n");
  assert.equal(adminBundleVersion(root), before, "an unbuilt source change ships nothing");

  write(root, adminVendorBundles.app, "rebuilt\n");
  assert.notEqual(adminBundleVersion(root), before, "the rebuilt bundle must move the version");
});

test("every deployed admin file moves the version", (t) => {
  const root = createFixture(t);

  for (const file of adminBundleFiles(root)) {
    const before = adminBundleVersion(root);
    const original = fs.readFileSync(path.join(root, file));
    write(root, file, Buffer.concat([original, Buffer.from("\n// touched\n")]));
    assert.notEqual(adminBundleVersion(root), before, `${file} must move the version`);
    write(root, file, original);
    assert.equal(adminBundleVersion(root), before, `${file} must restore the version`);
  }
});

// Eleventy resolves a `layout:` front-matter key against blog/_includes on its own, and a
// `{% include %}` naming a variable resolves only at render time. Neither is visible to the
// scan above. The shell uses neither today; if it ever does, this fails rather than quietly
// dropping part of the deployed HTML out of the version.
test("the admin shell stays within what the fragment scan can see", () => {
  const template = fs.readFileSync(path.join(repoRoot, "blog/admin/index.html"), "utf8");
  const frontMatter = template.match(/^---\n([\s\S]*?)\n---/);

  assert.ok(frontMatter, "the shell keeps its front matter");
  assert.doesNotMatch(frontMatter[1], /^layout:/m);

  const includeTags = template.match(/\{%-?\s*include\s/g) || [];
  assert.equal(includeTags.length, templateFragments(repoRoot, "blog/admin/index.html").length,
    "every include must name a literal path the scan can resolve");
});

test("the real checkout hashes no build input and no undeclared vendor file", () => {
  const files = adminBundleFiles(repoRoot);

  assert.ok(files.includes("blog/admin/index.html"));
  assert.ok(files.includes("blog/admin/sw.js"));
  assert.deepEqual(templateFragments(repoRoot, "blog/admin/index.html"), [
    "blog/_includes/admin/settings.njk",
    "blog/_includes/admin/dialogs.njk"
  ], "both shell fragments must resolve — a silent miss would drop them from the version");
  for (const bundle of Object.values(adminVendorBundles)) assert.ok(files.includes(bundle), `${bundle} must be hashed`);

  const declared = new Set(Object.values(adminVendorBundles));
  const strays = files.filter((file) => file.startsWith("blog/admin/vendor/") && !declared.has(file));
  assert.deepEqual(strays, [], "only the declared vendor bundles belong in the version");
  for (const sourceDirectory of ["admin-src", "css-src", "editor-src"]) {
    assert.deepEqual(files.filter((file) => file.startsWith(`blog/admin/${sourceDirectory}/`)), []);
  }
});
