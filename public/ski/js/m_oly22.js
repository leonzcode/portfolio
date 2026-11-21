/* (O, round 12) Genting 2022: a map of the slopestyle course built at Genting Snow Park, Chongli, for the 2022 Winter
   Games, and the place round it. The ground (m_olyland.js), the course (m_olycourse.js), what stands on and round it
   (m_olybuild.js), and here: the map's hooks into the game (the mountain hook terrain.js reads, the bare ground in the
   snow's shader, the chairlift beside the course, the trees, the far hills).

   main.js asks for makeGenting(q, say) when the map is 'genting2022' and uses what it returns:
     { mtn, park, land, makeLift(scene, q), dress(scene, mats, q, forest), runOverAt(p) }
   The map's name on screen is the place and the year only. */
import * as THREE from 'three';
import { setMountain } from './terrain.js?v=33';
import { LOOK, snowUniforms } from './materials.js?v=33';
import { setSunPath } from './env.js?v=33';
import { liftLines, planWorldLifts, WorldLifts } from './wlift.js?v=33';
import { loadLand, makeFarHills, plantTrees, makeTrees, CORRIDOR } from './m_olyland.js?v=33';
import { setProfile, makeCourse } from './m_olycourse.js?v=33';
import { buildVenue } from './m_olybuild.js?v=33';
import { smoothstep } from './noise.js?v=33';

export const MAP_ID = 'genting2022';
export const MAP_NAME = 'Beijing 2022 Olympics';   // (2026-11-20, Leon's name for it)
export const MAP_SUB = 'based on the slopestyle course built there for the 2022 Winter Games';

/* the bare ground, in the snow's shader (materials.js calls LOOK.hook(shader, detail) when it compiles the snow, the
   key making it a program of its own, so no other map's snow changes): where the cover picture (m_olyland.js
   snowTexture: r how much snow, g the grass's tone, b soil) has none, dry grass and soil, with no glints and the rock's
   roughness; the course and anything groomed is always snow */
function bareHook(tex, win) {
  snowUniforms.uBare = { value: tex }; snowUniforms.uBareWin = { value: win };
  LOOK.key = 'G22';
  LOOK.hook = (s) => {
    s.uniforms.uBare = snowUniforms.uBare; s.uniforms.uBareWin = snowUniforms.uBareWin;
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uBare; uniform vec4 uBareWin;')
      .replace('#include <roughnessmap_fragment>', `{
  vec2 bu = (vWPos.xz - uBareWin.xy) * uBareWin.z;
  bool inW = bu.x > 0.0 && bu.x < 1.0 && bu.y > 0.0 && bu.y < 1.0;
  vec4 bm = inW ? texture2D(uBare, bu) : vec4(0.3, 0.5, 0.5, 0.0);
  // (the edge of the snow broken up, crisp near by)
  float nz = texture2D(uNoise, vWPos.xz * 0.045).b + texture2D(uNoise, vWPos.xz * 0.23).b * 0.45 - 0.72;
  float bare = (1.0 - smoothstep(0.36, 0.64, bm.r + nz * 0.32)) * (1.0 - vGroom);
  float camG = length(vWPos - cameraPosition);
  if (bare > 0.002) {
    // (the dry grass of the hills, a warm dark brown, browner and darker where the soil shows: the photos' hills)
    vec3 grass = mix(vec3(0.062, 0.04, 0.028), vec3(0.15, 0.092, 0.058), bm.g);
    grass = mix(grass, vec3(0.06, 0.036, 0.022), smoothstep(0.55, 0.9, bm.b) * 0.65);
    grass *= 0.8 + 0.4 * texture2D(uNoise, vWPos.xz * 0.7 + 0.3).b;
    diffuseColor.rgb = mix(diffuseColor.rgb, grass, bare);
    gRock = max(gRock, bare);
  }
  /* what grows on it, seen from afar (the trees' cards stop at 1.4 km): the bare larch woods red-brown, over snow or
     grass; the slopes planted with young pines in rows of dark dots along the hill, as the footage shows them */
  float veg = (1.0 - vGroom) * smoothstep(0.0, 1.0, 1.0 - vGroom);
  if (veg > 0.01 && bm.a > 0.2) {
    if (bm.a < 0.75) {
      float w = smoothstep(0.25, 0.4, bm.a) * (0.55 + 0.45 * texture2D(uNoise, vWPos.xz * 0.11 + 0.5).b);
      vec3 wood = mix(vec3(0.1, 0.07, 0.055), vec3(0.2, 0.13, 0.095), texture2D(uNoise, vWPos.xz * 0.37).b);
      diffuseColor.rgb = mix(diffuseColor.rgb, wood, w * veg * 0.85);
    } else {
      /* (young pines planted along the contours: rows about 2 m apart up the hill, following its height lines, broken up
         by a fine speckle of trees; from afar a dark mottle over the hill, as the photos show the planted slopes) */
      float rowsA = fract(vWPos.y / 1.9 + texture2D(uNoise, vWPos.xz * 0.012).b * 0.8);
      float rows = mix(0.55, 1.0, 1.0 - smoothstep(0.16, 0.36, abs(rowsA - 0.5)));
      float speck = smoothstep(0.38, 0.6, texture2D(uNoise, vWPos.xz * 0.55 + 0.17).b) * (0.7 + 0.3 * texture2D(uNoise, vWPos.xz * 2.1).b);
      float far = smoothstep(250.0, 1200.0, camG);
      float dens = mix(rows * speck, 0.5 + 0.25 * texture2D(uNoise, vWPos.xz * 0.02).b, far);
      float k = dens * smoothstep(0.75, 0.95, bm.a) * veg * (0.25 + 0.75 * smoothstep(0.2, 0.7, bare + far * 0.35));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.026, 0.034, 0.026), clamp(k, 0.0, 1.0) * 0.92);
    }
  }
  /* the course's built faces in snow bricks (the takeoffs' upright sides, the steps' faces, as the builders cut them):
     on anything steeper than about 55 degrees on the course, rows 0.3 m high, bricks 0.6 m long, the joints pale grey */
  {
    vec3 wn = normalize(vWNor);
    float bk = (1.0 - smoothstep(0.5, 0.62, abs(wn.y))) * (1.0 - smoothstep(48.0, 56.0, abs(vWPos.x))) * step(-60.0, vWPos.z) * step(vWPos.z, 255.0) * (1.0 - smoothstep(30.0, 90.0, camG));
    if (bk > 0.001) {
      vec2 t = normalize(vec2(-wn.z, wn.x) + vec2(1e-5));
      float hh = dot(vWPos.xz, t), yy = vWPos.y / 0.3, row = floor(yy);
      float xx = (hh + mod(row, 2.0) * 0.3) / 0.6, fy = fract(yy), fx = fract(xx);
      float ly = fwidth(yy) * 1.2 + 0.06, lx = fwidth(xx) * 1.2 + 0.035;
      float mortar = max(1.0 - smoothstep(0.0, ly, min(fy, 1.0 - fy)), 1.0 - smoothstep(0.0, lx, min(fx, 1.0 - fx)));
      float tone = 0.96 + 0.06 * texture2D(uNoise, vec2(floor(xx), row) * 0.137).b;
      diffuseColor.rgb = mix(diffuseColor.rgb * tone, diffuseColor.rgb * vec3(0.8, 0.84, 0.9), mortar * 0.75) * mix(1.0, 1.0, bk);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb, 1.0 - bk);
    }
  }
}
#include <roughnessmap_fragment>`);
  };
}

