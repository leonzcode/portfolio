/* ---------------------------------------------------------------------------
   The gun shop.

   Three of them, on corners, marked with a column of light like everything else
   you can walk into. Stand in one and the counter comes up; the number keys buy.
   It exists to close the loop: jobs pay cash, cash buys the ammunition you spent
   getting paid.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { CITY } from './city.js';

const roadAt = i => -CITY.half + i * CITY.pitch;

function column(hex, r, h) {
  const g = new THREE.CylinderGeometry(r, r, h, 20, 1, true);
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(hex) } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vQ;
      void main(){ vQ = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `
      uniform vec3 uColor; varying vec2 vQ;
      void main(){
        float up = 1.0 - vQ.y;
        float a = up * up * 0.5 + 0.05;
        gl_FragColor = vec4( uColor * a, a );
      }`,
  }));
  m.position.y = h / 2;
  const holder = new THREE.Group();
  holder.add(m);
  return holder;
}

export function makeShops(ctx) {
  const { scene, player, groundAt, weapons, hint, say, snd } = ctx;
  const spots = [];
  const where = [[4, 1], [1, 5], [7, 6]];
  for (const w of where) {
    const x = roadAt(w[0]) + CITY.road / 2 + 3.2;
    const z = roadAt(w[1]) + CITY.road / 2 + 3.2;
    const c = column(0x66ff9a, 1.7, 3.0);
    c.position.set(x, groundAt(x, z), z);
    scene.add(c);
    spots.push({ x, z, obj: c });
  }

  // what is on the shelf: the id matches a weapon, or armour
  const STOCK = [
    { id: 'pistol', label: 'Pistol rounds', rounds: 48, cost: 90 },
    { id: 'smg', label: 'SMG rounds', rounds: 120, cost: 150 },
    { id: 'shotgun', label: 'Shotgun shells', rounds: 24, cost: 130 },
    { id: 'rifle', label: 'Rifle rounds', rounds: 90, cost: 200 },
    { id: 'sniper', label: 'Sniper rounds', rounds: 15, cost: 280 },
    { id: 'grenade', label: 'Grenades', rounds: 4, cost: 350 },
    { id: 'armour', label: 'Body armour', cost: 500 },
  ];

  let near = false;
  function step(dt, t) {
    for (const s of spots) s.obj.rotation.y = t * 0.5;
    const d = spots.reduce((m, s) => Math.min(m, Math.hypot(s.x - player.pos.x, s.z - player.pos.z)), 1e9);
    const now = d < 3.2 && !player.car;
    if (now !== near) near = now;
    return near;
  }

  function buy(n) {
    const it = STOCK[n];
    if (!it) return false;
    if (player.cash < it.cost) { hint('Not enough cash'); return false; }
    if (it.id === 'armour') {
      if (player.armour >= 100) { hint('Already wearing it'); return false; }
      player.armour = 100;
    } else {
      const w = weapons.find(q => q.id === it.id);
      if (!w) return false;
      w.ammo += it.rounds;
    }
    player.cash -= it.cost;
    if (snd) snd.pickup();
    say('<b>Bought</b> ' + it.label.toLowerCase() + ' for $' + it.cost, 'sys');
    return true;
  }

  function panel() {
    let html = '<div class="t">Gun shop</div>';
    STOCK.forEach((it, i) => {
      const can = player.cash >= it.cost;
      html += '<div class="r' + (can ? '' : ' no') + '"><b>' + (i + 1) + '</b>'
        + '<span>' + it.label + '</span><i>$' + it.cost + '</i></div>';
    });
    return html;
  }

  return { step, buy, panel, spots, stock: STOCK, get near() { return near; } };
}
