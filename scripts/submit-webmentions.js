#!/usr/bin/env node

const path = require("path");
const {
  root,
  loadConfig,
  readJson,
  writeJson,
  listPublishedPosts,
  keepLive,
  positiveInteger
} = require("./lib/publish-utils");
const { HttpResponseError, isPermanentClientError } = require("./lib/http-utils");
const protocol = require("./lib/webmention-protocol");
const {
  discoverWebmentionEndpoint,
  extractTargetUrls,
  getPublishedMf2Targets,
  readPostMarkdown,
  sendWebmention
} = protocol;

const stateFile = path.join(root, "automation/webmention-submissions.json");

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

async function main() {
  const config = loadConfig();
  const webmentions = config.webmentions || {};

  if (webmentions.enabled === false) {
    console.log("Skipping Webmentions; disabled in automation config.");
    return;
  }

  const state = readJson(stateFile, {});
  const posts = listPublishedPosts(config);
  const siteUrl = config.siteUrl || "https://mysite.example";
  const maxPosts = positiveInteger(
    process.env.WEBMENTION_MAX_POSTS_PER_RUN ?? webmentions.maxPostsPerRun,
    5,
    "WEBMENTION_MAX_POSTS_PER_RUN"
  );
  const maxTargets = positiveInteger(
    process.env.WEBMENTION_MAX_TARGETS_PER_POST ?? webmentions.maxTargetsPerPost,
    20,
    "WEBMENTION_MAX_TARGETS_PER_POST"
  );
  const candidates = [];

  for (const post of posts) {
    const targets = extractTargetUrls(readPostMarkdown(post.file), {
      siteUrl,
      excludeHosts: webmentions.excludeHosts || []
    });
    const pendingTargets = targets.filter((target) => !state[post.url]?.[target]).slice(0, maxTargets);

    if (pendingTargets.length === 0) continue;

    candidates.push({ post, targets: pendingTargets });
  }

  if (candidates.length === 0) {
    console.log("No published posts waiting for Webmentions.");
    return;
  }

  // The receiving site fetches the source (post.url) to verify the mention, so
  // skip any post that isn't live yet — a just-due scheduled post may not be
  // deployed yet. A later publish or manual run retries it. Filter by liveness before the
  // per-run cap so an unreachable post can't starve a healthy one.
  const liveCandidates = (
    await keepLive(candidates, (candidate) => candidate.post.url, {
      getDate: (candidate) => candidate.post.date
    })
  ).slice(0, maxPosts);
  if (liveCandidates.length === 0) {
    console.log("No live posts ready for Webmentions yet.");
    return;
  }

  let hasFailures = false;

  for (const candidate of liveCandidates) {
    const { post, targets } = candidate;
    state[post.url] ||= {};
    console.log(`Processing Webmentions for: ${post.title}`);

    let publishedTargets;
    try {
      publishedTargets = await getPublishedMf2Targets(post.url, webmentions);
    } catch (error) {
      hasFailures = true;
      console.error(`Could not inspect published Webmention links for ${post.url}: ${error.message}`);
      if (Object.keys(state[post.url]).length === 0) delete state[post.url];
      writeJson(stateFile, state);
      continue;
    }

    for (const target of targets) {
      if (!publishedTargets.has(target)) {
        console.log(`Waiting for deployed mf2 link: ${post.url} -> ${target}`);
        continue;
      }

      try {
        const result = await processWebmentionTarget(post.url, target, webmentions);
        state[post.url][target] = result;

        if (result.status === "no-endpoint") {
          console.log(`No Webmention endpoint found: ${target}`);
          continue;
        }

        if (result.status === "rejected") {
          console.log(`Webmention permanently rejected for ${post.url} -> ${target}: HTTP ${result.httpStatus}`);
          continue;
        }

        console.log(`Submitted Webmention: ${post.url} -> ${target}`);
      } catch (error) {

        hasFailures = true;
        console.error(`Webmention failed for ${post.url} -> ${target}: ${error.message}`);
      }
    }

    if (Object.keys(state[post.url]).length === 0) delete state[post.url];
    writeJson(stateFile, state);
  }

  writeJson(stateFile, state);

  if (hasFailures) process.exitCode = 1;
}

async function processWebmentionTarget(source, target, options = {}, dependencies = {}) {
  const discover = dependencies.discover || discoverWebmentionEndpoint;
  const submit = dependencies.submit || sendWebmention;
  const now = dependencies.now || (() => new Date());
  let endpoint = "";

  try {
    endpoint = await discover(target, options);
    if (!endpoint) {
      return {
        status: "no-endpoint",
        checkedAt: now().toISOString()
      };
    }

    const result = await submit(endpoint, source, target, options);
    return {
      status: "submitted",
      endpoint,
      httpStatus: result.status,
      submittedAt: now().toISOString()
    };
  } catch (error) {
    if (!isPermanentClientError(error)) throw error;
    return {
      status: "rejected",
      endpoint,
      httpStatus: error.status,
      rejectedAt: now().toISOString()
    };
  }
}

module.exports = {
  main,
  processWebmentionTarget,
  ...protocol,
  WebmentionHttpError: HttpResponseError
};