/* the sun where it really was over the venue on the snowboard final's day, 7 February 2022: latitude 40.95, declination
   -15.6 degrees, the clock China's (120 degrees east) against the venue's 115.41 and the equation of time (-14 min): noon
   at 12:33, 33 degrees high in the south; turned into the course's frame (+z down the course, azimuth 38.5) */
function realSun() {
  const lat = 40.95 * Math.PI / 180, dec = -15.6 * Math.PI / 180, a0 = 38.51 * Math.PI / 180, ca = Math.cos(a0), sa = Math.sin(a0);
  setSunPath((t, out) => {
    const H = (t - 12.55) * 15 * Math.PI / 180;
    const sel = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H), el = Math.asin(sel);
    const A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
    const E = Math.sin(A), N = Math.cos(A), ce = Math.cos(el);
    out.set((-E * ca + N * sa) * ce, sel, (E * sa + N * ca) * ce).normalize();
    return { el: el * 180 / Math.PI, dir: out };
  });
}

export async function makeGenting(q, say = () => Promise.resolve()) {
  realSun();
  const land = await loadLand(import.meta.url);
  await say('Laying out the course', 0.3);
  setProfile();
  land.setCourse(); land.buildSnow();
  // ---- the mountain hook: the ground, what the snow is, the trees the Forest draws (the row of dark pines along the wall)
  let park = null;
  const groom = (x, z) => (1 - smoothstep(CORRIDOR.half - 6, CORRIDOR.half, Math.abs(x))) * smoothstep(CORRIDOR.z0 - 10, CORRIDOR.z0 + 20, z) * (1 - smoothstep(CORRIDOR.z1 - 30, CORRIDOR.z1, z));
  const mtn = {
    bare: true, at: land.at, land,
    surface: (x, z) => park && park.surface(x, z) ? 2 : groom(x, z) > 0.5 ? 0 : 1,
    groom: (x, z) => Math.max(groom(x, z), land.runAt ? land.runAt(x, z) * 0.8 : 0),
    spot: { treeline: 9999 },
    // (a row of dark conifers stands just outside the Great Wall, on the rider's left, in the drone footage)
    trees: () => [],
  };
  if (q && q.tier === 'low') mtn.lodK = 0.85;
  setMountain(mtn);
  park = makeCourse(land);
  park.mapName = MAP_NAME;
  await say('Shaping the snow', 0.34);
  land.clear = (x, z) => (Math.abs(x) < 70 && z > -90 && z < 830) || (x < -40 && x > -190 && z > 330 && z < 700);
  const cover = land.snowTexture(q && q.tier === 'low' ? 256 : 512);   // (Low: 20 m texels; it is the far ground's cover)
  bareHook(cover.tex, cover.win);
  // ---- the chairlift on the rider's right (OpenStreetMap's "6"), the way back up: its line in the course's frame
  const L6 = land.osm && land.osm.lifts.find(l => /^6/.test(l.name) && l.kind === 'chair_lift');
  let planned = null;
  if (L6) {
    const lines = liftLines([{ name: 'Lift 6', kind: 'chair_lift', pts: L6.pts.map(([x, z]) => ({ x, z })) }], () => true, 2);
    if (lines.length) {
      lines.length = 1;
      planned = planWorldLifts(park, lines);
      const H = park.height.bind(park), HT = park.heightTerrainOnly.bind(park), SU = park.surface.bind(park);
      park.height = (x, z, g) => { const a = H(x, z, g), b = planned.padAt(x, z, g, false); return b > a ? b : a; };
      park.heightTerrainOnly = (x, z, g) => { const a = HT(x, z, g), b = planned.padAt(x, z, g, true); return b > a ? b : a; };
      park.surface = (x, z) => SU(x, z) || planned.surf(x, z);
      const P = planned.plans[0], lx = P.plan.XL - 8, lz = P.plan.top.front + 10;
      park.starts.push({ name: 'Top of Lift 6', x: P.F.wx(lx, lz), z: P.F.wz(lx, lz), v: 2, yaw: P.F.th - 0.25 });
    }
  }
  park.hasLift = true;
  /* the lamps (env.js lightTowers): the course had none along it; two short rows by the finish corral, where the
     grandstand and the venue's buildings are lit (without these, env.js would put a row of towers down each side) */
  const Fz = park.course.finish;
  park.lightTowers = [{ x0: Fz.x0 - 6, z0: Fz.z0 + 8, dx: 0, dz: 30, n: 3, ax: 1, az: 0, h: 12, power: 120 }, { x0: Fz.x1 + 6, z0: Fz.z0 + 8, dx: 0, dz: 30, n: 3, ax: -1, az: 0, h: 12, power: 120 }];
  // (the finish: past the corral's end a run is over, and the lift takes you up)
  const F = park.course.finish;
  const runOverAt = p => p.z > F.z1 - 6 && Math.abs(p.x) < 60;
  // the course's clear ground (no trees): the corridor, the finish, the halfpipe beside it
  park.course.clear = (x, z) => (Math.abs(x) < 70 && z > -90 && z < 830) || (x < -40 && x > -190 && z > 330 && z < 700);
  return {
    mtn, park, land, planned, runOverAt,
    makeLift(scene, q2) {
      if (!planned) return null;
      const lift = new WorldLifts(scene, planned, q2);
      // (the end of the run takes you onto the lift's chair, as the other maps' lifts do)
      lift.boardNow = sk => lift.board(0, sk);
      lift.pastBottom = runOverAt;
      return lift;
    },
    dress(scene, mats, q2, forest) {
      makeFarHills(scene, q2, land);
      const list = plantTrees(land, q2, park.course);
      // (a band of dark young pines planted in four rows a few metres outside the Great Wall, on the rider's left, about
      // 2.5 to 3.5 m tall, beside sections 2 and 3: the drone preview's plan view of section 2)
      { let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
        for (const x0 of [35.5, 38.0, 40.5, 43.0]) for (let z = 62 + r() * 2; z < 250; z += 2.2 + r() * 0.8) { const x = x0 + (r() - 0.5) * 0.8; list.push({ x, y: land.at(x, z) - 0.2, z, s: 2.4 + r() * 1.2, k: 2, rot: r() * 6.28 }); } }
      makeTrees(scene, q2, list);
      // (the trees near the course are ridden into, as the Forest's are)
      if (forest && forest.grid) for (const t of list) { if (Math.abs(t.x) > 160 || t.z < -200 || t.z > 900) continue; const k = Math.floor(t.x / 8) + ',' + Math.floor(t.z / 8); if (!forest.grid.has(k)) forest.grid.set(k, []); forest.grid.get(k).push({ x: t.x, y: t.y, z: t.z, s: t.s * 0.8 }); }
      buildVenue(scene, park, q2, land);
      // (the sky over the venue in the photos is a deep clear blue: the dome's colour turned up from 1.4, this map only)
      { const dome = scene.getObjectByName('sky'); const u = dome && dome.material && dome.material.uniforms; if (u && u.uSat) u.uSat.value = 1.85; }
    },
  };
}
