/* ---------------------------------------------------------------------------
   Leoncraft 2 - the music, chosen as the game's MusicManager chooses it.

   Once a tick (20 a second, the title screen included) the situation picks
   the music that belongs to it, with the game's delays (in ticks) before a
   track and whether it may cut the one playing short:

     title screen          music.menu         20 - 600     (1 - 30 seconds), replacing
     credits               music.credits      0, at once, replacing
     the End, dragon alive music.dragon       0, at once, replacing
     the End               music.end          6000 - 24000
     under water (ocean or river, the eyes under)  music.under_water  12000 - 24000
     the Nether            music.nether.<biome> 12000 - 24000 (none in warped forests)
     creative (flying)     music.creative     12000 - 24000
     anywhere else         music.overworld.<biome> or music.game  12000 - 24000
     a pale garden         no music: what plays fades out

   Entering or leaving a world stops the music, and the first track waits
   100 ticks; after a track, the delay starts again (Music Frequency:
   Default 10 - 20 minutes, Frequent half that, Constant 5 seconds). Music
   that replaces stops another kind playing and comes within half its
   shortest delay; otherwise a track plays on to its end (a walk from a
   forest into a desert lets the forest's track finish). Music at 0% plays
   nothing.
--------------------------------------------------------------------------- */
import { Sound } from './sound.js?v=107';

const NONE = null;
const KINDS = {
  menu: [20, 600, true],
  credits: [0, 0, true],
  dragon: [0, 0, true],
  end: [6000, 24000, false],
  under_water: [12000, 24000, false],
  nether: [12000, 24000, false],
  creative: [12000, 24000, false],
  game: [12000, 24000, false],
};
const NETHER_BIOMES = { nether_wastes: 1, crimson_forest: 1, soul_sand_valley: 1, basalt_deltas: 1, warped_forest: 0 };
const BIOME_MUSIC = new Set(['badlands', 'bamboo_jungle', 'cherry_grove', 'deep_dark', 'desert', 'dripstone_caves', 'flower_forest', 'forest', 'frozen_peaks',
  'grove', 'jagged_peaks', 'jungle', 'lush_caves', 'meadow', 'old_growth_taiga', 'snowy_slopes', 'sparse_jungle', 'stony_peaks', 'swamp']);
const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export const Music = {
  options: null,
  current: null,          // { voice, event, kind }
  nextDelay: 100,
  playingName: '',        // the track's file name (for the music toast)
  onTrack: null,          // (name) a new track started
  init(options) {
    this.options = options;
    options.onChange(k => {
      // turned down to nothing: what plays stops at once (the game's music slider at OFF disables music)
      if (k === 'soundVolumes' && Sound.volume('music') <= 0) this.stop();
    });
  },
  delayFor(kind) {
    const [lo, hi] = KINDS[kind] || KINDS.game;
    if (hi === 0) return 0;
    const f = this.options ? this.options.get('musicFrequency') : 'default';
    if (f === 'constant') return 100;
    if (f === 'frequent') return between(lo >> 1, hi >> 1);
    return between(lo, hi);
  },
  stop() { if (this.current) { Sound.stop(this.current.voice); this.current = null; } },
  /* s: { kind, event, fade } for this tick (situation() below) */
  tick(s) {
    if (!Sound.ctx || Sound.ctx.state !== 'running') return;
    const cur = this.current;
    if (cur && cur.voice && cur.voice.stopped) { this.current = null; this.nextDelay = Math.min(this.nextDelay, this.delayFor(cur.kind)); }
    // a pale garden: the music fades to nothing while you are in it
    if (s && s.silence) {
      if (this.current && this.current.voice.g) { this.current.fading = true; fadeTo(this.current.voice, 0, 2); }
      return;
    } else if (this.current && this.current.fading) { this.current.fading = false; fadeTo(this.current.voice, 1, 2); }
    if (!s || Sound.volume('music') <= 0) { if (!s) this.nextDelay = Math.max(this.nextDelay, 100); return; }
    const [lo, hi, replace] = KINDS[s.kind] || KINDS.game;
    // music that replaces (the menu's, the dragon's, the credits'): what plays of another kind stops, and it comes within half its shortest delay
    if (this.current && this.current.kind !== s.kind && replace) { this.stop(); this.nextDelay = between(0, lo >> 1); }
    // (a walk into another biome lets the track playing finish, as in the game)
    if (!this.current) {
      // (the dragon's and the credits' music wait 0 ticks; the menu's no more than 600)
      this.nextDelay = Math.min(this.nextDelay, this.scaled(hi));
      if (this.nextDelay-- <= 0) this.start(s);
    }
  },
  scaled(hi) { const f = this.options ? this.options.get('musicFrequency') : 'default'; return hi === 0 ? 0 : f === 'constant' ? 100 : f === 'frequent' ? hi >> 1 : hi; },
  // a world was entered or left: what played stops (the loading screen stops the game's music), the next comes after 5 seconds
  reset() { this.stop(); this.nextDelay = 100; },
  start(s) {
    const kind = s.kind;
    const v = Sound.stream(Sound.has(s.event) ? s.event : 'music.game', 'music', {
      onEnd: failed => { if (this.current && this.current.voice === v) { this.current = null; this.nextDelay = failed ? 600 : this.delayFor(kind); } },
    });
    if (!v) { this.nextDelay = 100; return; }
    this.current = { voice: v, kind, event: s.event };
    this.nextDelay = Number.MAX_SAFE_INTEGER;
    this.playingName = v.track || '';
    if (this.onTrack) try { this.onTrack(this.playingName); } catch (e) {}
  },
};

function fadeTo(v, to, secs) {
  if (!v || !v.g || !Sound.ctx) return;
  const g = v.g.gain, t = Sound.ctx.currentTime, base = Math.min(1, (v.base || 1) * Sound.volume('music'));
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(base * to, t + secs);
}

/* What the game would play now. g: the game being played or null (the title).
   o: { creative, dim, biome name at the player, eyeInWater, waterBiome, dragonAlive, credits } */
export function situation(o) {
  if (!o) return { kind: 'menu', event: 'music.menu' };
  if (o.credits) return { kind: 'credits', event: 'music.credits' };
  if (o.dim === 'the_end') return o.dragonAlive ? { kind: 'dragon', event: 'music.dragon' } : { kind: 'end', event: 'music.end' };
  if (o.biome === 'pale_garden') return { silence: true };
  if (o.eyeInWater && o.waterBiome) return { kind: 'under_water', event: 'music.under_water' };
  if (o.dim === 'the_nether') {
    if (NETHER_BIOMES[o.biome] === 0) return null;
    return { kind: 'nether', event: 'music.nether.' + (NETHER_BIOMES[o.biome] ? o.biome : 'nether_wastes') };
  }
  if (o.creative) return { kind: 'creative', event: 'music.creative' };
  if (BIOME_MUSIC.has(o.biome)) return { kind: 'game', event: 'music.overworld.' + o.biome };
  return { kind: 'game', event: 'music.game' };
}
export { NONE };
