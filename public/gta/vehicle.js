/* ---------------------------------------------------------------------------
   Cars.

   Each one is a shell of boxes with a chamfered roof, glass darker than the
   paint, lights that come on at the back when you brake, and four wheels that
   turn and steer. The shapes differ enough between kinds that you can tell a van
   from a sports car in a mirror, which is most of what recognising a car in a
   game is.

   The whole shell is merged into one mesh and coloured per vertex. A city has a
   few hundred cars in it, and twenty separate little boxes per car is what turns
   a street full of traffic into a thousand draw calls. A parked car goes further
   and merges its wheels in too, because it is never going to turn them.

   The handling numbers are arcade, not simulation: what matters is that a sports
   car feels light and twitchy, a van feels heavy and slow to turn, and the back
   steps out when you pull the handbrake.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

export const CAR_KINDS = [
  { id: 'sedan',  label: 'Saloon',   w: 1.86, l: 4.5, h: 0.62, roof: 0.62, accel: 9.5,  brake: 16, top: 41, steer: 2.5, drag: 4.5 },
  { id: 'sport',  label: 'Coupe',    w: 1.90, l: 4.3, h: 0.52, roof: 0.44, accel: 14.5, brake: 19, top: 56, steer: 2.9, drag: 4.0 },
  { id: 'suv',    label: 'SUV',      w: 2.00, l: 4.8, h: 0.80, roof: 0.78, accel: 8.0,  brake: 14, top: 38, steer: 2.1, drag: 5.0 },
  { id: 'van',    label: 'Van',      w: 2.06, l: 5.2, h: 0.86, roof: 1.05, accel: 6.4,  brake: 12, top: 32, steer: 1.8, drag: 5.4 },
  { id: 'taxi',   label: 'Taxi',     w: 1.88, l: 4.6, h: 0.64, roof: 0.64, accel: 9.0,  brake: 15, top: 39, steer: 2.4, drag: 4.6 },
  { id: 'muscle', label: 'Muscle',   w: 1.96, l: 4.9, h: 0.58, roof: 0.50, accel: 13.0, brake: 15, top: 52, steer: 2.3, drag: 3.8 },
];

const PAINTS = [0xb4b8bf, 0x1d2027, 0x8c1f24, 0x1f3f74, 0x2f5c3a, 0xe0e3e8, 0x6a4a2a, 0xc8a13a, 0x3a3f46, 0x7a2f5a];
const GLASS = 0x0d1319, TYRE = 0x14161a, RIM = 0xb8bcc4, TRIM = 0x23262b;

/* two shared materials for every car in the city: one for the shell, one for the
   rubber. The colour of a particular car lives in its vertices. */
const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.52 });
const rubberMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.15 });
export const headMat = new THREE.MeshStandardMaterial({ color: 0xdfe0e4, emissive: 0xffe9b0, emissiveIntensity: 0, roughness: 0.3 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a1418, emissive: 0xff2a2a, emissiveIntensity: 0.15, roughness: 0.4 });

/* The beam on the road in front of a car. One shared material, so switching the
   headlights on at dusk is a single uniform rather than a walk of every car. */
