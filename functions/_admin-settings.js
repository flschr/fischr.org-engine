// Liest die Statistik-Einstellungen aus der committeten Konfiguration.
//
// Der Schalter "Statistik an/aus" steht in automation/social-config.json auf
// dem veröffentlichten Branch und wird mit dem GitHub-Token der Sitzung
// gelesen. Er gilt für beide Endpunkte: den alten GoatCounter-Proxy und die
// eigene Auswertung. Wäre die Prüfung nur in einem von beiden, hielte der
// Schalter nur an einer Stelle, was er verspricht.
//
// Gemeinsam statt kopiert, weil der GoatCounter-Proxy nach dem Parallelbetrieb
// verschwindet: Eine Kopie in beiden Dateien würde beim Löschen des einen
// stillschweigend zur einzigen Wahrheit, ohne dass jemand sie geprüft hat.

import { adminRepository, githubHeaders } from "./_admin-auth.js";

const CONFIG_PATH = "automation/social-config.json";

export async function readStatsConfig(env, githubToken) {
  if (!githubToken) return {};
  try {
    const repo = adminRepository(env);
    const branch = env.ADMIN_PUBLISH_BRANCH || "main";
    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${CONFIG_PATH}?ref=${encodeURIComponent(branch)}`,
      { headers: githubHeaders(githubToken) }
    );
    if (!response.ok) return {};
    const payload = await response.json();
    const bytes = Uint8Array.from(atob(String(payload.content || "").replace(/\s/g, "")), (ch) => ch.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes));
    const stats = json && typeof json === "object" ? json.stats : null;
    if (!stats || typeof stats !== "object") return {};
    const rawUrl = typeof stats.url === "string" ? stats.url.trim() : "";
    return {
      enabled: stats.enabled !== false, // default on when the key is absent
      url: isHttpsUrl(rawUrl) ? rawUrl : ""
    };
  } catch {
    // Jede Störung führt zu {}: Das Dashboard fällt dann auf die Vorgaben aus
    // der Umgebung zurück, statt wegen einer unerreichbaren Konfiguration
    // gar nichts mehr zu zeigen.
    return {};
  }
}

export function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
