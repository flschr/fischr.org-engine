(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWContentService = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function create({ editableFrontmatterKeys, localIsoWithOffset, slugify }) {
  function decodeYamlDoubleQuoted(text) {
    return String(text)
      .replace(/\\U([0-9A-Fa-f]{8})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  function stripQuotes(value) {
    const text = String(value || "").trim();
    if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
      return text.slice(1, -1).replace(/''/g, "'");
    }
    if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
      return decodeYamlDoubleQuoted(text.slice(1, -1));
    }
    return text;
  }

  function parseScalar(value) {
    const text = stripQuotes(value);
    if (text === "true") return true;
    if (text === "false") return false;
    if (text === "null") return "";
    return text;
  }

  // Read a one-level `schema:` frontmatter block into a flat object of its
  // scalar key/value pairs (type, itemType, itemName, rating, …). Nested
  // arrays/objects (e.g. a hand-authored recipeIngredient list) are ignored
  // here but preserved verbatim via the raw block when the post is unchanged.
  function parseSchemaObject(block) {
    const obj = {};
    block.slice(1).forEach((line) => {
      const m = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
      if (m && m[2] !== "") obj[m[1]] = parseScalar(m[2]);
    });
    return obj;
  }

  function writeSchemaBlock(schema) {
    const lines = ["schema:"];
    Object.entries(schema).forEach(([key, value]) => {
      if (value === "" || value === null || value === undefined) return;
      const out = typeof value === "number" ? String(value) : yamlString(value, true);
      lines.push(`  ${key}: ${out}`);
    });
    return lines.join("\n");
  }

  // Read a YAML literal/folded block scalar (`key: |-` …) back into a plain
  // multi-line string. The first line is the `key:` indicator; the rest is the
  // indented body, which we dedent by the smallest leading indent.
  function parseBlockScalar(block) {
    const body = block.slice(1);
    while (body.length && body[body.length - 1].trim() === "") body.pop();
    const indent = body.reduce((min, line) => {
      if (!line.trim()) return min;
      return Math.min(min, line.match(/^\s*/)[0].length);
    }, Infinity);
    const pad = Number.isFinite(indent) ? indent : 0;
    return body.map((line) => line.slice(pad)).join("\n").replace(/\n+$/, "");
  }

  // Emit a frontmatter value, using a literal block scalar when the text spans
  // multiple lines so the line breaks survive the round-trip (single-quoted YAML
  // would fold them into spaces).
  function yamlScalarOrBlock(key, value) {
    const text = String(value || "");
    if (text.includes("\n")) {
      const indented = text.split("\n").map((line) => (line ? `  ${line}` : "")).join("\n");
      return `${key}: |-\n${indented}`;
    }
    return `${key}: ${yamlString(text, true)}`;
  }

  function parseTags(block) {
    const [, firstLineValue = ""] = block[0].split(/:(.*)/s);
    const inline = firstLineValue.trim();
    if (inline.startsWith("[") && inline.endsWith("]")) {
      return inline.slice(1, -1).split(",").map(stripQuotes).map((tag) => tag.trim()).filter(Boolean);
    }
    return block
      .slice(1)
      .map((line) => line.match(/^\s*-\s*(.+?)\s*$/))
      .filter(Boolean)
      .map((match) => stripQuotes(match[1]))
      .filter(Boolean);
  }

  function parseFrontmatter(frontmatter) {
    const lines = String(frontmatter || "").split(/\r?\n/);
    const fields = {};
    const fieldBlocks = {};
    const preserved = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      const match = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
      if (!match) {
        if (line.trim()) preserved.push(line);
        index += 1;
        continue;
      }
      const key = match[1];
      const block = [line];
      index += 1;
      while (index < lines.length && (/^\s/.test(lines[index]) || lines[index].trim() === "")) {
        block.push(lines[index]);
        index += 1;
      }
      if (editableFrontmatterKeys.has(key)) {
        fieldBlocks[key] = block.join("\n");
        const inline = (match[2] || "").trim();
        if (key === "social_images") fields[key] = parseTags(block);
        else if (key === "schema") fields[key] = parseSchemaObject(block);
        else if (/^[|>][-+]?\d*$/.test(inline)) fields[key] = parseBlockScalar(block);
        else fields[key] = parseScalar(match[2] || "");
      } else {
        preserved.push(block.join("\n"));
      }
    }
    return { fields, fieldBlocks, preserved };
  }

  function splitDocument(content) {
    const match = String(content || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { fields: {}, fieldBlocks: {}, preserved: [], body: String(content || "") };
    const parsed = parseFrontmatter(match[1]);
    return { fields: parsed.fields, fieldBlocks: parsed.fieldBlocks, preserved: parsed.preserved, body: String(content || "").slice(match[0].length) };
  }

  function yamlString(value, forceQuoted) {
    const text = String(value || "");
    if (!text) return "''";
    if (!forceQuoted && /^[A-Za-z0-9_./:+-]+$/.test(text)) return text;
    return `'${text.replace(/'/g, "''")}'`;
  }

  function writeFrontmatter(fields, preserved, collection) {
    const lines = ["---"];
    const raw = fields.__rawFrontmatter || {};
    lines.push(`title: ${yamlString(fields.title, true)}`);
    if (collection === "posts") {
      if (raw.slug) lines.push(raw.slug);
      else if (fields.slug) lines.push(`slug: ${yamlString(fields.slug)}`);

      if (raw.date) lines.push(raw.date);
      else lines.push(`date: ${yamlString(fields.date || localIsoWithOffset())}`);

      if (raw.social_image) lines.push(raw.social_image);
      else if (fields.social_image) lines.push(`social_image: ${yamlString(fields.social_image)}`);

      // Per-post social overrides — only written when they diverge from the
      // category defaults, so a plain post's frontmatter stays clean.
      if (raw.social_template) lines.push(raw.social_template);
      else if (fields.social_template) lines.push(`social_template: ${yamlString(fields.social_template)}`);

      if (raw.social_text) lines.push(raw.social_text);
      else if (fields.social_text) lines.push(yamlScalarOrBlock("social_text", fields.social_text));

      // Per-post image selection: a list of paths, `[]` for "no image", or
      // omitted entirely for "use the category default".
      if (Array.isArray(fields.social_images)) {
        if (fields.social_images.length) {
          lines.push("social_images:");
          fields.social_images.forEach((src) => lines.push(`  - ${yamlString(src)}`));
        } else {
          lines.push("social_images: []");
        }
      }

      if (fields.syndicate === false) lines.push("syndicate: false");

      // Structured-data type (recipe/review). Reuse the original block when
      // unchanged so a hand-authored schema (incl. nested arrays) round-trips.
      if (raw.schema) lines.push(raw.schema);
      else if (fields.schema && Object.keys(fields.schema).length) lines.push(writeSchemaBlock(fields.schema));
    } else {
      if (raw.permalink) lines.push(raw.permalink);
      else lines.push(`permalink: ${yamlString(fields.permalink || `/${slugify(fields.title)}/`)}`);
    }
    if (fields.description) lines.push(`description: ${yamlString(fields.description, true)}`);
    lines.push(`lang: ${yamlString(fields.lang || "de")}`);
    lines.push(`draft: ${fields.draft ? "true" : "false"}`);
    if (collection === "pages" && fields.pagefind !== undefined && fields.pagefind !== "") {
      lines.push(`pagefind: ${fields.pagefind ? "true" : "false"}`);
    }
    preserved.filter((block) => block && block.trim()).forEach((block) => lines.push(block));
    lines.push("---", "");
    return lines.join("\n");
  }

  function normalizeBody(body) {
    const text = String(body || "").replace(/\r\n/g, "\n").trimEnd();
    return text ? `${text}\n` : "";
  }

  function buildDocument(fields, preserved, body, collection) {
    return `${writeFrontmatter(fields, preserved, collection)}${normalizeBody(body)}`;
  }

  // --- Markdown helpers ----------------------------------------------------


    return { decodeYamlDoubleQuoted, stripQuotes, parseScalar, parseSchemaObject, writeSchemaBlock, parseBlockScalar, yamlScalarOrBlock, parseTags, parseFrontmatter, splitDocument, yamlString, writeFrontmatter, normalizeBody, buildDocument };
  }

  return { create };
});
