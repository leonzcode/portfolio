/* ---------------------------------------------------------------------------
   Leoncraft 2 - the F3 screen's lines, laid out as the game's: the version and
   frame rate, what is being drawn, then where you are (XYZ, the block and its
   place in the chunk section, the chunk and its region file, which way you
   face with the game's yaw and pitch, the light where you stand, the biome,
   the local difficulty and the day), and on the right what the page runs on
   and what the crosshair is on.

   The numbers are ours where the game's have no meaning in a browser (the
   browser for Java, the page's memory for the JVM's, the graphics card's name
   as the browser gives it). Everything is worked out only while F3 is up.
--------------------------------------------------------------------------- */
import { BIOMES } from '../biomes.js?v=24';
import { BLOCKS } from '../blocks.js?v=24';
import { presetNow } from './video.js?v=24';

const FACING = [
  ['north', 'Towards negative Z'], ['west', 'Towards negative X'],
  ['south', 'Towards positive Z'], ['east', 'Towards positive X'],
];
// the game's moon brightness by phase, for the local difficulty
const MOON = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75];
const DIFF = { peaceful: 0, easy: 1, normal: 2, hard: 3 };
const LEVEL = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High', rip: 'RIP Computer' };
const wrapDeg = a => { a %= 360; if (a >= 180) a -= 360; if (a < -180) a += 360; return a; };

/* The game's regional difficulty (with no time spent in the chunk counted):
   the day count raises it after the first hour, the moon adds to it */
function localDifficulty(diff, ticks) {
  const d = DIFF[diff] ?? 2;
  if (!d) return [0, 0];
  const f1 = Math.min(1, Math.max(0, (ticks - 72000) / 1440000)) * 0.25;
  let f2 = Math.min(Math.max(MOON[Math.floor(ticks / 24000) % 8] * 0.25, 0), f1);
  if (d === 1) f2 *= 0.5;
  const v = d * (0.75 + f1 + f2);
  return [v, v < 2 ? 0 : v > 4 ? 1 : (v - 2) / 2];
}

// the graphics card's name, asked for once (a query waits for the graphics process)
let gpu = null;
function gpuName(renderer) {
  if (gpu) return gpu;
  gpu = ['', ''];
  try {
    const gl = renderer.gl || (renderer.r && renderer.r.getContext && renderer.r.getContext());
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = [String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)), String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))];
  } catch (e) { /* the browser keeps it to itself */ }
  /* the card's own name out of the browser's wrapping, as the game shows it:
     "ANGLE (NVIDIA, NVIDIA GeForce GTX 745 (0x00001382) Direct3D11 ..., D3D11)"
     is "NVIDIA GeForce GTX 745", the vendor "Google Inc. (NVIDIA)" is "NVIDIA" */
  const m = gpu[1].match(/^ANGLE \((.*)\)$/);
  if (m) {
    const parts = m[1].split(', ');
    const name = (parts[1] || parts[0]).replace(/^ANGLE \w+ Renderer:\s*/, '').replace(/\s*\(0x[0-9a-f]+\).*$/i, '').replace(/\s+(Direct3D|OpenGL|Vulkan).*$/, '');
    gpu = [parts[0], name];
  } else { const v = gpu[0].match(/\(([^)]+)\)/); if (v) gpu[0] = v[1]; }
  return gpu;
}
function browserName() {
  const ua = navigator.userAgent;
  const m = ua.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/);
  const name = !m ? 'Browser' : m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : m[1] === 'Version' ? 'Safari' : m[1];
  return name + (m ? ' ' + m[2] : '') + (/x64|Win64|x86_64|arm64|aarch64/i.test(ua) ? ' 64bit' : '');
}

