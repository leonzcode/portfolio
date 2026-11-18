import { SITE_API } from "./siteedits";

const badges = Array.from(document.querySelectorAll<HTMLElement>("[data-project-online]"));
const projects = [...new Set(badges.map((badge) => badge.dataset.projectOnline!))];

if (projects.length) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: AbortController | undefined;

  function show(project: string, count: number | undefined) {
    for (const badge of badges.filter((item) => item.dataset.projectOnline === project)) {
      const valid = Number.isSafeInteger(count) && count! >= 0;
      // with no answer the badge is left out (a kept online count would be stale at once); the card still
      // shows its last saved views and likes (Leon, 2026-11-17)
      badge.hidden = !valid;
      if (!valid) continue;
      badge.dataset.onlineState = count! > 0 ? "active" : "idle";
      badge.querySelector("[data-online-value]")!.textContent = `${count!.toLocaleString()} online`;
      badge.setAttribute("aria-label", `${count} active browsers online`);
      badge.title = "Active browsers in the last 45 seconds";
    }
  }

  async function update() {
    if (document.hidden || pending) return;
    pending = new AbortController();
    const timeout = setTimeout(() => pending?.abort(), 8000);
    try {
      const query = new URLSearchParams({ projects: projects.join(",") });
      const response = await fetch(`${SITE_API}/online?${query}`, { cache: "no-store", credentials: "omit", signal: pending.signal });
      if (!response.ok) throw new Error("Online counts unavailable");
      const result = await response.json();
      for (const project of projects) show(project, result?.counts?.[project]);
    } catch {
      if (!document.hidden) for (const project of projects) show(project, undefined);
    } finally {
      clearTimeout(timeout);
      pending = undefined;
    }
  }

  function start() {
    if (!timer) timer = setInterval(update, 15000);
    void update();
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) void update(); });
  window.addEventListener("pageshow", start);
  window.addEventListener("pagehide", () => { clearInterval(timer); timer = undefined; pending?.abort(); });
  start();
}
