// Leon Clash: fail when the mlhub copies differ from the page's files.
//   node tools/clash/check.cjs [path to mlhub/apps/mc]
const fs = require("fs");
const path = require("path");
const PUB = path.join(__dirname, "..", "..", "public", "clash", "js");
const MC = process.argv[2] || "D:/code/personal/mlhub/apps/mc";
const PAIRS = [["sim.js", "leonclash_sim.js"], ["cards.js", "leonclash_cards.js"]];
let bad = 0;
for (const [a, b] of PAIRS) {
  const x = fs.readFileSync(path.join(PUB, a)), y = fs.existsSync(path.join(MC, b)) ? fs.readFileSync(path.join(MC, b)) : null;
  if (!y || !x.equals(y)) { console.error("DRIFT:", a, "and", b, "differ; run node tools/clash/sync.cjs"); bad++; }
  else console.log("same:", a, "=", b, "(" + x.length + " bytes)");
}
process.exit(bad ? 1 : 0);
