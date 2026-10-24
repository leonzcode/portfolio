/* ---------------------------------------------------------------------------
   Leoncraft 2 - the beacon's screen (the game's BeaconScreen, 230 x 219).

   Primary Power on the left: a row of buttons for each level of the pyramid
   (Speed, Haste / Resistance, Jump Boost / Strength), a row open once the
   beacon has that many layers. Secondary Power on the right: Regeneration,
   and the primary power again at level II, open with all four layers and a
   primary chosen. The payment (an iron ingot, gold ingot, emerald, diamond
   or netherite ingot) goes in the slot at the bottom; the tick takes it and
   sets the powers chosen, the cross closes the screen and changes nothing.
   Positions are the game's; the sheet is our own (tools/leoncraft2/
   build_stations.py beacon()).
--------------------------------------------------------------------------- */
import { ContainerScreen, slot, range, TO_PLAYER, drawStack } from './inventory.js?v=107';
import { I, withCount } from '../items.js?v=107';
import { EFFECT_ICON, EFFECT_SHEET, effectName } from '../effects.js?v=107';
import { POWERS, PAYMENT } from '../sim/beacon.js?v=107';

const SHEET = 'container/beacon';
const MAIN = range(9, 36), HOT = range(0, 9);
const PAY = new Set(PAYMENT.map(n => I[n]).filter(v => v !== undefined));
const LABEL = 0xE0E0E0;
// the widgets' click
const click = () => {
  const S = typeof window !== 'undefined' && window.__lc2sound && window.__lc2sound.Sound;
  if (S) try { S.near('ui.button.click', 0.25, 1, 'ui'); } catch (e) { /* no sound */ }
};

export class BeaconScreen extends ContainerScreen {
  /* hooks: { level() (0 to 4, as it works now), primary, secondary (names or null), confirm(primary, secondary) } */
  constructor(inv, icons, hooks) {
    super(inv, icons, 230, 219);
    this.st = hooks || {};
    this.grid = [null]; this.gridW = 1;
    this.primary = this.st.primary || null;
    this.secondary = this.st.secondary || null;
    this.title = 'Beacon';
  }
  init() {
    super.init();
    const L = this.left, T = this.top, B = [];
    // the game's places: each row centred on 76 (primary) or 167 (secondary), 24 apart
    for (let t = 0; t <= 2; t++) {
      const n = POWERS[t].length, w = n * 22 + (n - 1) * 2;
      for (let c = 0; c < n; c++) B.push({ x: L + 76 + c * 24 - (w >> 1), y: T + 22 + t * 25, tier: t, effect: POWERS[t][c], primary: true });
    }
    const n = POWERS[3].length + 1, w = n * 22 + (n - 1) * 2;
    for (let c = 0; c < n - 1; c++) B.push({ x: L + 167 + c * 24 - (w >> 1), y: T + 47, tier: 3, effect: POWERS[3][c], primary: false });
    B.push({ x: L + 167 + (n - 1) * 24 - (w >> 1), y: T + 47, tier: 3, upgrade: true, primary: false });
    B.push({ x: L + 164, y: T + 107, confirm: true });
    B.push({ x: L + 190, y: T + 107, cancel: true });
    this.buttons = B;
  }
  get levels() { return this.st.level ? this.st.level() | 0 : 0; }
  makeSlots() {
    const L = this.left, T = this.top, out = [slot(L + 136, T + 110, 'craft', 0)];
    for (let j = 9; j < 36; j++) out.push(slot(L + 36 + (j % 9) * 18, T + 137 + Math.floor((j - 9) / 9) * 18, 'inv', j));
    for (let i = 0; i < 9; i++) out.push(slot(L + 36 + i * 18, T + 195, 'inv', i));
    return out;
  }
  mayPlace(s, st) {
    if (s.kind === 'craft' && st) return PAY.has(st.id);
    return super.mayPlace(s, st);
  }
  limit(s, id) { return s.kind === 'craft' ? 1 : super.limit(s, id); }
  updateResult() {}
  quickMove(s) {
    const st = this.getStack(s);
    if (!st) return;
    if (s.kind === 'craft') this.moveInto(st, TO_PLAYER);
    else if (s.kind === 'inv') {
      if (PAY.has(st.id) && !this.grid[0]) { this.grid[0] = withCount(st, 1); st.count -= 1; }
      else this.moveInto(st, s.i >= 9 ? HOT : MAIN);
    }
    if (!st.count) this.setStack(s, null);
  }
  // what a button shows and does now (the game's updateStatus)
  state(b) {
    const lv = this.levels;
    if (b.confirm) return { active: !!this.grid[0] && !!this.primary, visible: true };
    if (b.cancel) return { active: true, visible: true };
    if (b.upgrade) {
      if (!this.primary) return { visible: false };
      return { visible: true, active: b.tier < lv, effect: this.primary, level: 2, selected: this.secondary === this.primary };
    }
    return { visible: true, active: b.tier < lv, effect: b.effect, level: 1, selected: b.effect === (b.primary ? this.primary : this.secondary) };
  }
  buttonAt(mx, my) {
    for (const b of this.buttons || []) if (mx >= b.x && my >= b.y && mx < b.x + 22 && my < b.y + 22) return b;
    return null;
  }
  extraClick(mx, my, button) {
    const b = this.buttonAt(mx, my);
    if (!b || button !== 0) return false;
    const s = this.state(b);
    if (!s.visible || !s.active) return true;
    click();
    if (b.cancel) { if (this.gui) this.gui.back(); return true; }
    if (b.confirm) {
      if (this.st.confirm) this.st.confirm(this.primary, this.secondary);
      this.grid[0] = null;
      if (this.gui) this.gui.back();
      return true;
    }
    if (s.selected) return true;
    if (b.primary) this.primary = b.effect; else this.secondary = s.effect;
    return true;
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit(SHEET, 0, 0, 230, 219, L, T);
    g.centered('Primary Power', L + 62, T + 10, LABEL, true);
    g.centered('Secondary Power', L + 169, T + 10, LABEL, true);
    // what it can be paid with
    PAYMENT.forEach((n, i) => { if (I[n] !== undefined) drawStack(g, this.icons, { id: I[n], count: 1 }, L + [20, 41, 63, 86, 108][i], T + 109); });
    const hover = this.buttonAt(mx, my), pics = g.sheet(EFFECT_SHEET);
    let tip = null;
    for (const b of this.buttons || []) {
      const s = this.state(b);
      if (!s.visible) continue;
      const u = !s.active ? 66 : s.selected ? 44 : hover === b ? 22 : 0;
      g.blit(SHEET, u, 219, 22, 22, b.x, b.y);
      if (b.confirm || b.cancel) g.blit(SHEET, b.confirm ? 88 : 106, 219, 18, 18, b.x + 2, b.y + 2);
      else {
        const ic = EFFECT_ICON[s.effect];
        if (pics && ic !== undefined) g.blit(pics, (ic % 8) * 18, Math.floor(ic / 8) * 18, 18, 18, b.x + 2, b.y + 2);
        if (hover === b) tip = [effectName(s.effect, s.level)];
      }
      if (hover === b && b.confirm) tip = ['Done'];
      if (hover === b && b.cancel) tip = ['Cancel'];
    }
    const prev = this.drawSlots(g, mx, my);
    if (tip && !this.inv.carried) g.setTooltip(tip);
    this.drawCarried(g, mx, my, prev);
  }
}
