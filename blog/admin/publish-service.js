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

  // Was gerade läuft, steht im Buch — nicht in der Actions-Liste.
  //
  // Vorher wurden dafür dreissig Läufe geholt, nach einem Titel gefiltert, der mit "Publish "
  // beginnt, und die Kennung wieder aus diesem Titel herausgeschnitten. Das ging nur, solange
  // ein Lauf existierte: Eine Veröffentlichung, die noch keinen hatte, war unauffindbar, und
  // ein Neuladen in diesem Fenster verlor sie.
  async function discoverActiveRequest(holen = globalThis.fetch) {
    try {
      const antwort = await holen("/api/admin/publish", { credentials: "same-origin" });
      if (!antwort.ok) return null;
      const { laufend } = await antwort.json();
      if (!laufend) return null;
      return {
        requestId: laufend.requestId,
        workflowId: laufend.workflowId || "",
        runId: laufend.runId || null,
        changeCount: laufend.changeCount || 0,
        signatures: [],
        startedAt: laufend.startedAt || ""
      };
    } catch {
      return null;
    }
  }

  // Der Lauf wird über seine Nummer geholt, nicht gesucht.
  //
  // Vorher listete jede Abfrage die letzten dreissig Läufe und verglich deren Titel mit
  // `Publish <requestId>`. Diese Zeichenkette entsteht an zwei Orten: in der run-name-Zeile von
  // admin-publish.yml und hier. Nichts hielt die beiden zusammen — wer die YAML-Zeile ändert,
  // lässt jede Veröffentlichung zwölf Minuten in "vorgemerkt" hängen und dann eine
  // Zeitüberschreitung melden, die keine ist. Alle Tests bleiben dabei grün.
  //
  // Der Workflow kennt die Nummer, sobald er den Lauf gefunden hat, und schreibt sie ins Buch.
  // `runId` kommt von dort. Fehlt sie noch, gibt es schlicht noch keinen Lauf — describeRun(null)
  // beantwortet das seit jeher mit "vorgemerkt".
  async function fetchStatus(github, statusModule, request) {
    if (!request.runId) return statusModule.describeRun(null, null, request);
    const run = await github(`actions/runs/${encodeURIComponent(request.runId)}`);
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
