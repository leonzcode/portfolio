// node tools/ski/gen_plans.cjs [port] (serve public/ on that port first; needs global puppeteer on NODE_PATH) : writes public/ski/data/jumpline.json and freeride.json, each map's plan (main.js PLANS)
// as Chrome works it out, with its fingerprint: a fresh browser loads each map, and main.js keeps the plan in
// localStorage (ski_jlplan, ski_frplan), read here. Run it after any change to park.js, terrain.js, noise.js,
// freeride.js or frland.js (if it is not run, the game works the plan out again, as before, and keeps it itself).
const puppeteer = require('puppeteer'); const fs = require('fs'), path = require('path'), os = require('os');
const wait = ms => new Promise(r => setTimeout(r, ms));
const PORT = +(process.argv[2] || 8975), OUT = path.join(__dirname, '../../public/ski/data/');
(async () => {
  for (const [map, key] of [['jumpline', 'ski_jlplan'], ['freeride', 'ski_frplan']]) {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'skiPlan-'));
    const b = await puppeteer.launch({ headless: 'new', userDataDir: prof, args: ['--use-angle=d3d11', '--enable-gpu', '--window-position=-32000,-32000'] });
    const p = await b.newPage();
    await p.evaluateOnNewDocument(m => { localStorage.setItem('ski_opts', JSON.stringify({ scheme: 'keys', gfx: 'low', map: m })); }, map);
    await p.goto(`http://127.0.0.1:${PORT}/ski/?map=${map}`, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 300; i++) { await wait(200); if (await p.evaluate(() => { const b = document.getElementById('play'); return b && !b.disabled; }).catch(() => false)) break; }
    const kept = await p.evaluate(k => localStorage.getItem(k), key);
    const d = JSON.parse(kept);
    fs.writeFileSync(OUT + map + '.json', JSON.stringify({ note: 'This map\'s plan (main.js PLANS): used only while print matches the code that makes it. Made by a script; if out of date the game works it out again.', print: d.print, plan: d.plan }) + '\n');
    console.log(map, d.print, JSON.stringify(d.plan).length, 'chars');
    await b.close(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
  }
})();
