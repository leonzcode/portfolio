/* ---------------------------------------------------------------------------
   Leon Kart - somebody else's kart, drawn smoothly.

   Their browser says where their kart is fourteen or so times a second. A kart
   eased towards the last thing it said, and guessed forward in a straight
   line between packets, is never quite right on a corner: every packet pulls
   it back onto the curve, and that tug, a dozen times a second, is a kart that
   shivers. Watching one, the camera follows it, and the whole screen shivers.

   So it is drawn a little in the past instead, between two places it really
   was, on a smooth curve through the ones either side (a Hermite spline), the way
   network games draw other players. How far back follows how far apart the
   packets have been arriving: one and a half gaps, which on a good line is
   about a tenth of a second. If a packet is late it carries on from the last
   one for a quarter of a second at most, and a restart or a teleport (thirty
   metres in one packet) starts the history again rather than sliding there.
--------------------------------------------------------------------------- */
const KEEP = 12;
const wrap = a => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

// one packet: m has x, y, z, yaw and sp
export function record(p, m, now) {
  const h = p.hist || (p.hist = []);
  const last = h[h.length - 1];
  if (last && Math.hypot(m.x - last.x, m.z - last.z) > 30) h.length = 0;
  if (last && h.length && now - last.t < 1) return;          // two in the same moment: keep the first
  h.push({ t: now, x: m.x, y: m.y, z: m.z, yaw: m.yaw, sp: m.sp || 0 });
  if (h.length > KEEP) h.shift();
  if (last && h.length > 1) {
    const gap = Math.min(400, now - last.t);
    p.gap = p.gap ? p.gap * 0.9 + gap * 0.1 : gap;
  }
}
export function clear(p) { if (p && p.hist) p.hist.length = 0; }

/* A curve from b to c that leaves b at the speed it had there and arrives at
   c the same way. The speeds come from the neighbours and the times they were
   sent, not from treating every gap as equal: packets arrive unevenly, and an
   even spacing made the kart speed up and slow down a little every packet. */
const hermite = (pb, pc, vb, vc, dt, f) => {
  const f2 = f * f, f3 = f2 * f;
  return (2 * f3 - 3 * f2 + 1) * pb + (f3 - 2 * f2 + f) * dt * vb + (-2 * f3 + 3 * f2) * pc + (f3 - f2) * dt * vc;
};
const vel = (a, c, k) => (c[k] - a[k]) / Math.max(1, c.t - a.t);

/* Where the kart is drawn now, into out { x, y, z, yaw }. False when there is
   nothing to go on yet. */
export function pose(p, now, out) {
  const h = p && p.hist;
  if (!h || !h.length) return false;
  const delay = Math.min(220, Math.max(90, (p.gap || 70) * 1.5));
  const t = now - delay;
  if (h.length === 1 || t <= h[0].t) {
    const s = h[0];
    out.x = s.x; out.y = s.y; out.z = s.z; out.yaw = s.yaw;
    return true;
  }
  for (let i = h.length - 1; i > 0; i--) {
    const b = h[i - 1], c = h[i];
    if (t < b.t || t > c.t) continue;
    const f = (t - b.t) / Math.max(1, c.t - b.t);
    const a = h[i - 2] || b, d = h[i + 1] || c, dt = Math.max(1, c.t - b.t);
    out.x = hermite(b.x, c.x, vel(a, c, 'x'), vel(b, d, 'x'), dt, f);
    out.y = b.y + (c.y - b.y) * f;
    out.z = hermite(b.z, c.z, vel(a, c, 'z'), vel(b, d, 'z'), dt, f);
    out.yaw = b.yaw + wrap(c.yaw - b.yaw) * f;
    return true;
  }
  // later than anything it has said: on from the last word, briefly
  const s = h[h.length - 1];
  const dt = Math.min(0.25, (t - s.t) / 1000);
  out.x = s.x - Math.sin(s.yaw) * s.sp * dt;
  out.y = s.y;
  out.z = s.z - Math.cos(s.yaw) * s.sp * dt;
  out.yaw = s.yaw;
  return true;
}
