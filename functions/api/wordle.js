// Cloudflare Pages Function: GET /api/wordle?date=YYYY-MM-DD
//
// Fetches the New York Times Wordle puzzle for a given date SERVER-SIDE and
// returns it as JSON. The NYT endpoint sends no CORS headers, so a browser
// can't read it directly — but a server-to-server fetch works fine. This lets
// the Wordle solver (public/apps/wordle/index.html) get today's answer from
// its own origin instead of depending on flaky third-party CORS proxies.
//
// Response shape mirrors the relevant NYT fields so the client can parse this
// and the raw NYT JSON (via fallback proxies) with the same code:
//   { solution: "acute", days_since_launch: 1833, print_date: "2026-06-26" }
//
// No environment variables required.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Same-origin in practice, but allow embedding/reuse and let the edge
      // cache today's puzzle so repeat visitors don't re-hit NYT.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=600",
    },
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  let date = (url.searchParams.get("date") || "").trim();

  // Validate strictly: the date is the only thing interpolated into the
  // upstream URL, so reject anything that isn't a plain YYYY-MM-DD. Falling
  // back to the edge's UTC date keeps the endpoint useful if the client
  // somehow omits the param.
  if (!DATE_RE.test(date)) {
    date = new Date().toISOString().slice(0, 10);
  }

  const nytUrl = `https://www.nytimes.com/svc/wordle/v2/${date}.json`;

  let res;
  try {
    res = await fetch(nytUrl, {
      headers: { Accept: "application/json" },
      // Cache the upstream response at Cloudflare's edge for 10 minutes.
      cf: { cacheTtl: 600, cacheEverything: true },
    });
  } catch (e) {
    console.error("wordle.js: fetch to NYT threw:", e);
    return json({ error: "Couldn't reach the puzzle service." }, 502);
  }

  if (!res.ok) {
    // 404 here usually means the requested date isn't published yet.
    return json({ error: `Upstream returned ${res.status}.` }, 502);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return json({ error: "Puzzle service returned an unexpected response." }, 502);
  }

  const solution = String(data?.solution ?? "").toLowerCase();
  if (!/^[a-z]{5}$/.test(solution)) {
    return json({ error: "Puzzle service returned no solution." }, 502);
  }

  return json({
    solution,
    days_since_launch: data.days_since_launch,
    print_date: data.print_date,
  });
}

// Anything other than GET gets a clean 405 instead of a confusing default.
export function onRequest({ request }) {
  if (request.method === "GET") return; // delegated to onRequestGet
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
}
