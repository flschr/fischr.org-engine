#!/usr/bin/env node

const { validationMode } = require("./lib/publish-validation");
const { applyPathDelta, checkoutBranch, countChanges, diffPaths, git, gitQuiet, rev, writeOutput } = require("./lib/publish-git");
const { reconcileDrafts } = require("./lib/reconcile-drafts");
const sourcePages = require("../blog/admin/source-pages");

const managedPaths = [
  "blog/posts",
  "blog/pages",
  ...sourcePages.paths(),
  "blog/_data/videoMetadata.json",
  "blog/assets/images",
  "blog/assets/videos",
  "blog/assets/files/gpx",
  // Admin image uploads normalize straight to R2 (scripts/admin-normalize-image.js) instead of
  // committing the WebP to `drafts` — the upload record under automation/media-uploads/ is the
  // only trace of that upload that needs to travel from `drafts` to `main` through the
  // transactional publish. The manifest itself stays listed because the production build folds
  // those records into it and a publish may carry that folded state.
  "automation/media-manifest.json",
  "automation/media-uploads"
];
const publishBranch = process.env.PUBLISH_BRANCH || "main";
const draftsBranch = process.env.DRAFTS_BRANCH || "drafts";
const requestId = process.env.PUBLISH_REQUEST_ID || "";
const expectedMainSha = process.env.MAIN_SHA || "";
const expectedDraftSha = process.env.DRAFT_SHA || "";
const requestedChangeCount = process.env.CHANGE_COUNT || "";
// Die Auswahl aus der Warteschlange. Leer heisst „alles" — so verhält sich eine Veröffentlichung
// ohne Auswahl genau wie vorher, und ein älterer Admin kann weiter senden.
const auswahl = leseAuswahl(process.env.PUBLISH_PATHS);
const reconciliationAttempts = Number(process.env.RECONCILE_ATTEMPTS || 8);
const safelyConcurrentMainPaths = [
  /^automation\//,
  /^\.github\/scheduled-publish-state\.json$/
];

main();

function leseAuswahl(rohwert) {
  const text = String(rohwert || "").trim();
  if (!text) return null;
  let pfade;
  try {
    pfade = JSON.parse(text);
  } catch {
    throw new Error("PUBLISH_PATHS ist kein gültiges JSON.");
  }
  if (!Array.isArray(pfade)) throw new Error("PUBLISH_PATHS muss eine Liste von Pfaden sein.");
  // Eine leere Liste ist etwas anderes als keine Liste: Sie hiesse „nichts senden", und das ist
  // kein Zustand, den jemand gemeint haben kann — die Veröffentlichung wäre folgenlos.
  if (!pfade.length) throw new Error("PUBLISH_PATHS ist leer — es gäbe nichts zu veröffentlichen.");
  return new Set(pfade.map((pfad) => String(pfad)));
}

function main() {
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);

  if (process.argv.includes("--push-final")) {
    pushFinalCommit();
    return;
  }

  if (process.argv.includes("--reconcile-drafts")) {
    const finalCommit = process.env.FINAL_SHA || "";
    if (!finalCommit) throw new Error("FINAL_SHA is required.");
    if (!expectedDraftSha) throw new Error("DRAFT_SHA is required.");
    reconcileDrafts({
      finalCommit,
      expectedMainSha,
      expectedDraftSha,
      auswahl,
      publishBranch,
      draftsBranch,
      managedPaths,
      attempts: reconciliationAttempts,
      fetchRefs
    });
    return;
  }

  preparePublishCommit();
}

