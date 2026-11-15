/* Bakes the land cover of Leon Freeski's built-in Any mountain places (woods, scrub, lakes, rock, scree, glaciers,
   cliffs, trees, tree rows, boulders, buildings, halfpipes) from OpenStreetMap (ODbL) into
   public/ski/data/world/<preset>.json, so those places need no live map server for it.

   node tools/ski/bake_world_land.cjs [cacheDir] [preset,preset...]

   Uses only the maps.mail.ru Overpass mirror (overpass-api.de fails TLS on Leon's machine), one request at a time,
   three requests a place (public/ski/js/wlanddata.js landQueryParts), every answer kept in cacheDir (default
   ./.overpass-cache) so a second run asks for nothing; a busy mirror is waited for (30 s, 60 s, 120 s ...). The same
   wlanddata.js the game runs turns the answers into the file. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const CACHE = path.resolve(process.argv[2] || path.join(ROOT, '.overpass-cache'));
const ONLY = (process.argv[3] || '').split(',').filter(Boolean);
const MIRROR = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const wait = ms => new Promise(r => setTimeout(r, ms));
const esm = f => import('data:text/javascript;charset=utf-8,' + encodeURIComponent(fs.readFileSync(path.join(ROOT, f), 'utf8')));

// the game's local frame (public/ski/js/wdem.js Frame)
const C = 40075016.686, DEG = Math.PI / 180;
const lon2mx = lon => (lon + 180) / 360;
const lat2my = lat => { const s = Math.sin(Math.max(-85, Math.min(85, lat)) * DEG); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
function frame(lat0, lon0) { const mx0 = lon2mx(lon0), my0 = lat2my(lat0), S = C * Math.cos(lat0 * DEG); return (lat, lon) => ({ x: (lon2mx(lon) - mx0) * S, z: (lat2my(lat) - my0) * S }); }

async function ask(q, file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let back = 30000;
  for (let k = 0; k < 8; k++) {
    const t0 = Date.now();
    try {
      const r = await fetch(MIRROR, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'leon-freeski-bake/1' } });
      const txt = await r.text();
      if (r.ok && txt.trim().startsWith('{')) {
        const j = JSON.parse(txt);
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error('remark ' + j.remark.slice(0, 120));
        fs.writeFileSync(file, txt);
        console.log('   got', path.basename(file), (txt.length / 1e6).toFixed(2), 'MB in', ((Date.now() - t0) / 1000).toFixed(0), 's');
        return j;
      }
      throw new Error('http ' + r.status + ' ' + txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120));
    } catch (e) { console.log('   busy (' + e.message + '), waiting', back / 1000, 's'); }
    await wait(back); back = Math.min(240000, back * 2);
  }
  return null;
}

(async () => {
  const { PRESETS } = await esm('public/ski/js/wplaces.js');
  const LD = await esm('public/ski/js/wlanddata.js');
  fs.mkdirSync(CACHE, { recursive: true });
  const outDir = path.join(ROOT, 'public', 'ski', 'data', 'world');
  fs.mkdirSync(outDir, { recursive: true });
  for (const P of PRESETS) {
    if (ONLY.length && !ONLY.includes(P.preset) && !ONLY.includes(P.id)) continue;
    console.log(P.preset, P.lat, P.lon);
    const [s, w, n, e] = LD.bboxOf(P.lat, P.lon), bb = [s, w, n, e].map(v => v.toFixed(5)).join(',');
    const parts = LD.landQueryParts(bb), els = [], missing = [];
    for (let i = 0; i < parts.length; i++) {
      const j = await ask(parts[i], path.join(CACHE, `${P.preset}.land${i}.json`));
      if (j) els.push(...j.elements); else missing.push(['shapes', 'points', 'buildings'][i]);
      await wait(4000);
    }
    const toLocal = frame(P.lat, P.lon), H = LD.LAND_HALF;
    const L = LD.build(els, toLocal, { x0: -H, z0: -H, x1: H, z1: H });
    const o = LD.encode(L, [P.lat, P.lon], missing.length ? { missing } : {});
    const txt = JSON.stringify(o);
    fs.writeFileSync(path.join(outDir, P.preset + '.json'), txt);
    console.log('  ->', P.preset + '.json', (txt.length / 1024).toFixed(0), 'KB', JSON.stringify(LD.landStats(L)), missing.length ? 'MISSING ' + missing : '');
  }
})();
