// Pedestrians: people walking the pavements (lines along each road's kerbs from roads.js), some standing about
// (on the phone, waiting, two talking), more in busy streets than in the country, pooled and limited by distance.
// They step out of the way of a car coming slowly at them; a car that hits them throws them (people.js ragdoll), they
// land and lie a moment, then get up angry at that car: shout (a speech bubble), shake a fist, some walk after it or
// phone someone; people nearby turn to look. drive.events gets { type: 'ped-hit', person, speed, car, point }.
//   const peds = new Peds(drive); await peds.start(); peds.update(dt) each frame; peds.rebuild() after a new area
//   (new roads); peds.clear(); peds.list (each { p: Person, state, ... }); peds.max (cap, default 34)
import * as THREE from 'three';
import { People } from './people.js?v=22';

const LINES = {
  hit: ['Hey!', 'Watch it!', 'Are you crazy?', 'Slow down!', 'You hit me!', 'Ow!', 'What are you doing?!', 'Look where you are going!', 'Learn to drive!', 'Unbelievable!'],
  chase: ['Come back here!', 'Hey, stop!', 'Get out of the car!', "Don't you drive away!"],
  phone: ['Yes, a car just hit me...', "I'm calling the police!", 'I got the plate number!'],
  near: ['Whoa!', 'Careful!', 'Hey, the pavement!', 'Slow down!'],
  look: ['Did you see that?', 'Oh my god!', 'Are you OK?', 'Someone call an ambulance!']
};
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const pick = a => a[(Math.random() * a.length) | 0];

export class Peds {
  constructor(drive) {
    this.drive = drive; this.scene = drive.scene;
    this.list = []; this.paths = []; this.max = 34; this.ready = false;
    const qm = /[?&]peds=(\d+)/.exec(location.search); if (qm) this.max = +qm[1]; // (tests: how many at most)
    this.group = new THREE.Group(); this.group.name = 'pedestrians'; this.scene.add(this.group);
    this.spawnT = 0; this.frame = 0; this.carsCache = []; this.carsFrame = -1; this.busy = 0.5;
    this.bubbles = new Bubbles(drive);
    this.rand = Math.random;
  }

  // the models and the clips, fetched while the world loads (drive.start calls this early)
  prepare() {
    if (this.prepP) return this.prepP;
    this.prepP = (async () => {
      await People.load(null, this.drive.camera); // (their shaders are built with the scene's by drive.start)
      if (!this.looks) {
        const looks = [];
        for (let i = 0; i < 12; i++) looks.push(People.randomLook(Math.random, { kid: i === 11 }));
        await People.preload(looks);
        this.looks = looks;
      }
    })();
    return this.prepP;
  }

  async start() {
    const D = this.drive;
    await this.prepare();
    People.camera = D.camera;
    People.env = {
      ground: (x, z, y) => D.ground(x, z, y),
      get collide() { return D.collide; },
      cars: () => this.cars()
    };
    this.ready = true;
    this.rebuild();
    // a first crowd round the start, so the street is not empty on arrival
    const want = this.target();
    for (let i = 0; i < want * 3 && this.list.length < want; i++) this.spawn(true);
    // every person's shaders, the shadow map's too, made in the frame drawn behind the loading card
    if (!/[?&]nowarm/.test(location.search)) try { if (this.warm) this.warm.dispose(); this.warm = People.warmup(D.scene, this.anchor()); this.warmFrames = 3; } catch (e) { console.warn('people warm-up', e); }
    // their shaders built with the rest of the scene (drive.start compiles the scene after this)
    this.moreT = 8;
  }

