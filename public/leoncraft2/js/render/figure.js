/* ---------------------------------------------------------------------------
   Leoncraft 2 - you, in the inventory screen.

   The figure in the inventory's black box (and in the creative inventory's
   own tab), as the game draws it:

     pose       your own model as it is right now (the arm swing, sneaking,
                riding, the idle sway of the arms), but turned to the mouse:
                the body by atan(dx / 40) x 20 degrees, the head as much
                again, the head tipped up or down by atan(dy / 40) x 20
                degrees, and the whole figure leaning back or forward by the
                same, about its feet (dx, dy from the middle of the box, in
                GUI pixels). It stands with the middle of its height (1.8
                blocks, 1.5 sneaking) a sixteenth of a block above the middle
                of the box, 30 GUI pixels a block (20 in the creative tab),
                cut off at the box's edges.
     wearing    the armour (layer 1 a pixel out, the leggings half a pixel),
                leather in its dye, the glint on enchanted pieces; what is
                in either hand, placed as in third person, shimmering too.
     light      the same in Fast and Detailed: full light, two fixed lights
                from above and in front and 0.4 everywhere, so the front and
                the top are bright and the sides darker.

   How it gets onto the GUI's 2D canvas without slowing the frame: drawn into
   a small picture of its own at the box's size in screen pixels, read back
   through a pixel buffer that the GPU fills in its own time (a fence says
   when; nothing waits), then put on a canvas the GUI draws in the box. A new
   picture is asked for when the mouse moves, and 20 times a second for the
   arms' sway, only while the screen showing it is open.
--------------------------------------------------------------------------- */
import { AVATAR_HEAD, AVATAR_VS, ARMOR_OVERLAY } from './avatar.js?v=107';
import { GLINT, SHEET_W, SHEET_H } from './armor.js?v=107';
import { setGlint } from './glint.js?v=107';
import { MobFigure } from './mobfigure.js?v=107';
const THREE = window.THREE;
const PI = Math.PI, DEG = PI / 180;
const MODEL_SCALE = 0.9375 / 16;

