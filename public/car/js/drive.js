// A drive: the world at a place, OSM roads, props and buildings round it (streamed as the car moves), the
// player's car with its physics, the cameras, the traffic and the HUD.
import * as THREE from 'three';
import { setOrigin, frame, toLatLon, project, unproject, dirHeading } from './geo.js?v=6';
import { Collide } from './collide.js?v=6';
import { Vehicle } from './vehicle.js?v=6';
import { CarCamera } from './camera.js?v=6';
import { Hud } from './hud.js?v=6';
import { CarSound } from './sound.js?v=6';
import { CutMask } from './cutmask.js?v=6';
import * as SIG from './signals.js?v=6';
import { Parked } from './parked.js?v=6';

const STEP = 1 / 120;
const GLIFT = 0.15; // how far under Google's road ours is drawn
const tryImport = async p => { try { return await import(p); } catch (e) { console.warn('module missing or broken', p, e.message); return null; } };

// countries that measure speed in miles an hour (by rough boxes): the US, UK, Liberia, Myanmar
function usesMph(lat, lon) {
  if (lat > 24 && lat < 50 && lon > -125 && lon < -66) return true;
  if (lat > 51 && lat < 72 && lon > -170 && lon < -129) return true; // Alaska
  if (lat > 18.8 && lat < 22.4 && lon > -160.5 && lon < -154.7) return true; // Hawaii
  if (lat > 49.8 && lat < 61 && lon > -8.7 && lon < 2) return !(lon < -5.9 && lat < 55.4 && lat > 51.3 && lon > -10.6 && !(lat > 54 && lon > -8.2 && lon < -5.4)); // UK but not Ireland
  return false;
}

export class Drive {
  constructor(G) {
    this.G = G; this.world = G.world; this.scene = G.scene; this.camera = G.camera;
    this.collide = new Collide();
    this.cam = new CarCamera(G.camera, G.renderer.domElement);
    this.hud = new Hud(document.getElementById('ui'), this);
    this.acc = 0; this.car = null; this.active = false; this.mods = {};
    this.signal = 0; this.headlights = false; this.lookBack = false; this.inputSteer = 0;
    this.cells = new Set(); this.carId = null;
    this.keys = G.keys;
    this.sound = new CarSound();
    // finer ground arrived (Google's tiles refine as the car comes near): re-sample the roads there, in batches
    this.dirty = null; this.dirtyT = 0;
    this.world.addEventListener('ground-changed', e => {
      if (this.mode !== 'google' || !this.roadsObj || !this.car) return;
      const b = e.bbox, o = this.car.vehicle.pos;
      if (b.max.x < o.x - 350 || b.min.x > o.x + 350 || b.max.z < o.z - 350 || b.min.z > o.z + 350) return;
      if (!this.dirty) this.dirty = { x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z };
      else { const d = this.dirty; d.x0 = Math.min(d.x0, b.min.x); d.z0 = Math.min(d.z0, b.min.z); d.x1 = Math.max(d.x1, b.max.x); d.z1 = Math.max(d.z1, b.max.z); }
    });
    addEventListener('keydown', e => this.key(e));
    const wake = () => { if (this.active) this.sound.start(); };
    addEventListener('keydown', wake); addEventListener('pointerdown', wake);
  }

  async loadMods() {
    if (/[?&]nomods/.test(location.search)) return;
    const [cars, osm, roads, props, buildings, trees, traffic, imagery] = await Promise.all([
      tryImport('./cars.js?v=6'), tryImport('./osm.js?v=6'), tryImport('./roads.js?v=6'), tryImport('./props.js?v=6'),
      tryImport('./buildings.js?v=6'), tryImport('./trees.js?v=6'), tryImport('./traffic.js?v=6'), tryImport('./imagery.js?v=6')]);
    Object.assign(this.mods, { cars, osm, roads, props, buildings, trees, traffic, imagery });
    // the cars reflect a real street (an HDR photo) rather than the plain sky: their paint reads as paint
    if (cars && cars.makeEnvironment && !this.carEnvP) this.carEnvP = cars.makeEnvironment(this.G.renderer).then(t => { this.carEnv = t; if (this.car && this.car.rig.setEnvMap) this.car.rig.setEnvMap(t); const M = this.bldgObj && this.bldgObj.material; if (M) { M.envMap = t; M.needsUpdate = true; } return t; }).catch(() => null);
    // a test page can send OSM queries through a local caching proxy
    const ov = new URLSearchParams(location.search).get('overpass');
    if (ov && osm && osm.setFetcher) osm.setFetcher(q => fetch(ov + '?data=' + encodeURIComponent(q)).then(r => { if (!r.ok) throw new Error('overpass ' + r.status); return r.json(); }));
    this.G.mods = this.mods;
  }

