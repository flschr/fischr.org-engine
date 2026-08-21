const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { renderPostText, findRuleById, resolveRule, ruleWantsLink } = require("../scripts/lib/publish-utils");
const {
  createIdempotencyKey,
  createMediaFingerprint,
  postToGoToSocial,
  requireLiveCandidates
} = require("../scripts/social-post");

const social = {
  defaultTemplate: "blogartikel",
  rules: [
    { id: "wandern", name: "Wandern", includeImage: true, template: "Ich war mal wieder wandern! {link}" },
    { id: "ausgelesen", name: "Ausgelesen", template: "Buch. {link}" },
    { id: "blogartikel", name: "Blogartikel", template: "Aufgeschrieben. {link}" }
  ]
};

const rule = social.rules[0];

function post(overrides = {}) {
  return {
    title: "Gipfeltour",
    url: "https://example.com/gipfeltour/",
    content: "Ein langer Bodytext zur Tour. ".repeat(40),
    socialTemplate: "",
    socialText: "",
    ...overrides
  };
}

test("renderPostText falls back to the category template without custom text", () => {
  assert.equal(
    renderPostText(post(), rule, 300),
    "Ich war mal wieder wandern! https://example.com/gipfeltour/"
  );
});

test("a pending post that is not live makes the workflow retry", () => {
  assert.throws(
    () => requireLiveCandidates([post()], [], true),
    /pending but not live yet/
  );
  assert.doesNotThrow(() => requireLiveCandidates([post()], [], false));
  assert.doesNotThrow(() => requireLiveCandidates([post()], [post()], true));
});

test("plain custom text overrides the template and appends the link inline", () => {
  assert.equal(
    renderPostText(post({ socialText: "Lohnt der Aufstieg? Mein Bericht:" }), rule, 300),
    "Lohnt der Aufstieg? Mein Bericht: https://example.com/gipfeltour/"
  );
});

test("custom social text loses Markdown but keeps link destinations", () => {
  assert.equal(
    renderPostText(
      post({ socialText: "**Neu:** [Zum Archiv](https://example.com/archive) und https://example.net/direkt" }),
      rule,
      300
    ),
    "Neu: Zum Archiv (https://example.com/archive) und https://example.net/direkt https://example.com/gipfeltour/"
  );
});

test("Markdown in native post content is removed without dropping URLs", () => {
  assert.equal(
    renderPostText(post({ content: "## Foto\n\nEin **Fund** bei [Wikipedia](https://de.wikipedia.org/wiki/Fisch)." }), nativeRule, 300),
    "Foto\n\nEin Fund bei Wikipedia (https://de.wikipedia.org/wiki/Fisch).\n\n#foto"
  );
});

test("GoToSocial preserves Markdown inline links for server-side rendering", () => {
  assert.equal(
    renderPostText(
      post({
        contentMarkdown:
          "Zum #Fotovorschlag ein Bild aus unserem [Azoren-Urlaub 2022](https://example.com/azorenhoch/)."
      }),
      nativeRule,
      500,
      { preserveMarkdownLinks: true }
    ),
    "Zum #Fotovorschlag ein Bild aus unserem [Azoren-Urlaub 2022](https://example.com/azorenhoch/).\n\n#foto"
  );
});

test("overlong custom text is truncated but the link always survives", () => {
  const text = renderPostText(post({ socialText: "x".repeat(600) }), rule, 300);
  assert.ok(text.length <= 300, `expected <= 300, got ${text.length}`);
  assert.ok(text.includes("https://example.com/gipfeltour/"), "link must survive truncation");
});

test("custom text is a full template only when it places {link} itself", () => {
  assert.equal(
    renderPostText(post({ socialText: "Frage? {link} #wandern" }), rule, 300),
    "Frage? https://example.com/gipfeltour/ #wandern"
  );
});

test("prose containing {content}/{title} but no {link} still gets the link appended", () => {
  assert.equal(
    renderPostText(post({ socialText: "Mehr zum {content}-Thema:" }), rule, 300),
    "Mehr zum {content}-Thema: https://example.com/gipfeltour/"
  );
});

// --- link toggle (native, linkless templates) ---

