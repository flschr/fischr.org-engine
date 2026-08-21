const { test, expect } = require("@playwright/test");

test("footnote references stay with the preceding word", async ({ page }) => {
  await page.goto("/");

  const positions = await page.evaluate(() => {
    const paragraph = document.createElement("p");
    paragraph.className = "post-content";
    paragraph.innerHTML = 'Einleitung Bezugswort<sup class="footnote-ref"><a href="#">1</a></sup>';
    document.body.append(paragraph);
    const reference = paragraph.querySelector(".footnote-ref");
    const precedingWord = document.createRange();
    precedingWord.setStart(paragraph.firstChild, "Einleitung ".length);
    precedingWord.setEnd(paragraph.firstChild, paragraph.firstChild.length);
    const inlineOffset = reference.getBoundingClientRect().top - precedingWord.getBoundingClientRect().top;

    paragraph.style.width = `${Math.ceil(precedingWord.getBoundingClientRect().width + reference.getBoundingClientRect().width + 4)}px`;

    return {
      inlineOffset,
      constrainedOffset: reference.getBoundingClientRect().top - precedingWord.getBoundingClientRect().top,
    };
  });

  expect(positions.constrainedOffset).toBeCloseTo(positions.inlineOffset, 0);
});
