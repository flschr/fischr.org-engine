import { adminRepository, githubHeaders, jsonResponse, readSession } from "../../_admin-auth.js";
import sourcePages from "../../../blog/admin/source-pages.js";

const DEFAULT_DRAFTS_BRANCH = "drafts";
const DEFAULT_MAIN_BRANCH = "main";
const DEFAULT_BLOB_CONCURRENCY = 4;
const MAX_PREFETCH_BLOBS = 40;
const MAX_PREFETCH_ENCODED_BYTES = 2 * 1024 * 1024;

export async function onRequestGet(context) {
  return handleSnapshotRequest(context);
}

export async function handleSnapshotRequest(context, dependencies = {}) {
  const readSessionFn = dependencies.readSession || readSession;
  const fetchFn = dependencies.fetch || fetch;
  const logger = dependencies.console || console;
  const session = await readSessionFn(context.request, context.env);
  if (!session) return jsonResponse({ message: "Nicht angemeldet." }, { status: 401 });

  const repository = adminRepository(context.env);
  const branches = {
    drafts: context.env.ADMIN_DRAFTS_BRANCH || DEFAULT_DRAFTS_BRANCH,
    main: context.env.ADMIN_PUBLISH_BRANCH || DEFAULT_MAIN_BRANCH
  };
  try {
    const startedAt = Date.now();
    const [drafts, main] = await Promise.all(Object.values(branches).map((branch) =>
      readBranchSnapshot({ repository, branch, token: session.token, fetchFn })
    ));
    const mainBlobs = blobMap(main.tree);
    const changedTextBlobs = drafts.tree.tree.filter((entry) =>
      (/^(?:blog\/posts|blog\/pages)\/.+\.md$/.test(entry.path) || sourcePages.has(entry.path))
      && mainBlobs.get(entry.path) !== entry.sha
    );
    let blobErrors = 0;
    let loadedBytes = 0;
    const prefetchBlobs = changedTextBlobs.slice(0, MAX_PREFETCH_BLOBS);
    const loadedBlobs = await mapWithConcurrency(prefetchBlobs, DEFAULT_BLOB_CONCURRENCY, async (entry) => {
      try {
        const response = await fetchFn(`https://api.github.com/repos/${repository}/git/blobs/${entry.sha}`, {
          headers: githubHeaders(session.token)
        });
        if (!response.ok) throw new Error(`GitHub ${response.status}`);
        const payload = await response.json();
        const content = payload.content || "";
        if (loadedBytes + content.length > MAX_PREFETCH_ENCODED_BYTES) return null;
        loadedBytes += content.length;
        return [entry.sha, { content, encoding: payload.encoding || "base64" }];
      } catch (error) {
        blobErrors += 1;
        logger.warn("[admin-snapshot] Blob omitted", entry.sha, error?.message || error);
        return null;
      }
    });
    const durationMs = Date.now() - startedAt;
    const availableBlobs = loadedBlobs.filter(Boolean);
    const blobs = Object.fromEntries(availableBlobs);
    return jsonResponse({
      drafts,
      main,
      blobs,
      generatedAt: new Date().toISOString(),
      metrics: {
        durationMs,
        changedBlobCount: changedTextBlobs.length,
        loadedBlobCount: availableBlobs.length,
        omittedBlobCount: changedTextBlobs.length - availableBlobs.length,
        blobErrors
      }
    }, { headers: { "Server-Timing": `admin-snapshot;dur=${durationMs}` } });
  } catch (error) {
    logger.error("[admin-snapshot] GitHub request failed", error?.message || error);
    return jsonResponse({ message: "Admin-Daten konnten nicht geladen werden." }, { status: 502 });
  }
}

export async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readBranchSnapshot({ repository, branch, token, fetchFn }) {
  const headers = githubHeaders(token);
  const api = async (endpoint) => {
    const response = await fetchFn(`https://api.github.com/repos/${repository}/${endpoint}`, { headers });
    if (!response.ok) throw new Error(`GitHub ${response.status}`);
    return response.json();
  };
  const ref = await api(`git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref?.object?.sha || "";
  const commit = await api(`git/commits/${headSha}`);
  const tree = await api(`git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error(`GitHub tree for ${branch} is truncated`);
  return {
    branch,
    headSha,
    tree: {
      sha: tree.sha || commit.tree.sha,
      truncated: Boolean(tree.truncated),
      tree: (tree.tree || []).filter(isAdminPath)
    }
  };
}

function blobMap(tree) {
  return new Map((tree?.tree || []).map((entry) => [entry.path, entry.sha]));
}

export function isAdminPath(entry = {}) {
  if (entry.type !== "blob") return false;
  return sourcePages.has(entry.path)
    // media-manifest.json is the media library's index since DB-1129 — without it the gallery
    // has nothing to list and the draft recovery cannot tell a migrated image from a lost one.
    || /^(?:blog\/(?:posts|pages|assets\/images|assets\/videos|assets\/files\/gpx)\/|blog\/_data\/videoMetadata\.json$|automation\/(?:social-config|admin-rename-origins|media-manifest)\.json$)/.test(entry.path || "");
}
