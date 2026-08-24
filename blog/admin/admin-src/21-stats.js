import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { escapeHtml } from "./16a-alt-text-actions.js";
import { statsPanelRahmen, statsZeileSichtbar, statsZeilenTeile } from "./21a-stats-details.js";
import { statsPeriodBounds, statsPeriodKey, statsPeriodLabel } from "./21b-stats-period.js";
import { renderStats } from "./21c-stats-render.js";
import { closeStatsPicker } from "./21f-stats-picker.js";
import { showView } from "./23-routing.js";
import { replaceNav } from "./24-history.js";

// --- Statistik ------------------------------------------------------------
//
// Ein kleines, lesendes Dashboard über die eigenen Zahlen. Der Browser spricht
// ausschließlich mit /api/admin/analytics, das hinter der Admin-Sitzung sitzt
// und die eigene Datenbank abfragt.
//
// Vor der Umstellung gemessene Zahlen stammen aus dem Import der früheren,
// fremden Zählung und kennen nur Aufrufe. Wo Besucher fehlen, steht deshalb ein Strich und keine
// Null — eine Null würde behaupten, es sei niemand da gewesen.

export const numberFormat = new Intl.NumberFormat("en-US");

export async function openStats() {
  // Always land on the last seven days, regardless of the last range picked.
  state.statsPeriod = { preset: "7d", from: "", to: "" };
  closeStatsPicker();
  showView("stats");
  replaceNav();
  setStatsRangeButtons();
  await loadStats();
}

export function setStatsRangeButtons() {
  if (!els.statsRange) return;
  const active = state.statsPeriod.preset;
  els.statsRange.querySelectorAll(".stats-range-btn").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.period === active);
  });
  if (els.statsRangeLabel) els.statsRangeLabel.textContent = statsPeriodLabel(state.statsPeriod);
}

// Numbers are fetched live, but cached in memory per range for a few minutes
// so flipping between ranges (or leaving and reopening the tab) is instant and
// doesn't re-query the database. The refresh button forces a live reload.
const STATS_CACHE_TTL = 5 * 60 * 1000;

function sharedStatsRequest(period, force = false) {
  const bounds = statsPeriodBounds(period);
  if (!bounds) return Promise.reject(Object.assign(new Error("incomplete range"), { incompleteRange: true }));
  const days = statsPeriodKey(period);
  if (!force) {
    const cached = state.statsCache.get(days);
    if (cached && Date.now() - cached.at < STATS_CACHE_TTL) return Promise.resolve(cached.data);
    if (state.statsPromises.has(days)) return state.statsPromises.get(days);
  }
  state.statsControllers.get(days)?.abort();
  const controller = new AbortController();
  state.statsControllers.set(days, controller);
  const { start, end } = bounds;
  const promise = fetch(`/api/admin/analytics?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: controller.signal
  }).then(async (response) => {
    if (!response.ok) {
      // Der Endpunkt legt seiner Antwort eine Begründung bei. Sie zu
      // verwerfen und nur den Status zu zeigen, verschenkt genau die
      // Auskunft, die weiterhilft.
      const grund = await response.json().then((body) => body?.error).catch(() => null);
      const error = new Error(grund || `Statistikanfrage fehlgeschlagen (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    state.statsCache.set(days, { at: Date.now(), data });
    return data;
  }).finally(() => {
    if (state.statsPromises.get(days) === promise) state.statsPromises.delete(days);
    if (state.statsControllers.get(days) === controller) state.statsControllers.delete(days);
  });
  state.statsPromises.set(days, promise);
  return promise;
}

export async function loadStats(force = false) {
  if (!els.statsBody) return;
  const request = ++state.statsRequest;

  els.statsBody.innerHTML = `<p class="stats-state">Wird geladen …</p>`;
  try {
    const data = await sharedStatsRequest(state.statsPeriod, force);
    if (request !== state.statsRequest) return;
    renderStats(data);
  } catch (error) {
    if (request !== state.statsRequest) return;
    if (error.name === "AbortError") return;
    // Freier Zeitraum noch unvollständig oder verdreht: keine Fehlermeldung,
    // die Beschriftung über der Fläche sagt bereits, was fehlt.
    if (error.incompleteRange) {
      els.statsBody.innerHTML = `<p class="stats-state">Wähle einen Von- und einen Bis-Tag.</p>`;
      return;
    }
    if (error.status === 401) {
      els.statsBody.innerHTML = `<p class="stats-state">Melde dich über die Einstellungen bei GitHub an, um die Statistik zu sehen.</p>`;
      return;
    }
    if (error.status === 503) {
      els.statsBody.innerHTML = `<p class="stats-state">Die Analytics-Datenbank ist noch nicht angebunden.</p>`;
      return;
    }
    els.statsBody.innerHTML = `<p class="stats-state stats-state-error">Statistik konnte nicht geladen werden: ${escapeHtml(error.message)}</p>`;
  }
}

// Eine Liste, deren Zeilen sich zu einer nachgeladenen Unterliste öffnen:
//   Seiten  → die Quellen, die auf diese Seite geführt haben
//   Quellen → die Seiten, die diese Quelle gebracht hat
//
// Dazu je Zeile ein Öffnen-Link. Er steht neben dem Aufklapp-Knopf und nicht
// darin: Ein Link in einem Knopf ist ungültiges Markup, und wer die Seite
// ansehen will, meint etwas anderes als wer ihre Quellen sehen will.
//
// Zeilen ohne `drill` bleiben unaufklappbar.
export function statsExpandablePanel(title, rows) {
  const items = (rows || []).filter(statsZeileSichtbar);
  const max = items.reduce((peak, row) => Math.max(peak, Number(row.count) || 0), 0);
  const body = items.length
    ? items.map((row) => {
        const { bar, text, value, link } = statsZeilenTeile(row, max);
        if (!row.drill) {
          return `<li class="stats-row-group"><div class="stats-row stats-row-plain${link ? " stats-row-linked" : ""}">` +
            `${bar}${text}${value}${link}</div></li>`;
        }
        return [
          `<li class="stats-row-group">`,
          `<div class="stats-row-line">`,
          `<button type="button" class="stats-row stats-row-toggle" data-drill-key="${escapeHtml(row.drill.key)}" data-drill-id="${escapeHtml(String(row.drill.id))}" aria-expanded="false">`,
          `<span class="stats-row-chevron" data-icon="chevron-down" aria-hidden="true"></span>`,
          bar,
          text,
          value,
          `</button>`,
          link,
          `</div>`,
          `<div class="stats-subrefs" hidden></div>`,
          `</li>`
        ].join("");
      })
    : [`<li class="stats-row stats-row-empty">Keine Daten</li>`];
  return statsPanelRahmen(title, body);
}
