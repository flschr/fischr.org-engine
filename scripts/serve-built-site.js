const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../_site");
const port = Number(process.env.PORT || 4173);
const headerRules = parseHeaderRules(fs.readFileSync(path.join(root, "_headers"), "utf8"));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

function parseHeaderRules(source) {
  const rules = [];
  let current;

  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), operations: [] };
      rules.push(current);
      continue;
    }

    if (!current) continue;
    const operation = line.trim();
    if (operation.startsWith("! ")) {
      current.operations.push({ name: operation.slice(2), remove: true });
      continue;
    }

    const separator = operation.indexOf(":");
    if (separator === -1) continue;
    current.operations.push({
      name: operation.slice(0, separator),
      value: operation.slice(separator + 1).trim()
    });
  }

  return rules;
}

function matches(pattern, requestPath) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace("*", ".*");
  return new RegExp(`^${escaped}$`).test(requestPath);
}

function responseHeaders(requestPath, filePath) {
  const headers = new Map();

  for (const rule of headerRules) {
    if (!matches(rule.pattern, requestPath)) continue;
    for (const operation of rule.operations) {
      const key = operation.name.toLowerCase();
      if (operation.remove) {
        headers.delete(key);
      } else {
        headers.set(key, operation.value);
      }
    }
  }

  headers.set("content-type", contentTypes[path.extname(filePath)] || "application/octet-stream");
  return Object.fromEntries(headers);
}

http.createServer((request, response) => {
  const requestPath = new URL(request.url, "http://127.0.0.1").pathname;
  const relativePath = requestPath.endsWith("/") ? `${requestPath}index.html` : requestPath;
  const filePath = path.resolve(root, `.${relativePath}`);

  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
      return;
    }

    response.writeHead(200, responseHeaders(requestPath, filePath));
    response.end(data);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving _site on http://127.0.0.1:${port}`);
});
