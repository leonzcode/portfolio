/* Sorting a page's cards (AI, Science, Math, Film, Others). The page puts its
   cards in its default order first (the site's own order, or the admin's saved
   one), then calls sortGrid with what the visitor chose; "default" (or any
   value this file does not know) leaves that order as it is. Ties keep the
   default order. A card's views and likes are kept in data-views and
   data-likes; a card with none yet sorts after every card that has them, so a
   page re-sorts when its counts arrive. */

export type SortMode = "default" | "title" | "views" | "likes";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// the card's shown title (an admin's edit included)
export const titleOf = (card: HTMLElement) =>
  (card.querySelector('[data-edit="title"]') ?? card.querySelector("h2, h3"))?.textContent?.trim() ?? "";

export function setCounts(card: HTMLElement | null | undefined, views: unknown, likes: unknown) {
  if (!card) return;
  if (typeof views === "number" && Number.isFinite(views)) card.dataset.views = String(Math.max(0, views));
  if (typeof likes === "number" && Number.isFinite(likes)) card.dataset.likes = String(Math.max(0, likes));
}

const countOf = (card: HTMLElement, which: "views" | "likes") => {
  const raw = card.dataset[which];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : -1;
};

// the grid's own cards, in the order they stand now
const cardsOf = (grid: HTMLElement) => [...grid.querySelectorAll<HTMLElement>(":scope > [data-card]")];

export function sortGrid(grid: HTMLElement, mode: string) {
  if (mode !== "title" && mode !== "views" && mode !== "likes") return;
  const base = cardsOf(grid);
  const rank = new Map(base.map((card, i) => [card, i]));
  const sorted = base.slice().sort((a, b) => {
    const d = mode === "title" ? collator.compare(titleOf(a), titleOf(b)) : countOf(b, mode) - countOf(a, mode);
    return d || rank.get(a)! - rank.get(b)!;
  });
  if (sorted.every((card, i) => base[i] === card)) return;
  for (const card of sorted) grid.append(card);
}

// back to the order the cards were built in (pages with no saved admin order)
export function builtOrder(grid: HTMLElement) {
  const base = cardsOf(grid);
  const sorted = base.slice().sort((a, b) => +(a.dataset.index || 0) - +(b.dataset.index || 0));
  if (sorted.every((card, i) => base[i] === card)) return;
  for (const card of sorted) grid.append(card);
}
