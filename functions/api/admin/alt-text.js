import { jsonResponse, readSession } from "../../_admin-auth.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CONTEXT_LENGTH = 2500;
const OPENAI_TIMEOUT_MS = 25_000;

export async function onRequestPost(context) {
  return handleAltTextRequest(context);
}

export async function handleAltTextRequest(context, dependencies = {}) {
  const readSessionFn = dependencies.readSession || readSession;
  const fetchFn = dependencies.fetch || fetch;
  const upstreamTimeoutMs = dependencies.upstreamTimeoutMs || OPENAI_TIMEOUT_MS;
  const session = await readSessionFn(context.request, context.env);
  if (!session) return jsonResponse({ message: "Nicht angemeldet." }, { status: 401 });
  const origin = context.request.headers.get("Origin");
  if (origin && origin !== new URL(context.request.url).origin) {
    return jsonResponse({ message: "Ungültiger Ursprung." }, { status: 403 });
  }
  if (!context.env.OPENAI_API_KEY) return jsonResponse({ message: "Alt-Text-Dienst ist nicht konfiguriert." }, { status: 503 });

  const length = Number(context.request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) return jsonResponse({ message: "Bild ist zu groß." }, { status: 413 });

  let payload;
  try {
    payload = await readBoundedJson(context.request, MAX_BODY_BYTES);
  } catch (error) {
    if (error?.code === "BODY_TOO_LARGE") {
      return jsonResponse({ message: "Bild ist zu groß." }, { status: 413 });
    }
    return jsonResponse({ message: "Ungültige Anfrage." }, { status: 400 });
  }

  const image = String(payload.image || "");
  if (!isAllowedImage(image) || image.length > MAX_BODY_BYTES) {
    return jsonResponse({ message: "Ungültige Bildquelle." }, { status: 400 });
  }

  const contextText = String(payload.context || "").slice(0, MAX_CONTEXT_LENGTH);
  const source = String(payload.source || "").slice(0, 500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  let response;
  try {
    response = await fetchFn("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${context.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: context.env.OPENAI_ALT_TEXT_MODEL || "gpt-5.5",
        max_output_tokens: 700,
        reasoning: { effort: "none" },
        input: [
          {
            role: "developer",
            content: [{
              type: "input_text",
              text: "Du erstellst präzise, barrierefreie Alt-Texte für einen persönlichen Blog. Schreibe in derselben Sprache wie der Artikel. Beschreibe hauptsächlich das Sichtbare, erfinde nichts und identifiziere keine Personen. Antworte in ein oder zwei kurzen Sätzen, ohne Anführungszeichen und ohne Markdown."
            }]
          },
          {
            role: "user",
            content: [
              { type: "input_image", image_url: image, detail: "low" },
              { type: "input_text", text: ["Erstelle den Alt-Text.", contextText, source].filter(Boolean).join("\n") }
            ]
          }
        ]
      })
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return jsonResponse({ message: "Der Alt-Text-Dienst hat nicht rechtzeitig geantwortet." }, { status: 504 });
    }
    console.error("[admin-alt-text] OpenAI request failed", error);
    return jsonResponse({ message: "Alt-Text konnte nicht erzeugt werden." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[admin-alt-text] OpenAI request failed", response.status);
    return jsonResponse({ message: "Alt-Text konnte nicht erzeugt werden." }, { status: 502 });
  }

  const alt = cleanAltText(extractText(data));
  if (!alt) return jsonResponse({ message: "Der Alt-Text-Dienst lieferte keine Beschreibung." }, { status: 502 });
  return jsonResponse({ alt });
}

export async function readBoundedJson(request, maximumBytes = MAX_BODY_BYTES) {
  if (!request.body?.getReader) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) throw bodyTooLargeError();
    return JSON.parse(text);
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel("Request body exceeds limit.");
        throw bodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function bodyTooLargeError() {
  return Object.assign(new Error("Request body exceeds limit."), { code: "BODY_TOO_LARGE" });
}

export function isAllowedImage(value = "") {
  if (/^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(value)) return true;
  try {
    const url = new URL(value);
    // media.mysite.example is the R2 delivery domain (deliveryHost in scripts/lib/r2-media.js).
    // Since DB-1129 a saved image is referenced from there, so without it every alt text for
    // an already-committed image is rejected as an invalid source.
    return url.protocol === "https:"
      && ["raw.githubusercontent.com", "mysite.example", "media.mysite.example"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function extractText(data = {}) {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output || []).flatMap((item) => item.content || []).map((item) => item.text || "").join(" ");
}

export function cleanAltText(value = "") {
  return String(value).replace(/\s+/g, " ").trim().replace(/^["'“”„]+|["'“”„]+$/g, "").trim().slice(0, 500);
}
