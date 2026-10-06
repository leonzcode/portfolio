/* Leoncraft 2 - a worker: makes chunks and meshes them, off the main thread. */
import { Gen } from './worldgen.js?v=16';
import { VanillaGen } from './gen/vanillagen.js?v=16';
import { meshColumn, setColours } from './mesher.js?v=16';
import { resolveTextures } from './blocks.js?v=16';
import { NetherGen } from './gen/nether.js?v=16';
import { EndGen } from './gen/end.js?v=16';
import { worldStructures, structureMessage } from './struct/hook.js?v=16';

let gen = null, structs = null;

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') {
    // each dimension has its own generator (js/dims.js); the Overworld is Minecraft's own for worlds
    // made as Vanilla Seed, the first generator for the rest
    gen = m.dim === 'the_nether' ? new NetherGen(m.seed) : m.dim === 'the_end' ? new EndGen(m.seed)
      : m.generator === 'vanilla' ? new VanillaGen(String(m.seed)) : new Gen(m.seed | 0);
    // structures read their biomes and heights from whichever generator this is (fortresses and
    // bastions in the Nether, end cities in the End)
    structs = worldStructures(m.generator === 'vanilla' ? String(m.seed) : m.seed | 0, gen, m.dim || 'overworld');
    resolveTextures(m.manifest);
    setColours(m.colours);
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'gen') {
    const c = gen.generate(m.cx, m.cz);
    const extra = structs ? structs.build(c, m.cx, m.cz) : null;      // the structures reaching into this chunk
    self.postMessage({ type: 'gen', id: m.id, cx: m.cx, cz: m.cz, blocks: c.blocks, meta: c.meta, biome: c.biome, top: c.top, structs: extra },
      [c.blocks.buffer, c.meta.buffer, c.biome.buffer]);
    return;
  }
  if (m.type === 'mesh') {
    const out = meshColumn(m);
    const transfer = [];
    for (const k of ['opaque', 'cutout', 'translucent', 'fluid', 'plants', 'leafIn']) {
      const g = out[k];
      if (!g) continue;
      for (const a of g.attrs) transfer.push(a.buffer);
      transfer.push(g.index.buffer);
    }
    if (out.light) transfer.push(out.light.buffer);
    self.postMessage({ type: 'mesh', id: m.id, cx: m.cx, cz: m.cz, version: m.version, mesh: out, urgent: m.urgent }, transfer);
    return;
  }
  if (m.type === 'structures') {
    self.postMessage(Object.assign({ type: 'structures', id: m.id }, structureMessage(structs, m)));
    return;
  }
  if (m.type === 'surface') {
    // the ground height at a column, for finding somewhere to stand
    self.postMessage({ type: 'surface', id: m.id, y: gen.surfaceAt(m.x, m.z), biome: m.withBiome ? gen.climate(m.x, m.z) : null });
  }
};
