#!/usr/bin/env node
// Cloudflare-native build path, post-build step. Runs everything build.yml's later steps do
// once `npm run build` and `wrangler pages deploy` (Cloudflare's own, automatic) have produced
// and shipped _site — except the deploy itself, which Cloudflare's platform already handled
// before this script even runs. See docs/automations.md#ci-build--deploy-buildyml for what the
// GitHub Actions original does; this mirrors it using a minted GitHub App token instead of the
// GITHUB_TOKEN Actions provides automatically, because Cloudflare's build environment has no
// such automatic credential.
//
// Skips itself entirely when the App is not configured yet, so this is safe to wire into the
// build command before the App exists — it degrades to "just build", same as running locally.
//
// This is a spike script (scripts/cf-*.js) — it exists to prove the Cloudflare-native path
// end-to-end, not yet to replace build.yml. It has not run against real GitHub App credentials.

const { execFileSync } = require("child_process");
const { mintInstallationTokenFromEnv, withAuthenticatedRemote } = require("./lib/github-app-token");
const { classifyDeploy, describeDeploy } = require("./lib/deploy-freshness");

const root = process.cwd();

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", ...opts }).trim();
}

function gitSucceeds(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

async function commitAndPushManifest(token) {
  git(["config", "user.name", "cloudflare-pages-build[bot]"]);
  git(["config", "user.email", "cloudflare-pages-build@mysite.example"]);
  git(["add", "-A", "--", "automation/media-manifest.json", "automation/media-uploads"]);

  const staged = git(["diff", "--cached", "--name-only"]);
  if (!staged) {
    console.log("No media manifest changes to commit.");
    return;
  }

  git(["commit", "-m", "Update R2 media manifest [skip ci]"]);

  withAuthenticatedRemote(token, root, () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      if (gitSucceeds(["push", "origin", "HEAD:main"])) {
        console.log(`Pushed media manifest state on attempt ${attempt}.`);
        return;
      }
      console.log(`Push attempt ${attempt} rejected; rebasing on latest main and retrying.`);
      git(["pull", "--rebase", "--autostash", "origin", "main"]);
    }
    throw new Error("Could not persist media manifest state after 5 attempts.");
  });
}

async function dispatchWorkflow(token, workflow) {
  const response = await fetch(`https://api.github.com/repos/example/example-blog/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ ref: "main" })
  });
  if (!response.ok) {
    console.warn(`::warning::Failed to dispatch ${workflow} — the next successful run catches up. (${response.status})`);
    return;
  }
  console.log(`Dispatched ${workflow}.`);
}

function checkDeployFreshness(builtSha) {
  if (!gitSucceeds(["fetch", "--quiet", "origin", "main"])) {
    console.log("::warning:: Could not fetch origin/main to check deploy freshness.");
    return true;
  }
  const remoteSha = git(["rev-parse", "FETCH_HEAD"]);
  const builtIsAncestor = gitSucceeds(["merge-base", "--is-ancestor", builtSha, remoteSha]);
  const changedPaths =
    builtSha === remoteSha ? [] : git(["diff", "--name-only", builtSha, remoteSha]).split("\n").filter(Boolean);

  const result = classifyDeploy({ builtSha, remoteSha, changedPaths, builtIsAncestor });
  console.log(describeDeploy(result, { builtSha, remoteSha }));
  return result.fresh;
}

async function main() {
  const builtSha = process.env.CF_PAGES_COMMIT_SHA;
  if (!builtSha) throw new Error("CF_PAGES_COMMIT_SHA is not set — are we actually running inside a Cloudflare Pages build?");

  // Checked first, and needs no GitHub App token: Cloudflare deploys automatically the moment
  // this build command exits 0, with no separate pre-deploy step left to gate the way
  // build.yml's wrangler step is gated. Failing the build here is therefore the only way to
  // reproduce that guard's actual effect — Cloudflare never promotes a failed build's output,
  // so the previously-deployed commit stays live exactly as it does today. A soft warning
  // after the fact, once Cloudflare had already deployed, would not be the same guarantee.
  const fresh = checkDeployFreshness(builtSha);
  if (!fresh) {
    throw new Error(
      "main moved past the built commit before this build finished — see docs/automations.md#deploy-freshness-step-6. " +
      "Failing the build on purpose so Cloudflare does not deploy stale output; the next push rebuilds the current tip."
    );
  }

  const appConfigured = process.env.GITHUB_APP_ID && process.env.GITHUB_APP_INSTALLATION_ID && process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appConfigured) {
    console.log("GITHUB_APP_* not set — skipping media publish/manifest-commit/align-drafts (build-only mode).");
    return;
  }

  const { token } = await mintInstallationTokenFromEnv();

  run("node", ["scripts/publish-build-media.js"]);
  await commitAndPushManifest(token);
  await dispatchWorkflow(token, "align-drafts.yml");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
