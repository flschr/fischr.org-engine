const fs = require("fs");
const path = require("path");
const { adminVendorBundles } = require("../lib/eleventy/runtime-vendors");

const root = process.cwd();
const vendorRoot = path.join(root, "_site/admin/vendor");
const actual = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else actual.push(path.relative(path.join(root, "_site"), file));
  }
}
visit(vendorRoot);
const expected = Object.values(adminVendorBundles).map((file) => file.replace(/^blog\//, "")).sort();
actual.sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error(`Unexpected admin vendor output.\nExpected: ${expected.join(", ")}\nActual: ${actual.join(", ")}`);
  process.exit(1);
}
console.log(`Admin deployment contains exactly ${actual.length} declared vendor bundles.`);
