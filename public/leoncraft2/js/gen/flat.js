/* ---------------------------------------------------------------------------
   Leoncraft 2 - Superflat worlds (World Type: Superflat), as the game makes
   them: layers of blocks from the bottom of the world (y -64) up, one biome
   everywhere, and only the structures the preset names.

   A world's generator is the text 'flat:' + the preset code + '|' + its
   structures, the code in the game's own form, bottom layer first:
     minecraft:bedrock,2*minecraft:dirt,minecraft:grass_block;minecraft:plains
   (the "minecraft:" may be left out). The Void (one layer of air) has the
   game's start platform: 33 x 33 stone at y -61 from (-8, -8) to (24, 24),
   cobblestone in its middle, where you start.

   PRESETS are the game's nine, in its order, with their names and the
   structures each has (here only those that sit right on flat ground: the
   villages, pillager outposts, igloos and desert temples, and under the
   Tunnelers' Dream's 230 layers of stone its mineshafts and strongholds).
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=107';
import { BIO } from '../biomes.js?v=107';
import { H, Y0, VOL, idx } from '../world-const.js?v=107';
import { stateOf } from './states.js?v=107';

export const PRESETS = [
  { name: 'Classic Flat', icon: 'grass_block', code: 'minecraft:bedrock,2*minecraft:dirt,minecraft:grass_block;minecraft:plains', structures: ['village_plains'] },
  { name: 'Tunnelers\' Dream', icon: 'stone', code: 'minecraft:bedrock,230*minecraft:stone,5*minecraft:dirt,minecraft:grass_block;minecraft:windswept_hills', structures: ['mineshaft', 'stronghold'] },
  { name: 'Water World', icon: 'water_bucket', code: 'minecraft:bedrock,64*minecraft:deepslate,5*minecraft:stone,5*minecraft:dirt,5*minecraft:gravel,90*minecraft:water;minecraft:deep_ocean', structures: [] },
  { name: 'Overworld', icon: 'short_grass', code: 'minecraft:bedrock,59*minecraft:stone,3*minecraft:dirt,minecraft:grass_block;minecraft:plains', structures: ['village_plains', 'pillager_outpost'] },
  { name: 'Snowy Kingdom', icon: 'snow', code: 'minecraft:bedrock,59*minecraft:stone,3*minecraft:dirt,minecraft:grass_block,minecraft:snow;minecraft:snowy_plains', structures: ['village_snowy', 'igloo'] },
  { name: 'Bottomless Pit', icon: 'feather', code: '2*minecraft:cobblestone,3*minecraft:dirt,minecraft:grass_block;minecraft:plains', structures: ['village_plains'] },
  { name: 'Desert', icon: 'sand', code: 'minecraft:bedrock,3*minecraft:stone,52*minecraft:sandstone,8*minecraft:sand;minecraft:desert', structures: ['village_desert', 'desert_pyramid'] },
  { name: 'Redstone Ready', icon: 'redstone', code: 'minecraft:bedrock,3*minecraft:stone,116*minecraft:sandstone;minecraft:desert', structures: [] },
  { name: 'The Void', icon: 'barrier', code: 'minecraft:air;minecraft:the_void', structures: [] },
];
export const DEFAULT_FLAT = PRESETS[0];
// the generator text for a preset (or a code typed in: no structures, as the game's own would have none it knows of)
export const flatGenerator = (code, structures) => 'flat:' + code + '|' + (structures || []).join(',');
export function presetOf(code) { const c = String(code || '').replace(/minecraft:/g, ''); return PRESETS.find(p => p.code.replace(/minecraft:/g, '') === c) || null; }

/* The layers of a code, bottom first, as [block id, meta, count], and its
   biome; null when it cannot be read (an unknown block, or more layers than
   the world is tall), as the game refuses such a code. */
export function parseFlat(code) {
  const [layersText, biomeText] = String(code || '').split(';');
  const layers = [];
  let total = 0;
  for (const part of (layersText || '').split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(?:(\d+)\*)?(?:minecraft:)?([a-z0-9_]+)$/.exec(t);
    if (!m) return null;
    const n = m[1] ? +m[1] : 1, name = m[2];
    if (name !== 'air' && B[name] === undefined) return null;
    const st = name === 'air' ? { id: 0, meta: 0 } : stateOf(name);
    layers.push([st.id, st.meta, n]);
    total += n;
  }
  if (!layers.length || total > H) return null;
  const biomeName = String(biomeText || 'plains').trim().replace(/^minecraft:/, '') || 'plains';
  return { layers, biomeName, biome: BIO[biomeName] !== undefined ? BIO[biomeName] : BIO.plains, void: biomeName === 'the_void' };
}

export class FlatGen {
  constructor(seed, spec) {
    this.seed = seed | 0;
    const [code, structures] = String(spec || DEFAULT_FLAT.code).split('|');
    this.def = parseFlat(code) || parseFlat(DEFAULT_FLAT.code);
    this.flat = true;
    // the structures this world may have (struct/starts.js reads it), and the sea level the game gives a flat world
    this.allowStructures = new Set((structures || '').split(',').filter(Boolean));
    this.seaLevel = -63;
    // one column, worked out once
    const col = this.col = new Uint16Array(H), cm = this.colMeta = new Uint8Array(H);
    let y = 0;
    for (const [id, meta, n] of this.def.layers) for (let k = 0; k < n && y < H; k++, y++) { col[y] = id; cm[y] = meta; }
    let top = -1;
    for (let i = H - 1; i >= 0; i--) if (col[i]) { top = i; break; }
    this.top = top;
    // where you start: on the platform in The Void, else at 0, 0 (the game's spawn on flat land)
    this.spawnAt = this.def.void ? { x: 8, z: 8 } : { x: 0, z: 0 };
  }
  generate(cx, cz) {
    const blocks = new Uint16Array(VOL), meta = new Uint8Array(VOL), biome = new Uint8Array(256).fill(this.def.biome);
    let top = this.top;
    for (let y = 0; y <= this.top; y++) {
      const id = this.col[y], m = this.colMeta[y];
      if (!id) continue;
      for (let i = 0; i < 256; i++) { blocks[(y << 8) | i] = id; meta[(y << 8) | i] = m; }
    }
    // The Void: the start platform where it reaches into this chunk
    if (this.def.void) {
      const py = -61 - Y0, x0 = cx * 16, z0 = cz * 16;
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const wx = x0 + x, wz = z0 + z;
        if (wx < -8 || wx > 24 || wz < -8 || wz > 24) continue;
        blocks[idx(x, py, z)] = wx === 8 && wz === 8 ? B.cobblestone : B.stone;
        top = Math.max(top, py);
      }
    }
    return { blocks, meta, biome, top: Math.max(0, top) };
  }
  // the top block of a column (index y), -1 for none
  surfaceAt(x, z) {
    if (this.def.void) return x >= -8 && x <= 24 && z >= -8 && z <= 24 ? -61 - Y0 : -1;
    return this.top;
  }
  // the one biome, for the structures (struct/starts.js) and the spawn search
  noiseBiome() { return this.def.biome; }
  climate() { return this.def.biome; }
}
