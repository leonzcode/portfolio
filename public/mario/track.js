/* ---------------------------------------------------------------------------
   The circuit.

   One closed loop, built from a handful of control points blown up into a few
   hundred samples along a Catmull-Rom spline. Everything else in the game asks
   the track two questions - "how far round am I" and "am I still on the tarmac"
   - and both are answered by projecting a position onto the nearest sample, so
   the same data drives the road mesh, the lap counter, the running order, the
   minimap and the computer drivers.

   Coordinates: x/z is the ground, y is up, one unit is one metre.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { themeById, rulesOf, lookOf } from './themes.js?v=73';

/* The lap.

   Drawn fresh for every race from the round's seed, because a circuit you have
   learned is a circuit you stop reading. The shape is a ring whose radius is a
   few smooth harmonics of the angle round it: that gives long straights, real
   corners and the odd hairpin, and it can never cross itself, which a wandering
   walk very much can. Width varies point to point so a hairpin can open out and
   a chicane can pinch.

   Both browsers in a lobby build from the same seed, so both get the same lap
   without a byte of it going over the wire. */
function makeCP(seed) {
  let s = (seed | 0) || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const n = 15 + Math.floor(rnd() * 5);
  const wave = [
    { k: 2, a: 0.10 + rnd() * 0.15, p: rnd() * 6.283 },
    { k: 3, a: 0.06 + rnd() * 0.13, p: rnd() * 6.283 },
    { k: 5, a: 0.04 + rnd() * 0.08, p: rnd() * 6.283 },
    { k: 7, a: 0.02 + rnd() * 0.05, p: rnd() * 6.283 },
  ];
  const squash = 0.78 + rnd() * 0.22;
  const spin = rnd() * 6.283;
  const out = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    let r = 1;
    for (const q of wave) r += q.a * Math.sin(q.k * th + q.p);
    /* A bigger circuit than it used to be, but not by as much as it first was.
       Ten sections a lap need somewhere to go and the old radius could not place
       the last two or three of them; at two hundred they all fitted and a lap of
       the slowest circuit took over seventy seconds, which is three and a half
       minutes for a race. */
    const R = 180 * r;
    out.push({
      x: Math.cos(th + spin) * R,
      z: Math.sin(th + spin) * R * squash,
      w: 7.5 + rnd() * 3.6,
    });
  }
  return out;
}

const STEP = 2.2;                 // metres between samples
const KERB = 1.5;                 // the red and white, the outer strip of the road
// The wall stands on the edge of the tarmac itself, so the barrier is on the
// road rather than beside it. props.js finds this line by asking project where
// it is, so the barriers follow it wherever it goes, camber and all.
const SHOULDER = 0;

function hill(x, z) {
  // gentle ground, so the circuit sits in country rather than on a table
  return Math.sin(x * 0.0075) * 3.4 + Math.cos(z * 0.0091) * 3.0 + Math.sin((x + z) * 0.004) * 2.2;
}
// Hollows dug into the field. The water section runs along a channel, and a
// channel means the ground either side has to come down to meet it, or the road
// is simply buried under a flat field.
const basins = [];
export function groundY(x, z) {
  const rim = Math.max(0, (Math.max(Math.abs(x), Math.abs(z)) - 210) / 240);
  const y = hill(x, z) + rim * rim * 46;
  // The deepest hollow that reaches here, not the sum of them. Adding them up
  // meant a dozen overlapping basins along the channel dug a seventeen metre pit
  // instead of the three metre one each of them asked for.
  let dig = 0;
  for (let i = 0; i < basins.length; i++) {
    const b = basins[i];
    const d = Math.hypot(x - b.x, z - b.z);
    if (d >= b.r) continue;
    const cut = b.drop * (0.5 + 0.5 * Math.cos(Math.PI * d / b.r));
    if (cut > dig) dig = cut;
  }
  return y - dig;
}

/* How much the card is willing to do about a surface seen almost edge on,
   which a road always is. Eight was a guess; the number the card actually
   offers is usually sixteen, and a road is the one thing in a racing game that
   is looked at from a metre above it and half a kilometre away at once. Set
   from the renderer at start-up and clamped by it if it is more than it can
   do. */
let MAX_ANISO = 8;
export function setAniso(n) { MAX_ANISO = Math.max(1, n | 0) || 8; }
function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  if (rep) t.repeat.set(rep[0], rep[1]);
  return t;
}

/* The road. The uv runs across the ribbon in u and along the lap in v, so this
   texture knows which way is across: the two dark bands at a third and two
   thirds of the width are the racing line worn into it, and the pale bands at
   the very edges are the white line painted down them. That alone does more for
   the look of a circuit than any amount of grit, because it tells you where the
   road goes before you can see the corner.

   Three maps, drawn from the same features so they line up. The colour, with
   the grit at a strength between the old static and the flat grey that tried
   to replace it. The surface, a height field turned into a normal map: stones
   standing proud of the binder, cracks sealed with tar and the seams round a
   resurfaced patch sitting below it, so the road catches the sun the way
   asphalt does instead of being paint on a sheet. And the gloss: the worn
   line and the tar in the cracks are smoother than the rest. */
function tarmacTex(th) {
  const [base, spread, tint] = th.tarmacGrit;
  const W = 512, H = 512;
  const sheet = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const colC = sheet(), hC = sheet(), rC = sheet();
  const g = colC.getContext('2d'), h = hC.getContext('2d'), r = rC.getContext('2d');
  const grey = (v, a) => 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + ((v + tint) | 0) + ',' + a + ')';
  // anything that might cross the top or bottom edge is drawn again a sheet
  // away, so the texture repeats down the lap without a seam
  const wrapY = fn => { fn(0); fn(-H); fn(H); };

  g.fillStyle = th.tarmac; g.fillRect(0, 0, W, H);
  h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, W, H);
  r.fillStyle = 'rgb(214,214,214)'; r.fillRect(0, 0, W, H);

  // slow variation, so the grit sits on something rather than on flat paint
  for (let i = 0; i < 24; i++) {
    const rad = 50 + Math.random() * 140;
    const x = Math.random() * W, y = Math.random() * H, v = base + Math.random() * spread;
    wrapY(dy => {
      const grd = g.createRadialGradient(x, y + dy, 0, x, y + dy, rad);
      grd.addColorStop(0, grey(v, 0.2)); grd.addColorStop(1, grey(v, 0));
      g.fillStyle = grd; g.fillRect(x - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
  // the worn line: darker, and polished smoother by the tyres
  for (const at of [0.3, 0.7]) {
    const band = (ctx, edge, mid) => {
      const grad = ctx.createLinearGradient((at - 0.16) * W, 0, (at + 0.16) * W, 0);
      grad.addColorStop(0, edge); grad.addColorStop(0.5, mid); grad.addColorStop(1, edge);
      ctx.fillStyle = grad; ctx.fillRect((at - 0.16) * W, 0, 0.32 * W, H);
    };
    band(g, 'rgba(20,22,26,0)', 'rgba(20,22,26,.32)');
    band(r, 'rgba(150,150,150,0)', 'rgba(150,150,150,.8)');
  }
  // resurfaced patches: a shade off the rest, a touch proud, a dark seam round them
  for (let i = 0; i < 3; i++) {
    const pw = 60 + Math.random() * 150, ph = 30 + Math.random() * 90;
    const x = W * 0.14 + Math.random() * (W * 0.72 - pw), y = Math.random() * H;
    const v = base + (Math.random() < 0.5 ? -14 : 12);
    wrapY(dy => {
      g.fillStyle = grey(v, 0.34); g.fillRect(x, y + dy, pw, ph);
      g.strokeStyle = 'rgba(16,17,20,.26)'; g.lineWidth = 2; g.strokeRect(x, y + dy, pw, ph);
      h.fillStyle = 'rgb(140,140,140)'; h.fillRect(x, y + dy, pw, ph);
      h.strokeStyle = 'rgb(96,96,96)'; h.lineWidth = 2; h.strokeRect(x, y + dy, pw, ph);
      r.strokeStyle = 'rgb(130,130,130)'; r.lineWidth = 3; r.strokeRect(x, y + dy, pw, ph);
    });
  }
  // the grit: stones in the binder, lighter and darker, each standing a little proud
  for (let i = 0; i < 20000; i++) {
    const x = Math.random() * W, y = Math.random() * H, sz = Math.random() < 0.8 ? 2 : 3;
    g.fillStyle = grey(base + Math.random() * spread, 0.26);
    g.fillRect(x, y, sz, sz);
    h.fillStyle = Math.random() < 0.6 ? 'rgba(200,200,200,.55)' : 'rgba(70,70,70,.45)';
    h.fillRect(x, y, sz, sz);
  }
  // cracks, sealed with tar: dark, sunk and shiny, wandering the way cracks do
  for (let i = 0; i < 7; i++) {
    let x = W * 0.14 + Math.random() * W * 0.72, y = Math.random() * H;
    let ang = Math.random() * Math.PI * 2;
    const pts = [[x, y]];
    const n = 8 + (Math.random() * 14 | 0);
    for (let k = 0; k < n; k++) {
      ang += (Math.random() - 0.5) * 1.1;
      x = Math.max(W * 0.13, Math.min(W * 0.87, x + Math.cos(ang) * 9));
      y += Math.sin(ang) * 9;
      pts.push([x, y]);
    }
    const lw = 1.5 + Math.random() * 1.8;
    wrapY(dy => {
      for (const [ctx, style, w] of [[g, 'rgba(14,15,18,.42)', lw], [h, 'rgb(78,78,78)', lw + 1], [r, 'rgb(100,100,100)', lw]]) {
        ctx.strokeStyle = style; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1] + dy);
        for (const q of pts) ctx.lineTo(q[0], q[1] + dy);
        ctx.stroke();
      }
    });
  }
  /* And the white line down each edge, scuffed rather than crisp. Inboard of
     the very edge, because the outer metre and a half of the ribbon is under
     the kerb: painted at u=0 the line was there and nobody ever saw it. Paint
     sits a little proud of the road and is smoother than it. */
  const LX = Math.round(W * 0.105), LW = 10;
  g.fillStyle = 'rgba(244,246,250,.62)';
  g.fillRect(LX, 0, LW, H); g.fillRect(W - LX - LW, 0, LW, H);
  h.fillStyle = 'rgb(150,150,150)'; h.fillRect(LX, 0, LW, H); h.fillRect(W - LX - LW, 0, LW, H);
  r.fillStyle = 'rgb(150,150,150)'; r.fillRect(LX, 0, LW, H); r.fillRect(W - LX - LW, 0, LW, H);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 90; i++) {
    g.fillStyle = 'rgba(0,0,0,.5)';
    g.fillRect(Math.random() < 0.5 ? LX : W - LX - LW, Math.random() * H, LW, 4 + Math.random() * 10);
  }
  g.globalCompositeOperation = 'source-over';

  // the height field into a normal map, wrapping at every edge as the texture does
  const src = h.getImageData(0, 0, W, H).data;
  const nC = sheet(), nx = nC.getContext('2d');
  const out = nx.createImageData(W, H), o = out.data;
  const hAt = (x, y) => src[((((y + H) % H) * W + ((x + W) % W)) * 4)];
  const STR = 2.2 / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * STR, dy = (hAt(x, y + 1) - hAt(x, y - 1)) * STR;
      const l = 1 / Math.sqrt(dx * dx + dy * dy + 1), k = (y * W + x) * 4;
      o[k] = (-dx * l * 0.5 + 0.5) * 255;
      o[k + 1] = (dy * l * 0.5 + 0.5) * 255;
      o[k + 2] = (l * 0.5 + 0.5) * 255;
      o[k + 3] = 255;
    }
  }
  nx.putImageData(out, 0, 0);

  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = MAX_ANISO;
    return t;
  };
  return { map: tex(colC, true), normal: tex(nC, false), rough: tex(rC, false) };
}
function grassTex(th) {
  // and the same again for the ground it runs through
  return canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = th.ground; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 22; i++) {
      const r = 60 + Math.random() * 150;
      const x = Math.random() * W, y = Math.random() * H;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, th.groundFleck[Math.random() < 0.5 ? 0 : 1]);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.22; g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.globalAlpha = 1;
    }
    for (let i = 0; i < 9000; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? th.groundFleck[0] : th.groundFleck[1];
      g.fillRect(Math.random() * W, Math.random() * H, 3, 3);
    }
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = th.blade; g.lineWidth = 2;
      const x = Math.random() * W, y = Math.random() * H;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 12, y - 8 - Math.random() * 10); g.stroke();
    }
  }, [60, 60]);
}

