/* The admin's edits (leonzhao.dev/admin): a project's title and description
   in place of the ones the site was built with, and each tab's order. They
   live on the mlhub server with the views and likes (apps/mc/sitesocial.js);
   the pages are static, so each page puts them in when it loads. The last
   ones seen are kept in this browser and put in at once, so a page that has
   been edited does not show the old words first on a second visit. */

export const SITE_API = "https://apps.leonzhao.dev/mc/site";

export type TextEdit = { title?: string; description?: string };
export type Edits = { text: Record<string, TextEdit>; order: Record<string, string[]> };

const KEY = "siteEdits";

export function cachedEdits(): Edits {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || "null");
    if (j && typeof j.text === "object" && typeof j.order === "object") return j;
  } catch {}
  return { text: {}, order: {} };
}

/* What the server said about these projects and these tabs replaces what
   was kept for them; the rest of what was kept stays. */
export function rememberEdits(keys: string[], cats: string[], text: Record<string, TextEdit>, order: Record<string, string[]>) {
  const e = cachedEdits();
  for (const k of keys) { if (text[k]) e.text[k] = text[k]; else delete e.text[k]; }
  for (const c of cats) { if (order[c]) e.order[c] = order[c]; else delete e.order[c]; }
  try { localStorage.setItem(KEY, JSON.stringify(e)); } catch {}
}

/* Every element marked data-edit="title" or "desc" for this project gets the
   edited words, or its own back when the edit was taken away. */
export function applyText(key: string, edit: TextEdit | null | undefined, root: ParentNode = document) {
  const els = root.querySelectorAll<HTMLElement>('[data-edit][data-edit-key="' + key + '"]');
  for (const el of els) {
    const want = el.dataset.edit === "title" ? edit?.title : edit?.description;
    if (el.dataset.orig === undefined) {
      if (!want) continue;
      el.dataset.orig = el.textContent || "";
    }
    const text = want || el.dataset.orig.trim();
    if ((el.textContent || "").trim() !== text) el.textContent = text;
  }
}

/* A tab's order: the saved one, with any project it does not name (one added
   to the site since) where it was, right after the one it follows in the
   site's own order. Slugs the site no longer has are dropped. */
export function mergeOrder(defaults: string[], saved: string[] | null | undefined): string[] {
  const have = new Set(defaults);
  const list = (saved || []).filter((s) => have.has(s));
  const inList = new Set(list);
  defaults.forEach((s, i) => {
    if (inList.has(s)) return;
    const at = i ? list.indexOf(defaults[i - 1]) + 1 : 0;
    list.splice(at, 0, s);
    inList.add(s);
  });
  return list;
}

// puts a grid's cards in the saved order
export function applyOrder(grid: HTMLElement, order: string[] | null | undefined) {
  const cards = [...grid.querySelectorAll<HTMLElement>(":scope > [data-card]")];
  const slugOf = (c: HTMLElement) => (c.dataset.key || "").split("/")[1] || "";
  const byIndex = cards.slice().sort((a, b) => +(a.dataset.index || 0) - +(b.dataset.index || 0));
  const list = mergeOrder(byIndex.map(slugOf), order);
  const bySlug = new Map(cards.map((c) => [slugOf(c), c]));
  const now = cards.map(slugOf).join(",");
  if (now === list.join(",")) return;
  for (const s of list) grid.appendChild(bySlug.get(s)!);
}
