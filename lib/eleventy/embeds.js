const {
  addIframeAspectRatio,
  escapeHtml,
  getAspectRatioStyle,
  getHtmlAttribute,
  getNormalizedHost,
  getNumberAttribute,
  normalizeEmbedUrl,
  parseUrl
} = require("./html");
const { createGpxEmbedHelpers } = require("./gpx-embed");
const { normalizeMediaShortcutSource, parseMediaShortcut } = require("../../blog/admin/markdown-conventions");

function getYouTubeId(value = "") {
  const url = parseUrl(value);
  if (!url) return "";

  const host = getNormalizedHost(url);

  if (host === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] || "";
  }

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host.endsWith(".youtube.com")) {
    if (url.pathname === "/watch") return url.searchParams.get("v") || "";

    const parts = url.pathname.split("/").filter(Boolean);
    if (["embed", "shorts", "live"].includes(parts[0])) return parts[1] || "";
  }

  return "";
}

function isYouTubePortraitUrl(value = "") {
  const url = parseUrl(value);
  if (!url) return false;

  return url.pathname.split("/").filter(Boolean)[0] === "shorts";
}

function getYouTubeEmbedUrl(id) {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}

function getYouTubePosterUrl(id) {
  return `https://i.ytimg.com/vi/${id}/hq720.jpg`;
}

