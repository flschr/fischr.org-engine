const assert = require("node:assert/strict");
const test = require("node:test");

const socialConfig = require("../blog/admin/social-config.js");

const clone = (value) => JSON.parse(JSON.stringify(value));
const token = (value) => String(value || "").toLowerCase();
const normalizeRule = (rule) => ({ ...rule, id: token(rule.id || rule.name) });
const resolveDefaultTemplate = (rules, chosen) => rules.some((rule) => rule.id === token(chosen)) ? token(chosen) : (rules[0]?.id || "");
const helpers = { clone, token, normalizeRule, resolveDefaultTemplate };

test("normalization migrates the legacy Mastodon endpoint and removes targets", () => {
  const config = socialConfig.normalize({
    social: {
      mastodonInstance: "https://social.example.org",
      targets: ["mastodon", "bluesky"],
      rules: [{ id: "post", name: "Post" }]
    }
  }, helpers);

  assert.equal(config.social.gotosocialInstance, "https://social.example.org");
  assert.equal("mastodonInstance" in config.social, false);
  assert.equal("targets" in config.social, false);
});

test("collection emits only the GoToSocial endpoint", () => {
  const config = socialConfig.collect({
    social: {
      mastodonInstance: "https://old.example.org",
      targets: ["bluesky"],
      rules: [{ id: "post", name: "Post" }]
    }
  }, {
    gotosocialInstance: "https://social.example.org",
    maxPostsPerRun: "3",
    maxAgeDays: "14",
    startAfter: "",
    defaultTemplate: "post",
    statsEnabled: true,
    statsUrl: ""
  }, helpers);

  assert.equal(config.social.gotosocialInstance, "https://social.example.org");
  assert.equal("mastodonInstance" in config.social, false);
  assert.equal("targets" in config.social, false);
});
