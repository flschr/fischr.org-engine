// Was nach einer Teil-Veröffentlichung auf `drafts` übrig bleibt.
//
// Gegen echtes Git, nicht gegen gelesenen Quelltext. Der Fehler, den dieser Test festhält, war
// durch Lesen nicht zu sehen und durch Nachdenken falsch beantwortet: Der neue drafts-Stand
// entsteht aus dem veröffentlichten Commit plus dem, was *nach* der Freigabe gespeichert wurde.
// Eine abgewählte Änderung war *vor* der Freigabe da — sie steht in keinem von beiden und fiel
// damit auf den Stand von `main` zurück.
//
// Aus „zurückhalten" wurde so „verwerfen", und zwar still: Der Artikel war noch da, nur wieder
// in der veröffentlichten Fassung, und die eigene halbfertige Arbeit weg.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const wurzelDesRepos = path.join(__dirname, "..");

function git(verzeichnis, ...args) {
  return execFileSync("git", args, { cwd: verzeichnis, encoding: "utf8" }).trim();
}

function schreibe(verzeichnis, datei, inhalt) {
  fs.mkdirSync(path.dirname(path.join(verzeichnis, datei)), { recursive: true });
  fs.writeFileSync(path.join(verzeichnis, datei), `${inhalt}\n`);
}

// main hat A und B; drafts hat beide bearbeitet; veröffentlicht wird nur A.
function aufbau({ spaetereBearbeitung = null } = {}) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-"));
  git(wurzel, "init", "-q", ".");
  git(wurzel, "config", "user.email", "test@example.com");
  git(wurzel, "config", "user.name", "Test");

  schreibe(wurzel, "blog/posts/a.md", "A veröffentlicht");
  schreibe(wurzel, "blog/posts/b.md", "B veröffentlicht");
  git(wurzel, "add", "-A");
  git(wurzel, "commit", "-qm", "main");
  git(wurzel, "branch", "-M", "main");
  const mainSha = git(wurzel, "rev-parse", "HEAD");

  git(wurzel, "checkout", "-qb", "drafts");
  schreibe(wurzel, "blog/posts/a.md", "A fertig");
  schreibe(wurzel, "blog/posts/b.md", "B halbfertig");
  git(wurzel, "add", "-A");
  git(wurzel, "commit", "-qm", "drafts");
  const geprueft = git(wurzel, "rev-parse", "HEAD");

  let draftsKopf = geprueft;
  if (spaetereBearbeitung) {
    schreibe(wurzel, spaetereBearbeitung.datei, spaetereBearbeitung.inhalt);
    git(wurzel, "add", "-A");
    git(wurzel, "commit", "-qm", "nach der Freigabe gespeichert");
    draftsKopf = git(wurzel, "rev-parse", "HEAD");
  }

  // Der Bau nimmt nur A mit.
  git(wurzel, "checkout", "-q", "main");
  git(wurzel, "checkout", "-q", geprueft, "--", "blog/posts/a.md");
  git(wurzel, "commit", "-qm", "Publish 1 change");
  const veroeffentlicht = git(wurzel, "rev-parse", "HEAD");

  git(wurzel, "update-ref", "refs/remotes/origin/drafts", draftsKopf);
  return { wurzel, mainSha, geprueft, veroeffentlicht };
}

// In einem eigenen Prozess, mit dem Aufbau als Arbeitsverzeichnis — genau so läuft es in CI.
//
// Ein `process.chdir()` im Test reicht nicht: scripts/lib/publish-git.js merkt sich
// `process.cwd()` beim Laden des Moduls. Wer danach wechselt, lässt jedes git-Kommando weiter
// im alten Verzeichnis laufen, und der Test misst dann ein anderes Repository als das, das er
// aufgebaut hat.
function reconcile({ wurzel, mainSha, geprueft, veroeffentlicht }, auswahl) {
  const skript = `
    const { reconcileDrafts } = require(${JSON.stringify(path.join(wurzelDesRepos, "scripts/lib/reconcile-drafts.js"))});
    try {
      reconcileDrafts({
        finalCommit: ${JSON.stringify(veroeffentlicht)},
        expectedMainSha: ${JSON.stringify(mainSha)},
        expectedDraftSha: ${JSON.stringify(geprueft)},
        publishBranch: "main",
        draftsBranch: "drafts",
        managedPaths: ["blog/posts"],
        auswahl: ${auswahl ? `new Set(${JSON.stringify([...auswahl])})` : "null"},
        attempts: 1,
        fetchRefs: () => {}
      });
    } catch {
      // Ohne echtes Remote scheitert der Push. Geprüft wird der Baum, den er schieben wollte —
      // er liegt danach im Arbeitsbaum.
    }
  `;
  execFileSync(process.execPath, ["-e", skript], { cwd: wurzel, encoding: "utf8", stdio: "pipe" });
  return (datei) => fs.readFileSync(path.join(wurzel, datei), "utf8").trim();
}

test("ein zurückgehaltener Artikel behält seine unfertige Fassung", () => {
  const welt = aufbau();
  const lies = reconcile(welt, new Set(["blog/posts/a.md"]));

  assert.equal(lies("blog/posts/a.md"), "A fertig", "das Gesendete steht auf dem veröffentlichten Stand");
  assert.equal(lies("blog/posts/b.md"), "B halbfertig", "das Zurückgehaltene bleibt, wie es war");
});

// Die Reihenfolge entscheidet: Wurde ein zurückgehaltener Artikel seit der Freigabe weiter
// bearbeitet, muss die neuere Fassung gewinnen — nicht die geprüfte, die wiederhergestellt wird.
test("eine Bearbeitung nach der Freigabe gewinnt gegen die wiederhergestellte Fassung", () => {
  const welt = aufbau({ spaetereBearbeitung: { datei: "blog/posts/b.md", inhalt: "B noch weiter" } });
  const lies = reconcile(welt, new Set(["blog/posts/a.md"]));

  assert.equal(lies("blog/posts/b.md"), "B noch weiter");
});

// Ohne Auswahl bleibt alles wie vor der Auswahl-Funktion: Das ist der Weg, den jede
// Veröffentlichung ohne Abwahl nimmt.
test("ohne Auswahl verhält sich der Abgleich unverändert", () => {
  const welt = aufbau();
  const lies = reconcile(welt, null);

  assert.equal(lies("blog/posts/a.md"), "A fertig");
  // b.md wurde nicht veröffentlicht und auch nicht zurückgehalten — ohne Auswahl gibt es kein
  // Zurückhalten, also folgt drafts dem veröffentlichten Stand. Genau dieses Verhalten war der
  // Fehler, sobald jemand *bewusst* abwählt.
  assert.equal(lies("blog/posts/b.md"), "B veröffentlicht");
});
