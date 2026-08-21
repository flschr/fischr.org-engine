// Builds every gitignored browser asset required by tests and Eleventy.
const fs = require("fs");
const path = require("path");
const { buildIconBundle } = require("../lib/eleventy/admin-icon-bundle");
const { createManifest, manifestFile } = require("../lib/eleventy/generated-asset-manifest");
const { adminVendorBundles, generatedAssets, publicStyleBundles, styleSources } = require("../lib/eleventy/runtime-vendors");

const root = process.cwd();
const output = (file) => path.join(root, file);
const editorSource = path.join(root, "blog/admin/editor-src/editor.js");

async function main() {
  buildAdminBundle();
  copyMarkdownItBundle();
  buildStyles();
  buildIconBundle({ root, outfile: output(adminVendorBundles.icons) });
  console.log(`Admin icons bundled → ${adminVendorBundles.icons}`);
  await buildEditorBundle();
  const manifest = createManifest(root, Object.values(generatedAssets));
  fs.writeFileSync(output(manifestFile), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Generated asset manifest → ${manifestFile}`);
}

function buildAdminBundle() {
  const sourceDir = path.join(root, "blog/admin/admin-src");
  const parts = fs.readdirSync(sourceDir).filter((name) => name.endsWith(".part")).sort();
  if (!parts.length) throw new Error("Admin application source parts are missing.");
  const source = parts.map((name) => fs.readFileSync(path.join(sourceDir, name), "utf8")).join("");
  if (!source.startsWith("(function () {") || !source.trimEnd().endsWith("})();")) {
    throw new Error("Admin application source parts do not form a complete application.");
  }
  write(adminVendorBundles.app, source);
  console.log(`Admin application bundled → ${adminVendorBundles.app}`);
}

function copyMarkdownItBundle() {
  const source = path.join(root, "node_modules/markdown-it/dist/markdown-it.min.js");
  if (!fs.existsSync(source)) throw new Error("markdown-it browser bundle is missing. Run: npm install");
  fs.mkdirSync(path.dirname(output(adminVendorBundles["markdown-it"])), { recursive: true });
  fs.copyFileSync(source, output(adminVendorBundles["markdown-it"]));
  console.log(`Markdown renderer bundled → ${adminVendorBundles["markdown-it"]}`);
}

function buildStyles() {
  removeObsoletePublicStyles();
  concatenateFiles(styleSources.main, publicStyleBundles.main);
  concatenateFiles(styleSources.admin, adminVendorBundles.styles);
}

function removeObsoletePublicStyles(rootDirectory = root, bundles = publicStyleBundles) {
  const files = Object.values(bundles).map((file) => path.join(rootDirectory, file));
  const directory = path.dirname(files[0]);
  if (!fs.existsSync(directory)) return;
  const expected = new Set(files.map((file) => path.resolve(file)));
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    if (path.extname(name) === ".css" && !expected.has(path.resolve(file))) fs.rmSync(file);
  }
}

function concatenateFiles(files, outfile) {
  write(outfile, files.map((file) => fs.readFileSync(output(file), "utf8")).join("\n"));
  console.log(`Styles bundled → ${outfile}`);
}

async function buildEditorBundle() {
  if (!fs.existsSync(editorSource)) throw new Error(`Admin editor source missing: ${path.relative(root, editorSource)}`);
  const esbuild = require("esbuild");
  await esbuild.build({ entryPoints: [editorSource], outfile: output(adminVendorBundles.editor), bundle: true, format: "iife", target: ["es2019"], minify: true, sourcemap: false, legalComments: "none", logLevel: "info" });
  console.log(`Admin editor bundled → ${adminVendorBundles.editor}`);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(output(file)), { recursive: true });
  fs.writeFileSync(output(file), content, "utf8");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Admin vendor build failed:", error.message);
    process.exit(1);
  });
}

module.exports = { removeObsoletePublicStyles };
