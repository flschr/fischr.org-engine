const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    serviceWorkers: "block",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "desktop", testIgnore: /service-worker\.spec\.js/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testIgnore: /service-worker\.spec\.js/, use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "mobile-webkit", testIgnore: /service-worker\.spec\.js/, use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "webkit", testIgnore: /service-worker\.spec\.js/, use: { ...devices["Desktop Safari"] } },
    {
      name: "service-worker",
      testMatch: /service-worker\.spec\.js/,
      use: { ...devices["Desktop Chrome"], serviceWorkers: "allow" }
    }
  ],
  webServer: {
    command: process.env.PLAYWRIGHT_PREPARED_SITE === "1"
      ? "node scripts/serve-built-site.js"
      : "npm run build && node scripts/serve-built-site.js",
    url: "http://127.0.0.1:4173/admin/",
    reuseExistingServer: false
  }
});
