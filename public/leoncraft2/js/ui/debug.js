/* ---------------------------------------------------------------------------
   Leoncraft 2 - the F3 screen's lines, as the game's default debug profile
   shows them since the screen was reworked (26.x: only what is "In F3" by
   default): on the left the version, the frame rate, the integrated
   server's tick, the clouds, biome blend and texture filtering, then where
   you are (XYZ, the block, its place in the chunk section, the chunk and its
   region file, which way you face with the game's yaw and pitch, the
   dimension); on the right the memory, the CPU and the display and
   graphics card. The counters, light, biome, difficulty and targeted block
   the older screen showed are off by default in the game, so off here too.

   The numbers are ours where the game's have no meaning in a browser (the
   browser for Java, the page's memory for the JVM's, the graphics card's name
   as the browser gives it). Everything is worked out only while F3 is up.
--------------------------------------------------------------------------- */

const FACING = [
  ['north', 'Towards negative Z'], ['west', 'Towards negative X'],
  ['south', 'Towards positive Z'], ['east', 'Towards positive X'],
];
const LEVEL = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High', rip: 'RIP Computer' };
const wrapDeg = a => { a %= 360; if (a >= 180) a -= 360; if (a < -180) a += 360; return a; };
const two = n => String(n).padStart(2, '0');
// Video Settings' Texture Filtering, as the game names it
const FILTER_NAME = { none: 'None', rgss: 'RGSS', anisotropic: 'Anisotropic' };

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

/* F3 + Q: the game's whole list of F3 keys, in its order (the chat prints them) */
export const F3_HELP = ['§e§l[Debug]:§r Key bindings:',
  'F3 + A = Reload chunks', 'F3 + B = Show hitboxes', 'F3 + C = Copy location as /tp command, or hold for 10 seconds to crash the game',
  'F3 + D = Clear chat', 'F3 + G = Show chunk boundaries', 'F3 + H = Advanced tooltips', 'F3 + I = Copy entity or block data to clipboard',
  'F3 + L = Start/stop profiling', 'F3 + N = Cycle previous game mode <-> spectator', 'F3 + P = Pause on lost focus', 'F3 + Q = Show this list',
  'F3 + S = Dump dynamic textures', 'F3 + T = Reload resource packs', 'F3 + V = Client version info', 'F3 + Esc = Pause without pause menu (if pausing is possible)',
  'F3 + F4 = Open game mode switcher', 'F3 + F6 = Edit debug options'];

/* s: { fps, g (the game), player, world, renderer, inter, options, level (the Shaders button's), Y0, timeRuns } */
// the heap's growth a second (what the game calls the allocation rate), from the browser's own count
let lastUsed = 0, lastAt = 0, rate = 0;
function allocRate(used) {
  const now = performance.now();
  if (lastAt && now > lastAt) {
    const grew = Math.max(0, used - lastUsed) / ((now - lastAt) / 1000);
    rate = rate ? rate * 0.8 + grew * 0.2 : grew;
  }
  lastUsed = used; lastAt = now;
  return rate;
}
export function debugLines(s) {
  const { g, player: P, renderer: R, options: o, Y0 } = s;
  const p = P.pos;
  const bx = Math.floor(p.x), by = Math.floor(p.y + Y0), bz = Math.floor(p.z);
  const cx = bx >> 4, cz = bz >> 4;
  const yaw = wrapDeg(180 - P.yaw * 180 / Math.PI), pitch = -P.pitch * 180 / Math.PI;
  const [face, towards] = FACING[((Math.round(P.yaw / (Math.PI / 2)) % 4) + 4) % 4];
  const maxFps = +o.get('maxFps') || 0;
  const clouds = o.get('clouds'), filter = o.get('textureFiltering') || 'none';
  const left = [
    'Leoncraft 2 (26.1.2/vanilla)',
    s.fps + ' fps T: ' + (maxFps ? maxFps : 'inf') + (o.get('vsync') !== false ? ' vsync' : ''),
    'Integrated server @ ' + (g.tickMs || 0).toFixed(1) + ' ms, 0 tx, 0 rx',
    (clouds === 'off' ? 'no-clouds' : clouds + '-clouds') + ' B: ' + (o.get('biomeBlend') ?? 2) + ' Filtering: ' + (FILTER_NAME[filter] || 'None'),
    '',
    'XYZ: ' + p.x.toFixed(3) + ' / ' + (p.y + Y0).toFixed(5) + ' / ' + p.z.toFixed(3),
    'Block: ' + bx + ' ' + by + ' ' + bz,
    'Section-relative: ' + two(bx & 15) + ' ' + two(by & 15) + ' ' + two(bz & 15),
    'Chunk: ' + cx + ' ' + (by >> 4) + ' ' + cz + ' [' + (cx & 31) + ' ' + (cz & 31) + ' in r.' + (cx >> 5) + '.' + (cz >> 5) + '.mca]',
    'Facing: ' + face + ' (' + towards + ') (' + yaw.toFixed(1) + ' / ' + pitch.toFixed(1) + ')',
    'minecraft:' + g.dim + ' FC: 0',
    '',
    'For help: press F3 + Q',
  ];
  const mem = performance.memory;
  const [vendor, card] = gpuName(R);
  const right = [browserName()];
  if (mem) {
    const used = mem.usedJSHeapSize / 1048576, lim = mem.jsHeapSizeLimit / 1048576, tot = mem.totalJSHeapSize / 1048576;
    right.push('Mem: ' + Math.round(used * 100 / lim) + '% ' + Math.round(used) + '/' + Math.round(lim) + 'MB',
      'Allocation rate: ' + Math.round(allocRate(used)) + 'MB/s',
      'Allocated: ' + Math.round(tot * 100 / lim) + '% ' + Math.round(tot) + 'MB');
  }
  right.push('', 'CPU: ' + (navigator.hardwareConcurrency || 1) + 'x', '',
    'Display: ' + R.rw + 'x' + R.rh + (vendor ? ' (' + vendor + ')' : ''));
  if (card) right.push(card);
  if (gl2 === null) { try { const gl = R.r.getContext(); gl2 = String(gl.getParameter(gl.VERSION)); } catch (e) { gl2 = ''; } }
  if (gl2) right.push(gl2);
  // (the game has no shaders: only said when ours are on)
  if (s.level && s.level !== 'off') right.push('Shaders: ' + (LEVEL[s.level] || s.level));
  return [left, right];
}
let gl2 = null;