function getYouTubePosterFallbackUrl(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function getClickToLoadProvider(value = "") {
  const url = parseUrl(value);
  if (!url) return null;

  const host = getNormalizedHost(url);

  if (host === "google.com" && url.pathname.startsWith("/maps/embed")) {
    return {
      slug: "google-maps",
      name: "Google Maps",
      title: "Google Maps",
      button: "Karte laden",
      description: "Beim Laden wird eine Verbindung zu Google Maps hergestellt.",
      referrerPolicy: "no-referrer-when-downgrade",
      allow: ""
    };
  }

  if ((host === "arte.tv" || host.endsWith(".arte.tv")) && url.pathname.includes("/embeds/")) {
    return {
      slug: "arte",
      name: "ARTE",
      title: "ARTE Video",
      button: "Video laden",
      description: "Beim Laden wird eine Verbindung zu ARTE hergestellt.",
      referrerPolicy: "strict-origin-when-cross-origin",
      allow: "fullscreen; autoplay; encrypted-media"
    };
  }

  return null;
}

function createEmbedHelpers(options = {}) {
  const renderLocalVideoEmbed = options.renderLocalVideoEmbed || (() => "");
  const normalizeLocalMediaSources = options.normalizeLocalMediaSources || ((content) => String(content));
  const prepareFeedMedia = options.prepareFeedMedia || normalizeLocalMediaSources;
  const assetUrl = options.assetUrl || ((value) => value);
  const gpx = createGpxEmbedHelpers({ assetUrl });

  function renderYouTubeIframe(url, renderOptions = {}) {
    const id = getYouTubeId(url);
    if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return "";

    const title = escapeHtml(renderOptions.title || "YouTube video player");

    return `<iframe src="${escapeHtml(getYouTubeEmbedUrl(id))}" title="${title}" width="560" height="315" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
  }

  function renderYouTubeEmbed(url, renderOptions = {}) {
    const id = getYouTubeId(url);
    if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return "";

    const width = Number(renderOptions.width) || 0;
    const height = Number(renderOptions.height) || 0;
    const portrait = renderOptions.portrait || isYouTubePortraitUrl(url) || (width > 0 && height > width);
    const className = `media-embed media-embed-click media-embed-youtube media-embed-poster${portrait ? " media-embed-portrait" : ""}`;
    const title = escapeHtml(renderOptions.title || "YouTube video player");
    const embedUrl = getYouTubeEmbedUrl(id);
    const posterUrl = getYouTubePosterUrl(id);
    const posterFallbackUrl = getYouTubePosterFallbackUrl(id);
    const sourceUrl = normalizeEmbedUrl(url);
    const posterWidth = width || 1280;
    const posterHeight = height || 720;

    return `<div class="${className}"${getAspectRatioStyle(width, height)}>
  <button class="embed-poster-button" type="button" data-embed-load data-embed-src="${escapeHtml(embedUrl)}" data-embed-title="${title}" data-embed-referrer-policy="strict-origin-when-cross-origin" data-embed-allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" data-embed-autoplay="true" aria-label="YouTube Video laden">
    <img class="embed-poster-image" src="${escapeHtml(posterUrl)}" data-embed-poster-fallback="${escapeHtml(posterFallbackUrl)}" width="${posterWidth}" height="${posterHeight}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
    <span class="embed-poster-overlay" aria-hidden="true"><span class="embed-youtube-play"></span></span>
  </button>
  <noscript><p><a href="${escapeHtml(sourceUrl)}">Video direkt bei YouTube öffnen</a>.</p></noscript>
</div>`;
  }

  function renderClickToLoadEmbed(url, renderOptions = {}) {
    const provider = getClickToLoadProvider(url);
    if (!provider) return "";

    const embedUrl = normalizeEmbedUrl(url);
    const width = Number(renderOptions.width) || 0;
    const height = Number(renderOptions.height) || 0;
    const title = escapeHtml(renderOptions.title || provider.title);
    const allow = provider.allow ? ` data-embed-allow="${escapeHtml(provider.allow)}"` : "";

    return `<div class="media-embed media-embed-click media-embed-${provider.slug}"${getAspectRatioStyle(width, height)}>
  <div class="embed-placeholder">
    <p class="embed-provider">${escapeHtml(provider.name)}</p>
    <p>${escapeHtml(provider.description)}</p>
    <div class="embed-actions">
      <button class="embed-load-button" type="button" data-embed-load data-embed-src="${escapeHtml(embedUrl)}" data-embed-title="${title}" data-embed-referrer-policy="${escapeHtml(provider.referrerPolicy)}"${allow}>${escapeHtml(provider.button)}</button>
    </div>
  </div>
</div>`;
  }

  function renderStandaloneMediaShortcutLink(src = "", providers = []) {
    const url = normalizeEmbedUrl(src);
    const supported = providers.some((provider) => {
      if (provider === "youtube") return Boolean(getYouTubeId(url));
      const clickToLoadProvider = getClickToLoadProvider(url);
      if (provider === "google-maps") return clickToLoadProvider?.slug === "google-maps";
      if (provider === "click-to-load") return Boolean(clickToLoadProvider);
      return false;
    });

    return supported ? `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` : "";
  }

  function renderMarkdownMediaShortcut(kind = "", src = "") {
    const normalizedKind = kind.toLowerCase();

    if (normalizedKind === "gpx") {
      return gpx.renderEmbed(src);
    }

    if (normalizedKind === "video") {
      return renderLocalVideoEmbed(src);
    }

    if (normalizedKind === "yt" || normalizedKind === "youtube") {
      return renderStandaloneMediaShortcutLink(src, ["youtube"]);
    }

    if (normalizedKind === "map") {
      return renderStandaloneMediaShortcutLink(src, ["google-maps"]);
    }

    if (normalizedKind === "embed") {
      return renderStandaloneMediaShortcutLink(src, ["youtube", "click-to-load"]);
    }

    return "";
  }

  function parseMediaShortcutLine(line = "") {
    const shortcut = parseMediaShortcut(line);
    if (!shortcut) return null;

    const source = normalizeMediaShortcutSource(shortcut.source);
    const html = shortcut.type === "gpx"
      ? gpx.renderEmbed(source, { activity: shortcut.label })
      : renderMarkdownMediaShortcut(shortcut.type, source, shortcut.label);
    return html ? { html } : null;
  }

  function markdownMediaShortcodes(md) {
    md.block.ruler.before("paragraph", "media_shortcode", (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const end = state.eMarks[startLine];
      const shortcut = parseMediaShortcutLine(state.src.slice(start, end));

      if (!shortcut) return false;
      if (silent) return true;

      const token = state.push("html_block", "", 0);
      token.content = `${shortcut.html}\n`;
      token.map = [startLine, startLine + 1];
      state.line = startLine + 1;
      return true;
    });
  }

  function renderStandaloneEmbed(href = "", label = "") {
    const url = normalizeEmbedUrl(href);
    if (url !== normalizeEmbedUrl(label)) return "";

    return renderYouTubeEmbed(url) || renderClickToLoadEmbed(url);
  }

  function renderFeedProviderIframe(url, renderOptions = {}) {
    const provider = getClickToLoadProvider(url);
    if (!provider) return "";

    const embedUrl = normalizeEmbedUrl(url);
    const title = escapeHtml(renderOptions.title || provider.title);
    const allow = provider.allow ? ` allow="${escapeHtml(provider.allow)}"` : "";

    return `<iframe src="${escapeHtml(embedUrl)}" title="${title}" width="560" height="315" loading="lazy" referrerpolicy="${escapeHtml(provider.referrerPolicy)}"${allow} allowfullscreen></iframe>`;
  }

  function renderFeedEmbed(url, renderOptions = {}) {
    return renderYouTubeIframe(url, renderOptions) || renderFeedProviderIframe(url, renderOptions);
  }

  function renderFeedStandaloneEmbed(href = "", label = "") {
    const url = normalizeEmbedUrl(href);
    if (url !== normalizeEmbedUrl(label)) return "";

    return renderFeedEmbed(url);
  }

  function renderFeedIframe(iframe = "") {
    const src = getHtmlAttribute(iframe, "src");
    if (!src) return iframe;

    const width = getNumberAttribute(iframe, "width");
    const height = getNumberAttribute(iframe, "height");
    const title = getHtmlAttribute(iframe, "title");

    return renderFeedEmbed(src, { width, height, title }) || addIframeAspectRatio(iframe);
  }

  function renderFeedEmbeds(content = "") {
    return gpx.renderFeed(prepareFeedMedia(content))
      .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, renderFeedIframe)
      .replace(
        /<p>\s*<a href="(https?:\/\/[^"]+)">\s*(https?:\/\/[^<]+)\s*<\/a>\s*<\/p>/g,
        (match, href, label) => {
          return renderFeedStandaloneEmbed(href, label) || match;
        }
      );
  }

  function renderIframeEmbed(iframe = "") {
    const src = getHtmlAttribute(iframe, "src");
    if (!src) return iframe;

    const width = getNumberAttribute(iframe, "width");
    const height = getNumberAttribute(iframe, "height");
    const title = getHtmlAttribute(iframe, "title");
    const portrait = width > 0 && height > width;

    return renderYouTubeEmbed(src, { width, height, title, portrait })
      || renderClickToLoadEmbed(src, { width, height, title })
      || addIframeAspectRatio(iframe);
  }

  function appendEmbedLoader(content = "") {
    const embedLoaderScript = assetUrl("/assets/js/embed-loader.js");

    if (!content.includes("data-embed-load") || content.includes(embedLoaderScript)) {
      return content;
    }

    return content.replace(/<\/body>/i, `  <script src="${embedLoaderScript}" defer></script>\n  </body>`);
  }

  return {
    appendEmbedLoader,
    appendGpxLoader: gpx.appendLoader,
    markdownMediaShortcodes,
    renderGpxEmbed: gpx.renderEmbed,
    renderFeedEmbeds,
    renderIframeEmbed,
    renderStandaloneEmbed,
    renderYouTubeEmbed
  };
}

module.exports = {
  createEmbedHelpers,
  getClickToLoadProvider,
  getYouTubeId
};
