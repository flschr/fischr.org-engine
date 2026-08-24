function useAdminRouteDefaults(test) {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/admin/auth/session", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false })
    }));
    await page.route("https://api.github.com/**", (route) => route.abort());
    await page.route("https://raw.githubusercontent.com/**", (route) => route.abort());
  });
}

function mockAuthenticatedGithub(page, requests = [], initialTree = [], options = {}) {
  let draftsHead = "head-sha";
  let draftTree = initialTree;
  const mainTree = options.mainTree || [];
  const mainHead = "main-head-sha";
  const mainTreeSha = "main-tree-sha";
  const blobs = options.blobs || {};
  let createdBlobCount = 0;
  let remainingBlobFailures = Number(options.rejectBlobUploads || 0);
  let remainingCleanupTreeFailures = Number(options.rejectCleanupTrees || 0);
  let remainingPostCleanupMainFailures = Number(options.rejectMainRefreshAfterCleanup || 0);
  let lastTreeWasCleanup = false;
  let cleanupCommitted = false;
  let mediaWorkflowFailed = false;
  let postFailureDraftRefReads = 0;
  let cleanupTreeReadFailures = 0;
  let remainingDraftRefreshFailures = 0;
  const workflowRuns = new Map();
  const workflowInputs = new Map();
  // Beim Start läuft nichts — sonst nähme jeder Test eine Veröffentlichung wieder auf, die es
  // nie gab. `options.laufendeVeroeffentlichung` sät eine, für Tests, die den Admin laden,
  // während anderswo schon veröffentlicht wird.
  let laufendeVeroeffentlichung = options.laufendeVeroeffentlichung || null;
  options.onReady?.({
    replaceTree(nextTree) { draftTree = nextTree; },
    replaceDraftsHead(nextHead) { draftsHead = nextHead; },
    failDraftRefresh(count = 1) { remainingDraftRefreshFailures = count; }
  });
  return Promise.all([
    page.route("**/api/admin/auth/session", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: true, authorized: true, configured: true, login: "smoke-test" })
    })),
    page.route("**/api/admin/snapshot", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        drafts: { headSha: draftsHead, tree: { sha: "tree-sha", tree: draftTree } },
        main: { headSha: mainHead, tree: { sha: mainTreeSha, tree: mainTree } },
        blobs
      })
    })),
    // Der Admin stösst den Bau nicht mehr selbst an, sondern startet eine Workflow-Instanz über
    // den eigenen Endpunkt. Was der Workflow danach tut — den Bau in Actions dispatchen —,
    // bildet dieser Stub gleich mit ab, damit der Rest des Ablaufs (Fortschritt, Erfolg) über
    // dieselbe Actions-Abfrage läuft wie im Betrieb.
    page.route("**/api/admin/publish", (route) => {
      // Dieselbe Adresse trägt zwei Fragen: GET fragt, was gerade läuft (die Wiederaufnahme nach
      // einem Neuladen), POST beginnt eine Veröffentlichung.
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ laufend: laufendeVeroeffentlichung })
        });
      }
      const body = route.request().postDataJSON?.() || {};
      requests.push({ url: route.request().url(), method: route.request().method(), body });
      workflowRuns.set("admin-publish.yml", `Publish ${body.requestId}`);
      laufendeVeroeffentlichung = {
        requestId: body.requestId,
        workflowId: "workflow-instance-1",
        runId: null,
        changeCount: body.changeCount,
        startedAt: "2026-08-24T00:00:00Z"
      };
      workflowInputs.set("admin-publish.yml", {
        request_id: body.requestId,
        main_sha: body.mainSha,
        draft_sha: body.draftSha,
        change_count: String(body.changeCount)
      });
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ id: "workflow-instance-1", status: "gestartet" })
      });
    }),
    page.route("**/api/admin/publish/*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "workflow-instance-1", status: "running", output: null, error: null })
    })),
    page.route("**/api/github/**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      // Erst die echte Positivliste, dann die Antwort. Ein Mock, der mehr durchlässt als der
      // Proxy, verbirgt genau die Fehler, für die es ihn gibt — hier hat er einen Endpunkt
      // beantwortet, den der Betrieb mit 403 ablehnte, und alle Tests blieben grün.
      const { isAllowedEndpoint } = await import("../../functions/api/github/[[path]].js");
      // Genau wie der Proxy: nur der Pfad, ohne Abfrageparameter. Er reicht die Parameter
      // separat weiter (`upstreamUrl.search`), prüft sie aber nicht — ein Mock, der sie
      // mitprüfte, wäre strenger als der Betrieb und meldete Fehler, die es nicht gibt.
      const endpunkt = new URL(url).pathname.replace(/^\/api\/github\/?/, "");
      if (!isAllowedEndpoint(endpunkt)) {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ message: "GitHub endpoint is not allowed." })
        });
      }

      const requestBody = route.request().postDataJSON?.() || {};
      requests.push({ url, method, body: requestBody });
      let response = {};
      if (url.includes("/actions/workflows/") && url.includes("/dispatches") && method === "POST") {
        const titlePrefix = url.includes("admin-prepare-video.yml") ? "Prepare video" : "Normalize";
        const title = `${titlePrefix} ${requestBody.inputs.request_id}`;
        const workflow = url.match(/actions\/workflows\/([^/]+)/)?.[1];
        workflowRuns.set(workflow, title);
        workflowInputs.set(workflow, requestBody.inputs);
      } else if (url.includes("/actions/workflows/") && url.includes("/runs?")) {
        const workflow = url.match(/actions\/workflows\/([^/]+)/)?.[1];
        response = options.onWorkflowPoll?.({
          workflow,
          inputs: workflowInputs.get(workflow) || {},
          tree: draftTree.slice(),
          blobs,
          replaceTree(nextTree) { draftTree = nextTree; }
        }) || {
          workflow_runs: workflowRuns.has(workflow)
            ? [{ display_title: workflowRuns.get(workflow), status: "completed", conclusion: "success" }]
            : []
        };
        if (response.workflow_runs?.some((run) => run.conclusion === "failure")) mediaWorkflowFailed = true;
      } else if (/\/actions\/runs\/\d+\/jobs/.test(url)) {
        response = options.onRunJobs?.({ url }) || { jobs: [] };
      } else if (/\/actions\/runs\/\d+$/.test(url.split("?")[0])) {
        // Seit dem Buch der Veröffentlichungen holt der Admin den Lauf über seine Nummer, statt
        // ihn in einer Liste über den Titel zu suchen.
        const id = Number(url.split("/actions/runs/")[1].split("?")[0]);
        response = options.onRun?.({ id }) || { id, status: "in_progress", html_url: `https://github.com/example/example-blog/actions/runs/${id}` };
      } else if (url.includes("/git/blobs/") && method === "GET") {
        const sha = decodeURIComponent(url.split("/git/blobs/")[1].split("?")[0]);
        response = blobs[sha] || {};
      } else if (url.includes("/contents/") && method === "GET") {
        const encodedPath = url.split("/contents/")[1].split("?")[0];
        const path = encodedPath.split("/").map(decodeURIComponent).join("/");
        const entry = draftTree.find((item) => item.path === path);
        response = { sha: entry?.sha || "", ...(blobs[entry?.sha] || {}) };
      } else if (url.endsWith("/git/blobs") && method === "POST" && remainingBlobFailures > 0) {
        remainingBlobFailures -= 1;
        return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ message: "rejected upload" }) });
      } else if (url.includes("/git/ref/heads/") || url.includes("/git/refs/heads/")) {
        const isDrafts = url.includes("drafts");
        if (isDrafts && method === "GET" && remainingDraftRefreshFailures > 0) {
          remainingDraftRefreshFailures -= 1;
          return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "refresh rejected" }) });
        }
        if (!isDrafts && method === "GET" && cleanupCommitted && remainingPostCleanupMainFailures > 0) {
          remainingPostCleanupMainFailures -= 1;
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary refresh failure" }) });
        }
        if (method === "GET" && isDrafts && mediaWorkflowFailed && options.rejectCleanupReconcileRead) {
          postFailureDraftRefReads += 1;
          if (postFailureDraftRefReads === 2) draftsHead = "concurrent-cleanup-parent";
        }
        if (method === "PATCH" && isDrafts) {
          draftsHead = requestBody.sha;
          if (lastTreeWasCleanup) cleanupCommitted = true;
        }
        response = { object: { sha: isDrafts ? draftsHead : mainHead } };
      } else if (url.endsWith("/git/blobs") && method === "POST") {
        createdBlobCount += 1;
        const sha = `blob-sha-${createdBlobCount}`;
        blobs[sha] = { content: requestBody.content || "", encoding: requestBody.encoding || "utf-8" };
        response = { sha };
      } else if (url.endsWith("/git/trees") && method === "POST") {
        if (remainingCleanupTreeFailures > 0 && requestBody.tree?.some((entry) => entry.sha === null)) {
          remainingCleanupTreeFailures -= 1;
          return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ message: "tree changed" }) });
        }
        lastTreeWasCleanup = Boolean(requestBody.tree?.some((entry) => entry.sha === null));
        const nextTree = new Map(draftTree.map((entry) => [entry.path, entry]));
        (requestBody.tree || []).forEach((entry) => {
          if (entry.sha == null) nextTree.delete(entry.path);
          else nextTree.set(entry.path, { ...nextTree.get(entry.path), ...entry });
        });
        draftTree = Array.from(nextTree.values());
        response = { sha: "new-tree-sha", tree: draftTree };
      } else if (url.includes("/git/trees/")) {
        if (cleanupCommitted && options.rejectCleanupReconcileRead && cleanupTreeReadFailures < 2 && url.includes("new-tree-sha")) {
          cleanupTreeReadFailures += 1;
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary tree read failure" }) });
        }
        response = url.includes(mainTreeSha)
          ? { sha: mainTreeSha, tree: mainTree }
          : { sha: url.includes("new-tree-sha") ? "new-tree-sha" : "tree-sha", tree: draftTree };
      }
      else if (url.endsWith("/git/commits") && method === "POST") response = { sha: "new-commit-sha", tree: { sha: "new-tree-sha" }, parents: [{ sha: "head-sha" }] };
      else if (url.includes("/git/commits/")) response = url.includes("new-commit-sha")
        ? { sha: "new-commit-sha", tree: { sha: "new-tree-sha" }, parents: [{ sha: "head-sha" }] }
        : url.includes(mainHead)
          ? { sha: mainHead, tree: { sha: mainTreeSha }, parents: [] }
          : { sha: "head-sha", tree: { sha: "tree-sha" }, parents: [] };
      return route.fulfill({ status: method === "POST" && url.includes("/dispatches") ? 204 : 200, contentType: "application/json", body: JSON.stringify(response) });
    })
  ]);
}

module.exports = { mockAuthenticatedGithub, useAdminRouteDefaults };
