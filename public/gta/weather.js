/* ---------------------------------------------------------------------------
   Weather.

   Clear, overcast, or raining, drifting between the three over the course of a
   few minutes. The rain is one instanced mesh of a couple of thousand streaks
   whose whole animation lives in the vertex shader: the CPU sets a time and the
   camera position, and every drop works out where it is from there. Nothing is
   updated per drop per frame, which is why it can rain heavily and cost nothing.

   The rest of the effect is not the drops at all. It is the sky going flat, the
   fog closing in, the tarmac turning to a mirror, and once in a while the whole
   street going white for a fifth of a second.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

const N = 2600;
const BOX = 44;          // how wide a volume of rain follows the camera
const TALL = 30;

export function makeWeather(scene) {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(0.03, 0.62);
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  geo.setIndex(quad.index);
  const off = new Float32Array(N * 3), spd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    off[i * 3] = (Math.random() - 0.5) * BOX;
    off[i * 3 + 1] = Math.random() * TALL;
    off[i * 3 + 2] = (Math.random() - 0.5) * BOX;
    spd[i] = 0.8 + Math.random() * 0.5;
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('aSpd', new THREE.InstancedBufferAttribute(spd, 1));
  geo.instanceCount = N;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() },
      uAmount: { value: 0 }, uTint: { value: new THREE.Color(0xc8d6e4) },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aOff;
      attribute float aSpd;
      uniform float uTime, uAmount;
      uniform vec3 uCenter;
      varying vec2 vQ;
      varying float vKeep;
      void main(){
        vQ = uv;
        // only as many drops as the weather calls for, chosen by instance
        vKeep = step( fract( aOff.x * 12.9898 + aOff.z * 78.233 ), uAmount ) ;
        float fall = 26.0 * aSpd;
        float y = mod( aOff.y - uTime * fall, ${TALL}.0 );
        vec3 base = vec3( uCenter.x + aOff.x, uCenter.y + y - ${TALL / 3}.0, uCenter.z + aOff.z );
        base.x += y * 0.10;                        // the wind leans it over
        // the streak stands upright but turns to face the camera
        vec3 right = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
        vec3 world = base + right * position.x * 1.0 + vec3( 0.0, position.y, 0.0 );
        gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
      }`,
    fragmentShader: `
      uniform vec3 uTint; uniform float uAmount;
      varying vec2 vQ; varying float vKeep;
      void main(){
        if ( vKeep < 0.5 || uAmount < 0.01 ) discard;
        float a = ( 1.0 - abs( vQ.x - 0.5 ) * 2.0 ) * ( 0.25 + vQ.y * 0.75 );
        gl_FragColor = vec4( uTint * a * 0.34, a * 0.34 );
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  /* ---- the cycle --------------------------------------------------------- */
  let want = 0, have = 0, hold = 40 + Math.random() * 90;
  let flash = 0, boomIn = -1;

  function step(dt, camera, night, onThunder) {
    mat.uniforms.uTime.value += dt;
    mat.uniforms.uCenter.value.copy(camera.position);
    mat.uniforms.uTint.value.setHSL(0.58, 0.12, night ? 0.45 : 0.86);

    hold -= dt;
    if (hold <= 0) {
      // clear more often than not, and rain about one spell in four
      const roll = Math.random();
      want = roll < 0.5 ? 0 : roll < 0.75 ? 0.25 : roll < 0.93 ? 0.7 : 1;
      hold = 60 + Math.random() * 150;
    }
    have += (want - have) * Math.min(1, dt * 0.12);
    mat.uniforms.uAmount.value = have;

    // thunder, but only in the heavy stuff
    if (have > 0.55 && Math.random() < dt * 0.035) {
      flash = 0.22;
      boomIn = 0.4 + Math.random() * 1.8;
    }
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (boomIn > 0) {
      boomIn -= dt;
      if (boomIn <= 0) { boomIn = -1; if (onThunder) onThunder(); }
    }
    return { rain: have, flash: flash > 0 ? Math.min(1, flash / 0.12) : 0 };
  }

  return {
    mesh, step,
    get rain() { return have; },
    set(v) { want = v; have = v; hold = 120; },
  };
}
