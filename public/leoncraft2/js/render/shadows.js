/* ---------------------------------------------------------------------------
   Leoncraft 2 - the sun's shadows, kept still and built a little at a time.

   The map is an even grid over the ground round you (no squeeze towards the
   middle), and the grid is pinned to the world: its centre only ever moves by
   whole texels, and its rows run along the axis the sun turns about. So a
   map drawn again for a new place has every texel where the last one had
   it, and the shadows do not move at all while you walk and turn; they move
   only as the sun does.

   The map reaches a margin past the shadow distance, and is drawn again for
   a new centre only once you have walked into that margin. It is drawn
   again for the sun as soon as a shadow would have crept a fraction of a
   pixel: a few times a minute at noon, without a break when the sun is low
   and the shadows are long and quick. And when blocks near you change.

   A new map is drawn into a second one over a few frames (a share of what it
   draws each frame, the share set by the look), while the shaders go on
   reading the old one; when the last share is in, the two swap.

   Your own body casts its shadow from a small map of its own, drawn each
   frame you move from the same point of view as the blocks' map, so walking
   costs one small draw rather than a copy of the whole map. The shaders read
   it only round where you stand (uBody: how to get there from the blocks'
   map, and whether there is a body to read).

   The shaders are told (uShadowEye) where you stand in the map in use, how
   far it reaches against the shadow distance, and how big a texel is: the
   shadows fade into the light level's guess by distance from you, not from
   the map's own middle, so nothing jumps when the map moves on.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

const BODY_RES = 256;      // the body's map: texels a side
const BODY_R = 1.6;        // and how far it reaches round your chest, in blocks

// what a column draws into the map (the shadow pass starts each kind where the sky stops reaching), kept on it
function shadowCount(col, o) {
  if (col.shadowN === undefined) {
    let n = 0;
    for (const p of col.parts) {
      if (p.kind === 'fluid' || p.kind === 'translucent' || (p.kind === 'plants' && o.plantShadows === false) || (p.kind === 'leafIn' && o.leafInShadows === false)) continue;
      n += p.count - p.shadowFrom;
    }
    col.shadowN = n;
  }
  return col.shadowN;
}

// a depth map (its colour, which nothing reads, kept to one small channel)
function depthTarget(n) {
  const t = new THREE.WebGLRenderTarget(n, n, { depthBuffer: true, type: THREE.UnsignedByteType, format: THREE.RedFormat, generateMipmaps: false });
  t.depthTexture = new THREE.DepthTexture(n, n, THREE.FloatType);
  t.depthTexture.compareFunction = THREE.LessEqualCompare;
  t.depthTexture.minFilter = t.depthTexture.magFilter = THREE.LinearFilter;
  return t;
}

export class ShadowMaps {
  constructor(R, res) {
    this.R = R;
    this.res = res;
    this.maps = [depthTarget(res), depthTarget(res)];
    this.cams = [0, 1].map(() => new THREE.OrthographicCamera(-1, 1, 1, -1, -320, 320));
    this.mats = [new THREE.Matrix4(), new THREE.Matrix4()];
    // each map's reach (half its width, in blocks) and the axes of its grid, as it was drawn
    this.half = [1, 1];
    this.axes = [0, 1].map(() => ({ right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1), centre: new THREE.Vector3(1e9, 0, 0) }));
    this.front = 0;
    this.body = depthTarget(BODY_RES);
    this.bodyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -320, 320);
    this.build = null;          // { at, list, i, per } while a new map is being drawn
    this.S = { x: 0, y: -2, z: 0, at: -1e9, dirty: true, fx: 1e9, fy: 0, fz: 0, yaw: 0, sneak: false, swung: false, centre: new THREE.Vector3(1e9, 0, 0), half: 0 };
    this.T = { up: new THREE.Vector3(), o: new THREE.Vector3(), n: new THREE.Vector3(), look: new THREE.Matrix4(), inv: new THREE.Matrix4(), c: new THREE.Vector3(), v: new THREE.Vector3(), d: new THREE.Vector3() };
    this.lightUp = [false, false];
    // made now, cleared to "nothing in the way", so the shaders never sample a map that is not there yet
    const r = R.r;
    for (const t of this.maps.concat([this.body])) { r.setRenderTarget(t); r.setClearColor(0xffffff, 1); r.clear(true, true, false); }
    r.setRenderTarget(null);
  }
  get texture() { return this.maps[this.front].depthTexture; }

  // how far past the shadow distance the map reaches: the walk you can take before it must move on
  margin() { const D = this.R.opts.shadowDist || 64; return Math.max(4, Math.round(D / 8)); }

  // a column came or went: only blocks near enough to be in the map mean drawing it again
  changed(cx, cz) {
    const c = this.S.centre, D = (this.S.half || this.R.opts.shadowDist) + 16;
    if (Math.abs(cx * 16 + 8 - c.x) < D && Math.abs(cz * 16 + 8 - c.z) < D) this.S.dirty = true;
  }

  /* is a new blocks' map wanted?
     - you have walked into its margin (measured across the light, so a climb counts as the sun sees it)
     - the sun has turned far enough that a shadow eight blocks long would have moved a
       thirty-second of a block: its shadow moves faster the lower the sun, as 1 / sin² of its height
     - blocks near you changed (no more than every ten frames) */
  wanted(state, light, frame) {
    const S = this.S, f = state.feet, A = this.axes[this.front], T = this.T;
    const H = this.R.opts.shadowDist + this.margin();
    const d = T.d.copy(f).sub(S.centre);
    const m = this.margin() * 0.9;
    const walked = Math.abs(d.dot(A.right)) > m || Math.abs(d.dot(A.up)) > m || H !== S.half;
    const cos = light.x * S.x + light.y * S.y + light.z * S.z;
    const sinE = Math.max(0.05, Math.abs(light.y));
    const allowed = Math.min(0.004, sinE * sinE / 256);
    const turned = cos < Math.cos(allowed) || light.y * S.y <= 0;
    if (!(turned || walked || (S.dirty && frame - S.at >= 10))) return false;
    S.x = light.x; S.y = light.y; S.z = light.z; S.at = frame; S.dirty = false;
    return true;
  }

  /* The camera for a map round your feet. Its grid is the world's own: the rows
     run along the axis the sun's path turns about (x x light, the same all day),
     and its centre is snapped to whole texels of that grid, so two maps drawn for
     different places put every texel in the same spot. */
  aim(cam, light, feet, at) {
    const D = this.R.opts.shadowDist, H = D + this.margin(), T = this.T;
    this.half[at] = H;
    cam.left = -H; cam.right = H; cam.top = H; cam.bottom = -H; cam.near = -320; cam.far = 320;
    cam.updateProjectionMatrix();
    const up = T.up.set(0, -light.z, light.y);
    if (up.lengthSq() < 1e-6) up.set(0, 0, 1); else up.normalize();
    const look = T.look.lookAt(T.o.set(0, 0, 0), T.n.copy(light).negate(), up);
    const inv = T.inv.copy(look).invert();
    const centre = T.c.copy(feet).applyMatrix4(inv);
    const texel = 2 * H / this.res;
    centre.x = Math.round(centre.x / texel) * texel; centre.y = Math.round(centre.y / texel) * texel;
    // (and along the light to whole blocks: the depths of a texel then come out the same too)
    centre.z = Math.round(centre.z);
    centre.applyMatrix4(look);
    cam.position.copy(centre);
    cam.quaternion.setFromRotationMatrix(look);
    cam.updateMatrixWorld();
    const A = this.axes[at];
    A.right.setFromMatrixColumn(look, 0); A.up.setFromMatrixColumn(look, 1);
    A.centre.copy(feet);
  }

  // once a frame, before the world is drawn
  update(state, light, frame) {
    const R = this.R, r = R.r, U = R.U;
    let swapped = false;
    if (!this.build && this.wanted(state, light, frame)) {
      const back = 1 - this.front, cam = this.cams[back];
      this.aim(cam, light, state.feet, back);
      this.mats[back].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      // every column in the new map's view, fixed for the whole build
      const list = R.inView(cam).slice();
      /* the shares are even in what is drawn, not in columns: a column of forest
         is many times one of plains or sea, and a share that happened to take the
         woods cost a frame several milliseconds on the graphics card */
      let total = 0;
      for (const col of list) total += shadowCount(col, R.opts);
      const slices = Math.max(1, R.opts.shadowSlices || 6);
      this.build = { at: back, list, i: 0, per: Math.max(1, total / slices) };
      this.lightUp[back] = light.y > 0.0;
      r.setRenderTarget(this.maps[back]);
      r.setClearColor(0xffffff, 1);
      r.clear(true, true, false);
    }
    const B = this.build;
    if (B) {
      // this frame's share of the columns, into the map being built
      let to = B.i, n = 0;
      while (to < B.list.length && (n === 0 || n + shadowCount(B.list[to], R.opts) <= B.per * 1.25)) n += shadowCount(B.list[to++], R.opts);
      if (this.lightUp[B.at] && to > B.i) {
        /* drawn from its own view: the shaders' uShadowMat is still the map in use, and a new
           map drawn from that one's view, then read through its own, put every shadow off by
           however far the map had moved (each time you walked a few blocks, or the sun turned) */
        U.uShadowDraw.value.copy(this.mats[B.at]);
        R.shadowSlice = { list: B.list, from: B.i, to };
        r.setRenderTarget(this.maps[B.at]);
        r.render(R.shadowTerrain, this.cams[B.at]);
        R.shadowSlice = null;
      }
      B.i = to;
      if (B.i >= B.list.length) {
        // done: the shaders read the new one from now on
        this.front = B.at;
        this.build = null;
        const A = this.axes[this.front];
        this.S.centre.copy(A.centre); this.S.half = this.half[this.front];
        U.uShadow.value = this.maps[this.front].depthTexture;
        U.uShadowMat.value.copy(this.mats[this.front]);
        if (U.uShadowInv) U.uShadowInv.value.copy(this.mats[this.front]).invert();
        swapped = true;
      }
    }
    this.tellEye(state);
    this.drawBody(state, swapped);
  }

  // where you stand in the map in use, for the shaders' fade (see the top)
  tellEye(state) {
    const U = this.R.U;
    if (!U.uShadowEye) return;
    const H = this.half[this.front], D = this.R.opts.shadowDist || 64;
    const v = this.T.v.copy(state.feet).applyMatrix4(this.mats[this.front]);
    U.uShadowEye.value.set(v.x, v.y, H / D, 2 * H / this.res);
  }

  // your body, from the same point of view as the blocks' map in use, into its own small map
  drawBody(state, force) {
    const R = this.R, r = R.r, U = R.U, S = this.S, P = state.player, f = state.feet;
    const ready = !!(R.avatar && R.avatar.ready && P && this.lightUp[this.front]);
    if (!ready) { U.uBody.value.w = 0; return; }
    const moved = force || U.uBody.value.w === 0 || Math.abs(f.x - S.fx) + Math.abs(f.y - S.fy) + Math.abs(f.z - S.fz) > 0.003 ||
      Math.abs(P.yaw - S.yaw) > 0.003 || R.swing > 0 || S.swung || P.sneaking !== S.sneak;
    if (!moved) return;
    S.fx = f.x; S.fy = f.y; S.fz = f.z; S.yaw = P.yaw; S.sneak = P.sneaking; S.swung = R.swing > 0;
    const cam = this.cams[this.front], bc = this.bodyCam, H = this.half[this.front];
    // where your chest is in that view; the small map reaches BODY_R round it
    const v = this.T.v.set(f.x, f.y + 0.9, f.z).applyMatrix4(cam.matrixWorldInverse);
    bc.position.copy(cam.position); bc.quaternion.copy(cam.quaternion);
    bc.left = v.x - BODY_R; bc.right = v.x + BODY_R; bc.bottom = v.y - BODY_R; bc.top = v.y + BODY_R; bc.near = cam.near; bc.far = cam.far;
    bc.updateProjectionMatrix(); bc.updateMatrixWorld();
    U.uBodyMat.value.multiplyMatrices(bc.projectionMatrix, bc.matrixWorldInverse);
    // from the blocks' map to the body's: the same view, a smaller window
    U.uBody.value.set(H / BODY_R, -v.x / BODY_R, -v.y / BODY_R, 1);
    r.setRenderTarget(this.body);
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    r.render(R.shadowScene, bc);
  }
}
