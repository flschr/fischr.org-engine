(function publishPlanModule(global, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.RWPublishPlan = api;
})(typeof window !== "undefined" ? window : null, () => {
  "use strict";

  const contentOnlyPatterns = [
    /^blog\/posts\/.+\.md$/,
    /^blog\/pages\/.+\.md$/,
    /^blog\/_data\/videoMetadata\.json$/,
    /^blog\/assets\/images\/.+\.webp$/,
    /^blog\/assets\/videos\/uploads\/.+\.(?:mp4|webm)$/,
    /^blog\/assets\/files\/gpx\/uploads\/.+\.gpx$/
  ];

  function isContentOnlyPath(filePath) {
    return contentOnlyPatterns.some((pattern) => pattern.test(filePath));
  }

  function plan(changes = []) {
    const paths = changes.map((change) => typeof change === "string" ? change : change.path).filter(Boolean);
    const fullValidationPaths = paths.filter((filePath) => !isContentOnlyPath(filePath));
    const mode = paths.length > 0 && fullValidationPaths.length === 0 ? "content" : "full";
    return {
      mode,
      label: mode === "content" ? "Schneller Content-Publish" : "Vollständige Prüfung",
      detail: mode === "content"
        ? "Inhalte und Medien werden gebaut und geprüft; unveränderter Code und Browsertests entfallen."
        : fullValidationPaths.length
          ? `Vollständige Prüfung wegen ${fullValidationPaths[0]}`
          : "Vollständige Prüfung, weil keine eindeutige Inhaltsänderung erkannt wurde.",
      fullValidationPaths
    };
  }

  return { isContentOnlyPath, plan };
});
