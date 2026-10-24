/* ---------------------------------------------------------------------------
   Leoncraft 2 - the advancement toast.

   As the game's: a 160 x 32 box sliding in at the top right (600 ms, eased
   in), staying 5 seconds, sliding out the same way; up to five at once, one
   under another, the rest waiting their turn. Inside: the advancement's
   icon at (8, 8), "Advancement Made!" or "Goal Reached!" in yellow, or
   "Challenge Complete!" in pink, over the name in white, both without a
   shadow. A name too long for one line shows the heading for a second and a
   half, then the name over two lines instead. The box comes in with the
   toast's in sound and leaves with its out sound; a challenge plays the
   challenge fanfare as it arrives. The recipe book's New Recipes Unlocked!
   (js/recipes.js) takes its turn in the same column, in a light box.

   The box is drawn here in flat colours (black edge with cut corners, a
   grey border, a near-black inside). The three sounds are the player's own
   Minecraft's when "Use My Minecraft Sounds" is on; otherwise our own,
   made here with Web Audio (a soft swish in and out, a short rising
   fanfare), since Leoncraft's own sound banks have none.
--------------------------------------------------------------------------- */
import { Sound } from '../sound/sound.js?v=107';
import { itemId } from '../items.js?v=107';
import { B, BLOCKS } from '../blocks.js?v=107';
import { drawStack } from '../ui/inventory.js?v=107';

const W = 160, H = 32, SLIDE = 600, SHOW = 5000, SLOTS = 5;
const HEAD = { task: 'Advancement Made!', goal: 'Goal Reached!', challenge: 'Challenge Complete!' };

// an advancement's icon as a stack the inventory can draw (the raid captain's banner, a pot's sherds)
const OMINOUS = [['rhombus', 'cyan'], ['stripe_bottom', 'light_gray'], ['stripe_center', 'gray'], ['border', 'light_gray'], ['stripe_middle', 'black'],
  ['half_horizontal', 'light_gray'], ['circle', 'light_gray'], ['border', 'black']];
export function iconStack(a) {
  const n = a.icon, id = itemId(n) || (B[n] !== undefined && BLOCKS[B[n]] && BLOCKS[B[n]].item !== false ? B[n] : 0);
  if (!id) return null;
  const st = { id, count: 1 };
  if (a.iconKind === 'ominous_banner') st.patterns = OMINOUS.slice();
  if (a.iconPot) st.sherds = a.iconPot.slice();
  return st;
}

/* ---- the three sounds ---- */
let actx = null;
Sound.whenReady(c => { actx = c; });
function ui(event) {
  if (Sound.has(event)) { Sound.near(event, 1, 1, 'ui'); return; }
  if (!actx || actx.state !== 'running') return;
  const out = actx.createGain();
  out.gain.value = 0.5;
  out.connect(Sound.gainFor('ui'));
  const t = actx.currentTime + 0.01;
  if (event === 'ui.toast.challenge_complete') fanfare(out, t);
  else swish(out, t, event === 'ui.toast.in');
}
// filtered noise, its band sweeping up (in) or down (out)
let noise = null;
function swish(out, t, up) {
  if (!noise) {
    noise = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = actx.createBufferSource(); src.buffer = noise;
  const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
  f.frequency.setValueAtTime(up ? 500 : 2200, t); f.frequency.exponentialRampToValueAtTime(up ? 2200 : 500, t + 0.32);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t); src.stop(t + 0.4);
}
// a short rising arpeggio and a held chord, soft square and triangle tones
function fanfare(out, t) {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((hz, i) => tone(out, hz, t + i * 0.11, 0.16, 'square', 0.07));
  for (const hz of [523.25, 659.25, 783.99, 1046.5]) tone(out, hz, t + 0.46, 1.1, 'triangle', 0.12);
  tone(out, 1318.5, t + 0.46, 1.1, 'sine', 0.05);
}
function tone(out, hz, t, len, type, peak) {
  const o = actx.createOscillator(); o.type = type; o.frequency.value = hz;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + len + 0.05);
}

