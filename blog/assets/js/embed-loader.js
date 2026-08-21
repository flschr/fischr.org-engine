(function () {
  function loadPosterFallback(image) {
    const fallback = image.dataset.embedPosterFallback;
    if (!fallback || image.src === fallback) return;

    image.removeAttribute("data-embed-poster-fallback");
    image.src = fallback;
  }

  function addEmbedParam(src, key, value) {
    try {
      const url = new URL(src, window.location.href);
      url.searchParams.set(key, value);
      return url.toString();
    } catch {
      const separator = src.includes("?") ? "&" : "?";
      return `${src}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }
  }

  function loadEmbed(button) {
    const wrapper = button.closest(".media-embed");
    if (!wrapper) return;

    let src = button.dataset.embedSrc;
    if (!src) return;

    if (button.dataset.embedAutoplay === "true") {
      src = addEmbedParam(src, "autoplay", "1");
      src = addEmbedParam(src, "playsinline", "1");
    }

    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.title = button.dataset.embedTitle || "Externer Inhalt";
    iframe.loading = "lazy";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = button.dataset.embedReferrerPolicy || "strict-origin-when-cross-origin";

    if (button.dataset.embedAllow) {
      iframe.setAttribute("allow", button.dataset.embedAllow);
    }

    wrapper.classList.add("media-embed-loaded");
    wrapper.replaceChildren(iframe);
  }

  document.addEventListener("click", function (event) {
    const button = event.target.closest("[data-embed-load]");
    if (!button) return;
    loadEmbed(button);
  });

  document.addEventListener("error", function (event) {
    if (!event.target.matches(".embed-poster-image[data-embed-poster-fallback]")) return;
    loadPosterFallback(event.target);
  }, true);
})();
