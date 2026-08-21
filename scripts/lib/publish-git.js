const { execFileSync } = require("child_process");
const fs = require("fs");

const root = process.cwd();

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: options.stdio ? undefined : "utf8",
      stdio: options.stdio || ["ignore", "pipe", "pipe"]
    })?.toString().trim() || "";
  } catch (error) {
    if (options.allowFailure) return "";
    const stderr = error.stderr?.toString().trim();
    throw new Error(stderr || error.message);
  }
}

function git(args, options = {}) {
  return run("git", args, options);
}

function gitQuiet(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function rev(ref) {
  return git(["rev-parse", ref]);
}

function checkoutBranch(branch, ref) {
  // Builds intentionally generate tracked caches/data. Every transaction phase
  // must start from the requested immutable commit, never from those leftovers.
  git(["checkout", "--force", "-B", branch, ref], { stdio: "inherit" });
}

function diffPaths(fromRef, toRef, paths = []) {
  // Publishing applies every changed path independently. Rename detection would
  // report only the destination with --name-only, leaving the source file in
  // the published tree. Treat renames as their underlying delete + add pair so
  // changing a post date or slug cannot create a duplicate article.
  const args = ["diff", "--no-renames", "--name-only", "-z", fromRef, toRef];
  if (paths.length) args.push("--", ...paths);
  return git(args).split("\0").filter(Boolean);
}

function countChanges(fromRef, toRef, paths = []) {
  return diffPaths(fromRef, toRef, paths).length;
}

function applyPathDelta(fromRef, toRef, managedPaths) {
  for (const changedPath of diffPaths(fromRef, toRef, managedPaths)) {
    if (gitQuiet(["cat-file", "-e", `${toRef}:${changedPath}`])) {
      git(["checkout", toRef, "--", changedPath]);
    } else {
      git(["rm", "-q", "--ignore-unmatch", "--", changedPath]);
    }
  }
  git(["add", "-A", "--", "."]);
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

module.exports = { applyPathDelta, checkoutBranch, countChanges, diffPaths, git, gitQuiet, rev, run, wait, writeOutput };