/* s: { fps, g (the game), player, world, renderer, inter, options, level (the Shaders button's), Y0, timeRuns } */
export function debugLines(s) {
  const { g, player: P, world: W, renderer: R, inter, options: o, Y0 } = s;
  const p = P.pos;
  const bx = Math.floor(p.x), by = Math.floor(p.y + Y0), bz = Math.floor(p.z);
  const cx = bx >> 4, cz = bz >> 4;
  const yaw = wrapDeg(180 - P.yaw * 180 / Math.PI), pitch = -P.pitch * 180 / Math.PI;
  const [face, towards] = FACING[((Math.round(P.yaw / (Math.PI / 2)) % 4) + 4) % 4];
  const E = g.entities, t = E && E.t;
  const ly = Math.floor(p.y);
  const sky = t ? t.sky(bx, ly, bz) : 15, block = t ? t.block(bx, ly, bz) : 0;
  const bn = BIOMES[W.biomeAt(bx, bz)];
  const ticks = g.time;
  const [ld, cl] = localDifficulty(o.get('difficulty') || 'normal', ticks);
  const maxFps = +o.get('maxFps') || 0, preset = presetNow(o);
  const clouds = o.get('clouds');
  const parts = R.particles ? R.particles.list.length : 0;
  const ents = E ? E.list.length : 0;
  const left = [
    'Leoncraft 2 (26.1.2/vanilla)',
    s.fps + ' fps T: ' + (maxFps ? maxFps : 'inf') + (o.get('vsync') !== false ? ' vsync' : '') + ' ' + (preset === 'custom' ? 'fancy' : preset)
      + (clouds === 'off' ? '' : ' ' + clouds + '-clouds') + ' B: ' + (o.get('biomeBlend') ?? 2),
    'C: ' + R.columns.size + '/' + W.chunks.size + ' D: ' + W.renderDist,
    'E: ' + ents + ', P: ' + parts,
    'minecraft:' + g.dim,
    '',
    'XYZ: ' + p.x.toFixed(3) + ' / ' + (p.y + Y0).toFixed(5) + ' / ' + p.z.toFixed(3),
    'Block: ' + bx + ' ' + by + ' ' + bz + ' [' + (bx & 15) + ' ' + (by & 15) + ' ' + (bz & 15) + ']',
    'Chunk: ' + cx + ' ' + (by >> 4) + ' ' + cz + ' [' + (cx & 31) + ' ' + (cz & 31) + ' in r.' + (cx >> 5) + '.' + (cz >> 5) + '.mca]',
    'Facing: ' + face + ' (' + towards + ') (' + yaw.toFixed(1) + ' / ' + pitch.toFixed(1) + ')',
    'Client Light: ' + Math.max(sky, block) + ' (' + sky + ' sky, ' + block + ' block)',
    'Biome: minecraft:' + (bn ? bn.name : 'plains'),
    'Local Difficulty: ' + ld.toFixed(2) + ' // ' + cl.toFixed(2) + ' (Day ' + Math.floor(ticks / 24000) + ')' + (s.timeRuns ? '' : ' (time stopped)'),
    '',
    'For help: press F3 + Q',
  ];
  const mem = performance.memory;
  const [vendor, card] = gpuName(R);
  const right = [browserName()];
  if (mem) {
    const used = mem.usedJSHeapSize / 1048576, lim = mem.jsHeapSizeLimit / 1048576, tot = mem.totalJSHeapSize / 1048576;
    right.push('Mem: ' + Math.round(used * 100 / lim) + '% ' + Math.round(used) + '/' + Math.round(lim) + 'MB',
      'Allocated: ' + Math.round(tot * 100 / lim) + '% ' + Math.round(tot) + 'MB');
  }
  right.push('', 'CPU: ' + (navigator.hardwareConcurrency || 1) + 'x', '',
    'Display: ' + R.rw + 'x' + R.rh + (vendor ? ' (' + vendor + ')' : ''));
  if (card) right.push(card);
  right.push('Shaders: ' + (LEVEL[s.level] || s.level));
  const tg = inter.target;
  if (tg) right.push('', 'Targeted Block: ' + tg.x + ', ' + (tg.y + Y0) + ', ' + tg.z, 'minecraft:' + BLOCKS[tg.b].name);
  const te = inter.entityTarget;
  if (te) right.push('', 'Targeted Entity', 'minecraft:' + te.type);
  return [left, right];
}
