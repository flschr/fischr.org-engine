(function mediaServiceModule(global) {
  "use strict";

  // Statuses that mean "this upload is not the endpoint's job" rather than "it failed":
  // 404 the endpoint is not deployed, 503 the R2 binding is missing, 413 the image is over
  // the transform's ceiling. Each falls back to the GitHub workflow, which can still do it.
  // Everything else is a real defect and must surface instead of quietly costing the writer
  // another minute in a workflow run.
  const FALL_BACK_TO_WORKFLOW = new Set([404, 413, 503]);

  function create({ github, publishBranch, createRequestId, delay, fetchImpl }) {
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

    // Returns null when the endpoint declines the job, so the caller can fall back.
    async function normalizeViaEndpoint(draftSha, sourcePath, targetPath) {
      // Resolved per call, not at create() time: the admin bundle is also loaded in contexts
      // that have no global fetch, and merely constructing the service must not throw there.
      const doFetch = fetchImpl || fetch;
      const response = await doFetch("/api/admin/media/normalize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftSha, sourcePath, targetPath })
      });
      if (FALL_BACK_TO_WORKFLOW.has(response.status)) return null;
      if (!response.ok) {
        let message = `Medien-Endpunkt ${response.status}`;
        try {
          const payload = await response.json();
          if (payload?.message) message = payload.message;
        } catch {
          // A non-JSON error body adds nothing over the status code.
        }
        throw new Error(message);
      }
      return { via: "endpoint", ...(await response.json()) };
    }

    return {
      // Seconds in a request instead of a whole GitHub Actions run (measured 34–82 s per
      // image). The workflow stays as the fallback for what the endpoint cannot take.
      async normalizeImage(draftSha, sourcePath, targetPath) {
        const result = await normalizeViaEndpoint(draftSha, sourcePath, targetPath);
        if (result) return result;
        await dispatch("admin-normalize-image.yml", "Normalize", draftSha, sourcePath, targetPath);
        return { via: "workflow" };
      },
      prepareVideo: (draftSha, sourcePath) => dispatch(
        "admin-prepare-video.yml", "Prepare video", draftSha, sourcePath
      )
    };
  }

  global.RWMediaService = { create };
})(window);
