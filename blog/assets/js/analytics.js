const script = document.querySelector('script[type="module"][data-goatcounter]');
const endpoint = script?.dataset.goatcounter;
const disabled =
  window.goatcounter?.no_onload ||
  window.self !== window.top ||
  window.localStorage.getItem("skipgc") === "t" ||
  /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0$)/.test(window.location.hostname);

if (endpoint && !disabled) {
  const canonical = document.querySelector('link[rel="canonical"][href]');
  const canonicalUrl = canonical ? new URL(canonical.href) : window.location;
  const path = canonicalUrl.hostname.replace(/^www\./, "") === window.location.hostname.replace(/^www\./, "")
    ? `${canonicalUrl.pathname}${canonicalUrl.search}`
    : `${window.location.pathname}${window.location.search}`;
  const query = new URLSearchParams({
    p: path || "/",
    r: document.referrer,
    t: document.title,
    s: String(window.screen.width),
    q: window.location.search,
    rnd: Math.random().toString(36).slice(2, 7)
  });

  navigator.sendBeacon(`${endpoint}?${query}`);
}
