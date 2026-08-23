// A production deploy ships the `_site` a job built minutes ago, so it is only the truth for as
// long as the commit it was built from is still what `main` points at.
//
// On 2026-08-23 that stopped being true for 12 minutes. A push build for the previous commit
// spent 4:41 in the validation gate; while it ran, an admin publish committed a post edit and
// deployed it. Thirty seconds later the older build reached its own deploy step and shipped its
// stale `_site` over the published change. Nothing looked wrong afterwards: the older job had
// pulled `main` for its media-manifest commit before calling wrangler, so Cloudflare recorded
// the *publish* commit against a deployment that did not contain it.
//
// This is the decision that has to happen before either workflow deploys, kept free of git and
// Actions so it can be tested: given what this job built and what `main` carries now, is the
// built output still the site?
//
// `automation/` is excluded on purpose. The media manifest and the syndication ledgers are
// written by the very jobs that deploy — a build commits `automation/media-manifest.json` a few
// seconds before its own deploy step — and none of it changes a rendered byte. Everything else
// (posts, pages, templates, styles, functions) means the built output is behind.

const AUTOMATION_PREFIX = "automation/";

function contentChanges(changedPaths = []) {
  return changedPaths.filter((entry) => entry && !entry.startsWith(AUTOMATION_PREFIX));
}

// `builtIsAncestor` answers whether main still contains what was built. It is false only when
// history moved sideways (a force push, a reset). Deploying then would ship a branch main no
// longer has, so it is treated like being overtaken rather than like a fast-forward.
function classifyDeploy({ builtSha, remoteSha, changedPaths = [], builtIsAncestor = true }) {
  if (!builtSha || !remoteSha) {
    throw new Error("classifyDeploy needs both the built commit and main's current tip.");
  }

  if (builtSha === remoteSha) {
    return { fresh: true, reason: "tip", contentPaths: [] };
  }

  if (!builtIsAncestor) {
    return { fresh: false, reason: "diverged", contentPaths: [] };
  }

  const contentPaths = contentChanges(changedPaths);
  if (contentPaths.length === 0) {
    return { fresh: true, reason: "automation-only", contentPaths };
  }

  return { fresh: false, reason: "overtaken", contentPaths };
}

function describeDeploy(result, { builtSha, remoteSha }) {
  const built = String(builtSha).slice(0, 7);
  const remote = String(remoteSha).slice(0, 7);

  switch (result.reason) {
    case "tip":
      return `Built ${built} is still main's tip — deploying.`;
    case "automation-only":
      return `main moved from ${built} to ${remote}, but only under ${AUTOMATION_PREFIX} — deploying.`;
    case "diverged":
      return `Built ${built} is not an ancestor of main (${remote}) — not deploying this output.`;
    case "overtaken":
      return [
        `main moved from ${built} to ${remote} while this job was building, and the difference`,
        `is content this build never rendered — not deploying it over the newer state.`,
        `Changed: ${result.contentPaths.slice(0, 10).join(", ")}${result.contentPaths.length > 10 ? ", …" : ""}`
      ].join(" ");
    default:
      return `Unclassified deploy state for ${built} against ${remote}.`;
  }
}

module.exports = { classifyDeploy, describeDeploy, contentChanges, AUTOMATION_PREFIX };