  // ---- pavements ---------------------------------------------------------------------------------------------------
  // a walking line a little in from each kerb of every road that has a pavement, cut short of the junctions
  rebuild() {
    const R = this.drive.roadsObj, L = R && R._debug ? R._debug() : null;
    const paths = [];
    let total = 0;
    const surf = R && R.surfaceAt ? (x, z) => R.surfaceAt(x, z) : null;
    const T0 = performance.now();
    if (L && L.edges) for (const e of L.edges) {
      const c = e.c; if (!c || !e.px || e.px.length < 2 || c.bridge) continue;
      if (!c.curbL && !c.curbR) continue;
      const s0 = (e.set0 || 0) + 1.5, s1 = e.len - (e.set1 || 0) - 1.5;
      if (s1 - s0 < 6) continue;
      for (const side of [-1, 1]) {
        if (side < 0 ? !c.curbL : !c.curbR) continue;
        const sw = side < 0 ? (c.swWL || 2.4) : (c.swWR || 2.4);
        const off = c.hw + 0.3 + Math.max(0.55, Math.min(sw * 0.5, 1.8));
        // (a stretch that lies on a road, the inner side of a dual carriageway's half, a slip road, is left out:
        // the line is cut there)
        let px = [], pz = [], cum = [], s = 0, lx = 0, lz = 0;
        const flush = () => {
          if (px.length >= 2 && s >= 6) { paths.push({ id: paths.length, px, pz, cum, len: s, side, edge: e.id, urban: !!c.urban, w: sw, cx: (px[0] + px[px.length - 1]) / 2, cz: (pz[0] + pz[pz.length - 1]) / 2 }); total += s; }
          px = []; pz = []; cum = []; s = 0;
        };
        for (let i = 0; i < e.px.length; i++) {
          const es = e.ps[i];
          if (es < s0 - 3 || es > s1 + 3) continue;
          const k = e.mk ? Math.min(1.6, e.mk[i]) : 1;
          const x = e.px[i] + e.nx[i] * off * side * k, z = e.pz[i] + e.nz[i] * off * side * k;
          if (surf) { const r = surf(x, z); if (r && r.onRoad) { flush(); continue; } }
          if (px.length) { const d = Math.hypot(x - lx, z - lz); if (d < 0.3) continue; s += d; }
          px.push(x); pz.push(z); cum.push(s); lx = x; lz = z;
        }
        flush();
      }
    }
    this.paths = paths;
    // bus stops: a few people waiting at each
    this.stops = ((this.drive.osmData && this.drive.osmData.points) || []).filter(q => q.kind === 'bus_stop').map(q => ({ x: q.x, z: q.z, n: 0 }));
    // ends near each other (round a corner) can be walked between when the way across is not the road
    const ends = [];
    for (const p of paths) { ends.push([p, 0]); ends.push([p, 1]); }
    for (const p of paths) p.links = [[], []];
    this.buildMs = Math.round(performance.now() - T0);
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      const [a, ea] = ends[i], [b, eb] = ends[j];
      if (a === b) continue;
      const ax = ea ? a.px[a.px.length - 1] : a.px[0], az = ea ? a.pz[a.pz.length - 1] : a.pz[0];
      const bx = eb ? b.px[b.px.length - 1] : b.px[0], bz = eb ? b.pz[b.pz.length - 1] : b.pz[0];
      const d = Math.hypot(ax - bx, az - bz);
      if (d > 14) continue;
      if (surf) { const r = surf((ax + bx) / 2, (az + bz) / 2); if (r && r.onRoad && d > 3) continue; }
      a.links[ea].push([b, eb, d]); b.links[eb].push([a, ea, d]);
    }
    // how busy: buildings round the player
    const bl = (this.drive.osmData && this.drive.osmData.buildings) || [], o = this.anchor();
    let near = 0; for (const b of bl) { const p = b.outer && b.outer[0]; if (p && (p[0] - o.x) ** 2 + (p[1] - o.z) ** 2 < 300 * 300) near++; }
    this.busy = near > 150 ? 1 : near > 60 ? 0.6 : near > 15 ? 0.3 : 0.08;
    // people already out: onto the nearest new line (or gone)
    for (let i = this.list.length - 1; i >= 0; i--) {
      const P = this.list[i];
      const r = this.nearestPath(P.x, P.z, 12);
      if (r) { P.path = r.path; P.s = r.s; } else if (P.state === 'walk' || P.state === 'stand') { this.remove(i); }
      else P.path = null;
    }
  }

  nearestPath(x, z, maxD) {
    let best = null, bd = maxD;
    for (const p of this.paths) {
      if (Math.abs(p.cx - x) > p.len / 2 + maxD + 5 || Math.abs(p.cz - z) > p.len / 2 + maxD + 5) continue;
      for (let i = 1; i < p.px.length; i++) {
        const ax = p.px[i - 1], az = p.pz[i - 1], dx = p.px[i] - ax, dz = p.pz[i] - az, L2 = dx * dx + dz * dz;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
        const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
        if (d < bd) { bd = d; best = { path: p, s: p.cum[i - 1] + Math.sqrt(L2) * t, d }; }
      }
    }
    return best;
  }

  at(p, s, out) {
    const c = p.cum, n = c.length;
    if (s <= 0) { out.x = p.px[0]; out.z = p.pz[0]; out.dx = p.px[1] - p.px[0]; out.dz = p.pz[1] - p.pz[0]; return out; }
    if (s >= p.len) { out.x = p.px[n - 1]; out.z = p.pz[n - 1]; out.dx = p.px[n - 1] - p.px[n - 2]; out.dz = p.pz[n - 1] - p.pz[n - 2]; return out; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const t = (s - c[lo]) / Math.max(1e-6, c[hi] - c[lo]);
    out.dx = p.px[hi] - p.px[lo]; out.dz = p.pz[hi] - p.pz[lo];
    out.x = p.px[lo] + out.dx * t; out.z = p.pz[lo] + out.dz * t;
    return out;
  }

  anchor() {
    const D = this.drive;
    if (D.onfoot && D.onfoot.active && D.onfoot.focus) { const f = D.onfoot.focus(); if (f) return f; }
    if (D.car && D.car.vehicle) return D.car.vehicle.pos;
    return D.camera.position;
  }

  // how many people the street round the player should have
  target() {
    const o = this.anchor();
    let len = 0;
    const near = this.nearPaths || (this.nearPaths = []);
    near.length = 0;
    for (const p of this.paths) if (Math.abs(p.cx - o.x) < 120 + p.len / 2 && Math.abs(p.cz - o.z) < 120 + p.len / 2) { near.push(p); if (Math.abs(p.cx - o.x) < 140 && Math.abs(p.cz - o.z) < 140) len += p.len; }
    return Math.min(this.max, Math.round(len / 100 * 3.2 * this.busy));
  }

  // ---- people --------------------------------------------------------------------------------------------------
  spawn(initial) {
    if (!this.paths.length || !this.looks) return null;
    const o = this.anchor(), cd = this.drive.camera.getWorldDirection(_w);
    const cl = Math.hypot(cd.x, cd.z) || 1, fx = cd.x / cl, fz = cd.z / cl;
    // now and then someone waiting at a bus stop
    if (this.stops && this.stops.length && Math.random() < 0.3) {
      const st = this.stops[(Math.random() * this.stops.length) | 0], d = Math.hypot(st.x - o.x, st.z - o.z);
      if (st.n < 3 && d < 110 && d > (initial ? 5 : 40) && (initial || d > 80 || ((st.x - o.x) * fx + (st.z - o.z) * fz) < 0)) {
        const r = this.nearestPath(st.x + (Math.random() - 0.5) * 3, st.z + (Math.random() - 0.5) * 3, 12);
        if (r && !this.list.some(P => Math.hypot(P.x - st.x, P.z - st.z) < 0.9 && P.stop !== st)) return this.add(r.path, r.s, this.at(r.path, r.s, {}), initial, st);
      }
    }
    const list = this.nearPaths && this.nearPaths.length ? this.nearPaths : this.paths;
    for (let tries = 0; tries < 14; tries++) {
      const p = list[(Math.random() * list.length) | 0];
      const s = Math.random() * p.len;
      const q = this.at(p, s, {});
      const d = Math.hypot(q.x - o.x, q.z - o.z);
      if (d > 120 || d < (initial ? 6 : 45)) continue;
      // later arrivals out of sight: behind the camera or far
      if (!initial && d < 80 && ((q.x - o.x) * fx + (q.z - o.z) * fz) > 0) continue;
      if (this.list.some(P => Math.hypot(P.x - q.x, P.z - q.z) < 1.2)) continue;
      return this.add(p, s, q, initial);
    }
    return null;
  }

  add(path, s, q, initial, stop) {
    const look = this.looks[(Math.random() * this.looks.length) | 0];
    const l = { ...look, height: 0.94 + Math.random() * 0.12 };
    const p = People.createPerson(l, { lod: 'auto', far: 130 });
    const r = Math.random();
    const P = { p, path, s, dir: Math.random() < 0.5 ? 1 : -1, lat: (Math.random() - 0.5) * Math.min(1.1, path.w * 0.4), speed: 1.2 + Math.random() * 0.35,
      x: q.x, z: q.z, y: 0, yaw: 0, state: 'walk', t: 0, gy: -1, gyT: 0, mad: null, look: null, lookT: 0, bubble: null, id: p.id };
    if (stop) {
      // waiting for the bus: at the kerb side of the pavement, facing the road
      P.state = 'stand'; P.t = 40 + Math.random() * 80; P.stop = stop; stop.n++;
      P.lat = -0.35 + (Math.random() - 0.5) * 0.3;
      const k = Math.random(); P.anim = k < 0.45 ? 'wait' : k < 0.75 ? 'phone' : 'idle';
      p.play(P.anim, { fade: 0 });
      const l = Math.hypot(q.dx, q.dz) || 1, fx = q.dz / l * path.side, fz = -q.dx / l * path.side;
      P.yaw = Math.atan2(fx, -fz) + (Math.random() - 0.5) * 0.8;
    } else
    // a share stand about: on the phone, waiting, or two talking
    if (r < 0.22 * (initial ? 1.3 : 1)) {
      P.state = 'stand'; P.t = 8 + Math.random() * 25;
      P.lat = (path.w * 0.4) * (Math.random() < 0.5 ? 1 : 0.6);
      const kind = Math.random();
      P.anim = kind < 0.35 ? 'phone' : kind < 0.55 ? 'phone_call' : kind < 0.8 ? 'wait' : 'idle';
      p.play(P.anim, { fade: 0 });
      // facing the road or along it
      const a = this.at(path, s, {}), side = path.side;
      P.yaw = Math.atan2(a.dx, -a.dz) + (Math.random() < 0.6 ? side * Math.PI / 2 : 0);
      // two talking: a second one facing this one
      if (kind > 0.8 && this.list.length < this.max - 1) {
        const p2 = People.createPerson({ ...this.looks[(Math.random() * this.looks.length) | 0], height: 0.94 + Math.random() * 0.12 }, { lod: 'auto', far: 130 });
        const P2 = { p: p2, path, s: s + 0.9, dir: 1, lat: P.lat, speed: 1.3, x: 0, z: 0, y: 0, yaw: 0, state: 'stand', t: P.t, anim: 'listen', id: p2.id, gy: -1, gyT: 0 };
        const b = this.at(path, s + 0.9, {});
        P.yaw = Math.atan2(b.x - a.x, -(b.z - a.z)); P2.yaw = P.yaw + Math.PI;
        P.anim = 'talk'; p.play('talk', { fade: 0 }); p2.play('listen', { fade: 0 });
        P.partner = P2; P2.partner = P;
        this.place(P2, b); this.group.add(p2.object); this.list.push(P2);
      }
    } else {
      p.play('walk', { fade: 0, speed: P.speed / 1.3 });
    }
    this.place(P, q);
    this.group.add(p.object);
    this.list.push(P);
    return P;
  }

  remove(i) {
    const P = this.list[i];
    if (P.stop) { P.stop.n--; P.stop = null; }
    if (P.bubble) this.bubbles.free(P.bubble);
    if (P.partner) P.partner.partner = null;
    P.p.dispose();
    this.list.splice(i, 1);
  }

  clear() { for (let i = this.list.length - 1; i >= 0; i--) this.remove(i); this.paths = []; }

  place(P, q) {
    const p = P.path;
    // lateral place across the pavement
    const l = Math.hypot(q.dx, q.dz) || 1, nx = -q.dz / l, nz = q.dx / l;
    P.x = q.x + nx * P.lat * (p ? p.side : 1); P.z = q.z + nz * P.lat * (p ? p.side : 1);
    this.ground(P, true);
    const o = P.p.object;
    o.position.set(P.x, P.y, P.z);
    o.rotation.set(0, -P.yaw, 0);
  }

  ground(P, force) {
    P.gyT -= 1;
    if (!force && P.gyT > 0) return;
    const D = this.drive;
    const g = D.ground(P.x, P.z, P.y + 0.6);
    if (g !== null && Number.isFinite(g)) P.y = g;
    P.gyT = 3;
  }

  // ---- the cars, as boxes for hits, dodging and the ragdolls --------------------------------------------------------
  cars() {
    if (this.carsFrame === this.frame) return this.carsCache;
    this.carsFrame = this.frame;
    const out = this.carsCache; let n = 0;
    const D = this.drive;
    const put = (x, y, z, yaw, len, wid, hgt, vx, vz, front, rear, ref, player) => {
      let c = out[n]; if (!c) c = out[n] = {};
      // box centre along the car (its origin is between the axles)
      const mid = (front - rear) / 2, fx = Math.sin(yaw), fz = -Math.cos(yaw);
      c.x = x + fx * mid; c.z = z + fz * mid; c.y = y; c.yaw = yaw; c.len = len; c.wid = wid; c.hgt = hgt; c.vx = vx; c.vz = vz; c.ref = ref; c.player = player;
      n++;
    };
    const car = D.car;
    if (car && car.vehicle && car.rig && car.rig.dims) {
      const v = car.vehicle, d = car.rig.dims, o = car.rig.object.position;
      const h = v.heading * Math.PI / 180;
      put(o.x, o.y, o.z, h, d.length, d.width, d.height || 1.45, v.v.x, v.v.z, d.front ?? d.length / 2, d.rear ?? d.length / 2, car, true);
    }
    const T = D.traffic;
    if (T && T.list) for (const c of T.list) {
      const d = c.rig && c.rig.dims; if (!d) continue;
      const yaw = c.yaw + (c.offYaw || 0), fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw);
      put(c.x, c.y ?? 0, c.z, yaw, d.length, d.width, d.height || 1.45, fx * c.v + (c.push ? c.push.x : 0), fz * c.v + (c.push ? c.push.y : 0), d.front ?? d.length / 2, d.rear ?? d.length / 2, c, false);
    }
    // cars the player left standing (onfoot.js), which can still roll
    const left = D.onfoot && D.onfoot.parked;
    if (left) for (const e of left) {
      const r = e.rig, d = r && r.dims, ob = r && r.object; if (!d || !ob || e === car) continue;
      _v.set(0, 0, -1).applyQuaternion(ob.quaternion);
      const yaw = Math.atan2(_v.x, -_v.z), vv = e.vehicle && e.vehicle.v;
      put(ob.position.x, ob.position.y, ob.position.z, yaw, d.length, d.width, d.height || 1.45, vv ? vv.x : 0, vv ? vv.z : 0, d.front ?? d.length / 2, d.rear ?? d.length / 2, e, false);
    }
    out.length = n;
    return out;
  }

  // ---- per frame ---------------------------------------------------------------------------------------------------
  update(dt) {
    if (!this.ready) return;
    const T0 = performance.now();
    this._update(Math.min(dt, 0.1));
    // (how long this takes, for tests: an average in ms)
    this.ms = (this.ms || 0) * 0.95 + (performance.now() - T0) * 0.05;
  }

  _update(dt) {
    this.frame++;
    if (this.warm && --this.warmFrames <= 0) { this.warm.dispose(); this.warm = null; }
    const o = this.anchor();
    // more variety as the drive goes on
    this.moreT -= dt;
    if (this.moreT < 0 && this.looks.length < 22) {
      this.moreT = 12;
      const l = People.randomLook(Math.random, { kid: Math.random() < 0.12 });
      People.preload([l]).then(() => this.looks.push(l)).catch(() => {});
    }
    // spawning and despawning
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.5;
      for (let i = this.list.length - 1; i >= 0; i--) { const P = this.list[i]; if (Math.hypot(P.x - o.x, P.z - o.z) > 150 && P.state !== 'down') this.remove(i); }
      const want = this.target();
      if (this.list.length < want) this.spawn(false);
    }
    const cars = this.cars();
    for (let i = 0; i < this.list.length; i++) {
      const P = this.list[i];
      try { this.step(P, dt, cars); } catch (e) { console.warn('pedestrian', e); P.state = 'stand'; }
    }
    this.bubbles.update(dt, this.drive.camera);
  }

  step(P, dt, cars) {
    const p = P.p;
    P.t -= dt;
    if (P.state === 'down') { this.down(P, dt); p.update(dt); return; }
    // a car on them: thrown, or nudged if barely moving
    const hit = this.contact(P, cars);
    if (hit) { this.hit(P, hit); p.update(dt); return; }
    switch (P.state) {
      case 'walk': this.walk(P, dt, cars); break;
      case 'stand': this.stand(P, dt, cars); break;
      case 'dodge': this.dodge(P, dt); break;
      case 'angry': this.angry(P, dt); break;
      case 'chase': this.chase(P, dt); break;
      case 'watch': this.watch(P, dt); break;
      case 'getup': break;
    }
    const ob = p.object;
    ob.position.set(P.x, P.y, P.z);
    // turn smoothly toward the way wanted
    const cur = -ob.rotation.y;
    let d = P.yaw - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
    ob.rotation.y = -(cur + d * Math.min(1, dt * 6));
    p.update(dt);
  }

  walk(P, dt, cars) {
    const path = P.path;
    if (!path) { P.state = 'stand'; P.t = 5; P.p.play('idle'); return; }
    P.s += P.dir * P.speed * dt;
    if (P.s < 0 || P.s > path.len) {
      // the end of this stretch: round the corner onto the next, or back
      const end = P.s > path.len ? 1 : 0, links = path.links[end];
      if (links.length && Math.random() < 0.85) {
        const [b, eb] = links[(Math.random() * links.length) | 0];
        P.path = b; P.s = eb ? b.len - 0.1 : 0.1; P.dir = eb ? -1 : 1;
      } else { P.dir = -P.dir; P.s = Math.max(0, Math.min(path.len, P.s)); }
    }
    const q = this.at(P.path, P.s, this._q || (this._q = {}));
    const l = Math.hypot(q.dx, q.dz) || 1, side = P.path.side;
    // the lateral place eases toward its own (after a corner the line is another's)
    const tx = q.x + (-q.dz / l) * P.lat * side, tz = q.z + (q.dx / l) * P.lat * side;
    const gx = tx - P.x, gz = tz - P.z, gd = Math.hypot(gx, gz);
    if (gd > 1.2) {
      // off the line (back from the road, out of a car): walk to it first
      P.s -= P.dir * P.speed * dt;
      const v = Math.min(gd, P.speed * dt) / gd;
      P.x += gx * v; P.z += gz * v;
      P.yaw = Math.atan2(gx, -gz);
    } else {
      const k = Math.min(1, dt * 3);
      P.x += gx * k; P.z += gz * k;
      P.yaw = Math.atan2(q.dx * P.dir, -q.dz * P.dir);
    }
    this.ground(P);
    // someone in the way on the pavement: step to the side to pass
    if (((this.frame + (P.id | 0)) & 3) === 0) {
      const fx = Math.sin(P.yaw), fz = -Math.cos(P.yaw), wmax = Math.max(0.3, Math.min(1.1, P.path.w * 0.4));
      const F = this.drive.onfoot, me = F && F.active && F.focus ? F.focus() : null;
      for (let k = -1; k < this.list.length; k++) {
        // (the player walking is in the way too)
        const Q = k < 0 ? me : this.list[k];
        if (!Q || Q === P || Q.state === 'down') continue;
        const dx = Q.x - P.x, dz = Q.z - P.z, ahead = dx * fx + dz * fz;
        if (ahead <= 0 || ahead > 2.2 || Math.abs(dx * -fz + dz * fx) > 0.7) continue;
        // to whichever side has more room, the other gives way the other way
        const want = P.lat > 0 ? P.lat - 0.75 : P.lat + 0.75;
        P.lat = Math.max(-wmax, Math.min(wmax, want));
        break;
      }
    }
    // a car coming slowly at them: out of its way
    this.watchCars(P, cars, dt);
    // now and then a stop
    if (Math.random() < dt * 0.006) { P.state = 'stand'; P.t = 3 + Math.random() * 8; P.anim = Math.random() < 0.5 ? 'phone' : 'idle2'; P.p.play(P.anim); }
  }

  stand(P, dt, cars) {
    this.ground(P);
    this.watchCars(P, cars, dt);
    if (P.t <= 0 && !P.partner && P.path) { P.state = 'walk'; P.p.play('walk', { speed: P.speed / 1.3 }); if (P.stop) { P.stop.n--; P.stop = null; } }
    else if (P.t <= 0 && P.partner) P.t = 10 + Math.random() * 20;
    if (P.lookT > 0) { P.lookT -= dt; if (P.lookT <= 0) P.p.lookAt(null); }
  }

  // cars near: look at one coming, step aside if it is coming at them slowly (a fast one there is no time for)
  watchCars(P, cars, dt) {
    if ((this.frame + P.id) % 4 || P.noDodge) return;
    for (const c of cars) {
      const dx = P.x - c.x, dz = P.z - c.z, d2 = dx * dx + dz * dz;
      if (d2 > 14 * 14) continue;
      const sp = Math.hypot(c.vx, c.vz);
      if (sp < 0.8) continue;
      // closest approach of the car's middle to the person over the next 2 s
      const t = Math.max(0, Math.min(2, (dx * c.vx + dz * c.vz) / (sp * sp)));
      const cx = c.x + c.vx * t - P.x, cz = c.z + c.vz * t - P.z, miss = Math.hypot(cx, cz);
      if (miss < c.wid / 2 + 1.2 && t > 0.15 && sp < 5.5) {
        // out of the way: across the car's path, to the side they are already on
        const nx = -c.vz / sp, nz = c.vx / sp, sgn = (dx * nx + dz * nz) >= 0 ? 1 : -1;
        P.state = 'dodge'; P.t = 1.1; P.dodge = { vx: nx * sgn * 2.6, vz: nz * sgn * 2.6, car: c };
        P.p.play('run', { fade: 0.15, speed: 1.1 });
        P.yaw = Math.atan2(nx * sgn, -nz * sgn);
        P.p.lookAt(_v.set(c.x, P.y + 1.2, c.z));
        if (c.player && Math.random() < 0.5) this.say(P, pick(LINES.near), 2);
        return;
      }
      if (c.player && d2 < 10 * 10 && P.state === 'walk' && sp > 3 && !P.lookT) { P.p.lookAt(_v.set(c.x, P.y + 1.3, c.z)); P.lookT = 1.5; }
    }
    if (P.lookT > 0) { P.lookT -= dt * 4; if (P.lookT <= 0) { P.lookT = 0; P.p.lookAt(null); } }
  }

  dodge(P, dt) {
    const D = P.dodge;
    P.x += D.vx * dt; P.z += D.vz * dt;
    this.ground(P);
    if (P.t <= 0) {
      P.p.lookAt(null);
      // a word at the driver if it was the player
      P.state = 'stand'; P.t = 2 + Math.random() * 2; P.anim = 'idle'; P.p.play(Math.random() < 0.5 ? 'shrug' : 'idle', { once: true, onEnd: p => p.play('idle') });
      const r = this.nearestPath(P.x, P.z, 6); if (r) { P.path = r.path; P.s = r.s; }
    }
  }

  // ---- hits --------------------------------------------------------------------------------------------------------
  contact(P, cars) {
    for (const c of cars) {
      const dx = P.x - c.x, dz = P.z - c.z;
      if (dx * dx + dz * dz > 49) continue;
      if (P.y > c.y + c.hgt + 0.2 || P.y + 1.6 < c.y) continue;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      const lf = dx * s - dz * co, lr = dx * co + dz * s;
      const r = 0.28;
      if (Math.abs(lf) > c.len / 2 + r || Math.abs(lr) > c.wid / 2 + r) continue;
      const sp = Math.hypot(c.vx, c.vz);
      return { car: c, speed: sp, lf, lr };
    }
    return null;
  }

  hit(P, h) {
    const c = h.car, p = P.p, sp = h.speed;
    if (sp < 1.6) {
      // barely moving: pushed back a step, and cross about it
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      const out = Math.abs(h.lf) / (c.len / 2) > Math.abs(h.lr) / (c.wid / 2) ? [Math.sign(h.lf) * s, -Math.sign(h.lf) * co] : [Math.sign(h.lr) * co, Math.sign(h.lr) * s];
      P.x += out[0] * 0.08; P.z += out[1] * 0.08;
      if (P.state !== 'angry') { this.makeAngry(P, c, 0); }
      return;
    }
    // thrown: the bumper takes the legs at the car's speed (the car's shape then turns the body onto the bonnet,
    // up the windscreen at speed); the upper body starts slower, and a little lift
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw), side = h.lr / (c.wid / 2);
    const front = h.lf > 0 ? 1 : -1;
    const vel = new THREE.Vector3(c.vx * 0.75, 0.25 + sp * 0.12, c.vz * 0.75);
    // a little sideways when hit off the corner
    vel.x += co * side * sp * 0.12; vel.z += s * side * sp * 0.12;
    // (no push to turn over: the bonnet and the legs going first do that; a little twist)
    const spin = new THREE.Vector3(0, (Math.random() - 0.5) * sp * 0.15, 0);
    // the car came further than one frame's worth: start the body touching its front, not inside it
    const pen = c.len / 2 + 0.28 - Math.abs(h.lf);
    const shift = new THREE.Vector3(s * front * Math.max(0, pen), 0, -co * front * Math.max(0, pen));
    p.lookAt(null);
    p.ragdoll(vel, spin, { low: 0.3, car: c, shift });
    if (P.bubble) { this.bubbles.free(P.bubble); P.bubble = null; }
    P.state = 'down'; P.t = 0; P.downT = 0; P.mad = { car: c.ref, player: c.player, speed: sp };
    if (P.partner) { const Q = P.partner; Q.partner = null; P.partner = null; if (Q.state === 'stand') this.bystander(Q, P); }
    // everyone near looks
    for (const Q of this.list) if (Q !== P && (Q.state === 'walk' || Q.state === 'stand') && Math.hypot(Q.x - P.x, Q.z - P.z) < 28) this.bystander(Q, P);
    try { this.drive.events && this.drive.events.dispatchEvent({ type: 'ped-hit', person: p, speed: sp, car: c.ref, player: c.player, point: new THREE.Vector3(P.x, P.y + 0.9, P.z) }); } catch (e) { console.warn('ped-hit listener', e); }
    try { if (this.drive.sound && this.drive.sound.hit && c.player) this.drive.sound.hit(Math.min(8, sp * 0.6)); } catch (e) {}
  }

  down(P, dt) {
    const p = P.p;
    P.downT += dt;
    P.x = p.object.position.x; P.z = p.object.position.z; P.y = p.object.position.y;
    if (!p.isRagdoll) return;
    // lie still a moment once at rest (longer after a hard hit), then up
    const wait = 0.8 + Math.min(3, (P.mad ? P.mad.speed : 3) * 0.12);
    if ((p.restTime > wait && P.downT > 1.5) || P.downT > 12) {
      P.state = 'getup';
      p.getUp(() => { this.makeAngry(P, P.mad ? P.mad.car || null : null, 1); });
      // (the get-up starts lying the way the body lies: keep that turn and place)
      P.yaw = -p.object.rotation.y; P.x = p.object.position.x; P.z = p.object.position.z; P.y = p.object.position.y;
    }
  }

  makeAngry(P, car, afterHit) {
    const p = P.p;
    P.state = 'angry'; P.t = 4 + Math.random() * 2.5; P.stage = 0;
    P.madCar = car || (P.mad && P.mad.car) || null;
    p.mood = 'angry';
    const r = Math.random();
    p.play(r < 0.35 ? 'shout' : r < 0.6 ? 'shout2' : r < 0.85 ? 'fist' : 'point', { fade: 0.3 });
    this.say(P, pick(LINES.hit), 2.6);
    P.yaw = this.yawToCar(P) ?? P.yaw;
  }

  // a person made elsewhere joins the pedestrians: a driver pulled out of their car, passengers who ran, someone
  // thrown out in a crash (onfoot.js, occupants.js). opts: { angryAt (a car record, a traffic car, a CarRig or a
  // point; default the player), mood: 'angry' | 'scared' | 'calm', hurt }. A ragdolled person lies, gets up and is
  // angry as a pedestrian hit by a car is; one on their feet is angry (or walks off) at once. Then they walk the
  // pavement and are removed far away like everyone else. Returns the pedestrian record.
  adopt(person, opts = {}) {
    if (!person || !person.object) return null;
    const o = person.object;
    // into the pedestrians' group, keeping where it stands in the world, upright
    o.updateWorldMatrix(true, false);
    this.group.attach(o);
    _v.set(0, 0, -1).applyQuaternion(o.quaternion);
    const yaw = Math.atan2(_v.x, -_v.z);
    if (!person.isRagdoll) o.rotation.set(0, -yaw, 0);
    if (person.setLod) person.setLod('auto');
    if (person.ik) { person.ik.handL = person.ik.handR = person.ik.footL = person.ik.footR = null; }
    if (person.setSeated) try { person.seated = false; } catch (e) {}
    const P = { p: person, path: null, s: 0, dir: 1, lat: (Math.random() - 0.5) * 0.8, speed: 1.2 + Math.random() * 0.3,
      x: o.position.x, z: o.position.z, y: o.position.y, yaw, state: 'stand', t: 2, gy: -1, gyT: 0, mad: null, look: null, lookT: 0, bubble: null, id: person.id || Math.random(), adopted: true };
    const target = opts.angryAt || this.playerThing();
    this.list.push(P);
    if (person.isRagdoll) { P.state = 'down'; P.downT = 0; P.mad = { car: target, player: true, speed: opts.speed || 6 }; }
    else if ((opts.mood || 'angry') === 'angry') { this.makeAngry(P, target, 0); P.t = 2.5 + Math.random() * 1.5; P.stage = 1; }
    else if (opts.mood === 'scared') { P.state = 'stand'; P.t = 0; this.resume(P, !!opts.hurt); P.speed = 1.7; P.p.play('walk_fast', { fade: 0.3 }); if (Math.random() < 0.5) this.say(P, pick(LINES.near), 2); }
    else this.resume(P, !!opts.hurt);
    // people near turn to look
    for (const Q of this.list) if (Q !== P && !Q.adopted && (Q.state === 'walk' || Q.state === 'stand') && Math.hypot(Q.x - P.x, Q.z - P.z) < 22 && Math.random() < 0.7) this.bystander(Q, P);
    return P;
  }

  // what an adopted person is angry at when nobody says: the player (on foot) or the player's car
  playerThing() {
    const D = this.drive;
    if (D.onfoot && D.onfoot.active && D.onfoot.focus) { const f = D.onfoot.focus(); if (f) return { x: f.x, y: f.y, z: f.z, live: () => D.onfoot.focus() }; }
    return D.car || null;
  }

  carPos(P) {
    const c = P.madCar || (P.mad && P.mad.car);
    if (!c) return null;
    if (c.live) { const f = c.live(); if (f) return f; }
    if (c.vehicle && c.rig) return c.rig.object.position; // the player's car record
    if (c.rig && c.rig.object) return c.rig.object.position; // a traffic car
    if (c.object && c.object.position) return c.object.position; // a CarRig
    if (c.x !== undefined) return _w.set(c.x, c.y || 0, c.z);
    return null;
  }
  yawToCar(P) { const q = this.carPos(P); return q ? Math.atan2(q.x - P.x, -(q.z - P.z)) : null; }

  angry(P, dt) {
    const p = P.p, q = this.carPos(P);
    this.ground(P);
    if (q) { P.yaw = Math.atan2(q.x - P.x, -(q.z - P.z)); p.lookAt(_v.set(q.x, q.y + 1.2, q.z)); }
    if (P.t > 0) return;
    // what next: after a car still close and slow, walk at it; or phone someone; or carry on, limping
    P.stage++;
    const d = q ? Math.hypot(q.x - P.x, q.z - P.z) : 99;
    const car = P.madCar, slow = car && car.vehicle ? car.vehicle.speed < 3 : true;
    if (P.stage === 1 && q && d < 22 && d > 3 && slow && Math.random() < 0.6) {
      P.state = 'chase'; P.t = 5; p.play('walk_fast', { fade: 0.2 }); this.say(P, pick(LINES.chase), 2.2); return;
    }
    if (P.stage <= 2 && Math.random() < 0.45) {
      P.state = 'angry'; P.t = 6; p.play('phone_call', { fade: 0.3 }); this.say(P, pick(LINES.phone), 3); p.lookAt(null); return;
    }
    p.lookAt(null);
    this.resume(P, true);
  }

  chase(P, dt) {
    const q = this.carPos(P);
    if (!q) { this.resume(P, true); return; }
    const dx = q.x - P.x, dz = q.z - P.z, d = Math.hypot(dx, dz);
    P.yaw = Math.atan2(dx, -dz);
    if (d > 3.2) { const v = 1.9 * dt / d; P.x += dx * v; P.z += dz * v; this.ground(P); }
    if (d <= 3.2 || P.t <= 0) {
      P.state = 'angry'; P.t = 3 + Math.random() * 2; P.stage = 2;
      P.p.play(Math.random() < 0.5 ? 'shout' : 'angry', { fade: 0.3 });
      this.say(P, pick(LINES.hit), 2.4);
    }
  }

  // a person near an accident: turns to look, maybe takes a picture or phones, then carries on
  bystander(Q, P) {
    Q.state = 'watch'; Q.t = 4 + Math.random() * 5; Q.watching = P;
    const r = Math.random();
    Q.p.play(r < 0.15 ? 'photo' : r < 0.3 ? 'phone_call' : r < 0.5 ? 'idle2' : 'idle', { fade: 0.3 });
    if (Math.random() < 0.25) this.say(Q, pick(LINES.look), 2.5);
  }

  watch(P, dt) {
    const W = P.watching;
    this.ground(P);
    if (W) { const t = W.p.bonePos('head', _v); P.yaw = Math.atan2(t.x - P.x, -(t.z - P.z)); P.p.lookAt(t); }
    if (P.t <= 0) { P.p.lookAt(null); P.watching = null; this.resume(P, false); }
  }

  resume(P, hurt) {
    P.state = 'walk'; P.p.mood = null;
    const r = this.nearestPath(P.x, P.z, 30);
    if (r) { P.path = r.path; P.s = r.s; } else P.path = null;
    if (!P.path) { P.state = 'stand'; P.t = 8; P.p.play('idle'); return; }
    P.speed = hurt ? 0.9 : 1.2 + Math.random() * 0.35;
    P.p.play(hurt ? 'limp' : 'walk', { fade: 0.3, speed: hurt ? 1 : P.speed / 1.3 });
  }

  say(P, text, dur) {
    if (!P.bubble) P.bubble = this.bubbles.get();
    if (!P.bubble) return;
    P.bubble.show(P.p, text, dur, () => { P.bubble = null; });
    if (P.p.talk) P.p.talk(Math.min(dur, 0.35 + text.length * 0.06));
  }

  dispose() {
    if (this.warm) { this.warm.dispose(); this.warm = null; }
    this.clear();
    this.scene.remove(this.group);
    this.bubbles.dispose();
    this.ready = false;
  }
}

