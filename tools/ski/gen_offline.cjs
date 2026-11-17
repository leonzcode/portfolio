// node tools/ski/gen_offline.cjs : writes public/ski/data/offline.json, the list of files Leon Freeski saves for offline
// use after a first visit (public/ski/js/offline.js reads it; public/ski/sw.js keeps the files). Run it after adding,
// removing or renaming a file under public/ski (models, pictures, sounds, data, modules). If it is not run, the game
// still saves every file it actually uses while online; only the files of runs not yet ridden can be missing offline.
// No stamps are written: offline.js adds the page's own ?v= to the code.
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '../../public'), SKI = path.join(PUB, 'ski');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const rel = f => path.relative(SKI, f).split(path.sep).join('/');
const size = f => fs.statSync(f).size;
const out = { code: [], files: [], three: [], world: [] }, bytes = { code: 0, files: 0, three: 0, world: 0 };
for (const f of walk(SKI)) {
  const r = rel(f);
  if (/^(sw\.js|check\.html|index\.html)$/.test(r) || r === 'data/offline.json') continue;   // (the page is kept as it is visited)
  if (/^(js|css)\//.test(r) && /\.(js|css)$/.test(r)) { out.code.push(r); bytes.code += size(f); continue; }
  if (/^data\/world\//.test(r)) { out.world.push(r); bytes.world += size(f); continue; }
  out.files.push(r); bytes.files += size(f);
}
// three.js as the page asks for it (the import map's stamp is ski + the page's; the rest unstamped), and the Draco decoder
const THREE = ['three.module.js?v=ski{V}', 'three.core.js', 'addons/loaders/GLTFLoader.js', 'addons/loaders/DRACOLoader.js',
  'addons/utils/BufferGeometryUtils.js', 'addons/libs/draco/draco_wasm_wrapper.js', 'addons/libs/draco/draco_decoder.wasm'];
for (const t of THREE) {
  const f = path.join(PUB, 'car/vendor/three', t.split('?')[0]);
  if (!fs.existsSync(f)) continue;
  out.three.push('/car/vendor/three/' + t); bytes.three += size(f);
}
for (const k in out) out[k].sort();
fs.writeFileSync(path.join(SKI, 'data/offline.json'), JSON.stringify({ note: 'Files Leon Freeski saves for offline use (js/offline.js). Made by tools/ski/gen_offline.cjs; run it again after adding or removing files.', bytes, ...out }, null, 0) + '\n');
console.log('code', out.code.length, (bytes.code / 1e6).toFixed(2), 'MB; files', out.files.length, (bytes.files / 1e6).toFixed(2), 'MB; three', out.three.length, (bytes.three / 1e6).toFixed(2), 'MB; world (not saved ahead)', out.world.length, (bytes.world / 1e6).toFixed(2), 'MB');
