#!/usr/bin/env node
// Reconciles the R2 bucket against the media manifest and reports the drift in both
// directions. Read-only by design: it lists and compares, it never deletes. Deleting media is
// a separate, deliberate act, and this report is what that act would have to be based on.
//
// Both directions matter, and one bucket listing answers both:
//
//   in the bucket, not in the manifest  → orphan; nothing references it and nothing collects it
//   in the manifest, not in the bucket  → missing; the site links it and it 404s silently
//   in both, different size             → the two disagree about the same key
//
// The "missing" direction is the one with teeth. Source files are hash-verified on every build
// (scripts/prepare-media-source.js downloads and checks them), but the ~5200 responsive
// variants are never read back — a lost variant would go unnoticed until someone looked at a
// page.
//
// False positives are the failure mode to design against: an earlier orphan report in this
// repository had 30 of 55 findings wrong. Two rules keep them out, and both matter:
//
//   1. A grace period. An object PUT by the admin lives in R2 before its upload record is
//      published, so anything recently written is never called an orphan.
//   2. The drafts branch. Those pending records exist on `drafts` long before they reach
//      `main`, so the manifest this compares against is the union of both branches.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { AwsClient } = require("aws4fetch");

const { bucketName, credentialsFromEnv, s3Endpoint } = require("./lib/r2-media");
const { manifestRelativePath, pendingUploadsRelativeDir } = require("../lib/media-manifest");

const root = process.cwd();
const reportPath = path.join(root, "automation/media-drift-report.json");
// Owned by the bucket's lifecycle rule (expire after 1 day), not by the manifest, so these are
// never orphans. They are still worth counting: a staged object is an untouched original with
// its EXIF — including GPS — intact, and one that outlives the rule is a privacy problem, not
// a housekeeping one.
const stagingPrefix = "staging/";
const graceDays = Number.parseInt(process.env.MEDIA_DRIFT_GRACE_DAYS || "14", 10);
const draftsBranch = process.env.DRAFTS_BRANCH || "drafts";

function xmlEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// The S3 ListObjectsV2 response is XML. Parsing it with a regex is a deliberate trade: the
// shape is fixed and narrow, and the alternative is adding an XML parser to a project whose
// only other runtime dependency is the S3 signer.
function parseListing(xml) {
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, entry]) => ({
    key: xmlEntities(entry.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || ""),
    size: Number(entry.match(/<Size>(\d+)<\/Size>/)?.[1] || 0),
    lastModified: entry.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] || ""
  }));

  return {
    objects: objects.filter((object) => object.key),
    truncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
    cursor: xmlEntities(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || "")
  };
}

async function listBucket(env) {
  const { accountId, accessKeyId, secretAccessKey } = credentialsFromEnv(env);
  const client = new AwsClient({ accessKeyId, secretAccessKey, region: "auto", service: "s3" });
  const base = `${s3Endpoint(accountId, env)}/${bucketName}`;
  const objects = [];
  let cursor = "";

  do {
    const url = new URL(base);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    if (cursor) url.searchParams.set("continuation-token", cursor);

    const response = await client.fetch(url.toString(), { signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      throw new Error(`Listing ${bucketName} failed: ${response.status} ${await response.text().catch(() => "")}`.trim());
    }

    const page = parseListing(await response.text());
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : "";
    if (page.truncated && !cursor) throw new Error("Listing reported more pages but returned no continuation token.");
  } while (cursor);

  return objects;
}

// maxBuffer is the reason this needs saying out loud: execFileSync defaults to 1 MB and the
// manifest is ~2.7 MB, so `git show` of it dies with ENOBUFS. Swallowed by the catch below, that
// looked exactly like "the branch is not there" — the first two production runs reported the
// drafts branch as unreadable for this reason and nothing else.
const gitMaxBuffer = 64 * 1024 * 1024;

function readJsonAt(ref, file) {
  try {
    return JSON.parse(
      execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: gitMaxBuffer })
    );
  } catch {
    return null;
  }
}

// Every key the manifest knows about anywhere: this working tree plus the drafts branch, whose
// pending upload records describe objects that are in R2 but not yet published.
function knownKeys() {
  const keys = new Map();
  const add = (key, entry, origin) => {
    if (typeof key === "string" && key && !keys.has(key)) keys.set(key, { entry, origin });
  };

  const localManifest = fs.existsSync(path.join(root, manifestRelativePath))
    ? JSON.parse(fs.readFileSync(path.join(root, manifestRelativePath), "utf8"))
    : {};
  for (const [key, entry] of Object.entries(localManifest)) add(key, entry, "manifest");

  const pendingDir = path.join(root, pendingUploadsRelativeDir);
  if (fs.existsSync(pendingDir)) {
    for (const name of fs.readdirSync(pendingDir)) {
      if (!name.endsWith(".json")) continue;
      const record = JSON.parse(fs.readFileSync(path.join(pendingDir, name), "utf8"));
      add(record?.key, record?.entry, "upload record");
    }
  }

  let draftsSeen = false;
  const draftsManifest = readJsonAt(`origin/${draftsBranch}`, manifestRelativePath);
  if (draftsManifest) {
    draftsSeen = true;
    for (const [key, entry] of Object.entries(draftsManifest)) add(key, entry, "drafts manifest");
  }
  const draftsRecords = execFileSyncSafe(["ls-tree", "--name-only", `origin/${draftsBranch}`, `${pendingUploadsRelativeDir}/`]);
  for (const file of draftsRecords.split("\n").filter((name) => name.endsWith(".json"))) {
    const record = readJsonAt(`origin/${draftsBranch}`, file);
    if (record) {
      draftsSeen = true;
      add(record.key, record.entry, "drafts upload record");
    }
  }

  return { keys, draftsSeen };
}

