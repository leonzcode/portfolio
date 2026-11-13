/* Leon Clash: the match simulation. No DOM, no Math.random, no clock.
   Plain data in, plain data out, a fixed tick of 20 a second. Only integer
   maths plus Math.sqrt (correctly rounded everywhere), so the browser and Node
   get the same answer from the same seed and the same commands.
   Loaded as an ES module (an import sets globalThis.LeonClashSim) or by require.
   mlhub keeps a byte-identical copy as apps/mc/leonclash_sim.js.

   Use: const sim = LeonClashSim.make(cardsDb);
        const st = sim.create({ seed, decks: [[8 ids], [8 ids]] });
        sim.step(st, commandsForThisTick);   // st.tick goes up by one
   A command is { s: side, k: "play", card, x, y } or { s, k: "ab" } (legend
   ability) or { s, k: "quit" } (surrender). */
(function (root) {
  "use strict";

  const VERSION = 1;
  const DEF = {
    hp: 100, dmg: 0, hit: 20, first: -1, range: 800, sight: 5500, speed: 60, r: 400, mass: 3, air: 0,
    targets: "ground", splash: 0, proj: 0, lob: 0, minRange: 0, shield: 0, deploy: 20, life: 0,
    building: 0, tower: 0, leap: 0, firstMult: 0, firstStun: 0, knockOnHit: 0,
  };
  // where a group lands round the point it was played on
  const FORM = [
    [[0, 0]],
    [[0, 0]],
    [[-450, 0], [450, 0]],
    [[0, -450], [-450, 350], [450, 350]],
    [[-450, -450], [450, -450], [-450, 450], [450, 450]],
    [[0, 0], [-600, -400], [600, -400], [-600, 400], [600, 400]],
    [[-600, -400], [0, -400], [600, -400], [-600, 400], [0, 400], [600, 400]],
    [[0, 0], [-650, -350], [0, -700], [650, -350], [-650, 350], [0, 700], [650, 350]],
    [[-700, -700], [0, -700], [700, -700], [-700, 0], [700, 0], [-700, 700], [0, 700], [700, 700]],
  ];

  function isqrt(n) {
    if (n <= 0) return 0;
    let r = Math.floor(Math.sqrt(n));
    while (r * r > n) r--;
    while ((r + 1) * (r + 1) <= n) r++;
    return r;
  }
  const tr = Math.trunc;
  function d2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // small seeded generator (mulberry32), its whole state is one int in st.rng
  function rnd(st) {
    let t = (st.rng = (st.rng + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  function make(DB) {
    const R = DB.RULES;
    const CARD = {}, CIX = {};
    DB.CARDS.forEach(function (c, i) { CARD[c.id] = c; CIX[c.id] = i + 1; });
    const UNIT = {}, UIX = {};
    let un = 1;
    function addUnit(id, def) { UNIT[id] = Object.assign({ id: id }, DEF, def); UIX[id] = un++; }
    Object.keys(DB.UNITS).forEach(function (k) { addUnit(k, DB.UNITS[k]); });
    Object.keys(R.towers).forEach(function (k) { addUnit(k, Object.assign({ tower: 1, deploy: 0 }, R.towers[k])); });
    DB.CARDS.forEach(function (c) {
      if (c.unit && c.summit && c.summit.unit) addUnit(c.unit + "*", Object.assign({}, DB.UNITS[c.unit], c.summit.unit, { base: c.unit }));
    });
    const H = R.H, W = R.W;

    function ev(st, o) { if (st.ev.length < 300) st.ev.push(o); }
    function byId(st, id) {
      // ents stay sorted by id: binary search
      const a = st.ents;
      let lo = 0, hi = a.length - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1, v = a[m].id;
        if (v === id) return a[m];
        if (v < id) lo = m + 1; else hi = m - 1;
      }
      return null;
    }

    /* ---------------- the field ---------------- */
    function region(y) { return y >= R.streamBot ? 0 : y <= R.streamTop ? 1 : 2; }   // 0 south, 1 north, 2 stream
    function crossings(st) {
      const out = [];
      for (let i = 0; i < R.bridges.length; i++) out.push([R.bridges[i], R.bridgeHalf]);
      for (const z of st.zones) if (z.k === "bridge") out.push([z.x, z.half]);
      return out;
    }
    function fixWater(st, e) {
      const d = UNIT[e.u];
      if (e.air || e.k !== 0 || d.leap || e.lp) return;
      if (e.y <= R.streamTop || e.y >= R.streamBot) return;
      const cs = crossings(st);
      let near = null, nd = 1e9;
      for (const c of cs) {
        const off = Math.abs(e.x - c[0]);
        if (off <= c[1]) return;
        const out = off - c[1];
        if (out < nd) { nd = out; near = c; }
      }
      if (near && nd < 700) { e.x = e.x < near[0] ? near[0] - near[1] : near[0] + near[1]; return; }
      e.y = (e.y - R.streamTop < R.streamBot - e.y) ? R.streamTop : R.streamBot;
    }
    function clampField(e) { e.x = clamp(e.x, e.r, W - e.r); e.y = clamp(e.y, e.r, H - e.r); }

    function waypoint(st, e, d, tx, ty) {
      if (e.air || d.leap) return [tx, ty];
      const ru = region(e.y), rt = region(ty);
      if (ru === rt && ru !== 2) return [tx, ty];
      const north = rt === 2 ? ty < e.y : rt === 1;
      const exitY = north ? R.streamTop - 500 : R.streamBot + 500;
      const nearY = north ? R.streamBot + 500 : R.streamTop - 500;
      const cs = crossings(st);
      let best = cs[0], bc = 1e12;
      for (const c of cs) {
        if (ru === 2) {
          const off = Math.abs(e.x - c[0]);
          if (off < bc) { bc = off; best = c; }
        } else {
          const cost = Math.abs(e.x - c[0]) + Math.abs(tx - c[0]);
          if (cost < bc) { bc = cost; best = c; }
        }
      }
      const bx = best[0];
      if (ru === 2) return [clamp(e.x, bx - best[1] + 300, bx + best[1] - 300), exitY];
      if (rt === 2 && Math.abs(tx - bx) <= best[1]) return [tx, ty];
      if (Math.abs(e.x - bx) <= best[1] - 300 && Math.abs(e.y - nearY) <= 900) return [bx, exitY];
      return [bx, nearY];
    }

    /* zones a side may deploy troops and buildings in, as rects [x0, y0, x1, y1] */
    function zoneRects(st, side) {
      const S = st.sides[side];
      const out = [];
      const mir = function (r) { return side === 0 ? r : [r[0], H - r[3], r[2], H - r[1]]; };
      out.push(mir([500, R.streamBot + 500, W - 500, H - 500]));
      const y0 = R.streamTop - R.pocketDepth, y1 = R.streamTop - 500;
      if (S.pocket[0]) out.push(mir([500, y0, W / 2 - 500, y1]));
      if (S.pocket[1]) out.push(mir([W / 2 + 500, y0, W - 500, y1]));
      return out;
    }
    function inRects(rs, x, y) {
      for (const r of rs) if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return true;
      return false;
    }
    function snap(card, x, y) {
      x = tr(+x || 0); y = tr(+y || 0);
      if (card.type === "spell") return [clamp(Math.round(x / 100) * 100, 0, W), clamp(Math.round(y / 100) * 100, 0, H)];
      return [clamp(Math.round(x / 500) * 500, 0, W), clamp(Math.round(y / 500) * 500, 0, H)];
    }
    function placeOk(st, side, card, x, y) {
      if (card.type === "spell") {
        if (x < 0 || x > W || y < 0 || y > H) return false;
        if (card.spell.kind === "bridge") return y >= R.streamTop - 1000 && y <= R.streamBot + 1000 && x >= 1000 && x <= W - 1000;
        return true;
      }
      const rs = zoneRects(st, side);
      if (!inRects(rs, x, y)) return false;
      const u = UNIT[card.unit];
      if (card.type === "building") {
        const r = u.r - 200;
        if (!inRects(rs, x - r, y) || !inRects(rs, x + r, y) || !inRects(rs, x, y - r) || !inRects(rs, x, y + r)) return false;
        for (const e of st.ents) if (e.k >= 1) { const rr = e.r + u.r; if (d2(e, { x: x, y: y }) < rr * rr) return false; }
        return true;
      }
      for (const e of st.ents) if (e.k >= 1) { if (d2(e, { x: x, y: y }) < e.r * e.r) return false; }
      return true;
    }

    /* ---------------- making things ---------------- */
    function spawn(st, side, uid, x, y, cardId) {
      const d = UNIT[uid];
      const e = {
        id: st.nid++, s: side, u: uid, c: cardId || "", k: d.tower ? 2 : d.building ? 1 : 0,
        x: x, y: y, hp: d.hp, mhp: d.hp, sh: d.shield, msh: d.shield, r: d.r, air: d.air ? 1 : 0,
        tg: 0, lk: 0, ir: 0, cd: 0, fh: 0, dep: d.deploy, life: d.life,
        stT: 0, frT: 0, slT: 0, slP: 0, haT: 0, haP: 0, au: 0, as: 0,
        run: 0, chg: 0, sp: d.spawn ? d.spawn.every : 0, pl: d.pulse ? d.pulse.every : 0,
        hl: d.heal ? d.heal.every : 0, hk: 0, lp: null, face: side === 0 ? 3 : 0, lane: -1,
        dead: 0, hit: -99, atk: -99, nd: 0,
      };
      if (e.k <= 1) clampField(e);
      st.ents.push(e);
      if (e.k <= 1) st.sides[side].n++;
      return e;
    }
    function spawnGroup(st, side, uid, x, y, count, cardId) {
      const S = st.sides[side];
      const f = FORM[Math.min(count, 8)] || FORM[1];
      const flip = side === 1 ? -1 : 1;
      const made = [];
      for (let i = 0; i < count; i++) {
        if (S.n >= R.maxUnits) break;
        const o = f[i % f.length];
        const ring = i >= f.length ? 300 : 0;
        const e = spawn(st, side, uid, x + o[0] + ring, y + o[1] * flip, cardId);
        fixWater(st, e);
        made.push(e);
      }
      return made;
    }

    /* ---------------- damage and effects ---------------- */
    function hurt(st, t, dmg, by) {
      if (t.dead || dmg <= 0) return;
      if (t.sh > 0) { const a = Math.min(t.sh, dmg); t.sh -= a; dmg -= a; }
      t.hp -= dmg;
      t.hit = st.tick;
      if (t.hp <= 0) { t.hp = 0; t.dead = 1; t.kb = by; }
    }
    function heal(t, amt) { if (!t.dead && amt > 0) t.hp = Math.min(t.mhp, t.hp + amt); }
    function stun(st, t, ticks, freeze) {
      if (t.dead || ticks <= 0) return;
      const until = st.tick + ticks;
      if (until > t.stT) t.stT = until;
      if (freeze && until > t.frT) t.frT = until;
      t.chg = 0; t.run = 0; t.ir = 0;
    }
    function slow(st, t, p, ticks) {
      if (t.dead) return;
      if (t.slT <= st.tick || p >= t.slP) { t.slP = p; t.slT = Math.max(t.slT, st.tick + ticks); }
    }
    function knock(st, t, fx, fy, dist) {
      if (t.k !== 0 || t.dead || t.lp || dist <= 0) return;
      const k = tr(dist * 4 / (UNIT[t.u].mass + 3));
      let dx = t.x - fx, dy = t.y - fy, dd = isqrt(dx * dx + dy * dy);
      if (dd === 0) { dx = 0; dy = t.s === 0 ? 1 : -1; dd = 1; }
      t.x += tr(dx * k / dd); t.y += tr(dy * k / dd);
      clampField(t); fixWater(st, t);
      t.lk = 0; t.ir = 0;
    }
    function canHit(d, e, t) {
      if (t.dead || t.s === e.s) return false;
      if (d.targets === "none") return false;
      if (d.targets === "buildings") return t.k >= 1;
      if (t.air && d.targets !== "both") return false;
      return true;
    }
    function reachOk(e, d, t, extra) {
      const dd = d2(e, t);
      const reach = d.range + e.r + t.r + extra;
      if (dd > reach * reach) return false;
      if (d.minRange) { const m = d.minRange + t.r; if (dd < m * m) return false; }
      return true;
    }
    // area effect from side `side` at (x, y): o = { dmg, r, towerPct, knock, stun, air, heal, slowP, slowT, freeze }
    function burst(st, side, x, y, o, by) {
      const r = o.r || 0;
      const tp = o.towerPct == null ? 100 : o.towerPct;
      const air = o.air == null ? 1 : o.air;
      for (const t of st.ents) {
        if (t.dead) continue;
        const rr = r + t.r;
        if (d2(t, { x: x, y: y }) > rr * rr) continue;
        if (t.s === side) {
          if (o.heal && t.k <= (o.healBuildings ? 1 : 0)) heal(t, o.heal);
          continue;
        }
        if (t.air && !air) continue;
        if (o.troopsOnly && t.k !== 0) continue;
        if (o.dmg) hurt(st, t, t.k === 2 ? tr(o.dmg * tp / 100) : o.dmg, by);
        if (o.stun) stun(st, t, o.stun, o.freeze);
        if (o.slowP) slow(st, t, o.slowP, o.slowT);
        if (o.knock) knock(st, t, x, y, o.knock);
      }
      ev(st, { k: "boom", x: x, y: y, r: r, s: side, kind: o.kind || "" });
    }

    /* ---------------- targets ---------------- */
    function laneTower(st, e) {
      const lane = e.x < W / 2 ? 0 : 1;
      let lodge = null, hut = null, near = null, nd = 0;
      for (const t of st.ents) {
        if (t.k !== 2 || t.s === e.s || t.dead) continue;
        if (t.lane === lane) hut = t;
        if (t.lane === -1) lodge = t;
        const dd = d2(e, t);
        if (!near || dd < nd) { near = t; nd = dd; }
      }
      return hut || lodge || near;
    }
    function findTarget(st, e, d) {
      let best = null, bd = 0;
      const anyRange = d.targets === "buildings";
      // a troop sees at least as far as it can shoot
      const lim = e.k === 0 ? Math.max(d.sight, d.range + e.r + 500) : d.range + e.r;
      for (const t of st.ents) {
        if (!canHit(d, e, t)) continue;
        const dd = d2(e, t);
        if (!anyRange) {
          const lr = lim + t.r;
          if (dd > lr * lr) continue;
        }
        if (d.minRange) { const m = d.minRange + t.r; if (dd < m * m) continue; }
        if (!best || dd < bd) { best = t; bd = dd; }
      }
      if (!best && e.k === 0 && d.targets !== "none") best = laneTower(st, e);
      return best;
    }
    function face(e, dx, dy) {
      if (dx === 0 && dy === 0) return;
      if (Math.abs(dx) > Math.abs(dy)) e.face = dx < 0 ? 1 : 2; else e.face = dy < 0 ? 3 : 0;
    }
    function rateMod(st, e) {
      const ha = Math.max(e.au, e.haT > st.tick ? e.haP : 0);
      const sl = Math.max(e.as, e.slT > st.tick ? e.slP : 0);
      return clamp(100 + ha - sl, 20, 250);
    }
    function moveTo(st, e, d, wx, wy, sp) {
      const dx = wx - e.x, dy = wy - e.y;
      const dd = isqrt(dx * dx + dy * dy);
      if (dd === 0) return 0;
      const step = Math.min(sp, dd);
      e.x += tr(dx * step / dd); e.y += tr(dy * step / dd);
      face(e, dx, dy);
      return step;
    }

    /* ---------------- attacks ---------------- */
    function fire(st, e, d, t) {
      let dmg = d.dmg;
      const fx = { slP: 0, slT: 0, stn: 0, kn: d.knockOnHit || 0 };
      if (d.slowOnHit) { fx.slP = d.slowOnHit.p; fx.slT = d.slowOnHit.t; }
      if (!e.fh) {
        e.fh = 1;
        if (d.firstMult) dmg = tr(dmg * d.firstMult / 100);
        if (d.firstStun) fx.stn = d.firstStun;
      }
      if (e.chg && d.charge) {
        dmg = tr(dmg * d.charge.mult / 100);
        if (d.charge.knock) fx.kn = Math.max(fx.kn, d.charge.knock);
        if (d.charge.stun) fx.stn = Math.max(fx.stn, d.charge.stun);
        e.chg = 0; e.run = 0;
        ev(st, { k: "charge", id: e.id });
      }
      e.atk = st.tick;
      face(e, t.x - e.x, t.y - e.y);
      ev(st, { k: "atk", id: e.id, t: t.id, u: e.u });
      if (d.proj) {
        st.projs.push({ id: st.nid++, s: e.s, k: d.lob ? "lob" : "shot", u: e.u, tg: t.id, x: e.x, y: e.y, tx: t.x, ty: t.y,
          sx: e.x, sy: e.y, sp: d.proj, dmg: dmg, spl: d.splash, tgt: d.targets, fx: fx, by: e.id });
        return;
      }
      land(st, e.s, d.targets, t, t.x, t.y, dmg, d.splash, fx, e.id, e.x, e.y);
    }
    function applyFx(st, t, fx, ox, oy) {
      if (t.dead) return;
      if (fx.slP) slow(st, t, fx.slP, fx.slT);
      if (fx.stn) stun(st, t, fx.stn, false);
      if (fx.kn) knock(st, t, ox, oy, fx.kn);
    }
    function land(st, side, tgt, t, x, y, dmg, spl, fx, by, ox, oy) {
      if (spl > 0) {
        const fake = { s: side, x: x, y: y };
        const dd = { targets: tgt === "buildings" ? "buildings" : tgt };
        for (const v of st.ents) {
          if (v.dead || v.s === side) continue;
          if (!canHit(dd, fake, v)) continue;
          const rr = spl + v.r;
          if (d2(v, fake) > rr * rr) continue;
          hurt(st, v, dmg, by);
          applyFx(st, v, fx, ox, oy);
        }
        ev(st, { k: "splash", x: x, y: y, r: spl, s: side });
        return;
      }
      if (!t || t.dead) return;
      hurt(st, t, dmg, by);
      applyFx(st, t, fx, ox, oy);
    }

    /* ---------------- one body's tick ---------------- */
    function onDeployed(st, e, d) {
      if (d.onDeploy) {
        const o = d.onDeploy;
        burst(st, e.s, e.x, e.y, { dmg: o.dmg || 0, r: o.r, knock: o.knock || 0, stun: o.stun || 0, heal: o.heal || 0, air: 0, towerPct: 100, kind: "land" }, e.id);
      }
      if (d.ability) {
        const S = st.sides[e.s];
        S.leg = e.id;
        S.abilAt = st.tick + (d.ability.cd >> 1);
      }
      ev(st, { k: "ready", id: e.id });
    }
    function update(st, e) {
      const d = UNIT[e.u];
      if (e.dead) return;
      if (e.dep > 0) { e.dep--; if (e.dep === 0) onDeployed(st, e, d); return; }
      if (e.life > 0) { e.life--; if (e.life === 0) { e.hp = 0; e.dead = 1; e.kb = 0; return; } }
      if (e.lp) {
        const L = e.lp;
        L.n++;
        e.x = L.fx + tr((L.tx - L.fx) * L.n / L.t);
        e.y = L.fy + tr((L.ty - L.fy) * L.n / L.t);
        if (L.n >= L.t) {
          e.lp = null;
          fixWater(st, e);
          const a = d.ability;
          burst(st, e.s, e.x, e.y, { dmg: a.dmg, r: a.r, knock: a.knock, air: 0, kind: "leap" }, e.id);
          e.lk = 0; e.ir = 0; e.tg = 0;
        }
        return;
      }
      if (e.stT > st.tick) return;
      const mod = rateMod(st, e);

      if (d.spawn) {
        e.sp--;
        if (e.sp <= 0) {
          e.sp = d.spawn.every;
          const fwd = (e.s === 0 ? -1 : 1) * (e.k === 1 ? e.r + 400 : -(e.r + 300));
          const n = d.spawn.count;
          for (let i = 0; i < n; i++) {
            if (st.sides[e.s].n >= R.maxUnits) break;
            const c = spawn(st, e.s, d.spawn.unit, e.x + i * 500 - (n - 1) * 250, e.y + fwd, "");
            c.dep = 6;
            fixWater(st, c);
          }
          ev(st, { k: "spawn", id: e.id });
        }
      }
      if (d.pulse) {
        e.pl--;
        if (e.pl <= 0) {
          e.pl = d.pulse.every;
          burst(st, e.s, e.x, e.y, { r: d.pulse.r, stun: d.pulse.stun, troopsOnly: 1, air: 1, kind: "pulse" }, e.id);
        }
      }
      if (d.heal) {
        e.hl--;
        if (e.hl <= 0) {
          e.hl = d.heal.every;
          for (const t of st.ents) {
            if (t.dead || t.s !== e.s || t.k !== 0) continue;
            const rr = d.heal.r + t.r;
            if (d2(t, e) <= rr * rr) heal(t, d.heal.amt);
          }
          ev(st, { k: "healpulse", id: e.id, r: d.heal.r });
        }
      }
      if (d.trap) {
        const P = d.trap;
        for (const t of st.ents) {
          if (t.dead || t.s === e.s || t.k !== 0 || t.air) continue;
          const rr = P.trigger + t.r;
          if (d2(t, e) <= rr * rr) {
            burst(st, e.s, e.x, e.y, { dmg: P.dmg, r: P.r, knock: P.knock, stun: P.stun, freeze: P.stun > 0, air: 0, kind: "trap" }, e.id);
            e.hp = 0; e.dead = 1; e.nd = 1;
            return;
          }
        }
      }
      if (d.hook && e.k === 0 && e.hk <= st.tick) {
        const H2 = d.hook;
        let best = null, bd = 0;
        for (const t of st.ents) {
          if (t.dead || t.s === e.s || t.k !== 0 || t.air || t.lp) continue;
          const dd = d2(t, e);
          const hr = H2.range + t.r, mr = d.range + e.r + t.r + 300;
          if (dd > hr * hr || dd <= mr * mr) continue;
          if (!best || dd < bd) { best = t; bd = dd; }
        }
        if (best) {
          e.hk = st.tick + H2.cd;
          st.projs.push({ id: st.nid++, s: e.s, k: "hook", u: e.u, tg: best.id, x: e.x, y: e.y, tx: best.x, ty: best.y,
            sx: e.x, sy: e.y, sp: H2.speed, dmg: 0, spl: 0, tgt: "ground", fx: { stn: H2.stun || 0 }, by: e.id });
          ev(st, { k: "hook", id: e.id, t: best.id });
        }
      }
      if (d.targets === "none" || !d.dmg) return;

      let t = e.tg ? byId(st, e.tg) : null;
      if (t && !canHit(d, e, t)) t = null;
      if (t && e.lk) {
        // a lock holds until the target is gone or far away
        const far = e.k === 0 ? Math.max(d.sight, d.range + e.r + 500) + 2000 : d.range + e.r + 300;
        const ff = far + t.r;
        if (d2(e, t) > ff * ff || (d.minRange && !reachOk(e, d, t, 0) && e.k !== 0)) t = null;
      }
      if (!t) { e.lk = 0; e.ir = 0; }
      if (!e.lk && (!t || (st.tick + e.id) % 5 === 0)) {
        const n = findTarget(st, e, d);
        if (n !== t) { e.ir = 0; }
        t = n;
      }
      e.tg = t ? t.id : 0;
      if (!t) return;
      if (reachOk(e, d, t, 0)) {
        if (!e.ir) {
          e.ir = 1; e.lk = 1;
          e.cd = (d.first >= 0 ? d.first : (d.hit >> 1)) * 100;
        }
        face(e, t.x - e.x, t.y - e.y);
        e.cd -= mod;
        if (e.cd <= 0) { fire(st, e, d, t); e.cd += d.hit * 100; }
        if (d.charge) e.run = 0;
        return;
      }
      e.ir = 0;
      if (e.k !== 0) { e.lk = 0; return; }
      const wp = waypoint(st, e, d, t.x, t.y);
      let sp = d.speed;
      if (d.charge && e.chg) sp = d.charge.speed;
      sp = tr(sp * mod / 100);
      const moved = moveTo(st, e, d, wp[0], wp[1], sp);
      if (d.charge && !e.chg) {
        e.run += moved;
        if (e.run >= d.charge.dist) { e.chg = 1; ev(st, { k: "chargeon", id: e.id }); }
      }
    }

    /* ---------------- shots in flight ---------------- */
    function stepProjs(st) {
      const keep = [];
      for (const p of st.projs) {
        const t = byId(st, p.tg);
        if (p.k !== "lob" && t && !t.dead) { p.tx = t.x; p.ty = t.y; }
        const dx = p.tx - p.x, dy = p.ty - p.y;
        const dd = isqrt(dx * dx + dy * dy);
        if (dd > p.sp) {
          p.x += tr(dx * p.sp / dd); p.y += tr(dy * p.sp / dd);
          keep.push(p);
          continue;
        }
        p.x = p.tx; p.y = p.ty;
        if (p.k === "hook") {
          const f = byId(st, p.by);
          if (t && !t.dead && f && !f.dead) {
            const heavy = UNIT[t.u].mass >= 7;
            const a = heavy ? f : t, b = heavy ? t : f;
            let vx = a.x - b.x, vy = a.y - b.y, vd = isqrt(vx * vx + vy * vy);
            if (vd === 0) { vx = 0; vy = 1; vd = 1; }
            const gap = a.r + b.r + 100;
            a.x = b.x + tr(vx * gap / vd); a.y = b.y + tr(vy * gap / vd);
            clampField(a); fixWater(st, a);
            a.lk = 0; a.ir = 0;
            if (p.fx.stn) stun(st, t, p.fx.stn, false);
            ev(st, { k: "pull", id: t.id, by: f.id });
          }
          continue;
        }
        land(st, p.s, p.tgt, t, p.tx, p.ty, p.dmg, p.spl, p.fx, p.by, p.sx, p.sy);
        ev(st, { k: "impact", x: p.tx, y: p.ty, u: p.u });
      }
      st.projs = keep;
    }

    /* ---------------- spells and timed areas ---------------- */
    function stepZones(st) {
      const keep = [];
      for (const z of st.zones) {
        if (z.k === "bridge") { if (st.tick < z.until) keep.push(z); continue; }
        if (z.k === "zone") {
          if (z.dps || z.heal) {
            if ((st.tick - z.t0) % 20 === 19) {
              for (const t of st.ents) {
                if (t.dead) continue;
                const rr = z.r + t.r;
                if (d2(t, z) > rr * rr) continue;
                if (z.heal && t.s === z.s && t.k <= 1) heal(t, z.heal);
                if (z.dps && t.s !== z.s) hurt(st, t, t.k === 2 ? tr(z.dps * z.tp / 100) : z.dps, 0);
              }
            }
          }
          if (st.tick < z.until) keep.push(z);
          continue;
        }
        if (z.k === "roll") {
          const step = z.speed;
          z.y += z.dir * step; z.trav += step;
          const dmg = z.dmg0 + tr((z.dmg1 - z.dmg0) * Math.min(z.trav, z.dist) / z.dist);
          for (const t of st.ents) {
            if (t.dead || t.s === z.s || t.air) continue;
            if (Math.abs(t.x - z.x) > z.half + t.r || Math.abs(t.y - z.y) > 500 + t.r) continue;
            if (z.hit.indexOf(t.id) >= 0) continue;
            z.hit.push(t.id);
            hurt(st, t, t.k === 2 ? tr(dmg * z.tp / 100) : dmg, 0);
            if (t.k === 0) knock(st, t, t.x, t.y - z.dir * 1000, z.knock);
          }
          if (z.trav < z.dist && z.y > 0 && z.y < H) keep.push(z);
          continue;
        }
        if (st.tick < z.at) { keep.push(z); continue; }
        if (z.k === "strike") {
          burst(st, z.s, z.x, z.y, { dmg: z.dmg, r: z.r, towerPct: z.tp, knock: z.kn, stun: z.stn, air: 1, kind: z.kind || "strike" }, 0);
        } else if (z.k === "freeze") {
          burst(st, z.s, z.x, z.y, { dmg: z.dmg, r: z.r, towerPct: z.tp, stun: z.ticks, freeze: 1, air: 1, kind: "freeze" }, 0);
        } else if (z.k === "push") {
          for (const t of st.ents) {
            if (t.dead || t.s === z.s || t.k !== 0) continue;
            const rr = z.r + t.r;
            if (d2(t, z) > rr * rr) continue;
            hurt(st, t, z.dmg, 0);
            if (t.lp) continue;
            const k = tr(z.dist * 4 / (UNIT[t.u].mass + 3));
            t.y += t.s === 0 ? k : -k;
            clampField(t); fixWater(st, t);
            t.lk = 0; t.ir = 0; t.tg = 0;
          }
          ev(st, { k: "boom", x: z.x, y: z.y, r: z.r, s: z.s, kind: "wind" });
        } else if (z.k === "spawn") {
          spawnGroup(st, z.s, z.unit, z.x, z.y, z.count, "");
          ev(st, { k: "boom", x: z.x, y: z.y, r: 1200, s: z.s, kind: "drop" });
        }
      }
      st.zones = keep;
    }
    function auras(st) {
      for (const e of st.ents) { e.au = 0; e.as = 0; }
      for (const a of st.ents) {
        if (a.dead || a.dep > 0 || a.stT > st.tick) continue;
        const au = UNIT[a.u].aura;
        if (!au) continue;
        for (const t of st.ents) {
          if (t.dead || t === a) continue;      // an aura is for the others, not its source
          const rr = au.r + t.r;
          if (d2(a, t) > rr * rr) continue;
          if (au.kind === "haste" && t.s === a.s && t.k === 0) t.au = Math.max(t.au, au.p);
          if (au.kind === "slow" && t.s !== a.s && t.k === 0 && !t.air) t.as = Math.max(t.as, au.p);
        }
      }
      for (const z of st.zones) {
        if (z.k !== "zone" || (!z.slowP && !z.hasteP)) continue;
        for (const t of st.ents) {
          if (t.dead) continue;
          const rr = z.r + t.r;
          if (d2(t, z) > rr * rr) continue;
          if (z.slowP && t.s !== z.s) t.as = Math.max(t.as, z.slowP);
          if (z.hasteP && t.s === z.s && t.k === 0) t.au = Math.max(t.au, z.hasteP);
        }
      }
    }

    /* ---------------- bodies pushing each other ---------------- */
    function collide(st) {
      const a = st.ents, n = a.length;
      for (let i = 0; i < n; i++) {
        const p = a[i];
        if (p.dead || p.lp) continue;
        for (let j = i + 1; j < n; j++) {
          const q = a[j];
          if (q.dead || q.lp) continue;
          if (p.k !== 0 && q.k !== 0) continue;
          if (p.air !== q.air) continue;
          if ((p.k !== 0 || q.k !== 0) && (p.air || q.air)) continue;
          const R2 = p.r + q.r;
          let dx = q.x - p.x;
          if (dx >= R2 || -dx >= R2) continue;
          let dy = q.y - p.y;
          if (dy >= R2 || -dy >= R2) continue;
          const dd2 = dx * dx + dy * dy;
          if (dd2 >= R2 * R2) continue;
          let dd = isqrt(dd2);
          if (dd === 0) { dx = p.id < q.id ? 1 : -1; dy = 0; dd = 1; }
          const over = R2 - dd;
          if (p.k !== 0 || q.k !== 0) {
            // a building or tower does not move: the troop goes round it
            const m = p.k !== 0 ? q : p, s = p.k !== 0 ? 1 : -1;
            m.x += tr(s * dx * over / dd); m.y += tr(s * dy * over / dd);
            continue;
          }
          const mp = UNIT[p.u].mass, mq = UNIT[q.u].mass, tot = mp + mq;
          const pp = tr(over * mq / tot / 2) + 1, pq = tr(over * mp / tot / 2) + 1;
          p.x -= tr(dx * pp / dd); p.y -= tr(dy * pp / dd);
          q.x += tr(dx * pq / dd); q.y += tr(dy * pq / dd);
        }
      }
      for (const e of a) if (e.k === 0 && !e.dead) { clampField(e); fixWater(st, e); }
    }

    /* ---------------- deaths, crowns, the end ---------------- */
    function onDeath(st, e) {
      const d = UNIT[e.u];
      const other = 1 - e.s;
      ev(st, { k: "die", id: e.id, u: e.u, x: e.x, y: e.y, s: e.s, kind: e.k });
      if (e.k <= 1) st.sides[e.s].n--;
      if (st.sides[e.s].leg === e.id) st.sides[e.s].leg = 0;
      if (e.k === 2) {
        const O = st.sides[other];
        if (e.lane === -1) {
          O.crowns = 3;
          ev(st, { k: "tower", id: e.id, s: e.s, lodge: 1 });
          finish(st, other, "lodge");
        } else {
          O.crowns = Math.min(3, O.crowns + 1);
          O.pocket[e.lane] = 1;
          ev(st, { k: "tower", id: e.id, s: e.s, lodge: 0 });
        }
        return;
      }
      if (e.nd || !d.death) return;
      const D = d.death;
      if (D.cocoa) { const S = st.sides[e.s]; S.cocoa = Math.min(R.cocoaMax, S.cocoa + D.cocoa); ev(st, { k: "cocoa", s: e.s, n: D.cocoa, x: e.x, y: e.y }); }
      if (D.dmg || D.slowP) burst(st, e.s, e.x, e.y, { dmg: D.dmg || 0, r: D.r || 2000, knock: D.knock || 0, slowP: D.slowP || 0, slowT: D.slowT || 0, air: 1, kind: "death" }, e.id);
      if (D.spawn) spawnGroup(st, e.s, D.spawn, e.x, e.y, D.count || 1, "");
    }
    function deaths(st) {
      for (let guard = 0; guard < 10; guard++) {
        let any = false;
        for (let i = 0; i < st.ents.length; i++) {
          const e = st.ents[i];
          if (e.dead === 1) { e.dead = 2; any = true; onDeath(st, e); }
        }
        if (!any) break;
      }
      let w = 0;
      const a = st.ents;
      for (let i = 0; i < a.length; i++) if (a[i].dead !== 2) a[w++] = a[i];
      a.length = w;
    }
    function lowTower(st, side) {
      let low = -1;
      for (const t of st.ents) if (t.k === 2 && t.s === side && !t.dead && (low < 0 || t.hp < low)) low = t.hp;
      return low < 0 ? 0 : low;
    }
    function finish(st, winner, why) {
      if (st.phase === 2) return;
      st.phase = 2; st.winner = winner; st.why = why;
      ev(st, { k: "end", w: winner, why: why });
    }

    /* ---------------- plays ---------------- */
    function canPlay(st, side, cardId, x, y) {
      if (st.phase === 2) return "over";
      const card = CARD[cardId];
      if (!card) return "card";
      const S = st.sides[side];
      if (!S || S.hand.indexOf(cardId) < 0) return "hand";
      if (S.cocoa < card.cost * 1000) return "cocoa";
      if (card.rarity === "legend" && S.leg) return "alive";
      const p = snap(card, x, y);
      if (!placeOk(st, side, card, p[0], p[1])) return "zone";
      return "";
    }
    // where a card may go, cocoa aside (the server checks plays a few ticks ahead)
    function placeAllowed(st, side, cardId, x, y) {
      const card = CARD[cardId];
      if (!card) return false;
      const p = snap(card, x, y);
      return placeOk(st, side, card, p[0], p[1]);
    }
    function summitNext(st, side, cardId) {
      const c = CARD[cardId];
      if (!c || !c.summit) return false;
      const n = st.sides[side].plays[cardId] || 0;
      return (n + 1) % c.summit.every === 0;
    }
    function play(st, side, cardId, x, y) {
      const why = canPlay(st, side, cardId, x, y);
      if (why) { ev(st, { k: "reject", s: side, card: cardId, why: why }); return false; }
      const card = CARD[cardId];
      const S = st.sides[side];
      const p = snap(card, x, y);
      S.cocoa -= card.cost * 1000;
      const sum = summitNext(st, side, cardId) ? 1 : 0;
      S.plays[cardId] = (S.plays[cardId] || 0) + 1;
      const hi = S.hand.indexOf(cardId);
      S.hand[hi] = S.queue.shift();
      S.queue.push(cardId);
      if (card.type === "spell") {
        const sp = sum && card.summit.spell ? Object.assign({}, card.spell, card.summit.spell) : card.spell;
        const base = { id: st.nid++, s: side, x: p[0], y: p[1], card: cardId, t0: st.tick, sum: sum };
        let z = null;
        if (sp.kind === "damage") z = Object.assign(base, { k: "strike", at: st.tick + (sp.delay || 0), dmg: sp.dmg, r: sp.r, tp: sp.towerPct, kn: sp.knock || 0, stn: sp.stun || 0, kind: cardId });
        else if (sp.kind === "zone") z = Object.assign(base, { k: "zone", until: st.tick + sp.ticks, r: sp.r, slowP: sp.slowP || 0, hasteP: sp.hasteP || 0, dps: sp.dps || 0, heal: sp.heal || 0, tp: sp.towerPct || 100 });
        else if (sp.kind === "freeze") z = Object.assign(base, { k: "freeze", at: st.tick + (sp.delay || 0), r: sp.r, ticks: sp.ticks, dmg: sp.dmg, tp: sp.towerPct });
        else if (sp.kind === "spawn") z = Object.assign(base, { k: "spawn", at: st.tick + (sp.delay || 0), unit: sp.unit, count: sp.count });
        else if (sp.kind === "push") z = Object.assign(base, { k: "push", at: st.tick + (sp.delay || 0), r: sp.r, dist: sp.dist, dmg: sp.dmg });
        else if (sp.kind === "roll") z = Object.assign(base, { k: "roll", dir: side === 0 ? -1 : 1, trav: 0, dist: sp.dist, half: sp.half, dmg0: sp.dmg0, dmg1: sp.dmg1, knock: sp.knock, speed: sp.speed, tp: sp.towerPct, hit: [] });
        else if (sp.kind === "bridge") z = Object.assign(base, { k: "bridge", half: sp.half, until: st.tick + sp.ticks });
        if (z) st.zones.push(z);
      } else {
        const count = (sum && card.summit.card && card.summit.card.count) || card.count || 1;
        const uid = sum && card.summit.unit ? card.unit + "*" : card.unit;
        const made = spawnGroup(st, side, uid, p[0], p[1], count, cardId);
        for (const e of made) e.sm = sum;
      }
      ev(st, { k: "play", s: side, card: cardId, x: p[0], y: p[1], sum: sum });
      return true;
    }
    function ability(st, side) {
      const S = st.sides[side];
      if (st.phase === 2 || !S.leg || st.tick < S.abilAt) return false;
      const e = byId(st, S.leg);
      if (!e || e.dead || e.dep > 0 || e.lp) return false;
      const d = UNIT[e.u], a = d.ability;
      if (!a) return false;
      if (a.kind === "rally") {
        for (const t of st.ents) {
          if (t.dead || t.s !== side || t.k !== 0) continue;
          const rr = a.r + t.r;
          if (d2(t, e) > rr * rr) continue;
          t.haT = st.tick + a.t; t.haP = a.p;
        }
      } else if (a.kind === "whiteout") {
        burst(st, side, e.x, e.y, { dmg: a.dmg, r: a.r, stun: a.t, freeze: 1, troopsOnly: 1, air: 1, kind: "whiteout" }, e.id);
      } else if (a.kind === "leap") {
        let best = null, bd = 0;
        for (const t of st.ents) {
          if (t.dead || t.s === side || t.air) continue;
          const dd = d2(t, e);
          if (!best || dd < bd) { best = t; bd = dd; }
        }
        if (!best) return false;
        const dx = best.x - e.x, dy = best.y - e.y, dd = isqrt(dx * dx + dy * dy);
        let go = Math.min(a.dist, dd - (best.r + e.r + 150));
        if (go < 0) go = 0;
        const tx = dd ? e.x + tr(dx * go / dd) : e.x, ty = dd ? e.y + tr(dy * go / dd) : e.y;
        e.lp = { n: 0, t: a.t, fx: e.x, fy: e.y, tx: clamp(tx, e.r, W - e.r), ty: clamp(ty, e.r, H - e.r) };
        face(e, dx, dy);
      } else if (a.kind === "flare") {
        let t = e.tg ? byId(st, e.tg) : null;
        if (!t || t.dead || t.s === side) {
          t = null;
          let bd = 0;
          for (const v of st.ents) {
            if (v.dead || v.s === side) continue;
            const dd = d2(v, e);
            if (dd > 8000 * 8000) continue;
            if (!t || dd < bd) { t = v; bd = dd; }
          }
        }
        if (!t) return false;
        st.zones.push({ id: st.nid++, s: side, x: t.x, y: t.y, card: "flare", t0: st.tick, sum: 0, k: "strike", at: st.tick + a.delay,
          dmg: a.dmg, r: a.r, tp: a.towerPct, kn: 0, stn: 0, kind: "flare" });
      }
      S.abilAt = st.tick + a.cd;
      ev(st, { k: "abil", id: e.id, s: side, kind: a.kind });
      return true;
    }

    /* ---------------- the match ---------------- */
    function deckOk(deck) {
      if (!Array.isArray(deck) || deck.length !== R.deckSize) return false;
      const seen = {};
      let legends = 0;
      for (const id of deck) {
        if (typeof id !== "string" || !CARD[id] || seen[id]) return false;
        seen[id] = 1;
        if (CARD[id].rarity === "legend") legends++;
      }
      return legends <= 1;
    }
    function create(opts) {
      const seed = (opts.seed >>> 0) || 1;
      const st = { v: VERSION, tick: 0, seed: seed, rng: seed | 0, phase: 0, winner: -1, why: "", nid: 1, ents: [], projs: [], zones: [], sides: [], ev: [] };
      for (let s = 0; s < 2; s++) {
        const deck = deckOk(opts.decks[s]) ? opts.decks[s].slice() : DB.DECKS.starter.slice();
        const order = deck.slice();
        for (let i = order.length - 1; i > 0; i--) { const j = rnd(st) % (i + 1); const t = order[i]; order[i] = order[j]; order[j] = t; }
        st.sides.push({ cocoa: R.cocoaStart, deck: deck, hand: order.slice(0, R.handSize), queue: order.slice(R.handSize),
          crowns: 0, plays: {}, pocket: [0, 0], leg: 0, abilAt: 0, n: 0 });
      }
      for (let s = 0; s < 2; s++) {
        for (const sp of R.towerSpots) {
          const e = spawn(st, s, sp.u, sp.x, s === 0 ? sp.y : H - sp.y, "");
          e.lane = sp.lane; e.dep = 0;
        }
      }
      return st;
    }
    function step(st, cmds) {
      st.ev = [];
      if (st.phase === 2) return st;
      if (cmds && cmds.length) {
        for (const c of cmds) {
          if (!c || (c.s !== 0 && c.s !== 1)) continue;
          if (c.k === "play") play(st, c.s, c.card, c.x, c.y);
          else if (c.k === "ab") { if (!ability(st, c.s)) ev(st, { k: "reject", s: c.s, card: "", why: "ability" }); }
          else if (c.k === "quit") finish(st, 1 - c.s, "surrender");
          else if (c.k === "forfeit") finish(st, 1 - c.s, "forfeit");
          if (st.phase === 2) return st;
        }
      }
      const rate = st.tick >= R.doubleAt ? R.cocoaTick * 2 : R.cocoaTick;
      for (const S of st.sides) S.cocoa = Math.min(R.cocoaMax, S.cocoa + rate);
      stepZones(st);
      auras(st);
      const a = st.ents;
      for (let i = 0; i < a.length; i++) update(st, a[i]);
      stepProjs(st);
      collide(st);
      deaths(st);
      st.tick++;
      if (st.phase === 0 && st.tick >= R.regTicks) {
        const c0 = st.sides[0].crowns, c1 = st.sides[1].crowns;
        if (c0 !== c1) finish(st, c0 > c1 ? 0 : 1, "time");
        else { st.phase = 1; ev(st, { k: "overtime" }); }
      } else if (st.phase === 1) {
        const c0 = st.sides[0].crowns, c1 = st.sides[1].crowns;
        if (c0 !== c1) finish(st, c0 > c1 ? 0 : 1, "sudden");
        else if (st.tick >= R.regTicks + R.otTicks) {
          const l0 = lowTower(st, 0), l1 = lowTower(st, 1);
          finish(st, l0 === l1 ? 2 : l0 > l1 ? 0 : 1, "tiebreak");
        }
      }
      return st;
    }
    function hash(st) {
      let h = 2166136261 | 0;
      function m(v) { h = Math.imul(h ^ (v | 0), 16777619); }
      m(st.tick); m(st.rng); m(st.phase); m(st.winner); m(st.nid);
      for (const S of st.sides) {
        m(S.cocoa); m(S.crowns); m(S.leg); m(S.abilAt); m(S.pocket[0]); m(S.pocket[1]); m(S.n);
        for (const id of S.hand) m(CIX[id] || 0);
        for (const id of S.queue) m(CIX[id] || 0);
      }
      for (const e of st.ents) {
        m(e.id); m(UIX[e.u] || 0); m(e.x); m(e.y); m(e.hp); m(e.sh); m(e.tg); m(e.cd); m(e.stT); m(e.dep); m(e.life);
      }
      for (const p of st.projs) { m(p.id); m(p.x); m(p.y); m(p.tg); }
      for (const z of st.zones) { m(z.id); m(z.x); m(z.y); }
      h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
      return h >>> 0;
    }
    function clone(st) { return JSON.parse(JSON.stringify(st)); }
    function timeLeft(st) {
      if (st.phase === 0) return R.regTicks - st.tick;
      if (st.phase === 1) return R.regTicks + R.otTicks - st.tick;
      return 0;
    }

    return {
      R: R, DB: DB, CARD: CARD, UNIT: UNIT, version: VERSION,
      create: create, step: step, hash: hash, clone: clone, canPlay: canPlay, snap: snap, deckOk: deckOk, placeAllowed: placeAllowed,
      zoneRects: zoneRects, summitNext: summitNext, byId: byId, timeLeft: timeLeft, lowTower: lowTower,
      region: region, isqrt: isqrt,
    };
  }

  const API = { make: make, isqrt: isqrt, VERSION: VERSION };
  if (typeof module === "object" && module && module.exports) module.exports = API;
  if (root) root.LeonClashSim = API;
})(typeof globalThis !== "undefined" ? globalThis : null);
