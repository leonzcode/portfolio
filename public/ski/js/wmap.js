/* (W, round 10, for Leon's "make a similar map thing as leonski2 in that you can search up any mountain on Earth and you
   can ride it") Any mountain: a real place's ground, runs, lifts and forest, built into the game's own world, riding,
   lifts and rooms. main.js calls makeWorld(q, say) before the terrain is built; it puts the mountain in through
   terrain.js's hook and returns the park, the lifts' plan and the rest.
   The place is opts.place: { name, sub, lat, lon, preset } (a built-in resort has preset, its slug; a searched one not).
   Its id (worldId) goes in the room's map, so riders at other places are not mixed (the relay takes 16 letters, digits
   and underscores). */
import { setMountain, height, ground, normal } from './terrain.js?v=32';
import { Frame, Elevation, demStats } from './wdem.js?v=32';
import { loadOsm, loadLand, parse, skiExtent } from './wosm.js?v=32';
import { PRESETS, MAMMOTH, worldId, originOf } from './wplaces.js?v=32';
import { WorldLand, forestCover, treelineFor } from './wland.js?v=32';
import { TreeStream, WorldForest, woodIndex, fitRunWidths } from './wtrees.js?v=32';
import { makeWorldPark, fallYaw } from './wpark.js?v=32';
import { liftLines, planWorldLifts, WorldLifts, kindName } from './wlift.js?v=32';
import { addFeatures } from './wfeat.js?v=32';
import { TrailMap } from './wtrail.js?v=32';
import { makeSigns } from './wsigns.js?v=32';
import { setRockSource, rebakeRockField, freerideLook } from './materials.js?v=32';
import { smoothstep, fbm } from './noise.js?v=32';

export { PRESETS, MAMMOTH, worldId, originOf };

// where the riding is thickest: a window the fine area's size round the most runs and lifts
function busiest(d, size) {
  const C = 250, cnt = new Map(), k = (i, j) => i * 100003 + j;
  for (const L of [d.pistes, d.lifts]) for (const r of L) for (let i = 0; i < r.pts.length; i++) {
    const p = r.pts[i]; const key = k(Math.floor(p.x / C), Math.floor(p.z / C)); cnt.set(key, (cnt.get(key) || 0) + (L === d.lifts ? 3 : 1));
  }
  if (!cnt.size) return null;
  // (sum over a square of cells round each cell: the best middle)
  const R = Math.max(1, Math.floor(size * 0.4 / C));
  let best = null;
  for (const [key, n0] of cnt) {
    const i0 = Math.round(key / 100003), j0 = key - i0 * 100003;
    let s = 0; for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) s += cnt.get(k(i0 + i, j0 + j)) || 0;
    if (!best || s > best.s) best = { s, x: (i0 + 0.5) * C, z: (j0 + 0.5) * C };
  }
  return best;
}

/* the world: q (the graphics tier), place, say(text, share) for the progress; opts.drop: a point to centre on (the trail
   map's drop outside the built area) */
