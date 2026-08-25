(function publishStatusModule(global) {
  "use strict";

  // Keep this order aligned with the user-visible steps in admin-publish.yml.
  // It provides honest phase progress without pretending that GitHub runtimes
  // are predictable enough for a remaining-time estimate.
  //
  // The second element of each pair is an i18n key, not display text: this
  // module loads as a plain <script> before the admin bundle (see index.html),
  // so it has no access to t() — same reason 20c-publish-affordance.js and
  // 27e-publish-overlay-view.js hand back keys instead of resolved strings.
  // Whoever reads describeRun()'s result (27a-publish-state.js) resolves them.
  const phases = [
    ["Check out repository", "queue.phaseCheckout"],
    ["Set up Node.js", "queue.phaseSetupNode"],
    ["Install dependencies", "queue.phaseInstallDeps"],
    ["Prepare final publish commit", "queue.phasePrepareCommit"],
    ["Check out prepared publish commit", "queue.phaseCheckoutPrepared"],
    ["Validate production site", "queue.phaseValidateSite"],
    ["Push published commit to main", "queue.phasePushMain"],
    ["Publish build media to R2", "queue.phasePublishMediaR2"],
    ["Return to the main branch before persisting automation state", "queue.phaseReturnToMain"],
    ["Commit updated media manifest", "queue.phaseCommitManifest"],
    ["Check the published commit is still main's tip", "queue.phaseCheckTip"],
    ["Prepare the Worker bundle", "queue.phasePrepareWorker"],
    ["Deploy to Cloudflare Workers", "queue.phaseDeployCloudflare"],
    ["Rebuild main instead of deploying stale output", "queue.phaseRebuildStale"],
    ["Sync drafts to deployed commit", "queue.phaseSyncDrafts"],
    ["Pull the manifest fold across to drafts", "queue.phasePullManifest"],
    ["Kick off remaining post-publish workflows", "queue.phasePostPublish"]
  ];
  const phaseMessages = new Map(phases);

  function createRequestId(cryptoObject = global.crypto) {
    if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
    return `publish-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function millisecondsBetween(start, end) {
    const startMs = Date.parse(start || "");
    const endMs = Date.parse(end || "");
    return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null;
  }

  function timingBreakdown(run, jobsPayload, now = Date.now()) {
    const job = jobsPayload?.jobs?.[0];
    const steps = job?.steps || [];
    const step = (name) => steps.find((candidate) => candidate.name === name);
    const validation = step("Validate production site");
    const deployment = step("Deploy to Cloudflare Workers");
    const currentIso = new Date(now).toISOString();
    return {
      waitingMs: millisecondsBetween(run?.created_at, job?.started_at),
      preparationMs: millisecondsBetween(job?.started_at, validation?.started_at),
      validationMs: millisecondsBetween(validation?.started_at, validation?.completed_at || (validation?.status === "in_progress" ? currentIso : "")),
      deploymentMs: millisecondsBetween(deployment?.started_at, deployment?.completed_at || (deployment?.status === "in_progress" ? currentIso : ""))
    };
  }

  function describeRun(run, jobsPayload, request = {}) {
    if (!run) return { state: "queued", messageKey: "queue.waitingForGithub" };
    if (run.status === "queued" || run.status === "waiting" || run.status === "requested") {
      return {
        state: "queued",
        messageKey: "queue.queuedAtGithub",
        runId: run.id,
        url: run.html_url,
        phaseIndex: 0,
        phaseCount: phases.length,
        timings: timingBreakdown(run, jobsPayload)
      };
    }
    if (run.status === "completed") {
      if (run.conclusion === "success") {
        // Says only what this run actually established. Syndication is dispatched, not awaited:
        // GoToSocial owns the social delivery (and its Bluesky crosspost) in its own queue,
        // with its own retries and monitoring, and finishes minutes after this job is done.
        return { state: "success", messageKey: "queue.publishedAndDistributed", runId: run.id, url: run.html_url, timings: timingBreakdown(run, jobsPayload) };
      }
      const failedStep = (jobsPayload?.jobs || [])
        .flatMap((job) => job.steps || [])
        .find((step) => step.conclusion === "failure");
      return {
        state: "failed",
        messageKey: failedStep?.name ? "queue.publishFailedAtStep" : "queue.publishFailedGeneric",
        messageVars: failedStep?.name ? { step: failedStep.name } : undefined,
        runId: run.id,
        url: run.html_url,
        conclusion: run.conclusion || "failure"
      };
    }

    const activeStep = (jobsPayload?.jobs || [])
      .flatMap((job) => job.steps || [])
      .find((step) => step.status === "in_progress");
    const phaseIndex = phases.findIndex(([name]) => name === activeStep?.name);
    return {
      state: "running",
      messageKey: phaseMessages.get(activeStep?.name) || "queue.publishingOnGithub",
      runId: run.id,
      url: run.html_url,
      step: activeStep?.name || "",
      phaseIndex: phaseIndex < 0 ? null : phaseIndex + 1,
      phaseCount: phases.length,
      timings: timingBreakdown(run, jobsPayload),
      slowContent: request.validationMode === "content" && millisecondsBetween(request.startedAt, new Date().toISOString()) > 90000
    };
  }

  global.RWPublishStatus = {
    createRequestId,
    describeRun,
    phaseNames: phases.map(([name]) => name),
    timingBreakdown
  };
})(window);
