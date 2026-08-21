const fs = require("node:fs");
const path = require("node:path");

module.exports = function adminSource() {
  const directory = path.join(__dirname, "../../blog/admin/admin-src");
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".part"))
    .sort()
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
    .join("");
};
