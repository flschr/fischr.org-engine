const assert = require("node:assert/strict");
const test = require("node:test");

const {
  discoverWebmentionEndpoint,
  extractTargetUrls,
  getEndpointFromHtml,
  getEndpointFromLinkHeader,
  getPublishedMf2Targets,
  normalizeTargetUrl,
  processWebmentionTarget,
  sendWebmention,
  WebmentionHttpError
} = require("../scripts/submit-webmentions");

function headers(values = {}) {
  return {
    get(name) {
      return values[name.toLowerCase()] || "";
    }
  };
}

test("extracts outbound Webmention targets from post markdown", () => {
  const targets = extractTargetUrls(
    `
[Own link](https://mysite.example/eigener-artikel/)
[External link](https://example.com/post?x=1&amp;y=2)
![External image](https://images.example.com/photo.webp)
<a href="https://blog.example.net/entry">HTML link</a>
<https://micro.example.org/note>
\`https://ignored.example/code\`
!yt(https://youtube.com/watch?v=demo)
Bare URL: https://plain.example/post.
`,
    { siteUrl: "https://mysite.example" }
  );

  assert.deepEqual(targets, [
    "https://blog.example.net/entry",
    "https://example.com/post?x=1&y=2",
    "https://micro.example.org/note",
    "https://plain.example/post"
  ]);
});

test("normalizes target urls and skips unsupported or local links", () => {
  const excludeHosts = new Set(["mysite.example"]);

  assert.equal(normalizeTargetUrl("https://user:pass@example.com/path", { excludeHosts }), "https://example.com/path");
  assert.equal(normalizeTargetUrl("mailto:test@example.com", { excludeHosts }), "");
  assert.equal(normalizeTargetUrl("/local/path", { excludeHosts }), "");
  assert.equal(normalizeTargetUrl("https://www.mysite.example/local", { excludeHosts }), "");
});

test("discovers Webmention endpoints from Link headers", () => {
  const endpoint = getEndpointFromLinkHeader(
    '<https://example.com/feed>; rel="alternate", </webmention>; rel="webmention"',
    "https://example.com/post"
  );

  assert.equal(endpoint, "https://example.com/webmention");
});

test("discovers Webmention endpoints from HTML", () => {
  const endpoint = getEndpointFromHtml(
    '<html><head><link href="/mentions" rel="canonical webmention"></head></html>',
    "https://example.com/post"
  );

  assert.equal(endpoint, "https://example.com/mentions");
});

test("fetches target page while discovering Webmention endpoint", async () => {
  const endpoint = await discoverWebmentionEndpoint("https://example.com/post#comment", {
    fetch: async (url) => {
      assert.equal(url, "https://example.com/post");
      return {
        ok: true,
        url,
        headers: headers({ "content-type": "text/html" }),
        text: async () => '<a rel="webmention" href="https://example.com/webmention">webmention</a>'
      };
    }
  });

  assert.equal(endpoint, "https://example.com/webmention");
});

test("only exposes targets linked from a deployed h-entry e-content", async () => {
  const source = "https://mysite.example/post/";
  const targets = await getPublishedMf2Targets(source, {
    fetch: async (url) => ({
      ok: true,
      url,
      headers: headers({ "content-type": "text/html" }),
      text: async () => `
        <a href="https://outside.example/ignored">Outside the entry</a>
        <article class="h-entry">
          <h1 class="p-name">Post</h1>
          <div class="e-content">
            <a href="https://example.com/mentioned">Mentioned</a>
          </div>
        </article>
      `
    })
  });

  assert.deepEqual([...targets], ["https://example.com/mentioned"]);
});

test("waits when the deployed source has no mf2 entry yet", async () => {
  const targets = await getPublishedMf2Targets("https://mysite.example/post/", {
    fetch: async (url) => ({
      ok: true,
      url,
      headers: headers({ "content-type": "text/html" }),
      text: async () => '<main><a href="https://example.com/mentioned">Mentioned</a></main>'
    })
  });

  assert.deepEqual([...targets], []);
});

test("posts source and target to the Webmention endpoint", async () => {
  const result = await sendWebmention("https://example.com/webmention", "https://mysite.example/post/", "https://example.com/post", {
    fetch: async (url, options) => {
      assert.equal(url, "https://example.com/webmention");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
      assert.equal(options.body, "source=https%3A%2F%2Fmysite.example%2Fpost%2F&target=https%3A%2F%2Fexample.com%2Fpost");
      return {
        ok: true,
        status: 202,
        text: async () => ""
      };
    }
  });

  assert.deepEqual(result, { status: 202 });
});

test("exposes rejected Webmention responses as typed HTTP errors", async () => {
  await assert.rejects(
    sendWebmention("https://example.com/webmention", "https://mysite.example/post/", "https://example.com/post", {
      fetch: async () => ({
        ok: false,
        status: 400,
        text: async () => "invalid source"
      })
    }),
    (error) => {
      assert.ok(error instanceof WebmentionHttpError);
      assert.equal(error.status, 400);
      assert.match(error.message, /invalid source/);
      return true;
    }
  );
});

test("turns a permanent Webmention rejection into terminal state", async () => {
  const timestamp = new Date("2026-07-22T12:00:00.000Z");
  const state = await processWebmentionTarget(
    "https://mysite.example/post/",
    "https://example.com/post",
    {},
    {
      discover: async () => "https://example.com/webmention",
      submit: async () => {
        throw new WebmentionHttpError(400, "invalid source");
      },
      now: () => timestamp
    }
  );

  assert.deepEqual(state, {
    status: "rejected",
    endpoint: "https://example.com/webmention",
    httpStatus: 400,
    rejectedAt: timestamp.toISOString()
  });
});
