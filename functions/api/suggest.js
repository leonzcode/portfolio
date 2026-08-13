// Cloudflare Pages Function: POST /api/suggest
//
// Receives a game suggestion from the form above the Games grid, validates it,
// drops bots that fall into the honeypot, then emails it to Leon via Resend.
//
// Reuses the same environment variables as the contact form, so no extra
// configuration is needed (Cloudflare Pages dashboard → Settings → Environment
// variables):
//
//   RESEND_API_KEY      — API key from https://resend.com/api-keys
//   CONTACT_TO_EMAIL    — destination address (Leon's inbox)
//
// Optional:
//
//   CONTACT_FROM_EMAIL  — sender shown to Leon. Must be on a verified domain in
//                         Resend. Defaults to "contact@leonzhao.dev".

const MAX_EMAIL = 200;
const MAX_MESSAGE = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  // Honeypot: a real human won't see or fill this field. If it's non-empty, we
  // silently pretend success so bots don't learn what tripped them up.
  if (typeof body?.website === "string" && body.website.trim().length > 0) {
    return json({ ok: true });
  }

  const message = (body?.message ?? "").toString().trim();
  const email = (body?.email ?? "").toString().trim();

  if (!message) {
    return json({ error: "Write a game suggestion first." }, 400);
  }
  if (message.length > MAX_MESSAGE) {
    return json({ error: "That's a bit long (max 2000 characters)." }, 400);
  }
  // Email is optional — only validate it when someone actually gives one.
  if (email) {
    if (email.length > MAX_EMAIL) return json({ error: "Email is too long." }, 400);
    if (!EMAIL_RE.test(email)) {
      return json({ error: "That doesn't look like a valid email address." }, 400);
    }
  }

  if (!env.RESEND_API_KEY || !env.CONTACT_TO_EMAIL) {
    console.error(
      "suggest.js: missing env vars. RESEND_API_KEY set?",
      Boolean(env.RESEND_API_KEY),
      "CONTACT_TO_EMAIL set?",
      Boolean(env.CONTACT_TO_EMAIL),
    );
    return json({ error: "Server misconfigured. Please try again later." }, 500);
  }

  const fromAddress = env.CONTACT_FROM_EMAIL ?? "contact@leonzhao.dev";

  const payload = {
    from: `Game Suggestions <${fromAddress}>`,
    to: [env.CONTACT_TO_EMAIL],
    subject: "New game suggestion",
    text: [
      email ? `From: ${email}` : "From: (no email given)",
      "",
      message,
      "",
      "-- Sent from the game suggestion box on leonzhao.dev",
    ].join("\n"),
  };
  // Let Leon reply straight to the suggester when they left an address.
  if (email) payload.reply_to = email;

  let resendResponse;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("suggest.js: fetch to Resend threw:", e);
    return json({ error: "Couldn't reach the email service. Try again?" }, 502);
  }

  if (!resendResponse.ok) {
    const detail = await resendResponse.text().catch(() => "<no body>");
    console.error("suggest.js: Resend returned non-2xx:", resendResponse.status, detail);
    return json({ error: "Couldn't send the suggestion. Try again later?" }, 502);
  }

  return json({ ok: true });
}

// Anything other than POST gets a clean 405 instead of a confusing default.
export function onRequest({ request }) {
  if (request.method === "POST") return; // delegated to onRequestPost
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
