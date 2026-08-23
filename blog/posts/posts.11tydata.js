const { postDisplayDate } = require("../../lib/eleventy/dates");

module.exports = {
  layout: "layouts/post.njk",
  tags: ["posts"],
  eleventyComputed: {
    // The calendar date the post is shown under. Read off the file name, which
    // is the only value that agrees with the intended date across the whole
    // archive — see lib/eleventy/dates.js. page.date stays the instant.
    displayDate(data) {
      return postDisplayDate(data.page?.inputPath, data.page?.date);
    },

    permalink(data) {
      if (data.draft) return false;

      // Scheduled posts: in production a future-dated post gets no page at all —
      // a real embargo (404 until its time), matching the date gating applied to
      // the listings and feeds in .eleventy.js. The page appears when a build
      // runs at or after its date (scheduled-publish.yml triggers that build).
      // Dev and preview builds keep future posts visible so they can be checked.
      if (process.env.ELEVENTY_ENV === "production"
          && data.page?.date && data.page.date > new Date()) {
        return false;
      }

      const slug = data.slug || data.page.fileSlug.replace(/^\d{4}-\d{2}-\d{2}-/, "");
      return `/${slug}/`;
    }
  }
};
