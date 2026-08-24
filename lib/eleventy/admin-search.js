const fs = require("fs");

const searchText = require("../../blog/admin/search-text");

// The searchable text of one entry, derived from its source file — the same file
// the admin edits, and through the very same derivation the admin applies to an
// unsaved change. Reading is cached on the file's stat signature, like the media
// reference extractor next door: a build touches every post twice (index and
// page) and neither pass should pay for the other's read.
function createAdminSearchTextExtractor({ fileSystem = fs } = {}) {
  const cache = new Map();

  function signature(inputPath) {
    try {
      const stats = fileSystem.statSync(inputPath);
      return `${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}:${stats.size}`;
    } catch (error) {
      if (error?.code === "ENOENT") return "missing";
      throw error;
    }
  }

  function read(inputPath) {
    try {
      return fileSystem.readFileSync(inputPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return "";
      throw error;
    }
  }

  return function getAdminSearchText(item = {}) {
    const inputPath = String(item.inputPath || "").replace(/\\/g, "/");
    if (!inputPath) return "";

    const current = signature(inputPath);
    const cached = cache.get(inputPath);
    if (cached?.signature === current) return cached.text;

    const text = current === "missing"
      ? ""
      : searchText.documentText(read(inputPath), { template: !inputPath.endsWith(".md") });
    cache.set(inputPath, { signature: current, text });
    return text;
  };
}

module.exports = { createAdminSearchTextExtractor };
