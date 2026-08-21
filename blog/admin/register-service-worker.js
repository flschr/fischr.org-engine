if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const version = document.documentElement.dataset.adminBundleVersion || "development";
    navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(version)}`).catch(() => {});
  });
}
