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
      ...findMarkdownImages(rawContent).map((image) => ({ src: image.src, alt: image.alt, from: image.from }))
    ].sort((a, b) => a.from - b.from).map((media) => ({ src: media.src, alt: media.alt || "" })));
    references.videos.push(...[
      ...htmlMedia.filter((media) => media.type !== "img"),
      ...findMediaShortcuts(rawContent)
        .filter((shortcut) => shortcut.type === "video")
        .map((shortcut) => ({ src: shortcut.source, from: shortcut.from }))
    ].sort((a, b) => a.from - b.from).map((media) => ({ src: media.src, alt: "" })));

    sourceCache.set(inputPath, { signature, references });
    return references;
  }

  // The alt text belongs to the place an image is used, not to the image, so it
  // travels with the reference. A path used twice keeps the first alt that says
  // something — an empty alt in a later spot must not erase a real description.
  function extract(item = {}, options = {}) {
    const inputPath = String(item.inputPath || "").replace(/\\/g, "/");
    if (!/\/?blog\/(pages|posts)\//.test(inputPath)) return [];

    const images = [];
    const videos = [];
    const seen = new Set();
    const alts = new Map();
    const add = (asset, target, alt = "") => {
      if (!asset) return;
      const text = String(alt || "").trim();
      if (text && !alts.get(asset.publicPath)) alts.set(asset.publicPath, text);
      if (seen.has(asset.publicPath)) return;
      seen.add(asset.publicPath);
      target.push(asset.publicPath);
    };
    const addImage = (src = "", alt = "") => add(getLocalImageAsset(src), images, alt);
    const addVideo = (src = "") => add(getLocalVideoAsset(src), videos);

    addImage(item.data?.image, item.data?.image_alt);
    const references = sourceReferences(item.inputPath);
    references.images.forEach((reference) => addImage(reference.src, reference.alt));

    if (options.includeVideos) {
      references.videos.forEach((reference) => addVideo(reference.src));
    }

    return [...images, ...videos].map((url) => ({ url, alt: alts.get(url) || "" }));
  }

  return {
    getAdminMediaReferences: (item) => extract(item, { includeVideos: true }),
    getSitemapImages: (item) => extract(item).map((reference) => reference.url)
  };
}

module.exports = { createMediaReferenceExtractor };
