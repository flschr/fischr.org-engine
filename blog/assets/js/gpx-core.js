(function initGpxCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWGpx = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGpxCore() {
  "use strict";

  const EARTH_RADIUS_METERS = 6371000;

  function radians(value) {
    return value * Math.PI / 180;
  }

  function distanceMeters(first, second) {
    const dLat = radians(second.lat - first.lat);
    const dLon = radians(second.lon - first.lon);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(radians(first.lat)) * Math.cos(radians(second.lat)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function smoothElevations(points, radius = 1) {
    return points.map((point, index) => {
      if (!Number.isFinite(point.ele)) return null;
      const values = points
        .slice(Math.max(0, index - radius), index + radius + 1)
        .map((candidate) => candidate.ele)
        .filter(Number.isFinite);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    });
  }

  function samplePoints(points, maximum) {
    const limit = Math.max(2, Math.floor(maximum) || 2);
    if (points.length <= limit) return points.slice();
    return Array.from({ length: limit }, (unused, index) => {
      const sourceIndex = Math.round(index * (points.length - 1) / (limit - 1));
      return points[sourceIndex];
    });
  }

  function numericExtent(values) {
    return values.reduce((extent, value) => {
      if (!Number.isFinite(value)) return extent;
      return {
        minimum: extent.minimum === null ? value : Math.min(extent.minimum, value),
        maximum: extent.maximum === null ? value : Math.max(extent.maximum, value)
      };
    }, { minimum: null, maximum: null });
  }

  function pointAtDistance(points, distance) {
    if (!points.length) return null;
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((points[middle].distance || 0) < distance) low = middle + 1;
      else high = middle;
    }
    if (low === 0) return points[0];
    const before = points[low - 1];
    const after = points[low];
    return Math.abs((before.distance || 0) - distance) <= Math.abs((after.distance || 0) - distance) ? before : after;
  }

  function elevationGain(values, threshold = 3) {
    const elevations = values.filter(Number.isFinite);
    if (elevations.length < 2) return 0;

    let gain = 0;
    let anchor = elevations[0];
    let direction = 0;
    for (const elevation of elevations.slice(1)) {
      const difference = elevation - anchor;
      if (direction >= 0 && difference >= threshold) {
        gain += difference;
        anchor = elevation;
        direction = 1;
      } else if (direction <= 0 && difference <= -threshold) {
        anchor = elevation;
        direction = -1;
      } else if (direction > 0 && difference <= -threshold) {
        anchor = elevation;
        direction = -1;
      } else if (direction < 0 && difference >= threshold) {
        gain += difference;
        anchor = elevation;
        direction = 1;
      }
    }
    return gain;
  }

  function calculateStats(inputPoints, options = {}) {
    const points = inputPoints.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    const minimumSpeedKmh = Number(options.minimumSpeedKmh) || 1;
    const maximumSegmentSeconds = Number(options.maximumSegmentSeconds) || 300;
    const elevations = smoothElevations(points);
    let distance = 0;
    let movingDistance = 0;
    let movingSeconds = 0;

    points.forEach((point, index) => {
      point.distance = distance;
      point.smoothEle = elevations[index];
      if (index === 0) return;

      const segmentDistance = distanceMeters(points[index - 1], point);
      distance += segmentDistance;
      point.distance = distance;
      const previousTime = points[index - 1].time;
      const currentTime = point.time;
      if (!(previousTime instanceof Date) || !(currentTime instanceof Date)) return;
      const seconds = (currentTime - previousTime) / 1000;
      if (seconds <= 0 || seconds > maximumSegmentSeconds) return;
      if ((segmentDistance / seconds) * 3.6 >= minimumSpeedKmh) {
        movingDistance += segmentDistance;
        movingSeconds += seconds;
      }
    });

    const elevationExtent = numericExtent(points.map((point) => point.ele));
    return {
      distanceMeters: distance,
      elevationGainMeters: elevationGain(elevations),
      highestPointMeters: elevationExtent.maximum,
      movingDistanceMeters: movingDistance,
      movingSeconds,
      averageSpeedKmh: movingSeconds > 0 ? (movingDistance / 1000) / (movingSeconds / 3600) : null
    };
  }

  function text(node, selector) {
    return node.querySelector(selector)?.textContent?.trim() || "";
  }

  function parse(xml, Parser = globalThis.DOMParser) {
    if (!Parser) throw new Error("DOMParser is not available.");
    const document = new Parser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("Invalid GPX file.");
    const points = Array.from(document.querySelectorAll("trkpt, rtept")).map((node) => {
      const timestamp = text(node, "time");
      const time = timestamp ? new Date(timestamp) : null;
      return {
        lat: Number.parseFloat(node.getAttribute("lat")),
        lon: Number.parseFloat(node.getAttribute("lon")),
        ele: Number.parseFloat(text(node, "ele")),
        time: time && !Number.isNaN(time.getTime()) ? time : null
      };
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));

    if (points.length < 2) throw new Error("Die GPX-Datei enthält keine nutzbare Route.");
    return {
      name: text(document, "trk > name") || text(document, "rte > name") || text(document, "metadata > name"),
      points,
      stats: calculateStats(points)
    };
  }

  function duration(seconds) {
    const roundedMinutes = Math.round(seconds / 60);
    const hours = Math.floor(roundedMinutes / 60);
    const minutes = roundedMinutes % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")} h` : `${minutes} min`;
  }

  function pace(speedKmh) {
    if (!speedKmh) return "–";
    const seconds = Math.round(3600 / speedKmh);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min/km`;
  }

  function formatStats(stats, activity = "cycling") {
    const usePace = activity === "hiking" || activity === "running";
    return [
      ["Distanz", `${(stats.distanceMeters / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`],
      ["Aufstieg", Number.isFinite(stats.highestPointMeters) ? `${Math.round(stats.elevationGainMeters)} hm` : "–"],
      ["In Bewegung", stats.movingSeconds ? duration(stats.movingSeconds) : "–"],
      [usePace ? "Ø Tempo" : "Ø Geschwindigkeit", stats.averageSpeedKmh
        ? (usePace ? pace(stats.averageSpeedKmh) : `${stats.averageSpeedKmh.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km/h`)
        : "–"],
      ["Höchster Punkt", Number.isFinite(stats.highestPointMeters) ? `${Math.round(stats.highestPointMeters)} m` : "–"]
    ];
  }

  return { calculateStats, distanceMeters, formatStats, numericExtent, parse, pointAtDistance, samplePoints, smoothElevations };
});