/* ---- the spline ---------------------------------------------------------- */
function catmull(p0, p1, p2, p3, t, key) {
  const a = p0[key], b = p1[key], c = p2[key], d = p3[key];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

function sampleLoop(seed, th) {
  basins.length = 0;                  // a new lap digs its own hollows
  const R = rulesOf(th);
  const CP = makeCP(seed);
  // how wide the road is here. Sunfield Loop is the broadest thing on the
  // calendar and Neon Mile is a corridor, and that alone changes how a corner
  // has to be taken more than any amount of paint would.
  for (const c of CP) c.w *= R.width;
  const fine = [];
  const n = CP.length;
  for (let i = 0; i < n; i++) {
    const p0 = CP[(i - 1 + n) % n], p1 = CP[i], p2 = CP[(i + 1) % n], p3 = CP[(i + 2) % n];
    const seg = Math.max(2, Math.round(Math.hypot(p2.x - p1.x, p2.z - p1.z) / STEP));
    for (let k = 0; k < seg; k++) {
      const t = k / seg;
      fine.push({
        x: catmull(p0, p1, p2, p3, t, 'x'),
        z: catmull(p0, p1, p2, p3, t, 'z'),
        w: catmull(p0, p1, p2, p3, t, 'w'),
      });
    }
  }
  // arc length, tangents and normals
  const out = [];
  let s = 0;
  for (let i = 0; i < fine.length; i++) {
    const a = fine[i], b = fine[(i + 1) % fine.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1e-6;
    /* The height of a road is the height of the ground it spans, not the height
       of the ground under the middle of it. On a slope the outer edge of a wide
       one cuts into the hill, and Sunfield Loop, which is the widest thing on
       the calendar, had its tarmac buried under the field for it. */
    const m = a.w + 1.6;                               // out past the kerb
    const top = Math.max(
      hill(a.x, a.z),
      hill(a.x - (dz / len) * m, a.z + (dx / len) * m),
      hill(a.x + (dz / len) * m, a.z - (dx / len) * m));
    out.push({
      p: new THREE.Vector3(a.x, top, a.z),
      t: new THREE.Vector3(dx / len, 0, dz / len),
      n: new THREE.Vector3(-dz / len, 0, dx / len),      // left of travel
      w: a.w, s, len,
    });
    s += len;
  }

  /* ---- the road is graded ------------------------------------------------- */
  // The ground rolls; a road laid on it should not. Average each sample's height
  // over the fifty odd metres either side of it, which keeps the long climbs and
  // takes out the short bumps that were being felt through the wheels.
  {
    /* Twice as long a window as it was, and run twice. The ground rolls at a
        scale of tens of metres and the road should not feel any of it: what is
        left after this is the long climbs and nothing you can feel through the
        wheels. */
    let raw = out.map(a => a.p.y);
    const n = out.length, W = 22;
    for (let pass = 0; pass < 2; pass++) {
      const next = new Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let d = -W; d <= W; d++) sum += raw[(i + d + n) % n];
        // graded, but never so far under the ground it spans that the field
        // closes over it. The quarter metre of slack is what the kerb blends away.
        next[i] = Math.max(sum / (W * 2 + 1), raw[i] - 0.25);
      }
      raw = next;
    }
    for (let i = 0; i < n; i++) out[i].p.y = raw[i];
    // and a light three tap over that, so the clamp leaves no step in it
    const fix = out.map(a => a.p.y);
    for (let i = 0; i < n; i++) {
      out[i].p.y = (fix[(i - 1 + n) % n] + fix[i] * 2 + fix[(i + 1) % n]) / 4;
    }
  }

  /* The width gets the same treatment. Sections change it by a lot and a
     step in the width is a step in where the barrier is, which is a car
     bouncing off nothing. Done after the sections have had their say. */
  const smoothW = () => {
    const m = out.length;
    for (let pass = 0; pass < 2; pass++) {
      const w0 = out.map(a => a.w);
      for (let i = 0; i < m; i++) {
        let sum = 0;
        for (let d = -5; d <= 5; d++) sum += w0[(i + d + m) % m];
        out[i].w = sum / 11;
      }
    }
  };

  /* ---- the lean of the corners ------------------------------------------- */
  // Measure the bend a little way ahead of each sample and smooth it, or the
  // road twitches from one sample to the next. `bank` is a slope: how much
  // height a metre of lateral offset buys, so the outside of the corner rises
  // and the inside drops.
  const M = out.length;
  for (let i = 0; i < M; i++) {
    const a = out[i], b = out[(i + 9) % M];
    out[i].turn = Math.atan2(a.t.x * b.t.z - a.t.z * b.t.x, a.t.x * b.t.x + a.t.z * b.t.z);
  }
  for (let i = 0; i < M; i++) {
    let sum = 0;
    for (let d = -8; d <= 8; d++) sum += out[(i + d + M) % M].turn;
    // negative, because the outside of the bend is the side away from the turn
    out[i].bend = sum / 17;
    // how hard the circuit leans into its corners. Redrock Dunes builds proper
    // banked bowls out of them; Glacier Pass keeps them nearly flat, because
    // camber you cannot hold on ice is a cliff rather than a corner.
    out[i].bank = Math.max(-0.08, Math.min(0.08, -out[i].bend * 0.62)) * R.bank;
  }
  // the start straight stays flat, so the line, the gantry and the grid all sit
  // where they are drawn
  const FLAT = 26;
  for (let d = -FLAT; d <= FLAT; d++) {
    const i = (d + M) % M;
    out[i].bank *= Math.min(1, Math.abs(d) / FLAT) ** 2;
  }

  /* ---- the ramps ---------------------------------------------------------- */
  // The road itself climbs these, so a kart drives up rather than through, and
  // the lip is where game.js throws it into the air.
  const ramps = [];
  let rside = 0;
  // how many, and where. They are spread evenly round the lap, alternating
  // sides, so a circuit with four of them gives you a jump every quarter.
  const rampAts = [];
  for (let k = 0; k < R.ramps; k++) rampAts.push(0.235 + k / R.ramps);
  for (const raw of rampAts) {
    const at = raw % 1;
    const side = (rside++ % 2) ? 1 : -1;        // one each way round the lap
    /* The height of the jump is (v sin th)^2 / 2G, so a quarter of the height
       wants half the launch speed and half the launch speed wants half the ramp
       angle. 1.1m over four samples is about ten degrees, which throws a kart at
       racing speed a bit under a metre. Ember Hollow builds them half again as
       steep, which is most of why it is the circuit it is. */
    const i0 = Math.floor(at * M), len = 4, rise = R.rampRise;
    for (let k = 0; k < len; k++) {
      const i = (i0 + k) % M;
      const f = k / (len - 1);
      // On one side of the road only, so a jump is a line you choose rather than
      // one you are given. It is kept off p.y, unlike the bridge and the water,
      // because it is not the whole width: the height it adds depends on how far
      // across the road you are, and surf() and project() work that out.
      out[i].ramp = rise * f * f * (3 - 2 * f);
      out[i].rampSide = side;
      out[i].bank = 0;                                   // flat on the ramp
    }
    const lip = out[(i0 + len - 1) % M];
    ramps.push({ i: (i0 + len - 1) % M, pos: lip.p.clone(), s: lip.s, side });
  }

  /* ---- what happens to the road on the way round --------------------------
     A catalogue of sections, and a list per circuit of which ones it gets.
     Everything in here changes how the lap drives rather than how it looks:
     where it climbs, where it pinches, where it leans over, where it stops
     being there at all. The look is applied later, and is also the circuit's
     own, so a tunnel at Redrock Dunes is a cave through a mountain and the same
     tunnel at Neon Mile is a lit glass pipe.

     `len` is how many samples it covers, `shape` is what it does to each of
     them, and `t` runs 0 to 1 across it. Placement is worked out below: they
     are spread round the lap and never land on each other, on a ramp, or on
     the start line, so a circuit can carry ten of them without any two
     arguing about the same piece of road.
  -------------------------------------------------------------------------- */
  // A smooth rise from nothing to the full amount and back, so each section
  // joins the road either side of it without a step.
  const bump = t => 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
  // and one that goes up and stays up, for anything that leaves you higher or
  // lower than it found you
  const ease = t => t * t * (3 - 2 * t);

  const FEATURES = {
    /* long and gentle, because a bridge is a bridge: at this slope the crest
       does not reach the launch threshold and nobody is thrown off it */
    bridge: { len: 34, rise: 4.5, flat: 1, shape(a, t, f) { a.p.y += f.rise * bump(t); a.bridge = 1; } },

    /* enclosed. What the tube is made of is the circuit's business. */
    tunnel: { len: 30, flat: 1, shape(a) { a.tunnel = 1; } },

    /* a channel with something in it you drive through the bottom of */
    water: { len: 34, drop: 3.1, flat: 1, shape(a, t, f, k) {
      a.p.y -= f.drop * bump(t);
      a.water = 1;
      a.waterY = f.surfaceY;
      if (k % 3 === 0) basins.push({ x: a.p.x, z: a.p.z, r: a.w + 26, drop: f.drop * bump(t) + 1.2 });
    } },

    /* The road stops. There is a run up, a lip, nothing at all for a few
       samples, and a landing. Miss it and something comes and fishes you out. */
    /* The road stops. There is a run up, a lip steep enough to throw a car
       clear at anything like racing speed, nothing at all for a few samples,
       and a landing that is lower than the lip so you cannot clip the far side.

       The lip and the hole are sized against each other, and the sizing has to
       hold on the slow circuits as well as the quick ones. A launch only fires
       when the road's climb times your speed clears a bar; at the first lip it
       was the bar that decided whether you jumped, so a car arriving at twenty
       simply drove off the end without ever leaving the ground. The lip is now
       steep enough that anything doing eighteen is thrown, and the hole short
       enough that being thrown clears it. */
    chasm: { len: 26, flat: 1, gapFrom: 0.52, gapTo: 0.62, drop: 26, lip: 4.2, kick: 0.1, shape(a, t, f, k) {
      a.chasm = 1;
      if (t > f.gapFrom && t < f.gapTo) {
        a.gap = 1;
        // and the ground goes with it, or the hole is a hole with a field in it
        if (k % 2 === 0) basins.push({ x: a.p.x, z: a.p.z, r: a.w + 22, drop: f.drop });
        return;
      }
      if (t <= f.gapFrom) {
        a.p.y += f.lip * ease(Math.min(1, t / f.gapFrom));
        /* And the last stretch before the hole is a kicker rather than a hill.
           `launch` is how far there is to clear; the car works out for itself
           how hard it has to leave, so a gap is a jump you are thrown off
           rather than a hole you have to be going fast enough to miss.

           How far there really is, which is more than the flagged samples.
           The ribbon will not draw a surface with one end hanging over
           nothing, so it drops the quad on each side of the hole too and the
           tarmac is missing for two segments more than the flags say. Sized
           off the flags alone the kicker put the car down exactly on the far
           lip, which is the one piece of lip that is not there, and a jump you
           had cleared came out as a fall.

           And the kicker fires over the last stretch of run up rather than
           at the edge itself, which is what makes it a ramp instead of a
           trapdoor - so the car leaves the ground several metres before the
           hole, and those metres are part of the jump. Counting only the hole
           sized the throw as if it began at the lip, and the car was already
           coming down by the time it got there. It cleared anyway on the
           strength of the raised lip alone, which is a margin of nothing: one
           run at a canyon in three or four ended in it. */
        if (t > f.gapFrom - f.kick) {
          a.launch = ((f.gapTo - f.gapFrom + f.kick) * f.len + 2) * STEP;
        }
      } else {
        a.p.y += f.lip * 0.45 * (1 - ease(Math.min(1, (t - f.gapTo) / (1 - f.gapTo) * 1.4)));
      }
    } },

    /* A crest steep enough to throw a car at racing speed, then away again. */
    hump: { len: 18, rise: 3.4, flat: 1, shape(a, t, f) {
      a.p.y += f.rise * Math.sin(Math.PI * t) ** 1.6;
    } },

    /* A run of small crests. Nothing here throws you on its own; taken
       together they unsettle the car for the whole length of it. */
    whoops: { len: 30, rise: 0.85, shape(a, t, f) {
      a.p.y += f.rise * Math.sin(t * Math.PI * 7) * Math.sin(Math.PI * t);
      a.bank *= 0.4;
    } },

    /* The road pinches. Nothing else changes, which is the point: the corner
       is the same corner and there is half as much room to get it wrong. */
    narrows: { len: 24, to: 0.55, shape(a, t, f) {
      a.w *= 1 - (1 - f.to) * bump(t);
    } },

    /* And the opposite: it opens out into somewhere you can take any line you
       like, which is where the overtaking happens. */
    arena: { len: 26, by: 1.7, shape(a, t, f) {
      a.w *= 1 + (f.by - 1) * bump(t);
      a.bank *= 0.5;
    } },

    /* A wall of a corner: the camber goes far past anything the rest of the
       lap does, so the outside of it is something you ride rather than fall
       off. It only leans the way the corner already goes. */
    bowl: { len: 28, lean: 0.3, shape(a, t, f) {
      const want = f.leanSign * f.lean;
      a.bank += (want - a.bank) * bump(t);
      a.w *= 1 + 0.25 * bump(t);
    } },

    /* A shelf: the road runs level and then simply drops away, so you leave it
       at whatever speed you arrived and land a long way down. */
    shelf: { len: 24, drop: 5.5, flat: 1, shape(a, t, f) {
      // the drop runs out over a third of the section rather than falling off a
      // cliff: a car should leave a shelf, not be dropped down a hole by it
      a.p.y -= f.drop * (t < 0.4 ? 0 : ease(Math.min(1, (t - 0.4) / 0.42)));
      a.shelf = 1;
    } },

    /* A narrow road with the ground taken away either side of it and no fence
       to save you. Rescue picks up anybody who goes over the edge. */
    /* A road with the ground taken away either side of it and no fence to save
       you. It is longer and narrows far less than it first did: a causeway that
       pinches hard AND has nothing at the edge is not a section, it is a trap,
       and the first version of it put the entire field in the water. */
    causeway: { len: 40, to: 0.78, lift: 2.4, straight: 0.45, shape(a, t, f) {
      a.w *= 1 - (1 - f.to) * bump(t);
      a.p.y += f.lift * bump(t);
      a.causeway = bump(t);
      a.bank *= Math.max(0, 1 - bump(t) * 2.2);
      if (bump(t) > 0.4) a.noFence = 1;
    } },

    /* A long climb with the camber wound right up, which is the only way a
       kart holds a curve that steep. It comes back down the other side. */
    spiral: { len: 46, rise: 13, lean: 0.24, shape(a, t, f) {
      a.p.y += f.rise * Math.sin(Math.PI * t) ** 1.3;
      const want = f.leanSign * f.lean;
      a.bank += (want - a.bank) * Math.sin(Math.PI * t);
      a.spiral = 1;
    } },

    /* Rollers. Gentler than the whoops and twice as long, which on ice is the
       difference between a bumpy straight and one you cannot put power down on. */
    moguls: { len: 40, rise: 0.55, shape(a, t, f) {
      a.p.y += f.rise * Math.sin(t * Math.PI * 11) * Math.sin(Math.PI * t);
    } },

    /* A strip of the surface down one side that is not tarmac, so the quick
       line and the safe line are not the same line. What the strip is made of
       is the circuit's own: sand, ice, or ash. */
    strip: { len: 34, shape(a, t, f) {
      a.strip = bump(t) > 0.2 ? (f.side || 1) : 0;
      a.stripKind = f.of || 'sand';
    } },

    /* Boosters, the length of a straight, down one half of the road. */
    boostlane: { len: 26, shape(a, t, f) {
      if (bump(t) > 0.3) a.boostlane = f.side || 1;
    } },

    /* Anti-gravity. The road turns into a lit rail and the cars hover over it,
       and for as long as they do, running into somebody is worth doing: both
       of you spin and both of you come out the other side quicker than you
       went in. It changes nothing about the shape of the road on purpose. A
       section that also climbed or banked would be two ideas at once, and the
       one worth having here is that the racing line goes straight through the
       car in front. */
    agrav: { len: 36, shape(a, t) {
      if (bump(t) > 0.22) a.agrav = 1;
    } },
  };

  /* ---- where each of them goes -------------------------------------------
     Spread round the lap, never on top of each other, never on a ramp and
     never over the start line. Longest first, because a long section placed
     after a dozen short ones has nowhere left to go. */
  const wanted = (th.features || ['bridge', 'tunnel', 'water'])
    .map(k => (typeof k === 'string' ? { kind: k } : Object.assign({}, k)))
    .filter(f => FEATURES[f.kind]);
  const taken = new Uint8Array(M);
  const START_CLEAR = 24;
  const MARGIN = 3;
  for (let d = -START_CLEAR; d <= START_CLEAR; d++) taken[(d + M * 2) % M] = 1;
  for (const r of ramps) for (let d = -6; d <= 6; d++) taken[(r.i + d + M) % M] = 1;
  const room = (i0, len) => {
    for (let k = -MARGIN; k < len + MARGIN; k++) if (taken[(i0 + k + M * 2) % M]) return false;
    return true;
  };
  const claim = (i0, len) => {
    for (let k = -MARGIN; k < len + MARGIN; k++) taken[(i0 + k + M * 2) % M] = 1;
  };

  const features = [];

  /* There is no crossover section, and there cannot be one drawn this way.
     The lap is a radius as a function of angle, so two different points on it
     are never near each other: measured over ten seeds the closest the road
     ever comes to itself is forty five metres of field, which is not something
     you can build a flyover across.

     The over and under is in the split instead, where it is real: on the
     circuits that ask for it the two lanes leave the island at different
     heights, so one of them is a deck and the other runs underneath it. */
  const order = wanted.map((f, n) => ({ f, n }))
    .sort((a, b) => FEATURES[b.f.kind].len - FEATURES[a.f.kind].len);
  let spread = 0;
  for (const { f, n } of order) {
    const def = FEATURES[f.kind];
    const len = f.len || def.len;
    // start from a different part of the lap for each one, then walk on until
    // there is space; the stride is coprime-ish with the lap so it covers it
    let i0 = Math.floor(((0.08 + (spread++) * 0.147 + (seed % 97) / 97 * 0.1) % 1) * M);
    /* A gap needs a run at it. Placed just past the start line, the first car
       off the grid meets it from a standstill, drives into it, gets put back
       short of it and drives into it again. Anything with a hole in it is kept
       a clear two hundred metres from the line. */
    const runUp = f.kind === 'chasm' ? 95 : 0;
    const clearOfLine = i => !runUp || Math.min((i + M) % M, (M - i) % M) > runUp;
    /* And a section with nothing at the edge of it goes on straight ground.
       A causeway round a bend is a causeway the whole field runs wide off,
       which is not a section, it is a hole with a road leading into it. */
    const want = def.straight || 0;
    const straightEnough = i => {
      if (!want) return true;
      let turn = 0;
      for (let k = 0; k < len; k++) {
        const u = out[(i + k + M * 2) % M].t, v = out[(i + k + 1 + M * 2) % M].t;
        turn += Math.abs(u.x * v.z - u.z * v.x);
      }
      return turn < want;
    };
    let ok = false;
    for (let tries = 0; tries < M; tries++) {
      if (room(i0, len) && clearOfLine(i0) && clearOfLine(i0 + len) && straightEnough(i0)) { ok = true; break; }
      i0 = (i0 + 7) % M;
    }
    // and if the lap simply has no straight long enough, it does without
    if (!ok && want) continue;
    if (!ok) continue;
    claim(i0, len);
    features.push(Object.assign({}, def, f, { len, i0, order: n, ids: [] }));
  }
  // and applied in lap order, so anything reading the list reads it the way you
  // would drive it
  features.sort((a, b) => a.i0 - b.i0);

  for (const f of features) {
    // the water sits at the height the road was before it dipped
    let sum = 0;
    for (let k = 0; k < f.len; k++) sum += out[(f.i0 + k) % M].p.y;
    f.surfaceY = sum / f.len + 0.4;
    /* And which way a banked section leans, settled once for the whole of it.
       Read off each sample's own curvature it flips wherever the road stops
       turning one way and starts turning the other, and a bowl laid across an
       S bend came out banked left at one sample and right at the next: at four
       metres from the middle of the road that is a two metre step in two
       metres of road. You cannot see it, and it throws the car straight into
       the air. The average over the section is the bend the section is on. */
    let bendSum = 0;
    for (let k = 0; k < f.len; k++) bendSum += out[(f.i0 + k) % M].bend;
    f.leanSign = bendSum >= 0 ? -1 : 1;
    for (let k = 0; k < f.len; k++) {
      const i = (f.i0 + k) % M;
      const t = k / (f.len - 1);
      const a = out[i];
      f.ids.push(i);
      /* A section built square to the road is flat through it, because camber
         under a deck or inside a tube is camber nobody can use.

         Faded in and out rather than switched off. Snapping it to zero left a
         step in the camber at each end the size of whatever the road was doing
         there, and at eight metres from the middle of the road a step in the
         camber is a step in the tarmac: driving into a tunnel put a metre of
         cliff across the entrance, which you cannot see and which throws the
         car. It is flat through the middle three quarters and hands back to
         the road's own camber over the ends. */
      if (f.flat) a.bank *= Math.max(0, 1 - bump(t) * 2.2);
      f.shape(a, t, f, k);
    }
    f.s = out[(f.i0 + (f.len >> 1)) % M].s;
  }

  /* ---- the split ---------------------------------------------------------- */
  /* Somewhere on the lap the road genuinely divides: a strip of the country the
     race is in comes up through the middle of the tarmac, with a house standing
     on it, and a full width lane runs down either side. You go left or you go
     right, and both are roads rather than a squeeze past an obstacle.

     It is still one ribbon underneath, because every other part of the game asks
     the track "how far round am I" and wants one answer. The island is recorded
     as a half width per sample: the road is widened by exactly that much, so
     each lane keeps the width it had, and the middle of it is not road. */
  const splits = [];
  {
    /* Several of these on a lap rather than one, each somewhere else and each
       with something different standing in the middle of it, so a circuit asks
       you to choose a line three or four times instead of once. What a place
       gets is written down with the place: how many, how long, and what is on
       the island. A stretch that has been used is claimed like any other
       feature, so the next one goes and finds its own bend. */
    const PLAN = th.split === false ? [] : (th.splits || [{ len: 34, mid: 'house' }]);
    /* Where it goes: the openest stretch of lap that is clear of the ramps and
       of the bridge, the tunnel and the water. A split is a decision, and a
       decision belongs somewhere you are not already busy.

       Openest, not merely straightest, because the road has to more than double
       its width here and a wide road on a tight bend folds its inside edge over
       itself. So each stretch is scored by the tightest radius in it, the widest
       bend on the lap wins, and the split is then built only as big as that bend
       will take. On a generous circuit that is the full size; on a twisty one it
       is a narrower island between narrower lanes, which is still a split. */
    /* Not every section is in the way. A split needs room across the road and
       a bend open enough to take it; it does not care what the tarmac is made
       of or what is painted on it. So the sections that only change the
       surface or the width - an arena is a wide open stretch, which is exactly
       what this wants - are shared rather than avoided, and only the ones that
       reshape the road underneath are kept clear. Refusing all of them left
       one clear gap on a lap and so one split, however many a place asked for. */
    /* Not a bowl, though. A bowl banks hard into a tight bend, and an island
       laid down the middle of one is a kerb in the way of the line every car
       wants: on Redrock that one stretch was a fifteenth of the lap and a
       quarter of all the time the field spent against a wall. */
    const SHARE = { arena: 1, boostlane: 1, strip: 1, agrav: 1, hump: 1 };
    // narrower than this and the island is not drawn, so it would not be a split
    const MIN_ISLE = 2.2;
    const taken = new Set();
    for (const f of features) if (!SHARE[f.kind]) for (const i of f.ids) taken.add(i);
    for (const r of ramps) for (let k = -12; k <= 12; k++) taken.add((r.i + k + M) % M);
    // and not over the line, where the grid stands and the lap is counted
    for (let k = -26; k <= 26; k++) taken.add((k + M * 2) % M);
    const radius = i => {
      const u = out[i].t, v = out[(i + 1) % M].t;
      const d = Math.abs(u.x * v.z - u.z * v.x);
      return d < 1e-5 ? 1e6 : STEP / d;
    };
    for (const plan of PLAN) {
      /* As long as it asked for, or as much of that as there is room for. A
         forty six sample divide wants fifty clear in a row and a lap that has
         already had two of these taken out of it may not have them, in which
         case a shorter one in the right place is worth a great deal more than
         none at all. */
      const want = plan.len || 34;
      let len = want, i0 = -1, openest = 0;
      for (const tryLen of [want, Math.round(want * 0.78), Math.round(want * 0.6), 22, 18]) {
        /* One lane climbing over the other needs the length to climb in: cut
           short, the two lanes part company by a metre in a few car lengths,
           which is a step, not a rise. */
        if (tryLen < (plan.lift ? 32 : 18) || (len !== want && tryLen >= len)) continue;
        for (let c = 0; c < M; c++) {
          let tight = 1e9, clear = true;
          for (let k = -4; k < tryLen + 4 && clear; k++) {
            const i = (c + k + M * 2) % M;
            if (taken.has(i)) clear = false;
            else tight = Math.min(tight, radius(i));
          }
          /* And open enough to actually hold an island. Below a width worth
             having there is no island drawn at all, so a bend that scores best
             of a bad lot gives a "split" that is just a wide piece of road -
             no divider, nothing to go round, no choice. Rather than take the
             openest bend there is, take the openest bend that can carry one. */
          if (!clear || tight <= openest) continue;
          const isleHere = Math.max(0, Math.min(12.2, tight / 1.9 - out[c].w)) / 1.35;
          if (isleHere < MIN_ISLE) continue;
          openest = tight; i0 = c; len = tryLen;
        }
        if (i0 >= 0) break;
      }
      /* Nowhere left. The first one on a lap is worth forcing - a circuit
         with no split at all is a circuit with no decision on it - but the
         second and third are extras, and an extra laid over a bridge is
         worse than no extra. */
      if (i0 < 0) {
        if (splits.length) continue;
        i0 = Math.floor(0.70 * M); openest = 1e9;
      }
      // 1.35 lanes' worth of extra width, or as much of it as the bend allows
      const grow = Math.max(0, Math.min(12.2, openest / 1.9 - out[i0].w));
      const ISLE = grow / 1.35;
      const ids = [];
      let mid = null, first = null, last = null;
      for (let k = 0; k < len; k++) {
        const i = (i0 + k) % M;
        const a = out[i];
        const u = k / (len - 1);
        /* The road opens out before the island appears in it, and closes again
           after it has gone. If the two grew together the divider would come up
           out of the middle of the tarmac underneath whoever was driving down it,
           with nowhere already made to go; opening first means the lane you pick
           is there to be picked, and it is never narrower than the road you came
           in on. */
        /* A blunt nose at each end rather than a knife edge. Tapered to nothing,
           the last couple of metres of island are narrower than the kerb drawn
           round them, so the two flanks meet and paint a kerb straight down the
           middle of a road that has not divided yet. Below a width worth having,
           there is no island. */
        const raw = ISLE * bump(Math.max(0, Math.min(1, (u - 0.16) / 0.68)));
        a.island = raw < 1.6 ? 0 : raw;
        /* And on the circuits that ask for it, the two lanes do not stay level
           with each other: one climbs over while the other dips under, so a split
           is a choice about where you come out as well as which side you take.
           It is applied across the island rather than as a step at the middle, so
           the road surface stays continuous where it is still road. */
        if (plan.lift) {
          /* Tied to the island's own width rather than to the distance along the
             section. The tilt is applied across the island, so if it exists where
             the island does not yet, the road steps by three metres at the exact
             sample the island appears, and the whole field is thrown across it. */
          a.splitLift = a.island * 0.38;
          /* The low lane is a cutting, so the ground has to come down to meet
             it, and by more than the lane drops: the hollow has to clear the far
             edge of the tarmac as well as the middle of it, or the field closes
             over the outside of the road. */
          if (a.splitLift > 0.3) {
            const at = a.p.clone().addScaledVector(a.n, -(a.w * 0.85));
            basins.push({ x: at.x, z: at.z, r: a.w * 2.2, drop: a.splitLift * 2 + 4.5 });
          }
        }
        // and the lanes come out wider than the road they replace, because two of
        // them have to hold a field that was queueing up in one
        a.w += ISLE * 1.35 * bump(u);
        // and level, handed back to the road's camber over the ends of it rather
        // than switched off, for the same reason a tunnel is
        a.bank *= Math.max(0, 1 - bump(u) * 2.2);
        a.split = 1;
        if (k === 0) first = a;
        if (k === len - 1) last = a;
        if (k === Math.floor(len / 2)) mid = a;
        if (a.island) ids.push(i);
      }
      if (mid) splits.push({
        i: (i0 + Math.floor(len / 2)) % M, s: mid.s, s0: first.s, s1: last.s,
        x: mid.p.x, y: mid.p.y, z: mid.p.z, yaw: Math.atan2(mid.t.x, mid.t.z),
        isle: ISLE, lane: mid.w - ISLE,
        // what stands on this one, and whether its lanes part company vertically
        mid: plan.mid || 'house', lift: !!plan.lift,
        // in the order you meet them, which a sort by distance cannot promise when
        // the island happens to straddle the start line
        ids,
      });

      /* Claimed, with room either side, so the next split on the lap goes and
         finds its own bend instead of growing out of this one. */
      for (let k = -10; k < len + 10; k++) taken.add((i0 + k + M * 4) % M);
    }
  }

  /* ---- and the ground gets out of the way --------------------------------
     Sections that drop the road - a shelf, the low lane of a tilted split, the
     dip into water - leave it below the field it was cut into, and a road under
     the field is a road you cannot see. Rather than have every one of them
     remember to dig its own hollow, one pass at the end looks at where the road
     actually ended up and takes the ground down to meet it wherever it has to.
  -------------------------------------------------------------------------- */
  for (let i = 0; i < M; i += 2) {
    const a = out[i];
    // the lowest point across the width of it: the camber pivots on the inside
    // edge, so that is a.p.y, and a tilted split takes one lane below even that
    const low = a.p.y - (a.splitLift || 0);
    for (const sgn of [1, -1]) {
      const e = a.p.clone().addScaledVector(a.n, sgn * (a.w + KERB * 2));
      const g = hill(e.x, e.z);
      if (g <= low - 0.6) continue;
      basins.push({ x: e.x, z: e.z, r: a.w * 1.6, drop: g - low + 1.8 });
    }
  }

  // the sections have all had their say; take the steps out of what they did
  smoothW();
  {
    const y0 = out.map(a => a.p.y), m = out.length;
    for (let i = 0; i < m; i++) {
      // never across a hole: the two lips of a chasm are meant to be a step
      if (out[i].gap || out[(i + 1) % m].gap || out[(i - 1 + m) % m].gap) continue;
      out[i].p.y = (y0[(i - 1 + m) % m] + y0[i] * 2 + y0[(i + 1) % m]) / 4;
    }
  }

  return { samples: out, length: s, ramps, features, splits };
}

