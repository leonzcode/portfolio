/* ---------------------------------------------------------------------------
   Leon Kart - the menus, with a controller.

   Every screen in the game is buttons in the page, so moving round one with a
   pad is moving the keyboard focus: the D-pad or the left stick goes to the
   nearest thing in that direction, Cross presses it, Circle goes back. Which
   screen that is, and what "back" means on it, the game says through
   `g.layer()`: { root, back, first }. Whatever is not on the top screen is not
   reachable, so a pad cannot press a button hidden under a dialog.

   A range input takes left and right itself, and anything marked data-padlr
   (the colour wheel) is sent the arrow keys it already understands.
--------------------------------------------------------------------------- */
const SEL = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function makeNav(g) {
  function usable(e) {
    if (e.disabled || e.closest('[hidden]') || e.getAttribute('aria-hidden') === 'true') return false;
    if (!e.getClientRects().length) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none';
  }
  function items(root) { return [...root.querySelectorAll(SEL)].filter(usable); }
  function put(e) {
    if (!e) return false;
    document.body.classList.add('padnav');
    try { e.focus({ preventScroll: true }); } catch (err) { e.focus(); }
    try { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) {}
    return true;
  }
  // somewhere to start: what the screen says, or what is lit, or the first thing on it
  function start(L, list) {
    const want = L.first && L.first();
    if (want && list.indexOf(want) >= 0) return put(want);
    const lit = list.find(e => e.classList.contains('on') || e.getAttribute('aria-pressed') === 'true'
      || e.getAttribute('aria-selected') === 'true');
    return put(lit || list[0]);
  }
  function move(dir) {
    const L = g.layer();
    if (!L) return false;
    const list = items(L.root);
    if (!list.length) return false;
    const cur = document.activeElement;
    if (!cur || !L.root.contains(cur) || list.indexOf(cur) < 0) return start(L, list);
    document.body.classList.add('padnav');
    if (cur.tagName === 'INPUT' && cur.type === 'range' && (dir === 'left' || dir === 'right')) {
      const step = +cur.step || 1, span = (+cur.max || 100) - (+cur.min || 0);
      const by = Math.max(step, Math.round(span / 20 / step) * step);
      cur.value = String(+cur.value + (dir === 'left' ? -by : by));
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      cur.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (cur.hasAttribute('data-padlr') && (dir === 'left' || dir === 'right')) {
      cur.dispatchEvent(new KeyboardEvent('keydown', { key: dir === 'left' ? 'ArrowLeft' : 'ArrowRight', bubbles: true }));
      return true;
    }
    /* The nearest thing that way, by the middles of the two boxes: how far
       along the direction it is, and twice as much for how far off to the side,
       so a grid moves along its rows and down its columns. */
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const e of list) {
      if (e === cur) continue;
      const b = e.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      let along, side;
      if (dir === 'left') { along = ax - bx; side = Math.abs(by - ay); }
      else if (dir === 'right') { along = bx - ax; side = Math.abs(by - ay); }
      else if (dir === 'up') { along = ay - by; side = Math.abs(bx - ax); }
      else { along = by - ay; side = Math.abs(bx - ax); }
      // overlapping boxes in a row are beside each other, not above
      if (along <= 4) continue;
      if ((dir === 'up' || dir === 'down') && side > along * 3 + 60) continue;
      const score = along + side * 2;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) return put(best);
    return false;
  }
  function ok() {
    const L = g.layer();
    if (!L) return false;
    const cur = document.activeElement;
    if (!cur || !L.root.contains(cur) || !usable(cur)) return move('down');
    // a text box has nothing a pad can type, and a slider is moved, not pressed
    if (cur.tagName === 'INPUT' && cur.type !== 'button' && cur.type !== 'submit' && cur.type !== 'checkbox') return false;
    if (cur.tagName === 'TEXTAREA' || cur.tagName === 'SELECT') return false;
    cur.click();
    return true;
  }
  function back() {
    const L = g.layer();
    if (!L || !L.back) return false;
    L.back();
    return true;
  }
  // the mouse is back: the pad's focus ring goes until the pad is used again
  const off = () => document.body.classList.remove('padnav');
  addEventListener('pointerdown', off, { passive: true });
  addEventListener('mousemove', e => { if (e.movementX || e.movementY) off(); }, { passive: true });
  return { move, ok, back, items };
}
