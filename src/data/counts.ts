/* The views and likes each project had when the site was built, so a page
   shows them even when the server that keeps them cannot be reached (a school
   network that blocks it). The build asks the server; if it does not answer,
   the snapshot file beside this one stands in. The page still asks for the
   live numbers and shows those when they come. */
import { aiProjects, otherProjects, mathProjects, scienceProjects } from "./projects";
import snapshot from "./counts-snapshot.json";

export type Count = { views: number; likes: number };

const keys = [
  ...aiProjects.map((p) => `ai/${p.slug}`),
  ...otherProjects.map((p) => `games/${p.slug}`),
  ...mathProjects.map((p) => `math/${p.slug}`),
  ...scienceProjects.map((p) => `science/${p.slug}`),
];

const counts: Record<string, Count> = { ...(snapshot as Record<string, Count>) };
try {
  const r = await fetch("https://apps.leonzhao.dev/mc/site/stats?slugs=" + encodeURIComponent(keys.join(",")), { signal: AbortSignal.timeout(6000) });
  const j = r.ok ? await r.json() : null;
  for (const k of keys) {
    const s = j?.[k];
    if (s && Number.isFinite(s.views) && Number.isFinite(s.likes)) counts[k] = { views: Math.max(0, s.views), likes: Math.max(0, s.likes) };
  }
} catch {}

export const savedCounts = counts;
export const savedCount = (key: string | null | undefined): Count | undefined => (key ? counts[key] : undefined);
