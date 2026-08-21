const { manifestFile, validateManifest } = require("../lib/eleventy/generated-asset-manifest");
const { generatedAssets } = require("../lib/eleventy/runtime-vendors");

const root = process.cwd();
const result = validateManifest(root, Object.values(generatedAssets), manifestFile);
if (!result.ok) {
  console.error(`Generated assets are stale: ${result.reason}.`);
  console.error("Run: npm run admin:vendor");
  process.exit(1);
}

console.log("Generated assets are complete and current.");
