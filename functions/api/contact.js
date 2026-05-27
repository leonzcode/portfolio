// Cloudflare Pages Function: POST /api/contact
//
// Receives the JSON body from contact.astro's form, validates it, drops bots
// that fall into the honeypot, then sends the message via Resend's REST API.
//
// Required environment variables (configure in Cloudflare Pages dashboard →
// Settings → Environment variables, then redeploy):
//
//   RESEND_API_KEY      — API key from https://resend.com/api-keys
//   CONTACT_TO_EMAIL    — destination address (Leon's inbox)
//
// Optional:
//
//   CONTACT_FROM_EMAIL  — sender shown to Leon. Must be on a verified domain
//                         in Resend. Defaults to "contact@leonzhao.dev".

const MAX_NAME = 100;
const MAX_EMAIL = 200;
const MAX_MESSAGE = 5000;
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

  // Honeypot: a real human won't see or fill this field. If it's non-empty,
  // we silently pretend success so bots don't learn what tripped them up.
  if (typeof body?.website === "string" && body.website.trim().length > 0) {
    return json({ ok: true });
  }

  const name = (body?.name ?? "").toString().trim();
  const email = (body?.email ?? "").toString().trim();
  const message = (body?.message ?? "").toString().trim();

  if (!name || !email || !message) {
    return json({ error: "Please fill in name, email, and message." }, 400);
  }
  if (name.length > MAX_NAME) return json({ error: "Name is too long." }, 400);
  if (email.length > MAX_EMAIL) return json({ error: "Email is too long." }, 400);
  if (message.length > MAX_MESSAGE) {
    return json({ error: "Message is too long (max 5000 characters)." }, 400);
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: "That doesn't look like a valid email address." }, 400);
  }

  if (!env.RESEND_API_KEY || !env.CONTACT_TO_EMAIL) {
    // Configuration error — don't leak which one to the client.
    console.error(
      "contact.js: missing env vars. RESEND_API_KEY set?",
      Boolean(env.RESEND_API_KEY),
      "CONTACT_TO_EMAIL set?",
      Boolean(env.CONTACT_TO_EMAIL),
    );
    return json({ error: "Server misconfigured. Please try again later." }, 500);
  }

  const fromAddress = env.CONTACT_FROM_EMAIL ?? "contact@leonzhao.dev";

  // Send via Resend. https://resend.com/docs/api-reference/emails/send-email
  let resendResponse;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Portfolio Contact <${fromAddress}>`,
        to: [env.CONTACT_TO_EMAIL],
        reply_to: email,
        subject: `Portfolio contact from ${name}`,
        text: [
          `From: ${name} <${email}>`,
          "",
          message,
          "",
          "-- Sent from the contact form on leonzhao.dev",
        ].join("\n"),
      }),
    });
  } catch (e) {
    console.error("contact.js: fetch to Resend threw:", e);
    return json({ error: "Couldn't reach the email service. Try again?" }, 502);
  }

  if (!resendResponse.ok) {
    const detail = await resendResponse.text().catch(() => "<no body>");
    console.error(
      "contact.js: Resend returned non-2xx:",
      resendResponse.status,
      detail,
    );
    return json({ error: "Couldn't send the message. Try again later?" }, 502);
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
