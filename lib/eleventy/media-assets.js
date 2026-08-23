const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const {
  escapeHtml,
  getHtmlAttribute,
  getNormalizedHost,
  hasHtmlAttribute,
  normalizeEmbedUrl,
  replaceAsync,
  setHtmlAttribute
} = require("./html");
const { videoMimeType } = require("./social");
const { createMediaReferenceExtractor } = require("./media-references");
const { deliveryHost, objectKeyForPublicPath } = require("../../scripts/lib/r2-media");
const { readMergedManifest } = require("../media-manifest");

const defaultLocalImageDirectories = ["imported", ""];
const defaultLocalVideoDirectories = ["imported", ""];
const responsiveImagePublicPrefix = "/assets/images/responsive/";
// Media lives in Git under /assets/images|videos/ (still served by Cloudflare Pages as a
// fallback) but is canonically delivered from R2, behind its own subdomain, once it has
// actually been uploaded there (recorded in automation/media-manifest.json). A markdown
// reference can name either host; both resolve to the same local file (see
// getLocalAssetPublicPath). Only a publicPath the manifest confirms is in R2 gets rewritten to
// the delivery host in emitted <img>/<video> src, poster, and sitemap entries — anything not
// (yet) migrated (template-hardcoded assets, or a variant the build hasn't uploaded yet) keeps
// resolving to the local /assets/... path Cloudflare Pages already serves, so nothing 404s.
const deliveryPathPrefixes = [
  ["/assets/images/", "/images/"],
  ["/assets/videos/", "/videos/"]
];

// Merges the committed manifest with any upload records the current build has not folded in
// yet (see lib/media-manifest.js). Without the merge, an image uploaded since the last
// production build would resolve to a /assets/... path that no longer exists in Git.
function loadMediaManifest(root) {
  return readMergedManifest(root);
}

function fromDeliveryPathname(pathname = "") {
  for (const [assetPrefix, deliveryPrefix] of deliveryPathPrefixes) {
    if (pathname.startsWith(deliveryPrefix)) {
      return `${assetPrefix}${pathname.slice(deliveryPrefix.length)}`;
    }
  }
  return pathname;
}
const responsiveImageSizes = "(max-width: 520px) calc(100vw - 32px), (max-width: 900px) 100vw, 1060px";
// Display slot is ~1100 CSS px (--width 820 + 2 × --media-bleed 140, capped at --media-max 1200),
// so 1400w fully covers DPR 1 and is sharp enough at DPR 2. Capping here keeps the un-recompressed
// 1600px source originals out of the srcset, where Retina browsers would otherwise pull them.
const responsiveImageWidths = [420, 680, 760, 1060, 1400];
const priorityResponsiveImageWidths = [680];
// DPR 1 never needs more than the 1060 slot, so any wider stage is only ever picked by
// DPR ≥ 2 displays, where the image is shown downscaled — a lower encode quality there is
// visually lossless but ~20% lighter.
const highDensityWidthThreshold = 1100;
const highDensityImageQuality = 46;
const responsiveImageExtensions = new Set([".jpeg", ".jpg", ".png", ".webp"]);

function parseResponsiveImageQuality() {
  const configuredResponsiveImageQuality = Number.parseInt(process.env.RESPONSIVE_IMAGE_QUALITY || "70", 10);
  return Number.isFinite(configuredResponsiveImageQuality) ? configuredResponsiveImageQuality : 70;
}

function isInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function createMediaAssetHelpers(options = {}) {
  const root = options.root || process.cwd();
  const localImageRoot = options.localImageRoot || path.resolve(root, "blog/assets/images");
  const localVideoRoot = options.localVideoRoot || path.resolve(root, "blog/assets/videos");
  const outputRoot = options.outputRoot || path.resolve(root, "_site");
  const responsiveImageCacheRoot = options.responsiveImageCacheRoot || path.resolve(root, ".cache/responsive-images");
  const videoMetadata = options.videoMetadata || {};
  const responsiveImageQuality = options.responsiveImageQuality || parseResponsiveImageQuality();
  const mediaManifest = options.mediaManifest || loadMediaManifest(root);

  function toDeliveryUrl(publicPath = "") {
    for (const [assetPrefix, deliveryPrefix] of deliveryPathPrefixes) {
      if (!publicPath.startsWith(assetPrefix)) continue;
      if (!mediaManifest[objectKeyForPublicPath(publicPath)]) return publicPath;
      return `https://${deliveryHost}${deliveryPrefix}${publicPath.slice(assetPrefix.length)}`;
    }
    return publicPath;
  }

  const imageDimensionsCache = new Map();
  const responsiveImageCache = new Map();
  const imageLqipCache = new Map();
  const fileHashCache = new Map();
  const warnedMediaAssets = new Set();

  function getLocalAssetPublicPath(src = "", publicPrefix = "") {
    const normalized = normalizeEmbedUrl(src).split("#")[0].split("?")[0];
    let pathname = normalized;

    try {
      const url = new URL(normalized);
      const host = url.hostname ? getNormalizedHost(url) : "";
      if (host && host !== "mysite.example" && host !== deliveryHost) return "";
      pathname = host === deliveryHost ? fromDeliveryPathname(url.pathname) : url.pathname;
    } catch {
      // Keep site-root-relative paths as-is.
    }

    if (!pathname.startsWith(publicPrefix)) return "";
    return pathname;
  }

  function isSafeRelativeAssetReference(src = "") {
    const reference = normalizeEmbedUrl(src).split("#")[0].split("?")[0].trim();
    if (!reference || reference.startsWith("/") || reference.startsWith("//")) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) return false;

    const normalized = path.posix.normalize(reference.replace(/^\.\/+/, ""));
    return Boolean(normalized && normalized !== "." && normalized !== ".." && !normalized.startsWith("../"));
  }

  function getRelativeAssetCandidates(src = "", defaultDirectories = []) {
    const reference = path.posix.normalize(
      normalizeEmbedUrl(src)
        .split("#")[0]
        .split("?")[0]
        .trim()
        .replace(/^\.\/+/, "")
    );

    const candidates = reference.includes("/")
      ? [reference]
      : defaultDirectories.map((directory) => directory ? `${directory}/${reference}` : reference);

    return [...new Set(candidates)];
  }

  function getLocalAssetInfo(src = "", rootDirectory, publicPrefix = "", defaultDirectories = []) {
    const pathname = getLocalAssetPublicPath(src, publicPrefix);

    if (pathname) {
      const localPath = path.resolve(rootDirectory, pathname.slice(publicPrefix.length));
      if (!isInside(localPath, rootDirectory)) return null;
      if (!fs.existsSync(localPath)) return null;
      return { publicPath: pathname, localPath };
    }

    if (!isSafeRelativeAssetReference(src)) return null;

    for (const candidate of getRelativeAssetCandidates(src, defaultDirectories)) {
      const localPath = path.resolve(rootDirectory, candidate);
      if (!isInside(localPath, rootDirectory)) continue;
      if (!fs.existsSync(localPath)) continue;

      return {
        publicPath: `${publicPrefix}${candidate}`,
        localPath
      };
    }

    return null;
  }

  function getLocalImageAsset(src = "") {
    return getLocalAssetInfo(src, localImageRoot, "/assets/images/", defaultLocalImageDirectories);
  }

  function getLocalVideoAsset(src = "") {
    return getLocalAssetInfo(src, localVideoRoot, "/assets/videos/", defaultLocalVideoDirectories);
  }

  async function getLocalImageDimensions(src = "") {
    const imagePath = getLocalImageAsset(src)?.localPath;
    if (!imagePath) return null;

    if (!imageDimensionsCache.has(imagePath)) {
      imageDimensionsCache.set(
        imagePath,
        sharp(imagePath)
          .metadata()
          .then((metadata) => {
            if (!metadata.width || !metadata.height) return null;
            return { width: metadata.width, height: metadata.height, hasAlpha: Boolean(metadata.hasAlpha) };
          })
          .catch(() => null)
      );
    }

    const dimensions = await imageDimensionsCache.get(imagePath);
    if (!dimensions && !warnedMediaAssets.has(imagePath)) {
      warnedMediaAssets.add(imagePath);
      console.warn(`Could not read image dimensions for ${path.relative(root, imagePath)}`);
    }

    return dimensions;
  }

  // Tiny, heavily blurred preview inlined into the HTML as a data URI. It paints instantly
  // (no extra request) so the image area shows a blurred placeholder instead of a blank box
  // while the full image streams in.
  async function getImageLqip(asset) {
    if (!imageLqipCache.has(asset.localPath)) {
      imageLqipCache.set(
        asset.localPath,
        sharp(asset.localPath, { failOn: "none" })
          .rotate()
          .resize({ width: 24 })
          .blur()
          .webp({ quality: 40 })
          .toBuffer()
          .then((buffer) => `data:image/webp;base64,${buffer.toString("base64")}`)
          .catch(() => "")
      );
    }

    return imageLqipCache.get(asset.localPath);
  }

  async function getFileHash(filePath = "") {
    if (!fileHashCache.has(filePath)) {
      fileHashCache.set(
        filePath,
        fs.promises
          .readFile(filePath)
          .then((buffer) => crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12))
      );
    }

    return fileHashCache.get(filePath);
  }

  function getResponsiveImageQuality(width) {
    return width >= highDensityWidthThreshold
      ? Math.min(highDensityImageQuality, responsiveImageQuality)
      : responsiveImageQuality;
  }

  function getResponsiveImagePublicPath(asset, width, hash, quality) {
    const relativeImagePath = path.relative(localImageRoot, asset.localPath).split(path.sep).join("/");
    const parsed = path.posix.parse(relativeImagePath);
    const directory = parsed.dir ? `${parsed.dir}/` : "";
    // Keep default-quality filenames stable; only reduced-quality variants get a suffix.
    const qualitySuffix = quality === responsiveImageQuality ? "" : `-q${quality}`;

    return `${responsiveImagePublicPrefix}${directory}${parsed.name}-${hash}-${width}${qualitySuffix}.webp`;
  }

  async function generateResponsiveImageVariant(asset, width) {
    const quality = getResponsiveImageQuality(width);
    const key = `${asset.localPath}:${width}:${quality}`;

    if (!responsiveImageCache.has(key)) {
      responsiveImageCache.set(
        key,
        (async () => {
          const hash = await getFileHash(asset.localPath);
          const publicPath = getResponsiveImagePublicPath(asset, width, hash, quality);
          const outputPath = path.resolve(outputRoot, publicPath.slice(1));
          const cachePath = path.resolve(responsiveImageCacheRoot, publicPath.slice(1));

          // A variant already in the manifest needs no bytes at all: its filename is derived
          // from the source hash, the width and the quality, so the URL is computable without
          // producing the file, and toDeliveryUrl will point the srcset at R2 either way.
          // Skipping here is what keeps a build from re-encoding — or even just re-copying —
          // ~5200 variants that nothing will read: the emitted HTML names media.mysite.example for
          // every one of them, and publish-build-media.js would then walk the whole tree only
          // to find each hash unchanged. What stays in _site is exactly the set that still has
          // to be served from Pages for one deploy: the variants this build just created.
          if (mediaManifest[objectKeyForPublicPath(publicPath)]) return publicPath;

          if (fs.existsSync(outputPath)) return publicPath;

          fs.mkdirSync(path.dirname(outputPath), { recursive: true });

          if (fs.existsSync(cachePath)) {
            fs.copyFileSync(cachePath, outputPath);
            return publicPath;
          }

          const tmpCachePath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
          fs.mkdirSync(path.dirname(cachePath), { recursive: true });

          await sharp(asset.localPath, { failOn: "none" })
            .rotate()
            .resize({
              width,
              withoutEnlargement: true
            })
            // smartSubsample keeps chroma cleaner at low quality — better bytes-per-quality,
            // which is what makes the aggressive high-density quality look fine on Retina.
            .webp({ quality, smartSubsample: true })
            .toFile(tmpCachePath);

          fs.renameSync(tmpCachePath, cachePath);
          fs.copyFileSync(cachePath, outputPath);
          return publicPath;
        })()
      );
    }

    return responsiveImageCache.get(key);
  }

  async function getResponsiveImageSrcset(asset, dimensions, extraWidths = []) {
    const extension = path.extname(asset.localPath).toLowerCase();
    if (!responsiveImageExtensions.has(extension)) return "";

    // Never expose the raw upload in the srcset. Cap at the largest configured width (or the
    // source width if it is smaller) and always serve a re-encoded variant — even the top stage,
    // so heavy originals (portrait uploads can be ~1 MB) never reach the browser.
    const maxWidth = Math.min(dimensions.width, responsiveImageWidths[responsiveImageWidths.length - 1]);
    const widths = [...new Set([...responsiveImageWidths, ...extraWidths, maxWidth])]
      .filter((width) => width <= maxWidth)
      .sort((a, b) => a - b);
    const entries = [];

    for (const width of widths) {
      const publicPath = await generateResponsiveImageVariant(asset, width);
      entries.push(`${toDeliveryUrl(publicPath)} ${width}w`);
    }

    return entries.length > 1 ? entries.join(", ") : "";
  }

  const { getAdminMediaReferences, getSitemapImages } = createMediaReferenceExtractor({
    getLocalImageAsset,
    getLocalVideoAsset
  });

  function isLocalVideoSource(src = "") {
    return Boolean(getLocalVideoAsset(src));
  }

  function getLocalVideoMetadata(src = "") {
    const asset = getLocalVideoAsset(src);
    return asset ? videoMetadata[asset.publicPath] || null : null;
  }

  function renderLocalVideoEmbed(src = "") {
    const asset = getLocalVideoAsset(src);
    if (!asset) return "";

    const type = videoMimeType(asset.publicPath);
    const typeAttribute = type ? ` type="${escapeHtml(type)}"` : "";

    return `<video controls width="100%"><source src="${escapeHtml(toDeliveryUrl(asset.publicPath))}"${typeAttribute}></video>`;
  }

  function normalizeLocalMediaSources(content = "") {
    return String(content)
      .replace(/<img\b[^>]*>/gi, (img) => {
        const asset = getLocalImageAsset(getHtmlAttribute(img, "src"));
        return asset ? setHtmlAttribute(img, "src", toDeliveryUrl(asset.publicPath)) : img;
      })
      .replace(/<video\b[^>]*>/gi, (video) => {
        const asset = getLocalVideoAsset(getHtmlAttribute(video, "src"));
        return asset ? setHtmlAttribute(video, "src", toDeliveryUrl(asset.publicPath)) : video;
      })
      .replace(/<source\b[^>]*>/gi, (source) => {
        const asset = getLocalVideoAsset(getHtmlAttribute(source, "src"));
        return asset ? setHtmlAttribute(source, "src", toDeliveryUrl(asset.publicPath)) : source;
      });
  }

  async function addImagePerformanceAttributes(content = "") {
    let hasPriorityImage = false;

    return replaceAsync(content, /<img\b[^>]*>/gi, async (img) => {
      const src = getHtmlAttribute(img, "src");
      const asset = getLocalImageAsset(src);
      if (!asset) return img;

      const dimensions = await getLocalImageDimensions(src);
      let next = img;

      const deliverySrc = toDeliveryUrl(asset.publicPath);
      if (normalizeEmbedUrl(src).split("#")[0].split("?")[0] !== deliverySrc) {
        next = setHtmlAttribute(next, "src", deliverySrc);
      }

      if (!dimensions) return next;

      const isPriorityImage = !hasPriorityImage;
      next = setHtmlAttribute(next, "width", String(dimensions.width));
      next = setHtmlAttribute(next, "height", String(dimensions.height));

      if (!hasHtmlAttribute(next, "srcset")) {
        const srcset = await getResponsiveImageSrcset(
          asset,
          dimensions,
          isPriorityImage ? priorityResponsiveImageWidths : []
        );
        if (srcset) next = setHtmlAttribute(next, "srcset", srcset);
      }

      if (hasHtmlAttribute(next, "srcset") && !hasHtmlAttribute(next, "sizes")) {
        next = setHtmlAttribute(next, "sizes", responsiveImageSizes);
      }

      if (!hasHtmlAttribute(next, "decoding")) {
        next = setHtmlAttribute(next, "decoding", "async");
      }

      // Skip the blur-up background for transparent images — it would show through the
      // transparent areas and look like the image lost its transparency.
      if (
        !hasHtmlAttribute(next, "style")
        && !dimensions.hasAlpha
        && responsiveImageExtensions.has(path.extname(asset.localPath).toLowerCase())
      ) {
        const lqip = await getImageLqip(asset);
        // Unquoted url() so the base64 survives HTML-attribute escaping untouched.
        if (lqip) next = setHtmlAttribute(next, "style", `background-image:url(${lqip});background-size:cover`);
      }

      if (isPriorityImage) {
        hasPriorityImage = true;

        if (!hasHtmlAttribute(next, "loading") && !hasHtmlAttribute(next, "fetchpriority")) {
          next = setHtmlAttribute(next, "fetchpriority", "high");
        }

        return next;
      }

      if (!hasHtmlAttribute(next, "loading") && getHtmlAttribute(next, "fetchpriority").toLowerCase() !== "high") {
        next = setHtmlAttribute(next, "loading", "lazy");
      }

      return next;
    });
  }

  function shouldConserveVideoPreload(page = {}) {
    const url = page.url || "";
    return url === "/" || /^\/page\/\d+\/?$/.test(url);
  }

  function getVideoPreloadValue(page = {}) {
    return shouldConserveVideoPreload(page) ? "none" : "metadata";
  }

  function addLocalVideoAttributes(content = "", options = {}) {
    return String(content).replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, (video) => {
      const openTag = video.match(/^<video\b[^>]*>/i)?.[0] || "";
      if (!openTag) return video;

      let nextVideo = video;
      let nextOpenTag = openTag;
      const directSrc = getHtmlAttribute(openTag, "src");
      const sourceTags = Array.from(video.matchAll(/<source\b[^>]*>/gi), ([source]) => source);
      const sources = [
        ...(directSrc ? [{ type: "video", src: directSrc }] : []),
        ...sourceTags
          .map((sourceTag) => ({ type: "source", sourceTag, src: getHtmlAttribute(sourceTag, "src") }))
          .filter((source) => source.src)
      ];
      const localSource = sources
        .map((source) => ({ ...source, asset: getLocalVideoAsset(source.src) }))
        .find((source) => source.asset);

      if (!localSource) return video;

      if (localSource.type === "video") {
        nextOpenTag = setHtmlAttribute(nextOpenTag, "src", toDeliveryUrl(localSource.asset.publicPath));
      } else if (localSource.sourceTag) {
        nextVideo = nextVideo.replace(
          localSource.sourceTag,
          setHtmlAttribute(localSource.sourceTag, "src", toDeliveryUrl(localSource.asset.publicPath))
        );
      }

      const metadata = getLocalVideoMetadata(localSource.asset.publicPath);

      if (metadata) {
        nextOpenTag = setHtmlAttribute(nextOpenTag, "width", String(metadata.width));
        nextOpenTag = setHtmlAttribute(nextOpenTag, "height", String(metadata.height));

        if (metadata.poster && !hasHtmlAttribute(nextOpenTag, "poster")) {
          nextOpenTag = setHtmlAttribute(nextOpenTag, "poster", toDeliveryUrl(metadata.poster));
        }
      }

      if (options.preload && !hasHtmlAttribute(nextOpenTag, "autoplay")) {
        nextOpenTag = setHtmlAttribute(nextOpenTag, "preload", getVideoPreloadValue(options.page));
      }

      return nextVideo.replace(openTag, nextOpenTag);
    });
  }

  function addLocalVideoMetadataAttributes(content = "") {
    return addLocalVideoAttributes(content);
  }

  function addFeedMediaAttributes(content = "") {
    return addLocalVideoMetadataAttributes(normalizeLocalMediaSources(content));
  }

  function addVideoPreloadAttributes(content = "", page = {}) {
    return addLocalVideoAttributes(content, { page, preload: true });
  }

  async function addMediaPerformanceAttributes(content = "", page = {}) {
    const withImageAttributes = await addImagePerformanceAttributes(content);
    return addVideoPreloadAttributes(withImageAttributes, page);
  }

  return {
    addFeedMediaAttributes,
    addLocalVideoMetadataAttributes,
    addMediaPerformanceAttributes,
    getAdminMediaReferences,
    getLocalImageAsset,
    getLocalVideoAsset,
    getLocalVideoMetadata,
    getSitemapImages,
    toDeliveryUrl,
    isLocalVideoSource,
    normalizeLocalMediaSources,
    renderLocalVideoEmbed
  };
}

module.exports = {
  createMediaAssetHelpers
};
