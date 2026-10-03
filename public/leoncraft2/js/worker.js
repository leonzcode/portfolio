/* Leoncraft 2 - a worker: makes chunks and meshes them, off the main thread. */
import { Gen } from './worldgen.js?v=2';
import { meshColumn, setColours } from './mesher.js?v=2';
import { resolveTextures } from './blocks.js?v=2';

let gen = null;

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') {
    gen = new Gen(m.seed);
    resolveTextures(m.manifest);
    setColours(m.colours);
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'gen') {
    const c = gen.generate(m.cx, m.cz);
    self.postMessage({ type: 'gen', id: m.id, cx: m.cx, cz: m.cz, blocks: c.blocks, meta: c.meta, biome: c.biome, top: c.top },
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
    self.postMessage({ type: 'mesh', id: m.id, cx: m.cx, cz: m.cz, version: m.version, mesh: out }, transfer);
    return;
  }
  if (m.type === 'surface') {
    // the ground height at a column, for finding somewhere to stand
    self.postMessage({ type: 'surface', id: m.id, y: gen.surfaceAt(m.x, m.z), biome: m.withBiome ? gen.climate(m.x, m.z) : null });
  }
};
