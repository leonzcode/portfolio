// The sky, the sun and the light the car is lit by. A physical sky (three's Preetham Sky) with the sun at a
// mid-afternoon height, its picture made into the scene's environment (what the paint and glass reflect), a
// hazy fog towards the horizon, and the sun's shadow box following the camera's target.
import * as THREE from 'three';
import { Sky as SkyMesh } from 'three/addons/objects/Sky.js';

export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.mesh = new SkyMesh(); this.mesh.scale.setScalar(150000);
    const u = this.mesh.material.uniforms;
    u.turbidity.value = 3.2; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    this.mesh.material.fog = false;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xfff3e2, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const S = 45;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 400 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b6157, 0.9);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xbcd0e6, 0.00009);

    this.dir = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.clouds = makeClouds();
    scene.add(this.clouds);
    this.setSun(48, 215);
  }

  // elevation and azimuth in degrees (azimuth clockwise from north)
  setSun(elev, az) {
    const e = THREE.MathUtils.degToRad(elev), a = THREE.MathUtils.degToRad(az);
    this.dir.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
    this.mesh.material.uniforms.sunPosition.value.copy(this.dir).multiplyScalar(1000);
    this.clouds.material.uniforms.uSun.value.copy(this.dir);
    this.makeEnv();
  }

  makeEnv() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const s = new THREE.Scene();
    const m = new SkyMesh(); m.scale.setScalar(1000);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) m.material.uniforms[k].value = this.mesh.material.uniforms[k].value;
    m.material.uniforms.sunPosition.value.copy(this.dir).multiplyScalar(1000);
    s.add(m);
    // a dim ground under the horizon so the underside of the car is not lit by sky
    const g = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.02, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a4640, side: THREE.BackSide }));
    s.add(g);
    if (this.env) this.env.dispose();
    this.env = pm.fromScene(s, 0.02).texture;
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.85;
    pm.dispose();
  }

  // keep the shadow box round what the camera looks at (the car), snapped to texels so edges do not crawl
  update(camera, focus) {
    const f = focus || camera.position;
    const S = this.sun.shadow.camera.right, texel = (2 * S) / this.sun.shadow.mapSize.x;
    this.focus.set(Math.round(f.x / texel) * texel, Math.round(f.y / texel) * texel, Math.round(f.z / texel) * texel);
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(this.dir, 200);
    this.sun.target.updateMatrixWorld();
    this.mesh.position.copy(camera.position);
    // the cloud deck follows the camera across, its pattern stays put in the world (and drifts with the wind)
    this.clouds.position.set(camera.position.x, 1500, camera.position.z);
    this.clouds.material.uniforms.uTime.value = performance.now() / 1000;
  }
}

// A deck of fair-weather cumulus 1.5 km up: fbm noise on the deck's world position, thresholded to a coverage,
// lit from the sun's side and darker underneath, thinning towards the horizon so it melts into the haze.
function makeClouds() {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uCover: { value: 0.47 } },
    vertexShader: /* glsl */`
      varying vec3 vW;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uTime, uCover;
      varying vec3 vW;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vW.xz / 2600.0 + vec2(uTime * 0.0035, uTime * 0.0012);
        float d = fbm(p) * 0.75 + fbm(p * 3.1 + 5.0) * 0.25;
        float c = smoothstep(uCover, uCover + 0.17, d);
        if (c < 0.01) discard;
        // light: brighter where the cloud's sunward side is (the density falls towards the sun)
        float ds = fbm(p + uSun.xz * 0.06) * 0.75 + fbm((p + uSun.xz * 0.06) * 3.1 + 5.0) * 0.25;
        float lit = clamp(0.62 + (d - ds) * 3.0, 0.35, 1.0);
        vec3 col = mix(vec3(0.62, 0.66, 0.72), vec3(1.0, 0.99, 0.97), lit);
        // thin out towards the horizon (distance across the deck from under the camera)
        float far = length(vW.xz - cameraPosition.xz);
        float fade = 1.0 - smoothstep(9000.0, 22000.0, far);
        gl_FragColor = vec4(col, c * 0.92 * fade);
      }`,
  });
  const g = new THREE.PlaneGeometry(50000, 50000, 1, 1);
  g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = -1; mesh.name = 'clouds';
  return mesh;
}
