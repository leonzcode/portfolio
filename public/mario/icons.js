/* ---------------------------------------------------------------------------
   Leon Kart - icons.

   Line icons drawn on a 24 unit grid in the current text colour, so they sit
   in a button the way its label does and follow its colour. No emoji anywhere
   in the game's own interface (Leon's call): they look different on every
   device and none of them match the game.
--------------------------------------------------------------------------- */
const P = {
  backpack: '<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M8 21v-5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5"/><path d="M8 10h8"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17v-6"/><path d="M13 17V6"/><path d="M18 17v-4"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  road: '<path d="M4 21 8 3"/><path d="M20 21 16 3"/><path d="M12 4v3"/><path d="M12 11v2"/><path d="M12 17v3"/>',
  pointer: '<path d="m4 4 7 17 2.5-7.5L21 11Z"/>',
  tree: '<path d="M12 22v-5"/><path d="M12 2 6 10h3l-4 7h14l-4-7h3Z"/>',
  eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21Z"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 14v7"/><path d="M10 12H3.2"/><path d="M14 12h6.8"/>',
  sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z"/>',
  thumbup: '<path d="M7 10v12"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.5l-2.3 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z"/>',
  thumbdown: '<g transform="rotate(180 12 12)"><path d="M7 10v12"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.5l-2.3 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z"/></g>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  ghost: '<path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  none: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>',
  // one for each kind of cosmetic, while its picture is being drawn
  brush: '<path d="M9.06 11.9 18 3a2.1 2.1 0 0 1 3 3l-8.94 8.94"/><path d="M7 14a3 3 0 0 0-3 3c0 1.31-2 2-2 2 1.06 1.42 2.62 2 4 2a4 4 0 0 0 4-4 3 3 0 0 0-3-3Z"/>',
  car: '<path d="M3 15v-3l2-5h11l4 5h1v3"/><circle cx="7" cy="16" r="2"/><circle cx="17" cy="16" r="2"/><path d="M9 16h6"/>',
  hat: '<path d="M8 17V6h8v11"/><path d="M3 17h18"/><path d="M8 13h8"/>',
  glasses: '<circle cx="6" cy="14" r="4"/><circle cx="18" cy="14" r="4"/><path d="M10 14h4"/><path d="M2 14 3 8"/><path d="m22 14-1-6"/>',
  plane: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  plate: '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 12h12"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  sparkle: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m6 6 2 2"/><path d="m16 16 2 2"/><path d="m6 18 2-2"/><path d="m16 8 2-2"/>',
};
// the picture a kind of cosmetic gets until its own is ready
export const KIND_ICON = { skin: 'brush', body: 'car', hat: 'hat', face: 'glasses', glider: 'plane', decor: 'star', plate: 'plate', driver: 'user', aura: 'sparkle' };

export function icon(name, cls) {
  const body = P[name];
  if (!body) return '';
  return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}
// every element marked data-icon="name" gets that icon
export function fillIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach(e => { if (!e.firstChild) e.innerHTML = icon(e.dataset.icon); });
}