const nativeRule = { id: "foto", name: "Foto", images: 1, link: false, template: "{content}\n\n#foto" };

test("ruleWantsLink defaults on and respects link:false", () => {
  assert.equal(ruleWantsLink({}), true);
  assert.equal(ruleWantsLink({ link: true }), true);
  assert.equal(ruleWantsLink({ link: false }), false);
});

test("a linkless template posts no link (native photo post)", () => {
  const text = renderPostText(post({ content: "Sonnenuntergang über dem See." }), nativeRule, 300);
  assert.equal(text, "Sonnenuntergang über dem See.\n\n#foto");
  assert.ok(!text.includes("example.com"), "native post must not carry a link");
});

test("a linkless template strips a stray {link} from the template too", () => {
  const text = renderPostText(post({ content: "Foto." }), { ...nativeRule, template: "{content} {link}" }, 300);
  assert.ok(!text.includes("example.com"), "toggle wins over a leftover {link}");
});

test("plain custom text on a linkless template stays linkless", () => {
  assert.equal(
    renderPostText(post({ socialText: "Eigene Bildunterschrift" }), nativeRule, 300),
    "Eigene Bildunterschrift"
  );
});

test("a link-on template without {link} gets the link appended inline", () => {
  assert.equal(
    renderPostText(post(), { id: "x", name: "X", template: "Schau dir das an:" }, 300),
    "Schau dir das an: https://example.com/gipfeltour/"
  );
});

test("resolveRule uses the explicit template", () => {
  assert.equal(resolveRule(post({ socialTemplate: "wandern" }), social)?.id, "wandern");
  assert.equal(resolveRule(post({ socialTemplate: "ausgelesen" }), social)?.id, "ausgelesen");
});

test("resolveRule falls back to the configured default template", () => {
  assert.equal(resolveRule(post({ socialTemplate: "" }), social)?.id, "blogartikel");
  assert.equal(resolveRule(post({ socialTemplate: "does-not-exist" }), social)?.id, "blogartikel");
});

test("resolveRule falls back to the first template when no default is set", () => {
  const noDefault = { rules: social.rules };
  assert.equal(resolveRule(post({ socialTemplate: "" }), noDefault)?.id, "wandern");
});

test("findRuleById resolves by id (case-insensitive) and misses cleanly", () => {
  assert.equal(findRuleById("Wandern", social.rules)?.id, "wandern");
  assert.equal(findRuleById("nope", social.rules), null);
  assert.equal(findRuleById("", social.rules), null);
});

// --- image selection (paths only; getLocalImages reads files, so test the
// path-resolution branch via a tiny re-export-free helper through the public
// behaviour: we assert the *intent* by reconstructing the candidate list.)
const { extractMarkdownImages } = require("../scripts/lib/publish-utils");

test("extractMarkdownImages returns every embedded image in order", () => {
  const md = "intro\n\n![one](/a.webp)\ntext ![two](/b.webp 'cap')\n\n![three](/c.webp)";
  assert.deepEqual(
    extractMarkdownImages(md).map((i) => i.src),
    ["/a.webp", "/b.webp", "/c.webp"]
  );
});

test("GoToSocial idempotency keys are stable per canonical post URL", () => {
  const first = createIdempotencyKey("https://example.com/gipfeltour/");
  assert.equal(first, createIdempotencyKey("https://example.com/gipfeltour/"));
  assert.notEqual(first, createIdempotencyKey("https://example.com/andere-tour/"));
  assert.match(first, /^example-blog:[a-f0-9]{64}$/);
});