  key(e) {
    if (!this.active || e.target.tagName === 'INPUT') return;
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyC': this.hud.flash(this.cam.next(e.shiftKey ? -1 : 1) && this.cam.name); break;
      case 'KeyV': this.hud.flash(this.cam.next(-1) && this.cam.name); break;
      case 'KeyQ': this.signal = this.signal === -1 ? 0 : -1; break;
      case 'KeyE': this.signal = this.signal === 1 ? 0 : 1; break;
      case 'KeyX': this.signal = this.signal === 2 ? 0 : 2; break;
      case 'KeyL': this.headlights = !this.headlights; this.hud.flash(this.headlights ? 'Headlights on' : 'Headlights off'); break;
      case 'KeyR': this.respawn(); break;
      case 'KeyH': this.hud.toggleHelp(); break;
      case 'KeyM': this.hud.flash(this.sound.toggle() ? 'Sound on' : 'Sound off'); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8': {
        const list = this.mods.cars ? this.mods.cars.CARS.filter(c => !c.npcOnly) : [];
        const c = list[+e.code.slice(5) - 1];
        if (c) this.setCar(c.id);
        break;
      }
    }
  }

  // test autopilot: follows lanes of the graph (pure pursuit on a point ahead), turns at random at junctions
  autopilot(on, kmh = 40) {
    this.auto = on ? { kmh, L: null, s: 0, path: [], log: [] } : null;
  }
  autoInput(dt) {
    const A = this.auto, R = this.roadsObj, v = this.car.vehicle;
    const o = v.origin(), hd = v.heading;
    if (!A.L || A.lost > 1.5) {
      const r = R && R.nearestLane ? R.nearestLane(o.x, o.z, 30, L => L.kind === 'road' && Math.abs(((hdOf(L, 0) - hd) % 360 + 540) % 360 - 180) < 100) : null;
      if (!r) return { throttle: 0, brake: 1, steer: 0 };
      A.L = r.lane; A.s = r.s; A.path = []; A.lost = 0;
    }
    // where we are along the lane
    const near = R.nearestLane(o.x, o.z, 12, L => L === A.L || A.path.includes(L));
    if (near) { while (A.path.length && near.lane !== A.L) { A.L = A.path.shift(); } A.s = near.s; A.lost = 0; } else A.lost += dt;
    while (A.path.length < 3) {
      const last = A.path.length ? A.path[A.path.length - 1] : A.L;
      const byId = id => R.graph.lanes[id] && R.graph.lanes[id].id === id ? R.graph.lanes[id] : R.graph.lanes.find(l => l.id === id);
      const nx = (last.next || []).map(byId).filter(l => l && l.turn !== 'uturn');
      if (!nx.length) break;
      // through streets over alleys and car parks
      const sp = l => { const r = l.kind === 'junction' ? byId((l.next || [])[0]) : l; return r ? r.speed : 0; };
      const w = nx.map(l => (sp(l) < 7 ? 0.05 : 1) * (l.turn === 'straight' || !l.turn ? 2 : 1));
      let r = Math.random() * w.reduce((a, b) => a + b, 0), pick = nx[0];
      for (let i = 0; i < nx.length; i++) { r -= w[i]; if (r <= 0) { pick = nx[i]; break; } }
      A.path.push(pick);
    }
    const look = Math.max(6, Math.abs(v.fwdSpeed) * 0.9);
    let L = A.L, s = A.s + look, k = 0;
    while (s > L.len && k < A.path.length) { s -= L.len; L = A.path[k++]; }
    const p = ptOf(L, Math.min(s, L.len));
    const f = { x: Math.sin(hd * Math.PI / 180), z: -Math.cos(hd * Math.PI / 180) };
    const dx = p.x - o.x, dz = p.z - o.z;
    const lat = dx * -f.z + dz * f.x, lon = dx * f.x + dz * f.z; // + is to the right
    const curv = 2 * lat / Math.max(1, lon * lon + lat * lat);
    const wb = this.car.rig.dims.wheelbase || 2.8;
    const ang = Math.atan(curv * wb);
    const lock = v.p.maxSteer * Math.PI / 180 / (1 + (Math.abs(v.fwdSpeed) * 3.6 / 75) ** 1.6);
    const steer = THREE.MathUtils.clamp(-ang / Math.max(0.05, lock), -1, 1);
    // slow for bends: how far the way turns over the next 30 m
    const at = d => { let LL = A.L, ss = A.s + d, kk = 0; while (ss > LL.len && kk < A.path.length) { ss -= LL.len; LL = A.path[kk++]; } return ptOf(LL, Math.min(ss, LL.len)); };
    const p0 = at(0), p1 = at(12), p2 = at(30);
    const h1 = Math.atan2(p1.x - p0.x, -(p1.z - p0.z)), h2 = Math.atan2(p2.x - p1.x, -(p2.z - p1.z));
    const bend = Math.abs(((h2 - h1) * 180 / Math.PI + 540) % 360 - 180);
    const bendKmh = bend > 60 ? 18 : bend > 30 ? 28 : bend > 15 ? 40 : 999;
    let want = Math.min(A.kmh, bendKmh, Math.abs(lat) > 3 ? 15 : A.kmh) / 3.6;
    // keep a gap to traffic in front
    if (this.traffic) for (const c of this.traffic.list) {
      const ddx = c.x - o.x, ddz = c.z - o.z, ahead = ddx * f.x + ddz * f.z, side = Math.abs(ddx * -f.z + ddz * f.x);
      if (ahead > 0 && ahead < 8 + v.fwdSpeed * 1.6 && side < 2.2) want = Math.min(want, Math.max(0, c.v * (ahead > 10 ? 1 : 0.5)));
    }
    const sp = v.fwdSpeed;
    return { throttle: sp < want ? Math.min(1, (want - sp) * 0.5 + 0.2) : 0, brake: sp > want + 1 && sp > 0.8 ? Math.min(1, (sp - want) / 5) : 0, steer, handbrake: 0 };
  }

  input(dt) {
    if (this.auto && this.roadsObj) return this.autoInput(dt);
    const k = this.keys, pad = navigator.getGamepads ? [...navigator.getGamepads()].find(p => p && p.connected) : null;
    let thr = (k.has('KeyW') || k.has('ArrowUp')) ? 1 : 0, brk = (k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0;
    let st = ((k.has('KeyA') || k.has('ArrowLeft')) ? 1 : 0) - ((k.has('KeyD') || k.has('ArrowRight')) ? 1 : 0);
    let hb = k.has('Space') ? 1 : 0;
    this.lookBack = k.has('KeyB');
    // keyboard steering eases in and back, faster at low speed
    const v = this.car ? Math.abs(this.car.vehicle.fwdSpeed) : 0;
    const rate = (st !== 0 && Math.sign(st) === Math.sign(this.inputSteer) ? 2.2 : 4.5) / (1 + v / 40);
    this.inputSteer += THREE.MathUtils.clamp(st - this.inputSteer, -rate * dt * 2, rate * dt * 2);
    st = this.inputSteer;
    if (pad) {
      const ax = pad.axes[0] || 0, dz = Math.abs(ax) < 0.08 ? 0 : (ax - Math.sign(ax) * 0.08) / 0.92;
      if (Math.abs(dz) > 0.01) { st = -Math.sign(dz) * Math.abs(dz) ** 1.5; this.inputSteer = st; }
      const b = i => pad.buttons[i] ? pad.buttons[i].value : 0;
      thr = Math.max(thr, b(7)); brk = Math.max(brk, b(6)); hb = Math.max(hb, b(0) > 0.5 || b(5) > 0.5 ? 1 : 0);
      if (b(3) > 0.5 && !this.padY) this.hud.flash(this.cam.next() && this.cam.name);
      this.padY = b(3) > 0.5;
      this.lookBack = this.lookBack || b(4) > 0.5;
    }
    return { throttle: thr, brake: brk, steer: st, handbrake: hb };
  }

  async start(lat, lon, heading = 0, opts = {}) {
    this.active = false;
    const T0 = performance.now(), tm = this.G.startTimes = {};
    const mark = k => { tm[k] = Math.round(performance.now() - T0); };
    this.hud.loading('Loading the world', 0.05);
    if (!this.mods.cars && !opts.noMods) await this.loadMods();
    this.clearArea();
    this.mph = usesMph(lat, lon);
    this.origin = { lat, lon };
    // everything that only needs the place runs at once: the map data, the ground, the cars, the props' models
    setOrigin(lat, lon, 0);
    const C = this.mods.cars;
    const carP = this.setCar(this.carId || (C ? C.CARS.find(c => !c.npcOnly).id : null), true);
    const warm = C && C.TRAFFIC ? Promise.all([...new Set(C.TRAFFIC)].map(id => C.loadCar(id, { npc: true }).catch(() => null))) : null;
    if (this.mods.props && this.mods.props.preload && !this.propsReady) { this.propsReady = true; this.mods.props.preload().catch(e => console.warn('props preload', e)); }
    const dataP = this.fetchArea(0, 0, true);
    this.mode = await this.G.startWorld(lat, lon);
    mark('world');
    this.hud.loading('Loading streets', 0.35);
    const data = await dataP;
    mark('data');
    this.hud.loading('Building the streets', 0.6);
    if (data) await this.buildArea(data, 0, 0); else this.hud.flash('Could not load the streets here');
    mark('build');
    this.hud.loading('Getting the car ready', 0.8);
    await carP;
    mark('car');
    let x = 0, z = 0, hd = heading;
    const R = this.roadsObj;
    const p = this.roadSpot(0, 0, heading);
    if (p) { x = p.x; z = p.z; hd = p.heading; }
    await this.waitGround(x, z);
    mark('ground');
    this.spawn(x, z, hd);
    if (warm) await warm;
    if (this.carEnvP) await this.carEnvP;
    this.makeTraffic();
    mark('warm');
    if (this.traffic && this.traffic.preload) { this.hud.loading('Getting the traffic ready', 0.9); await this.traffic.preload(this.G.renderer, this.camera); }
    mark('traffic');
    this.active = true;
    this.cam.ready = false;
    if (!/[?&]noswoop/.test(location.search)) this.cam.swoop();
    this.hud.loading(null);
    this.hud.show(true);
    if (this.mode === 'open' && !this.notedKey) { this.notedKey = true; this.hud.note(this.G.keyFailed ? "Google did not accept the API key, so this is the open map. Check the key in the map's menu." : (innerWidth < 600 ? "Open map from satellite photos and OpenStreetMap. For Google's 3D city, add a Google key in the map's menu." : "This is the open map, built from satellite photos and OpenStreetMap. For Google's photorealistic 3D city, add a Google Maps API key in the map's menu.")); }
    return { x, z, heading: hd };
  }

  // until the ground under the start is known and the world's tiles round it have come in (at most 12 s)
  async waitGround(x, z) {
    const T = this.world.tiles;
    // point the camera at the start so the tiles there are the ones asked for
    this.camera.position.set(x, (this.world.groundAt(x, z) || 0) + 3, z + 8); this.camera.lookAt(x, 0, z);
    const t0 = performance.now(), cap = this.mode === 'google' ? 6000 : 3000;
    for (let i = 0; i < 400; i++) {
      const g = this.world.groundAt(x, z);
      const st = T && T.stats, busy = st ? st.downloading + st.parsing : 0, ms = performance.now() - t0;
      // the ground's shape is known at once; its picture keeps sharpening for a while, so wait for it a little only
      if (g !== null && ms > 400 && (busy === 0 || ms > cap)) return g;
      if (ms > 15000) break;
      await new Promise(r => setTimeout(r, 100));
    }
    return this.world.groundAt(x, z) || 0;
  }

  spawn(x, z, heading) {
    const y = this.ground(x, z) ?? 0;
    this.car.vehicle.place(x, y, z, heading);
    // the drawing starts from where the car now is (spawn can be called in the middle of update)
    this.prevPos = this.car.vehicle.pos.clone(); this.prevQ = this.car.vehicle.q.clone(); this.acc = 0;
    this.cam.ready = false;
    this.lastGood = { x, z, heading };
  }

  respawn() {
    if (!this.car) return;
    const v = this.car.vehicle, o = v.origin();
    let x = o.x, z = o.z, hd = v.heading;
    const p = this.roadSpot(x, z, hd);
    if (p) { x = p.x; z = p.z; hd = p.heading; }
    this.spawn(x, z, hd);
  }

  // the nearest lane centre going the way wanted (the other side of the road if the nearest lane runs against it)
  roadSpot(x, z, want) {
    const R = this.roadsObj;
    if (!R) return null;
    // a spot is no good if a car there would already be inside something (a lane under a building, a parked car)
    const bad = new Set();
    const blocked = r => {
      const h = r.heading * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h), cs = [];
      for (const o of [-1.6, 0, 1.6]) cs.push({ x: r.x + fx * o, z: r.z + fz * o, r: 0.95, y0: (r.y || 0) + 0.2, y1: (r.y || 0) + 1.5 });
      return this.collide.contacts(cs).length > 0;
    };
    for (let tries = 0; tries < 10; tries++) {
      const r = this.roadSpotOnce(x, z, want, bad);
      if (!r || !r.lane || !blocked(r)) return r;
      bad.add(r.lane.edge);
    }
    return this.roadSpotOnce(x, z, want, new Set());
  }

  roadSpotOnce(x, z, want, bad) {
    const R = this.roadsObj;
    const ok = L => L.kind === 'road' && L.len > 10 && !bad.has(L.edge);
    // a lane within 40 m that runs the way asked (or the other way, then its partner is taken below) comes first,
    // so a drop facing along a street does not start on the cross street that happens to be nearer
    const angOff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
    const along = L => { const p = L.pts, a = p[0], b = p[p.length - 1]; const h = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360; const d = angOff(h, want); return Math.min(d, 180 - d) < 35; };
    let r = R.nearestLane ? (R.nearestLane(x, z, 40, L => ok(L) && along(L)) || R.nearestLane(x, z, 400, ok) || R.nearestLane(x, z, 2000, L => L.kind === 'road')) : null;
    if (!r) { const q = R.nearestRoadPoint && R.nearestRoadPoint(x, z); return q ? { x: q.x, z: q.z, heading: pickDir(q.heading, want) } : null; }
    const off = Math.abs(((want - r.heading) % 360 + 540) % 360 - 180);
    if (off > 90) {
      const o = R.nearestLane(x, z, 400, L => ok(L) && L.edge === r.lane.edge && L.dir !== r.lane.dir);
      if (o) r = o;
      else return { x: r.x, z: r.z, y: r.y, heading: r.heading, lane: r.lane };
    }
    return { x: r.x, z: r.z, y: r.y, heading: r.heading, lane: r.lane };
  }

  // height under a wheel: the road's own surface on a road, its kerb and pavement beside it, then the world,
  // blended in over a few metres so the edge of what the roads module knows is not a step
  ground(x, z, yHint) {
    const R = this.roadsObj;
    const r = R && R.surfaceAt ? R.surfaceAt(x, z, yHint) : null;
    const lift = this.mode === 'google' ? GLIFT : 0;
    if (r && r.onRoad) return r.h + lift;
    // on a kerb or pavement surfaceAt's height already includes the kerb
    if (r && r.curbH > 0 && Number.isFinite(r.h)) return r.h + lift;
    const w = this.world.groundAt(x, z, yHint);
    if (r && Number.isFinite(r.h) && r.edge !== undefined && r.edge !== null && r.edge < 14) {
      if (w === null) return r.h;
      if (this.mode === 'google') return w;
      // the open world's terrain is coarse: ease from the road's height into it over a few metres
      const t = THREE.MathUtils.smoothstep(r.edge, 2, 14);
      return r.h + (w - r.h) * t;
    }
    if (w === null && r && Number.isFinite(r.h)) return r.h;
    return w;
  }

  async setCar(id, quiet) {
    const C = this.mods.cars;
    let rig, spec = {};
    try {
      if (C && id) { rig = await C.loadCar(id); spec = (C.CARS.find(c => c.id === id) || {}).physics || {}; Object.assign(spec, { mass: (C.CARS.find(c => c.id === id) || {}).mass || spec.mass }); }
    } catch (e) { console.warn('car load failed', e); }
    if (!rig) rig = boxRig();
    if (spec.mass === undefined) delete spec.mass;
    const old = this.car;
    const vehicle = new Vehicle(rig, spec);
    if (old) {
      vehicle.pos.copy(old.vehicle.pos); vehicle.q.copy(old.vehicle.q); vehicle.pos.y += 0.3;
      this.scene.remove(old.rig.object); old.rig.dispose && old.rig.dispose();
    }
    if (this.carEnv && rig.setEnvMap) rig.setEnvMap(this.carEnv);
    this.scene.add(rig.object);
    this.car = { rig, vehicle, id };
    this.carId = id;
    if (!quiet && C) this.hud.flash((C.CARS.find(c => c.id === id) || {}).name || id);
  }

  async loadArea(x, z, first) {
    const data = await this.fetchArea(x, z, first);
    if (!data) { this.hud.flash('Could not load the streets here'); return; }
    await this.buildArea(data, x, z);
  }

  // the streets round (x, z): Overpass has every tag but can take a while; OpenFreeMap's tiles come at once with
  // fewer. Whichever is first builds the streets, and Overpass's answer replaces the tiles' when it comes.
  async fetchArea(x, z, first) {
    const O = this.mods.osm;
    if (!O) return null;
    const g = unproject(x, z), radius = first ? 650 : 800;
    // the elevation under the next area first (the open world's ground and every road height come from it)
    if (this.world.heights && !first) { try { await this.world.heights.want(g.lat, g.lon, 1300); } catch (e) {} }
    const ovp = O.load(g.lat, g.lon, radius).then(d => d, e => { console.warn('osm', e); return null; });
    // the tiles are fetched at once too, so they are there if Overpass is slow
    const mvtP = import('./mvt.js?v=6').then(M => M.load(g.lat, g.lon, radius)).catch(e => { console.warn('mvt', e); return null; });
    let data = await Promise.race([ovp, new Promise(r => setTimeout(() => r('slow'), first ? 4000 : 6000))]);
    if (data === 'slow' || data === null || !data.roads || !data.roads.length) {
      const tiles = await mvtP;
      if (tiles && tiles.roads.length) {
        if (data === 'slow') ovp.then(d => { if (d && d.roads && d.roads.length && this.active && this.areaAt && this.areaAt.x === x && this.areaAt.z === z) this.buildArea(d, x, z); });
        data = tiles;
      } else if (data === 'slow') data = await ovp;
    }
    return data || null;
  }

  async buildArea(data, x, z) {
    const T0 = performance.now(), times = {};
    const mark = k => { times[k] = Math.round(performance.now() - T0); };
    data = trimTo(data, x, z, 1000);
    this.osmData = data;
    // the new area is built beside the old one (its own collision world, its own meshes), then swapped in
    const collide = new Collide();
    const oldExtra = this.world.extra.slice();
    const ground = (x, z, y) => this.world.groundAt(x, z, y);
    const ctx = { groundAt: ground, scene: this.scene, world: this.world, collide, imagery: this.imageryObj, mph: this.mph, sidewalks: this.mode === 'open',
      trees: this.mode === 'open' ? (this.mods.trees ? 'none' : 'draw') : 'collide', renderer: this.G.renderer, focus: [x, z] };
    // With Google's mesh its own road (real paint, patches, manholes) is what shows: ours is drawn 15 cm under it and
    // only fills the holes left where the cars baked into the photos are cut away (from 0.2 m up). Heights read from
    // the roads module get the 15 cm back (GLIFT).
    if (this.mode === 'google') ctx.lift = -GLIFT;
    try {
      if (this.mods.imagery && !this.imageryObj && this.mode === 'open') { this.imageryObj = this.mods.imagery.createImagery ? this.mods.imagery.createImagery() : this.mods.imagery; ctx.imagery = this.imageryObj; }
    } catch (e) { console.warn('imagery', e); }
    const swap = async (key, make) => {
      const old = this[key];
      try { const nu = await make(); this[key] = nu; if (old && old !== nu && old.dispose) old.dispose(); } catch (e) { console.warn(key, e); }
    };
    if (this.mods.roads) await swap('roadsObj', () => this.mods.roads.build(data, ctx));
    mark('roads');
    ctx.roads = this.roadsObj;
    // Google's mesh has cars baked into the streets: cut the carriageways out of it so our road shows
    // (in the open world the same mask, a little narrower than the carriageway, keeps the coarse terrain from
    // poking up through the road)
    try {
      if (!this.cut) this.cut = new CutMask();
      const R = this.roadsObj, open = this.mode === 'open';
      const edges = R && R._debug ? (R._debug().edges || null) : null;
      const surf = R && R.surfaceAt ? (a, b) => { const r = R.surfaceAt(a, b); return open || !r.onRoad ? r : { onRoad: true, h: r.h + GLIFT }; } : null;
      this.cut.build(x, z, data.roads || [], surf, open ? ground : null, open ? { edges, widthScale: 0.86, cap: 'butt', parking: false, top: 1.6, below: 0.6 } : { edges, widthScale: 1.0, top: 4.2, below: -0.2 });
    } catch (e) { console.warn('cut mask', e); }
    if (this.mods.props) await swap('propsObj', () => this.mods.props.build(data, ctx));
    mark('props');
    // cars parked along the kerbs where the road has room for them
    try {
      if (this.mods.cars && this.roadsObj) {
        if (!this.parked) this.parked = new Parked({ scene: this.scene, cars: this.mods.cars });
        await this.parked.build(this.roadsObj, data, { cx: x, cz: z, collide, lift: this.mode === 'google' ? GLIFT : 0, leftHand: !!this.roadsObj.leftHand });
      }
    } catch (e) { console.warn('parked cars', e); }
    if (this.mode === 'open') {
      if (this.mods.buildings) await swap('bldgObj', () => this.mods.buildings.build(data.buildings || [], ctx));
      mark('buildings');
      // the facades' glass reflects a real street (the cars' HDR photo) rather than the plain sky
      try { const M = this.bldgObj && this.bldgObj.material; if (M && this.carEnv && M.envMap !== this.carEnv) { M.envMap = this.carEnv; M.needsUpdate = true; } } catch (e) {}
      ctx.buildings = data.buildings || [];
      if (this.mods.trees) await swap('treesObj', () => this.mods.trees.build(data, ctx));
    } else {
      // building footprints still stop the car where Google's mesh has them
      for (const b of data.buildings || []) if (!b.part && (b.height === null || b.height > 2)) collide.addPolygon(b.outer, -1e4, 1e4, 'building');
    }
    this.collide = collide;
    if (this.auto) this.auto.L = null;
    if (oldExtra.length) this.world.extra = this.world.extra.filter(o => !oldExtra.includes(o));
    this.areaAt = { x, z };
    mark('all');
    this.G.lastBuild = times;
    if (this.active) { if (this.traffic && this.traffic.rebind && this.roadsObj && this.roadsObj.graph) { try { this.traffic.rebind(); } catch (e) { console.warn('rebind', e); this.makeTraffic(); } } else this.makeTraffic(); }
  }

  makeTraffic() {
    const R = this.roadsObj;
    if (this.traffic && this.traffic.dispose) this.traffic.dispose();
    this.traffic = null;
    if (!this.mods.traffic || !R || !R.graph) return;
    // busier in towns than in the country: a car per 55 m of lane where there are many buildings, per 200 m where not
    const bl = (this.osmData && this.osmData.buildings) || [], o = this.car ? this.car.vehicle.pos : { x: 0, z: 0 };
    let near = 0; for (const b of bl) { const p = b.outer && b.outer[0]; if (p && (p[0] - o.x) ** 2 + (p[1] - o.z) ** 2 < 350 * 350) near++; }
    const per = near > 120 ? 55 : near > 30 ? 90 : 200;
    try { this.traffic = new this.mods.traffic.Traffic({ scene: this.scene, roads: R, props: this.propsObj, cars: this.mods.cars, ground: (x, z, y) => this.ground(x, z, y), collide: this.collide, world: this.world, carEnv: this.carEnv, yLift: this.mode === 'google' ? GLIFT : 0, per }); } catch (e) { console.warn('traffic', e); }
  }

  clearArea() {
    for (const k of ['roadsObj', 'propsObj', 'bldgObj', 'treesObj']) { if (this[k] && this[k].dispose) this[k].dispose(); this[k] = null; }
    if (this.traffic && this.traffic.dispose) this.traffic.dispose();
    this.traffic = null;
    this.collide = new Collide();
    this.world.extra.length = 0;
    if (this.cut) this.cut.off();
    if (this.parked) this.parked.clear();
  }

  update(dt) {
    if (!this.active || !this.car) return;
    SIG.tick(dt);
    const inp = this.input(dt);
    const v = this.car.vehicle;
    const others = this.traffic && this.traffic.colliders ? this.traffic.colliders() : null;
    const env = { ground: (x, z, y) => this.ground(x, z, y), collide: this.collide, others };
    this.acc += dt;
    let n = 0;
    if (!this.prevPos) { this.prevPos = v.pos.clone(); this.prevQ = v.q.clone(); }
    while (this.acc >= STEP && n < 12) { this.prevPos.copy(v.pos); this.prevQ.copy(v.q); v.step(STEP, inp, env); this.acc -= STEP; n++; }
    if (n === 12) this.acc = 0;
    if (v.hits.length) { for (const h of v.hits) if (h.other && h.other.obj && this.traffic && this.traffic.bumped) this.traffic.bumped(h.other.obj, h); const big = v.hits.reduce((a, h) => Math.max(a, h.speed), 0); if (big > 4) this.hud.bump(big); if (big > 1.5 && performance.now() - (this.lastHit || 0) > 250) { this.sound.hit(big); this.lastHit = performance.now(); } }
    // fell out of the world: back to the road
    const o = v.origin();
    const g = this.ground(o.x, o.z);
    if ((g !== null && o.y < g - 6) || v.pos.y < -2000 || !Number.isFinite(v.pos.x)) this.respawn();
    // on its side or roof and not moving: back on its wheels after two seconds
    const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(v.q).y;
    this.flipT = upY < 0.45 && v.speed < 3 ? (this.flipT || 0) + dt : 0;
    if (this.flipT > 2) { this.flipT = 0; this.hud.flash('Back on the road'); this.respawn(); }
    // the model, drawn between the last two physics steps so it glides however the frames fall
    const rig = this.car.rig, a = Math.min(1, this.acc / STEP);
    const q = this.drawQ || (this.drawQ = new THREE.Quaternion());
    q.copy(this.prevQ).slerp(v.q, a);
    const p = (this.drawP || (this.drawP = new THREE.Vector3())).copy(this.prevPos).lerp(v.pos, a);
    rig.object.quaternion.copy(q);
    rig.object.position.copy(v.com).applyQuaternion(q).negate().add(p);
    // an indicator cancels itself once the wheel has been turned its way and comes back, as a real one does
    if (this.signal === -1 || this.signal === 1) {
      const turned = this.signal === -1 ? v.steer > 0.12 : v.steer < -0.12;
      if (turned) this.sigTurned = true;
      else if (this.sigTurned && Math.abs(v.steer) < 0.03) { this.signal = 0; this.sigTurned = false; }
    } else this.sigTurned = false;
    const look = v.look();
    look.signal = this.signal; look.headlights = this.headlights; look.dt = dt;
    rig.update(dt, look);
    this.cam.update(dt, this.car, this.world, { lookBack: this.lookBack, others });
    this.G.sky.update(this.camera, o);
    if (this.traffic) this.traffic.update(dt, { x: o.x, z: o.z, heading: v.heading, speed: v.fwdSpeed, vehicle: v });
    if (this.propsObj && this.propsObj.update) this.propsObj.update(dt, this.camera);
    if (this.parked) this.parked.update(this.camera);
    // re-sample road heights where finer ground came in, at most every 3 s, and the cut mask with them
    this.dirtyT -= dt;
    if (this.dirty && this.dirtyT <= 0 && this.roadsObj && this.roadsObj.reheight) {
      const d = this.dirty; this.dirty = null; this.dirtyT = 3;
      const c = this.car.vehicle.pos;
      const box = { x0: Math.max(d.x0, c.x - 350), z0: Math.max(d.z0, c.z - 350), x1: Math.min(d.x1, c.x + 350), z1: Math.min(d.z1, c.z + 350) };
      try { this.roadsObj.reheight(box); if (this.traffic && this.traffic.relink) this.traffic.relink(); } catch (e) { console.warn('reheight', e); }
      if (this.cut && this.osmData && performance.now() - (this.cutAt || 0) > 8000) {
        this.cutAt = performance.now();
        const R = this.roadsObj;
        this.cut.build(this.cut.center.x, this.cut.center.z, this.osmData.roads || [], (a, b) => { const r = R.surfaceAt(a, b); return r.onRoad ? { onRoad: true, h: r.h + GLIFT } : r; }, null, { edges: R._debug ? R._debug().edges : null, top: 4.2, below: -0.2 });
      }
    }
    // streaming: load the streets ahead once the car is 300 m from where they were loaded
    if (this.areaAt && !this.loadingArea && Math.hypot(o.x - this.areaAt.x, o.z - this.areaAt.z) > 400) {
      this.loadingArea = true;
      this.loadArea(o.x, o.z).finally(() => { this.loadingArea = false; });
    }
    this.hud.update(dt, v, this);
    const sg = this.signal;
    this.sound.update(dt, v, sg ? Math.floor(performance.now() / 333) % 2 === 0 : null);
  }
}

