// Liest die Statistik-Einstellungen aus der committeten Konfiguration.
//
// Der Schalter "Statistik an/aus" steht in automation/social-config.json auf
// dem veröffentlichten Branch und wird mit dem GitHub-Token der Sitzung
// gelesen. Er gilt für die Auswertung in /api/admin/analytics.js. Eigene Datei,
// weil die Einstellung aus GitHub zu holen eine andere Aufgabe ist als die
// Zahlen aus D1 zu rechnen — und weil hier der einzige Ort bleiben soll, an dem
// der Schalter ausgelegt wird.

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
    return {
      enabled: stats.enabled !== false // default on when the key is absent
    };
  } catch {
    // Jede Störung führt zu {}: Das Dashboard fällt dann auf die Vorgaben aus
    // der Umgebung zurück, statt wegen einer unerreichbaren Konfiguration
    // gar nichts mehr zu zeigen.
    return {};
  }
}