export const AdvToast = {
  queue: [],        // waiting
  shown: [],        // { a, slot, t0, out (the time it started leaving), sounded }
  add(a) { this.queue.push(a); },
  /* New Recipes Unlocked! (js/recipes.js): recipes that come while one is up or waiting join it, and it
     stays 5 seconds from the last of them, showing each result in turn, as the game's does */
  addRecipes(ids) {
    const open = this.shown.find(s => s.a.recipe && !s.out), r = open ? open.a : this.queue.find(a => a.recipe);
    if (r) { for (const id of ids) if (r.ids.length < 64 && !r.ids.includes(id)) r.ids.push(id); if (open) open.changed = performance.now(); return; }
    this.queue.push({ recipe: true, ids: ids.slice(0, 64) });
  },
  clear() { this.queue.length = 0; this.shown.length = 0; },
  get busy() { return this.queue.length > 0 || this.shown.length > 0; },
  update(now) {
    // the finished ones go; waiting ones take free slots from the top
    this.shown = this.shown.filter(s => !(s.out && now - s.out >= SLIDE));
    for (const s of this.shown) if (!s.out && now - Math.max(s.t0, s.changed || 0) >= SLIDE + SHOW) { s.out = now; ui('ui.toast.out'); }
    while (this.queue.length && this.shown.length < SLOTS) {
      const used = new Set(this.shown.map(s => s.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      const a = this.queue.shift();
      this.shown.push({ a, slot, t0: now, out: 0 });
      ui('ui.toast.in');
      if (a.frame === 'challenge') ui('ui.toast.challenge_complete');
    }
  },
  overlay(gui, icons) {
    const self = this;
    return {
      get animates() { self.update(performance.now()); return self.shown.length > 0; },
      draw(g) { self.draw(g, icons); },
    };
  },
  draw(g, icons) {
    if (!this.shown.length || !g.font) return;
    const now = performance.now();
    for (const s of this.shown) {
      // (in and out alike: the share of the slide's time gone, squared, as the game eases it)
      const k = Math.min(1, (now - (s.out || s.t0)) / SLIDE), v = s.out ? 1 - k * k : k * k;
      const x = Math.round(g.width - W * v), y = s.slot * H;
      if (s.a.recipe) drawRecipeToast(g, icons, s.a, x, y, now - s.t0);
      // (the toast's own clock starts once it is in)
      else drawToast(g, icons, s.a, x, y, Math.max(0, now - s.t0 - SLIDE));
    }
  },
};

/* black edge, a 2 px border and the inside (grey and dark; a recipe's light); the corners are cut in
   steps, two at the top left and bottom right and three at the other two, as the game's toast is */
function box(g, x, y, E = 0xFF555555, F = 0xFF212121) {
  const K = 0xFF000000;
  g.fill(x + 2, y, x + W - 3, y + 1, K); g.fill(x + 3, y + H - 1, x + W - 2, y + H, K);
  g.fill(x, y + 2, x + 1, y + H - 3, K); g.fill(x + W - 1, y + 3, x + W, y + H - 2, K);
  g.fill(x + 1, y + 1, x + 2, y + 2, K); g.fill(x + W - 3, y + 1, x + W - 2, y + 2, K); g.fill(x + W - 2, y + 2, x + W - 1, y + 3, K);
  g.fill(x + 1, y + H - 3, x + 2, y + H - 2, K); g.fill(x + 2, y + H - 2, x + 3, y + H - 1, K); g.fill(x + W - 2, y + H - 2, x + W - 1, y + H - 1, K);
  g.fill(x + 2, y + 1, x + W - 3, y + 2, E); g.fill(x + 1, y + 2, x + W - 2, y + 3, E); g.fill(x + 1, y + 3, x + W - 1, y + H - 3, E);
  g.fill(x + 2, y + H - 3, x + W - 1, y + H - 2, E); g.fill(x + 3, y + H - 2, x + W - 2, y + H - 1, E);
  g.fill(x + 4, y + 3, x + W - 4, y + H - 3, F); g.fill(x + 3, y + 4, x + W - 3, y + H - 4, F);
}
// New Recipes Unlocked!: the light box, the results one after another (all of them within the 5 seconds)
function drawRecipeToast(g, icons, r, x, y, age) {
  box(g, x, y, 0xFFA0A0A0, 0xFFE8E8E8);
  g.text('New Recipes Unlocked!', x + 30, y + 7, 0x500050, false);
  g.text('Check your recipe book', x + 30, y + 18, 0x000000, false);
  const id = r.ids.length ? r.ids[Math.floor(age / Math.max(1, SHOW / r.ids.length)) % r.ids.length] : 0;
  if (id && icons) drawStack(g, icons, { id, count: 1 }, x + 8, y + 8);
}
function drawToast(g, icons, a, x, y, age) {
  box(g, x, y);
  const colour = a.frame === 'challenge' ? 0xFF88FF : 0xFFFF00;
  const lines = g.font.wrap(a.title, 125);
  if (lines.length <= 1) {
    g.text(HEAD[a.frame] || HEAD.task, x + 30, y + 7, colour, false);
    g.text(a.title, x + 30, y + 18, 0xFFFFFF, false);
  } else if (age < 1500) {
    const k = Math.max(0, Math.min(1, (1500 - age) / 300));
    g.ctx.globalAlpha = Math.max(0.02, k);
    g.text(HEAD[a.frame] || HEAD.task, x + 30, y + 11, colour, false);
    g.ctx.globalAlpha = 1;
  } else {
    const k = Math.max(0, Math.min(1, (age - 1500) / 300));
    g.ctx.globalAlpha = Math.max(0.02, k);
    let ty = 16 - Math.floor(lines.length * 9 / 2);
    for (const l of lines) { g.text(l, x + 30, y + ty, 0xFFFFFF, false); ty += 9; }
    g.ctx.globalAlpha = 1;
  }
  const st = iconStack(a);
  if (st && icons) drawStack(g, icons, st, x + 8, y + 8);
}
