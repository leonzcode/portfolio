/* ---------------------------------------------------------------------------
   Leoncraft 2 - how long a block takes to break, and whether it drops.

   The Minecraft Wiki's formula (Breaking, Java Edition):

     speed = the held tool's speed for this block (1 if it is not the
             right kind of tool: wood 2, stone 4, copper 5, iron 6,
             diamond 8, netherite 9, gold 12; shears 15 on leaves and
             cobwebs, 5 on wool, 2 on vines; a sword 15 on cobwebs and
             1.5 on plants, leaves and gourds)
     if speed > 1:  speed += efficiency^2 + 1
     haste:         speed *= 1 + 0.2 * level
     mining fatigue: speed *= 0.3 ^ min(level, 4)
     under water without Aqua Affinity: speed *= 0.2
     not on the ground: speed /= 5
     damage = speed / hardness / (30 if the block drops with this tool, else 100)
     damage >= 1 breaks at once; otherwise ceil(1 / damage) ticks.

   A tool keeps its speed on a block it is too weak to harvest (a wooden
   pickaxe on iron ore is quick but drops nothing), as the game's tool rules
   have it. Which tool a block wants and how good it must be come from
   minecraft-data (js/itemdata.js BLOCK_TOOLS).
--------------------------------------------------------------------------- */
import { BLOCKS } from './blocks.js?v=107';
import { BLOCK_TOOLS } from './itemdata.js?v=107';
import { ITEMS } from './items.js?v=107';

const KIND_BIT = { pickaxe: 1, axe: 2, shovel: 4, hoe: 8, sword: 16, shears: 32 };
// per block id: [material, harvest bits, lowest tier], looked up once
const INFO = [];
function infoOf(d) {
  let e = INFO[d.id];
  if (e === undefined) {
    let t = BLOCK_TOOLS[d.name];
    if (!t && d.lower) t = BLOCK_TOOLS[d.lower];
    if (!t) t = BLOCK_TOOLS[d.name.replace(/_top_block$/, '')];
    e = INFO[d.id] = t ? { mat: t[0], kinds: t[1], tier: t[2] } : { mat: 'default', kinds: 0, tier: 0 };
  }
  return e;
}
export function blockTools(d) { return d ? infoOf(d) : null; }

// the tool's speed against the block (1 when it does not help)
export function toolSpeed(tool, d) {
  if (!tool) return 1;
  const m = infoOf(d).mat;
  if (tool.kind === 'shears') {
    if (/leaves/.test(m) || m === 'coweb') return 15;
    if (m === 'wool') return 5;
    if (/vine_or_glow_lichen/.test(m)) return 2;
    return 1;
  }
  if (tool.kind === 'sword') {
    if (m === 'coweb') return 15;
    if (m === 'sword_instantly_mines' || m === 'sword_efficient') return Infinity;
    if (/leaves|plant|gourd/.test(m)) return 1.5;
    return 1;
  }
  return m.indexOf('mineable/' + tool.kind) >= 0 ? tool.speed : 1;
}

// does the block drop anything when broken with this tool (null = the hand)?
export function canHarvest(tool, d) {
  const e = infoOf(d);
  if (!e.kinds) return true;
  if (!tool || !(e.kinds & KIND_BIT[tool.kind])) return false;
  if (tool.kind === 'shears' || tool.kind === 'sword') return true;
  return tool.tier >= e.tier;
}

/* Ticks to break (0 = at once, Infinity = never). ctx: { stack (held), effects
   ({ haste, mining_fatigue, conduit_power } levels), inWater, aquaAffinity,
   onGround }. */
export function breakTicks(d, ctx) {
  if (!d || d.hardness === undefined) return 6;
  if (d.hardness < 0) return Infinity;
  if (d.hardness === 0) return 0;
  const st = ctx && ctx.stack, it = st ? ITEMS[st.id] : null, tool = it && it.tool ? it.tool : null;
  let speed = toolSpeed(tool, d);
  if (speed === Infinity) return 0;
  if (speed > 1) { const eff = st && st.ench && st.ench.efficiency ? st.ench.efficiency : 0; if (eff) speed += eff * eff + 1; }
  const fx = (ctx && ctx.effects) || null;
  if (fx) {
    const haste = Math.max(fx.haste || 0, fx.conduit_power || 0);
    if (haste) speed *= 1 + 0.2 * haste;
    if (fx.mining_fatigue) speed *= Math.pow(0.3, Math.min(fx.mining_fatigue, 4));
  }
  if (ctx && ctx.inWater && !ctx.aquaAffinity) speed *= 0.2;
  if (ctx && ctx.onGround === false) speed /= 5;
  const damage = speed / d.hardness / (canHarvest(tool, d) ? 30 : 100);
  if (damage >= 1) return 0;
  return Math.ceil(1 / damage);
}

/* Wear on the tool for breaking this block: tools 1 for anything that is
   not broken at once, swords 2, shears 1 for everything but fire. */
export function wearFor(stack, d) {
  const it = stack ? ITEMS[stack.id] : null;
  if (!it || !it.dur) return 0;
  const tool = it.tool;
  if (tool && tool.kind === 'shears') return /fire/.test(d.name) ? 0 : 1;
  if (d.hardness <= 0) return 0;
  if (tool && tool.kind === 'sword') return 2;
  if (tool) return 1;
  if (it.name === 'trident' || it.name === 'mace') return it.name === 'mace' ? 0 : 2;
  return 0;
}