function preparePublishCommit() {
  requirePublishRequest();

  fetchRefs();
  const currentMainSha = assertMainCompatible();
  assertReviewedDraftExists();
  const workBranch = `admin-publish-work-${process.pid}`;

  // Start from the exact main commit the admin reviewed and apply only the
  // reviewed main..drafts delta. Newer drafts commits are intentionally absent.
  checkoutBranch(workBranch, currentMainSha);
  applyPathDelta(expectedMainSha, expectedDraftSha, managedPaths, auswahl);
  assertReviewedImagesNormalized();
  assertVideoDerivativesPrepared();
  git(["add", "-A", "--", "."]);

  let finalCommit = currentMainSha;
  if (gitQuiet(["diff", "--cached", "--quiet"])) {
    console.log("No managed changes to publish.");
  } else {
    const tree = git(["write-tree"]);
    const changeCount = requestedChangeCount || countChanges(expectedMainSha, expectedDraftSha, managedPaths, auswahl);
    const message = `Publish ${changeCount} change${String(changeCount) === "1" ? "" : "s"} [admin-publish] [skip ci]`;
    finalCommit = git(["commit-tree", tree, "-p", currentMainSha, "-m", message]);
  }

  console.log(`Prepared transactional publish ${requestId}: ${finalCommit} from ${currentMainSha}.`);
  writeOutput("final_sha", finalCommit);
  writeOutput("base_sha", currentMainSha);
  writeOutput("validation_mode", validationMode(diffPaths(expectedMainSha, expectedDraftSha, managedPaths, auswahl)));
}

function pushFinalCommit() {
  const preparedCommit = process.env.FINAL_SHA || "";
  const baseSha = process.env.BASE_SHA || "";
  if (!preparedCommit) throw new Error("FINAL_SHA is required.");
  if (!baseSha) throw new Error("BASE_SHA is required.");

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    git(["fetch", "--quiet", "origin", publishBranch]);
    const currentMainSha = rev(`origin/${publishBranch}`);
    let finalCommit = preparedCommit;
    if (currentMainSha !== baseSha) {
      const conflictingPaths = diffPaths(baseSha, currentMainSha).filter(
        (changedPath) => !safelyConcurrentMainPaths.some((pattern) => pattern.test(changedPath))
      );
      if (conflictingPaths.length) {
        throw new Error(
          `${publishBranch} moved in publish-relevant files while the build was running: ${conflictingPaths.join(", ")}. Retry publish.`
        );
      }
      checkoutBranch(`admin-publish-rebase-${process.pid}`, currentMainSha);
      applyPathDelta(baseSha, preparedCommit, managedPaths, auswahl);
      const tree = git(["write-tree"]);
      finalCommit = git([
        "commit-tree", tree,
        "-p", currentMainSha,
        "-m", `Publish ${requestedChangeCount || "reviewed"} changes [admin-publish] [skip ci]`
      ]);
      console.log(`Preserved concurrent automation state on ${publishBranch}.`);
    }

    if (finalCommit === currentMainSha) {
      console.log(`${publishBranch} already contains the prepared publish result.`);
      writeOutput("deployed_sha", finalCommit);
      return;
    }
    if (gitQuiet(["push", "origin", `${finalCommit}:refs/heads/${publishBranch}`])) {
      console.log(`Published ${finalCommit} to ${publishBranch}.`);
      writeOutput("deployed_sha", finalCommit);
      return;
    }
    console.log(`${publishBranch} moved during final push (attempt ${attempt}/5); re-checking.`);
  }
  throw new Error(`Could not publish after 5 compare-and-swap attempts.`);
}

function fetchRefs() {
  git(["fetch", "--quiet", "origin", publishBranch, draftsBranch]);
}

function requirePublishRequest() {
  if (!requestId) throw new Error("PUBLISH_REQUEST_ID is required.");
  if (!expectedMainSha) throw new Error("MAIN_SHA is required.");
  if (!expectedDraftSha) throw new Error("DRAFT_SHA is required.");
}

function assertMainCompatible() {
  const currentMainSha = rev(`origin/${publishBranch}`);
  if (currentMainSha === expectedMainSha) return currentMainSha;

  const changedPaths = diffPaths(expectedMainSha, currentMainSha);
  const conflictingPaths = changedPaths.filter(
    (changedPath) => !safelyConcurrentMainPaths.some((pattern) => pattern.test(changedPath))
  );
  if (conflictingPaths.length) {
    if (reviewedDeltaAlreadyPublished(currentMainSha)) {
      console.log(`${publishBranch} already contains the reviewed delta; entering reconciliation recovery mode.`);
      return currentMainSha;
    }
    throw new Error(
      `${publishBranch} changed in publish-relevant files after review: ${conflictingPaths.join(", ")}. Refresh the queue and review again.`
    );
  }
  console.log(`${publishBranch} moved only in automation state; publishing on top of ${currentMainSha}.`);
  return currentMainSha;
}

