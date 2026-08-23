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

function publish() {
  frame = 0;
  const inset = measure();
  const root = document.documentElement;
  root.style.setProperty("--keyboard-inset", `${inset}px`);
  // Lets CSS distinguish "keyboard open" from "merely at the bottom" — the bar
  // drops its safe-area padding while the keyboard covers that area anyway.
  root.classList.toggle("is-keyboard-open", inset > 0);
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
