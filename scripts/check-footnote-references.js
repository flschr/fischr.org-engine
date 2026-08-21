#!/usr/bin/env node

const path = require("node:path");
const { findDetachedFootnoteReferences } = require("../lib/content-footnotes");

const postsDirectory = path.join(process.cwd(), "blog", "posts");
const detachedReferences = findDetachedFootnoteReferences(postsDirectory);

if (detachedReferences.length) {
  console.error("Footnote references must be attached to the preceding text:");
  detachedReferences.forEach(({ file, line, column }) => console.error(`- ${file}:${line}:${column}`));
  process.exit(1);
}

console.log("Footnote reference spacing OK.");
