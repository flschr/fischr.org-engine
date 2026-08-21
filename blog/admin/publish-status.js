(function publishStatusModule(global) {
  "use strict";

  // Keep this order aligned with the user-visible steps in admin-publish.yml.
  // It provides honest phase progress without pretending that GitHub runtimes
  // are predictable enough for a remaining-time estimate.
  const phases = [
    ["Check out repository", "Geprüften Stand vorbereiten"],
    ["Set up Node.js", "Build-Umgebung vorbereiten"],
    ["Install dependencies", "Abhängigkeiten installieren"],
    ["Prepare final publish commit", "Veröffentlichung prüfen"],
    ["Check out prepared publish commit", "Geprüftes Ergebnis fixieren"],
    ["Restore responsive image cache", "Bild-Cache wiederherstellen"],
    ["Validate production site", "Website bauen und prüfen"],
    ["Push published commit to main", "Geprüfte Website übernehmen"],
    ["Deploy to Cloudflare Pages", "Website zu Cloudflare übertragen"],
    ["Sync drafts to deployed commit", "Neuere Entwürfe erhalten und Warteschlange abgleichen"],
    ["Publish pending social posts and wait", "Social-Post veröffentlichen und bestätigen"],
    ["Kick off remaining post-publish workflows", "Weitere Verteilung und Backups starten"]
  ];
  const phaseMessages = new Map(phases);

  function createRequestId(cryptoObject = global.crypto) {
    if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
    return `publish-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function runTitle(requestId) {
    return `Publish ${requestId}`;
  }

  function findRequestRun(payload, requestId) {
    return (payload?.workflow_runs || []).find((run) => run.display_title === runTitle(requestId)) || null;
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
    const deployment = step("Deploy to Cloudflare Pages");
    const currentIso = new Date(now).toISOString();
    return {
      waitingMs: millisecondsBetween(run?.created_at, job?.started_at),
      preparationMs: millisecondsBetween(job?.started_at, validation?.started_at),
      validationMs: millisecondsBetween(validation?.started_at, validation?.completed_at || (validation?.status === "in_progress" ? currentIso : "")),
      deploymentMs: millisecondsBetween(deployment?.started_at, deployment?.completed_at || (deployment?.status === "in_progress" ? currentIso : ""))
    };
  }

  function describeRun(run, jobsPayload, request = {}) {
    if (!run) return { state: "queued", message: "Waiting for GitHub to accept the publish request" };
    if (run.status === "queued" || run.status === "waiting" || run.status === "requested") {
      return {
        state: "queued",
        message: "Veröffentlichung bei GitHub vorgemerkt",
        runId: run.id,
        url: run.html_url,
        phaseIndex: 0,
        phaseCount: phases.length,
        timings: timingBreakdown(run, jobsPayload)
      };
    }
    if (run.status === "completed") {
      if (run.conclusion === "success") {
        return { state: "success", message: "Veröffentlicht, verteilt und synchronisiert", runId: run.id, url: run.html_url, timings: timingBreakdown(run, jobsPayload) };
      }
      const failedStep = (jobsPayload?.jobs || [])
        .flatMap((job) => job.steps || [])
        .find((step) => step.conclusion === "failure");
      const detail = failedStep?.name ? ` bei „${failedStep.name}“` : "";
      return {
        state: "failed",
        message: `Veröffentlichung fehlgeschlagen${detail}`,
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
      message: phaseMessages.get(activeStep?.name) || "Wird auf GitHub veröffentlicht",
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
    findRequestRun,
    phaseNames: phases.map(([name]) => name),
    timingBreakdown,
    runTitle
  };
})(window);
