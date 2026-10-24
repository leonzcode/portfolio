/* ---------------------------------------------------------------------------
   Leoncraft 2 - the music toast (Music & Sounds: Music Toast).

   Never: nothing. Pause Menu: the track playing, shown in the top right of
   the game menu. Pause Menu and Toast: that, and a toast sliding in at the
   top right for 5 seconds whenever a new track starts. The words are the
   track's: "author - title" for Leoncraft's own music, the game's own name
   for it with the player's own Minecraft sounds (from its en_us.json).
--------------------------------------------------------------------------- */
import { Music } from './music.js?v=107';
import { SoundPacks } from './packs.js?v=107';

const SHOW = 5000, SLIDE = 250;

export function trackName(name) {
  if (!name) return '';
  const mc = SoundPacks.mc, own = SoundPacks.own;
  if (mc && mc.lang) { const t = mc.lang[name.replace(/\//g, '.')]; if (t) return t; }
  const m = own && own.music && own.music[name];
  if (m) return m.by.split(' (')[0] + ' - ' + m.title;
  // a name with no words for it: the file's own, tidied
  const last = name.split('/').pop().replace(/_/g, ' ');
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export const MusicToast = {
  options: null, t0: 0, text: '', sig: '',
  init(options, gui) {
    this.options = options;
    Music.onTrack = name => {
      this.text = trackName(name);
      if (options.get('musicToast') === 'toast') this.t0 = performance.now();
    };
    gui.overlays.push(this.overlay(gui));
  },
  pauseOpen(gui) { const s = gui.screen; return !!(s && s.title === 'Game Menu' && gui.inGame); },
  overlay(gui) {
    const self = this;
    return {
      get animates() {
        const mode = self.options.get('musicToast'), now = performance.now();
        const playing = !!(Music.current && !Music.current.voice.stopped);
        const s = (mode !== 'never' && playing && self.pauseOpen(gui) ? 'p' : '') + (now - self.t0 < SHOW + SLIDE ? Math.floor((now - self.t0) / 16) : '') + self.text;
        if (s === self.sig) return false;
        self.sig = s;
        return true;
      },
      draw(g) { self.draw(g, gui); },
    };
  },
  draw(g, gui) {
    const mode = this.options.get('musicToast');
    if (mode === 'never' || !this.text) return;
    const playing = !!(Music.current && !Music.current.voice.stopped);
    if (!playing) return;
    const now = performance.now(), age = now - this.t0;
    let slide = -1;
    if (age < SHOW + SLIDE * 2 && mode === 'toast') slide = age < SLIDE ? age / SLIDE : age > SHOW + SLIDE ? Math.max(0, 1 - (age - SHOW - SLIDE) / SLIDE) : 1;
    if (this.pauseOpen(gui)) slide = 1;
    if (slide <= 0) return;
    const w = Math.min(g.width - 8, g.textWidth(this.text) + 30), h = 20;
    const x = Math.round(g.width - w * slide), y = 0;
    g.fill(x, y, x + w, y + h, 0xE0101010);
    g.fill(x, y + h - 1, x + w, y + h, 0xFF505050);
    g.fill(x, y, x + 1, y + h, 0xFF505050);
    // a note, drawn in pixels
    const nx = x + 7, ny = y + 5;
    g.fill(nx + 4, ny, nx + 5, ny + 8, 0xFFFFFFFF);
    g.fill(nx + 5, ny, nx + 8, ny + 1, 0xFFFFFFFF);
    g.fill(nx + 7, ny + 1, nx + 8, ny + 3, 0xFFFFFFFF);
    g.fill(nx + 1, ny + 7, nx + 5, ny + 10, 0xFFFFFFFF);
    g.text(g.font.trim ? g.font.trim(this.text, w - 26) : this.text, x + 22, y + 6, 0xFFFFFF, false);
  },
};
