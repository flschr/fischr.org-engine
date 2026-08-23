(function publishServiceModule(global) {
  "use strict";

  function storedRequest(storage, key) {
    try {
      const value = JSON.parse(storage.getItem(key) || "null");
      return value?.requestId ? value : null;
    } catch {
      return null;
    }
  }

  function persistRequest(storage, key, request) {
    storage.setItem(key, JSON.stringify(request));
  }

  function clearRequest(storage, key) {
    storage.removeItem(key);
  }

  async function discoverActiveRequest(github, branch) {
    const payload = await github(
      `actions/workflows/admin-publish.yml/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=30`
    );
    const publishRuns = (payload.workflow_runs || []).filter(
      (candidate) => candidate.display_title?.startsWith("Publish ")
    );
    const run = publishRuns.find((candidate) => candidate.status !== "completed");
    if (!run) return null;
    return {
      requestId: run.display_title.slice("Publish ".length),
      changeCount: 0,
      signatures: [],
      startedAt: run.created_at || "",
      discoveredFromGithub: true
    };
  }

  async function fetchStatus(github, statusModule, branch, request) {
    const runs = await github(
      `actions/workflows/admin-publish.yml/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=30`
    );
    const run = statusModule.findRequestRun(runs, request.requestId);
    const jobs = run?.id ? await github(`actions/runs/${run.id}/jobs?per_page=100`) : null;
    return statusModule.describeRun(run, jobs, request);
  }

  // Solange kein Actions-Lauf sichtbar ist, ist der Workflow die einzige Stelle, die etwas
  // weiss. Das ist genau das Fenster, in dem er beschliessen kann, gar nicht erst zu bauen —
  // etwa weil main seit der Freigabe weitergewandert ist. Ohne diese Abfrage sähe das aus wie
  // eine Veröffentlichung, die vorgemerkt ist und nie beginnt, bis nach zwölf Minuten eine
  // Zeitüberschreitung gemeldet wird, die keine ist.
  //
  // Sobald ein Lauf existiert, ist der Lauf die Wahrheit; dann wird hier nicht mehr gefragt.
  async function fetchWorkflowState(id, holen = globalThis.fetch) {
    if (!id) return null;
    try {
      const antwort = await holen(`/api/admin/publish/${encodeURIComponent(id)}`, { credentials: "same-origin" });
      if (!antwort.ok) return null;
      return await antwort.json();
    } catch {
      // Eine Nebenauskunft darf die Statusabfrage nicht mitreissen.
      return null;
    }
  }

  async function poll({ read, delay, shouldContinue, onStatus, onError, attempts = 180 }) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await delay(attempt === 0 ? 2500 : 4000);
      if (!shouldContinue()) return;
      try {
        const status = await read();
        await onStatus(status);
        if (status.state === "success" || status.state === "failed") return;
      } catch (error) {
        if (await onError(error)) return;
      }
    }
    await onStatus({ state: "failed", message: "GitHub hat die Veröffentlichung nicht innerhalb von 12 Minuten abgeschlossen" });
  }

  global.RWPublishService = {
    clearRequest,
    discoverActiveRequest,
    fetchStatus,
    fetchWorkflowState,
    persistRequest,
    poll,
    storedRequest
  };
})(window);