export const beamMat = new THREE.ShaderMaterial({
  uniforms: { uStrength: { value: 0 }, uColor: { value: new THREE.Color(0xfff0cf) } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vQ;
    void main(){ vQ = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: `
    uniform float uStrength; uniform vec3 uColor; varying vec2 vQ;
    void main(){
      float along = vQ.y;                       // 0 at the bumper, 1 at the far end
      float spread = 0.16 + along * 0.84;       // the beam opens out as it goes
      float across = abs( vQ.x - 0.5 ) * 2.0 / spread;
      float a = max( 0.0, 1.0 - across );
      a *= a * ( 1.0 - smoothstep( 0.18, 1.0, along ) ) * smoothstep( 0.0, 0.10, along );
      if ( a * uStrength < 0.002 ) discard;
      gl_FragColor = vec4( uColor * a * uStrength, 1.0 );
    }`,
});
const beamGeo = new THREE.PlaneGeometry(1, 1);
beamGeo.rotateX(-Math.PI / 2);
beamGeo.translate(0, 0, 0.5);              // grows forward from the bumper

/* ---- merging ------------------------------------------------------------- */
function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return g;
}
function cyl(r, len, seg, axis, x, y, z) {
  const g = new THREE.CylinderGeometry(r, r, len, seg).toNonIndexed();
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
function merge(parts) {
  let n = 0;
  for (const p of parts) n += p.g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  const c = new THREE.Color();
  for (const p of parts) {
    const count = p.g.attributes.position.count;
    pos.set(p.g.attributes.position.array, o * 3);
    nor.set(p.g.attributes.normal.array, o * 3);
    c.setHex(p.c);
    for (let i = 0; i < count; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    o += count;
    p.g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
function mesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/* ---- the car ------------------------------------------------------------- */
export function makeCar(kind, rand, opts) {
  const r = rand || Math.random;
  const o = opts || {};
  const paint = PAINTS[(r() * PAINTS.length) | 0];
  const W = kind.w, L = kind.l, H = kind.h;
  const sill = 0.42;                                   // how high the floor sits

  const shell = [];
  shell.push({ g: box(W, H, L, 0, sill + H / 2, 0), c: paint });                      // body
  shell.push({ g: box(W * 0.995, 0.16, L * 0.99, 0, sill - 0.02, 0), c: TRIM });      // sill shadow
  // the greenhouse: narrower and set back, which is what makes it read as a car
  const rw = W * 0.86, rl = kind.id === 'van' ? L * 0.62 : L * 0.46;
  const rz = kind.id === 'van' ? -L * 0.04 : -L * 0.05;
  shell.push({ g: box(rw, kind.roof, rl, 0, sill + H + kind.roof / 2, rz), c: paint });
  shell.push({ g: box(rw * 1.006, kind.roof * 0.66, rl * 0.985, 0, sill + H + kind.roof * 0.36, rz), c: GLASS });
  // bonnet and boot creases
  shell.push({ g: box(W * 0.9, 0.06, L * 0.24, 0, sill + H + 0.02, L * 0.3), c: paint });
  shell.push({ g: box(W * 0.9, 0.06, L * 0.18, 0, sill + H + 0.02, -L * 0.34), c: paint });
  // bumpers
  shell.push({ g: box(W * 1.01, 0.22, 0.18, 0, sill + 0.2, L / 2 - 0.02), c: TRIM });
  shell.push({ g: box(W * 1.01, 0.22, 0.18, 0, sill + 0.2, -L / 2 + 0.02), c: TRIM });
  if (kind.id === 'taxi') {
    shell.push({ g: box(0.5, 0.16, 0.22, 0, sill + H + kind.roof + 0.09, rz), c: 0xffc83d });
  }

  const wheelParts = () => ([
    { g: cyl(0.34, 0.26, 14, 'x', 0, 0, 0), c: TYRE, rubber: true },
    { g: cyl(0.19, 0.28, 8, 'x', 0, 0, 0), c: RIM, rubber: true },
  ]);
  const wx = W / 2 - 0.05, wz = L * 0.33;
  const corners = [[-1, 1, true], [1, 1, true], [-1, -1, false], [1, -1, false]];

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const wheels = [];
  let tailRef = null;

  if (o.still) {
    // a parked car: everything in two meshes, and it never moves again
    for (const c of corners) {
      for (const part of wheelParts()) {
        part.g.translate(c[0] * wx, 0.34, c[1] * wz);
        shell.push(part);
      }
    }
    shell.push({ g: box(0.34, 0.14, 0.08, -W * 0.32, sill + H * 0.72, L / 2), c: 0xdfe0e4 });
    shell.push({ g: box(0.34, 0.14, 0.08, W * 0.32, sill + H * 0.72, L / 2), c: 0xdfe0e4 });
    shell.push({ g: box(0.30, 0.13, 0.07, -W * 0.34, sill + H * 0.72, -L / 2), c: 0x5a1418 });
    shell.push({ g: box(0.30, 0.13, 0.07, W * 0.34, sill + H * 0.72, -L / 2), c: 0x5a1418 });
    body.add(mesh(merge(shell.filter(p => !p.rubber)), shellMat));
    body.add(mesh(merge(shell.filter(p => p.rubber)), rubberMat));
  } else {
    body.add(mesh(merge(shell), shellMat));
    // the lights keep their own materials, because they have to light up
    body.add(mesh(merge([
      { g: box(0.34, 0.14, 0.08, -W * 0.32, sill + H * 0.72, L / 2), c: 0xffffff },
      { g: box(0.34, 0.14, 0.08, W * 0.32, sill + H * 0.72, L / 2), c: 0xffffff },
    ]), headMat));
    tailRef = tailMat.clone();
    body.add(mesh(merge([
      { g: box(0.30, 0.13, 0.07, -W * 0.34, sill + H * 0.72, -L / 2), c: 0xffffff },
      { g: box(0.30, 0.13, 0.07, W * 0.34, sill + H * 0.72, -L / 2), c: 0xffffff },
    ]), tailRef));
    for (const c of corners) {
      const hub = new THREE.Group();
      hub.position.set(c[0] * wx, 0.34, c[1] * wz);
      const m = mesh(merge(wheelParts()), rubberMat);
      hub.add(m);
      body.add(hub);
      wheels.push({ hub, spin: m, steers: c[2] });
    }
  }

  let beam = null;
  if (!o.still) {
    beam = new THREE.Mesh(beamGeo, beamMat);
    beam.scale.set(7.5, 1, 13);
    beam.position.set(0, 0.05, L / 2);
    beam.frustumCulled = false;
    group.add(beam);
  }

  const car = {
    kind, group, body, wheels, beam, still: !!o.still, paintColor: paint,
    pos: new THREE.Vector3(), yaw: 0, speed: 0, slip: 0, roll: 0,
    wheelSpin: 0, steerVis: 0, driver: null, hp: 140,
    apply() {
      group.position.copy(this.pos);
      group.rotation.y = this.yaw;
      if (this.still) return;
      body.rotation.z = this.roll;
      body.rotation.x = -Math.max(-0.05, Math.min(0.05, this.speed * 0.0016));
      for (const w of this.wheels) {
        w.hub.rotation.y = w.steers ? this.steerVis : 0;
        w.spin.rotation.x = this.wheelSpin;
      }
      if (tailRef) {
        const braking = this.driver && this.speed > 0.5 && (window.__gtaBrake || false);
        tailRef.emissiveIntensity = braking ? 1.8 : 0.15 + headMat.emissiveIntensity * 0.25;
      }
    },
    // a wreck stops being a colour and starts being a burnt shape
    char() {
      for (const c of body.children) {
        if (!c.geometry || !c.geometry.attributes.color) continue;
        const a = c.geometry.attributes.color;
        for (let i = 0; i < a.count; i++) {
          a.setXYZ(i, a.getX(i) * 0.18, a.getY(i) * 0.17, a.getZ(i) * 0.16);
        }
        a.needsUpdate = true;
      }
    },
  };
  car.apply();
  return car;
}
