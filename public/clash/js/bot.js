/* Leon Clash: the computer opponent. It plays through the same commands a
   person does (the sim checks every play), reads the board, counters what is
   coming, saves cocoa for pushes and punishes the other lane. Three levels.
   Its own random numbers, so it never touches the match's. */

function prng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// what a card is good for, worked out from its numbers
export function cardTags(sim, id) {
  const c = sim.CARD[id];
  const t = { id, cost: c.cost, type: c.type, swarm: 0, tank: 0, splash: 0, air: 0, antiair: 0, hunter: 0, building: 0, spawner: 0, spell: 0, dmgSpell: 0, hp: 0, dps: 0 };
  if (c.type === "spell") {
    t.spell = 1;
    const s = c.spell;
    if (s.kind === "damage" || s.kind === "roll") { t.dmgSpell = s.dmg || s.dmg1 || 0; t.splash = 1; t.antiair = s.kind === "damage" ? 1 : 0; }
    if (s.kind === "spawn") { t.swarm = 1; }
    return t;
  }
  const u = sim.UNIT[c.unit];
  const n = c.count || 1;
  t.hp = (u.hp + (u.shield || 0)) * n;
  t.dps = u.dmg ? Math.round(u.dmg * 20 / u.hit) * n : 0;
  t.swarm = n >= 3 && u.hp <= 320 ? 1 : 0;
  t.tank = t.hp >= 1800 ? 1 : 0;
  t.splash = u.splash ? 1 : 0;
  t.air = u.air ? 1 : 0;
  t.antiair = u.targets === "both" ? 1 : 0;
  t.hunter = u.targets === "buildings" ? 1 : 0;
  t.building = c.type === "building" ? 1 : 0;
  t.spawner = u.spawn ? 1 : 0;
  if (u.trap) t.trap = 1;
  if (u.aura || u.heal || u.pulse) t.support = 1;
  return t;
}

