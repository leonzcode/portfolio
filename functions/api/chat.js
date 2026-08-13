// Cloudflare Pages Function: POST /api/chat
//
// Server-side proxy for the ChatGPT demo (public/apps/chatgpt/). The browser
// sends a conversation and this function forwards it to OpenAI with the API key
// attached here, server-side. The key is NEVER shipped to the client and must
// NEVER be committed — it lives only as a Cloudflare Pages environment variable
// (Settings → Environment variables → add as an encrypted "Secret", then
// redeploy):
//
//   OPENAI_API_KEY     — primary key
//   OPENAI_API_KEY_2   — optional 2nd key. Tried automatically when an earlier
//   OPENAI_API_KEY_3   — optional 3rd key. key returns 401/403/429 (invalid,
//   OPENAI_API_KEY_4   — optional 4th key. out of quota, or rate-limited), so it
//                        transparently rolls to the next key "when the other
//                        one runs out".
//   OPENAI_MODEL       — optional model id. Defaults to "gpt-4o-mini".
//
// Responses stream back to the client as Server-Sent Events (OpenAI's own SSE
// format is passed through untouched).

const MAX_MESSAGES = 24; // keep the tail of the conversation only
const MAX_CHARS = 6000; // per message
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const SYSTEM_PROMPT =
  "You are a helpful, concise assistant embedded in Leon Zhao's portfolio site. " +
  "Answer clearly. Use short paragraphs. If you are unsure, say so.";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    const role = m?.role;
    const content = (m?.content ?? "").toString();
    if (role !== "user" && role !== "assistant") continue;
    if (!content.trim()) continue;
    out.push({ role, content: content.slice(0, MAX_CHARS) });
  }
  // must end on a user turn to be a valid request
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

function callOpenAI(key, payload) {
  return fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const messages = sanitizeMessages(body?.messages);
  if (!messages) {
    return json({ error: "Send a non-empty conversation ending with a user message." }, 400);
  }

  // Ordered key chain: each is tried in turn when the previous is rejected for
  // an auth/quota/rate reason. Add as many as you have (env vars below).
  const keys = [
    env.OPENAI_API_KEY,
    env.OPENAI_API_KEY_2,
    env.OPENAI_API_KEY_3,
    env.OPENAI_API_KEY_4,
  ].filter(Boolean);
  if (!keys.length) {
    console.error("chat.js: no OPENAI_API_KEY configured");
    return json({ error: "The chat backend isn't configured yet." }, 503);
  }

  const payload = {
    model: env.OPENAI_MODEL || "gpt-4o-mini",
    stream: true,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
  };

  // Walk the key chain: on an auth/quota/rate rejection, roll to the next key.
  let resp = null;
  for (let i = 0; i < keys.length; i++) {
    try {
      resp = await callOpenAI(keys[i], payload);
    } catch (e) {
      console.error("chat.js: fetch to OpenAI threw:", e);
      if (i === keys.length - 1) {
        return json({ error: "Couldn't reach the model. Try again?" }, 502);
      }
      continue;
    }
    if (resp.ok) break;
    const retryable = resp.status === 401 || resp.status === 403 || resp.status === 429;
    if (retryable && i < keys.length - 1) {
      // discard the failed body and move to the fallback key
      await resp.body?.cancel?.().catch(() => {});
      continue;
    }
    break;
  }

  if (!resp || !resp.ok) {
    const detail = resp ? await resp.text().catch(() => "<no body>") : "<no response>";
    console.error("chat.js: OpenAI returned non-2xx:", resp?.status, detail);
    const status = resp?.status === 429 ? 429 : 502;
    return json(
      { error: status === 429 ? "The model is out of capacity right now. Try again shortly." : "The model returned an error. Try again?" },
      status,
    );
  }

  // Pass OpenAI's SSE stream straight through to the browser.
  return new Response(resp.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export function onRequest({ request }) {
  if (request.method === "POST") return; // delegated to onRequestPost
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
