// Die Beschriftung der Fortschrittskarte: verstrichene Zeit, Schritt, Aufschlüsselung.
//
// Reine Textbildung aus `state.publishStatus` und `state.publishRequest` — keine Entscheidung,
// kein DOM. Stand bis hierher in 26d-publish-sync.js, das damit drei Dinge tat: den Stand der
// Warteschlange ermitteln, die Medien-Bereitschaft bewachen und nebenbei Zeiten formatieren.

import { t } from "./00a-i18n.js";
import { state } from "./01c-state.js";

function publishElapsedLabel() {
  const startedAt = Date.parse(state.publishRequest?.startedAt || "");
  if (!Number.isFinite(startedAt)) return "";
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds} min`;
}

export function publishProgressMeta() {
  const status = state.publishStatus || {};
  const phase = status.phaseIndex != null && status.phaseCount
    ? t("queue.stepProgress", { phaseIndex: status.phaseIndex, phaseCount: status.phaseCount })
    : "";
  return [phase, publishElapsedLabel()].filter(Boolean).join(" · ");
}

function formatPublishDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "";
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min`;
}

export function publishTimingLabel() {
  const timings = state.publishStatus?.timings || {};
  return [
    [t("queue.timingWaiting"), timings.waitingMs],
    [t("queue.timingPreparation"), timings.preparationMs],
    [t("queue.timingValidation"), timings.validationMs],
    [t("queue.timingDeployment"), timings.deploymentMs]
  ].filter(([, value]) => Number.isFinite(value)).map(([label, value]) => `${label} ${formatPublishDuration(value)}`).join(" · ");
}
