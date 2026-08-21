const assert = require("node:assert/strict");
const test = require("node:test");

const { create, validateDocument } = require("../blog/admin/gpx-service.js");

function point(lat, lon) {
  return { getAttribute: (name) => ({ lat, lon })[name] };
}

class TestParser {
  parseFromString(xml) {
    const root = xml.match(/<([a-z]+)\b/i)?.[1] || "";
    const points = Array.from(xml.matchAll(/<(?:trkpt|rtept)\s+lat="([^"]+)"\s+lon="([^"]+)"/gi), (match) => point(match[1], match[2]));
    return {
      documentElement: { localName: root },
      querySelector: () => null,
      querySelectorAll: () => points
    };
  }
}

test("validates the GPX root and at least two numeric points", () => {
  assert.throws(() => validateDocument({
    documentElement: { localName: "html" }, querySelector: () => null, querySelectorAll: () => []
  }), /Wurzelelement/);
  assert.throws(() => validateDocument({
    documentElement: { localName: "gpx" }, querySelector: () => null, querySelectorAll: () => [point("48", "bad")]
  }), /weniger als zwei/);
  assert.equal(validateDocument({
    documentElement: { localName: "gpx" }, querySelector: () => null, querySelectorAll: () => [point("48", "11"), point("48.1", "11.1")]
  }), 2);
});

test("prepares a validated GPX upload for the drafts workflow", async () => {
  const service = create({
    Parser: TestParser,
    maxBytes: 1024,
    gpxDir: "blog/assets/files/gpx",
    baseName: () => "Morning Ride",
    formatBytes: (value) => `${value} B`,
    publicMediaPath: (path) => path.replace(/^blog/, ""),
    readFileAsDataUrl: async () => "data:application/gpx+xml;base64,VEVTVA==",
    slugify: () => "morning-ride",
    todayPrefix: () => "2026-07-19",
    uploadStamp: () => "20260719t120000",
    random: () => 0.5
  });
  const change = await service.prepare({
    name: "Morning Ride.gpx",
    size: 200,
    text: async () => '<gpx><trkpt lat="48" lon="11"/><trkpt lat="48.1" lon="11.1"/></gpx>'
  });

  assert.match(change.path, /^blog\/assets\/files\/gpx\/uploads\/2026-07-19-20260719t120000-morning-ride-/);
  assert.equal(change.publicPath, change.path.replace(/^blog/, ""));
  assert.equal(change.content, "VEVTVA==");
  assert.equal(change.mediaKind, "gpx");
});

test("rejects invalid, oversized and non-GPX files before upload", async () => {
  const service = create({
    Parser: TestParser,
    maxBytes: 10,
    formatBytes: String,
    readFileAsDataUrl: async () => { throw new Error("must not read"); }
  });

  await assert.rejects(service.prepare({ name: "route.txt", size: 1 }), /GPX-Datei/);
  await assert.rejects(service.prepare({ name: "route.gpx", size: 11 }), /zu groß/);
  await assert.rejects(service.prepare({ name: "route.gpx", size: 1, text: async () => "<gpx/>" }), /weniger als zwei/);
});
