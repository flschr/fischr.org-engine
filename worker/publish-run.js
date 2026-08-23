// Die Veröffentlichung als Zustandsmaschine.
//
// Bisher war Veröffentlichen eine Kette aus zwei YAML-Dateien, Commit-Markern und
// Dispatch-Aufrufen. Die Frage "was wird gerade veröffentlicht und wo steht es" hatte keinen
// Ort — sie war verteilt über einen Actions-Lauf, Branch-Positionen und Nachrichtentexte. Brach
// ein Schritt ab, wusste nichts, wie es weitergeht.
//
// Ein Workflow hat diesen Ort. Jeder step.do ist einmalig: Was durch ist, wird bei einem
// Neuanlauf nicht wiederholt, und was danach kommt, setzt darauf auf.
//
// Gebaut wird weiterhin in Actions. Ein Worker hat keinen Checkout, und Eleventy, sharp und
// ffmpeg brauchen einen. Der Workflow ordnet — genau das fehlte.
//
// Ohne Cloudflare-Import, damit der Ablauf in Node prüfbar ist; die Laufzeit-Hülle steht in
// publish-workflow.js.

const API = "https://api.github.com";

// Wie oft und wie lange auf den Bau gewartet wird. 60 Runden à 10 Sekunden sind zehn Minuten —
// ein Publish dauert normalerweise ein bis vier. Wer darüber hinausläuft, hängt.
const RUNDEN = 60;
const PAUSE = "10 seconds";

export async function fuehrePublishAus(event, step, { fetch: holen = fetch } = {}) {
  const { repository, requestId, mainSha, draftSha, changeCount, token } = event.payload;
  const github = (pfad, optionen) => anfrage(pfad, token, optionen, holen);

  // Zuerst der Stand: Ist main weitergewandert, gilt die Freigabe nicht mehr. Ohne diese Prüfung
  // veröffentlichte ein verzögerter Anlauf etwas anderes als das, was jemand geprüft hat.
  const kopf = await step.do("stand prüfen", async () => {
    const jetzt = await github(`repos/${repository}/git/ref/heads/main`);
    return { main: jetzt.object.sha };
  });

  if (kopf.main !== mainSha) {
    // Kein Fehler, ein Befund. Der Admin bekommt ihn als Zustand zurück und kann neu prüfen.
    return { status: "veraltet", erwartet: mainSha, gefunden: kopf.main };
  }

  await step.do("bau anstossen", async () => {
    await github(`repos/${repository}/actions/workflows/admin-publish.yml/dispatches`, {
      method: "POST",
      body: {
        ref: "main",
        inputs: {
          request_id: requestId,
          main_sha: mainSha,
          draft_sha: draftSha,
          change_count: String(changeCount)
        }
      }
    });
    return { angestossen: true };
  });

  // Der Lauf taucht nicht sofort in der Liste auf. Gesucht wird über den Titel, den
  // admin-publish.yml aus der request_id bildet — dieselbe Zuordnung, die der Admin bisher
  // selbst gemacht hat, nur ohne Rateschleife im Browser.
  const lauf = await step.do("lauf finden", { retries: { limit: 10, delay: "3 seconds" } }, async () => {
    const liste = await github(
      `repos/${repository}/actions/workflows/admin-publish.yml/runs?event=workflow_dispatch&per_page=30`
    );
    const treffer = (liste.workflow_runs || []).find((eintrag) => eintrag.display_title === `Publish ${requestId}`);
    if (!treffer) throw new Error(`Lauf für ${requestId} noch nicht sichtbar`);
    return { id: treffer.id, url: treffer.html_url };
  });

  // Gewartet wird in einzelnen Schritten statt in einer Schleife: Jede Runde ist ein eigenes
  // step.do, also übersteht das Warten einen Neustart der Ausführung.
  for (let runde = 0; runde < RUNDEN; runde += 1) {
    const ergebnis = await step.do(`lauf abwarten ${runde}`, async () => {
      const zustand = await github(`repos/${repository}/actions/runs/${lauf.id}`);
      return zustand.status === "completed" ? { conclusion: zustand.conclusion } : null;
    });

    if (ergebnis) {
      return { status: ergebnis.conclusion === "success" ? "fertig" : "gescheitert", lauf };
    }

    await step.sleep(`pause ${runde}`, PAUSE);
  }

  return { status: "zeitueberschreitung", lauf };
}

async function anfrage(pfad, token, { method = "GET", body = null } = {}, holen = fetch) {
  const antwort = await holen(`${API}/${pfad}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "mysite.example publish workflow",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  // 204 ist die übliche Antwort auf einen Dispatch und trägt keinen Körper.
  if (antwort.status === 204) return {};
  if (!antwort.ok) throw new Error(`GitHub ${antwort.status} für ${pfad}`);
  return antwort.json();
}
