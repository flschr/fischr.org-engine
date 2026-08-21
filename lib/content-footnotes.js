const fs = require("node:fs");
const path = require("node:path");

function findDetachedFootnoteReferences(postsDirectory) {
  return listMarkdownFiles(postsDirectory)
    .flatMap((file) => {
      const source = fs.readFileSync(path.join(postsDirectory, file), "utf8");
      return [...source.matchAll(/\s<sup\b[^>]*\bclass=(["'])[^"']*\bfootnote-ref\b[^"']*\1[^>]*>/gi)]
        .map((match) => {
          const index = match.index + match[0].indexOf("<sup");
          const before = source.slice(0, index);
          return {
            file,
            line: before.split("\n").length,
            column: index - before.lastIndexOf("\n")
          };
        });
    });
}

function listMarkdownFiles(directory, relativeDirectory = "") {
  return fs.readdirSync(path.join(directory, relativeDirectory), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(directory, relativePath);
      return entry.isFile() && entry.name.endsWith(".md") ? [relativePath] : [];
    })
    .sort();
}

module.exports = { findDetachedFootnoteReferences };
