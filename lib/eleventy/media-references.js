const fs = require("fs");
const matter = require("gray-matter");

const { create: createMarkdownMedia } = require("../../blog/admin/markdown-media");

const { findHtmlMedia, findMarkdownImages, findMediaShortcuts, visibleMarkdownSource } = createMarkdownMedia({
  stripMarkdownUrl: (value) => {
    const text = String(value || "").trim();
    if (text.startsWith("<") && text.endsWith(">")) return text.slice(1, -1);
    return text.replace(/\s+["'][^"']+["']$/, "");
  },
  extension: () => ""
});

function createMediaReferenceExtractor({ getLocalImageAsset, getLocalVideoAsset, fileSystem = fs }) {
  const sourceCache = new Map();

  function sourceSignature(inputPath) {
    try {
      const stats = fileSystem.statSync(inputPath);
      return `${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}:${stats.size}`;
    } catch (error) {
      if (error?.code === "ENOENT") return "missing";
      throw error;
    }
  }

  function readSource(inputPath) {
    try {
      return fileSystem.readFileSync(inputPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return "";
      throw error;
    }
  }

  function sourceReferences(inputPath) {
    const signature = sourceSignature(inputPath);
    const cached = sourceCache.get(inputPath);
    if (cached?.signature === signature) return cached.references;

    const source = signature === "missing" ? "" : readSource(inputPath);
    const rawContent = visibleMarkdownSource(matter(source).content);
    const references = { images: [], videos: [] };

    const htmlMedia = findHtmlMedia(rawContent);
    references.images.push(...[
      ...htmlMedia.filter((media) => media.type === "img"),
      ...findMarkdownImages(rawContent).map((image) => ({ src: image.src, from: image.from }))
    ].sort((a, b) => a.from - b.from).map((media) => media.src));
    references.videos.push(...[
      ...htmlMedia.filter((media) => media.type !== "img"),
      ...findMediaShortcuts(rawContent)
        .filter((shortcut) => shortcut.type === "video")
        .map((shortcut) => ({ src: shortcut.source, from: shortcut.from }))
    ].sort((a, b) => a.from - b.from).map((media) => media.src));

    sourceCache.set(inputPath, { signature, references });
    return references;
  }

  function extract(item = {}, options = {}) {
    const inputPath = String(item.inputPath || "").replace(/\\/g, "/");
    if (!/\/?blog\/(pages|posts)\//.test(inputPath)) return [];

    const images = [];
    const videos = [];
    const seen = new Set();
    const add = (asset, target) => {
      if (!asset || seen.has(asset.publicPath)) return;
      seen.add(asset.publicPath);
      target.push(asset.publicPath);
    };
    const addImage = (src = "") => add(getLocalImageAsset(src), images);
    const addVideo = (src = "") => add(getLocalVideoAsset(src), videos);

    addImage(item.data?.image);
    const references = sourceReferences(item.inputPath);
    references.images.forEach(addImage);

    if (options.includeVideos) {
      references.videos.forEach(addVideo);
    }

    return [...images, ...videos];
  }

  return {
    getAdminMediaReferences: (item) => extract(item, { includeVideos: true }),
    getSitemapImages: (item) => extract(item)
  };
}

module.exports = { createMediaReferenceExtractor };