function execFileSyncSafe(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: gitMaxBuffer });
  } catch {
    return "";
  }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function ageInDays(iso, now) {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? (now - parsed) / 86400000 : 0;
}

async function main() {
  const now = Date.now();
  const { keys, draftsSeen } = knownKeys();
  // Hard failure rather than a warning: without the drafts branch the orphan list is built on
  // the grace period alone, and an admin upload older than it would be reported as reclaimable.
  // A report that quietly lost its main safeguard is worse than no report, because it still
  // looks authoritative. The first production run degraded exactly this way and only the log
  // said so.
  if (!draftsSeen && process.env.MEDIA_DRIFT_ALLOW_MISSING_DRAFTS !== "1") {
    console.error(
      `Cannot read the ${draftsBranch} branch, so media uploaded through the admin but not yet published ` +
      `would be reported as orphans.\n` +
      `  Fix: git fetch origin +refs/heads/${draftsBranch}:refs/remotes/origin/${draftsBranch}\n` +
      `  Or set MEDIA_DRIFT_ALLOW_MISSING_DRAFTS=1 to accept the weaker report.`
    );
    process.exit(1);
  }

  const objects = await listBucket(process.env);
  const inBucket = new Map(objects.map((object) => [object.key, object]));

  const staged = objects.filter((object) => object.key.startsWith(stagingPrefix));
  const orphans = [];
  for (const object of objects) {
    if (object.key.startsWith(stagingPrefix) || keys.has(object.key)) continue;
    const age = ageInDays(object.lastModified, now);
    // Recent writes are the admin's, mid-flight. Old ones have had every chance to be recorded.
    if (age < graceDays) continue;
    orphans.push({ key: object.key, size: object.size, ageDays: Math.round(age) });
  }

  const missing = [];
  const mismatched = [];
  for (const [key, { entry, origin }] of keys) {
    const object = inBucket.get(key);
    if (!object) {
      missing.push({ key, origin, size: entry?.size ?? null, sourcePath: entry?.sourcePath ?? null });
      continue;
    }
    if (typeof entry?.size === "number" && entry.size !== object.size) {
      mismatched.push({ key, manifestSize: entry.size, bucketSize: object.size });
    }
  }

  const report = {
    generatedAt: new Date(now).toISOString(),
    bucket: bucketName,
    graceDays,
    draftsIncluded: draftsSeen,
    totals: {
      objectsInBucket: objects.length,
      keysKnown: keys.size,
      orphans: orphans.length,
      missing: missing.length,
      sizeMismatches: mismatched.length,
      stagedObjects: staged.length
    },
    orphans: orphans.sort((a, b) => b.size - a.size),
    missing,
    sizeMismatches: mismatched,
    staged: staged.map((object) => ({ key: object.key, ageDays: Math.round(ageInDays(object.lastModified, now)) }))
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const reclaimable = orphans.reduce((sum, orphan) => sum + orphan.size, 0);
  console.log(`Bucket ${bucketName}: ${objects.length} objects, manifest knows ${keys.size} keys.`);
  console.log(`  Orphans (older than ${graceDays} d): ${orphans.length}${orphans.length ? ` — ${formatBytes(reclaimable)} reclaimable` : ""}`);
  console.log(`  Missing from the bucket:            ${missing.length}`);
  console.log(`  Size mismatches:                    ${mismatched.length}`);
  console.log(`  Staged originals still present:     ${staged.length}`);
  for (const object of report.staged.filter((entry) => entry.ageDays >= 1)) {
    console.warn(`::warning::${stagingPrefix}${object.key} is ${object.ageDays} d old — the lifecycle rule should have expired it.`);
  }
  console.log(`\nWritten to ${path.relative(root, reportPath)}. Nothing was deleted; this report never deletes.`);

  // Only the direction that means the live site is broken fails the run. Orphans cost storage,
  // which is not worth waking anyone up for.
  if (missing.length || mismatched.length) {
    console.error(`\n${missing.length + mismatched.length} object(s) the manifest promises are missing or differ in the bucket.`);
    [...missing.slice(0, 20)].forEach((entry) => console.error(`- missing: ${entry.key} (${entry.origin})`));
    mismatched.slice(0, 20).forEach((entry) => console.error(`- differs: ${entry.key} (manifest ${entry.manifestSize} B, bucket ${entry.bucketSize} B)`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
