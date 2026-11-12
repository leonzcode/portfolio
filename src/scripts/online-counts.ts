import { SITE_API } from "./siteedits";

const badges = Array.from(document.querySelectorAll<HTMLElement>("[data-project-online]"));
const projects = [...new Set(badges.map((badge) => badge.dataset.projectOnline!))];

if (projects.length) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: AbortController | undefined;

  function show(project: string, count: number | undefined) {
    for (const badge of badges.filter((item) => item.dataset.projectOnline === project)) {
      const valid = Number.isSafeInteger(count) && count! >= 0;
      badge.dataset.onlineState = valid ? (count! > 0 ? "active" : "idle") : "unavailable";
      badge.querySelector("[data-online-value]")!.textContent = valid ? `${count!.toLocaleString()} online` : "Unavailable";
      badge.setAttribute("aria-label", valid ? `${count} active browsers online` : "Online count unavailable");
      badge.title = valid ? "Active browsers in the last 45 seconds" : "The online count could not be refreshed";
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