function reviewedDeltaAlreadyPublished(currentMainSha) {
  const reviewedPaths = diffPaths(expectedMainSha, expectedDraftSha, managedPaths, auswahl);
  return reviewedPaths.length > 0 && reviewedPaths.every((changedPath) => {
    return blobAt(currentMainSha, changedPath) === blobAt(expectedDraftSha, changedPath);
  });
}

function blobAt(ref, filePath) {
  return gitQuiet(["cat-file", "-e", `${ref}:${filePath}`]) ? git(["rev-parse", `${ref}:${filePath}`]) : "";
}

function assertReviewedDraftExists() {
  git(["cat-file", "-e", `${expectedDraftSha}^{commit}`]);
}

// Compares the two reviewed commits directly. Diffing against HEAD looked equivalent but was
// not: applyPathDelta only fills index and working tree, so HEAD is still the untouched main
// commit and the comparison covered concurrent main movement instead of the reviewed delta —
// an unnormalized upload passed straight through into the published tree.
function assertReviewedImagesNormalized() {
  const rasterExtensions = /\.(?:avif|hei[cf]|jpe?g|png|tiff?|webp)$/i;
  const changedImages = diffPaths(expectedMainSha, expectedDraftSha, ["blog/assets/images"], auswahl);
  const unnormalized = changedImages.filter(
    (imagePath) => rasterExtensions.test(imagePath)
      && !imagePath.toLowerCase().endsWith(".webp")
      && blobAt(expectedDraftSha, imagePath)
  );
  if (unnormalized.length) {
    throw new Error(
      `Images must be normalized before review, not during publish: ${unnormalized.join(", ")}. Re-upload them in the admin.`
    );
  }
}

// Video sources live in R2 since DB-1129 and are not materialized in this checkout, so
// regenerating posters here would rewrite blog/_data/videoMetadata.json from an empty video
// directory and block every publish. The reviewable property is narrower and needs no bytes:
// a video the reviewed delta adds must already carry the metadata that
// scripts/admin-prepare-video.js commits to drafts. The posters themselves are regenerated by
// the production build from the materialized sources (npm run media:videos in build:site) and
// uploaded by scripts/publish-build-media.js.
//
// A prepared video leaves the delta as an upload record, not as a blob — preparation uploads it
// to R2 and drops the blob. Both shapes are checked: the record for the current path, and a
// still-committed blob for a video uploaded before that handover or never prepared at all.
function assertVideoDerivativesPrepared() {
  const reviewed = new Set([...reviewedVideoBlobPaths(), ...reviewedVideoUploadPaths()]);
  if (!reviewed.size) return;

  const metadata = reviewedVideoMetadata();
  const missing = Array.from(reviewed).filter((publicPath) => !metadata[publicPath]?.poster);
  if (missing.length) {
    throw new Error(
      `Video metadata must be generated on drafts before review: ${missing.join(", ")}. Re-open the admin and retry.`
    );
  }
}

function reviewedVideoBlobPaths() {
  const videoExtensions = /\.(?:m4v|mov|mp4|webm)$/i;
  return diffPaths(expectedMainSha, expectedDraftSha, ["blog/assets/videos"], auswahl)
    .filter((videoPath) => videoExtensions.test(videoPath) && blobAt(expectedDraftSha, videoPath))
    .map((videoPath) => `/${videoPath.replace(/^blog\//, "")}`);
}

function reviewedVideoUploadPaths() {
  return diffPaths(expectedMainSha, expectedDraftSha, ["automation/media-uploads"], auswahl)
    .filter((recordPath) => recordPath.endsWith(".json") && blobAt(expectedDraftSha, recordPath))
    .map((recordPath) => {
      try {
        return String(JSON.parse(git(["show", `${expectedDraftSha}:${recordPath}`])).key || "");
      } catch {
        return "";
      }
    })
    .filter((key) => key.startsWith("videos/"))
    .map((key) => `/assets/${key}`);
}

function reviewedVideoMetadata() {
  const metadataPath = "blog/_data/videoMetadata.json";
  if (!blobAt(expectedDraftSha, metadataPath)) return {};
  try {
    return JSON.parse(git(["show", `${expectedDraftSha}:${metadataPath}`]));
  } catch {
    return {};
  }
}
