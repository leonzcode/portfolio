/* ---------------------------------------------------------------------------
   Leoncraft 2 - the blocks and items the other dimensions need.

   Called once from blocks.js after the generated list, with its def():
     nether_portal      a thin sheet across its axis (models.js 'portal')
     end_portal_frame   13 pixels tall, an eye on top when meta bit 2 is set
                        (models.js 'end_frame'; the eye texture is ours, js/dim/art.js)
     end_portal         its surface 12 pixels up, as the game draws it
   and four items that are not blocks (shape 'none', never placed; what they
   do is in js/dim/realms.js): flint and steel, the fire charge, the eye of
   ender and the end crystal. Their icons are drawn by js/dim/art.js.

   Items here are block ids, the way the inventory holds everything today;
   when the item system lands these four move into it.
--------------------------------------------------------------------------- */
export function dimBlocks(def, B, BLOCKS) {
  const set = (name, o) => { if (B[name] !== undefined) Object.assign(BLOCKS[B[name]], o); };
  set('nether_portal', { shape: 'portal', pass: 'translucent', solid: false, opacity: 0, light: 11 });
  set('end_portal_frame', { shape: 'end_frame', pass: 'opaque', opacity: 0, light: 1,
    tex: { top: 'end_portal_frame_top', bottom: 'end_stone', side: 'end_portal_frame_side', eye: 'end_portal_frame_eye' } });
  set('end_portal', { h: 12, solid: false, light: 15 });
  set('end_gateway', { solid: false, opacity: 0, light: 15 });
  const item = (name, display, icon, order, o) => def(name, Object.assign({
    display, shape: 'none', pass: 'none', solid: false, opacity: 0, tex: null, item: true, place: false,
    icon, tab: 'functional', order, stack: 64,
  }, o || {}));
  item('flint_and_steel', 'Flint and Steel', 'lc2_flint_and_steel', 900, { stack: 1, use: 'ignite' });
  item('fire_charge', 'Fire Charge', 'lc2_fire_charge', 901, { use: 'ignite' });
  item('ender_eye', 'Eye of Ender', 'lc2_ender_eye', 902, { use: 'eye' });
  item('end_crystal', 'End Crystal', 'lc2_end_crystal', 903, { use: 'crystal' });
}