/* ---- put it together ----------------------------------------------------- */
export function buildTrack(scene, seed, themeId) {
  const th = themeById(themeId);
  const R = rulesOf(th);
  const LOOK = lookOf(th);
  const { samples, length, ramps, features, splits } = sampleLoop(seed, th);
  const N = samples.length;
  /* The camber pivots on the inside edge rather than the middle of the road.
     Tilting about the middle drops the inside edge below the field it is cut
     into, which buries the road under the ground mesh and puts a kart under the
     grass. Lifting the whole road by the amount the low side would have dropped
     keeps it on top of the world and only ever raises the outside. */
  const lift = a => a.w * Math.abs(a.bank);
  // a ramp only covers its own half, rising from the middle of the road to the
  // edge, so how much of it you get depends on how far across you are
  const rampAt = (a, lat) => (a.ramp ? a.ramp * Math.max(0, Math.min(1, (lat * a.rampSide) / a.w)) : 0);
  /* One lane of a split higher than the other. Ramped across the island rather
     than stepped at the centreline: the middle of a split is not road, so the
     surface only has to be continuous out where it is. */
  const tiltAt = (a, lat) => (a.splitLift && a.island
    ? a.splitLift * Math.max(-1, Math.min(1, lat / a.island)) : 0);
  const surf = (a, lat) => a.p.y + lat * a.bank + lift(a) + rampAt(a, lat) + tiltAt(a, lat);
  const group = new THREE.Group();
  scene.add(group);

  /* the ground, with a hill field under it */
  const gseg = 60, gspan = 900;
  const gg = new THREE.PlaneGeometry(gspan, gspan, gseg, gseg);
  gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    // the rim of hills the course sits in is part of groundY
    gp.setY(i, groundY(x, z));
  }
  gg.computeVertexNormals();
  /* Patches, at the scale you actually see from a car. The texture's own
     detail is a few centimetres across and at thirty metres it has averaged
     away to one flat colour, so the field read as a painted board. A slow
     pattern baked into the vertices - lighter and darker by a seventh either
     way, and a little drier in places - gives it the variation a real field
     has from a distance. Fixed, not random, so every visit looks the same. */
  const gcol = new Float32Array(gp.count * 3);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const n = 0.5 * Math.sin(x * 0.021 + 1.3) * Math.sin(z * 0.017 - 0.4)
            + 0.3 * Math.sin(x * 0.047 - z * 0.039 + 2.1)
            + 0.2 * Math.sin(x * 0.09 + z * 0.071 + 0.7);
    const dry = Math.max(0, Math.sin(x * 0.013 - z * 0.019 + 0.9) * Math.sin(z * 0.031 + 1.7));
    const lit = 0.92 + 0.14 * n;
    gcol[i * 3] = lit * (1 + 0.1 * dry);
    gcol[i * 3 + 1] = lit * (1 + 0.02 * dry);
    gcol[i * 3 + 2] = lit * (1 - 0.14 * dry);
  }
  gg.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ map: grassTex(th), roughness: 1, vertexColors: true }));
  ground.receiveShadow = true;
  group.add(ground);

  /* the road ribbon */
  const pos = [], uv = [], idx = [];
  const kpos = [], kuv = [], kidx = [];
  for (let i = 0; i < N; i++) {
    const a = samples[i];
    const l = a.p.clone().addScaledVector(a.n, a.w);
    const c = a.p.clone();
    const r = a.p.clone().addScaledVector(a.n, -a.w);
    // three across, not two: a ramp covers one half of the road, so the middle
    // of it has to be a vertex of its own or the rise is smeared over the lot
    l.y = surf(a, a.w); c.y = surf(a, 0); r.y = surf(a, -a.w);
    pos.push(l.x, l.y + 0.06, l.z, c.x, c.y + 0.06, c.z, r.x, r.y + 0.06, r.z);
    uv.push(0, a.s / 9, 0.5, a.s / 9, 1, a.s / 9);
    // The kerb is the outer strip of the road now, not a verge outside it, so it
    // lies on the tarmac and leans with it.
    const lo = a.p.clone().addScaledVector(a.n, a.w - KERB).setY(surf(a, a.w - KERB));
    const ro = a.p.clone().addScaledVector(a.n, -(a.w - KERB)).setY(surf(a, -(a.w - KERB)));
    kpos.push(l.x, l.y + 0.07, l.z, lo.x, lo.y + 0.07, lo.z, r.x, r.y + 0.07, r.z, ro.x, ro.y + 0.07, ro.z);
    kuv.push(0, a.s / 3.2, 1, a.s / 3.2, 0, a.s / 3.2, 1, a.s / 3.2);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    /* Where there is no road there is no road. A gap is a hole in the ribbon
       rather than a stretch of invisible tarmac, so what is under it is the
       field, a long way down, and the physics and the eye agree about that. */
    if (samples[i].gap || samples[j].gap) continue;
    const a = i * 3, b = a + 1, c = a + 2;
    const e = j * 3, f = e + 1, g = e + 2;
    idx.push(a, e, b, b, e, f);            // left half
    idx.push(b, f, c, c, f, g);            // right half
    const ka = i * 4, kb = ka + 1, kc = ka + 2, kd = ka + 3;
    const ja = j * 4, jb = ja + 1, jc = ja + 2, jd = ja + 3;
    kidx.push(ka, kb, ja, kb, jb, ja);            // left kerb, facing up
    kidx.push(kc, jc, kd, kd, jc, jd);            // right kerb, facing up
    void 0;
  }
  const road = new THREE.Mesh(
    ribbon(pos, uv, idx),
    (() => {
      const t = tarmacTex(th);
      // roughness 1 because the gloss map carries it: 214 of 255 is the 0.84 it was
      return new THREE.MeshStandardMaterial({
        map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.85, 0.85),
        roughnessMap: t.rough, roughness: 1, metalness: 0.02,
      });
    })()
  );
  road.name = 'road';
  road.receiveShadow = true;
  group.add(road);

  const kerbTex = canvasTex(64, 64, (g, W, H) => {
    g.fillStyle = th.kerbA; g.fillRect(0, 0, W, H);
    g.fillStyle = th.kerbB; g.fillRect(0, 0, W, H / 2);
  }, [1, 1]);
  /* After dark the kerb makes its own light. It is the one thing on a night
     circuit that has to be legible at a distance, because it is the only thing
     telling you where the road stops. */
  const kerbMat = () => new THREE.MeshStandardMaterial({
    map: kerbTex, roughness: 0.7,
    emissive: th.glow ? new THREE.Color(th.kerbB) : 0x000000,
    emissiveMap: th.glow ? kerbTex : null,
    emissiveIntensity: th.glow || 0,
  });
  const kerb = new THREE.Mesh(ribbon(kpos, kuv, kidx), kerbMat());
  kerb.name = 'road-kerb';
  kerb.receiveShadow = true;
  group.add(kerb);

  /* the start line, and an arch over it */
  const startTex = canvasTex(128, 128, (g, W, H) => {
    const s = W / 8;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      g.fillStyle = ((x / s + y / s) | 0) % 2 ? '#17223b' : '#fff6e2';
      g.fillRect(x, y, s, s);
    }
  }, [1, 1]);
  const s0 = samples[0];
  const line = new THREE.Mesh(new THREE.PlaneGeometry(s0.w * 2, 4.5),
    new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.8 }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -Math.atan2(s0.t.z, s0.t.x) + Math.PI / 2;
  line.position.copy(s0.p).setY(s0.p.y + 0.09);
  group.add(line);

  const inkMat = new THREE.MeshStandardMaterial({ color: 0x17223b, roughness: 0.6 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd233, roughness: 0.55 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.1, 9, 1.1), inkMat);
    post.position.copy(s0.p).addScaledVector(s0.n, side * (s0.w + 2.2)).setY(s0.p.y + 4.5);
    post.castShadow = true;
    group.add(post);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(s0.w * 2 + 5, 2.6, 0.6), goldMat);
  banner.position.copy(s0.p).setY(s0.p.y + 8.2);
  // across the road between the two posts, not lying along it: the box is long
  // on its own x, so that has to end up pointing down the normal
  banner.rotation.y = Math.atan2(s0.t.x, s0.t.z);
  banner.castShadow = true;
  group.add(banner);

  /* the edge of the circuit is a run of barrier models now, placed in props.js
     against the wall line this returns as `shoulder` */
  const m4 = new THREE.Matrix4();

  /* trees and hills for the middle distance */
  const trunkMat = new THREE.MeshStandardMaterial({ color: th.trunk, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: th.leaf, roughness: 1, flatShading: true });
  const trunks = [], leaves = [];
  // the trees get their own stream, started from the lap's seed so a new circuit
  // gets a new wood rather than the same one draped over it
  let tseed = (seed | 0) * 7 + 7;
  const rnd = () => { tseed = (tseed * 1103515245 + 12345) & 0x7fffffff; return tseed / 0x7fffffff; };
  for (let k = 0; k < th.treeCount; k++) {
    const a = rnd() * Math.PI * 2, d = 150 + rnd() * 260;
    const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.8;
    // keep the trees clear of the tarmac
    let near = 1e9;
    for (let i = 0; i < N; i += 3) {
      const dx = samples[i].p.x - x, dz = samples[i].p.z - z;
      near = Math.min(near, dx * dx + dz * dz);
    }
    if (near < 400) continue;
    const y = groundY(x, z);
    const h = 5 + rnd() * 5;
    trunks.push({ x, y, z, h });
    leaves.push({ x, y: y + h * 0.78, z, r: 2.6 + rnd() * 1.8 });
  }
  const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.55, 1, 6), trunkMat, trunks.length);
  const lm = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2.1, 7), leafMat, leaves.length);
  const sc = new THREE.Vector3(), q = new THREE.Quaternion(), pv = new THREE.Vector3();
  trunks.forEach((t, k) => { pv.set(t.x, t.y + t.h / 2, t.z); sc.set(1, t.h, 1); m4.compose(pv, q, sc); tm.setMatrixAt(k, m4); });
  leaves.forEach((l, k) => { pv.set(l.x, l.y + l.r, l.z); sc.set(l.r, l.r, l.r); m4.compose(pv, q, sc); lm.setMatrixAt(k, m4); });
  tm.instanceMatrix.needsUpdate = true; lm.instanceMatrix.needsUpdate = true;
  /* Trees do not cast. There are four hundred of them, they stand well off the
     road, and every one is a draw into the shadow map for a shadow that lands
     in a field nobody drives on. They still receive, so they are not flat. */
  tm.castShadow = lm.castShadow = false;
  tm.receiveShadow = lm.receiveShadow = true;
  tm.frustumCulled = lm.frustumCulled = false;
  group.add(tm); group.add(lm);

  /* ---- the horizon -------------------------------------------------------
     The course sits in a bowl and the rim of that bowl used to be a smooth
     green berm the whole way round: from the road it reads as a wall rather
     than as country, and it is the single biggest thing between this and
     looking like somewhere. So the rim gets a ridgeline standing on it, in
     whatever this place is made of - hills, buttes, mountains, towers, cinder
     cones - in two rings at different distances.

     The fog does the work. The near ring is close enough to keep some of its
     own colour and the far ring is most of the way to the sky already, which
     is the whole of why a horizon reads as far away. Two instanced meshes for
     the lot of them, no shadows: a shadow map draw for a mountain four hundred
     metres away is a shadow nobody will ever be standing in.
  -------------------------------------------------------------------------- */
  if (th.skyline) {
    const S = th.skyline;
    const GEO = {
      hill: () => new THREE.ConeGeometry(1, 1, 9),
      mesa: () => new THREE.CylinderGeometry(0.66, 1, 1, 6),
      peak: () => new THREE.ConeGeometry(1, 1, 5),
      tower: () => new THREE.BoxGeometry(1, 1, 1),
      volcano: () => new THREE.CylinderGeometry(0.24, 1, 1, 7),
    };
    const make = GEO[S.kind] || GEO.hill;
    // the geometry is built standing on the ground rather than centred on it,
    // so a height is a height and not half of one
    const lift = g => { g.translate(0, 0.5, 0); return g; };
    for (const [ring, colour, r0, r1] of [['near', S.near, 318, 372], ['far', S.far, 396, 452]]) {
      const spots = [];
      const n = ring === 'far' ? Math.round(S.n * 0.8) : S.n;
      for (let k = 0; k < n; k++) {
        // evenly round, then jittered, so it is a ridge and not a fence
        const ang = (k / n) * Math.PI * 2 + (rnd() - 0.5) * (Math.PI * 2 / n) * 0.9;
        const d = r0 + rnd() * (r1 - r0);
        const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
        const w = S.w[0] + rnd() * (S.w[1] - S.w[0]);
        const h = (S.h[0] + rnd() * (S.h[1] - S.h[0])) * (ring === 'far' ? 0.86 : 1);
        // sunk a little, so the base is never a visible seam on the rim
        spots.push({ x, y: groundY(x, z) - h * 0.06, z, w, h, ry: rnd() * Math.PI * 2 });
      }
      const geo = lift(make());
      const mat = new THREE.MeshLambertMaterial({ color: colour, flatShading: true });
      /* A city at night is windows. Without them the towers are black slabs cut
         out of the sky, which is a skyline in silhouette rather than a place
         with anybody in it. One sheet of lit squares, most of them out, tiled
         up each face: it lights nothing and costs one texture. */
      if (S.kind === 'tower') {
        const lit = canvasTex(64, 128, (g, W, H) => {
          g.fillStyle = '#000';
          g.fillRect(0, 0, W, H);
          for (let row = 0; row < 16; row++) {
            for (let col = 0; col < 4; col++) {
              if (rnd() > 0.42) continue;
              g.fillStyle = rnd() < 0.24 ? '#ffd9a0' : '#cfe6ff';
              g.fillRect(6 + col * 14, 4 + row * 8, 7, 4);
            }
          }
        }, [2, ring === 'far' ? 5 : 4]);
        mat.emissive = new THREE.Color(0xffffff);
        mat.emissiveMap = lit;
        mat.emissiveIntensity = ring === 'far' ? 0.5 : 0.85;
      }
      const im = new THREE.InstancedMesh(geo, mat, spots.length);
      const e2 = new THREE.Euler(), q2 = new THREE.Quaternion(), s2 = new THREE.Vector3(), p2 = new THREE.Vector3();
      spots.forEach((sp, k) => {
        e2.set(0, sp.ry, 0);
        q2.setFromEuler(e2);
        p2.set(sp.x, sp.y, sp.z);
        s2.set(sp.w, sp.h, sp.w * (S.kind === 'tower' ? 0.8 : 1));
        m4.compose(p2, q2, s2);
        im.setMatrixAt(k, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false;
      im.receiveShadow = false;
      im.frustumCulled = false;
      group.add(im);
    }
  }

  /* the stands, the barriers and the rest of the furniture are real models now,
     and they live in props.js */

  /* Many of one thing, drawn once. Every repeated piece of a section - the
     piers under a bridge, the lamps in a tunnel, the rocks of the mountain a
     cave is bored through, the lit rings of a pipe - used to be its own mesh,
     and on Redrock Dunes that was a hundred extra draw calls for one tunnel. */
  function many(geo, mat, spots) {
    if (!spots.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const e = new THREE.Euler(), sc = new THREE.Vector3();
    spots.forEach((sp, i) => {
      e.set(sp.rx || 0, sp.ry || 0, sp.rz || 0, sp.order || 'XYZ');
      q.setFromEuler(e);
      sc.set(sp.sx === undefined ? 1 : sp.sx, sp.sy === undefined ? 1 : sp.sy,
             sp.sz === undefined ? 1 : sp.sz);
      m.compose(sp.p, q, sc);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
    return im;
  }

  /* ---- the bridge, the tunnel and the water, built ------------------------ */
  for (const f of features) {
    const ids = f.ids;

    if (f.kind === 'bridge') {
      /* A deck under the road and piers down to whatever the ground is doing.
         What it is made of is the circuit's: stone on Sunfield Loop, planks and
         rope at Redrock Dunes, an ice arch at Glacier Pass, a lit skyway at
         Neon Mile, black columns at Ember Hollow. */
      const L = LOOK.bridge;
      const deckMat = new THREE.MeshStandardMaterial({
        color: L.deck, roughness: L.kind === 'ice' ? 0.12 : 0.9,
        metalness: L.kind === 'skyway' ? 0.35 : 0,
        transparent: L.kind === 'ice', opacity: L.kind === 'ice' ? 0.82 : 1,
      });
      const pierMat = new THREE.MeshStandardMaterial({ color: L.pier, roughness: 0.95 });
      const dp = [], du = [], di = [];
      ids.forEach((i, k) => {
        const a = samples[i];
        const l = a.p.clone().addScaledVector(a.n, a.w + KERB);
        const r = a.p.clone().addScaledVector(a.n, -(a.w + KERB));
        dp.push(l.x, l.y - 0.85, l.z, r.x, r.y - 0.85, r.z);
        du.push(0, k, 1, k);
      });
      for (let k = 0; k < ids.length - 1; k++) {
        const aa = k * 2, bb = aa + 1, cc = aa + 2, dd = aa + 3;
        di.push(aa, bb, cc, bb, dd, cc);
      }
      const deck = new THREE.Mesh(ribbon(dp, du, di), deckMat);
      deck.name = 'road-deck';
      deck.receiveShadow = true;
      group.add(deck);

      // a lit strip down each edge where the circuit races at night
      if (L.edge) {
        const glow = new THREE.MeshBasicMaterial({ color: L.edge });
        for (const side of [1, -1]) {
          const ep = [], eu = [], ei = [];
          ids.forEach((i, k) => {
            const a = samples[i];
            const o = a.p.clone().addScaledVector(a.n, side * (a.w + KERB));
            ep.push(o.x, o.y - 0.5, o.z, o.x, o.y - 0.95, o.z);
            eu.push(0, k, 1, k);
          });
          for (let k = 0; k < ids.length - 1; k++) {
            const aa = k * 2, bb = aa + 1, cc = aa + 2, dd = aa + 3;
            ei.push(aa, bb, cc, bb, dd, cc);
          }
          const strip = new THREE.Mesh(ribbon(ep, eu, ei), glow);
          strip.name = 'road-edge';
          strip.material.side = THREE.DoubleSide;
          group.add(strip);
        }
      }

      const every = L.kind === 'rope' ? 3 : 5;
      const piers = [], posts = [];
      for (let k = 2; k < ids.length - 2; k += every) {
        const a = samples[ids[k]];
        for (const side of [1, -1]) {
          const top = a.p.clone().addScaledVector(a.n, side * a.w * 0.78);
          const foot = groundY(top.x, top.z);
          const h = Math.max(1, top.y - 0.85 - foot);
          if (L.kind === 'rope') {
            // posts up from the deck rather than piers down to the ground: a
            // rope bridge hangs, it does not stand on anything
            posts.push({ p: new THREE.Vector3(top.x, top.y + 0.2, top.z) });
          } else {
            // one box, scaled: a pier is only ever a box of a different height
            piers.push({ p: new THREE.Vector3(top.x, foot + h / 2, top.z), sy: h });
          }
        }
      }
      many(new THREE.CylinderGeometry(0.22, 0.26, 2.2, 7), pierMat, posts);
      many(new THREE.BoxGeometry(1.5, 1, 1.5), pierMat, piers);
      // and the ropes themselves, slung between the posts
      if (L.kind === 'rope') {
        const ropeMat = new THREE.MeshStandardMaterial({ color: L.rope, roughness: 1 });
        for (const side of [1, -1]) {
          for (const hgt of [1.25, 0.55]) {
            const rp = [], ru = [], ri = [];
            ids.forEach((i, k) => {
              const a = samples[i];
              const o = a.p.clone().addScaledVector(a.n, side * a.w * 0.78);
              // a sag between the posts, which is what makes it read as rope
              const sag = Math.sin((k % 6) / 6 * Math.PI) * 0.22;
              rp.push(o.x, o.y + hgt - sag, o.z, o.x, o.y + hgt - sag - 0.1, o.z);
              ru.push(0, k, 1, k);
            });
            for (let k = 0; k < ids.length - 1; k++) {
              const aa = k * 2, bb = aa + 1, cc = aa + 2, dd = aa + 3;
              ri.push(aa, bb, cc, bb, dd, cc);
            }
            const rope = new THREE.Mesh(ribbon(rp, ru, ri), ropeMat);
            rope.material.side = THREE.DoubleSide;
            group.add(rope);
          }
        }
      }
    }

    if (f.kind === 'tunnel') {
      /* A half pipe over the road, wide enough to clear the kerbs and low
         enough to feel like a tunnel. A cave is the same tube with its radius
         knocked about so no two rings match, and with a mountain built over it
         so it is bored through something rather than laid on the ground. */
      const L = LOOK.tunnel;
      const cave = L.kind === 'cave' || L.kind === 'lavatube';
      const R = [], RU = [], RI = [], RINGS = cave ? 11 : 9;
      let wob = (f.i0 * 2654435761) & 0x7fffffff;
      const wr = () => { wob = (wob * 1103515245 + 12345) & 0x7fffffff; return wob / 0x7fffffff; };
      ids.forEach((i, k) => {
        const a = samples[i];
        const rad = a.w + KERB;
        for (let j = 0; j <= RINGS; j++) {
          const ang = Math.PI * (j / RINGS);
          // rock is not a half pipe: the radius wanders, but it never comes in
          // far enough to touch the road
          /* It wanders, but never in past the road. The wander is a fraction of
             the bore, and the bore is the road plus a kerb: on a narrow road a
             tenth of that is well clear of the tarmac, and on a wide one it is
             less than the kerb, so the wall came in over the road itself. The
             floor is worked out from the width rather than guessed at. */
          const minK = (a.w + 0.9) / rad;
          const knock = cave ? Math.max(minK, 1 + (wr() - 0.35) * 0.3) : 1;
          const lat = Math.cos(ang) * rad * knock;
          const p = a.p.clone().addScaledVector(a.n, lat);
          /* Stood on the road rather than on the centreline's height. A banked
             corner raises its outside edge by the better part of a metre and
             the tube was built level, so the road climbed towards a wall that
             had not moved and the rock came down to head height on the outside
             of every banked bend. Reading the surface at the point the wall
             meets it rolls the whole tube with the track, which is also what a
             banked tunnel ought to look like. */
          R.push(p.x, surf(a, lat) + Math.sin(ang) * rad * 0.58 * knock - 0.2, p.z);
          RU.push(j / RINGS, k * 0.5);
        }
      });
      for (let k = 0; k < ids.length - 1; k++) {
        for (let j = 0; j < RINGS; j++) {
          const aa = k * (RINGS + 1) + j, bb = aa + 1;
          const cc = (k + 1) * (RINGS + 1) + j, dd = cc + 1;
          RI.push(aa, bb, cc, bb, dd, cc);
        }
      }
      const tubeMat = new THREE.MeshStandardMaterial({
        color: L.colour, roughness: L.rough, side: THREE.DoubleSide, flatShading: cave,
        metalness: L.kind === 'pipe' ? 0.45 : 0,
        transparent: L.clear !== undefined, opacity: L.clear === undefined ? 1 : L.clear,
        emissive: L.crack ? new THREE.Color(L.crack) : 0x000000,
        emissiveIntensity: L.crack ? 0.22 : 0,
      });
      const tube = new THREE.Mesh(ribbon(R, RU, RI), tubeMat);
      tube.name = 'tunnel-bore';
      tube.castShadow = true; tube.receiveShadow = true;
      group.add(tube);

      /* And the mountain it is bored through. Without this a cave is a tube
         lying on a field, which is a pipe: the point of a cave is that there is
         a hill and the road goes into it. */
      if (L.mount !== undefined) {
        /* Built as a shell round the bore, not a lump on top of it. Dropped on
           the road as one mass the first version simply filled the mouth in:
           every rock here is pushed out far enough that its near face clears
           the tube, so what you drive at is a hole in a hill. */
        const mat = new THREE.MeshStandardMaterial({ color: L.mount, roughness: 1, flatShading: true });
        const rocks = [];
        for (let k = 0; k < ids.length; k += 3) {
          const a = samples[ids[k]];
          const t = k / (ids.length - 1);
          // the hill grows out of the ground at both ends and is highest in the
          // middle, so the road goes into something rather than under a slab
          const big = 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
          const bore = a.w + KERB;
          const r = bore * 0.95 * big;
          /* Every one of these is pushed out far enough that its NEAR face
             clears the bore. At a shorter offset the rock's centre is outside
             the tunnel but half of it is inside, which is a boulder in the
             middle of the road you cannot see past. */
          /* Far enough out that the rock's NEAR face clears the bore, worked
             from the size it is actually drawn at. It was pushed out by 1.08
             of its radius and then instanced at 1.25 of it, so the last 0.17
             hung inside the tunnel - on a narrow road that is under the kerb
             and invisible, and on a wide one it is a boulder in the middle of
             the road you cannot see past. Which is what made this come and go.

             The bore is an ellipse, wider than it is tall, so how far out is
             far enough depends on which way the rock sits from the middle of
             it. This asks the ellipse. */
          const reach = r * 1.25 + 0.6;          // the rock, plus room to spare
          const hx = bore * 1.2, hy = bore * 0.58 * 1.2;   // the bore at its widest wander
          const out = (dx, dy) => {
            const d = Math.hypot(dx, dy) || 1;
            const ux = dx / d, uy = dy / d;
            // where the ray leaves the ellipse
            const t = 1 / Math.sqrt((ux * ux) / (hx * hx) + (uy * uy) / (hy * hy));
            return { x: ux * (t + reach), y: uy * (t + reach) };
          };
          const spots = [
            out(1, 0.08),
            out(-1, 0.08),
            out(0, 1),
            out(0.82, 0.72),
            out(-0.82, 0.72),
          ];
          for (const sp of spots) {
            const at = a.p.clone().addScaledVector(a.n, sp.x);
            rocks.push({
              p: new THREE.Vector3(at.x, a.p.y + sp.y - 0.4, at.z),
              rx: wr() * 3, ry: wr() * 3, rz: wr() * 3,
              sx: r * 1.25, sy: r * 0.95, sz: r * 1.25,
            });
          }
        }
        // one rock, however many of it the hill is made of
        const hill = many(new THREE.DodecahedronGeometry(1, 0), mat, rocks);
        if (hill) hill.name = 'tunnel-hill';
      }

      const lampMat = new THREE.MeshStandardMaterial({
        color: 0xfff6e2, emissive: L.lamp, emissiveIntensity: 1.2,
      });
      const lamps = [];
      for (let k = 2; k < ids.length - 2; k += 4) {
        const a = samples[ids[k]];
        lamps.push({
          p: new THREE.Vector3(a.p.x, a.p.y + (a.w + KERB) * 0.58 - 0.65, a.p.z),
          ry: Math.atan2(a.t.x, a.t.z), sx: a.w * 0.5,
        });
      }
      many(new THREE.BoxGeometry(1, 0.25, 1.1), lampMat, lamps);
      // a lit ring every few metres, which is what makes a pipe a pipe
      /* Cracks, for a tube bored through rock that is still cooling. Thin lit
         bands round the inside, which is the one thing that tells you a black
         tunnel on a black circuit is there at all. */
      /* How wide a squashed ring has to be to miss the road. The floor used to
         be set on the ring's widest point, which is level with the road and so
         the easy case; a ring is an ellipse, and by the height a driver's head
         is it has already curved back in. At a bore of ten metres that is most
         of a metre of glowing rock inside the lane, which is why a wide tunnel
         looked blocked and a narrow one did not. Ask the ellipse instead: given
         the road half-width, how tall the ring is against how wide, and how
         thick its tube, what radius clears the road at head height. */
      const HEAD = 1.9;               // over a driver, not level with one
      const ROLL = 0.15;              // how far a crack is allowed to lie over
      const boreRad = (w, squash, tube, roll) => {
        const k = 1 - tube;           // the inner face of the tube
        const want = w + 0.6;         // the road, and a little daylight
        /* A roll of a tenth of a radian sounds like nothing and is nothing in
           the middle of the road, but out at the kerb it is eight metres of
           lever and drops the ring over a metre. Ask for that much more height
           than a driver needs, so a rolled ring still clears one. */
        const head = HEAD + (roll || 0) * want;
        return Math.sqrt(want * want + Math.pow(head / squash, 2)) / k;
      };

      if (L.crack !== undefined) {
        const crackMat = new THREE.MeshBasicMaterial({ color: L.crack, side: THREE.DoubleSide });
        const cracks = [];
        for (let k = 1; k < ids.length - 1; k += 2) {
          const a = samples[ids[k]];
          // on the wall, not across the road
          const rad = Math.max(boreRad(a.w, 0.62, 0.06, ROLL),
                               (a.w + KERB) * (0.86 + wr() * 0.1));
          cracks.push({
            p: new THREE.Vector3(a.p.x, surf(a, 0) - 0.2, a.p.z),
            /* Rolled a little, not spun. The arc starts at the wall and climbs;
               rolled a whole radian or two its lower end swings off the wall and
               sweeps down across the road, which on a wide stretch is a glowing
               band through the lane at head height. A tenth of a turn either way
               keeps every crack on the rock and still makes no two alike, and
               the sign of the scale decides which wall it is on. */
            ry: Math.atan2(a.n.x, a.n.z) + Math.PI / 2,
            rz: a.bank + (wr() - 0.5) * 2 * ROLL, order: 'YZX',
            sx: rad * (wr() < 0.5 ? 1 : -1), sy: rad * 0.62, sz: rad,
          });
        }
        // one arc of a torus, at whatever radius each crack wants
        many(new THREE.TorusGeometry(1, 0.06, 4, 10, 1.4), crackMat, cracks);
      }
      if (L.ring !== undefined) {
        const ringMat = new THREE.MeshBasicMaterial({ color: L.ring, side: THREE.DoubleSide });
        const rings = [];
        for (let k = 1; k < ids.length - 1; k += 3) {
          const a = samples[ids[k]];
          // and the same for the lit rings of a pipe, for the same reason
          const rad = Math.max(boreRad(a.w, 0.7, 0.05), (a.w + KERB) * 0.82);
          rings.push({
            p: new THREE.Vector3(a.p.x, surf(a, 0) - 0.2, a.p.z),
            ry: Math.atan2(a.n.x, a.n.z) + Math.PI / 2,
            rz: a.bank, order: 'YZX',
            sx: rad, sy: rad * 0.7, sz: rad,
          });
        }
        many(new THREE.TorusGeometry(1, 0.05, 5, 18, Math.PI), ringMat, rings);
      }
    }

    if (f.kind === 'water') {
      /* A sheet that follows the channel. A rectangle big enough to cover the
         dip also floods every field around it, because the ground out there is
         higher than the water.

         Frozen, it is not a sheet you sink through: it is a lid, nearly opaque
         and sitting where the road left off, and the road under it is what you
         actually drive on. */
      const L = LOOK.water;
      const wp = [], wu = [], wi = [], SPAN = 17;
      ids.forEach((i, k) => {
        const a = samples[i];
        const l = a.p.clone().addScaledVector(a.n, a.w + SPAN);
        const r = a.p.clone().addScaledVector(a.n, -(a.w + SPAN));
        wp.push(l.x, f.surfaceY, l.z, r.x, f.surfaceY, r.z);
        wu.push(0, k * 0.35, 1, k * 0.35);
      });
      for (let k = 0; k < ids.length - 1; k++) {
        const aa = k * 2, bb = aa + 1, cc = aa + 2, dd = aa + 3;
        wi.push(aa, cc, bb, bb, cc, dd);
      }
      const sheet = new THREE.Mesh(ribbon(wp, wu, wi), new THREE.MeshStandardMaterial({
        color: L.colour, roughness: L.rough, metalness: L.kind === 'frozen' ? 0.05 : 0.15,
        transparent: true, opacity: L.opacity, depthWrite: false, side: THREE.DoubleSide,
        emissive: L.glow ? new THREE.Color(L.glow) : 0x000000,
        emissiveIntensity: L.glow ? 0.5 : 0,
      }));
      sheet.name = 'water-sheet';       // you drive through it, it is not in the way
      sheet.renderOrder = 2;
      group.add(sheet);
    }
  }

  /* ---- what this place has that the others do not ------------------------ */
  const ice = [], lava = [];
  {
    let ss = ((seed | 0) * 13 + 5) & 0x7fffffff;
    const rr = () => { ss = (ss * 1103515245 + 12345) & 0x7fffffff; return ss / 0x7fffffff; };

    if (th.signature === 'ice') {
      // Patches on the tarmac rather than beside it: the line matters, and you
      // can see them coming if you are looking far enough ahead.
      const mat = new THREE.MeshStandardMaterial({
        color: 0xdff2ff, roughness: 0.06, metalness: 0.25,
        transparent: true, opacity: 0.78, depthWrite: false,
      });
      const geo = new THREE.CircleGeometry(1, 12);
      geo.rotateX(-Math.PI / 2);
      const im = new THREE.InstancedMesh(geo, mat, 34);
      im.frustumCulled = false; im.renderOrder = 1; im.name = 'ice';
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      for (let k = 0; k < 34; k++) {
        const a = samples[Math.floor(rr() * N)];
        const lat = (rr() * 1.4 - 0.7) * a.w;
        const p = a.p.clone().addScaledVector(a.n, lat);
        const r = 2.6 + rr() * 3.4;
        sc.set(r, 1, r * (0.7 + rr() * 0.6));
        m.compose(new THREE.Vector3(p.x, surf(a, lat) + 0.09, p.z), q, sc);
        im.setMatrixAt(k, m);
        ice.push({ x: p.x, z: p.z, r: r * 0.9 });
      }
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
    }

    if (th.signature === 'lava') {
      // Off the racing line, glowing, and it throws you if you put a wheel in it.
      const mat = new THREE.MeshStandardMaterial({
        color: 0xff7a1a, emissive: 0xff4a10, emissiveIntensity: 1.35, roughness: 0.55,
      });
      const geo = new THREE.CircleGeometry(1, 14);
      geo.rotateX(-Math.PI / 2);
      const im = new THREE.InstancedMesh(geo, mat, 26);
      im.frustumCulled = false; im.name = 'lava';
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      for (let k = 0; k < 26; k++) {
        const a = samples[Math.floor(rr() * N)];
        const side = rr() < 0.5 ? 1 : -1;
        const p = a.p.clone().addScaledVector(a.n, side * (a.w + 5 + rr() * 16));
        const r = 3.5 + rr() * 5;
        sc.set(r, 1, r);
        m.compose(new THREE.Vector3(p.x, groundY(p.x, p.z) + 0.12, p.z), q, sc);
        im.setMatrixAt(k, m);
        lava.push({ x: p.x, z: p.z, r: r * 0.85 });
      }
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
    }

    if (th.signature === 'towers') {
      // A city either side of the road, close enough to feel like walls, with
      // windows lit at the height a window is lit.
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3150, roughness: 0.85 });
      const litMat = new THREE.MeshStandardMaterial({
        color: 0x0f1428, emissive: 0x39d0ff, emissiveIntensity: 0.55, roughness: 0.4,
      });
      const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, 120);
      const glow = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), litMat, 120);
      body.frustumCulled = glow.frustumCulled = false;
      body.name = glow.name = 'towers';
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
      for (let k = 0; k < 120; k++) {
        const a = samples[Math.floor(rr() * N)];
        const side = rr() < 0.5 ? 1 : -1;
        const w = 7 + rr() * 11, h = 16 + rr() * 54;
        /* Cleared by its own half-width. Nine metres out reads as plenty until
           you notice the widest of these is eighteen across, so its near face
           came back to the kerb and a tower stood on the edge of the road. */
        const off = a.w + 2 + w / 2 + rr() * 34;
        const p = a.p.clone().addScaledVector(a.n, side * off);
        const foot = groundY(p.x, p.z);
        e.set(0, Math.atan2(a.t.x, a.t.z), 0); q.setFromEuler(e);
        sc.set(w, h, w * (0.7 + rr() * 0.6));
        m.compose(new THREE.Vector3(p.x, foot + h / 2, p.z), q, sc);
        body.setMatrixAt(k, m);
        sc.set(w * 0.82, h * 0.86, w * 0.58);
        m.compose(new THREE.Vector3(p.x, foot + h / 2, p.z), q, sc);
        glow.setMatrixAt(k, m);
      }
      body.instanceMatrix.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
      body.castShadow = true;
      group.add(body); group.add(glow);
    }

    if (th.signature === 'rocks') {
      // Boulders standing in the run off, so going wide is a decision.
      const mat = new THREE.MeshStandardMaterial({ color: 0xa8663c, roughness: 1, flatShading: true });
      const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat, 90);
      im.frustumCulled = false; im.castShadow = true; im.name = 'rocks';
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
      for (let k = 0; k < 90; k++) {
        const a = samples[Math.floor(rr() * N)];
        const side = rr() < 0.5 ? 1 : -1;
        const r = 1.6 + rr() * 4.2;
        // and the same for a boulder: four metres out, but up to six across
        const p = a.p.clone().addScaledVector(a.n, side * (a.w + 1.2 + r + rr() * 26));
        e.set(rr() * 3, rr() * 6, rr() * 3); q.setFromEuler(e);
        sc.set(r, r * (0.7 + rr() * 0.7), r);
        m.compose(new THREE.Vector3(p.x, groundY(p.x, p.z) + r * 0.45, p.z), q, sc);
        im.setMatrixAt(k, m);
      }
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
    }
  }

  /* ---- the island, and the house standing on it -------------------------- */
  for (const sp of splits) {
    // the island itself: the ground of this place, laid up the middle of the
    // road with a kerb round it so it reads as something you go around
    const ip = [], iu = [], ii = [];
    const kp = [], ku = [], ki = [];
    const ids = sp.ids;
    ids.forEach((i, k) => {
      const a = samples[i], w = a.island;
      const l = a.p.clone().addScaledVector(a.n, w);
      const r = a.p.clone().addScaledVector(a.n, -w);
      ip.push(l.x, surf(a, w) + 0.22, l.z, r.x, surf(a, -w) + 0.22, r.z);
      iu.push(0, a.s / 8, 1, a.s / 8);
      // a thin kerb strip down each flank of it
      const kw = w + 0.9;
      const lk = a.p.clone().addScaledVector(a.n, kw);
      const rk = a.p.clone().addScaledVector(a.n, -kw);
      kp.push(l.x, surf(a, w) + 0.2, l.z, lk.x, surf(a, kw) + 0.07, lk.z,
              r.x, surf(a, -w) + 0.2, r.z, rk.x, surf(a, -kw) + 0.07, rk.z);
      ku.push(0, a.s / 2.6, 1, a.s / 2.6, 0, a.s / 2.6, 1, a.s / 2.6);
    });
    for (let k = 0; k < ids.length - 1; k++) {
      const aa = k * 2, bb = aa + 1, cc = aa + 2, dd = aa + 3;
      ii.push(aa, cc, bb, bb, cc, dd);
      const ka = k * 4, kb = ka + 1, kc = ka + 2, kd = ka + 3;
      const ja = (k + 1) * 4, jb = ja + 1, jc = ja + 2, jd = ja + 3;
      ki.push(ka, kb, ja, kb, jb, ja);
      ki.push(kc, jc, kd, kd, jc, jd);
    }
    if (ids.length > 1) {
      // the splitter island, which is road furniture rather than scenery
      const isle = new THREE.Mesh(ribbon(ip, iu, ii),
        new THREE.MeshStandardMaterial({ map: grassTex(th), roughness: 1 }));
      isle.name = 'road-island';
      isle.receiveShadow = true;
      group.add(isle);
      const rim = new THREE.Mesh(ribbon(kp, ku, ki), kerbMat());
      rim.name = 'road-kerb';
      rim.receiveShadow = true;
      group.add(rim);
    }

    /* Where the two lanes are at different heights, each needs something under
       its outer edge: the high one is a deck standing above the field and the
       low one is a cutting through it, and without this the first floats and
       the second is buried. */
    if (samples[sp.i].splitLift > 0.4) {
      const skirtMat = new THREE.MeshStandardMaterial({ map: kerbTex, color: 0x9a9a92, roughness: 0.95 });
      for (const side of [1, -1]) {
        const sp2 = [], su = [], si = [];
        ids.forEach((i, k) => {
          const a = samples[i];
          const o = a.p.clone().addScaledVector(a.n, side * (a.w + KERB));
          const top = surf(a, side * (a.w + KERB));
          const foot = Math.min(top - 0.4, groundY(o.x, o.z) - 0.6);
          sp2.push(o.x, top, o.z, o.x, foot, o.z);
          su.push(0, a.s / 6, 1, a.s / 6);
        });
        for (let k = 0; k < ids.length - 1; k++) {
          const aa = k * 2, bb = aa + 1, cc = aa + 2, dd = aa + 3;
          si.push(aa, bb, cc, bb, dd, cc);
        }
        const skirt = new THREE.Mesh(ribbon(sp2, su, si), skirtMat);
        skirt.name = 'road-skirt';
        skirt.material.side = THREE.DoubleSide;
        skirt.receiveShadow = true;
        group.add(skirt);
      }
    }

    const wall = new THREE.MeshStandardMaterial({ color: 0xfff6e2, roughness: 0.9 });
    const roof = new THREE.MeshStandardMaterial({ color: 0xe8402a, roughness: 0.85 });
    const ink = new THREE.MeshStandardMaterial({ color: 0x17223b, roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fd3ff, roughness: 0.25, metalness: 0.2 });
    const h = new THREE.Group();
    const r = sp.isle * 0.72;
    /* What is standing on this one. Three divides on a lap with the same
       cottage on each of them is one divide drawn three times: you cannot tell
       from the cockpit which part of the circuit you are on, which is most of
       what a landmark is for. The place says what each of its islands holds.
       A ridge holds nothing - it IS the thing, a bank of ground between two
       lanes at different heights, and putting a house on top of it would only
       hide the one part of it worth seeing. */
    const th2 = th.dress || {};
    const groundMat = new THREE.MeshStandardMaterial({ color: th.ground, roughness: 1, flatShading: true });
    const build = {
      /* a pond: a sheet of water in a dish of its own ground */
      pond() {
        const pool = new THREE.Mesh(new THREE.CircleGeometry(r * 1.15, 18),
          new THREE.MeshStandardMaterial({ color: 0x2e86c8, roughness: 0.15, metalness: 0.2,
            transparent: true, opacity: 0.72 }));
        pool.rotation.x = -Math.PI / 2; pool.position.y = 0.26; h.add(pool);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.2, r * 0.13, 5, 16), groundMat);
        rim.rotation.x = Math.PI / 2; rim.position.y = 0.14; h.add(rim);
        for (let k = 0; k < 5; k++) {
          const a2 = (k / 5) * 6.28 + 0.4;
          const reed = new THREE.Mesh(new THREE.ConeGeometry(r * 0.1, r * 0.8, 5),
            new THREE.MeshStandardMaterial({ color: 0x6ea832, roughness: 1, flatShading: true }));
          reed.position.set(Math.cos(a2) * r * 1.05, r * 0.4, Math.sin(a2) * r * 1.05);
          h.add(reed);
        }
      },
      /* a copse: a handful of conifers off the same kit the circuit uses */
      trees() {
        const bark = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
        const leaf = new THREE.MeshStandardMaterial({ color: th2.tree || 0x3f8f45, roughness: 1, flatShading: true });
        for (let k = 0; k < 5; k++) {
          const a2 = (k / 5) * 6.28, d = r * (k ? 0.7 : 0);
          const tall = r * (0.9 + (k % 3) * 0.32);
          const tr = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.09, r * 0.12, tall * 0.4, 6), bark);
          tr.position.set(Math.cos(a2) * d, tall * 0.2, Math.sin(a2) * d); h.add(tr);
          const top = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, tall, 7), leaf);
          top.position.set(Math.cos(a2) * d, tall * 0.62, Math.sin(a2) * d); h.add(top);
        }
      },
      /* a hedgerow: a long low run of it, the length of the island */
      hedge() {
        const leaf = new THREE.MeshStandardMaterial({ color: th2.tree || 0x3f8f45, roughness: 1, flatShading: true });
        const run = new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, r * 0.8, r * 5.5), leaf);
        run.position.y = r * 0.4; h.add(run);
        for (let k = -2; k <= 2; k++) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.07, r * 0.07, r * 1.1, 5),
            new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }));
          post.position.set(r * 0.62, r * 0.55, k * r * 1.2); h.add(post);
        }
      },
      /* a mesa: one big flat topped block of the country it stands in */
      mesa() {
        const rock = new THREE.MeshStandardMaterial({ color: th.ground, roughness: 1, flatShading: true });
        const b1 = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.35, r * 2.1, 7), rock);
        b1.position.y = r * 1.05; b1.rotation.y = 0.4; h.add(b1);
        const b2 = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.98, r * 0.9, 6), rock);
        b2.position.y = r * 2.4; b2.rotation.y = 1.1; h.add(b2);
      },
      /* loose rock: a few boulders, no two the same way up */
      rocks() {
        const rock = new THREE.MeshStandardMaterial({ color: th.ground, roughness: 1, flatShading: true });
        for (let k = 0; k < 4; k++) {
          const a2 = (k / 4) * 6.28 + 0.7, d = r * 0.6 * (k % 2);
          const rr = r * (0.55 + (k % 3) * 0.22);
          const b1 = new THREE.Mesh(new THREE.DodecahedronGeometry(rr, 0), rock);
          b1.position.set(Math.cos(a2) * d, rr * 0.75, Math.sin(a2) * d);
          b1.rotation.set(k * 1.1, k * 2.3, k * 0.7);
          h.add(b1);
        }
      },
      /* a mast, for a circuit that is lit rather than grown */
      tower() {
        const steel = new THREE.MeshStandardMaterial({ color: 0x39425c, roughness: 0.6, metalness: 0.3 });
        const lit = new THREE.MeshStandardMaterial({ color: 0x0f1428,
          emissive: th.look && th.look.tunnel && th.look.tunnel.lamp ? th.look.tunnel.lamp : 0x39d0ff,
          emissiveIntensity: 0.9, roughness: 0.4 });
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.3, r * 3.4, 6), steel);
        mast.position.y = r * 1.7; h.add(mast);
        for (let k = 0; k < 3; k++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r * (0.5 - k * 0.1), r * 0.06, 5, 12), lit);
          ring.rotation.x = Math.PI / 2; ring.position.y = r * (1.2 + k * 0.9); h.add(ring);
        }
        const head = new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, r * 0.3, r * 0.3), lit);
        head.position.y = r * 3.5; h.add(head);
      },
      // a bank of ground is the whole point of this one; nothing goes on it
      ridge() {},
      house() {
        const W = r * 1.5, D = r * 1.25, H = r * 0.95;
        const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wall);
        body.position.y = H / 2; h.add(body);
        // a pitched roof, which is a four sided pyramid squashed along the ridge
        const cap = new THREE.Mesh(new THREE.ConeGeometry(W * 0.78, H * 0.62, 4), roof);
        cap.position.y = H + H * 0.31;
        cap.rotation.y = Math.PI / 4;
        cap.scale.set(1, 1, D / W);
        h.add(cap);
        const door = new THREE.Mesh(new THREE.BoxGeometry(W * 0.16, H * 0.46, 0.3), ink);
        door.position.set(0, H * 0.23, D / 2 + 0.1); h.add(door);
        for (const sx of [-1, 1]) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(W * 0.17, H * 0.22, 0.25), glass);
          win.position.set(sx * W * 0.28, H * 0.58, D / 2 + 0.08); h.add(win);
        }
      },
    };
    (build[sp.mid] || build.house)();
    for (const o of h.children) { o.castShadow = true; o.receiveShadow = true; }
    h.position.set(sp.x, sp.y, sp.z);
    h.rotation.y = sp.yaw;
    group.add(h);
    // the house is on the island, so the island does the stopping, not the house
  }

  /* ---- things on the road ------------------------------------------------- */
  let bs = 991;
  const brnd = () => { bs = (bs * 1103515245 + 12345) & 0x7fffffff; return bs / 0x7fffffff; };

  const itemBoxes = [];
  // Nowhere near the ramps. A row before one is a row you are looking past, a
  // row after it is a row you fly over, and a row on it is a row you cannot
  // steer for. Boxes belong where you can actually go and get them.
  const nearRamp = i => ramps.some(r => {
    const d = Math.abs(((i - r.i + N) % N + N / 2) % N - N / 2);
    return d < 14;
  });
  // and not across the split either, where the middle of the road is an island
  // and a row of three would put the middle one inside it
  const busy = i => nearRamp(i) || (samples[i].island || 0) > 0.15;
  const ROWS = R.boxRows;
  for (let k = 0; k < ROWS; k++) {
    let i = Math.floor(((0.1 + k * (0.9 / ROWS) + brnd() * 0.04) % 1) * N);
    for (let n = 0; n < N && busy(i); n++) i = (i + 5) % N;
    const a = samples[i];
    /* Every other row has a double box in it: gold, and two items instead of
       one. Which box of the three it is walks along from row to row, so it is
       not always the same line that pays. Worked out from the row number
       rather than drawn from the circuit's random numbers, which would move
       everything placed after it on circuits whose times are on the board. */
    const dbl = k % 2 === 1 ? (k >> 1) % 3 : -1;
    [-0.55, 0, 0.55].forEach((off, j) => {
      const p = a.p.clone().addScaledVector(a.n, off * a.w);
      itemBoxes.push({ pos: p.clone().setY(surf(a, off * a.w) + 1.35), i, taken: 0, double: j === dbl });
    });
  }

  // twice as many as there were, spread round the lap and set off to one side or
  // the other so taking one is a line you have to choose rather than a gift
  const boostPads = [];
  const PADS = R.pads;
  for (let k = 0; k < PADS; k++) {
    let i = Math.floor(((0.07 + k * (0.94 / PADS) + brnd() * 0.04) % 1) * N);
    for (let n = 0; n < N && (samples[i].island || 0) > 0.15; n++) i = (i + 5) % N;
    const a = samples[i];
    const off = (brnd() * 1.1 - 0.55) * a.w;
    const p = a.p.clone().addScaledVector(a.n, off);
    boostPads.push({ pos: p.clone().setY(surf(a, off)), i, n: a.n.clone(), t: a.t.clone(), w: a.w * 0.34 });
  }
  /* A booster on the run up to every gap. A jump you have to arrive at quickly
     should hand you the speed to do it, and it turns a hole in the road from
     something that catches you out into something you aim at. */
  for (const f of features) {
    if (f.kind !== 'chasm') continue;
    const i = f.ids[Math.max(0, Math.floor(f.len * 0.3))];
    const a = samples[i];
    boostPads.push({ pos: a.p.clone().setY(surf(a, 0)), i, n: a.n.clone(), t: a.t.clone(), w: a.w * 0.9, ramp: true });
  }
  // a booster on the run up to each ramp, so you are thrown further for taking it
  for (const r of ramps) {
    const a = samples[(r.i - 3 + N) % N];
    boostPads.push({ pos: a.p.clone().setY(surf(a, 0)), i: (r.i - 3 + N) % N, n: a.n.clone(), t: a.t.clone(), w: a.w * 0.8, ramp: true });
  }

  /* ---- rails -------------------------------------------------------------
     A grind rail down the edge of a quiet stretch, twice a lap. Hop onto one
     lined up with it and the kart locks on and rides it, gaining speed, until
     it runs out or you hop off, and either way you leave it with a boost. They
     go where nothing else is - no section, no split, no ramp, no hole, not the
     start - on the straightest run of road that is left, and which side they
     are on alternates. Found by looking, not drawn from the circuit's random
     numbers, so nothing else on a pinned circuit moves for them. */
  const rails = [];
  {
    const RLEN = 34;
    const busyAt = new Uint8Array(N);
    // sections that leave the road flat and where it was are fine to run a rail beside
    const FLAT = { boostlane: 1, strip: 1, agrav: 1, arena: 1, narrows: 1, bridge: 1, tunnel: 1, water: 1 };
    for (const f of features) if (!FLAT[f.kind]) for (const i of f.ids) busyAt[i] = 1;
    for (const sp of splits) for (const i of sp.ids) busyAt[i] = 1;
    for (const r of ramps) for (let d = -16; d <= 16; d++) busyAt[(r.i + d + N) % N] = 1;
    for (let i = 0; i < N; i++) if (samples[i].gap || (samples[i].island || 0) > 0) busyAt[i] = 1;
    for (let d = -30; d <= 30; d++) busyAt[(d + N) % N] = 1;
    const turnOver = i0 => {
      let t = 0;
      for (let j = 0; j < RLEN - 1; j++) {
        const a = samples[(i0 + j) % N].t, b = samples[(i0 + j + 1) % N].t;
        t += Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z));
      }
      return t;
    };
    const free = i0 => { for (let j = -2; j < RLEN + 2; j++) if (busyAt[(i0 + j + N) % N]) return false; return true; };
    const cand = [];
    for (let i0 = 0; i0 < N; i0 += 3) if (free(i0)) cand.push({ i0, turn: turnOver(i0) });
    cand.sort((a, b) => a.turn - b.turn);
    for (const c of cand) {
      if (rails.length >= 2) break;
      if (c.turn > 1.2) break;
      if (rails.some(r => Math.abs(((c.i0 - r.i0 + N) % N + N / 2) % N - N / 2) < N / 4)) continue;
      const side = rails.length % 2 ? -1 : 1;
      const pts = [];
      for (let j = 0; j < RLEN; j++) {
        const a = samples[(c.i0 + j) % N];
        const lat = side * Math.max(2.5, a.w - 2.2);
        const q = a.p.clone().addScaledVector(a.n, lat);
        pts.push({ x: q.x, z: q.z, gy: surf(a, lat), i: (c.i0 + j) % N, lat });
      }
      let run = 0;
      for (let j = 1; j < pts.length; j++) run += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].z - pts[j - 1].z);
      rails.push({ i0: c.i0, len: RLEN, side, pts, step: run / (pts.length - 1), h: 0.62 });
    }
    // drawn: a steel tube on posts, with a painted end at each end so it reads as a rail at speed
    const steel = new THREE.MeshStandardMaterial({ color: 0xe4ebf3, metalness: 0.55, roughness: 0.3 });
    const cap = new THREE.MeshStandardMaterial({ color: 0xffc233, roughness: 0.5 });
    for (const r of rails) {
      const curve = new THREE.CatmullRomCurve3(r.pts.map(q => new THREE.Vector3(q.x, q.gy + r.h, q.z)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, r.pts.length * 3, 0.13, 8, false), steel);
      tube.castShadow = true;
      group.add(tube);
      const posts = [];
      for (let j = 0; j < r.pts.length; j += 3) posts.push(r.pts[j]);
      const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 1, 6), steel, posts.length);
      const m = new THREE.Matrix4();
      posts.forEach((q, n) => {
        m.makeScale(1, r.h, 1); m.setPosition(q.x, q.gy + r.h / 2, q.z);
        pm.setMatrixAt(n, m);
      });
      group.add(pm);
      for (const q of [r.pts[0], r.pts[r.pts.length - 1]]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), cap);
        e.position.set(q.x, q.gy + r.h, q.z);
        group.add(e);
      }
    }
  }


  /* The anti-gravity stretches, lit. A rail of light down each edge and a run
     of chevrons up the middle: two instanced meshes for however many sections
     the circuit has, and emissive rather than lit, so they read at the far end
     of a straight and cost the lighting pass nothing. */
  {
    const chev = [], rail = [];
    for (const f of features) {
      if (f.kind !== 'agrav') continue;
      for (let k = 0; k < f.ids.length; k++) {
        const a = samples[f.ids[k]];
        if (!a.agrav) continue;
        const ry = Math.atan2(a.t.x, a.t.z);
        if (k % 2 === 0) {
          chev.push({ p: a.p.clone().setY(surf(a, 0) + 0.04), ry, sx: a.w * 0.44 });
        }
        for (const side of [1, -1]) {
          rail.push({
            p: a.p.clone().addScaledVector(a.n, side * (a.w - 0.4)).setY(surf(a, 0) + 0.06),
            ry,
          });
        }
      }
    }
    if (chev.length || rail.length) {
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x6fdcff, transparent: true, opacity: 0.8, depthWrite: false,
      });
      many(new THREE.BoxGeometry(1, 0.05, 1.05), glowMat, chev);
      many(new THREE.BoxGeometry(0.46, 0.07, 2.2), glowMat, rail);
    }
  }

  /* their meshes */
  /* The boxes: a blue crystal with a question mark on every face and a brighter
     core turning inside it. Two instanced meshes between the lot of them, and
     the question mark is drawn rather than modelled, which is what keeps the
     shell to one draw call. */
  const boxTex = canvasTex(128, 128, (g, W, H) => {
    g.fillStyle = 'rgba(58,150,220,0.92)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#bfe8ff'; g.lineWidth = 9;
    g.strokeRect(6, 6, W - 12, H - 12);
    // a few facets, so it reads as cut rather than moulded
    g.strokeStyle = 'rgba(200,238,255,0.45)'; g.lineWidth = 5;
    g.beginPath();
    g.moveTo(6, 40); g.lineTo(46, 6); g.moveTo(W - 6, H - 40); g.lineTo(W - 46, H - 6);
    g.stroke();
    g.fillStyle = '#fff6e2';
    g.font = 'bold 86px "Trebuchet MS", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.strokeStyle = '#17223b'; g.lineWidth = 10;
    g.strokeText('?', W / 2, H / 2 + 4);
    g.fillText('?', W / 2, H / 2 + 4);
  }, [1, 1]);
  const boxMat = new THREE.MeshStandardMaterial({
    map: boxTex, color: 0xffffff, emissive: 0x2f7fd0, emissiveIntensity: 0.45,
    roughness: 0.22, metalness: 0.1, transparent: true, opacity: 0.86,
  });
  const boxGeo = new THREE.BoxGeometry(2.1, 2.1, 2.1);
  const boxMesh = new THREE.InstancedMesh(boxGeo, boxMat, itemBoxes.length);
  boxMesh.frustumCulled = false;
  group.add(boxMesh);
  const coreMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.72, 0),
    new THREE.MeshStandardMaterial({ color: 0xdff2ff, emissive: 0x8fd3ff, emissiveIntensity: 1.2, roughness: 0.3 }),
    itemBoxes.length
  );
  coreMesh.frustumCulled = false;
  group.add(coreMesh);
  // the double boxes in gold, shell and core both
  {
    const gold = new THREE.Color(0xffc233), plain = new THREE.Color(0xffffff);
    itemBoxes.forEach((b, i) => { boxMesh.setColorAt(i, b.double ? gold : plain); coreMesh.setColorAt(i, b.double ? gold : plain); });
    if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true;
    if (coreMesh.instanceColor) coreMesh.instanceColor.needsUpdate = true;
  }


  const padTex = canvasTex(128, 128, (g, W, H) => {
    g.fillStyle = '#ff8a1f'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd233';
    for (let k = 0; k < 3; k++) {
      const y = k * (H / 3);
      g.beginPath();
      g.moveTo(W * 0.1, y + H / 3 * 0.8); g.lineTo(W * 0.5, y + H / 3 * 0.15); g.lineTo(W * 0.9, y + H / 3 * 0.8);
      g.lineTo(W * 0.9, y + H / 3 * 0.95); g.lineTo(W * 0.5, y + H / 3 * 0.35); g.lineTo(W * 0.1, y + H / 3 * 0.95);
      g.closePath(); g.fill();
    }
  }, [1, 1]);
  for (const pad of boostPads) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(pad.w * 2, 7),
      new THREE.MeshStandardMaterial({ map: padTex, emissive: 0xff8a1f, emissiveIntensity: 0.3, roughness: 0.6 }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(pad.t.z, pad.t.x) + Math.PI / 2;
    m.position.copy(pad.pos).setY(pad.pos.y + 0.1);
    group.add(m);
  }

  /* ---- the starting grid -------------------------------------------------- */
  // two by two, behind the line, the way a grid actually forms
  function gridSlot(k) {
    const back = 8 + Math.floor(k / 2) * 6.5;
    const s = (length - back) % length;
    const a = at(s);
    const side = (k % 2) ? 0.42 : -0.42;
    return { pos: a.p.clone().addScaledVector(a.n, side * a.w), yaw: Math.atan2(-a.t.x, -a.t.z) };
  }

  function at(s) {
    const ss = ((s % length) + length) % length;
    let i = Math.min(N - 1, Math.floor(ss / (length / N)));
    // walk to the right sample, since spacing is not exactly uniform
    while (i < N - 1 && samples[i + 1].s <= ss) i++;
    while (i > 0 && samples[i].s > ss) i--;
    return samples[i];
  }

  /* ---- the two questions -------------------------------------------------- */
  /* ---------------------------------------------------------------------------
     Where you are on the road.

     This used to answer every question about the nearest sample: its width, its
     camber, its normal, the height difference to the next one. Samples are two
     metres apart, so every one of those answers stepped. A road that steps in
     width lets you through the barrier on the outside of a corner and stops you
     short of it on the inside; a road that steps in height reads as a crest to
     the launch code and throws the car into the air for nothing; and a frame
     taken from one sample measures your position across a corner from the wrong
     place, which is the rest of it.

     So everything here is interpolated along the segment you are actually on.
     The frame is the lerp of the two ends, renormalised; the width, the camber,
     the island and the rest come along with it; and the slope is a central
     difference over three segments rather than one, which is what stops a
     perfectly smooth hill registering as a lip.
  --------------------------------------------------------------------------- */

  // the road surface at one sample, at one offset across it
  function heightAt(a, lat) {
    const lt = Math.max(-a.w, Math.min(a.w, lat));
    const ramp = a.ramp ? a.ramp * Math.max(0, Math.min(1, (lt * a.rampSide) / a.w)) : 0;
    const tilt = a.splitLift && a.island
      ? a.splitLift * Math.max(-1, Math.min(1, lt / a.island)) : 0;
    return a.p.y + lt * a.bank + a.w * Math.abs(a.bank) + ramp + tilt;
  }

  function project(x, z, hint) {
    let best = -1, bestD = Infinity;
    const scan = (lo, hi) => {
      for (let k = lo; k <= hi; k++) {
        const i = ((k % N) + N) % N;
        const dx = samples[i].p.x - x, dz = samples[i].p.z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    };
    if (hint === undefined || hint === null) scan(0, N - 1);
    else {
      scan(hint - 26, hint + 26);
      if (bestD > 1600) { bestD = Infinity; scan(0, N - 1); }     // lost: look everywhere
    }

    /* The segment you are actually on.

       Taking the one that starts or ends at the nearest sample is not enough.
       Offset out towards the edge of the road on a bend, the nearest sample is
       often one further round than the one you are level with, so the segment
       chosen hops as you drive and the width, the height and the wall hop with
       it. That hop is what let a car through a barrier on the outside of a
       corner and stopped it short of one on the inside.

       So look at the four segments around the nearest sample and take whichever
       one the point genuinely sits against: the foot of the perpendicular
       inside it, and nearest if more than one qualifies. It is sixteen extra
       multiplies and it makes the road continuous. */
    let i0 = best, f = 0, bestSeg = Infinity;
    for (let k = -2; k <= 1; k++) {
      const s0 = ((best + k) % N + N) % N, s1 = (s0 + 1) % N;
      const p = samples[s0], q = samples[s1];
      const ux = q.p.x - p.p.x, uz = q.p.z - p.p.z;
      const u2 = ux * ux + uz * uz || 1;
      let t = ((x - p.p.x) * ux + (z - p.p.z) * uz) / u2;
      const inside = t >= 0 && t <= 1;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const fx = p.p.x + ux * t - x, fz = p.p.z + uz * t - z;
      // a segment the point is level with beats one it is past the end of
      const d = fx * fx + fz * fz + (inside ? 0 : 1e4);
      if (d < bestSeg) { bestSeg = d; i0 = s0; f = t; }
    }
    const i1 = (i0 + 1) % N;
    const a = samples[i0], b = samples[i1];
    const pv = samples[(i0 - 1 + N) % N], nx2 = samples[(i1 + 1) % N];
    const ex = b.p.x - a.p.x, ez = b.p.z - a.p.z;
    const mix = (u, v) => u + (v - u) * f;
    /* Everything that varies along the road is read off a curve through four
       samples rather than off the straight line between two.

       A straight line between samples is continuous but its slope is not: there
       is a kink at every sample, two metres apart, and a kink in the height is a
       bump you feel through the wheels while a kink in the width is a step in
       where the barrier is. One extra multiply each and the whole surface is
       smooth instead. */
    const ff = f * f, fff = ff * f;
    const curve = (q0, q1, q2, q3) => 0.5 * ((2 * q1) + (-q0 + q2) * f
      + (2 * q0 - 5 * q1 + 4 * q2 - q3) * ff + (-q0 + 3 * q1 - 3 * q2 + q3) * fff);

    // the frame at that point: position, the way the road is going, and across it
    const px = a.p.x + ex * f, pz = a.p.z + ez * f;
    let tx = mix(a.t.x, b.t.x), tz = mix(a.t.z, b.t.z);
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;                       // left of travel, as everywhere
    const rx = x - px, rz = z - pz;
    const lateral = rx * nx + rz * nz;
    const along = rx * tx + rz * tz;

    const w = curve(pv.w, a.w, b.w, nx2.w);
    const bank = curve(pv.bank, a.bank, b.bank, nx2.bank);
    const island = mix(a.island || 0, b.island || 0);
    const causeway = mix(a.causeway || 0, b.causeway || 0);
    const lt = Math.max(-w, Math.min(w, lateral));

    /* Height. The two ends are evaluated at the same offset across the road and
       then mixed, rather than the offset being applied to a mixed sample, which
       is what keeps a one sided ramp from smearing across the middle. */
    let y = curve(heightAt(pv, lt), heightAt(a, lt), heightAt(b, lt), heightAt(nx2, lt));

    /* Off the tarmac the ground takes over. The kerb is drawn from the road edge
       down to the grass, so the height has to follow it down: keeping the road's
       own height out there put a kart nearly two metres under the field on the
       inside of a banked corner. */
    const over = Math.abs(lateral) - w;
    if (over > 0) {
      /* Over a longer run than it was, and never falling away faster than a
         slope you could drive down. Blended over a metre and a half, the edge
         of a road standing on an embankment dropped several metres in one car
         length, which the physics reads as a cliff and throws you off. */
      const g = groundY(x, z);
      const m = Math.min(1, over / (KERB * 2.6));
      const want = y + (g - y) * m * m;
      y = Math.max(want, y - over * 0.6);
    }

    /* How steeply the road is climbing under you. Over three segments rather
       than one: measured across a single pair of samples this is a staircase,
       and the launch code reads any step down in it as the lip of a ramp. */
    const p0 = samples[(i0 - 1 + N) % N], p3 = samples[(i1 + 1) % N];
    let slope;
    if (a.gap || b.gap || p0.gap || p3.gap) {
      /* Never across the edge of a hole. The samples inside a gap keep the
         height the road had before the lip was built on it, so a difference
         taken across one reads as a four metre cliff in six metres of road,
         and the launch that comes out of that throws a car twenty metres up. */
      slope = 0;
    } else {
      const run = (p0.len || STEP) + (a.len || STEP) + (b.len || STEP);
      slope = (heightAt(p3, lt) - heightAt(p0, lt)) / run;
    }

    const sideOf = k => (a[k] && Math.sign(lateral) === Math.sign(a[k])) ? a[k]
                      : (b[k] && Math.sign(lateral) === Math.sign(b[k])) ? b[k] : 0;

    return {
      i: best, s: a.s + f * (a.len || STEP) + along, lateral, half: w,
      onRoad: Math.abs(lateral) <= w + 0.4,
      // the red and white is the outer strip of the road, so riding it is riding
      // the edge rather than being off the track
      onKerb: Math.abs(lateral) > w - KERB && Math.abs(lateral) <= w + 0.4,
      wall: w + SHOULDER,
      y, bank, slope,
      t: { x: tx, y: 0, z: tz }, n: { x: nx, y: 0, z: nz },
      // the island up the middle of a split: inside this, laterally, is not road
      island,
      /* No road here at all. Either end of the segment being a hole is enough,
         because that is exactly the test the ribbon uses when it decides not to
         draw a quad: the physics and the picture have to agree about where the
         edge is or you fall through tarmac you can see. */
      gap: !!(a.gap || b.gap),
      // a strip of something that is not tarmac down one side, and what of
      strip: sideOf('strip') ? (a.stripKind || b.stripKind) : null,
      // a road with the ground taken away either side of it: over the edge is a fall
      causeway,
      // boosters down one half of it
      boostlane: sideOf('boostlane') ? 1 : 0,
      // a stretch where contact pays instead of costing
      agrav: !!(a.agrav && b.agrav),
      // the lip of a gap says how far there is to clear, so the car can work
      // out for itself how hard it has to leave
      launch: a.launch || b.launch || 0,
      // the surface above you, when there is one
      waterY: a.waterY === undefined ? (b.waterY === undefined ? null : b.waterY) : a.waterY,
      tunnel: !!(a.tunnel || b.tunnel),
    };
  }

  return {
    group, samples, length, ramps, features, splits, project, at, gridSlot, groundY, rails,
    theme: th,
    // what this place does to a kart: read by the physics every frame
    rules: R,
    // the patches that change how the ground under you behaves
    ice, lava,
    // where the road divides, which the cars need in order to pick a side
    /* Every place the road divides, in the order you meet them. It was only
       ever the first of them, which was fine while there was only one; with
       three on a lap it meant a driver went round the first island and straight
       into the second. */
    splits,
    splitAt: splits[0] || null,
    // how far past the tarmac the wall is, so the barriers can stand on it
    shoulder: SHOULDER,
    itemBoxes, boostPads, boxMesh, coreMesh,
    // the ribbon, in a form the minimap can draw cheaply
    outline: samples.filter((_, i) => i % 3 === 0).map(a => [a.p.x, a.p.z]),
    bounds: samples.reduce((b, a) => ({
      minx: Math.min(b.minx, a.p.x), maxx: Math.max(b.maxx, a.p.x),
      minz: Math.min(b.minz, a.p.z), maxz: Math.max(b.maxz, a.p.z),
    }), { minx: 1e9, maxx: -1e9, minz: 1e9, maxz: -1e9 }),
  };
}

function ribbon(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
