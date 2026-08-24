// --- Keyboard inset -----------------------------------------------------
//
// Publishes the on-screen keyboard's height as `--keyboard-inset` on <html>,
// so the writing bar can sit directly above the keyboard instead of at the far
// top of the screen. Writing the custom property straight onto the element (no
// framework state, no re-render) keeps the browser compositor in charge of the
// repositioning — updating via state is what makes these bars visibly lag
// behind the keyboard on iOS.
//
// The layout viewport (`innerHeight`) does not shrink when the keyboard opens;
// the visual viewport does. Their difference, minus how far the visual viewport
// has been scrolled down, is the part of the screen the keyboard covers.

// Browser chrome (a collapsing address bar) moves the visual viewport by a few
// dozen pixels too. Anything smaller than a plausible keyboard is not one.
export const MIN_KEYBOARD_HEIGHT = 120;

// The whole rule, as a pure function: no browser can be made to open a real
// keyboard in a test, so the arithmetic is what gets verified instead.
export function keyboardInsetFrom({ innerHeight, height, offsetTop = 0 }) {
  const covered = Math.round(innerHeight - height - offsetTop);
  return covered >= MIN_KEYBOARD_HEIGHT ? covered : 0;
}

let frame = 0;

function measure() {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return keyboardInsetFrom({
    innerHeight: window.innerHeight,
    height: viewport.height,
    offsetTop: viewport.offsetTop
  });
}

// Temporary, ?kbdebug=1 only: prints the raw numbers this module measures
// and draws a line exactly at the unbuffered keyboard-top it computes, so a
// single screenshot shows precisely how far off --ios-keyboard-accessory-h
// (06-responsive.css) is from where iOS 26's native accessory bar actually
// sits — instead of guessing a pixel value blind and re-testing each time.
// Remove once that number is confirmed correct on-device.
let kbDebugLabel = null;
let kbDebugLine = null;

function ensureKbDebugUi() {
  if (kbDebugLabel) return;
  kbDebugLabel = document.createElement("div");
  kbDebugLabel.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#ff0044;color:#fff;font:11px/1.4 monospace;padding:4px 6px;white-space:pre-wrap;pointer-events:none;";
  document.body.appendChild(kbDebugLabel);
  kbDebugLine = document.createElement("div");
  kbDebugLine.style.cssText = "position:fixed;left:0;right:0;height:2px;background:#39ff14;z-index:99999;pointer-events:none;";
  document.body.appendChild(kbDebugLine);
}

function updateKbDebugUi(inset) {
  if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("kbdebug")) return;
  ensureKbDebugUi();
  const viewport = window.visualViewport;
  kbDebugLabel.textContent = [
    `innerHeight=${window.innerHeight}`,
    `vvHeight=${viewport?.height}`,
    `vvOffsetTop=${viewport?.offsetTop}`,
    `--keyboard-inset=${inset}px  (green line = this, unbuffered)`
  ].join("\n");
  kbDebugLine.style.bottom = `${inset}px`;
}

function publish() {
  frame = 0;
  const inset = measure();
  const root = document.documentElement;
  root.style.setProperty("--keyboard-inset", `${inset}px`);
  // Lets CSS distinguish "keyboard open" from "merely at the bottom" — the bar
  // drops its safe-area padding while the keyboard covers that area anyway.
  root.classList.toggle("is-keyboard-open", inset > 0);
  updateKbDebugUi(inset);
}

function schedule() {
  if (frame) return;
  frame = window.requestAnimationFrame(publish);
}

export function initKeyboardInset() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty("--keyboard-inset", "0px");
  if (!viewport) return; // Bar falls back to the bottom safe area.
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  publish();
}
