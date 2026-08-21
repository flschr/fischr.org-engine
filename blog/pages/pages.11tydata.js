module.exports = {
  layout: "layouts/page.njk",
  eleventyComputed: {
    permalink(data) {
      if (data.draft) return false;

      if (data.permalink) return data.permalink;
      return `/${data.page.fileSlug}/`;
    }
  }
};
