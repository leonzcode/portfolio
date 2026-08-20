// Cloudflare Pages Function: POST /api/suggest
//
// Receives a feature suggestion from the Leoncraft game menu (public/legacy/minecraft.html),
// validates it, drops bots via a honeypot, then emails it to Leon via Resend's REST API.
// Reuses the same env vars as the contact form.
//
//   RESEND_API_KEY      — API key from https://resend.com/api-keys
//   CONTACT_TO_EMAIL    — destination address (Leon's inbox)
//   CONTACT_FROM_EMAIL  — optional sender on a Resend-verified domain (defaults to contact@leonzhao.dev)

const MAX_NAME = 60;
const MAX_MESSAGE = 1000;

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

  // Honeypot: a real player never sees or fills this. If it's set, fake success.
  if (typeof body?.website === "string" && body.website.trim().length > 0) {
    return json({ ok: true });
  }

  const name = (body?.name ?? "").toString().trim().slice(0, MAX_NAME) || "Anonymous";
  const message = (body?.message ?? "").toString().trim();
  const emailRaw = (body?.email ?? "").toString().trim().slice(0, 120);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : "";   // optional; only kept if it's a valid address

  if (!message) return json({ error: "Type a suggestion first." }, 400);
  if (message.length > MAX_MESSAGE) {
    return json({ error: "Suggestion is too long (max 1000 characters)." }, 400);
  }
  if (emailRaw && !email) {
    return json({ error: "That email doesn't look valid — fix it or leave it blank." }, 400);
  }

  if (!env.RESEND_API_KEY || !env.CONTACT_TO_EMAIL) {
    console.error("suggest.js: missing env vars. RESEND_API_KEY set?", Boolean(env.RESEND_API_KEY), "CONTACT_TO_EMAIL set?", Boolean(env.CONTACT_TO_EMAIL));
    return json({ error: "Server misconfigured. Please try again later." }, 500);
  }

  const fromAddress = env.CONTACT_FROM_EMAIL ?? "contact@leonzhao.dev";

  let resendResponse;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Leoncraft Suggestions <${fromAddress}>`,
        to: [env.CONTACT_TO_EMAIL],
        ...(email ? { reply_to: email } : {}),   // reply straight to the suggester when they left an address
        subject: `Leoncraft suggestion from ${name}`,
        text: [
          `From: ${name}`,
          email ? `Notify: ${email}  (wants an update when it's added)` : `Notify: (no email given)`,
          "",
          message,
          "",
          "-- Sent from the Leoncraft in-game suggestion box on leonzhao.dev",
        ].join("\n"),
      }),
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

// Anything other than POST gets a clean 405.
export function onRequest({ request }) {
  if (request.method === "POST") return; // delegated to onRequestPost
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
