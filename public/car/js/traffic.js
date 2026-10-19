// The game's own traffic: cars that drive the lane graph from roads.js. Each follows the car or the stop line in
// front with the Intelligent Driver Model (smooth speeding up, braking and queueing), picks a way at each junction
// and signals for it, stops at red lights (signals.js, the same timing the lights show), waits at stop signs, gives
// way at junctions without lights, slows for the player's car in its path, and stops with its hazards on when hit.
import * as THREE from 'three';
import * as SIG from './signals.js?v=11';
import { frame } from './geo.js?v=11';

const AMERICAN = new Set(['s10', 'conquer', 'shvan']);
const inAmericas = () => frame.lat > 14 && frame.lat < 72 && frame.lon > -170 && frame.lon < -52;
const nearNYC = () => Math.abs(frame.lat - 40.74) < 0.25 && Math.abs(frame.lon + 73.95) < 0.3;
const PAINTS = [0xf2f2f0, 0xf2f2f0, 0x111214, 0x111214, 0x8c9096, 0xb8bcc2, 0x55595f, 0x1e3a6b, 0x7a1418, 0x24402c, 0xc9b99a, 0x3d4a5c, 0x9a2a1d, 0xe8e2d0];
const S0 = 2.2, T_HEAD = 1.25, A_MAX = 1.9, B_COMF = 2.6, LOOK = 70;
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0);