// only what lies within r of (x, z): the store keeps everything loaded so far, a drive only needs its surroundings
function trimTo(d, x, z, r) {
  const R2 = r * r, near = pts => { for (const p of pts) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < R2) return true; return false; };
  const out = { ...d };
  out.roads = (d.roads || []).filter(e => near(e.pts));
  out.buildings = (d.buildings || []).filter(b => near(b.outer));
  out.barriers = (d.barriers || []).filter(b => near(b.pts));
  out.lines = (d.lines || []).filter(b => near(b.pts));
  out.treeRows = (d.treeRows || []).filter(b => near(b.pts));
  out.areas = (d.areas || []).filter(b => near(b.outer));
  out.points = (d.points || []).filter(p => (p.x - x) ** 2 + (p.z - z) ** 2 < R2);
  return out;
}

function ptOf(L, s) {
  const c = L.cum, p = L.pts; let i = 1;
  while (i < p.length - 1 && c[i] < s) i++;
  const t = Math.max(0, Math.min(1, (s - c[i - 1]) / Math.max(1e-6, c[i] - c[i - 1])));
  return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * t, z: p[i - 1].z + (p[i].z - p[i - 1].z) * t };
}
function hdOf(L, s) {
  const a = ptOf(L, s), b = ptOf(L, Math.min(L.len, s + 3));
  return (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360;
}

// of the two ways along a road, the one closer to the wanted heading
function pickDir(roadHd, want) {
  const d = ((want - roadHd) % 360 + 540) % 360 - 180;
  return Math.abs(d) <= 90 ? roadHd : (roadHd + 180) % 360;
}

// a plain stand-in car until the real models load (or if they fail)
export function boxRig() {
  const object = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x1d4f91, metalness: 0.6, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.7, 4.6), paint); body.position.y = 0.65; object.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.4), new THREE.MeshPhysicalMaterial({ color: 0x111820, metalness: 0.2, roughness: 0.05 })); cabin.position.set(0, 1.25, 0.2); object.add(cabin);
  const wheels = [], wobj = [];
  const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const pos = [[-0.8, 0.34, -1.4], [0.8, 0.34, -1.4], [-0.8, 0.34, 1.4], [0.8, 0.34, 1.4]];
  pos.forEach((p, i) => {
    const pivot = new THREE.Group(); pivot.position.set(...p); object.add(pivot);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 24), tyre); w.rotation.z = Math.PI / 2;
    const spin = new THREE.Group(); spin.add(w); pivot.add(spin);
    wobj.push({ pivot, spin });
    wheels.push({ pos: new THREE.Vector3(...p), radius: 0.34, steer: i < 2 });
  });
  return {
    object, wheels,
    dims: { length: 4.6, width: 1.85, height: 1.5, wheelbase: 2.8, track: 1.6 },
    mounts: { driver: new THREE.Vector3(-0.37, 1.2, 0.15), hood: new THREE.Vector3(0, 1.15, -0.6), bumper: new THREE.Vector3(0, 0.55, -2.35), chase: new THREE.Vector3(0, 2, 6) },
    update(dt, s) {
      wobj.forEach((w, i) => {
        w.spin.rotation.x = -s.wheelSpin[i];
        w.pivot.rotation.y = i < 2 ? s.steer : 0;
        w.pivot.position.y = pos[i][1] + (s.susp ? s.susp[i] : 0);
      });
    },
    setPaint(c) { paint.color.set(c); },
    dispose() {},
  };
}
