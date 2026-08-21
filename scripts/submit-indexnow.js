#!/usr/bin/env node

const fs = require("fs");
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
const { fetchWithTimeout, HttpResponseError, responseText } = require("./lib/http-utils");

const stateFile = path.join(root, "automation/indexnow-submissions.json");

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const config = loadConfig();
  const indexNow = config.indexNow || {};
  const state = readJson(stateFile, {});
  const posts = listPublishedPosts(config);
  const maxPosts = positiveInteger(
    process.env.INDEXNOW_MAX_POSTS_PER_RUN ?? indexNow.maxPostsPerRun,
    20,
    "INDEXNOW_MAX_POSTS_PER_RUN"
  );
  const pending = posts.filter((post) => !state[post.url]);

  if (pending.length === 0) {
    console.log("No published posts waiting for IndexNow.");
    return;
  }

  // Only submit URLs that are already live — a just-due scheduled post may not be
  // deployed yet, and search engines would crawl a 404. Filter by liveness before
  // the per-run cap so an unreachable post can't starve healthy ones.
  const livePending = (await keepLive(pending)).slice(0, maxPosts);
  if (livePending.length === 0) {
    console.log("No live posts ready for IndexNow yet.");
    return;
  }

  const key = getIndexNowKey(indexNow);
  if (!key) {
    console.log("Skipping IndexNow; no key is configured.");
    return;
  }

  const siteUrl = config.siteUrl || "https://example.com";
  const body = {
    host: new URL(siteUrl).host,
    key,
    keyLocation: process.env.INDEXNOW_KEY_LOCATION || indexNow.keyLocation || `${siteUrl.replace(/\/$/, "")}/indexnow-key.txt`,
    urlList: livePending.map((post) => post.url)
  };

  const response = await fetchWithTimeout(fetch, "https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body),
    timeoutMs: Number(indexNow.timeoutMs ?? 15000)
  });

  if (!response.ok && response.status !== 202) {
    throw new HttpResponseError(response.status, `IndexNow returned ${response.status}: ${await responseText(response)}`);
  }

  const submittedAt = new Date().toISOString();
  for (const post of livePending) {
    state[post.url] = { submittedAt };
  }

  writeJson(stateFile, state);
  console.log(`Submitted ${livePending.length} URL(s) to IndexNow.`);
}

function getIndexNowKey(indexNow) {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY;

  const keyFile = path.join(root, indexNow.keyFile || "blog/indexnow-key.txt");
  if (!fs.existsSync(keyFile)) return "";

  return fs.readFileSync(keyFile, "utf8").trim();
}