test("GoToSocial posting sends public Markdown with a stable idempotency key", async (t) => {
  const previousToken = process.env.MASTODON_ACCESS_TOKEN;
  const previousFetch = global.fetch;
  process.env.MASTODON_ACCESS_TOKEN = "test-token";

  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ url: "https://social.example.com/@example/statuses/01TEST" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  t.after(() => {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MASTODON_ACCESS_TOKEN;
    else process.env.MASTODON_ACCESS_TOKEN = previousToken;
  });

  const candidate = post();
  const result = await postToGoToSocial(
    { social: { gotosocialInstance: "https://social.example.com/" } },
    candidate,
    rule,
    []
  );

  assert.equal(request.url, "https://social.example.com/api/v1/statuses");
  assert.equal(request.init.headers.Authorization, "Bearer test-token");
  assert.equal(request.init.headers["Idempotency-Key"], createIdempotencyKey(candidate.url));
  assert.deepEqual(JSON.parse(request.init.body), {
    status: "Ich war mal wieder wandern! https://example.com/gipfeltour/",
    content_type: "text/markdown",
    media_ids: [],
    visibility: "public"
  });
  assert.equal(result.url, "https://social.example.com/@example/statuses/01TEST");
});

test("GoToSocial posting exposes HTTP failures and does not return delivery state", async (t) => {
  const previousToken = process.env.MASTODON_ACCESS_TOKEN;
  const previousFetch = global.fetch;
  process.env.MASTODON_ACCESS_TOKEN = "test-token";
  global.fetch = async () => new Response("temporary failure", { status: 503 });

  t.after(() => {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MASTODON_ACCESS_TOKEN;
    else process.env.MASTODON_ACCESS_TOKEN = previousToken;
  });

  await assert.rejects(
    postToGoToSocial({ social: { gotosocialInstance: "https://social.example.com" } }, post(), rule, []),
    /GoToSocial status API returned 503: temporary failure/
  );
});

test("GoToSocial reuses media uploaded by an earlier failed attempt", async (t) => {
  const previousToken = process.env.MASTODON_ACCESS_TOKEN;
  const previousFetch = global.fetch;
  process.env.MASTODON_ACCESS_TOKEN = "test-token";
  let requestBody;
  global.fetch = async (url, options) => {
    assert.equal(url, "https://social.example.com/api/v1/statuses");
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ url: "https://social.example.com/@example/statuses/01RETRY" })
    };
  };

  t.after(() => {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MASTODON_ACCESS_TOKEN;
    else process.env.MASTODON_ACCESS_TOKEN = previousToken;
  });

  const image = { path: "/unused/image.webp", size: 1, mimeType: "image/webp", name: "image.webp" };
  await postToGoToSocial(
    { social: { gotosocialInstance: "https://social.example.com" } },
    post(),
    rule,
    [image],
    { pendingMedia: [{ id: "existing-media-id", fingerprint: createMediaFingerprint(image) }] }
  );

  assert.deepEqual(requestBody.media_ids, ["existing-media-id"]);
});

test("GoToSocial matches reusable media by fingerprint after skipped images", async (t) => {
  const previousToken = process.env.MASTODON_ACCESS_TOKEN;
  const previousFetch = global.fetch;
  process.env.MASTODON_ACCESS_TOKEN = "test-token";
  let requestBody;
  global.fetch = async (url, options) => {
    assert.equal(url, "https://social.example.com/api/v1/statuses");
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ url: "https://social.example.com/@example/statuses/01MATCHED" })
    };
  };

  t.after(() => {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MASTODON_ACCESS_TOKEN;
    else process.env.MASTODON_ACCESS_TOKEN = previousToken;
  });

  const oversized = { path: "/unused/large.webp", size: 9 * 1024 * 1024, mimeType: "image/webp", name: "large.webp" };
  const reusable = { path: "/unused/reusable.webp", size: 10, mimeType: "image/webp", name: "reusable.webp" };
  await postToGoToSocial(
    { social: { gotosocialInstance: "https://social.example.com" } },
    post(),
    rule,
    [oversized, reusable],
    { pendingMedia: [{ id: "matched-media-id", fingerprint: createMediaFingerprint(reusable) }] }
  );

  assert.deepEqual(requestBody.media_ids, ["matched-media-id"]);
});

test("GoToSocial media fingerprints change for equal-sized replacement files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "social-media-fingerprint-"));
  const file = path.join(directory, "image.webp");
  fs.writeFileSync(file, "first");
  const first = createMediaFingerprint({ path: file, size: 5 });
  fs.writeFileSync(file, "other");
  const replacement = createMediaFingerprint({ path: file, size: 5 });

  assert.notEqual(first, replacement);
});
