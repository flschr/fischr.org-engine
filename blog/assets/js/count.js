// Eigene Zählung. Ein Beacon, keine Cookies, kein Fingerabdruck.
//
// Die einzige Zählung der Seite, seit der fremde Dienst abgeschaltet ist.
//
// Do-Not-Track wird respektiert — dieselbe Haltung wie zuvor. Die Zahlen sind
// dadurch niedriger als die Wirklichkeit; das ist der Preis und er wird bezahlt.

// document.currentScript ist bei Modulen null — deshalb das Muster, das eigene
// Script-Tag über sein Datenattribut zu finden.
const tag = document.querySelector("script[type=module][data-count-endpoint]");
const endpoint = tag?.dataset.countEndpoint || "/api/hit";

// Der Zugriff auf localStorage selbst kann werfen — Safari mit vollständig
// blockiertem Speicher tut das. Ungeschützt stürbe das Modul, bevor irgendetwas
// gesendet wird, und der Besuch wäre nie gezählt.
function excludedByChoice() {
  try {
    return window.localStorage.getItem("skipcount") === "t";
  } catch {
    return false;
  }
}

const skip =
  navigator.doNotTrack === "1" ||
  window.doNotTrack === "1" ||
  window.self !== window.top ||
  excludedByChoice() ||
  /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0$)/.test(window.location.hostname);

if (!skip) {
  // Die kanonische Adresse gewinnt: Sonst zerfällt eine Seite in mehrere
  // Zeilen, sobald jemand mit einem Kampagnenparameter im Link ankommt.
  const canonical = document.querySelector('link[rel="canonical"][href]');
  let path = window.location.pathname;
  if (canonical) {
    try {
      const url = new URL(canonical.href);
      if (url.hostname.replace(/^www\./, "") === window.location.hostname.replace(/^www\./, "")) {
        path = url.pathname;
      }
    } catch {
      // Ungültige kanonische Adresse: dann eben der tatsächliche Pfad.
    }
  }

  const body = JSON.stringify({
    p: path,
    r: document.referrer || "",
    t: document.title || ""
  });

  // sendBeacon überlebt das Verlassen der Seite. Wo es fehlt, tut es ein fetch
  // mit keepalive; scheitert auch das, wird eben nicht gezählt.
  const sent = navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" }));
  if (!sent) {
    fetch(endpoint, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } })
      .catch(() => {});
  }
}
