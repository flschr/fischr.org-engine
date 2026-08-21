function sitemapLastModified(item) {
  if (item?.data?.updated) return item.data.updated;
  if (item?.data?.layout === "layouts/post.njk") return item.date || null;
  return null;
}

module.exports = { sitemapLastModified };
