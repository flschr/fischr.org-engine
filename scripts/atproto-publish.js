#!/usr/bin/env node

// Publishes blog posts as standard.site `site.standard.document` records on the
// author's AT Protocol repository. Mirrors the structure of social-post.js and
// reuses the same Bluesky app password. Record keys are derived deterministically
// from the post slug so the Eleventy build can emit a matching verification
// `<link>` tag without any runtime lookup.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { BskyAgent } = require("@atproto/api");
const {
  root,
  loadConfig,
  readJson,
  writeJson,
  listPublishedPosts,
  keepLive,
  positiveInteger,
  getLocalImage
} = require("./lib/publish-utils");
const { documentRkey, publicationUri } = require("../lib/atproto");

const identityFile = path.join(root, "blog/_data/atproto.json");
const stateFile = path.join(root, "automation/atproto-documents.json");

const collection = "site.standard.document";
const maxCoverBytes = 1000 * 1000; // lexicon caps coverImage at < 1 MB
const maxTextContent = 30000;
const maxDescription = 1000;

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const identity = readJson(identityFile, {});
  if (!identity.enabled || !identity.did || !identity.publicationRkey) {
    console.log("Skipping standard.site; atproto identity is not configured in blog/_data/atproto.json.");
    return;
  }

  const config = loadConfig();
  const atprotoConfig = config.atproto || {};
  const site = publicationUri(identity);
  const state = readJson(stateFile, {});
  const posts = listPublishedPosts(config);
  const maxPosts = positiveInteger(
    process.env.ATPROTO_MAX_POSTS_PER_RUN ?? atprotoConfig.maxPostsPerRun,
    5,
    "ATPROTO_MAX_POSTS_PER_RUN"
  );

  const candidates = [];
  for (const post of posts) {
    const record = buildRecord(post, site);
    const fingerprint = hashRecord(record, post);
    const previous = state[post.url];
    if (previous && previous.fingerprint === fingerprint) continue;

    candidates.push({ post, record, fingerprint, previous });
  }

  if (candidates.length === 0) {
    console.log("No posts waiting for standard.site publishing.");
    return;
  }

  // The record carries a back-verification link to post.url (the build emits a
  // matching <link> tag), which 404s until the deploy lands — and a record
  // published in that window is not re-pushed, since its fingerprint is
  // unchanged. So skip a post until its page is live. Filter before the per-run
  // cap so a persistently unreachable post can't starve healthy ones.
  const liveCandidates = (
    await keepLive(candidates, (candidate) => candidate.post.url, {
      getDate: (candidate) => candidate.post.date
    })
  ).slice(0, maxPosts);

  if (liveCandidates.length === 0) {
    console.log("No live posts ready for standard.site yet.");
    return;
  }

  const handle = process.env.BSKY_HANDLE || identity.handle || "";
  const password = process.env.BSKY_APP_PASSWORD || process.env.BSKY_PW || "";
  if (!handle || !password) {
    console.log("Skipping standard.site; BSKY_HANDLE and BSKY_APP_PASSWORD are not configured.");
    return;
  }

  const service = process.env.BSKY_SERVICE || "https://bsky.social";
  const agent = new BskyAgent({ service });
  await agent.login({ identifier: handle, password });

  if (agent.session?.did && agent.session.did !== identity.did) {
    throw new Error(`Logged-in DID ${agent.session.did} does not match configured DID ${identity.did}.`);
  }

  let hasFailures = false;

  for (const candidate of liveCandidates) {
    const { post, record, fingerprint, previous } = candidate;
    const rkey = documentRkey({ slug: post.slug, fileSlug: path.basename(post.file, ".md") });

    try {
      const cover = await resolveCoverImage(agent, post, previous);
      if (cover) record.coverImage = cover.blob;

      if (previous?.uri) {
        record.updatedAt = new Date().toISOString();
      }

      const result = await agent.com.atproto.repo.putRecord({
        repo: agent.session.did,
        collection,
        rkey,
        record
      });

      state[post.url] = {
        rkey,
        uri: result.data.uri,
        cid: result.data.cid,
        fingerprint,
        coverFingerprint: cover ? cover.fingerprint : "",
        coverBlob: cover ? cover.blob : null,
        publishedAt: post.date.toISOString(),
        updatedAt: record.updatedAt || ""
      };

      console.log(`${previous?.uri ? "Updated" : "Published"} standard.site document: ${post.title} (${rkey})`);
    } catch (error) {
      hasFailures = true;
      console.error(`standard.site failed for ${post.url}: ${error.message}`);
    }
  }

  writeJson(stateFile, state);

  if (hasFailures) process.exitCode = 1;
}

function buildRecord(post, site) {
  const record = {
    $type: collection,
    site,
    path: post.urlPath,
    title: post.title,
    publishedAt: post.date.toISOString()
  };

  const description = buildDescription(post);
  if (description) record.description = description;

  const textContent = (post.content || "").slice(0, maxTextContent).trim();
  if (textContent) record.textContent = textContent;

  if (post.tags?.length) record.tags = post.tags.slice(0, 25);

  return record;
}

function buildDescription(post) {
  const source = String(post.content || "").trim();
  if (!source) return "";
  if (source.length <= maxDescription) return source;
  return `${source.slice(0, maxDescription - 1).replace(/\s+\S*$/, "")}…`;
}

async function resolveCoverImage(agent, post, previous) {
  const image = getLocalImage(post);
  if (!image) return null;
  if (image.size > maxCoverBytes) {
    console.log(`Skipping standard.site cover for ${post.url}; image is >= 1 MB.`);
    return null;
  }

  const fingerprint = `${image.path}:${image.size}`;

  // Reuse the previously uploaded blob when the image has not changed,
  // so we do not create an orphaned blob on every content edit.
  if (previous?.coverBlob && previous.coverFingerprint === fingerprint) {
    return { blob: previous.coverBlob, fingerprint };
  }

  const buffer = fs.readFileSync(image.path);
  const upload = await agent.uploadBlob(buffer, { encoding: image.mimeType });
  return { blob: upload.data.blob, fingerprint };
}

function hashRecord(record, post) {
  const image = getLocalImage(post);
  const coverKey = image ? `${image.path}:${image.size}` : "";
  const canonical = JSON.stringify({
    site: record.site,
    path: record.path,
    title: record.title,
    description: record.description || "",
    textContent: record.textContent || "",
    tags: record.tags || [],
    publishedAt: record.publishedAt,
    coverKey
  });

  return crypto.createHash("sha256").update(canonical).digest("hex");
}
