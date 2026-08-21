(function mediaServiceModule(global) {
  "use strict";

  function create({ github, publishBranch, createRequestId, delay }) {
    async function waitForRun(workflow, title, attempts = 180) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        await delay(attempt === 0 ? 1800 : 3000);
        const payload = await github(`actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=50`);
        const run = (payload.workflow_runs || []).find((candidate) => candidate.display_title === title);
        if (!run || run.status !== "completed") continue;
        if (run.conclusion === "success") return run;
        throw new Error(`GitHub-Medienverarbeitung fehlgeschlagen (${run.conclusion || "unbekannt"}).`);
      }
      throw new Error("GitHub media processing did not finish within 9 minutes.");
    }

    async function dispatch(workflow, titlePrefix, draftSha, sourcePath, targetPath = "") {
      const requestId = createRequestId();
      const title = `${titlePrefix} ${requestId}`;
      const inputs = { request_id: requestId, draft_sha: draftSha, source_path: sourcePath };
      if (targetPath) inputs.target_path = targetPath;
      await github(`actions/workflows/${workflow}/dispatches`, {
        method: "POST",
        body: { ref: publishBranch, inputs }
      });
      return waitForRun(workflow, title);
    }

    return {
      normalizeImage: (draftSha, sourcePath, targetPath) => dispatch(
        "admin-normalize-image.yml", "Normalize", draftSha, sourcePath, targetPath
      ),
      prepareVideo: (draftSha, sourcePath) => dispatch(
        "admin-prepare-video.yml", "Prepare video", draftSha, sourcePath
      )
    };
  }

  global.RWMediaService = { create };
})(window);
