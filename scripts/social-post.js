#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  root,
  loadConfig,
  readJson,
  writeJson,
  listPublishedPosts,
  keepLive,
  positiveInteger,
  resolveRule,
  renderPostText,
  getLocalImages
} = require("./lib/publish-utils");
const { fetchWithTimeout, HttpResponseError, responseText } = require("./lib/http-utils");

const stateFile = path.join(root, "automation/social-posts.json");
const gotosocialLimit = 500;
const gotosocialMaxImageSize = 8 * 1024 * 1024;

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

async function main() {
  const config = loadConfig();
  const socialConfig = config.social || {};
  const state = readJson(stateFile, {});
  const posts = listPublishedPosts(config);
  const maxPosts = positiveInteger(
    process.env.SOCIAL_MAX_POSTS_PER_RUN ?? config.maxPostsPerRun,
    3,
    "SOCIAL_MAX_POSTS_PER_RUN"
  );
  const candidates = [];

  for (const post of posts) {
    // A post can opt out of social syndication entirely (the page still gets
    // built and indexed; only the GoToSocial post is suppressed).
    if (!post.syndicate) continue;

    // The Beitragsart (category) decides the template + image. It's the post's
    // explicit `category`, else the configured default category.
    const rule = resolveRule(post, socialConfig);
    if (!rule) continue;

    if (state[post.url]?.gotosocial || state[post.url]?.mastodon) continue;

    candidates.push({ post, rule });
  }

  if (candidates.length === 0) {
    console.log("No published posts waiting for social posting.");
    return;
  }

  // Don't syndicate a link before the page is live (a just-due scheduled post may
  // not be deployed yet) — it would 404 on the social network's link preview.
  // Filter by liveness *before* applying the per-run cap, so a persistently
  // unreachable post can't occupy a cap slot every run and starve a healthy one.
  const liveCandidates = (
    await keepLive(candidates, (candidate) => candidate.post.url, {
      getDate: (candidate) => candidate.post.date
    })
  ).slice(0, maxPosts);
  requireLiveCandidates(candidates, liveCandidates, process.env.RETRY_UNREACHABLE_POSTS === "1");
  if (liveCandidates.length === 0) {
    console.log("No live posts ready for social posting yet.");
    return;
  }

  let hasFailures = false;

  for (const candidate of liveCandidates) {
    const { post, rule } = candidate;
    const images = getLocalImages(post, rule);

    state[post.url] ||= {};
    console.log(`Processing social post: ${post.title} (${rule.name})`);

    try {
      const result = await postToGoToSocial(config, post, rule, images, {
        pendingMedia: state[post.url].pendingMedia || [],
        onPendingMedia: (pendingMedia) => {
          state[post.url].pendingMedia = pendingMedia;
        }
      });
      if (result) {
        delete state[post.url].pendingMedia;
        state[post.url].gotosocial = result;
      }
    } catch (error) {
      hasFailures = true;
      console.error(`GoToSocial failed for ${post.url}: ${error.message}`);
    }

    if (Object.keys(state[post.url]).length === 0) delete state[post.url];
  }

  writeJson(stateFile, state);

  if (hasFailures) {
    process.exitCode = 1;
  }
}

function requireLiveCandidates(candidates, liveCandidates, retryUnreachable) {
  if (retryUnreachable && candidates.length > 0 && liveCandidates.length === 0) {
    throw new Error("Published posts are pending but not live yet; retrying after propagation delay.");
  }
}

async function postToGoToSocial(config, post, rule, images, options = {}) {
  const token = process.env.MASTODON_ACCESS_TOKEN || process.env.MASTO_TOKEN || "";
  if (!token) {
    console.log("Skipping GoToSocial; MASTODON_ACCESS_TOKEN is not configured.");
    return null;
  }

  const instance = (process.env.MASTODON_INSTANCE || config.social?.gotosocialInstance || config.social?.mastodonInstance || "").replace(/\/$/, "");
  if (!instance) throw new Error("GoToSocial instance is not configured.");
  const status = renderPostText(post, rule, gotosocialLimit, { preserveMarkdownLinks: true });
  const previousMedia = new Map(
    (options.pendingMedia || []).map((entry) => [entry.fingerprint, entry.id])
  );
  const pendingMedia = [];

  for (const image of images || []) {
    if (image.size > gotosocialMaxImageSize) {
      console.log(`Skipping a GoToSocial image for ${post.url}; file is too large.`);
      continue;
    }

    const fingerprint = createMediaFingerprint(image);
    let id = previousMedia.get(fingerprint) || "";
    if (!id) {
      const media = await uploadGoToSocialMedia(instance, token, image);
      id = media?.id || "";
    }

    if (id) {
      pendingMedia.push({ id, fingerprint });
      options.onPendingMedia?.([...pendingMedia]);
    }
    if (pendingMedia.length >= 4) break;
  }

  const mediaIds = pendingMedia.map((entry) => entry.id);

  const response = await fetchWithTimeout(fetch, `${instance}/api/v1/statuses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": createIdempotencyKey(post.url)
    },
    body: JSON.stringify({
      status,
      content_type: "text/markdown",
      media_ids: mediaIds,
      visibility: "public"
    }),
    timeoutMs: Number(config.social?.timeoutMs ?? 30000)
  });

  if (!response.ok) {
    throw new HttpResponseError(
      response.status,
      `GoToSocial status API returned ${response.status}: ${await responseText(response)}`
    );
  }

  const data = await response.json();
  console.log(`Posted to GoToSocial: ${data.url || data.uri || post.url}`);

  return {
    url: data.url || data.uri || "",
    postedAt: new Date().toISOString()
  };
}

function createIdempotencyKey(postUrl) {
  const digest = crypto.createHash("sha256").update(String(postUrl)).digest("hex");
  return `example-blog:${digest}`;
}

function createMediaFingerprint(image) {
  const hash = crypto.createHash("sha256").update(`${image.path}:`);
  if (fs.existsSync(image.path)) {
    hash.update(fs.readFileSync(image.path));
  } else {
    // Unit tests and callers that only provide metadata still get a stable key;
    // production images always exist and are fingerprinted by their bytes.
    hash.update(String(image.size));
  }
  return hash.digest("hex");
}

async function uploadGoToSocialMedia(instance, token, image) {
  const form = new FormData();
  const buffer = fs.readFileSync(image.path);
  form.append("file", new Blob([buffer], { type: image.mimeType }), image.name);
  if (image.alt) form.append("description", image.alt.slice(0, 1500));

  const response = await fetchWithTimeout(fetch, `${instance}/api/v1/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form,
    timeoutMs: 60000
  });

  if (!response.ok) {
    throw new HttpResponseError(
      response.status,
      `GoToSocial media API returned ${response.status}: ${await responseText(response)}`
    );
  }

  return response.json();
}

module.exports = {
  createIdempotencyKey,
  createMediaFingerprint,
  main,
  postToGoToSocial,
  requireLiveCandidates,
  uploadGoToSocialMedia
};
