const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const adminSource = require("./helpers/admin-source");

// The module is an ES module inside the admin bundle; import it directly so the
// arithmetic is exercised rather than pattern-matched.
const modulePath = path.resolve(__dirname, "../blog/admin/admin-src/02d-keyboard-inset.js");
const loadModule = () => import(`file://${modulePath}`);

test("the writing bar's offset is the part of the screen the keyboard covers", async () => {
  const { keyboardInsetFrom } = await loadModule();

  // iPhone 15, Safari, German keyboard: the layout viewport keeps its height
  // while the visual viewport shrinks by the keyboard's height.
  assert.equal(keyboardInsetFrom({ innerHeight: 852, height: 516, offsetTop: 0 }), 336);

  // Scrolled down while the keyboard is open: offsetTop is how far the visual
  // viewport has moved, and must not be counted as covered screen.
  assert.equal(keyboardInsetFrom({ innerHeight: 852, height: 516, offsetTop: 120 }), 216);

  // Keyboard closed — the bar rests on the bottom safe area.
  assert.equal(keyboardInsetFrom({ innerHeight: 852, height: 852, offsetTop: 0 }), 0);
});

test("a collapsing address bar does not read as a keyboard", async () => {
  const { keyboardInsetFrom, MIN_KEYBOARD_HEIGHT } = await loadModule();

  // Safari's toolbar is a few dozen pixels. Treating that as a keyboard would
  // lift the writing bar off the bottom edge for no reason while scrolling.
  assert.equal(keyboardInsetFrom({ innerHeight: 852, height: 800, offsetTop: 0 }), 0);
  assert.equal(keyboardInsetFrom({ innerHeight: 852, height: 852 - (MIN_KEYBOARD_HEIGHT - 1) }), 0);
  assert.equal(keyboardInsetFrom({ innerHeight: 852, height: 852 - MIN_KEYBOARD_HEIGHT }), MIN_KEYBOARD_HEIGHT);

  // A visual viewport reported taller than the layout viewport must not yield a
  // negative offset, which would push the bar off the bottom of the screen.
  assert.equal(keyboardInsetFrom({ innerHeight: 852, height: 900, offsetTop: 0 }), 0);
});

test("the inset is published as a CSS variable, not through re-rendering", () => {
  const source = adminSource();

  // Writing the custom property straight onto the element keeps the browser
  // compositor in charge; routing it through state is what makes these bars
  // visibly lag behind the keyboard on iOS.
  assert.match(source, /root\.style\.setProperty\("--keyboard-inset", `\$\{inset\}px`\)/);
  assert.match(source, /root\.classList\.toggle\("is-keyboard-open", inset > 0\)/);
  // Coalesced to one write per frame: visualViewport fires resize and scroll in
  // bursts while the keyboard animates in.
  assert.match(source, /window\.requestAnimationFrame\(publish\)/);
  assert.match(source, /viewport\.addEventListener\("resize", schedule\)/);
  assert.match(source, /viewport\.addEventListener\("scroll", schedule\)/);
});
