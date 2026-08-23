const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const projectRoot = path.join(__dirname, "..");

function setupProject(manifest, files, pendingUploads = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-media-delivery-"));

  for (const relative of ["scripts/check-media-delivery.js", "lib/media-manifest.js"]) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, relative), destination);
  }

  fs.mkdirSync(path.join(root, "automation"), { recursive: true });
  fs.writeFileSync(path.join(root, "automation/media-manifest.json"), JSON.stringify(manifest));

  for (const [name, record] of Object.entries(pendingUploads)) {
    fs.mkdirSync(path.join(root, "automation/media-uploads"), { recursive: true });
    fs.writeFileSync(path.join(root, `automation/media-uploads/${name}`), JSON.stringify(record));
  }

  for (const [relative, contents] of Object.entries(files)) {
    const destination = path.join(root, "_site", relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  }

  return root;
}

function run(root) {
  return execFileAsync("node", ["scripts/check-media-delivery.js"], { cwd: root });
}

const migrated = { "images/uploads/photo.webp": { sourcePath: "blog/assets/images/uploads/photo.webp", sha256: "x" } };

test("accepts a migrated object referenced from the delivery domain", async () => {
  const root = setupProject(migrated, {
    "post/index.html": '<img src="https://media.mysite.example/images/uploads/photo.webp">'
  });

  const { stdout } = await run(root);
  assert.match(stdout, /Media delivery OK/);
});

test("rejects a migrated object still served from the site origin", async () => {
  const root = setupProject(migrated, {
    "post/index.html": '<img src="/assets/images/uploads/photo.webp">'
  });

  await assert.rejects(() => run(root), (error) => {
    assert.match(error.stderr, /\/assets\/images\/uploads\/photo\.webp is in the media manifest/);
    return true;
  });
});

test("rejects the absolute form the social and structured-data tags emit", async () => {
  const root = setupProject(migrated, {
    "post/index.html": '<meta property="og:image" content="https://mysite.example/assets/images/uploads/photo.webp">'
  });

  await assert.rejects(() => run(root), (error) => {
    assert.match(error.stderr, /og:image|photo\.webp/);
    return true;
  });
});

// The one-build lag: a responsive variant this build just generated is not in the manifest yet
// and is legitimately served from Pages for exactly one deploy (see docs/media.md). Flagging it
// would make every build that adds an image fail.
test("allows a local reference to something not in the manifest", async () => {
  const root = setupProject(migrated, {
    "post/index.html": '<img srcset="/assets/images/responsive/fresh-abc123-680.webp 680w">'
  });

  const { stdout } = await run(root);
  assert.match(stdout, /Media delivery OK/);
});

// The manifest is two files. A build right after an admin upload sees the new object only as a
// pending record, and the delivery mapping honours it — so this gate has to as well, or it
// would pass exactly the reference it exists to catch.
test("counts a not-yet-folded upload record as migrated", async () => {
  const root = setupProject(
    {},
    { "post/index.html": '<img src="/assets/images/uploads/fresh.webp">' },
    {
      "images__uploads__fresh.webp.json": {
        key: "images/uploads/fresh.webp",
        entry: { sourcePath: "blog/assets/images/uploads/fresh.webp", sha256: "y" }
      }
    }
  );

  await assert.rejects(() => run(root), (error) => {
    assert.match(error.stderr, /fresh\.webp is in the media manifest/);
    return true;
  });
});

// Cache-busted site chrome (the favicons carry ?v=…) must resolve to the same object, or the
// gate would quietly skip precisely the template-hardcoded references that drifted before.
test("recognises a reference carrying a cache-busting query", async () => {
  const root = setupProject(
    { "images/favicon-32x32.png": { sourcePath: "blog/assets/images/favicon-32x32.png", sha256: "z" } },
    { "index.html": '<link rel="icon" href="/assets/images/favicon-32x32.png?v=20260821">' }
  );

  await assert.rejects(() => run(root), (error) => {
    assert.match(error.stderr, /favicon-32x32\.png is in the media manifest/);
    return true;
  });
});

test("ignores the private admin app, which resolves media through its own helpers", async () => {
  const root = setupProject(migrated, {
    "admin/index.html": '<img src="/assets/images/uploads/photo.webp">'
  });

  const { stdout } = await run(root);
  assert.match(stdout, /Media delivery OK/);
});
