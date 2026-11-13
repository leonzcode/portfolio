// Leon Clash: copy the sim and the card data to mlhub, byte for byte.
//   node tools/clash/sync.cjs [path to mlhub/apps/mc]
// The same files run in the browser (ES module import sets a global) and in
// Node (require gives module.exports), so they are copied, never rewritten.
const fs = require("fs");
const path = require("path");
const PUB = path.join(__dirname, "..", "..", "public", "clash", "js");
const MC = process.argv[2] || "D:/code/personal/mlhub/apps/mc";
const PAIRS = [["sim.js", "leonclash_sim.js"], ["cards.js", "leonclash_cards.js"]];
for (const [a, b] of PAIRS) {
  fs.copyFileSync(path.join(PUB, a), path.join(MC, b));
  console.log("copied", a, "->", path.join(MC, b));
}