/* the lights, in the picture's space (x right, y up, z towards you) */
const LIGHTS = `
const vec3 L0 = vec3(0.1508, 0.7538, 0.6396), L1 = vec3(-0.1508, 0.7538, 0.6396);
float guiShade(vec3 n) { return min(1.0, (max(0.0, dot(L0, n)) + max(0.0, dot(L1, n))) * 0.6 + 0.4); }
`;
const SKIN_FS = /* glsl */`
uniform sampler2D uSkin;
uniform float uHurt;
in vec3 vWorld; in vec3 vN; in vec2 vUv; flat in int vLayer;
#ifdef ARMOR
in vec3 vTint; in vec3 vG; in vec2 vUv2;
uniform sampler2D uNoise;
uniform float uClock;
` + GLINT + ARMOR_OVERLAY + `
#endif
layout(location = 0) out vec4 outColor;
` + LIGHTS + `
void main() {
  vec4 t = texture(uSkin, vUv);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
#ifdef ARMOR
  t = armorColour(t);
  if (t.a < 0.1) discard;
  vec3 c = t.rgb * guiShade(N);
  if (vG.z > 0.5) c += glintAt(vG.xy, uClock);
#else
  if (vLayer == 0 ? !gl_FrontFacing : t.a < 0.5) discard;
  vec3 c = mix(t.rgb, vec3(1.0, 0.0, 0.0), uHurt * 0.3) * guiShade(N);
#endif
  outColor = vec4(c, 1.0);
}`;
/* what is in a hand: the vertex format of render/blockmesh.js, lit the same way */
const ITEM_HEAD = `precision highp float; precision highp int; precision highp sampler2DArray;\n`;
const ITEM_VS = /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
layout(location = 0) in uvec4 aPos; layout(location = 1) in uvec4 aA; layout(location = 3) in uvec4 aC;
#define aPos vec4(aPos)
#define aA vec4(aA)
#define aC vec4(aC)
out vec2 vUv; out float vShade; out vec3 vTint; flat out float vLayer; flat out int vFlags;
` + LIGHTS + `
const vec3 FN[6] = vec3[6](vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1));
void main() {
  int flags = int(aA.w + 0.5);
  vec3 n = normalize(mat3(modelMatrix) * FN[int(aA.z + 0.5) & 7]);
  vShade = (flags & 32) != 0 ? 1.0 : guiShade(n);
  vTint = aC.rgb / 255.0;
  vUv = aA.xy / 16.0;
  vLayer = aPos.w;
  vFlags = flags;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(aPos.xyz / 32.0 - vec3(8.0, 0.0, 8.0), 1.0);
}`;
const ITEM_FS = /* glsl */`
uniform sampler2DArray uAlbedo;
in vec2 vUv; in float vShade; in vec3 vTint; flat in float vLayer; flat in int vFlags;
layout(location = 0) out vec4 outColor;
void main() {
  int rot = (vFlags >> 2) & 3;
  vec2 uv = vUv;
  if (rot == 1) uv = vec2(1.0 - vUv.y, vUv.x);
  else if (rot == 2) uv = vec2(1.0 - vUv.x, 1.0 - vUv.y);
  else if (rot == 3) uv = vec2(vUv.y, 1.0 - vUv.x);
  vec4 alb = textureLod(uAlbedo, vec3(uv, vLayer), 0.0);
  if (alb.a < 0.5) discard;
  vec3 c = alb.rgb;
  if ((vFlags & 16) != 0) {
    vec4 ov = textureLod(uAlbedo, vec3(uv, vLayer + 1.0), 0.0);
    c = mix(c, ov.rgb * vTint, ov.a);
  } else if ((vFlags & 64) != 0) c *= vTint;
  outColor = vec4(c * vShade, 1.0);
}`;

export class Figure {
  constructor(R) {
    this.R = R;
    const A = this.A = R.avatar;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
    this.cam.position.set(0, 0, 2000);
    this.parts = Array.from({ length: 6 }, () => new THREE.Matrix4());
    this.root = new THREE.Matrix4(); this.t = new THREE.Matrix4();
    // the skin: the model's own geometry and skin, on the figure's parts
    const mk = (fs, uniforms, defines) => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: AVATAR_HEAD + AVATAR_VS, fragmentShader: AVATAR_HEAD + fs,
      uniforms, defines: defines || {}, side: THREE.DoubleSide,
    });
    const uParts = { value: this.parts };
    this.body = new THREE.Mesh(A.mesh.geometry, mk(SKIN_FS, { uSkin: { value: A.tex }, uParts, uShow: A.uShow, uHurt: A.uHurt }));
    // the armour: its own copy of what is worn (the model hides the helmet from a camera pulled right into the head)
    this.uPiece = { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector4()) };
    this.armor = new THREE.Mesh(A.armor.geometry, mk(SKIN_FS, {
      uSkin: { value: A.armorTex }, uParts, uShow: A.uShow, uPiece: this.uPiece, uTint: A.uTint, uTrim: A.uTrim,
      uSheet: { value: new THREE.Vector2(SHEET_W, SHEET_H) }, uNoise: R.U.uNoise, uClock: R.U.uClock, uGlint: R.U.uGlint,
    }, { ARMOR: 1 }));
    this.itemMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: ITEM_HEAD + ITEM_VS, fragmentShader: ITEM_HEAD + ITEM_FS,
      uniforms: { uAlbedo: R.U.uAlbedo }, side: THREE.DoubleSide,
    });
    this.items = [null, null]; this.headMesh = null;
    // a mount's screen draws the animal here instead (mobfigure.js)
    this.mobFig = new MobFigure(this.scene);
    for (const m of [this.body, this.armor]) { m.frustumCulled = false; m.matrixAutoUpdate = false; this.scene.add(m); }
    // the picture, and reading it back
    this.rt = null; this.w = 0; this.h = 0;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.pbo = null; this.fence = null; this.pixels = null; this.image = null;
    this.want = null; this.last = 0; this.lastMouse = '';
    this.shown = null;           // the size of the picture on the canvas: [w, h]
  }

  /* From the GUI (inventory.drawPlayer): the box, in GUI pixels, and the mouse.
     Draws the last picture there, and asks for a new one. */
  draw(g, x, y, w, h, mx, my, mob, size, drop) {
    this.gui = g;
    const s = g.scale || 1, W = Math.round(w * s), H = Math.round(h * s);
    this.want = { w, h, W, H, mx: mx - (x + w / 2), my: my - (y + h / 2), size: size || (h > 50 ? 30 : 20), s, t: performance.now(), mob: mob || null, drop: drop || 0 };
    if (this.shown && this.shown[0] === W && this.shown[1] === H) g.ctx.drawImage(this.canvas, 0, 0, W, H, x, y, w, h);
  }

  /* Every frame (renderer.js, after the model has been posed): take in a
     picture the GPU has finished, and draw a new one if it is asked for. */
  frame(state) {
    const R = this.R, r = R.r, gl = r.getContext();
    if (this.fence) {
      if (gl.getSyncParameter(this.fence, gl.SYNC_STATUS) !== gl.SIGNALED) return;
      gl.deleteSync(this.fence); this.fence = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixels);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.put();
      if (this.gui) this.gui.markDirty();
      return;
    }
    const W = this.want, now = performance.now();
    // nothing on screen asks for it (the screen is closed): nothing to draw
    if (!W || now - W.t > 400 || !state.player || !this.A.ready) return;
    const mouse = W.mx + ',' + W.my + ',' + W.W + ',' + W.H + ',' + (W.mob ? W.mob.id : '');
    if (mouse === this.lastMouse && now - this.last < 50) return;
    this.lastMouse = mouse; this.last = now;
    // a mount's screen: the animal alone
    const mob = W.mob && !W.mob.removed ? W.mob : null;
    for (const m of [this.body, this.armor, this.items[0], this.items[1], this.headMesh]) if (m) m.visible = !mob;
    if (mob) { if (!this.mobFig.posed(mob, state.alpha === undefined ? 0 : state.alpha, W)) return; }
    else { this.mobFig.hide(); this.pose(state, W); }
    this.render(W.W, W.H);
  }

  // the figure's pose and place for the box (see the top of this file)
  pose(state, W) {
    const A = this.A, P = state.player, a = state.alpha === undefined ? 0 : state.alpha, t = this.t;
    const h = Math.atan(-W.mx / 40), i = Math.atan(-W.my / 40);
    A.poseFor(P, a, i * 20 * DEG, -h * 20 * DEG);
    const sneak = A.cur.sneak, px = W.size * W.s;
    const root = this.root;
    // the feet below the middle of the box by half the height (of the pose's box: 0.6 swimming, crawling or
    // gliding) and a sixteenth, leaning about the feet, turned to the mouse
    root.makeTranslation(0, -((P.pose === 'swim' ? 0.6 : sneak ? 1.5 : 1.8) / 2 + 1 / 16) * px, 0);
    root.multiply(t.makeRotationX(-i * 20 * DEG));
    root.multiply(t.makeRotationY(-h * 20 * DEG));
    root.multiply(t.makeScale(px, px, px));
    // swimming, crawling or gliding: laid down as you are, along the mouse's look (not standing with the swimmer's arms up)
    A.layDown(root, P, a, i * 20 * DEG);
    if (sneak) root.multiply(t.makeTranslation(0, -0.125, 0));
    root.multiply(t.makeScale(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE));
    A.matrices(root, this.parts);
    // what is worn
    this.body.geometry = A.mesh.geometry;
    const wear = A.uPiece.value;
    for (let k = 0; k < 5; k++) this.uPiece.value[k].copy(wear[k]);
    if (A.headWorn) this.uPiece.value[0].y = 1;
    this.armor.visible = A.wearing;
    // what is held: the same shapes as in third person, on the figure's arms
    for (let side = 0; side < 2; side++) {
      const src = A.held[side];
      let m = this.items[side];
      if (m && (!src || m.geometry !== src.mesh.geometry)) { this.scene.remove(m); m = this.items[side] = null; }
      if (!src) continue;
      if (!m) {
        m = this.items[side] = new THREE.Mesh(src.mesh.geometry, this.itemMat);
        m.frustumCulled = false; m.matrixAutoUpdate = false;
        this.scene.add(m);
      }
      A.placeHeld(side, A.heldKindNow(side), this.parts, m.matrix);
      m.matrixWorldNeedsUpdate = true;
      setGlint(m, A.heldGlint[side], this.R, true);
    }
    // a carved pumpkin or a mob head worn on the head
    const hs = A.headItem;
    let hm = this.headMesh;
    if (hm && (!hs || hm.geometry !== hs.mesh.geometry)) { this.scene.remove(hm); hm = this.headMesh = null; }
    if (hs) {
      if (!hm) {
        hm = this.headMesh = new THREE.Mesh(hs.mesh.geometry, this.itemMat);
        hm.frustumCulled = false; hm.matrixAutoUpdate = false;
        this.scene.add(hm);
      }
      A.placeHead(hs.skull, this.parts, hm.matrix);
      hm.matrixWorldNeedsUpdate = true;
    }
  }

  // into the picture, and the read back started
  render(W, H) {
    const r = this.R.r, gl = r.getContext();
    if (!this.rt || this.w !== W || this.h !== H) {
      if (this.rt) this.rt.dispose();
      this.rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
      this.w = W; this.h = H;
      this.pixels = new Uint8Array(W * H * 4);
      if (!this.pbo) this.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, W * H * 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
    const cam = this.cam;
    cam.left = -W / 2; cam.right = W / 2; cam.top = H / 2; cam.bottom = -H / 2;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const before = r.getRenderTarget(), clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.scene, cam);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    this.size = [W, H];
    r.setRenderTarget(before);
    r.setClearColor(clear, alpha);
  }

  // the pixels onto the canvas, top row first
  put() {
    const [W, H] = this.size, c = this.canvas;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this.image = null; }
    if (!this.image) this.image = this.ctx.createImageData(W, H);
    const src = this.pixels, dst = this.image.data, row = W * 4;
    for (let y = 0; y < H; y++) dst.set(src.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    this.ctx.putImageData(this.image, 0, 0);
    this.shown = [W, H];
  }
}
