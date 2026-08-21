(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWSourcePages = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const pages = Object.freeze([
    Object.freeze({ path: "blog/about.njk", title: "Über mich", slug: "about" }),
    Object.freeze({ path: "blog/projects.njk", title: "Projekte", slug: "projekte" })
  ]);
  const byPath = new Map(pages.map((page) => [page.path, page]));

  function get(path) {
    return byPath.get(String(path || "")) || null;
  }

  function has(path) {
    return byPath.has(String(path || ""));
  }

  function paths() {
    return pages.map((page) => page.path);
  }

  return { get, has, paths };
});
