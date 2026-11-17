(() => {
  const script = document.currentScript;
  const project = script && script.dataset.project;
  if (!project || !/^[a-z0-9-]{1,48}$/.test(project) || window.__othersPresence) return;
  window.__othersPresence = true;

  const id = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  let visitor;
  try {
    const key = "others.presence.visitor";
    visitor = localStorage.getItem(key);
    if (!visitor || !/^[a-zA-Z0-9-]{12,64}$/.test(visitor)) {
      visitor = id();
      localStorage.setItem(key, visitor);
    }
  } catch { visitor = id(); }
  const session = id();
  let timer;
  let active = false;

  // (2026-11-16) never wait on the server: nothing is sent with no connection, and a request the network leaves
  // hanging is dropped after 10 s (the last one, sent as the page closes, is left to the browser)
  function send(on) {
    if (!on && !active) return;
    active = on;
    if (navigator.onLine === false) return;
    let signal;
    if (on && typeof AbortController === "function") {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 10000);
      signal = ac.signal;
    }
    fetch("https://apps.leonzhao.dev/mc/site/presence", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      credentials: "omit",
      keepalive: true,
      signal,
      body: JSON.stringify({ project, visitor, session, active: on }),
    }).catch(() => {});
  }

  function refresh() { send(!document.hidden); }
  function start() {
    if (!timer) timer = setInterval(refresh, 15000);
    refresh();
  }
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("pageshow", start);
  window.addEventListener("pagehide", () => { clearInterval(timer); timer = undefined; send(false); });
  start();
})();
