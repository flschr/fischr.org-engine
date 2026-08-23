const { test, expect } = require("@playwright/test");

test("German blog homepage introduces the author and latest posts", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator(".author-card h1")).toContainText("Herzlich willkommen");
  await expect(page.locator(".post-stream .stream-entry").first()).toBeVisible();
});

test("all public page types share one responsive page grid", async ({ page }) => {
  const pages = [
    ["/", [".author-card", ".post-stream"]],
    ["/heimaturlaub/", [".h-entry", ".post-header", ".post-content", ".post-footer"]],
    ["/about/", [".about-page", ".about-hero", ".about-content", ".about-separator", ".about-site-notes"]],
    ["/projekte/", [".projects-page", ".author-card", ".project-list", ".projects-more"]],
    ["/archive/", [".post-content"]],
    ["/page/2/", [".post-stream"]],
    ["/404.html", []],
  ];
  for (const [path, selectors] of pages) {
    await page.goto(path);
    for (const width of [390, 700, 900, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate((pageSelectors) => {
        const header = document.querySelector(".site-header").getBoundingClientRect();
        const main = document.querySelector(".site-main").getBoundingClientRect();
        const footer = document.querySelector(".site-footer")?.getBoundingClientRect();
        const regions = pageSelectors.map((selector) => {
          const bounds = document.querySelector(selector).getBoundingClientRect();
          return { selector, left: bounds.left, width: bounds.width };
        });
        return {
          header: { left: header.left, width: header.width },
          main: { left: main.left, width: main.width },
          footer: footer ? { left: footer.left, width: footer.width } : null,
          regions,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        };
      }, selectors);
      expect(layout.header.left).toBeCloseTo(layout.main.left, 0);
      expect(layout.header.width).toBeCloseTo(layout.main.width, 0);
      if (layout.footer) {
        expect(layout.footer.left).toBeCloseTo(layout.main.left, 0);
        expect(layout.footer.width).toBeCloseTo(layout.main.width, 0);
      }
      for (const region of layout.regions) {
        expect(region.left, region.selector).toBeCloseTo(layout.main.left, 0);
        expect(region.width, region.selector).toBeCloseTo(layout.main.width, 0);
      }
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    }
  }
});

test("post separators keep the same distance after text and media", async ({ page }) => {
  await page.goto("/");

  const gaps = await page.evaluate(() => {
    const entries = [...document.querySelectorAll(".stream-entry")];
    const entryNamed = (title) => entries.find((entry) => entry.querySelector("h2")?.textContent.includes(title));
    const gapAfter = (entry) => {
      const lastContent = entry.querySelector(".post-content > :last-child");
      const visualEnd = lastContent.matches("p") && lastContent.querySelector(":scope > img:only-child")
        ? lastContent.querySelector(":scope > img:only-child")
        : lastContent;
      const nextEntry = entry.nextElementSibling;
      return nextEntry.getBoundingClientRect().top - visualEnd.getBoundingClientRect().bottom;
    };

    return {
      text: gapAfter(entryNamed("Americana")),
      media: gapAfter(entryNamed("Badehosen im Fahrtwind")),
    };
  });

  expect(gaps.text).toBeCloseTo(gaps.media, 1);
});

test("homepage exposes the primary navigation accessibly", async ({ page }) => {
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(navigation.getByRole("link", { name: "Über", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Projekte", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Archiv durchsuchen" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Mastodon" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Bluesky" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "RSS-Feed" })).toBeVisible();
});

test("navigation hover does not move links or change their opacity", async ({ page }) => {
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Hauptnavigation" });
  for (const name of ["Über", "Projekte", "Archiv durchsuchen"]) {
    const link = navigation.getByRole("link", { name, exact: true });
    const before = await link.boundingBox();
    await link.hover();
    const after = await link.boundingBox();

    expect(after).toEqual(before);
    await expect(link).toHaveCSS("opacity", "1");
    await expect(link).toHaveCSS("text-decoration-thickness", "2px");
  }
});

test("header icons reveal their service colors on hover", async ({ page }) => {
  await page.goto("/");

  const colors = [
    ["Archiv durchsuchen", "rgba(0, 0, 0, 0.62)"],
    ["Mastodon", "rgb(99, 100, 255)"],
    ["Bluesky", "rgb(17, 133, 254)"],
    ["RSS-Feed", "rgb(242, 101, 34)"],
  ];

  for (const [name, color] of colors) {
    const link = page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name });
    await link.hover();
    await expect(link).toHaveCSS("color", color);
    await expect(link).toHaveCSS("opacity", "1");
  }
});

test("mobile homepage keeps its primary navigation available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Über", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Projekte", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Archiv durchsuchen" })).toBeVisible();
});

test("narrow author cards wrap around the portrait and leave social links to the about page", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  await expect(page.locator(".author-card-photo")).toHaveCSS("float", "left");
  await expect(page.locator(".author-card-connect")).toHaveCount(0);

  await page.goto("/about/");
  await expect(page.locator(".about-hero a")).toHaveCount(0);
});

test("about page keeps its profiles as text links next to the mail address", async ({ page }) => {
  await page.goto("/about/");

  const contact = page.locator(".about-site-notes p").last();
  await expect(contact).toContainText("Alternativ findest du mich auch bei");

  const profiles = [
    ["Mastodon", "https://mysite.example/@example"],
    ["Bluesky", "https://bsky.app/profile/mysite.example"],
    ["GitHub", "https://github.com/example"],
    ["LinkedIn", "https://www.linkedin.com/in/fischr/"],
    ["YouTube", "https://www.youtube.com/@flschr"],
    ["OpenStreetMap", "https://www.openstreetmap.org/user/fischr"],
  ];

  await expect(contact.getByRole("link")).toHaveCount(profiles.length);
  for (const [name, href] of profiles) {
    const link = contact.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("rel", "me");
  }
});

test("archive search loads Pagefind under the production security policy", async ({ page }) => {
  await page.route("**/pagefind/pagefind-worker.js", (route) => route.abort());
  await page.goto("/archive/?q=Kaiserschmarrn");

  const results = page.locator("#search-results");
  await expect(results.getByRole("link", { name: "Kaiserschmarrn", exact: true })).toBeVisible();
  await expect(page.locator("#search-status")).not.toHaveText("Die Suche konnte gerade nicht geladen werden.");
});

test("archive search uses the full content width", async ({ page }) => {
  await page.goto("/archive/");

  for (const width of [390, 673, 820, 1000]) {
    await page.setViewportSize({ width, height: 800 });

    const measurements = await page.evaluate(() => {
      const body = document.body.getBoundingClientRect();
      const row = document.querySelector(".search-input-row").getBoundingClientRect();
      const input = document.querySelector(".search-input").getBoundingClientRect();
      const button = document.querySelector(".search-button").getBoundingClientRect();
      const paddingRight = Number.parseFloat(getComputedStyle(document.body).paddingRight);
      return {
        expectedRight: body.right - paddingRight,
        rowRight: row.right,
        rowWidth: row.width,
        buttonWidth: button.width,
        inputTop: input.top,
        buttonTop: button.top,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });

    expect(measurements.rowRight).toBeCloseTo(measurements.expectedRight, 0);
    expect(measurements.buttonWidth).toBeLessThan(measurements.rowWidth / 2);
    expect(measurements.buttonTop).toBeCloseTo(measurements.inputTop, 0);
    expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewportWidth);
  }
});
