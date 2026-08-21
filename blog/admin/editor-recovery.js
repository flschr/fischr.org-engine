(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWEditorRecovery = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function create({ storage, key, now = () => new Date().toISOString() }) {
    function docKey(current) {
      if (!current) return "";
      return `${current.collection || ""}:${current.path || "__new__"}`;
    }

    function clear() {
      try {
        storage.removeItem(key);
      } catch {
        // Storage can be unavailable in private browsing mode.
      }
    }

    function read() {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data && typeof data.content === "string" ? data : null;
      } catch {
        return null;
      }
    }

    function write(value) {
      storage.setItem(key, JSON.stringify({ ...value, savedAt: value.savedAt || now() }));
    }

    return { clear, docKey, read, write };
  }

  return { create };
});
