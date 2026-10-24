/* ---------------------------------------------------------------------------
   Leoncraft 2 - the four game modes and the ways of changing between them.

   What each mode lets you do, as the game has it:
     survival   placing uses up the stack, breaking takes time and drops
                what it should, tools and armour wear, damage and hunger
     creative   nothing runs out and nothing wears, blocks break at once
                (but not with a sword, trident, mace or debug stick in the
                hand), flight, and no damage but the void and /kill
     adventure  survival's rules, except that no block can be broken and
                nothing placed or used on a block (doors, buttons, levers
                and chests still work); no outline on the block looked at
     spectator  flying through everything; no hotbar, hand, crosshair or
                outline; nothing picked up, nothing used, nothing broken

   applyModeRules(game, mode, hud) sets the parts of the game that follow
   the mode; main.js setMode calls it for every way of switching: /gamemode,
   F3+N, the F3+F4 switcher and Open to LAN (ui/lan.js).

   ModeKeys is F3+N and F3+F4, for main.js's key handlers:
     F3+N    spectator, or back from it to the mode before (creative when
             there was none)
     F3+F4   the game mode switcher over the game: F4 again (F3 still
             held) moves along creative, survival, adventure, spectator;
             letting go of F3 switches to the one picked
   Both need commands allowed, as in the game, and run /gamemode, so the
   chat says what it always says.
--------------------------------------------------------------------------- */
import { B } from './blocks.js?v=107';
import { I, ITEMS } from './items.js?v=107';
import { drawStack } from './ui/inventory.js?v=107';

export const MODES = ['survival', 'creative', 'adventure', 'spectator'];
export const MODE_TITLES = { survival: 'Survival Mode', creative: 'Creative Mode', adventure: 'Adventure Mode', spectator: 'Spectator Mode' };
// the switcher's order, and what stands for each mode in it
const SWITCH_ORDER = ['creative', 'survival', 'adventure', 'spectator'];
const SWITCH_ICON = { creative: () => B.grass_block, survival: () => I.iron_sword, adventure: () => I.map, spectator: () => I.ender_eye };

// what may not break blocks in creative (the game's tag for weapons that would only get in the way)
const NO_CREATIVE_BREAK = /^(.*_sword|trident|mace|debug_stick)$/;
export function breaksInCreative(itemId) {
  const it = itemId ? ITEMS[itemId] : null;
  return !(it && NO_CREATIVE_BREAK.test(it.name));
}

/* Everything that follows the mode, set at once. (main.js also sets the
   inventory's mode, the mobs' and flight; this is the rest.) */
export function applyModeRules(g, m, hud) {
  // the mode before, for F3+N and the switcher
  if (g.modeNow && g.modeNow !== m) g.prevMode = g.modeNow;
  g.modeNow = m;
  if (g.hands) { g.hands.mode = m; if (g.hands.using && m === 'spectator') g.hands.stopUsing(); }
  const it = g.inter;
  if (it) {
    it.creative = m === 'creative';
    it.adventure = m === 'adventure' || m === 'spectator';
    it.spectator = m === 'spectator';
    // mining starts again under the new rules (a creative click is no longer a finished block)
    it.mining = null; it.attack = false; it.useHeld = false;
  }
  const p = g.player;
  // the fall counts from here: flying left none behind (the game resets it every tick in flight)
  if (p) { p.fallDistance = 0; p.landed = null; p.usingItem = false; if (m !== 'spectator') p.flySpeed = 0.05; }
  /* (and into spectator from the ground you stay where you stood: the pull of gravity a body standing
     still always carries took it 0.2 down into the ground with nothing to stop it, and back out of
     spectator it fell the rest of the way into that block, a block deeper every time, until after a
     few changes of mode your eyes were in the ground and your skin went pitch black) */
  if (p && m === 'spectator' && p.onGround && p.vel.y < 0) p.vel.y = 0;
  if (hud) { hud.spectator = m === 'spectator'; hud.markDirty(); }
}

