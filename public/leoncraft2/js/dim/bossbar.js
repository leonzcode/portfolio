/* ---------------------------------------------------------------------------
   Leoncraft 2 - a boss bar, drawn the game's way: the name centred at the
   top, a bar 182 x 5 GUI pixels under it (12 from the top), its colour's
   dark track with the light fill over it (our own colours, no texture).
--------------------------------------------------------------------------- */
const COLOURS = { pink: [0xFF5A1E4E, 0xFFEC00B8, 0xFFFF7FE3], purple: [0xFF33134F, 0xFF8B2BE0, 0xFFC27DFF] };

export function drawBossBar(g, boss, cx) {
  const [track, fill, shine] = COLOURS[boss.colour] || COLOURS.pink;
  const x0 = cx - 91, y0 = 12;
  g.fill(x0, y0, x0 + 182, y0 + 5, 0xFF000000);
  g.fill(x0 + 1, y0 + 1, x0 + 181, y0 + 4, track);
  const w = Math.round(180 * Math.max(0, Math.min(1, boss.progress)));
  if (w > 0) { g.fill(x0 + 1, y0 + 1, x0 + 1 + w, y0 + 4, fill); g.fill(x0 + 1, y0 + 1, x0 + 1 + w, y0 + 2, shine); }
  g.centered(boss.name, cx, y0 - 9, 0xFFFFFF, true);
}
