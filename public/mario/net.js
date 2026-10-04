/* ---------------------------------------------------------------------------
   One lobby, everybody in it.

   The server owns two things only: which round it is, and when the lights go
   out. Everything else - how a kart handles, where a shell went, who hit whom -
   is decided by the browser doing it and relayed. That keeps a race playable on
   an ordinary connection, and it means the worst a bad connection can do is make
   one kart look jumpy rather than stall the grid.

   Positions arrive about fourteen times a second, so a remote kart is always
   easing towards the last thing its owner said rather than snapping to it.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { record, pose, clear } from './smooth.js?v=105';
const drawn = { x: 0, y: 0, z: 0, yaw: 0 };

const WS = (location.hostname.endsWith('leonzhao.dev'))
  ? 'wss://apps.leonzhao.dev/mc/ws'
  : (new URLSearchParams(location.search).get('ws') || 'wss://apps.leonzhao.dev/mc/ws');

export function connect(ctx) {
  const { world, say, esc } = ctx;
  let ws = null, alive = false, settled = false, myId = 0, myName = '';
  let lastPhase = '', lastRound = -1, sendAt = 0;
  let sent = 0, got = 0;                 // counted, so a test can see which side went quiet
  let quitting = false;                  // left on purpose, for a ranked battle: nothing was lost
  const seen = new Map();            // id -> the last thing they said

  const url = WS + (WS.indexOf('?') >= 0 ? '&' : '?') + 'mode=mk'
    + (ctx.name ? '&name=' + encodeURIComponent(ctx.name) : '');
  try { ws = new WebSocket(url); } catch (e) { return null; }

  ws.onopen = () => {
    alive = true; settled = true;
    send({ type: 'cast', i: ctx.cast });
  };
  ws.onclose = () => {
    const was = alive;
    alive = false; settled = true;
    if (was && !quitting) say('Lost the lobby. Racing on your own from here.', 'sys');
  };
  ws.onerror = () => { settled = true; };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }

    if (m.type === 'init') {
      myId = m.id; myName = m.name;
      const others = m.players.filter(p => p.id !== myId).length;
      say('You are <b>' + esc(m.name) + '</b>. '
        + (others ? others + ' other' + (others > 1 ? 's' : '') + ' in the lobby.' : 'Nobody else here yet.'), 'sys');
      applyState(m);
      return;
    }
    if (m.type === 'state') { applyState(m); return; }
    if (m.type === 'join') {
      // remember them straight away: a spectator sends no positions, so the join
      // is the only word we get until the round they are in starts
      const s = seen.get(m.player.id) || {};
      s.name = m.player.name; s.cast = m.player.cast;
      seen.set(m.player.id, s);
      say('<b>' + esc(m.player.name) + '</b> joined', 'sys');
      return;
    }
    if (m.type === 'leave') { seen.delete(m.id); return; }
    if (m.type === 'cast') {
      const p = seen.get(m.id); if (p) p.cast = m.cast;
      // their kart, redrawn now rather than at the next round
      if (world.restyle) world.restyle(m.id, m.cast);
      return;
    }

    if (m.type === 'pos') {
      got++;
      let p = seen.get(m.id);
      if (!p) { p = {}; seen.set(m.id, p); }
      p.tx = m.x; p.ty = m.y; p.tz = m.z; p.tyaw = m.yaw;
      record(p, m, performance.now());
      p.sp = m.sp; p.lap = m.lap; p.prog = m.prog;
      p.spin = m.spin; p.drift = m.drift; p.boost = m.boost;
      p.rev = +m.rev || 0;
      return;
    }

    if (m.type === 'fire') {
      // show it, but let the thrower's browser decide what it hits
      const k = kartFor(m.id);
      // an oil can lands on everybody's glass but the thrower's, and the
      // thrower is the one browser that does not get this message
      if (m.kind === 'oil') { world.oil(); return; }
      if (k) {
        if (m.kind === 'turbo' || m.kind === 'star') k.boost = Math.max(k.boost, 0.8);
        else world.items().spawn(m.kind, k, world.karts, true);
      }
      return;
    }

    if (m.type === 'hurt') {
      const me = world.me;
      if (!me) return;
      // m.by is whoever threw it, so the notice can name them
      const who = world.nameOf(m.by);
      if (m.kind === 'surge') { me.slow = 3; me.speed *= 0.6; world.notice(who ? 'Surged by ' + who + '!' : 'Surged!'); }
      else if (world.spinOut(me, m.kind === 'bomb')) world.notice(world.hitBy(m.by, m.kind));
      return;
    }

    if (m.type === 'home') {
      const k = kartFor(m.id);
      if (k) { k.finished = 1; k.time = m.time; k.place = m.place; }
      if (m.id !== myId) {
        const nm = k ? k.name : 'Somebody';
        say('<b>' + esc(nm) + '</b> finished ' + m.place, 'sys');
      }
      return;
    }

    if (m.type === 'results') {
      for (const r of m.rows) {
        const k = kartFor(r.id);
        if (k) { k.finished = 1; k.time = r.time === null ? world.raceTime : r.time; k.place = r.place; }
      }
      if (m.cup) world.setCup(m.cup, myId);
      return;
    }

    // somebody knocked a cone: run the same shove here and the settling maths
    // takes it to the same place without anybody streaming its position
    if (m.type === 'cone') { world.shoveCone(m.i | 0, +m.vx || 0, +m.vz || 0); return; }

    if (m.type === 'votes') { world.setVotes(m.votes); return; }

    if (m.type === 'started') {
      say('<b>' + esc(m.name) + '</b> called the race on.', 'sys');
      return;
    }

    if (m.type === 'chat') {
      say('<b>' + esc(m.name) + '</b> ' + esc(m.text), m.id === myId ? 'me' : '');
      return;
    }
  };

  function send(o) { if (alive) { try { ws.send(JSON.stringify(o)); } catch (e) {} } }
  function kartFor(id) { return world.karts.find(k => k.id === id) || null; }

  function applyState(m) {
    // a new round: rebuild the grid from whoever the server says is in it
    if (typeof m.round === 'number' && m.round !== lastRound && m.racers && m.racers.length) {
      lastRound = m.round;
      lastPhase = '';
      for (const [, p] of seen) { p.tx = undefined; clear(p); }
      world.startRound(m.racers.map(r => ({ id: r.id, name: r.name, cast: r.cast })), m.seed, m.phase, m.theme);
    }
    if (m.phase !== lastPhase) {
      lastPhase = m.phase;
      world.setPhase(m.phase, m.t);
      if (m.phase === 'race' && typeof m.raceT === 'number') world.setRaceTime(m.raceT);
    } else if (m.phase === 'count') {
      world.setPhase('count', m.t);
    } else if (m.phase === 'race' && typeof m.raceT === 'number') {
      // nudge the clock back into line without jumping it
      const drift = m.raceT - world.raceTime;
      if (Math.abs(drift) > 1.2) world.setRaceTime(m.raceT);
    }
    // anybody the server lists who is not racing this round is watching it
    const meRow = (m.players || []).find(p => p.id === myId);
    if (meRow) world.setSpectating(!meRow.racing);
    if (m.votes) world.setVotes(m.votes, meRow ? (meRow.vote || null) : undefined);
    for (const p of (m.players || [])) {
      if (p.id === myId) continue;
      const s = seen.get(p.id) || {};
      s.name = p.name; s.cast = p.cast;
      seen.set(p.id, s);
    }
  }

  return {
    go() { send({ type: 'go' }); },
    close() { quitting = true; alive = false; try { ws.close(); } catch (e) {} },
    get alive() { return alive; },
    get settled() { return settled; },
    get traffic() { return { sent, got }; },
    get id() { return myId; },
    get name() { return myName; },
    get others() { return seen; },
    chat(text) { send({ type: 'chat', text }); },
    setCast(i) { send({ type: 'cast', i }); },
    fire(kind) { send({ type: 'fire', kind }); },
    cone(i, vx, vz) { send({ type: 'cone', i, vx: +vx.toFixed(2), vz: +vz.toFixed(2) }); },
    vote(id) { send({ type: 'vote', id }); },
    hitThem(id, kind) { send({ type: 'hit', id, kind }); },
    finish(t, place) { send({ type: 'fin', t, place }); },

    tick(dt) {
      if (!alive) return;
      const me = world.me;
      const now = performance.now();
      if (me && now - sendAt > 70) {
        sendAt = now;
        sent++;
        send({
          type: 'pos',
          x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2),
          yaw: +me.yaw.toFixed(3), sp: +me.speed.toFixed(2),
          lap: me.lap, prog: +me.prog.toFixed(1),
          spin: me.spin > 0, drift: me.drift !== 0, boost: me.boost > 0,
          rev: +me.rev.toFixed(2),
        });
      }
      // ease every remote kart towards the last word from its owner
      for (const k of world.karts) {
        if (!k.remote) continue;
        const p = seen.get(k.id);
        if (!p || p.tx === undefined) continue;
        // a little in the past, between places it really was (smooth.js)
        if (pose(p, now, drawn)) { k.pos.set(drawn.x, drawn.y, drawn.z); k.yaw = drawn.yaw; }
        k.speed = p.sp || 0;
        k.lap = p.lap || 1;
        k.prog = p.prog || 0;
        k.wheelSpin += k.speed * dt / 0.38;
        k.slide += ((p.drift ? -0.3 : 0) - k.slide) * (1 - Math.exp(-6 * dt));
        k.lean += ((p.drift ? 0.12 : 0) - k.lean) * (1 - Math.exp(-6 * dt));
        if (p.boost) k.boost = Math.max(k.boost, 0.2);
        if (p.spin) k.spin = Math.max(k.spin, 0.2);
        k.rev = p.rev || 0;              // so their grid shake is on your screen too
      }
    },
  };
}
