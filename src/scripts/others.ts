import { SITE_API, applyOrder, applyText, cachedEdits, rememberEdits, type TextEdit } from "./siteedits";
import { setCounts, sortGrid } from "./sortgrid";

const catalog = document.querySelector<HTMLElement>("[data-others-catalog]");
const PINNED = ["leoncraft2", "earth-drive"];

if (catalog) {
  const grid = catalog.querySelector<HTMLElement>("[data-others-list]")!;
  const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-others-item]"));
  const search = catalog.querySelector<HTMLInputElement>("[data-others-search]")!;
  const sort = catalog.querySelector<HTMLSelectElement>("[data-others-sort]")!;
  const counter = catalog.querySelector<HTMLElement>("[data-others-count]")!;
  const empty = catalog.querySelector<HTMLElement>("[data-others-empty]")!;
  const clear = catalog.querySelector<HTMLButtonElement>("[data-others-clear]")!;
  let featuredOrder: string[] = [];

  const titleOf = (card: HTMLElement) => card.querySelector('[data-edit="title"]')?.textContent?.trim() ?? "";

  function refresh() {
    // the featured order first (saved admin order, then the pins); a chosen sort (title, views, likes) goes over it,
    // pinned projects included, with ties kept in the featured order
    applyOrder(grid, featuredOrder);
    // pinned to the top in this order whatever the saved admin order says (Leon, 2026-11-12)
    const keyed = new Map(cards.map((card) => [card.dataset.key, card]));
    PINNED.slice().reverse().forEach((slug) => { const card = keyed.get(`games/${slug}`); if (card) grid.prepend(card); });
    sortGrid(grid, sort.value);
    const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const card of cards) {
      const content = [card.dataset.originalSearch, titleOf(card), card.querySelector('[data-edit="desc"]')?.textContent].join(" ").toLocaleLowerCase();
      card.hidden = !terms.every((term) => content.includes(term));
      if (!card.hidden) visible++;
    }
    clear.hidden = search.value.length === 0;
    empty.hidden = visible !== 0;
    counter.textContent = terms.length ? `${visible} of ${cards.length} projects` : `${cards.length} projects`;
  }

  function setEdits(text: Record<string, TextEdit>, order: Record<string, string[]>) {
    featuredOrder = Array.isArray(order?.games) ? order.games : [];
    for (const card of cards) applyText(card.dataset.key!, text?.[card.dataset.key!], catalog!);
    refresh();
  }

  function clearSearch() {
    search.value = "";
    refresh();
    search.focus();
  }

  search.addEventListener("input", refresh);
  sort.addEventListener("change", refresh);
  clear.addEventListener("click", clearSearch);
  catalog.querySelector("[data-others-reset]")?.addEventListener("click", clearSearch);
  const cached = cachedEdits();
  setEdits(cached.text, cached.order);

  const keys = cards.map((card) => card.dataset.key!).filter(Boolean);
  if (keys.length) {
    const query = new URLSearchParams({ edits: "1", slugs: keys.join(",") });
    fetch(`${SITE_API}/stats?${query}`, { cache: "no-store", signal: AbortSignal.timeout(10000) })
      .then(async (response) => {
        if (!response.ok) throw new Error("Statistics unavailable");
        return response.json();
      })
      .then((payload) => {
        if (!payload || typeof payload !== "object") return;
        if (payload.stats) {
          setEdits(payload.text ?? {}, payload.order ?? {});
          rememberEdits(keys, ["games"], payload.text ?? {}, payload.order ?? {});
        }
        const stats = payload.stats ?? payload;
        for (const card of cards) {
          const values = stats[card.dataset.key!];
          if (!values || !Number.isFinite(values.views) || !Number.isFinite(values.likes)) continue;
          const region = card.querySelector<HTMLElement>("[data-others-stats]")!;
          const views = Math.max(0, values.views);
          const likes = Math.max(0, values.likes);
          region.querySelector("[data-others-views]")!.textContent = views.toLocaleString();
          region.querySelector("[data-others-likes]")!.textContent = likes.toLocaleString();
          region.setAttribute("aria-label", `${views} views, ${likes} likes`);
          region.title = `${views} views, ${likes} likes`;
          region.hidden = false;
          setCounts(card, views, likes);
        }
        // a views or likes sort chosen before the counts came is put right now
        refresh();
      })
      .catch(() => {});
  }

  const form = catalog.querySelector<HTMLFormElement>("[data-others-form]")!;
  const send = catalog.querySelector<HTMLButtonElement>("[data-others-send]")!;
  const label = send.querySelector("span")!;
  const status = catalog.querySelector<HTMLElement>("[data-others-form-status]")!;
  const another = catalog.querySelector<HTMLButtonElement>("[data-others-another]")!;
  let sending = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    const fields = new FormData(form);
    const message = String(fields.get("message") ?? "").trim();
    if (!message) {
      status.textContent = "Enter a suggestion before sending.";
      status.dataset.state = "error";
      status.hidden = false;
      form.querySelector<HTMLTextAreaElement>("textarea")!.focus();
      return;
    }
    sending = true;
    send.disabled = true;
    label.textContent = "Sending...";
    status.hidden = true;
    try {
      const response = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, email: String(fields.get("email") ?? "").trim(), website: String(fields.get("website") ?? "") }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) throw new Error(typeof result?.error === "string" ? result.error : "Your suggestion could not be sent. Please try again.");
      form.reset();
      form.hidden = true;
      status.dataset.state = "success";
      status.textContent = "Thanks for the idea. Your suggestion has been sent.";
      another.hidden = false;
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error instanceof Error && error.name !== "TimeoutError" && error.name !== "TypeError" ? error.message : "Could not reach the server. Please try again.";
    } finally {
      sending = false;
      send.disabled = false;
      label.textContent = "Send suggestion";
      status.hidden = false;
    }
  });

  another.addEventListener("click", () => {
    form.hidden = false;
    status.hidden = true;
    another.hidden = true;
    form.querySelector<HTMLTextAreaElement>("textarea")!.focus();
  });
}
