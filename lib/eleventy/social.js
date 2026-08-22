const { decodeHtmlAttribute, stripHtml } = require("./html");

const defaultSocialImage = "https://media.mysite.example/images/og-default.webp";

function extractFirstImage(content = "") {
  const match = String(content).match(/<img\b[^>]*\bsrc=(["']?)([^"'\s>]+)\1[^>]*>/i);
  if (!match) return "";

  const src = decodeHtmlAttribute(match[2]).trim();
  if (!src || src.startsWith("data:")) return "";

  return src;
}

function extractFirstImageAlt(content = "") {
  const img = String(content).match(/<img\b[^>]*>/i);
  if (!img) return "";

  const alt = img[0].match(/\balt=(["'])(.*?)\1/i);
  return alt ? stripHtml(decodeHtmlAttribute(alt[2])) : "";
}

function resolveSocialImage(image = "", content = "", fallback = defaultSocialImage) {
  return image || extractFirstImage(content) || fallback;
}

function imageMimeType(image = "") {
  const pathname = String(image).split("?")[0].toLowerCase();

  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".svg")) return "image/svg+xml";

  return "";
}

function videoMimeType(video = "") {
  const pathname = String(video).split("?")[0].toLowerCase();

  if (pathname.endsWith(".webm")) return "video/webm";
  if (pathname.endsWith(".mp4") || pathname.endsWith(".m4v")) return "video/mp4";
  if (pathname.endsWith(".mov")) return "video/quicktime";

  return "";
}

module.exports = {
  defaultSocialImage,
  extractFirstImage,
  extractFirstImageAlt,
  imageMimeType,
  resolveSocialImage,
  videoMimeType
};
