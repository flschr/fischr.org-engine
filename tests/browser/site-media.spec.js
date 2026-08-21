const { test, expect } = require("@playwright/test");

test("article media reaches narrow edges without overflowing at intermediate widths", async ({ page }) => {
  await page.goto("/menschen-die-ins-licht-starren/");

  for (const width of [390, 672, 700, 900, 901, 1000, 1100]) {
    await page.setViewportSize({ width, height: 800 });

    const measurements = await page.evaluate(() => {
      const media = document.querySelector(".post-content img");
      const bounds = media.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        mediaLeft: bounds.left,
        mediaRight: bounds.right,
        mediaRadius: getComputedStyle(media).borderRadius,
      };
    });

    expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewportWidth);
    expect(measurements.mediaLeft).toBeGreaterThanOrEqual(-0.5);
    expect(measurements.mediaRight).toBeLessThanOrEqual(measurements.viewportWidth + 0.5);
    if (width <= 672) {
      expect(measurements.mediaLeft).toBeLessThanOrEqual(0.5);
      expect(measurements.mediaRadius).toBe("0px");
    } else {
      expect(measurements.mediaLeft).toBeGreaterThanOrEqual(15);
      expect(measurements.mediaRadius).not.toBe("0px");
    }
  }
});
