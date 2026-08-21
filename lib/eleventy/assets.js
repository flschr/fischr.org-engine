const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const defaultFingerprintDirectories = ["css", "js"];
const defaultFingerprintExtensions = new Set([".css", ".js"]);
const defaultHashLength = 12;

function isInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function splitUrl(value = "") {
  const match = String(value).match(/^([^?#]*)([?#][\s\S]*)?$/);
  return {
    pathname: match?.[1] || "",
    suffix: match?.[2] || ""
  };
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

function hashFile(filePath, length) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
    .slice(0, length);
}

function createAssetHelpers(options = {}) {
  const root = options.root || process.cwd();
  const publicRoot = options.publicRoot || path.resolve(root, "blog");
  const outputRoot = options.outputRoot || path.resolve(root, "_site");
  const fingerprintDirectories = options.fingerprintDirectories || defaultFingerprintDirectories;
  const fingerprintExtensions = options.fingerprintExtensions || defaultFingerprintExtensions;
  const hashLength = options.hashLength || defaultHashLength;

  function getFingerprintableAsset(value = "") {
    if (value === null || value === undefined) return null;

    const raw = String(value);
    const { pathname, suffix } = splitUrl(raw);

    if (!pathname.startsWith("/assets/")) return null;

    const relativeAssetPath = pathname.slice("/assets/".length);
    const directory = relativeAssetPath.split("/")[0];
    if (!fingerprintDirectories.includes(directory)) return null;
    if (!fingerprintExtensions.has(path.extname(relativeAssetPath).toLowerCase())) return null;

    const filePath = path.resolve(publicRoot, pathname.slice(1));
    if (!isInside(filePath, publicRoot) || !fs.existsSync(filePath)) return null;

    return { filePath, pathname, raw, suffix };
  }

  function getFingerprintableAssets() {
    return fingerprintDirectories.flatMap((directory) => {
      const directoryPath = path.resolve(publicRoot, "assets", directory);

      return walkFiles(directoryPath)
        .filter((filePath) => fingerprintExtensions.has(path.extname(filePath).toLowerCase()))
        .map((filePath) => {
          const pathname = `/${path.relative(publicRoot, filePath).split(path.sep).join("/")}`;
          return { filePath, pathname, raw: pathname, suffix: "" };
        });
    });
  }

  function getFingerprintedPath(asset) {
    const parsed = path.posix.parse(asset.pathname);
    const hash = hashFile(asset.filePath, hashLength);
    return `${parsed.dir}/${parsed.name}.${hash}${parsed.ext}`;
  }

  function assetUrl(value = "") {
    const asset = getFingerprintableAsset(value);
    if (!asset) return value === null || value === undefined ? "" : String(value);

    return `${getFingerprintedPath(asset)}${asset.suffix}`;
  }

  function removeStaleFingerprintedAssets(assets) {
    const currentOutputPaths = new Set(
      assets.map((asset) => path.resolve(outputRoot, getFingerprintedPath(asset).slice(1)))
    );

    fingerprintDirectories.forEach((directory) => {
      const outputDirectory = path.resolve(outputRoot, "assets", directory);

      walkFiles(outputDirectory).forEach((filePath) => {
        const extension = path.extname(filePath).toLowerCase();
        const basename = path.basename(filePath);
        if (!fingerprintExtensions.has(extension)) return;
        if (!new RegExp(`\\.[a-f0-9]{${hashLength}}\\${extension}$`).test(basename)) return;
        if (currentOutputPaths.has(filePath)) return;

        fs.rmSync(filePath, { force: true });
      });
    });
  }

  function copyFingerprintedAssets() {
    const assets = getFingerprintableAssets();

    assets.forEach((asset) => {
      const outputPath = path.resolve(outputRoot, getFingerprintedPath(asset).slice(1));
      const unversionedOutputPath = path.resolve(outputRoot, asset.pathname.slice(1));

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.copyFileSync(asset.filePath, outputPath);
      fs.rmSync(unversionedOutputPath, { force: true });
    });

    removeStaleFingerprintedAssets(assets);
  }

  return {
    assetUrl,
    copyFingerprintedAssets,
    getFingerprintableAssets
  };
}

function createAssetUrlFilter(options = {}) {
  return createAssetHelpers(options).assetUrl;
}

module.exports = {
  createAssetHelpers,
  createAssetUrlFilter
};
