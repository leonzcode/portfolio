/* ---------------------------------------------------------------------------
   Leoncraft 2 - advancements: does what just happened meet a criterion?

   The criteria in advdata.js keep the game's conditions (its predicates, as
   the Minecraft Wiki's "Advancement definition" and "Predicate" pages set
   them out), with the tags already written out as lists. What happened
   comes in as plain objects the game's hooks fill (adv/game.js):

     an item       { name, count, damage, ench: { name: level }, ominous, jukebox }
     an entity     { type, baby, x, y, z (the game's y), dim, equipment: { head,
                     chest, legs, feet, mainhand, offhand, body: items },
                     vehicle, passengers, variant: { 'cat/variant': name },
                     lookingAt, stepping: { name, meta }, fires, onFire, sneaking }
     a block       { name, meta, x, y, z } read through env.block(x, y, z)
     a damage      { tags: [...], direct: entity, source: entity }

   env carries the world round the event: the player as an entity, its
   position (the "origin" distances are measured from), and lookups for a
   block, a biome and the structures at a place.
--------------------------------------------------------------------------- */

const has = (list, v) => Array.isArray(list) ? list.includes(v) : list === v;

// a number against a range: an exact number, or { min, max }
export function inRange(r, v) {
  if (r === undefined || r === null) return true;
  if (v === undefined || v === null || Number.isNaN(v)) return false;
  if (typeof r === 'number') return v === r;
  return (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
}

/* ---- items ---- */
export function item(p, s) {
  if (!p) return true;
  if (!s || !s.name) return false;
  if (p.items && !has(p.items, s.name)) return false;
  if (p.count !== undefined && !inRange(p.count, s.count === undefined ? 1 : s.count)) return false;
  if (p.components && p.components.damage !== undefined && (s.damage | 0) !== p.components.damage) return false;
  if (p.ominous && !s.ominous) return false;
  const q = p.predicates;
  if (q) {
    if (q.enchantments) for (const e of q.enchantments) {
      const lv = s.ench ? s.ench[e.enchantments] || 0 : 0;
      if (!inRange(e.levels || { min: 1 }, lv)) return false;
    }
    if (q.jukebox_playable && !s.jukebox) return false;
  }
  return true;
}

/* ---- distances: from the origin to a point ---- */
export function distance(p, from, to) {
  if (!p) return true;
  if (!from || !to) return false;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  if (p.x && !inRange(p.x, Math.abs(dx))) return false;
  if (p.y && !inRange(p.y, Math.abs(dy))) return false;
  if (p.z && !inRange(p.z, Math.abs(dz))) return false;
  if (p.horizontal && !inRange(p.horizontal, Math.hypot(dx, dz))) return false;
  if (p.absolute && !inRange(p.absolute, Math.hypot(dx, dy, dz))) return false;
  return true;
}

/* ---- block states the criteria ask about ---- */
export function blockState(b, key) {
  if (!b) return undefined;
  const n = b.name, m = b.meta | 0;
  switch (key) {
    case 'charges': return n === 'respawn_anchor' ? String(m & 7) : undefined;
    // (bit 0 lit for bulbs, lamps and ore; a campfire's bit 4 is put out)
    case 'lit': return /campfire$/.test(n) ? String(!(m & 4)) : /copper_bulb$|redstone_lamp|redstone_ore/.test(n) ? String(!!(m & 1)) : undefined;
    case 'ominous': return n === 'vault' || n === 'trial_spawner' ? String(!!(m & 8)) : undefined;
    // logs: the face they were put against (0 up and down, 1 east-west, 2 north-south); a heart is a log too
    case 'axis': return ['y', 'x', 'z'][m % 3];
    // a comparator faces its back, where it reads from: the way out turned round
    case 'facing': return n === 'comparator' || n === 'repeater' ? ['south', 'west', 'north', 'east'][m & 3] : undefined;
    case 'waterlogged': return String(!!b.waterlogged);
    case 'creaking_heart_state': return b.heartState;
  }
  return b.state ? b.state[key] : undefined;
}
export function blockPred(p, b) {
  if (!p) return true;
  if (!b) return false;
  if (p.blocks && !has(p.blocks, b.name)) return false;
  if (p.state) for (const k in p.state) {
    const want = p.state[k], v = blockState(b, k);
    if (typeof want === 'object' && want) { if (!inRange({ min: want.min === undefined ? undefined : +want.min, max: want.max === undefined ? undefined : +want.max }, +v)) return false; }
    else if (String(want) !== v) return false;
  }
  return true;
}

/* ---- a place: { x, y, z } in the game's terms, with env to look round it ---- */
export function location(p, at, env) {
  if (!p) return true;
  if (!at) return false;
  if (p.dimension && p.dimension !== (at.dim || env.dim)) return false;
  if (p.position) {
    const q = p.position;
    if (q.x && !inRange(q.x, at.x)) return false;
    if (q.y && !inRange(q.y, at.y)) return false;
    if (q.z && !inRange(q.z, at.z)) return false;
  }
  if (p.biomes) {
    const bn = env.biome ? env.biome(at) : null;
    if (!bn || !has(p.biomes, bn)) return false;
  }
  if (p.structures) {
    const list = Array.isArray(p.structures) ? p.structures : [p.structures];
    if (!env.inStructure || !list.some(s => env.inStructure(s, at))) return false;
  }
  if (p.block && !blockPred(p.block, env.block ? env.block(Math.floor(at.x), Math.floor(at.y), Math.floor(at.z)) : null)) return false;
  if (p.smokey !== undefined && !!(env.smokey && env.smokey(at)) !== p.smokey) return false;
  return true;
}

/* ---- entities ---- */
const FLAGS = { is_baby: 'baby', is_on_fire: 'onFire', is_sneaking: 'sneaking', is_sprinting: 'sprinting', is_swimming: 'swimming', is_flying: 'flying' };
export function entity(p, e, env) {
  if (!p) return true;
  if (p.type === 'inverted') return !entity(p.term, e, env);
  if (p.type === 'any_of') return p.terms.some(t => entity(t, e, env));
  if (p.type === 'all_of') return p.terms.every(t => entity(t, e, env));
  if (!e) return false;
  if (p.entity_type && !has(p.entity_type, e.type)) return false;
  if (p.flags) for (const k in p.flags) if (!!e[FLAGS[k] || k] !== p.flags[k]) return false;
  if (p.location && !location(p.location, e, env)) return false;
  if (p.distance && !distance(p.distance, env.origin, e)) return false;
  if (p.equipment) for (const slot in p.equipment) if (!item(p.equipment[slot], e.equipment ? e.equipment[slot] : null)) return false;
  if (p.vehicle && !entity(p.vehicle, e.vehicle, env)) return false;
  if (p.passenger && !(e.passengers || []).some(o => entity(p.passenger, o, env))) return false;
  if (p.components) for (const k in p.components) if (!e.variant || e.variant[k] !== p.components[k]) return false;
  const tp = p['type_specific/player'];
  if (tp && tp.looking_at && !entity(tp.looking_at, e.lookingAt, env)) return false;
  const tl = p['type_specific/lightning'];
  if (tl && tl.blocks_set_on_fire !== undefined && !inRange(tl.blocks_set_on_fire, e.fires | 0)) return false;
  if (p.stepping_on && !location(p.stepping_on, e.stepping, env)) return false;
  return true;
}

/* ---- damage ---- */
export function damageType(p, d, env) {
  if (!p) return true;
  if (!d) return false;
  if (p.tags && !p.tags.every(t => (d.tags || []).includes(t))) return false;
  if (p.direct_entity && !entity(p.direct_entity, d.direct, env)) return false;
  if (p.source_entity && !entity(p.source_entity, d.source, env)) return false;
  return true;
}
export function damage(p, d, env) {
  if (!p) return true;
  if (!d) return false;
  if (p.type && !damageType(p.type, d.type, env)) return false;
  if (p.blocked !== undefined && !!d.blocked !== p.blocked) return false;
  if (p.dealt !== undefined && !inRange(p.dealt, d.dealt)) return false;
  if (p.taken !== undefined && !inRange(p.taken, d.taken)) return false;
  if (p.source_entity && !entity(p.source_entity, d.type && d.type.source, env)) return false;
  return true;
}

/* ---- a loot condition about a block (placed_block, item_used_on_block): ev { x, y, z, tool } ---- */
export function blockCondition(c, ev, env) {
  if (!c) return true;
  switch (c.type) {
    case 'all_of': return c.terms.every(t => blockCondition(t, ev, env));
    case 'any_of': return c.terms.some(t => blockCondition(t, ev, env));
    case 'inverted': return !blockCondition(c.term, ev, env);
    case 'match_tool': return item(c.predicate, ev.tool);
    case 'match_block': case 'block_state_property': return blockPred(c, env.block(ev.x, ev.y, ev.z));
    case 'location_check': {
      const x = ev.x + (c.offsetX | 0), y = ev.y + (c.offsetY | 0), z = ev.z + (c.offsetZ | 0);
      return location(c.predicate, { x: x + 0.5, y, z: z + 0.5, dim: env.dim }, env);
    }
  }
  return false;
}

/* Every condition of one criterion against what happened (ev), by the
   trigger's own fields. A field the game names that we do not know fails,
   so nothing is ever given by mistake. */
export function test(trigger, cond, ev, env) {
  for (const k in cond) {
    const c = cond[k];
    switch (k) {
      case 'player': if (!entity(c, env.player, env)) return false; break;
      case 'entity': case 'child': case 'parent': case 'partner': case 'source': case 'cause': case 'projectile': case 'lightning': case 'villager':
        if (!entity(c, ev[k], env)) return false; break;
      case 'bystander': if (!(ev.bystanders || []).some(e => entity(c, e, env))) return false; break;
      case 'victims': {
        // each condition must be met by a victim of its own
        const left = (ev.victims || []).slice();
        for (const v of c) {
          const i = left.findIndex(e => entity(v, e, env));
          if (i < 0) return false;
          left.splice(i, 1);
        }
        break;
      }
      case 'unique_entity_types': if (!inRange(c, new Set((ev.victims || []).map(e => e.type)).size)) return false; break;
      case 'item': case 'fired_from_weapon': case 'rod':
        if (!item(c, ev[k])) return false; break;
      case 'items': {
        // inventory_changed: each item condition met by some stack
        for (const ip of c) if (!(ev.stacks || []).some(s => item(ip, s))) return false;
        break;
      }
      case 'location':
        if (trigger === 'placed_block' || trigger === 'item_used_on_block' || trigger === 'allay_drop_item_on_block') { if (!blockCondition(c, ev, env)) return false; }
        else if (!location(c, ev.at, env)) return false;
        break;
      case 'damage': if (!damage(c, ev.damage, env)) return false; break;
      case 'killing_blow': if (!damageType(c, ev.killingBlow, env)) return false; break;
      case 'from': case 'to': if (ev[k] !== c) return false; break;
      case 'level': case 'count': case 'signal_strength': case 'num_bees_inside': case 'duration':
        if (!inRange(c, ev[k])) return false; break;
      case 'distance': if (!distance(c, ev.start, ev.end)) return false; break;
      case 'start_position': if (!location(c, ev.start, env)) return false; break;
      case 'effects': for (const n in c) if (!ev.effects || !ev.effects.has(n)) return false; break;
      case 'recipes': case 'recipe_id': if (ev.recipe !== c) return false; break;
      case 'ingredients': {
        const left = (ev.ingredients || []).slice();
        for (const ip of c) {
          const i = left.findIndex(s => item(ip, s));
          if (i < 0) return false;
          left.splice(i, 1);
        }
        break;
      }
      case 'loot_tables': case 'loot_table': if (String(ev.table || '').replace(/^chests\//, '') !== String(c).replace(/^chests\//, '')) return false; break;
      case 'blocks': if (!ev.block || !has(c, ev.block.name)) return false; break;
      case 'state': if (!blockPred({ state: c }, ev.block)) return false; break;
      default: return false;
    }
  }
  return true;
}