function laneAt(L, s, out) {
  // point and tangent on a lane at distance s (clamped)
  const c = L.cum, p = L.pts, n = p.length;
  if (s <= 0) { out.x = p[0].x; out.y = p[0].y; out.z = p[0].z; return out; }
  if (s >= L.len) { out.x = p[n - 1].x; out.y = p[n - 1].y; out.z = p[n - 1].z; return out; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
  const t = (s - c[lo]) / Math.max(1e-6, c[hi] - c[lo]);
  out.x = p[lo].x + (p[hi].x - p[lo].x) * t; out.y = p[lo].y + (p[hi].y - p[lo].y) * t; out.z = p[lo].z + (p[hi].z - p[lo].z) * t;
  return out;
}

export class Traffic {
  constructor({ scene, roads, cars, ground, carEnv, yLift, per }) {
    this.per = per || 55;
    this.scene = scene; this.roads = roads; this.C = cars; this.ground = ground; this.carEnv = carEnv || null; this.yLift = yLift || 0;
    this.lanes = roads.graph.lanes;
    this.byId = new Map(); for (const L of this.lanes) this.byId.set(L.id, L);
    this.list = []; this.pool = new Map(); this.max = 28; this.t = 0; this.scanT = 0; this.near = [];
    this.group = new THREE.Group(); this.group.name = 'traffic'; scene.add(this.group);
    this.loading = 0; this.dead = false;
    // pickups and the boxy van are an American sight: elsewhere the saloons, the hatchback and the old 911
    this.models = cars && cars.TRAFFIC ? cars.TRAFFIC.filter(m => inAmericas() || !AMERICAN.has(m)) : [];
    this.first = true;
  }

  lane(id) { return this.byId.get(id); }

  // the roads were rebuilt for a new area (new lanes, new ids): put every car on the nearest lane going its way
  rebind() {
    this.lanes = this.roads.graph.lanes;
    this.byId = new Map(); for (const L of this.lanes) this.byId.set(L.id, L);
    const R = this.roads;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i], hd = c.yaw * 180 / Math.PI;
      const r = R.nearestLane(c.x - c.off.x, c.z - c.off.y, 6, L => L.kind === 'road' && L.len > 2);
      const ok = r && Math.abs(((r.heading - hd) % 360 + 540) % 360 - 180) < 50;
      if (!ok) { this.freeRig(c.rig); this.list.splice(i, 1); continue; }
      c.L = r.lane; c.s = r.s; c.path = []; c.stopDone = null; c.wait = 0;
      this.extendPath(c);
    }
    this.scanT = 0;
  }

  // the roads were re-sampled (new lane objects with the same ids): move every car onto the new ones
  relink() {
    this.lanes = this.roads.graph.lanes;
    this.byId = new Map(); for (const L of this.lanes) this.byId.set(L.id, L);
    for (const c of this.list) { c.L = this.byId.get(c.L.id) || c.L; c.path = c.path.map(l => this.byId.get(l.id) || l); }
    this.scanT = 0;
  }

  // one of each model loaded (and its shaders built) before the drive starts, so nothing stalls once moving
  async preload(renderer, camera) {
    const ids = [...new Set(this.models)];
    const rigs = [];
    await Promise.all(ids.map(async id => { try { const r = await this.getRig(id); rigs.push(r); } catch (e) { this.models = this.models.filter(m => m !== id); } }));
    // built off the scene (for its lights), so no frame is drawn with shaders still to build
    const tmp = new THREE.Group(); for (const r of rigs) tmp.add(r.object);
    try { if (renderer.compileAsync) await Promise.race([renderer.compileAsync(tmp, camera, this.scene), new Promise(r => setTimeout(r, 10000))]); } catch (e) {}
    for (const r of rigs) { tmp.remove(r.object); this.freeRig(r); }
  }

  // a way on from the end of a lane: junction lanes lead to a road lane
  pickNext(L, avoidUturn = true) {
    const nx = (L.next || []).map(id => this.lane(id)).filter(Boolean);
    if (!nx.length) return null;
    let opts = avoidUturn ? nx.filter(l => l.turn !== 'uturn') : nx;
    if (!opts.length) opts = nx;
    // mostly straight on, sometimes a turn
    const sp = l => { const r = l.kind === 'junction' ? this.lane((l.next || [])[0]) : l; return r ? r.speed : 0; };
    const w = opts.map(l => (l.turn === 'straight' || !l.turn ? 3 : l.turn === 'uturn' ? 0.05 : 1) * (sp(l) < 7 ? 0.08 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
    return opts[opts.length - 1];
  }

  async getRig(model) {
    let free = this.pool.get(model);
    if (free && free.length) return free.pop();
    let color = PAINTS[(Math.random() * PAINTS.length) | 0];
    // New York's streets are full of yellow cabs: about a third of the saloons there
    if ((model === 'volvos90' || model === 'fairheaven') && nearNYC() && Math.random() < 0.35) color = 0xf2b705;
    const rig = await this.C.loadCar(model, { npc: true, color });
    if (this.carEnv && rig.setEnvMap) rig.setEnvMap(this.carEnv);
    rig.model = model;
    return rig;
  }
  freeRig(rig) {
    this.group.remove(rig.object);
    if (!this.pool.has(rig.model)) this.pool.set(rig.model, []);
    this.pool.get(rig.model).push(rig);
  }

  // road lanes near the player, refreshed every two seconds
  scan(px, pz) {
    const near = [];
    let len = 0;
    for (const L of this.lanes) {
      if (L.kind !== 'road' || L.len < 12 || !(L.next && L.next.length)) continue;
      const m = L.pts[(L.pts.length / 2) | 0], d = Math.hypot(m.x - px, m.z - pz);
      if (d < 300) { near.push(L); len += Math.min(L.len, 300); }
    }
    this.near = near;
    // about a car per 55 m of lane, at most 30
    this.want = Math.min(24, Math.round(len / this.per));
  }

  async spawn(px, pz, pfx, pfz, initial) {
    if (!this.near.length || !this.models.length || this.loading > 2) return;
    for (let tries = 0; tries < 12; tries++) {
      const L = this.near[(Math.random() * this.near.length) | 0];
      const s = 4 + Math.random() * Math.max(1, L.len - 8);
      const p = laneAt(L, s, {});
      const dx = p.x - px, dz = p.z - pz, d = Math.hypot(dx, dz);
      if (d < (initial ? 30 : 90) || d > 280) continue;
      // later arrivals appear out of sight: behind the player or far ahead
      if (!initial && (dx * pfx + dz * pfz) / d > 0.2 && d < 200) continue;
      if (this.list.some(c => c.L === L && Math.abs(c.s - s) < 14) || this.list.some(c => Math.hypot(c.x - p.x, c.z - p.z) < 10)) continue;
      const model = this.models[(Math.random() * this.models.length) | 0];
      this.loading++;
      let rig;
      try { rig = await this.getRig(model); } catch (e) { console.warn('traffic car', model, e); this.models = this.models.filter(m => m !== model); this.loading--; return; }
      this.loading--;
      if (this.dead) return;
      const vWant = L.speed * (0.85 + Math.random() * 0.2);
      const car = { rig, L, s, v: initial ? vWant * 0.7 : vWant * 0.8, vWant, len: rig.dims ? rig.dims.length : 4.6, path: [], x: p.x, y: p.y, z: p.z, yaw: 0, spin: 0, signal: 0, brake: 0,
        stopDone: null, wait: 0, hitT: 0, push: new THREE.Vector2(), off: new THREE.Vector2(), offYaw: 0, spinV: 0, stuck: 0 };
      this.extendPath(car);
      this.list.push(car);
      this.group.add(rig.object);
      this.place(car, 0);
      return;
    }
  }

  extendPath(car) {
    let last = car.path.length ? car.path[car.path.length - 1] : car.L, total = 0;
    for (const l of car.path) total += l.len;
    while (car.path.length < 4 && total < 160) {
      const n = this.pickNext(last);
      if (!n) break;
      car.path.push(n); total += n.len; last = n;
    }
  }

  update(dt, player) {
    if (this.dead) return;
    this.t += dt; this.dt = dt; this.frame = (this.frame || 0) + 1;
    const px = player.x, pz = player.z, hd = player.heading * Math.PI / 180, pfx = Math.sin(hd), pfz = -Math.cos(hd);
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scan(px, pz); this.scanT = 2; }
    if (this.first && this.near.length) {
      this.first = false;
      const n = Math.round((this.want || 10) * 0.8);
      (async () => { for (let i = 0; i < n && !this.dead; i++) await this.spawn(px, pz, pfx, pfz, true); })();
    } else if (this.list.length + this.loading < (this.want || 0) && Math.random() < dt * 2) this.spawn(px, pz, pfx, pfz, false);

    // who is on which lane
    const occ = new Map();
    for (const c of this.list) { let a = occ.get(c.L.id); if (!a) occ.set(c.L.id, a = []); a.push(c); }
    // which junctions have someone crossing them
    const busy = new Map();
    for (const c of this.list) if (c.L.kind === 'junction') { let a = busy.get(c.L.node); if (!a) busy.set(c.L.node, a = []); a.push(c); }

    const pv = player.vehicle;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d > 330 || c.stuck > 40) { this.freeRig(c.rig); this.list.splice(i, 1); continue; }
      this.drive(c, dt, occ, busy, player, pv);
      if (c.gone) { this.freeRig(c.rig); this.list.splice(i, 1); continue; }
      // far cars are lost in the haze anyway: skip drawing them
      c.rig.object.visible = d < 170;
      if (c.rig.object.visible || (this.frame & 7) === 0) this.place(c, dt);
    }
  }

  // the gap to whatever is ahead along the car's way, and its speed
  ahead(c, occ, busy, player, pv) {
    let gap = Infinity, lv = 0, dist = -c.s;
    const way = [c.L, ...c.path];
    for (let k = 0; k < way.length && dist < LOOK; k++) {
      const L = way[k], on = occ.get(L.id);
      if (on) for (const o of on) {
        if (o === c) continue;
        const g = dist + o.s - (o.len / 2 + c.len / 2);
        if ((k > 0 || o.s > c.s) && g < gap) { gap = g; lv = o.v; }
      }
      // the end of this lane: a stop line or a junction to give way at
      if (k === 0 || dist < LOOK) {
        const end = dist + (L.stopS ?? L.len) - c.len / 2;
        if (L.signal != null && this.roads.signalGroups) {
          const G = this.roads.signalGroups.get(L.signal);
          if (G) {
            const h = headingAt(L, L.stopS ?? L.len);
            const st = SIG.state(G, h).s;
            const need = c.v * c.v / (2 * 3.2);
            if ((st === 'red' || (st === 'amber' && end > need + 2)) && end > -0.5 && end < gap) { gap = Math.max(0, end - 0.8); lv = 0; }
          }
        } else if (L.kind === 'road' && L.stop && end > -0.5) {
          if (c.stopDone !== L.id) {
            if (end < gap) { gap = Math.max(0, end - 0.5); lv = 0; }
            if (k === 0 && end < 3 && c.v < 0.4) { c.wait += this.dt || 1 / 60; if (c.wait > 1.6 && !this.crossing(busy, way[k + 1], c)) { c.stopDone = L.id; c.wait = 0; } }
          }
        } else if (L.kind === 'road' && k === 0 && way[1] && way[1].kind === 'junction' && end < 14) {
          // no lights: give way if someone else is crossing this junction
          if (this.crossing(busy, way[1], c) && end > 0.5 && end < gap) { gap = Math.max(0, end - 1); lv = 0; }
        }
      }
      dist += L.len;
    }
    // the player's car, if it is in this car's path
    const hd = c.yaw, fx = Math.sin(hd), fz = -Math.cos(hd);
    const dx = player.x - c.x, dz = player.z - c.z;
    const lon = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
    if (lon > 0 && lon < 50 && lat < 2.2 + lon * 0.02) {
      const g = lon - c.len / 2 - 2.4;
      if (g < gap) { gap = g; lv = pv ? Math.max(0, pv.v.x * fx + pv.v.z * fz) : 0; }
    } else if (lon > -c.len / 2 - 1 && lon <= 0 && lat < 2.1) {
      // the player's car alongside, overlapping this one: wait rather than grind along its side
      gap = 0; lv = 0;
    }
    return { gap, lv };
  }

  crossing(busy, J, c) {
    if (!J || J.kind !== 'junction') return false;
    const on = busy.get(J.node);
    if (!on) return false;
    return on.some(o => o !== c && o.L.from !== J.from);
  }

  drive(c, dt, occ, busy, player, pv) {
    if (c.hitT > 0) {
      // knocked: slide to a stop, hazards on, then carry on
      c.hitT -= dt;
      c.v = Math.max(0, c.v - 8 * dt);
      c.off.addScaledVector(c.push, dt);
      c.push.multiplyScalar(Math.exp(-dt * 3));
      c.offYaw += c.spinV * dt; c.spinV *= Math.exp(-dt * 3);
      c.signal = 2;
      if (c.hitT <= 0) c.signal = 0;
      c.s += c.v * dt;
      this.advance(c);
      return;
    }
    // ease back into the lane after a knock
    if (c.off.lengthSq() > 1e-4 || Math.abs(c.offYaw) > 1e-3) { const k = Math.exp(-dt * 0.8); c.off.multiplyScalar(k); c.offYaw *= k; }
    const { gap, lv } = this.ahead(c, occ, busy, player, pv);
    // slow for bends: the next lane's turn, or the speed limit of what comes
    let v0 = c.vWant;
    const nxt = c.path[0];
    const toEnd = c.L.len - c.s;
    if (c.L.kind === 'junction') v0 = Math.min(v0, c.L.turn === 'straight' ? c.vWant : 6.5);
    else if (nxt && nxt.kind === 'junction' && nxt.turn !== 'straight' && toEnd < 35) v0 = Math.min(v0, 6.5 + toEnd * 0.25);
    const dv = c.v - lv;
    const sStar = S0 + Math.max(0, c.v * T_HEAD + c.v * dv / (2 * Math.sqrt(A_MAX * B_COMF)));
    let a = A_MAX * (1 - Math.pow(c.v / Math.max(0.5, v0), 4) - (gap < Infinity ? Math.pow(sStar / Math.max(0.1, gap), 2) : 0));
    a = Math.max(-8, a);
    c.v = Math.max(0, c.v + a * dt);
    if (gap < 0.3 && c.v > 0) c.v = Math.max(0, c.v - 6 * dt);
    c.brake = a < -0.6 || c.v < 0.2 ? 1 : 0;
    c.stuck = c.v < 0.1 ? c.stuck + dt : 0;
    c.s += c.v * dt;
    // signal for a turn coming up
    const turn = nxt && nxt.kind === 'junction' && toEnd < 45 ? nxt.turn : c.L.kind === 'junction' ? c.L.turn : null;
    c.signal = turn === 'left' || turn === 'uturn' ? -1 : turn === 'right' ? 1 : 0;
    this.advance(c);
  }

  advance(c) {
    while (c.s > c.L.len) {
      const n = c.path.shift();
      if (!n) { c.s = c.L.len; c.v = 0; c.stuck += 0.5; if (c.stuck > 3) c.gone = true; return; }
      c.s -= c.L.len; c.L = n; c.wait = 0;
      this.extendPath(c);
    }
  }

  place(c, dt) {
    const L = c.L, half = Math.min(1.4, c.len * 0.3);
    const p = laneAt(L, c.s, {});
    // body direction from a point behind to a point ahead (smooth through the polyline's corners)
    const a = this.along(c, -half), b = this.along(c, half);
    let yaw = Math.atan2(b.x - a.x, -(b.z - a.z));
    if (!Number.isFinite(yaw)) yaw = c.yaw;
    const pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z) || 1);
    c.yaw = yaw;
    c.x = p.x + c.off.x; c.z = p.z + c.off.y;
    let y = p.y;
    if (c.off.lengthSq() > 0.01 && this.ground) { const g = this.ground(c.x, c.z, y); if (g !== null && Number.isFinite(g)) y = g; }
    c.y = y;
    const o = c.rig.object;
    o.position.set(c.x, y + 0.02 + (c.off.lengthSq() > 0.01 ? 0 : this.yLift), c.z);
    _e.set(pitch, -yaw - c.offYaw, 0, 'YXZ');
    o.quaternion.setFromEuler(_e);
    c.spin += c.v * dt / 0.33;
    const steer = THREE.MathUtils.clamp(-(this.curv(c)) * 2.7, -0.6, 0.6);
    c.rig.update(dt, { speed: c.v, wheelSpin: [c.spin, c.spin, c.spin, c.spin], steer, steeringWheel: steer * 14, susp: [0, 0, 0, 0], brake: c.brake, reverse: false, signal: c.signal, headlights: false });
  }

  // a point some metres along the car's way (negative: behind on its lane)
  along(c, d) {
    let L = c.L, s = c.s + d, k = 0;
    while (s > L.len && k < c.path.length) { s -= L.len; L = c.path[k++]; }
    return laneAt(L, Math.max(0, Math.min(L.len, s)), {});
  }
  curv(c) {
    const a = this.along(c, 0), b = this.along(c, 3), d = this.along(c, 6);
    const h1 = Math.atan2(b.x - a.x, -(b.z - a.z)), h2 = Math.atan2(d.x - b.x, -(d.z - b.z));
    let dh = h2 - h1; dh = (dh + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    return dh / 3;
  }

  // take away any car within r of (x, z) (the player's car is being put there)
  clearNear(x, z, r) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (Math.hypot(c.x - x, c.z - z) < r) { this.freeRig(c.rig); this.list.splice(i, 1); }
    }
  }

  // two circles a car for the player's collisions
  colliders() {
    const out = [];
    for (const c of this.list) {
      const fx = Math.sin(c.yaw + c.offYaw), fz = -Math.cos(c.yaw + c.offYaw), o = c.len * 0.27, r = 0.95;
      const vx = fx * c.v + c.push.x, vz = fz * c.v + c.push.y;
      out.push({ x: c.x + fx * o, z: c.z + fz * o, r, vx, vz, obj: c }, { x: c.x - fx * o, z: c.z - fz * o, r, vx, vz, obj: c });
    }
    return out;
  }

  bumped(c, hit) {
    if (!c) return;
    const k = Math.min(6, hit.j / 1500);
    c.push.x -= hit.nx * k; c.push.y -= hit.nz * k;
    c.spinV += (Math.random() - 0.5) * k * 0.4;
    c.hitT = Math.max(c.hitT, 5 + Math.min(6, hit.speed));
    c.v *= 0.3;
  }

  dispose() {
    this.dead = true;
    for (const c of this.list) this.group.remove(c.rig.object);
    this.list.length = 0;
    this.scene.remove(this.group);
  }
}

function headingAt(L, s) {
  const a = laneAt(L, Math.max(0, s - 2), {}), b = laneAt(L, Math.min(L.len, s + 0.01), {});
  return (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360;
}
