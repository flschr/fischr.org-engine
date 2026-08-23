#!/usr/bin/env node
// Deploy guard for both production deploy paths (build.yml and admin-publish.yml): compares the
// commit this job built against main's current tip and writes `fresh=true|false` to
// $GITHUB_OUTPUT. The workflows gate their `wrangler pages deploy` on it and, when it says
// false, dispatch a fresh build of main instead of shipping output that has been overtaken.
// See scripts/lib/deploy-freshness.js for what the decision is and why it exists.
//
// Never fails the job on its own account. A guard that cannot read git must not be what stops a
// deploy, so an unreadable comparison reports `fresh=true` with a warning — the same behaviour
// the site had before this guard existed. It fails loudly only on being called wrong.

const fs = require("fs");
const { execFileSync } = require("child_process");

const { classifyDeploy, describeDeploy } = require("./lib/deploy-freshness");

const root = process.cwd();

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw new Error(error.stderr?.toString().trim() || error.message);
  }
}

function gitSucceeds(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function emit(fresh, message) {
  const output = process.env.GITHUB_OUTPUT;
  if (output) fs.appendFileSync(output, `fresh=${fresh ? "true" : "false"}\n`);
  console.log(message);
}

function main() {
  const builtSha = readArg("--built", process.env.GITHUB_SHA);
  const branch = readArg("--branch", "main");

  if (!builtSha) {
    throw new Error("check-deploy-freshness needs --built <sha> (or GITHUB_SHA).");
  }

  // The job may have pushed its own automation commit since checkout, so ask the remote rather
  // than trusting the local ref.
  if (!gitSucceeds(["fetch", "--quiet", "origin", branch])) {
    emit(true, `::warning::Could not fetch origin/${branch} to check deploy freshness — deploying as before.`);
    return;
  }

  const remoteSha = git(["rev-parse", "FETCH_HEAD"], { allowFailure: true });
  if (!remoteSha) {
    emit(true, `::warning::Could not resolve origin/${branch} to check deploy freshness — deploying as before.`);
    return;
  }

  if (!gitSucceeds(["cat-file", "-e", `${builtSha}^{commit}`])) {
    emit(true, `::warning::Built commit ${builtSha} is not in this checkout — deploying as before.`);
    return;
  }

  const builtIsAncestor = gitSucceeds(["merge-base", "--is-ancestor", builtSha, remoteSha]);
  const changedPaths =
    builtSha === remoteSha
      ? []
      : (git(["diff", "--name-only", builtSha, remoteSha], { allowFailure: true }) || "")
          .split("\n")
          .filter(Boolean);

  const result = classifyDeploy({ builtSha, remoteSha, changedPaths, builtIsAncestor });
  const message = describeDeploy(result, { builtSha, remoteSha });
  emit(result.fresh, result.fresh ? message : `::notice::${message}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
