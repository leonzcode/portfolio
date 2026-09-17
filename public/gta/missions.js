/* ---------------------------------------------------------------------------
   Jobs.

   Four markers stand on street corners. Walk into one and it gives you something
   to do with a clock on it: run a car across town, pick up a handful of packages,
   go and find somebody, or put a car round four checkpoints. Finish and you get
   paid; run out of time and you do not.

   The markers are the GTA idiom: a column of light you can see from the far end
   of the street, and a matching blip on the map. Everything else here is a timer
   and a distance check.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { CITY } from './city.js';

const roadAt = i => -CITY.half + i * CITY.pitch;

/* a column of light, which is what a marker in this kind of game looks like */
const markerMat = (hex) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(hex) } },
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vQ;
    void main(){ vQ = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: `
    uniform vec3 uColor; varying vec2 vQ;
    void main(){
      float up = 1.0 - vQ.y;                    // brightest at the ground
      float a = up * up * 0.55 + 0.06;
      gl_FragColor = vec4( uColor * a, a );
    }`,
});

function column(hex, r, h) {
  const g = new THREE.CylinderGeometry(r, r, h, 20, 1, true);
  const m = new THREE.Mesh(g, markerMat(hex));
  m.position.y = h / 2;
  const holder = new THREE.Group();
  holder.add(m);
  holder.userData.spin = m;
  return holder;
}

const JOB_TITLES = {
  deliver: 'Move the car',
  courier: 'Pick up the packages',
  hit: 'Find the target',
  race: 'Round the checkpoints',
};

