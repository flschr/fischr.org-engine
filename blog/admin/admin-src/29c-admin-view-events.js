import { applyStaticTranslations, setLang } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { openSocialConfig } from "./14-social-settings.js";
import { addSocialCategory, resetSocialConfig, saveSocialConfig, updateSocialConfigDirty } from "./14a-social-controls.js";
import { confirmLeaveEditor } from "./19-recovery.js";
import { loadStats, openStats, setStatsRangeButtons } from "./21-stats.js";
import { toggleStatsRowDrill } from "./21a-stats-details.js";
import { statsIsPreset } from "./21b-stats-period.js";
import {
  applyStatsPicker,
  closeStatsPicker,
  statsCalendarClick,
  statsCalendarHover,
  statsCalendarLeave,
  statsCalendarMonth,
  toggleStatsPicker
} from "./21f-stats-picker.js";
import { refreshAfterTabResume } from "./27a-publish-state.js";

export function wireAdminViewEvents() {
  els.queueSettingsButton?.addEventListener("click", async () => {
    if (state.view === "social") return;
    if (await confirmLeaveEditor()) openSocialConfig();
  });

  window.addEventListener("focus", refreshAfterTabResume);
  document.addEventListener("visibilitychange", refreshAfterTabResume);

  els.statsNav?.addEventListener("click", async () => {
    if (state.view === "stats") return;
    if (await confirmLeaveEditor()) openStats();
  });
  els.statsRange?.addEventListener("click", (event) => {
    const button = event.target.closest(".stats-range-btn");
    if (!button) return;
    const preset = button.dataset.period;
    if (!statsIsPreset(preset)) return;
    // "Zeitraum" wählt nicht aus, sondern fragt: Der Wähler klappt auf, die
    // Ansicht dahinter bleibt stehen, bis zwei Tage feststehen.
    if (preset === "custom") return toggleStatsPicker();
    closeStatsPicker();
    if (preset === state.statsPeriod.preset) return;
    state.statsPeriod = { preset, from: "", to: "" };
    setStatsRangeButtons();
    loadStats();
  });
  els.statsCustomApply?.addEventListener("click", applyStatsPicker);
  els.statsCalPrev?.addEventListener("click", () => statsCalendarMonth(-1));
  els.statsCalNext?.addEventListener("click", () => statsCalendarMonth(1));
  // Delegiert: Die Tageszellen entstehen bei jeder Auswahl neu (innerHTML),
  // ein Horchposten je Zelle würde bei jedem Klick wieder verschwinden.
  els.statsCalGrid?.addEventListener("click", (event) => {
    const tag = event.target.closest(".stats-cal-day")?.dataset.tag;
    if (tag) statsCalendarClick(tag);
  });
  // Der Zeiger zeichnet die Spanne vor, solange erst ein Tag feststeht — wie
  // auf den Datumswählern der Reiseportale, nach denen dieser Kalender gebaut
  // ist. "pointerover" statt "pointermove": Es reicht, beim Wechsel der
  // Zelle einmal neu zu zeichnen, nicht bei jeder Pixelbewegung darüber.
  els.statsCalGrid?.addEventListener("pointerover", (event) => {
    const tag = event.target.closest(".stats-cal-day")?.dataset.tag;
    if (tag) statsCalendarHover(tag);
  });
  els.statsCalGrid?.addEventListener("pointerleave", statsCalendarLeave);
  // Ein Blatt, das über der Ansicht liegt, muss auf zwei Wege verschwinden:
  // Escape und ein Klick daneben. Sonst steht es noch da, wenn man längst
  // etwas anderes tut.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeStatsPicker({ focusToggle: true });
  });
  document.addEventListener("pointerdown", (event) => {
    if (els.statsCustom?.hidden) return;
    if (event.target.closest("#statsCustom, #statsCustomToggle")) return;
    closeStatsPicker();
  });
  els.statsRefresh?.addEventListener("click", () => loadStats(true));
  // Delegated: rows are re-rendered on every load, the container persists.
  els.statsBody?.addEventListener("click", toggleStatsRowDrill);
  // Die versteckten Zeilen stehen schon im Markup — aufklappen kostet keine
  // zweite Anfrage. Delegiert, weil die Listen bei jedem Laden neu entstehen.
  els.statsBody?.addEventListener("click", (event) => {
    const button = event.target.closest(".stats-more");
    if (!button) return;
    button.closest(".stats-panel")?.querySelectorAll("[data-stats-mehr]").forEach((zeile) => {
      zeile.hidden = false;
    });
    button.remove();
  });
  // A device preference, not part of the saved social config — takes effect
  // immediately, no Speichern/Zurücksetzen of its own.
  els.adminLangSelect?.addEventListener("change", () => {
    setLang(els.adminLangSelect.value);
    applyStaticTranslations();
  });
  els.socialConfigSave?.addEventListener("click", saveSocialConfig);
  els.socialConfigReset?.addEventListener("click", resetSocialConfig);
  els.socialConfigAdd?.addEventListener("click", addSocialCategory);
  [els.cfgGotosocialInstance, els.cfgMaxPostsPerRun, els.cfgMaxAgeDays, els.cfgStartAfter].forEach((input) => {
    input?.addEventListener("input", updateSocialConfigDirty);
  });
  els.cfgDefaultCategory?.addEventListener("change", () => {
    // Mirror into the live draft so re-renders (add/remove rule) keep the pick.
    if (state.socialConfigDraft?.social) state.socialConfigDraft.social.defaultTemplate = els.cfgDefaultCategory.value;
    updateSocialConfigDirty();
  });
}
