const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// The smoke suite no longer runs every spec in every project, which introduces exactly one new way
// to lose coverage silently: a spec file that matches no project's filter is not reported as
// skipped, it simply never runs and the suite still goes green. These tests are the guard for that.
const config = require("../playwright.config.js");
const browserDirectory = path.join(__dirname, "browser");

const specFiles = fs.readdirSync(browserDirectory)
  .filter((name) => name.endsWith(".spec.js"))
  .map((name) => path.join(browserDirectory, name));

const asList = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const matchesAny = (patterns, file) => patterns.some((pattern) => pattern.test(file));

function projectsFor(file) {
  return config.projects.filter((project) => {
    const include = asList(project.testMatch);
    const exclude = asList(project.testIgnore);
    if (include.length > 0 && !matchesAny(include, file)) return false;
    return !matchesAny(exclude, file);
  }).map((project) => project.name);
}

test("every browser spec runs in at least one project", () => {
  assert.ok(specFiles.length > 0, "no browser specs found");
  for (const file of specFiles) {
    const projects = projectsFor(file);
    assert.ok(
      projects.length > 0,
      `${path.basename(file)} matches no project filter and would never run; add it to a group in playwright.config.js`
    );
  }
});

test("every project selects at least one spec", () => {
  for (const project of config.projects) {
    const selected = specFiles.filter((file) => projectsFor(file).includes(project.name));
    assert.ok(selected.length > 0, `project ${project.name} selects no spec; its filter is stale`);
  }
});

test("public site specs keep the full device matrix", () => {
  // A CSS change is validated by the site specs and nothing else, so they must keep running in both
  // engines and both viewports even as the admin groups get narrower.
  const siteSpecs = specFiles.filter((file) => /site-.*\.spec\.js$/.test(file));
  assert.ok(siteSpecs.length > 0, "no public site specs found");
  for (const file of siteSpecs) {
    assert.deepEqual(
      projectsFor(file).sort(),
      ["desktop", "mobile", "mobile-webkit", "webkit"],
      `${path.basename(file)} lost a device project`
    );
  }
});