export function makeMissions(ctx) {
  const { scene, player, groundAt, hint, say, traffic } = ctx;
  const spots = [];
  const marks = [];                   // live objective markers
  let job = null;

  // four job markers, one in each quarter of the city
  const where = [[2, 2], [6, 2], [2, 6], [6, 6]];
  for (const w of where) {
    const x = roadAt(w[0]) + CITY.road / 2 + 3.5;
    const z = roadAt(w[1]) + CITY.road / 2 + 3.5;
    const c = column(0xffd23f, 1.7, 3.2);
    c.position.set(x, groundAt(x, z), z);
    scene.add(c);
    spots.push({ x, z, obj: c });
  }

  function addMark(x, z, hex, r) {
    const c = column(hex === undefined ? 0x5ee0ff : hex, r || 1.7, 3.2);
    c.position.set(x, groundAt(x, z), z);
    scene.add(c);
    const m = { x, z, obj: c };
    marks.push(m);
    return m;
  }
  function clearMarks() {
    for (const m of marks) scene.remove(m.obj);
    marks.length = 0;
  }

  function randomRoadPoint(minFrom) {
    for (let i = 0; i < 40; i++) {
      const onX = Math.random() < 0.5;
      const line = roadAt((Math.random() * (CITY.grid + 1)) | 0);
      const along = (Math.random() - 0.5) * (CITY.grid * CITY.pitch);
      const x = onX ? line : along, z = onX ? along : line;
      if (Math.hypot(x - player.pos.x, z - player.pos.z) > (minFrom || 80)) return [x, z];
    }
    return [0, 0];
  }

  function start(kind) {
    clearMarks();
    const pay = { deliver: 900, courier: 650, hit: 1200, race: 1400 }[kind];
    job = { kind, pay, t: 0, limit: 0, done: 0, need: 1, title: JOB_TITLES[kind] };
    if (kind === 'deliver') {
      const p = randomRoadPoint(110);
      job.limit = 105;
      job.text = 'Bring a car to the drop';
      addMark(p[0], p[1], 0x5ee0ff, 3.2);
    } else if (kind === 'courier') {
      job.limit = 110; job.need = 3;
      job.text = 'Collect 3 packages';
      for (let i = 0; i < 3; i++) { const p = randomRoadPoint(40); addMark(p[0], p[1], 0x9affa0, 1.6); }
    } else if (kind === 'hit') {
      job.limit = 130;
      const list = traffic ? traffic.peds.filter(q => !q.dead) : [];
      job.target = list[(Math.random() * list.length) | 0] || null;
      job.text = 'Deal with the target';
      if (job.target) job.mark = addMark(job.target.g.position.x, job.target.g.position.z, 0xff6a6a, 1.6);
    } else {
      job.limit = 95; job.need = 4; job.order = true;
      job.text = 'Four checkpoints, in a car';
      for (let i = 0; i < 4; i++) { const p = randomRoadPoint(60 + i * 20); addMark(p[0], p[1], 0xffd23f, 3.0); }
      for (let i = 1; i < marks.length; i++) marks[i].obj.visible = false;
    }
    say('<b>Job</b> ' + job.text + ' &middot; $' + job.pay, 'sys');
    hint(job.text);
  }

  function finish(won) {
    if (!job) return;
    if (won) {
      player.cash += job.pay;
      say('<b>Paid</b> $' + job.pay + ' for that one.', 'sys');
      hint('Job done, $' + job.pay);
      if (ctx.snd) ctx.snd.pickup();
    } else {
      say('Job failed.', 'sys');
      hint('Out of time');
    }
    job = null;
    clearMarks();
  }

  function step(dt) {
    const t = performance.now() / 1000;
    for (const s of spots) {
      s.obj.rotation.y = t * 0.6;
      s.obj.visible = !job;
    }
    for (const m of marks) m.obj.rotation.y = -t * 0.8;

    const px = player.car ? player.car.pos.x : player.pos.x;
    const pz = player.car ? player.car.pos.z : player.pos.z;

    if (!job) {
      for (const s of spots) {
        if (Math.hypot(s.x - px, s.z - pz) < 2.4 && !player.car) {
          const kinds = ['deliver', 'courier', 'hit', 'race'];
          start(kinds[(Math.random() * kinds.length) | 0]);
          break;
        }
      }
      return;
    }

    job.t += dt;
    if (job.t > job.limit) { finish(false); return; }

    if (job.kind === 'deliver') {
      const m = marks[0];
      if (m && player.car && Math.hypot(m.x - px, m.z - pz) < 4.5) { finish(true); return; }
    } else if (job.kind === 'courier') {
      for (let i = marks.length - 1; i >= 0; i--) {
        if (Math.hypot(marks[i].x - px, marks[i].z - pz) < 2.6) {
          scene.remove(marks[i].obj);
          marks.splice(i, 1);
          job.done++;
          if (ctx.snd) ctx.snd.pickup();
          hint('Package ' + job.done + ' of ' + job.need);
        }
      }
      if (!marks.length) { finish(true); return; }
    } else if (job.kind === 'hit') {
      if (!job.target) { finish(false); return; }
      if (job.mark) {
        job.mark.x = job.target.g.position.x;
        job.mark.z = job.target.g.position.z;
        job.mark.obj.position.set(job.mark.x, groundAt(job.mark.x, job.mark.z), job.mark.z);
      }
      if (job.target.dead) { finish(true); return; }
    } else if (job.kind === 'race') {
      const m = marks[0];
      if (m && player.car && Math.hypot(m.x - px, m.z - pz) < 5) {
        scene.remove(m.obj);
        marks.shift();
        job.done++;
        if (marks.length) { marks[0].obj.visible = true; hint('Checkpoint ' + job.done + ' of ' + job.need); }
        else { finish(true); return; }
      }
    }
  }

  return {
    step, start, finish,
    get job() { return job; },
    get spots() { return spots; },
    get marks() { return marks; },
    hud() {
      if (!job) return '';
      const left = Math.max(0, job.limit - job.t);
      return job.title.toUpperCase() + ' &middot; <b>' + left.toFixed(0) + 's</b>'
        + (job.need > 1 ? ' &middot; ' + job.done + '/' + job.need : '')
        + ' &middot; $' + job.pay;
    },
  };
}
