(function gpxUploadModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWGpxUpload = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGpxUploadModule() {
  "use strict";

  function validateDocument(document) {
    if (!document || document.querySelector("parsererror")) {
      throw new Error("Die GPX-Datei ist kein gültiges XML-Dokument.");
    }
    if (document.documentElement?.localName?.toLowerCase() !== "gpx") {
      throw new Error("Die Datei besitzt kein gültiges GPX-Wurzelelement.");
    }
    const validPoints = Array.from(document.querySelectorAll("trkpt, rtept")).filter((point) => (
      Number.isFinite(Number.parseFloat(point.getAttribute("lat")))
      && Number.isFinite(Number.parseFloat(point.getAttribute("lon")))
    ));
    if (validPoints.length < 2) {
      throw new Error("Die GPX-Datei enthält weniger als zwei gültige Trackpunkte.");
    }
    return validPoints.length;
  }

  function create(options = {}) {
    const Parser = options.Parser;
    const maxBytes = Number(options.maxBytes) || 10 * 1024 * 1024;
    const gpxDir = options.gpxDir || "blog/assets/files/gpx";
    const random = options.random || Math.random;

    async function prepare(file) {
      if (!file || !/\.gpx$/i.test(file.name || "")) throw new Error("Bitte eine GPX-Datei auswählen.");
      if (file.size > maxBytes) throw new Error(`GPX-Datei zu groß: maximal ${options.formatBytes(maxBytes)}.`);
      if (!Parser) throw new Error("GPX-Dateien können in diesem Browser nicht gelesen werden.");

      const xml = await file.text();
      const document = new Parser().parseFromString(xml, "application/xml");
      validateDocument(document);
      const dataUrl = await options.readFileAsDataUrl(file);
      const unique = random().toString(36).slice(2, 6);
      const name = `${options.todayPrefix()}-${options.uploadStamp()}-${options.slugify(options.baseName(file.name))}-${unique}.gpx`;
      const path = `${gpxDir}/uploads/${name}`;
      return {
        path,
        kind: "upsert",
        type: "binary",
        encoding: "base64",
        collection: "media",
        label: file.name,
        content: dataUrl.split(",")[1] || "",
        publicPath: options.publicMediaPath(path),
        mediaKind: "gpx",
        size: file.size,
        updatedAt: new Date().toISOString(),
        summary: "Upload"
      };
    }

    return { prepare };
  }

  return { create, validateDocument };
});