/* ---- F3+N and F3+F4 ---- */
export class ModeKeys {
  /* o: { gui, hud: () => hud, chat, icons, game: () => game, cheats: () => bool, run: line => void } */
  constructor(o) {
    Object.assign(this, o);
    this.picking = null;              // the switcher's choice while it is up
    this.overlay = { draw: g => this.draw(g) };
  }
  previous(g) { return g.prevMode && g.prevMode !== g.mode ? g.prevMode : null; }
  debug(text) { this.chat.add('§e§l[Debug]:§r ' + text); }
  // F3+N: spectator, or back from it
  toggleSpectator() {
    const g = this.game();
    if (!g) return;
    if (!this.cheats()) { this.debug('Unable to switch game mode; no permission'); return; }
    this.run('/gamemode ' + (g.mode !== 'spectator' ? 'spectator' : this.previous(g) || 'creative'));
  }
  // F3+F4: open the switcher, or move it along
  switcher() {
    const g = this.game();
    if (!g) return;
    if (!this.picking) {
      if (!this.cheats()) { this.debug('Unable to open game mode switcher; no permission'); return; }
      // it starts on the mode you were in before (or creative, or survival from creative)
      this.picking = this.previous(g) || (g.mode === 'creative' ? 'survival' : 'creative');
      if (!this.gui.overlays.includes(this.overlay)) this.gui.overlays.push(this.overlay);
    } else this.picking = SWITCH_ORDER[(SWITCH_ORDER.indexOf(this.picking) + 1) % 4];
    this.dirty();
  }
  dirty() { const h = this.hud(); if (h) h.markDirty(); }
  // F3 let go: switch to the one picked, if it is not the mode you are in
  release() {
    const pick = this.picking, g = this.game();
    if (!pick) return false;
    this.close();
    if (g && pick !== g.mode) this.run('/gamemode ' + pick);
    return true;
  }
  close() {
    this.picking = null;
    const i = this.gui.overlays.indexOf(this.overlay);
    if (i >= 0) this.gui.overlays.splice(i, 1);
    this.dirty();
  }
  /* The switcher as the game lays it out: four 26-pixel slots 31 apart in a
     dark panel just above the middle, the mode's name over them and
     "[ F4 ] Next" under them. The panel and slots are drawn here (no Mojang art). */
  draw(g) {
    if (!this.picking || g.screen) return;
    const W = g.width, H = g.height, cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    const px = cx - 62, py = cy - 31 - 27;
    g.fill(px + 1, py, px + 124, py + 75, 0x90000000);
    g.fill(px, py + 1, px + 1, py + 74, 0x90000000);
    g.fill(px + 124, py + 1, px + 125, py + 74, 0x90000000);
    g.centered(MODE_TITLES[this.picking], cx, cy - 31 - 20, 0xFFFFFF, true);
    const sx = cx - Math.floor(119 / 2);
    SWITCH_ORDER.forEach((m, i) => {
      const x = sx + i * 31, y = cy - 31;
      g.fill(x, y, x + 26, y + 26, 0xFF8B8B8B);
      g.fill(x + 1, y + 1, x + 25, y + 25, 0xFF373737);
      g.fill(x + 2, y + 2, x + 24, y + 24, 0xFF5A5A5A);
      if (m === this.picking) {
        g.fill(x - 1, y - 1, x + 27, y, 0xFFFFFFFF); g.fill(x - 1, y + 26, x + 27, y + 27, 0xFFFFFFFF);
        g.fill(x - 1, y, x, y + 26, 0xFFFFFFFF); g.fill(x + 26, y, x + 27, y + 26, 0xFFFFFFFF);
      }
      const id = SWITCH_ICON[m]();
      if (id) drawStack(g, this.icons, { id, count: 1 }, x + 5, y + 5);
    });
    const a = '[ F4 ]', b = ' Next', w = g.textWidth(a + b);
    g.text(a, cx - Math.floor(w / 2), cy + 5, 0x55FFFF, true);
    g.text(b, cx - Math.floor(w / 2) + g.textWidth(a), cy + 5, 0xFFFFFF, true);
  }
}