export function makeBot(sim, side, level, seed) {
  const R = sim.R;
  const rnd = prng(seed || 12345);
  const lvl = level === "hard" ? 3 : level === "medium" ? 2 : 1;
  const every = lvl === 3 ? 4 : lvl === 2 ? 8 : 18;
  const tags = {};
  for (const c of sim.DB.CARDS) tags[c.id] = cardTags(sim, c.id);
  const fy = function (y) { return side === 0 ? y : R.H - y; };   // own-side y for a bottom-side number
  const laneX = [4000, 14000];
  let pushLane = rnd() < 0.5 ? 0 : 1;
  let lastAct = -999;
  let foeSpent = 0;
  let waitFor = 0;

  function mine(st) { return st.sides[side]; }
  function foeSide() { return 1 - side; }
  // how far an enemy has come toward us: 0 at their lodge, 32000 at ours
  function depth(e) { return side === 0 ? e.y : R.H - e.y; }

  function threats(st) {
    const lanes = [mk(), mk()];
    function mk() { return { hp: 0, n: 0, air: 0, swarm: 0, tank: 0, hunter: 0, x: 0, y: 0, ents: [] }; }
    for (const e of st.ents) {
      if (e.s === side || e.k === 2) continue;
      if (e.k === 1) continue;
      const dp = depth(e);
      if (dp < 13000) continue;              // still deep on their side
      const L = lanes[e.x < R.W / 2 ? 0 : 1];
      L.hp += e.hp + e.sh; L.n++; L.x += e.x; L.y += e.y; L.ents.push(e);
      const u = sim.UNIT[e.u];
      if (e.air) L.air += e.hp;
      if (u.hp <= 320) L.swarm++;
      if (e.hp + e.sh >= 1500) L.tank += e.hp;
      if (u.targets === "buildings") L.hunter += e.hp;
    }
    for (const L of lanes) if (L.n) { L.x = Math.round(L.x / L.n); L.y = Math.round(L.y / L.n); }
    return lanes;
  }
  function clusterAt(st, r) {
    // best spot for an area spell: most enemy value within r
    let best = null, bv = 0;
    for (const e of st.ents) {
      if (e.s === side || e.k === 2) continue;
      let v = 0, n = 0;
      for (const o of st.ents) {
        if (o.s === side || o.k === 2) continue;
        const dx = o.x - e.x, dy = o.y - e.y;
        if (dx * dx + dy * dy <= r * r) { v += Math.min(o.hp + o.sh, 600); n++; }
      }
      if (n >= 2 && v > bv) { bv = v; best = { x: e.x, y: e.y, v, n }; }
    }
    return best;
  }
  function can(st, id, x, y) { return !sim.canPlay(st, side, id, x, y); }
  function play(st, id, x, y) {
    if (!can(st, id, x, y)) {
      // nudge toward our own side until it fits
      for (let k = 1; k <= 6; k++) {
        const ny = y + (side === 0 ? 1 : -1) * k * 500;
        if (can(st, id, x, ny)) { y = ny; break; }
        if (k === 6) return null;
      }
    }
    lastAct = st.tick;
    return { s: side, k: "play", card: id, x: Math.round(x), y: Math.round(y) };
  }
  function hand(st) { return mine(st).hand.filter(id => mine(st).cocoa >= sim.CARD[id].cost * 1000); }

  function defend(st, lane, L) {
    const avail = hand(st);
    if (!avail.length) return null;
    const S = mine(st);
    const towerY = fy(25500);
    const front = fy(22000);
    let best = null, bs = -1e9;
    for (const id of avail) {
      const t = tags[id];
      let s = 0;
      if (t.spell) {
        if (!t.dmgSpell) continue;
        const cl = clusterAt(st, sim.CARD[id].spell.r || 2000);
        if (!cl || cl.v < t.cost * 140) continue;
        s = cl.v / t.cost / 60 + (L.swarm >= 3 ? 4 : 0);
        if (s > bs) { bs = s; best = { id, x: cl.x, y: cl.y }; }
        continue;
      }
      if (L.air > 0 && !t.antiair) s -= 6;
      if (L.air > 0 && t.antiair) s += 4;
      if (L.swarm >= 3 && t.splash) s += 5;
      if (L.swarm >= 3 && t.swarm) s -= 3;
      if ((L.tank || L.hunter) && (t.building || t.swarm)) s += 4;
      if (L.tank && t.dps >= 150) s += 3;
      if (t.trap && L.n) s += 2;
      s += Math.min(5, t.dps / 60) - t.cost * (lvl === 3 ? 0.9 : 0.6);
      if (t.tank && L.hp < 1200) s -= 3;
      if (s > bs) {
        bs = s;
        let x = L.x, y = front;
        if (t.building) { x = R.W / 2 + (lane === 0 ? -1500 : 1500); y = fy(21500); }
        else if (t.air || t.antiair) { x = laneX[lane]; y = towerY - (side === 0 ? 1500 : -1500); }
        else { x = Math.max(1000, Math.min(R.W - 1000, L.x)); y = side === 0 ? Math.max(18000, Math.min(L.y + 2500, 24000)) : Math.min(14000, Math.max(L.y - 2500, 8000)); }
        best = { id, x, y };
      }
    }
    if (!best) return null;
    if (lvl === 1 && rnd() < 0.4) return null;
    return play(st, best.id, best.x, best.y);
  }

  function attack(st) {
    const avail = hand(st);
    const S = mine(st);
    if (!avail.length) return null;
    const lane = pushLane;
    // a tank or hunter first, from the back or at the bridge
    const lead = avail.filter(id => tags[id].tank || tags[id].hunter).sort((a, b) => tags[b].hp - tags[a].hp)[0];
    if (lead) {
      const t = tags[lead];
      const y = t.hunter && !t.tank ? fy(18500) : fy(29500);
      return play(st, lead, laneX[lane], y);
    }
    // support behind our own troops already walking that lane
    let mineAhead = null;
    for (const e of st.ents) {
      if (e.s !== side || e.k !== 0) continue;
      if ((e.x < R.W / 2 ? 0 : 1) !== lane) continue;
      if (!mineAhead || depth(e) < depth(mineAhead)) mineAhead = e;
    }
    const sup = avail.filter(id => !tags[id].spell && !tags[id].building).sort((a, b) => tags[b].dps - tags[a].dps)[0];
    if (sup) {
      const y = mineAhead ? Math.max(Math.min(mineAhead.y + (side === 0 ? 1500 : -1500), side === 0 ? 31000 : 14000), side === 0 ? 17500 : 1000) : fy(19000);
      return play(st, sup, mineAhead ? mineAhead.x : laneX[lane], y);
    }
    return null;
  }

  // the spells that are not plain damage: freeze, slow, push, heal, haste, bridges
  function utility(st, lanes) {
    const S = mine(st);
    for (const id of hand(st)) {
      const c = sim.CARD[id], sp = c.spell;
      if (!sp || tags[id].dmgSpell) continue;
      if (sp.kind === "freeze" || (sp.kind === "zone" && sp.slowP) || sp.kind === "push") {
        // on a pile of enemies close to our towers
        for (const L of lanes) {
          if (L.hp < (sp.kind === "push" ? 700 : 1100)) continue;
          const deep = L.ents.filter(e => depth(e) > 19000);
          if (!deep.length) continue;
          let x = 0, y = 0;
          for (const e of deep) { x += e.x; y += e.y; }
          return play(st, id, x / deep.length, y / deep.length);
        }
      } else if (sp.kind === "zone" && (sp.heal || sp.hasteP)) {
        // on our own troops that are fighting deep in their half
        let n = 0, x = 0, y = 0;
        for (const e of st.ents) {
          if (e.s !== side || e.k !== 0) continue;
          if (depth(e) > 14000) continue;
          if (sp.heal && e.hp > e.mhp * 0.75) continue;
          n++; x += e.x; y += e.y;
        }
        if (n >= 2) return play(st, id, x / n, y / n);
      } else if (sp.kind === "bridge") {
        // our ground troops waiting on our bank: open a crossing in front of them
        let n = 0, x = 0;
        for (const e of st.ents) {
          if (e.s !== side || e.k !== 0 || e.air) continue;
          const dp = depth(e);
          if (dp > 17500 && dp < 21000) { n++; x += e.x; }
        }
        if (n >= 2) return play(st, id, Math.round(x / n / 500) * 500, R.H / 2);
      } else if (sp.kind === "spawn" && S.cocoa >= 8000) {
        // drop troops on a hut that is low
        for (const e of st.ents) if (e.s !== side && e.k === 2 && e.lane >= 0 && e.hp < 1500) return play(st, id, e.x, e.y + (side === 0 ? 1500 : -1500));
      }
    }
    return null;
  }

  function finishTower(st) {
    for (const id of hand(st)) {
      const t = tags[id];
      if (!t.dmgSpell) continue;
      const sp = sim.CARD[id].spell;
      const tp = sp.towerPct || 100;
      const dmg = Math.floor((sp.dmg || sp.dmg1 || 0) * tp / 100);
      for (const e of st.ents) {
        if (e.s === side || e.k !== 2) continue;
        if (e.hp <= dmg) return play(st, id, e.x, e.y);
      }
    }
    return null;
  }

  function useAbility(st) {
    const S = mine(st);
    if (!S.leg || st.tick < S.abilAt) return null;
    const e = sim.byId(st, S.leg);
    if (!e || e.dep > 0) return null;
    let near = 0;
    for (const o of st.ents) {
      if (o.s === side || o.k === 2) continue;
      const dx = o.x - e.x, dy = o.y - e.y;
      if (dx * dx + dy * dy < 4500 * 4500) near++;
    }
    const a = sim.UNIT[e.u].ability;
    if (a.kind === "rally") {
      let friends = 0;
      for (const o of st.ents) if (o.s === side && o.k === 0) { const dx = o.x - e.x, dy = o.y - e.y; if (dx * dx + dy * dy < a.r * a.r) friends++; }
      if (friends >= 3 || near >= 2) return { s: side, k: "ab" };
      return null;
    }
    if (near >= (a.kind === "flare" ? 1 : 2) || (a.kind === "leap" && near >= 1)) return { s: side, k: "ab" };
    return null;
  }

  function think(st) {
    if (st.phase === 2) return null;
    if ((st.tick + side * 3) % every) return null;
    const S = mine(st);
    if (lvl >= 2) { const a = useAbility(st); if (a) return a; }
    // easy: just plays what it can now and then
    if (lvl === 1) {
      if (rnd() < 0.55) return null;
      const lanes = threats(st);
      for (let l = 0; l < 2; l++) if (lanes[l].n && lanes[l].hp > 400 && rnd() < 0.5) { const d = defend(st, l, lanes[l]); if (d) return d; }
      if (S.cocoa < 6000 + rnd() * 4000) return null;
      const avail = hand(st);
      if (!avail.length) return null;
      const id = avail[Math.floor(rnd() * avail.length)];
      const c = sim.CARD[id];
      if (c.type === "spell") {
        const cl = clusterAt(st, c.spell.r || 2000);
        if (cl) return play(st, id, cl.x, cl.y);
        return null;
      }
      return play(st, id, laneX[rnd() < 0.5 ? 0 : 1], fy(20000 + rnd() * 8000));
    }
    const lanes = threats(st);
    // defend the lane in more danger first
    const order = lanes[0].hp >= lanes[1].hp ? [0, 1] : [1, 0];
    for (const l of order) {
      const L = lanes[l];
      if (!L.n) continue;
      const urgent = L.ents.some(e => depth(e) > 20000) || L.hp > 900;
      if (urgent || lvl === 3) {
        const d = defend(st, l, L);
        if (d) { if (lvl === 3 && L.hp > 600) pushLane = 1 - l; return d; }
      }
    }
    const f = finishTower(st);
    if (f) return f;
    if (lvl >= 2) { const u = utility(st, lanes); if (u) return u; }
    // spells on a juicy pile
    if (lvl === 3) {
      for (const id of hand(st)) {
        const t = tags[id];
        if (!t.dmgSpell) continue;
        const cl = clusterAt(st, sim.CARD[id].spell.r || 2000);
        if (cl && cl.v >= t.cost * 260 && cl.n >= 3) return play(st, id, cl.x, cl.y);
      }
    }
    // push when full, or when the other side just spent a lot
    const full = S.cocoa >= (lvl === 3 ? 7500 : 9000);
    const punish = lvl === 3 && st.sides[foeSide()].cocoa < 2500 && S.cocoa >= 5000;
    if (full || punish) {
      if (punish) {
        // hit the lane they are not defending
        const foeL = [0, 0];
        for (const e of st.ents) if (e.s !== side && e.k === 0) foeL[e.x < R.W / 2 ? 0 : 1] += e.hp;
        pushLane = foeL[0] <= foeL[1] ? 0 : 1;
      }
      const a = attack(st);
      if (a) return a;
      // nothing to push with: cycle the cheapest card at the back
      const cheap = hand(st).filter(id => !tags[id].spell).sort((a, b) => tags[a].cost - tags[b].cost)[0];
      if (cheap && S.cocoa >= 9800) return play(st, cheap, laneX[pushLane], fy(30000));
    }
    return null;
  }
  return { think, side, level: lvl };
}
