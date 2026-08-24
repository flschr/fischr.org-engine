import { autosaveKey, maxGpxUploadBytes, repo } from "./00-konstanten.js";
import { state } from "./01c-state.js";
import { sessionHasGithubAccess, tokenHasGithubAccess } from "./05-github-auth.js";
import { baseName, mediaSort, publicMediaPath } from "./06-paths.js";
import { slugify, todayPrefix, uploadStamp } from "./08-encoding.js";
import { readFileAsDataUrl } from "./26-media.js";
import { formatBytes } from "./26d-media-metadata.js";
import { delay } from "./27a-publish-state.js";

export const github = RWGithubService.createClient({
  repository: repo,
  getAccess: () => ({
    proxy: sessionHasGithubAccess(),
    token: tokenHasGithubAccess() ? state.token : ""
  }),
  wait: delay
});
export const isTransientGitHubError = RWGithubService.isTransientError;

export const draftRepository = window.RWDraftRepository.create({
  github,
  branch: repo.branch,
  publishBranch: repo.publishBranch
});

export const mediaService = window.RWMediaService.create({
  github,
  publishBranch: repo.publishBranch,
  createRequestId: () => window.RWPublishStatus.createRequestId(),
  delay
});

export const collections = {
  posts: {
    label: "Artikel",
    titleKey: "viewTitle.articles",
    dir: "blog/posts",
    publicDir: "",
    // Order by the real post date (frontmatter for local edits, filename
    // prefix otherwise), newest first — the filename prefix alone can lie
    // when a post's date was changed after the file was created.
    sort: (a, b) => (b.sortKey || 0) - (a.sortKey || 0) || b.path.localeCompare(a.path)
  },
  pages: {
    label: "Seite",
    titleKey: "viewTitle.pages",
    dir: "blog/pages",
    publicDir: "",
    sort: (a, b) => a.path.localeCompare(b.path)
  },
  media: {
    label: "Medium",
    titleKey: "viewTitle.media",
    dir: "blog/assets/images",
    videoDir: "blog/assets/videos",
    gpxDir: "blog/assets/files/gpx",
    publicDir: "/assets/images",
    sort: mediaSort
  }
};

export const editorRecovery = RWEditorRecovery.create({ storage: localStorage, key: autosaveKey });
export const mediaManifestPath = "automation/media-manifest.json";
// One small { key, entry } record per upload the next production build has not folded into
// the manifest yet. Mirrors pendingUploadsRelativeDir in lib/media-manifest.js.
export const mediaUploadsDir = "automation/media-uploads";
export const socialConfigPath = "automation/social-config.json";
export const gpxUploadService = window.RWGpxUpload.create({
  Parser: window.DOMParser,
  maxBytes: maxGpxUploadBytes,
  gpxDir: collections.media.gpxDir,
  baseName,
  formatBytes,
  publicMediaPath,
  readFileAsDataUrl,
  slugify,
  todayPrefix,
  uploadStamp
});
