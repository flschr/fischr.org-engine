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
    /^blog\/assets\/files\/gpx\/uploads\/.+\.gpx$/,
    // Since media moved to R2 (DB-1129) an image upload no longer adds a WebP to Git — its
    // upload record is the whole trace. Without these two the bookkeeping forced every image
    // publish into full validation, including the ten-minute browser suite, while the admin
    // promised the fast path. Both are generated bookkeeping, not code.
    /^automation\/media-manifest\.json$/,
    /^automation\/media-uploads\/[a-zA-Z0-9._-]+\.json$/
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