export async function makeWorld(q, place, say, opts = {}) {
  const t0 = performance.now(), times = {};
  const mark = k => { times[k] = Math.round(performance.now() - t0); };
  const o = originOf(place), frame = new Frame(o.lat, o.lon);
  const low = q.tier === 'low', fineN = low ? 4 : 5;
  // ---- the runs and lifts
  await say('Finding the runs and lifts at ' + place.name, 0.3);
  /* (a long wait for OpenStreetMap: a button under the progress to ride the bare mountain without its runs; the place
     picker beside it stays usable to go somewhere else) */
  const skipAc = new AbortController(), skip = document.getElementById('wskip');
  if (skip) skip.onclick = () => { skipAc.abort(); skip.hidden = true; };
  // (W, round 11: the forests, rock and the rest of the land cover, asked for beside the runs: wosm.js loadLand)
  const landP = loadLand(Object.assign({}, place, o), frame, () => {}, skipAc.signal).catch(e => { console.warn('land', e); return { land: null, from: 'none' }; });
  const got = await loadOsm(Object.assign({}, place, o), t => { if (skip && /OpenStreetMap/.test(t)) skip.hidden = false; return say(t, 0.32); }, skipAc.signal);
  if (skip) skip.hidden = true;
  const data = parse(got.osm, frame); mark('osm');
  // (no runs: say so on the home screen's place line)
  if (!data.pistes.length) { const n = document.querySelector('#wnow small'); if (n) n.textContent = (place.sub ? place.sub + '. ' : '') + (got.from === 'none' ? 'OpenStreetMap did not answer: the bare mountain.' : 'No runs or lifts mapped here: the bare mountain.'); }
  // ---- where to build: the fine area round the busiest part of the ski area (or the drop asked for, or the place)
  const tile14 = frame.S / 16384, size = fineN * tile14;
  const ext = skiExtent(data);
  let cx = 0, cz = 0;
  if (opts.drop) { cx = opts.drop.x; cz = opts.drop.z; }
  else if (ext) { const b = busiest(data, size); if (b) { cx = b.x; cz = b.z; } else { cx = ext.cx; cz = ext.cz; } }
  const elev = new Elevation(frame, cx, cz, fineN);
  /* (the forest from the satellite picture, asked for meanwhile: W, round 11, only where OpenStreetMap maps no woods at
     all, as the fallback; the land's answer decides) */
  const forestP = landP.then(r => r.land && r.land.wood.length ? null : forestCover(frame, elev.fineExtent()).catch(() => null));
  await say('Reading the ground (elevation tiles)', 0.36);
  await elev.load((n, all) => { if (n % 4 === 0 || n === all) say(`Reading the ground (${n} of ${all} elevation tiles)`, 0.36 + 0.14 * n / all); });
  mark('dem');
  // (W, round 11) the land cover: up to 20 s more for it once the ground is in (a searched place asks Overpass)
  const gotLand = await Promise.race([landP, new Promise(r => setTimeout(() => r({ land: null, from: 'late' }), 20000))]);
  const osmLand = gotLand.land; mark('land');
  // (the mapped woods, once; a run with no width tag as wide as the gap the woods leave for it, where they are cut for it)
  const woods = woodIndex(osmLand), runsFitted = fitRunWidths(data, woods, (x, z) => elev.inFine(x, z, 0));
  // ---- the mountain
  await say('Grooming the runs', 0.5);
  const land = new WorldLand(frame, elev, data, { low });
  let park = null;
  const mtn = {
    bare: true, land, frame, elev, place, id: worldId(place),
    at: (x, z) => land.at(x, z),
    // groomed runs 0, the snow off them 1, built features and the stations' pads 2
    surface: (x, z) => park && park.surface(x, z) ? 2 : land.groom(x, z) > 0.5 ? 0 : 1,
    groom: (x, z) => land.groom(x, z),
    spot: { treeline: treelineFor(o.lat) - land.y0 },
  };
  if (low) mtn.lodK = 0.8;
  setMountain(mtn);
  land.woods = woods; land.buildRock(osmLand); mark('rock');   // (W, round 11: and OpenStreetMap's cliffs, bare rock, scree, glaciers)
  park = makeWorldPark(land);
  // ---- the generated features (side hits, wind lips, drops, the parks' lines): before the lifts, which stand clear of them
  await say('Shaping the snow', 0.52);
  const feats = addFeatures(park, land, data, { low, L: osmLand }); mark('features');   // (W, round 11: L, the mapped cliffs and halfpipes)
  // ---- the lifts
  await say('Building the lifts', 0.54);
  const inArea = (x, z) => elev.inFine(x, z, 60);
  const lines = liftLines(data.lifts, inArea, low ? 24 : 40);
  const planned = planWorldLifts(park, lines); park.pads = planned; mark('lifts');
  // ---- the starts: the top of every lift built (the one whose top is highest first), then the runs' tops
  const starts = [];
  for (const P of planned.plans) {
    const lx = P.plan.XL - 8, lz = P.plan.top.front + 10, x = P.F.wx(lx, lz), z = P.F.wz(lx, lz);
    starts.push({ name: 'Top of ' + (P.L.name || kindName(P.L.src.kind)), x, z, v: 2, yaw: fallYaw(height, x, z, 6), y: ground(x, z) });
  }
  starts.sort((a, b) => b.y - a.y);
  const runTops = [];
  for (const p of data.pistes) {
    if (!p.name || p.pts.length < 2) continue;
    let hi = null; for (const pt of p.pts) { if (!inArea(pt.x, pt.z)) continue; const y = ground(pt.x, pt.z); if (!hi || y > hi.y) hi = { x: pt.x, z: pt.z, y }; }
    if (hi && !runTops.some(r => r.name === p.name)) runTops.push({ name: p.name, diff: p.diff, x: hi.x, z: hi.z, y: hi.y });
  }
  runTops.sort((a, b) => b.y - a.y);
  for (const r of runTops.slice(0, 14)) starts.push({ name: 'Top of ' + r.name, x: r.x, z: r.z, v: 2, yaw: fallYaw(height, r.x, r.z, 6), y: r.y });
  // nothing at all: the highest ground in the middle of the area
  if (!starts.length) {
    let best = null;
    for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) { const x = cx + i * size / 30, z = cz + j * size / 30, y = ground(x, z); if (!best || y > best.y) best = { x, z, y }; }
    // (down from the very top until the slope is about 12 degrees, so a run starts rolling)
    let { x, z } = best;
    for (let k = 0; k < 200; k++) { const n = normal(x, z), s = Math.hypot(n.x, n.z); if (s > 0.2) break; x += n.x / (s || 1) * 3; z += n.z / (s || 1) * 3; }
    starts.push({ name: 'The summit', x, z, v: 2, yaw: fallYaw(height, x, z, 6), y: ground(x, z) });
  }
  // (a drop asked for on the trail map: that first)
  if (opts.drop && opts.drop.spawn) starts.unshift({ name: 'Where you dropped', x: opts.drop.x, z: opts.drop.z, v: 2, yaw: fallYaw(height, opts.drop.x, opts.drop.z, 6) });
  park.starts = starts;
  /* the night's lamps (env.js reads park.lightTowers): along the runs OpenStreetMap says are lit (lit=yes), a row of
     towers every 45 m down one side of the longest straight stretches near the start, six rows at most (the snow
     material's limit); none at all where no run is lit (a row of no lamps, so env.js builds none of its own) */
  {
    const rows = [], s0 = starts[0];
    const cand = [];
    for (const p of data.pistes) if (p.lit && !p.area) for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], b = p.pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 90 || !inArea(a.x, a.z) || !inArea(b.x, b.z)) continue;
      cand.push({ a, b, L, hw: p.w / 2, d: Math.hypot((a.x + b.x) / 2 - s0.x, (a.z + b.z) / 2 - s0.z) });
    }
    cand.sort((p, q) => p.d - q.d);
    for (const c of cand.slice(0, 6)) {
      const ux = (c.b.x - c.a.x) / c.L, uz = (c.b.z - c.a.z) / c.L, nx = -uz, nz = ux, off = c.hw + 3;
      rows.push({ x0: c.a.x + nx * off + ux * 10, z0: c.a.z + nz * off + uz * 10, dx: ux * 45, dz: uz * 45, n: Math.max(1, Math.floor((c.L - 20) / 45) + 1), ax: -nx, az: -nz, h: 11, power: 150 });
    }
    park.lightTowers = rows.length ? rows : [{ x0: 0, z0: 0, dx: 0, dz: 1, n: 0, ax: 1, az: 0 }];
  }
  // ---- the forest
  await say('Planting the trees', 0.58);
  /* (W, round 11) only where OpenStreetMap maps woods (wtrees.js), the runs, lifts and clearings cut out of them; where it
     maps none at all here, the old rule: the satellite picture's green, else a treeline from the latitude */
  const hasWood = !!(osmLand && osmLand.wood.length);
  const cover = hasWood ? null : await Promise.race([forestP, new Promise(r => setTimeout(() => r(null), 15000))]);
  const tl = treelineFor(o.lat) - land.y0;
  const fallback = (x, z, y) => {
    let d;
    if (cover) { const c = cover.at(x, z); d = c < 0 ? 0 : c; }
    else d = 1 - smoothstep(tl - 180, tl + 40, y + 60 * fbm(x * 0.004, z * 0.004, 2));
    return d * smoothstep(-0.25, 0.2, fbm(x * 0.02, z * 0.02, 2));    // (clumps and glades)
  };
  const stream = new TreeStream(land, data, osmLand, { q, park, feats, fallback, woods }); stream.runsFitted = runsFitted;
  const woodSrc = hasWood ? 'osm' : cover ? 'satellite' : 'treeline';
  mtn.trees = () => stream.initial(starts[0].x, starts[0].z);
  mark('forest');
  // ---- the rock drawn on the snow: the faces and the steep snow off the runs (materials.js's field, round the start)
  freerideLook();
  setRockSource(feats.fieldHeight, [starts[0].x, starts[0].z], (x, z, ny) => {
    const g = land.groom(x, z); if (g > 0.3) return 1;
    const r = land.rockAmt(x, z);
    return r > 0.05 ? Math.min(ny, 0.75 - r * 0.25) : Math.max(ny, Math.min(1, ny + 0.12));
  });
  // the terrain's quadtree: a square 64 km across round the area built (the far elevation's horizon)
  const root = { x0: Math.round(cx / 64) * 64 - 32768, z0: Math.round(cz / 64) * 64 - 32768, size: 65536 };
  const W = { mtn, park, land, frame, data, planned, starts, cover, id: worldId(place), place, from: got.from, times, demStats, ext: elev.fineExtent(), center: { x: cx, z: cz }, feats, root };
  /* (W, round 11) the land cover and the forest: osmLand (wlanddata.js, null if none came), landFrom where it came from,
     wood.at(x, z) the forest cover 0..1 (the trail map's tree texture), woodSrc 'osm' | 'satellite' | 'treeline';
     makeForest(scene, q) for main.js (the forest streamed round the camera) */
  W.osmLand = osmLand; W.landFrom = gotLand.from; W.woodSrc = woodSrc; W.trees = stream;
  { const c2 = [0, 0]; W.wood = hasWood ? { at: (x, z) => { stream.woods.cellAt(x, z, c2); return c2[0] >= 2 ? 1 : c2[0] === 1 ? 0.35 : 0; } } : { at: (x, z) => fallback(x, z, land.at(x, z)) }; }
  W.makeForest = (scene, q2) => new WorldForest(scene, q2, mtn, stream);
  // (main.js, once the scene is up: the runs' signs and markers and the parks' meshes)
  W.dress = (scene, mats, q2) => { if (feats && feats.dress) feats.dress(scene, mats, q2); W.signs = makeSigns(scene, W, q2); };
  /* (main.js, each frame) the fine heights streamed in round the rider once past the built area (wdem.js stream): asked
     for twice a second, the terrain's patches built again where they changed */
  let streamT = 0, fieldAt = [starts[0].x, starts[0].z];
  W.frame = (p, terrain, dt) => {
    if (W.signs) W.signs.update(p);
    if (W.miniFrame && W.liveSk) W.miniFrame(dt, W.liveSk);
    // (the snow's rock field baked again round the rider once 450 m from its middle: the fine window is 1.3 km)
    if (Math.hypot(p.x - fieldAt[0], p.z - fieldAt[1]) > 450 && rebakeRockField([p.x, p.z])) fieldAt = [p.x, p.z];
    // (W11 fly: faster than a skier goes, asked for four times a second, and round the point about 5 s ahead too, at most
    // 3 km on; a tile let go past the cap (gone) is counted apart)
    const sv = W.liveSk && W.liveSk.v, sp = sv ? Math.hypot(sv.x, sv.z) : 0, ah = sp > 30 ? Math.min(3000, sp * 5) / sp : 0;
    streamT -= dt; if (streamT > 0) return; streamT = ah ? 0.25 : 0.5;
    elev.stream(p.x, p.z, (b, gone) => { terrain.invalidate(b.x0, b.z0, b.x1, b.z1); if (gone) W.evicted = (W.evicted || 0) + 1; else W.streamed = (W.streamed || 0) + 1; stream.forget(b); }, 1.4, low ? 24 : 40, ah ? p.x + sv.x * ah : undefined, ah ? p.z + sv.z * ah : undefined);
  };
  // (main.js: the trail map behind the pause menu's button)
  W.trail = g => {
    const b = document.getElementById('totrail'); if (!b) return;
    let map = null;
    const tm = W.trailMap = () => map || (map = new TrailMap(W, g));
    b.classList.remove('hidden');
    b.onclick = () => { document.getElementById('pause').classList.add('hidden'); tm().open(); };
    /* (W11 trail) every frame while riding (W.frame): a lift built in stretches ridden on, the corner map, and the map's
       tiles made ahead in idle moments (wtrail.js frame); the corner map and the made-ahead list are set up once the
       start is over, in an idle moment (a few milliseconds) */
    W.miniFrame = (dt, sk) => { if (map) map.frame(dt, sk); };
    const hud = document.getElementById('hud');
    const idle = f => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 50));
    const make = () => {
      const m = tm();
      if (hud && g.pause && !matchMedia('(hover: none)').matches) m.mini(hud, () => { g.pause(); document.getElementById('pause').classList.add('hidden'); m.open(); });
      else m.ahead();
    };
    // (the runs' and lifts' list read in one idle moment, the corner map set up in the next)
    setTimeout(() => idle(() => { tm().prep(); idle(make); }), 2000);
    // (a lift picked on the trail map before the page was built again round it: ridden once Ride is pressed)
    if (takeDrop.board) tm().pendingBoard(takeDrop.board);
  };
  if (typeof window !== 'undefined') window.__skiWorld = W;     // (a test handle)
  return W;
}
export { WorldLifts, fallYaw };
// a drop on the trail map outside the area built: the page is built again round it (sessionStorage, this place only)
export function takeDrop(place) {
  takeDrop.board = null;       // (W11 trail: a lift to put the rider on once Ride is pressed, W.trail)
  try {
    const d = JSON.parse(sessionStorage.getItem('ski_wdrop') || 'null'); sessionStorage.removeItem('ski_wdrop');
    if (d && place && d.id === worldId(place) && Date.now() - d.at < 120000) { takeDrop.board = d.board || null; return { x: d.x, z: d.z, spawn: d.spawn !== false }; }
  } catch (e) {}
  return null;
}

/* (W, round 11: the trees are wtrees.js's now, from the woods OpenStreetMap maps; the old planting by the satellite
   picture is its fallback, `fallback` in makeWorld) */
