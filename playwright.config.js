const { defineConfig, devices } = require("@playwright/test");

// Which engine and viewport a spec needs is a property of the spec, not of the suite. Running every
// spec in all four projects made the smoke suite 293 tests and 12 of the 16 minutes a deploy takes,
// and 232 of those tests were admin flows that drive the app against stubbed GitHub responses and
// assert the resulting git-tree requests — those cannot fail differently in WebKit or at 390px.
// Each group below therefore names the projects where its specs can actually fail; tests/browser-
// matrix.test.js fails the build if a spec file ends up in no project at all.

// Public pages assert computed styles, grid tracks and responsive behaviour, so they keep the full
// matrix — this is the coverage that a CSS change needs and the only coverage it can break.
const siteSpecs = /site-.*\.spec\.js$/;

// Admin specs that depend on the engine's own input handling: CodeMirror selection, formatting and
// undo (admin-footnotes), select-all scope and preview sanitizing (admin-editor), and the
// DataTransfer and protected-drag semantics that differ between Chromium and WebKit
// (admin-media-drag-drop). These run in both desktop engines. Hardware-keyboard behaviour is not
// meaningful under touch emulation, which is why they no longer run in the mobile projects.
const engineSensitiveAdminSpecs = /admin-(footnotes|editor|media-drag-drop)\.spec\.js$/;

// The admin shell's viewport behaviour — collapsed sidebar, mobile navigation, history — runs in
// the viewport projects, including real iOS WebKit, since that is the browser the admin is used
// from on a phone. The tests inside skip the projects they do not target.
const responsiveAdminSpecs = /admin-shell-responsive\.spec\.js$/;

const serviceWorkerSpec = /service-worker\.spec\.js$/;

// Der Port kommt aus der Umgebung, damit zwei Sitzungen im selben Repo nebeneinander testen
// können. Ohne das teilen sie sich 4173: Die zweite bekommt ERR_CONNECTION_REFUSED über die
// ganze Suite — oder, schlimmer, der Server der ersten antwortet mit deren Bytes, und die
// Gegenprobe wird grün, obwohl sie rot sein müsste.
const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: origin,
    serviceWorkers: "block",
    trace: "retain-on-failure"
  },
  projects: [
    // Every spec runs here at least once: this project is the behavioural baseline, the other
    // projects only add the engine and viewport dimensions on top of it.
    { name: "desktop", testIgnore: serviceWorkerSpec, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testMatch: [siteSpecs, responsiveAdminSpecs], use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "mobile-webkit", testMatch: [siteSpecs, responsiveAdminSpecs], use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "webkit", testMatch: [siteSpecs, engineSensitiveAdminSpecs], use: { ...devices["Desktop Safari"] } },
    {
      name: "service-worker",
      testMatch: serviceWorkerSpec,
      use: { ...devices["Desktop Chrome"], serviceWorkers: "allow" }
    }
  ],
  webServer: {
    command: process.env.PLAYWRIGHT_PREPARED_SITE === "1"
      ? "node scripts/serve-built-site.js"
      : "npm run build && node scripts/serve-built-site.js",
    env: { PORT: String(port) },
    url: `${origin}/admin/`,
    reuseExistingServer: false
  }
});
