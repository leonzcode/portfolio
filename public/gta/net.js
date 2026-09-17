/* ---------------------------------------------------------------------------
   One city, everybody in it.

   The server is a relay, not a simulation: it keeps who is connected and where
   they say they are, and passes that on. Everything about how a car handles or
   where a bullet lands stays on the machine of whoever is doing it, which is what
   keeps the thing responsive over a real connection.

   Positions arrive about fourteen times a second, so everything here is smoothed
   towards the last thing that was said rather than snapped to it, and a remote
   player's legs are driven by how fast their position is changing rather than by
   anything the sender bothers to tell us.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { makePerson, poseWalk, poseIdle, poseAim, poseSit } from './person.js';
import { makeCar, CAR_KINDS } from './vehicle.js';

const WS = (location.hostname.endsWith('leonzhao.dev'))
  ? 'wss://apps.leonzhao.dev/mc/ws'
  : (new URLSearchParams(location.search).get('ws') || 'wss://apps.leonzhao.dev/mc/ws');

const SHIRTS = [0x2a3a6a, 0x8a2a2a, 0x2e6b4a, 0xd0d0d0, 0x3b3b42, 0x7a4f9a, 0xc07a2a, 0x1f1f24];
const SKINS = [0xe8c39a, 0xd9a877, 0xb07a4e, 0x8a5a36, 0x5f3b22, 0xf0d2b4];

function tagFor(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 34px Oswald, "Arial Narrow", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.85)';
  g.strokeText(name, 128, 34);
  g.fillStyle = '#e8f0f8';
  g.fillText(name, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false }));
  s.scale.set(1.9, 0.48, 1);
  s.position.y = 2.15;
  s.renderOrder = 5;
  return s;
}

export function connect(ctx) {
  const { scene, player, say, esc } = ctx;
  const others = new Map();                 // id -> { g, car, ... }
  let ws = null, me = 0, sendAt = 0, alive = false, myName = '';

  const url = WS + (WS.indexOf('?') >= 0 ? '&' : '?') + 'mode=gta';
  try { ws = new WebSocket(url); } catch (e) { return null; }

  ws.onopen = () => { alive = true; };
  ws.onclose = () => {
    alive = false;
    for (const [, o] of others) dropOther(o);
    others.clear();
    say('Lost the connection. Still driving, just on your own.', 'sys');
  };
  ws.onerror = () => {};
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === 'init') {
      me = m.id; myName = m.name;
      say('You are <b>' + esc(m.name) + '</b>. '
        + (m.players.length ? m.players.length + ' other' + (m.players.length > 1 ? 's' : '') + ' out there.' : 'Nobody else about.'), 'sys');
      for (const p of m.players) addOther(p);
      return;
    }
    if (m.type === 'join') { addOther(m.player); say('<b>' + esc(m.player.name) + '</b> joined', 'sys'); return; }
    if (m.type === 'leave') { const o = others.get(m.id); if (o) { dropOther(o); others.delete(m.id); } return; }
    if (m.type === 'pos') {
      const o = others.get(m.id); if (!o) return;
      o.tx = m.x; o.ty = m.y; o.tz = m.z; o.tyaw = m.yaw;
      o.inCar = !!m.car; o.kindId = m.kind || null; o.sp = m.sp || 0; o.aim = !!m.aim;
      return;
    }
    if (m.type === 'name') { const o = others.get(m.id); if (o) retag(o, m.name); return; }
    if (m.type === 'chat') {
      say('<b>' + esc(m.name) + '</b> ' + esc(m.text), m.id === me ? 'me' : '');
      return;
    }
    if (m.type === 'note') { say(esc(m.text), 'sys'); return; }
    if (m.type === 'hurt') {
      ctx.damage(m.dmg);
      if (player.hp <= 0) send({ type: 'down', by: m.from });
      return;
    }
    if (m.type === 'fx') {
      const at = new THREE.Vector3(m.x, m.y, m.z);
      if (m.what === 'blast') ctx.explode(at);
      else {
        const dir = new THREE.Vector3(m.dx, m.dy, m.dz);
        if (dir.lengthSq() > 0.001) {
          ctx.tracer(at, at.clone().addScaledVector(dir.normalize(), 60));
        }
      }
      return;
    }
  };

  function send(obj) { if (alive) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }

  function addOther(p) {
    if (!p || p.id === me || others.has(p.id)) return;
    const g = makePerson(SHIRTS[p.id % SHIRTS.length], SKINS[(p.id * 7) % SKINS.length]);
    g.position.set(p.x || 0, p.y || 0, p.z || 0);
    const tag = tagFor(p.name || 'someone');
    g.add(tag);
    scene.add(g);
    others.set(p.id, {
      id: p.id, g, tag, name: p.name, car: null, kindId: null,
      x: p.x || 0, y: p.y || 0, z: p.z || 0, tx: p.x || 0, ty: p.y || 0, tz: p.z || 0,
      yaw: p.yaw || 0, tyaw: p.yaw || 0, sp: 0, phase: 0, inCar: false, aim: false,
    });
  }
  function dropOther(o) {
    scene.remove(o.g);
    if (o.car) scene.remove(o.car.group);
  }
  function retag(o, name) {
    o.name = name;
    o.g.remove(o.tag);
    o.tag = tagFor(name);
    o.g.add(o.tag);
  }
  function carFor(o) {
    // they got into something: build the same shape they say they are driving
    const kind = CAR_KINDS.find(k => k.id === o.kindId) || CAR_KINDS[0];
    if (o.car && o.car.kind === kind) return o.car;
    if (o.car) scene.remove(o.car.group);
    o.car = makeCar(kind, () => ((o.id * 2654435761) % 1000) / 1000);
    scene.add(o.car.group);
    return o.car;
  }

  return {
    get alive() { return alive; },
    get count() { return others.size; },
    get others() { return others; },
    get name() { return myName; },
    chat(text) { send({ type: 'chat', text }); },
    rename(name) { send({ type: 'name', name }); },
    hit(id, dmg) { send({ type: 'hit', id, dmg }); },
    shot(from, dir) {
      send({ type: 'fx', what: 'shot', x: +from.x.toFixed(2), y: +from.y.toFixed(2), z: +from.z.toFixed(2),
             dx: +dir.x.toFixed(3), dy: +dir.y.toFixed(3), dz: +dir.z.toFixed(3) });
    },
    blast(pos, dmg, r) {
      send({ type: 'fx', what: 'blast', x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2), r });
    },
    tick(dt) {
      if (!alive) return;
      const now = performance.now();
      if (now - sendAt > 70) {
        sendAt = now;
        const inCar = !!player.car;
        const p = inCar ? player.car.pos : player.pos;
        send({
          type: 'pos', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
          yaw: +(inCar ? player.car.yaw : player.look).toFixed(3),
          car: inCar, kind: inCar ? player.car.kind.id : null,
          aim: player.aiming,
          sp: inCar ? +player.car.speed.toFixed(1) : +player.speed.toFixed(1),
        });
      }
      for (const [, o] of others) {
        const k = Math.min(1, dt * 11);
        const px = o.x, pz = o.z;
        o.x += (o.tx - o.x) * k;
        o.y += (o.ty - o.y) * k;
        o.z += (o.tz - o.z) * k;
        let d = o.tyaw - o.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        o.yaw += d * Math.min(1, dt * 9);

        const moved = Math.hypot(o.x - px, o.z - pz) / Math.max(dt, 0.001);
        if (o.inCar) {
          const car = carFor(o);
          car.pos.set(o.x, o.y, o.z);
          car.yaw = o.yaw;
          car.wheelSpin += moved * dt / 0.34;
          car.apply();
          car.group.visible = true;
          o.g.visible = false;
        } else {
          if (o.car) { o.car.group.visible = false; }
          o.g.visible = true;
          o.g.position.set(o.x, o.y, o.z);
          o.g.rotation.y = o.yaw;
          o.phase += moved * dt * 1.5;
          if (o.aim) poseAim(o.g, 0);
          else if (moved > 0.4) poseWalk(o.g, o.phase, Math.min(1, moved / 9));
          else poseIdle(o.g, now / 1000 + o.id);
        }
      }
    },
  };
}