// ---- speech bubbles: a few HTML labels over people's heads -----------------------------------------------------------
class Bubbles {
  constructor(drive) {
    this.drive = drive; this.pool = []; this.live = [];
    if (!document.getElementById('ped-bubble-style')) {
      const st = document.createElement('style'); st.id = 'ped-bubble-style';
      st.textContent = `.ped-bubble{position:fixed;left:0;top:0;z-index:6;pointer-events:none;transform:translate(-50%,-100%);background:#fff;color:#202124;font:600 14px/1.25 'Google Sans',Roboto,Arial,sans-serif;padding:6px 10px;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);white-space:nowrap;opacity:0;transition:opacity .15s}
.ped-bubble::after{content:'';position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;border-bottom:0;border-top-color:#fff}
.ped-bubble.on{opacity:1}`;
      document.head.appendChild(st);
    }
  }
  get() {
    let b = this.pool.pop();
    if (!b) {
      if (this.live.length >= 8) return null;
      const el = document.createElement('div'); el.className = 'ped-bubble'; document.body.appendChild(el);
      b = { el, person: null, t: 0, done: null, show(person, text, dur, done) { this.person = person; this.t = dur; this.done = done; el.textContent = text; el.classList.add('on'); } };
    }
    this.live.push(b);
    return b;
  }
  free(b) { b.el.classList.remove('on'); b.person = null; const i = this.live.indexOf(b); if (i >= 0) this.live.splice(i, 1); this.pool.push(b); }
  update(dt, cam) {
    const W = innerWidth, H = innerHeight;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      b.t -= dt;
      if (b.t <= 0 || !b.person || b.person.disposed) { const f = b.done; this.free(b); if (f) f(); continue; }
      const p = b.person.bonePos('head', _v); p.y += 0.32;
      const d = p.distanceTo(cam.position);
      p.project(cam);
      if (p.z > 1 || d > 60 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) { b.el.style.opacity = '0'; continue; }
      b.el.style.opacity = '';
      b.el.style.transform = `translate(${(p.x * 0.5 + 0.5) * W}px, ${(-p.y * 0.5 + 0.5) * H}px) translate(-50%, -100%) scale(${Math.max(0.7, Math.min(1.1, 14 / d))})`;
    }
  }
  dispose() { for (const b of [...this.live, ...this.pool]) b.el.remove(); this.live.length = 0; this.pool.length = 0; }
}
