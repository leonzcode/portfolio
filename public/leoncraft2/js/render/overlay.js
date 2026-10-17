/* ---------------------------------------------------------------------------
   Leoncraft 2 - what is drawn on the block you are looking at.

   outline  Minecraft's thin black frame round the block's selection boxes,
            40% opaque, drawn after the world so it sits on the surface
   crack    the ten breaking stages laid over the block while you mine it,
            multiplied into what is already there (the game blends it as
            colour x colour x 2, so mid grey changes nothing, dark cracks darken)
--------------------------------------------------------------------------- */
const THREE = window.THREE;
const MAX_BOXES = 12;

export class Overlay {
  constructor(U, manifest) {
    // the outline: up to MAX_BOXES boxes of 12 edges each
    const lg = new THREE.BufferGeometry();
    this.linePos = new Float32Array(MAX_BOXES * 24 * 3);
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    lg.setDrawRange(0, 0);
    this.outline = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    this.outline.frustumCulled = false;
    this.outline.visible = false;
    // the cracks: six faces per box, textured from the block texture array
    const cg = new THREE.BufferGeometry();
    this.crackPos = new Float32Array(MAX_BOXES * 24 * 3);
    this.crackUv = new Float32Array(MAX_BOXES * 24 * 2);
    const idx = new Uint16Array(MAX_BOXES * 36);
    for (let q = 0; q < MAX_BOXES * 6; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    cg.setAttribute('position', new THREE.BufferAttribute(this.crackPos, 3));
    cg.setAttribute('uv', new THREE.BufferAttribute(this.crackUv, 2));
    cg.setIndex(new THREE.BufferAttribute(idx, 1));
    cg.setDrawRange(0, 0);
    const T = manifest.textures;
    this.stages = [];
    for (let i = 0; i < 10; i++) this.stages.push(T['destroy_stage_' + i] ? T['destroy_stage_' + i].layer : -1);
    this.crackMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uAlbedo: U.uAlbedo, uLayer: { value: 0 } },
      vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `precision highp sampler2DArray; uniform sampler2DArray uAlbedo; uniform float uLayer; in vec2 vUv; out vec4 o;
        void main() { vec4 c = texture(uAlbedo, vec3(vUv, uLayer)); if (c.a < 0.1) discard; o = vec4(c.rgb, 1.0); }`,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    });
    this.crack = new THREE.Mesh(cg, this.crackMat);
    this.crack.frustumCulled = false;
    this.crack.visible = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.crack, this.outline);
    this.key = '';
  }
  // boxes: [[x0, y0, z0, x1, y1, z1], ...] relative to the block at (x, y, z); stage -1 for no cracks
  set(x, y, z, boxes, stage) {
    if (!boxes) { this.outline.visible = false; this.crack.visible = false; this.key = ''; return; }
    const key = x + ',' + y + ',' + z + ',' + boxes.length + ',' + boxes[0].join(',') + ',' + stage;
    if (key === this.key) return;
    this.key = key;
    const n = Math.min(MAX_BOXES, boxes.length), e = 0.002;
    /* the corners from the block's own corner, the block's place on the mesh (three.js puts the two together in
       doubles): written out in the world's numbers, far from the middle of the world the 0.002 grow was rounded
       away and the frame took turns with the block's faces as the view turned */
    this.outline.position.set(x, y, z); this.crack.position.set(x, y, z);
    this.outline.updateMatrix(); this.crack.updateMatrix();
    const P = this.linePos;
    let k = 0;
    const v = (a, b, c) => { P[k++] = a; P[k++] = b; P[k++] = c; };
    for (let i = 0; i < n; i++) {
      const [a0, b0, c0, a1, b1, c1] = boxes[i];
      const X0 = a0 - e, Y0 = b0 - e, Z0 = c0 - e, X1 = a1 + e, Y1 = b1 + e, Z1 = c1 + e;
      // the four edges round the bottom, the four round the top, and the four uprights
      v(X0, Y0, Z0); v(X1, Y0, Z0); v(X1, Y0, Z0); v(X1, Y0, Z1); v(X1, Y0, Z1); v(X0, Y0, Z1); v(X0, Y0, Z1); v(X0, Y0, Z0);
      v(X0, Y1, Z0); v(X1, Y1, Z0); v(X1, Y1, Z0); v(X1, Y1, Z1); v(X1, Y1, Z1); v(X0, Y1, Z1); v(X0, Y1, Z1); v(X0, Y1, Z0);
      v(X0, Y0, Z0); v(X0, Y1, Z0); v(X1, Y0, Z0); v(X1, Y1, Z0); v(X1, Y0, Z1); v(X1, Y1, Z1); v(X0, Y0, Z1); v(X0, Y1, Z1);
    }
    const lg = this.outline.geometry;
    lg.attributes.position.needsUpdate = true;
    lg.setDrawRange(0, n * 24);
    this.outline.visible = true;
    // the cracks, projected onto each face the way the block's own texture is
    const layer = stage >= 0 && stage < 10 ? this.stages[stage] : -1;
    if (layer < 0) { this.crack.visible = false; return; }
    const C = this.crackPos, U = this.crackUv;
    let p = 0, u = 0;
    const cv = (a, b, c, s, t) => { C[p++] = a; C[p++] = b; C[p++] = c; U[u++] = s; U[u++] = 1 - t; };
    for (let i = 0; i < n; i++) {
      const [a0, b0, c0, a1, b1, c1] = boxes[i];
      const X0 = a0, Y0 = b0, Z0 = c0, X1 = a1, Y1 = b1, Z1 = c1;
      // +x, -x, +y, -y, +z, -z, wound to face outwards
      cv(X1, Y0, Z1, 1 - c1, b0); cv(X1, Y0, Z0, 1 - c0, b0); cv(X1, Y1, Z0, 1 - c0, b1); cv(X1, Y1, Z1, 1 - c1, b1);
      cv(X0, Y0, Z0, c0, b0); cv(X0, Y0, Z1, c1, b0); cv(X0, Y1, Z1, c1, b1); cv(X0, Y1, Z0, c0, b1);
      cv(X0, Y1, Z1, a0, 1 - c1); cv(X1, Y1, Z1, a1, 1 - c1); cv(X1, Y1, Z0, a1, 1 - c0); cv(X0, Y1, Z0, a0, 1 - c0);
      cv(X0, Y0, Z0, a0, c0); cv(X1, Y0, Z0, a1, c0); cv(X1, Y0, Z1, a1, c1); cv(X0, Y0, Z1, a0, c1);
      cv(X0, Y0, Z1, a0, b0); cv(X1, Y0, Z1, a1, b0); cv(X1, Y1, Z1, a1, b1); cv(X0, Y1, Z1, a0, b1);
      cv(X1, Y0, Z0, 1 - a1, b0); cv(X0, Y0, Z0, 1 - a0, b0); cv(X0, Y1, Z0, 1 - a0, b1); cv(X1, Y1, Z0, 1 - a1, b1);
    }
    const cg = this.crack.geometry;
    cg.attributes.position.needsUpdate = true; cg.attributes.uv.needsUpdate = true;
    cg.setDrawRange(0, n * 36);
    this.crackMat.uniforms.uLayer.value = layer;
    this.crack.visible = true;
  }
  // draw both after the world (into whatever target the world went to)
  render(r, cam) {
    if (this.crack.visible || this.outline.visible) r.render(this.scene, cam);
  }
}
