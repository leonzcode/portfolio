/* ---------------------------------------------------------------------------
   Leoncraft 2 - Detailed's sun shadows, kept and built a little at a time.

   The blocks' shadow map is cached: it is drawn again only when it would
   look different (the sun has moved a quarter of a degree, you have moved
   a few blocks from where it was centred, or blocks near you changed). A
   new one is drawn into a second map over a few frames, a share of the
   chunk columns each frame, while the shaders go on reading the old one;
   when the last share is in, the two swap. So the map never costs one frame
   a lot (a whole map is three to four milliseconds on a slow graphics card).

   Your own body casts its shadow from a small map of its own, drawn each
   frame you move from the same point of view as the blocks' map, so walking
   costs one small draw rather than a copy of the whole map. The shaders read
   it only round where you stand (uBody: how to get there from the blocks'
   map, and whether there is a body to read).
--------------------------------------------------------------------------- */
const THREE = window.THREE;

const SLICES = 6;          // frames a new map is spread over
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

function depthTarget(n) {
  const t = new THREE.WebGLRenderTarget(n, n, { depthBuffer: true, type: THREE.UnsignedByteType });
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
    this.front = 0;
    this.body = depthTarget(BODY_RES);
    this.bodyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -320, 320);
    this.build = null;          // { at, list, i, up } while a new map is being drawn
    this.S = { x: 0, y: 0, z: 0, cx: 1e9, cy: 1e9, cz: 1e9, at: -1e9, dirty: true, fx: 1e9, fy: 0, fz: 0, yaw: 0, sneak: false, swung: false, centre: new THREE.Vector3(1e9, 0, 0) };
    this.T = { up: new THREE.Vector3(), o: new THREE.Vector3(), n: new THREE.Vector3(), look: new THREE.Matrix4(), inv: new THREE.Matrix4(), c: new THREE.Vector3(), v: new THREE.Vector3() };
    this.lightUp = [false, false];
    // made now, cleared to "nothing in the way", so the shaders never sample a map that is not there yet
    const r = R.r;
    for (const t of this.maps.concat([this.body])) { r.setRenderTarget(t); r.setClearColor(0xffffff, 1); r.clear(true, true, false); }
    r.setRenderTarget(null);
  }
  get texture() { return this.maps[this.front].depthTexture; }

  // a column came or went: only blocks near enough to be in the map mean drawing it again
  changed(cx, cz) {
    const c = this.S.centre, D = this.R.opts.shadowDist + 16;
    if (Math.abs(cx * 16 + 8 - c.x) < D && Math.abs(cz * 16 + 8 - c.z) < D) this.S.dirty = true;
  }

  // is a new blocks' map wanted?
  wanted(state, light, frame) {
    const S = this.S;
    const grid = Math.max(2, this.R.opts.shadowDist / 16), f = state.feet;
    const cx = Math.floor(f.x / grid), cy = Math.floor(f.y / grid), cz = Math.floor(f.z / grid);
    const turned = light.x * S.x + light.y * S.y + light.z * S.z < 0.99999;
    if (!(turned || cx !== S.cx || cy !== S.cy || cz !== S.cz || (S.dirty && frame - S.at >= 10))) return false;
    S.x = light.x; S.y = light.y; S.z = light.z; S.cx = cx; S.cy = cy; S.cz = cz; S.at = frame; S.dirty = false;
    S.centre.copy(f);
    return true;
  }

  // the camera for a map centred on your feet, its centre snapped to whole texels so the shadows never shimmer
  aim(cam, light, feet) {
    const D = this.R.opts.shadowDist, T = this.T;
    cam.left = -D; cam.right = D; cam.top = D; cam.bottom = -D; cam.near = -320; cam.far = 320;
    cam.updateProjectionMatrix();
    const up = Math.abs(light.y) > 0.99 ? T.up.set(0, 0, 1) : T.up.set(0, 1, 0);
    const look = T.look.lookAt(T.o.set(0, 0, 0), T.n.copy(light).negate(), up);
    const inv = T.inv.copy(look).invert();
    const centre = T.c.copy(feet).applyMatrix4(inv);
    const texel = 2 * D / this.res * 0.25;
    centre.x = Math.round(centre.x / texel) * texel; centre.y = Math.round(centre.y / texel) * texel;
    centre.applyMatrix4(look);
    cam.position.copy(centre);
    cam.quaternion.setFromRotationMatrix(look);
    cam.updateMatrixWorld();
  }

  // once a frame, before the world is drawn
  update(state, light, frame) {
    const R = this.R, r = R.r, U = R.U;
    let swapped = false;
    if (!this.build && this.wanted(state, light, frame)) {
      const back = 1 - this.front, cam = this.cams[back];
      this.aim(cam, light, state.feet);
      this.mats[back].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      // every column in the new map's view, fixed for the whole build
      const list = R.inView(cam).slice();
      /* the shares are even in what is drawn, not in columns: a column of forest
         is many times one of plains or sea, and a share that happened to take the
         woods cost a frame several milliseconds on the graphics card */
      let total = 0;
      for (const col of list) total += shadowCount(col, R.opts);
      this.build = { at: back, list, i: 0, per: Math.max(1, total / SLICES) };
      this.lightUp[back] = light.y > 0.0;
      r.setRenderTarget(this.maps[back]);
      r.setClearColor(0xffffff, 1);
      r.clear(true, true, false);
    }
    const B = this.build;
    if (B) {
      // this frame's share of the columns, into the map being built (about a sixth of what it all draws)
      let to = B.i, n = 0;
      while (to < B.list.length && (n === 0 || n + shadowCount(B.list[to], R.opts) <= B.per * 1.25)) n += shadowCount(B.list[to++], R.opts);
      if (this.lightUp[B.at] && to > B.i) {
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
        U.uShadow.value = this.maps[this.front].depthTexture;
        U.uShadowMat.value.copy(this.mats[this.front]);
        if (U.uShadowInv) U.uShadowInv.value.copy(this.mats[this.front]).invert();
        swapped = true;
      }
    }
    this.drawBody(state, swapped);
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
    const cam = this.cams[this.front], bc = this.bodyCam, D = R.opts.shadowDist;
    // where your chest is in that view; the small map reaches BODY_R round it
    const v = this.T.v.set(f.x, f.y + 0.9, f.z).applyMatrix4(cam.matrixWorldInverse);
    bc.position.copy(cam.position); bc.quaternion.copy(cam.quaternion);
    bc.left = v.x - BODY_R; bc.right = v.x + BODY_R; bc.bottom = v.y - BODY_R; bc.top = v.y + BODY_R; bc.near = cam.near; bc.far = cam.far;
    bc.updateProjectionMatrix(); bc.updateMatrixWorld();
    U.uBodyMat.value.multiplyMatrices(bc.projectionMatrix, bc.matrixWorldInverse);
    // from the blocks' map (before its squeeze) to the body's: the same view, a smaller window
    U.uBody.value.set(D / BODY_R, -v.x / BODY_R, -v.y / BODY_R, 1);
    r.setRenderTarget(this.body);
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    r.render(R.shadowScene, bc);
  }
}
