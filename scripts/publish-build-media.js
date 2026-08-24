#!/usr/bin/env node
// Post-build step: uploads generated responsive image variants and video posters to R2 and
// records them in automation/media-manifest.json, so the delivery mapping in
// lib/eleventy/media-assets.js (toDeliveryUrl) picks them up as "migrated" on the next build.
//
// This intentionally runs AFTER `eleventy` finishes, not during rendering: rendering decides
// each <img>/<video>'s emitted URL from the manifest as it stood at the *start* of the build,
// so a brand-new responsive variant is served from Cloudflare Pages for that one build, then
// from media.mysite.example from the next build onward once this step has uploaded it. Existing,
// previously-uploaded variants are unaffected (their hash-named file, and therefore their
// manifest entry, never changes) — this only ever affects genuinely new/changed images.

const fs = require("fs");
const path = require("path");

const { loadManifest, publishMediaFile, rasterDimensions, rasterLqip, vollstaendigBeschrieben, removePendingUploads, saveManifest } = require("./lib/r2-media");

const root = process.cwd();
const responsiveRoot = path.join(root, "_site/assets/images/responsive");
const posterRoot = path.join(root, "blog/assets/images/video-posters");

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : entry.isFile() ? [full] : [];
  });
}

function publicPathFor(localPath, root, prefix) {
  return `${prefix}${path.relative(root, localPath).split(path.sep).join("/")}`;
}

const concurrency = Number.parseInt(process.env.R2_UPLOAD_CONCURRENCY || "12", 10);

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function runNext() {
    const index = next;
    next += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index]);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

async function main() {
  const manifest = loadManifest();
  const candidates = [
    ...listFiles(responsiveRoot).map((file) => ({
      localPath: file,
      publicPath: publicPathFor(file, responsiveRoot, "/assets/images/responsive/")
    })),
    ...listFiles(posterRoot).map((file) => ({
      localPath: file,
      publicPath: publicPathFor(file, posterRoot, "/assets/images/video-posters/")
    }))
  ];

  // publishMediaFile mutates `manifest` synchronously right after its await resolves, and each
  // candidate has a distinct key — concurrent workers never touch the same entry at once.
  const results = await runWithConcurrency(candidates, concurrency, ({ localPath, publicPath }) =>
    publishMediaFile({ localPath, publicPath, manifest })
  );

  // Fehlende Kennwerte nachtragen, solange die Bytes ohnehin auf der Platte liegen.
  //
  // Der Bau braucht von jedem Bild drei Dinge: Abmessungen, den Hash für die Variantennamen und
  // den unscharfen Platzhalter. Stehen sie im Manifest, muss die Datei nicht heruntergeladen
  // werden — und genau das spart den grössten Posten im Bau.
  //
  // Zwei Wege erzeugen Einträge ohne diese Werte: der Upload aus dem Admin (der Worker hat
  // keinen Bilddecoder) und alles, was vor dieser Änderung entstanden ist. Beide heilen hier,
  // beim ersten Bau, der die Datei ohnehin geladen hat. Danach kostet sie keinen Download mehr.
  const nachgetragen = await ergaenzeKennwerte(manifest);

  const uploaded = results.filter((result) => result === "uploaded").length;
  const unchanged = results.length - uploaded;

  // loadManifest() merged in any automation/media-uploads/ records the admin created since
  // the last production build, so writing it back is the fold; removing the records is the
  // other half. Both must land in the same commit (see the workflow's commit step), or the
  // records come back on the next build.
  saveManifest(manifest);
  const foldedRecords = removePendingUploads();
  if (nachgetragen) console.log(`Media manifest: ${nachgetragen} entr${nachgetragen === 1 ? "y" : "ies"} gained their build metadata.`);

  const folded = foldedRecords.length ? `, ${foldedRecords.length} upload record(s) folded into the manifest` : "";
  console.log(`Build media publish: ${candidates.length} candidates, ${uploaded} uploaded, ${unchanged} already up to date${folded}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function ergaenzeKennwerte(manifest) {
  let ergaenzt = 0;

  for (const eintrag of Object.values(manifest)) {
    if (!eintrag?.sourcePath) continue;
    if (vollstaendigBeschrieben(eintrag)) continue;

    const localPath = path.join(root, eintrag.sourcePath);
    if (!fs.existsSync(localPath)) continue;

    const dimensions = await rasterDimensions(localPath);
    if (!dimensions) continue;

    Object.assign(eintrag, {
      width: dimensions.width,
      height: dimensions.height,
      hasAlpha: dimensions.hasAlpha
    });
    // Kein Platzhalter für durchsichtige Bilder — siehe rasterLqip in scripts/lib/r2-media.js.
    // Auch keiner, der schon dasteht: Ein Eintrag, der einen trägt, ist die Zusage, dass er
    // gezeigt werden darf.
    if (dimensions.hasAlpha) delete eintrag.lqip;
    else if (!eintrag.lqip) {
      const lqip = await rasterLqip(localPath);
      if (lqip) eintrag.lqip = lqip;
    }
    ergaenzt += 1;
  }

  return ergaenzt;
}
