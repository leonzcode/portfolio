/* ---------------------------------------------------------------------------
   Leoncraft 2 - looking out of a carved pumpkin.

   A carved pumpkin worn on the head covers the screen in first person, as
   in the game: dark, the world seen only through the carved eyes and
   mouth, their edges soft. Hidden with the HUD (F1) and in third person.

   Our own drawing (not the game's picture): made once, small, on a canvas
   that sits between the world and the GUI and is stretched over the screen,
   which is what softens it. Showing or hiding it costs nothing per frame.
--------------------------------------------------------------------------- */
const S = 128;

function draw(c) {
  c.width = c.height = S;
  const g = c.getContext('2d');
  // the inside of the pumpkin is dark
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  // the carved face, cut out: two eyes and a toothy mouth, softened by cutting each shape a few times a little larger and fainter
  const eyes = [[[40, 14], [54, 40], [52, 58], [40, 62], [28, 58], [26, 40]], [[88, 14], [102, 40], [100, 58], [88, 62], [76, 58], [74, 40]]];
  const mouth = [[16, 74], [26, 82], [36, 74], [46, 84], [56, 76], [64, 84], [72, 76], [82, 84], [92, 74], [102, 82], [112, 74], [108, 96], [98, 110], [88, 100], [78, 112], [64, 102], [50, 112], [40, 100], [30, 110], [20, 96]];
  g.globalCompositeOperation = 'destination-out';
  const cut = (pts, grow, alpha) => {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    g.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    g.beginPath();
    pts.forEach((p, i) => {
      const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy) || 1, x = p[0] + dx / d * grow, y = p[1] + dy / d * grow;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.closePath(); g.fill();
  };
  for (const pts of [...eyes, mouth]) { cut(pts, 3, 0.25); cut(pts, 1.5, 0.45); cut(pts, 0, 1); }
  g.globalCompositeOperation = 'source-over';
}

export class PumpkinView {
  constructor(under) {
    this.on = false;
    this.el = null;
    this.under = under;
  }
  show(on) {
    if (on === this.on) return;
    this.on = on;
    if (on && !this.el) {
      const c = this.el = document.createElement('canvas');
      draw(c);
      Object.assign(c.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      // right over the world's canvas, so the GUI stays on top
      const u = this.under;
      if (u && u.parentNode) u.parentNode.insertBefore(c, u.nextSibling); else document.body.appendChild(c);
    }
    if (this.el) this.el.hidden = !on;
  }
}
