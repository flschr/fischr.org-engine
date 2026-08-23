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

import { freigabeGiltNoch } from "./publish-stand.js";

const API = "https://api.github.com";

// Wie lange auf den Bau gewartet wird.
//
// Gemessen an den letzten zwölf Veröffentlichungen: 43 bis 736 Sekunden, im Mittel rund drei
// Minuten. Zehn Minuten wären knapp genug gewesen, um die beiden langen fälschlich als
// Zeitüberschreitung zu melden — und eine gemeldete Zeitüberschreitung, die keine ist, schickt
// jemanden auf die Suche nach einem Fehler, den es nicht gibt.
//
// Dreissig Minuten sind grosszügig und trotzdem begrenzt: Was so lange läuft, hängt wirklich,
// und die Instanz darf nicht für immer offen bleiben.
const RUNDEN = 180;
const PAUSE = "10 seconds";

// Noch offen: Zwei gleichzeitig gestartete Instanzen halten sich gegenseitig nicht auf. Die
// Prüfung oben fängt nur den Fall ab, dass main zwischenzeitlich weitergewandert ist — starten
// zwei Veröffentlichungen im selben Moment, sehen beide denselben Stand und stossen beide an.
// Heute fängt das die gemeinsame concurrency-Gruppe in Actions auf, die Läufe reihen sich also
// hintereinander. Ein echtes Schloss (eine Zeile in D1 oder ein Durable Object) gehört in die
// Stufe, die den Admin auf diesen Weg umzieht — vorher hat es nichts zu bewachen.
export async function fuehrePublishAus(event, step, { fetch: holen = fetch, buch = null, jetzt = () => Math.floor(Date.now() / 1000) } = {}) {
  const { repository, requestId, mainSha, draftSha, changeCount, token } = event.payload;
  const github = (pfad, optionen) => anfrage(pfad, token, optionen, holen);

  // Jeder Ausgang wird ins Buch geschrieben, bevor er zurückgegeben wird — auch der frühe.
  // Sonst hielte die Zeile das Schloss weiter, obwohl längst nichts mehr läuft, und die nächste
  // Veröffentlichung wäre bis zum Verfall blockiert.
  //
  // Ein Buch, das nicht schreiben kann, darf die Veröffentlichung nicht mitreissen: Sie ist
  // dann bereits durch, und das Schloss verfällt von selbst.
  const schliesseAb = async (ergebnis) => {
    await buch?.schliesseAb(requestId, ergebnis.status, ergebnis.grund || null, jetzt()).catch(() => {});
    return ergebnis;
  };

  // Zuerst der Stand: Hat sich auf main etwas bewegt, das jemand geprüft hat, gilt die Freigabe
  // nicht mehr. Ohne diese Prüfung veröffentlichte ein verzögerter Anlauf etwas anderes als das,
  // was freigegeben wurde.
  //
  // Eine andere SHA allein reicht dafür nicht: Der R2-Manifest-Fold landet nach fast jeder
  // Veröffentlichung auf main und berührt nichts aus der Queue. Die Regel dafür steht in
  // publish-stand.js und ist dieselbe, nach der scripts/admin-publish.js später entscheidet.
  const kopf = await step.do("stand prüfen", async () => {
    const jetzt = await github(`repos/${repository}/git/ref/heads/main`);
    const aktuell = jetzt.object.sha;
    const urteil = await freigabeGiltNoch({ repository, erwartet: mainSha, aktuell, github });
    return { main: aktuell, gilt: urteil.gilt, grund: urteil.grund };
  });

  if (!kopf.gilt) {
    // Kein Fehler, ein Befund. Der Admin bekommt ihn als Zustand zurück und kann neu prüfen.
    return schliesseAb({ status: "veraltet", erwartet: mainSha, gefunden: kopf.main, grund: kopf.grund });
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

  // Ab hier kennt das Buch den Lauf. Der Admin liest ihn dort und fragt ihn direkt ab, statt
  // dreissig Läufe zu listen und deren Titel mit einer selbst gebauten Zeichenkette zu
  // vergleichen — dieselbe Zuordnung, nur einmal statt in jeder Abfrage neu.
  //
  // Scheitert das dauerhaft, läuft die Veröffentlichung trotzdem weiter: Der Bau hängt nicht am
  // Buch. Der Admin sieht dann bis zum Schluss "vorgemerkt" und erfährt den Ausgang am Ende von
  // der Instanz selbst — weniger Auskunft, aber kein falscher Fehler.
  await step.do("lauf festhalten", { retries: { limit: 3, delay: "2 seconds" } }, async () => {
    await buch?.haltLaufFest(requestId, lauf.id, lauf.url);
    return { festgehalten: true };
  }).catch(() => ({ festgehalten: false }));

  // Gewartet wird in einzelnen Schritten statt in einer Schleife: Jede Runde ist ein eigenes
  // step.do, also übersteht das Warten einen Neustart der Ausführung.
  for (let runde = 0; runde < RUNDEN; runde += 1) {
    const ergebnis = await step.do(`lauf abwarten ${runde}`, async () => {
      const zustand = await github(`repos/${repository}/actions/runs/${lauf.id}`);
      return zustand.status === "completed" ? { conclusion: zustand.conclusion } : null;
    });

    if (ergebnis) {
      const geschafft = ergebnis.conclusion === "success";
      return schliesseAb({
        status: geschafft ? "fertig" : "gescheitert",
        grund: geschafft ? null : `Der Bau endete mit ${ergebnis.conclusion || "einem Fehler"}.`,
        lauf
      });
    }

    await step.sleep(`pause ${runde}`, PAUSE);
  }

  return schliesseAb({
    status: "zeitueberschreitung",
    grund: "Der Bau war nach dreissig Minuten nicht abgeschlossen.",
    lauf
  });
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
