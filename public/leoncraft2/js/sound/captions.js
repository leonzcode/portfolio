/* ---------------------------------------------------------------------------
   Leoncraft 2 - Closed Captions (the game's subtitles), drawn as its
   SubtitleOverlay draws them.

   Every sound in earshot that has a subtitle adds its line (or brings an
   existing line with the same words back to full brightness and moves it to
   the newer sound). Lines stack up from 35 pixels above the bottom right,
   one every 10 pixels, the oldest lowest, on a box of the widest line plus
   room for an arrow each side; a line fades from white to dark grey over 3
   seconds and goes. A sound more than about 60 degrees from where you look
   gets an arrow on the side it is on.

   The words come from the pack in use: the player's own Minecraft's
   en_us.json, or else Leoncraft's own words for it (subtitles.js).
--------------------------------------------------------------------------- */
import { Sound } from './sound.js?v=107';
import { caption } from './subtitles.js?v=107';
import { SoundPacks } from './packs.js?v=107';

const LIFE = 3000;

export const Captions = {
  on: false,
  lines: [],            // { text, x, y, z, rel, t }
  sig: '',
  init(options) {
    this.on = !!options.get('subtitles');
    options.onChange(k => { if (k === 'subtitles') { this.on = !!options.get('subtitles'); if (!this.on) this.lines.length = 0; } });
    Sound.setSubtitleSink((key, x, y, z, rel) => this.add(key, x, y, z, rel));
  },
  text(key) {
    const mc = SoundPacks.mc;
    return (mc && mc.lang && mc.lang[key]) || caption(key);
  },
  add(key, x, y, z, rel) {
    if (!this.on) return;
    const text = this.text(key);
    if (!text) return;
    const now = performance.now();
    for (const l of this.lines) if (l.text === text) { l.x = x; l.y = y; l.z = z; l.rel = rel; l.t = now; return; }
    this.lines.push({ text, x, y, z, rel, t: now });
  },
  // the overlay for gui.overlays: redrawn only when what it shows changes (the fade is stepped)
  overlay() {
    const self = this;
    return {
      get animates() {
        if (!self.on || !self.lines.length) { if (self.sig) { self.sig = ''; return true; } return false; }
        const now = performance.now();
        let s = '';
        for (const l of self.lines) s += l.text + ((now - l.t) / 150 | 0) + self.arrow(l) + '|';
        if (s === self.sig) return false;
        self.sig = s;
        return true;
      },
      draw(g) { self.draw(g); },
    };
  },
  arrow(l) {
    if (l.rel) return 0;
    const L = Sound.listener, F = Sound.forward;
    let dx = l.x - L.x, dy = l.y - L.y, dz = l.z - L.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-3) return 0;
    dx /= d; dy /= d; dz /= d;
    if (dx * F.x + dy * F.y + dz * F.z > 0.5) return 0;
    // right of the view: forward x up, with up the world's
    const rx = -F.z, rz = F.x;
    const side = dx * rx + dz * rz;
    return side > 0 ? 1 : side < 0 ? -1 : 0;
  },
  draw(g) {
    if (!this.on || !g.inGame) return;
    const now = performance.now();
    this.lines = this.lines.filter(l => now - l.t < LIFE);
    if (!this.lines.length) return;
    let k = 0;
    for (const l of this.lines) k = Math.max(k, g.textWidth(l.text));
    k += g.textWidth('<') + g.textWidth(' ') + g.textWidth('>') + g.textWidth(' ');
    const i1 = k >> 1, j1 = 4;
    this.lines.forEach((l, j) => {
      const cx = Math.floor(g.width - i1 - 2), cy = Math.floor(g.height - 35 - j * 10);
      const age = Math.max(0, Math.min(1, (now - l.t) / LIFE));
      const lvl = Math.floor(255 + (75 - 255) * age);
      const col = (lvl << 16) | (lvl << 8) | lvl;
      g.fill(cx - i1 - 1, cy - j1 - 1, cx + i1 + 1, cy + j1 + 1, 0xCC000000);
      const a = this.arrow(l);
      if (a > 0) g.text('>', cx + i1 - g.textWidth('>'), cy - j1, col, false);
      else if (a < 0) g.text('<', cx - i1, cy - j1, col, false);
      g.text(l.text, cx - Math.floor(g.textWidth(l.text) / 2), cy - j1, col, false);
    });
  },
};
