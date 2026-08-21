const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("stateful publishing workflows share the guarded commit action", () => {
  for (const workflow of ["social-post", "atproto-publish", "indexnow", "webarchive", "webmentions"]) {
    const source = fs.readFileSync(path.join(root, `.github/workflows/${workflow}.yml`), "utf8");
    assert.match(source, /uses: \.\/\.github\/actions\/commit-automation-state/);
    assert.doesNotMatch(source, /for attempt in 1 2 3 4 5/);
    assert.doesNotMatch(source, /^\s+schedule:/m, `${workflow} must not wake up without publish work`);
    assert.doesNotMatch(source, /cron:/, `${workflow} must not contain an idle cron`);
  }
});

test("the shared state commit refuses unresolved concurrent changes", () => {
  const source = fs.readFileSync(
    path.join(root, ".github/actions/commit-automation-state/action.yml"),
    "utf8"
  );
  assert.match(source, /git ls-files -u/);
  assert.match(source, /git diff --check/);
  assert.match(source, /could not be merged safely/);
});

test("every successful production build reconciles schedules and syndication", () => {
  const build = fs.readFileSync(path.join(root, ".github/workflows/build.yml"), "utf8");
  const admin = fs.readFileSync(path.join(root, ".github/workflows/admin-publish.yml"), "utf8");
  const arm = fs.readFileSync(path.join(root, ".github/workflows/arm-schedule.yml"), "utf8");
  const scheduled = fs.readFileSync(path.join(root, ".github/workflows/scheduled-publish.yml"), "utf8");
  const social = fs.readFileSync(path.join(root, ".github/workflows/social-post.yml"), "utf8");
  const waitHelper = fs.readFileSync(
    path.join(root, "scripts/lib/dispatch-workflow-and-wait.sh"),
    "utf8"
  );

  assert.doesNotMatch(build, /Check whether post-publish automations are needed/);
  assert.doesNotMatch(build, /steps\.automations\.outputs\.needed/);
  assert.match(
    build,
    /- name: Publish pending social posts and wait\n\s+if: >-[\s\S]*?github\.ref == 'refs\/heads\/main'/
  );
  for (const workflow of [build, admin]) {
    const socialWait = workflow.indexOf("dispatch_workflow_and_wait social-post.yml 3");
    const scheduleCleanup = workflow.indexOf("for wf in arm-schedule atproto-publish");
    assert.notEqual(socialWait, -1, "social workflow must be awaited");
    assert.ok(scheduleCleanup > socialWait, "schedule cleanup must follow successful social delivery");
  }
  assert.match(waitHelper, /gh run watch "\$run_id" --exit-status/);
  assert.match(waitHelper, /did not complete successfully/);
  assert.match(social, /RETRY_UNREACHABLE_POSTS: "1"/);
  assert.doesNotMatch(arm, /\n\s+push:\s*\n/);
  assert.match(arm, /workflow_dispatch:/);
  assert.doesNotMatch(scheduled, /if: always\(\)/);
  assert.match(scheduled, /successful build dispatches arm-schedule\.yml/);
});
