/* Leoncraft 2 - the HUD: the crosshair, the hotbar with each block drawn as
   a little isometric cube from its own textures, and the F3 screen. */
import { BLOCKS, B } from './blocks.js?v=1';

export class Hud {
  constructor(root, albedoImg, manifest) {
    this.root = root;
    this.slot = 0;
    this.bar = root.querySelector('#hotbar');
    this.debug = root.querySelector('#debug');
    this.name = root.querySelector('#blockname');
    // the texture strip, readable, for drawing the icons
    const c = document.createElement('canvas');
    c.width = 16; c.height = albedoImg.height;
    const g = c.getContext('2d');
    g.drawImage(albedoImg, 0, 0);
    this.pix = g.getImageData(0, 0, 16, albedoImg.height).data;
    this.tint = { grass: [0x79, 0xc0, 0x5a], foliage: [0x59, 0xae, 0x30], water: [0x3f, 0x76, 0xe4], spruce: [0x61, 0x99, 0x61], birch: [0x80, 0xa7, 0x55] };
  }
  layerRGBA(layer, x, y, tint) {
    const o = ((layer * 16 + y) * 16 + x) * 4;
    const p = this.pix;
    let r = p[o], g = p[o + 1], b = p[o + 2];
    if (tint) { r = r * tint[0] / 255; g = g * tint[1] / 255; b = b * tint[2] / 255; }
    return [r, g, b, p[o + 3]];
  }
  icon(id, size) {
    const d = BLOCKS[id];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const put = (x, y, rgba, shade) => {
      if (x < 0 || y < 0 || x >= size || y >= size || rgba[3] < 128) return;
      const o = (y * size + x) * 4;
      img.data[o] = rgba[0] * shade; img.data[o + 1] = rgba[1] * shade; img.data[o + 2] = rgba[2] * shade; img.data[o + 3] = 255;
    };
    const tint = d.tint ? this.tint[d.tint] : null;
    if (d.shape !== 'cube') {
      // plants, torches, fluids: the flat texture
      const L = d.faces[2];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, this.layerRGBA(L, (x / size * 16) | 0, (y / size * 16) | 0, tint), 1);
    } else {
      // an isometric cube: top, left and right faces, each shaded like the game's icons
      const s = size / 2;
      const top = d.faces[2], left = d.faces[4], right = d.faces[0];
      const sideTint = d.overlay !== undefined ? null : tint;
      for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) {
        for (let a = 0; a < 2; a++) for (let b2 = 0; b2 < 2; b2++) {
          const uu = u + a * 0.5, vv = v + b2 * 0.5;
          // top face: a diamond
          const tx = Math.round(s + (uu - vv) * s / 16), ty = Math.round((uu + vv) * s / 32);
          put(tx, ty, this.layerRGBA(top, u, v, tint), 1.0);
          // left face
          const lx = Math.round(uu * s / 16), ly = Math.round(s * 0.5 + uu * s / 32 + vv * s / 16);
          let lc = this.layerRGBA(left, u, v, sideTint);
          if (d.overlay !== undefined) { const ov = this.layerRGBA(d.overlay, u, v, tint); if (ov[3] > 128) lc = ov; }
          put(lx, ly, lc, 0.8);
          // right face
          const rx = Math.round(s + uu * s / 16), ry = Math.round(s + vv * s / 16 - uu * s / 32 + s * 0.5 - s * 0.5);
          let rc = this.layerRGBA(right, u, v, sideTint);
          if (d.overlay !== undefined) { const ov = this.layerRGBA(d.overlay, u, v, tint); if (ov[3] > 128) rc = ov; }
          put(rx, ry, rc, 0.62);
        }
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  setHotbar(ids) {
    this.ids = ids;
    this.bar.innerHTML = '';
    ids.forEach((id, i) => {
      const s = document.createElement('div');
      s.className = 'slot' + (i === this.slot ? ' on' : '');
      s.appendChild(this.icon(id, 40));
      this.bar.appendChild(s);
    });
  }
  select(i) {
    this.slot = ((i % 9) + 9) % 9;
    [...this.bar.children].forEach((s, j) => s.classList.toggle('on', j === this.slot));
    const d = BLOCKS[this.ids[this.slot]];
    this.name.textContent = d.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    this.name.classList.remove('fade'); void this.name.offsetWidth; this.name.classList.add('fade');
  }
  get block() { return this.ids[this.slot]; }
  setSlot(id) { this.ids[this.slot] = id; this.setHotbar(this.ids); }
  showDebug(on, lines) {
    this.debug.hidden = !on;
    if (on) this.debug.textContent = lines.join('\n');
  }
}
