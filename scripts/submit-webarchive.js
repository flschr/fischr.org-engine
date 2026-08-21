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
const { fetchWithTimeout, HttpResponseError, isPermanentClientError } = require("./lib/http-utils");

const stateFile = path.join(root, "automation/webarchive-submissions.json");

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const config = loadConfig();
  const webArchive = config.webArchive || {};
  const state = readJson(stateFile, {});
  const posts = listPublishedPosts(config);
  const maxPosts = positiveInteger(
    process.env.WEBARCHIVE_MAX_POSTS_PER_RUN ?? webArchive.maxPostsPerRun,
    5,
    "WEBARCHIVE_MAX_POSTS_PER_RUN"
  );
  const pending = posts.filter((post) => !state[post.url]);

  if (pending.length === 0) {
    console.log("No published posts waiting for web.archive.org.");
    return;
  }

  // Only archive URLs that are already live — a just-due scheduled post may not be
  // deployed yet, and web.archive.org would capture a 404. Filter by liveness
  // before the per-run cap so an unreachable post can't starve healthy ones.
  const livePending = (await keepLive(pending)).slice(0, maxPosts);
  if (livePending.length === 0) {
    console.log("No live posts ready for web.archive.org yet.");
    return;
  }

  for (const post of livePending) {
    try {
      await submitToWebArchive(post.url);
      state[post.url] = {
        submittedAt: new Date().toISOString(),
        archiveSearchUrl: `https://web.archive.org/web/*/${post.url}`
      };
      console.log(`Submitted to web.archive.org: ${post.url}`);
    } catch (error) {
      // Persist permanent client rejections so they do not become repeated failures.
      // Timeouts, network errors, rate limits and server errors remain pending.
      if (isPermanentClientError(error)) {
        state[post.url] = {
          status: "rejected",
          httpStatus: error.status,
          rejectedAt: new Date().toISOString(),
          archiveSearchUrl: `https://web.archive.org/web/*/${post.url}`
        };
        console.warn(`web.archive.org permanently rejected ${post.url}: ${error.message}`);
      } else {
        console.warn(`web.archive.org transient issue for ${post.url} (will retry next run): ${error.message}`);
      }
    }
  }

  writeJson(stateFile, state);
}

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 90000;

async function submitToWebArchive(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await submitOnce(url);
      return;
    } catch (error) {
      lastError = error;
      if (isPermanentClientError(error) || attempt === MAX_ATTEMPTS) throw error;
      const backoffMs = 2000 * attempt;
      console.warn(`web.archive.org attempt ${attempt}/${MAX_ATTEMPTS} for ${url} failed (${error.message}); retrying in ${backoffMs}ms`);
      await delay(backoffMs);
    }
  }

  throw lastError;
}

async function submitOnce(url) {
  const response = await fetchWithTimeout(fetch, `https://web.archive.org/save/${url}`, {
    method: "GET",
    headers: {
      "User-Agent": "example.com static blog archive submitter"
    },
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  if (!response.ok && response.status !== 302) {
    throw new HttpResponseError(response.status, `HTTP ${response.status}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
