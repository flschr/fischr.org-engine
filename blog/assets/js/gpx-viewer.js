(function initGpxViewers() {
  "use strict";

  const core = window.RWGpx;
  if (!core) return;
  const leafletRoot = "/assets/vendor/leaflet";
  const maximumElevationPoints = 1200;
  const maximumMapPoints = 4000;
  let leafletPromise;

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;

    let script;
    leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-gpx-leaflet]')) {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = `${leafletRoot}/leaflet.css`;
        stylesheet.dataset.gpxLeaflet = "";
        document.head.append(stylesheet);
      }
      script = document.createElement("script");
      script.src = `${leafletRoot}/leaflet.js`;
      script.dataset.gpxLeaflet = "";
      script.onload = () => resolve(window.L);
      script.onerror = () => reject(new Error("Kartenmodul konnte nicht geladen werden."));
      document.head.append(script);
    }).catch((error) => {
      leafletPromise = null;
      script?.remove();
      throw error;
    });
    return leafletPromise;
  }

  function renderStats(element, data, activity) {
    element.innerHTML = core.formatStats(data.stats, activity).map(([label, value]) => (
      `<div class="gpx-stat"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
    )).join("");
  }

  function renderElevation(element, data) {
    const points = core.samplePoints(
      data.points.filter((point) => Number.isFinite(point.smoothEle)),
      maximumElevationPoints
    );
    if (points.length < 2) {
      element.hidden = true;
      return;
    }

    const width = 1000;
    const height = 180;
    const elevations = points.map((point) => point.smoothEle);
    const { minimum, maximum } = core.numericExtent(elevations);
    const range = maximum - minimum || 1;
    const totalDistance = data.stats.distanceMeters || 1;
    const coordinates = points.map((point) => {
      const x = point.distance / totalDistance * width;
      const y = 8 + (maximum - point.smoothEle) / range * (height - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

    element.innerHTML = `<div class="gpx-elevation-chart">
      <span class="gpx-elevation-max">${Math.round(maximum)} m</span>
      <span class="gpx-elevation-min">${Math.round(minimum)} m</span>
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Höhenprofil von ${Math.round(minimum)} bis ${Math.round(maximum)} Metern">
        <polygon points="0,${height} ${coordinates} ${width},${height}" />
        <polyline points="${coordinates}" />
        <line class="gpx-elevation-cursor" x1="-1" x2="-1" y1="0" y2="${height}" />
      </svg>
      <output class="gpx-elevation-tooltip" hidden></output>
    </div>`;

    const svg = element.querySelector("svg");
    const cursor = element.querySelector(".gpx-elevation-cursor");
    const tooltip = element.querySelector(".gpx-elevation-tooltip");
    svg.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const targetDistance = ratio * totalDistance;
      const point = core.pointAtDistance(points, targetDistance);
      const x = ratio * width;
      cursor.setAttribute("x1", x);
      cursor.setAttribute("x2", x);
      tooltip.value = `${(point.distance / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km · ${Math.round(point.smoothEle)} m`;
      tooltip.hidden = false;
      tooltip.style.left = `${Math.min(82, Math.max(4, ratio * 100))}%`;
    });
    svg.addEventListener("pointerleave", () => {
      cursor.setAttribute("x1", "-1");
      cursor.setAttribute("x2", "-1");
      tooltip.hidden = true;
    });
  }

  async function renderMap(embed, data) {
    if (embed.dataset.gpxMapLoaded === "true") return;
    const button = embed.querySelector(".gpx-map-load");
    const placeholder = embed.querySelector(".gpx-map-placeholder");
    const mapElement = embed.querySelector(".gpx-map");
    button.disabled = true;
    button.textContent = "Karte wird geladen …";

    try {
      const L = await loadLeaflet();
      placeholder.hidden = true;
      mapElement.hidden = false;
      const map = L.map(mapElement, { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
      }).addTo(map);
      const coordinates = core.samplePoints(data.points, maximumMapPoints).map((point) => [point.lat, point.lon]);
      const route = L.polyline(coordinates, { color: "#b42318", opacity: 0.92, weight: 4 }).addTo(map);
      const markerOptions = { radius: 6, color: "#fff", weight: 2, fillOpacity: 1 };
      L.circleMarker(coordinates[0], { ...markerOptions, fillColor: "#27864b" }).addTo(map);
      L.circleMarker(coordinates.at(-1), { ...markerOptions, fillColor: "#b42318" }).addTo(map);
      map.fitBounds(route.getBounds(), { padding: [24, 24] });
      embed.dataset.gpxMapLoaded = "true";
    } catch (error) {
      button.disabled = false;
      button.textContent = "Erneut versuchen";
      embed.querySelector(".gpx-map-placeholder p").textContent = error.message;
    }
  }

  async function initialize(embed) {
    const status = embed.querySelector(".gpx-status");
    try {
      const response = await fetch(embed.dataset.gpxSrc, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`GPX konnte nicht geladen werden (${response.status}).`);
      const data = core.parse(await response.text());
      if (data.name) embed.querySelector(".gpx-title").textContent = data.name;
      renderStats(embed.querySelector(".gpx-stats"), data, embed.dataset.gpxActivity);
      renderElevation(embed.querySelector(".gpx-elevation"), data);
      embed.querySelector(".gpx-map-load").addEventListener("click", () => renderMap(embed, data));
      status.remove();
    } catch (error) {
      status.textContent = error.message || "GPX konnte nicht geladen werden.";
      status.classList.add("gpx-error");
    }
  }

  document.querySelectorAll(".gpx-embed[data-gpx-src]").forEach(initialize);
})();
