/* ---------------------------------------------------------------------------
   Leoncraft 2 - the words of the Closed Captions, our own.

   The game keys each caption ('subtitles.entity.cow.ambient'); a player who
   uses their own Minecraft sounds gets their game's own words for every key
   (packs.js reads its en_us.json). Without it, Leoncraft writes a line of its
   own from the key: what made the sound (the cow) and what it did (a moo),
   in its own words, so none of the game's text is shipped here.

   caption(key) -> the line, or null for a key that is not a caption
--------------------------------------------------------------------------- */

// what made it, where the id alone does not read well
const WHO = {
  generic: 'Block', player: 'Player', item: 'Item', experience_orb: 'Experience', lightning_bolt: 'Lightning', note_block: 'Note block',
  ender_eye: 'Eye of ender', ender_pearl: 'Ender pearl', tnt: 'TNT', puffer_fish: 'Pufferfish', mooshroom: 'Mooshroom', glow_squid: 'Glow squid',
  flintandsteel: 'Flint and steel', firecharge: 'Fire charge', blastfurnace: 'Blast furnace', item_frame: 'Item frame', leash_knot: 'Lead',
  enchantment_table: 'Enchanting table', end_portal_frame: 'End portal frame', redstone_torch: 'Redstone torch', iron_golem: 'Iron golem',
  snow_golem: 'Snow golem', baby_cat: 'Kitten', baby_chicken: 'Chick', baby_horse: 'Foal', baby_pig: 'Piglet', baby_wolf: 'Puppy',
  baby_nautilus: 'Young nautilus', hud: '', thorns: 'Thorns', mob_effect: 'Omen', raid: 'Raid', weather: '', ambient: '',
  wet_sponge: 'Wet sponge', copper_golem_become_statue: 'Copper golem',
};
// what a mob sounds like when it speaks of its own accord
const NOISE = {
  zombie: 'groaning', husk: 'groaning', zombie_villager: 'groaning', drowned: 'gurgling', zombified_piglin: 'grunting', zoglin: 'snarling',
  skeleton: 'rattling', stray: 'rattling', bogged: 'rattling', wither_skeleton: 'rattling', parched: 'rattling', skeleton_horse: 'wailing',
  spider: 'hissing', cave_spider: 'hissing', creeper: 'hissing', enderman: 'warbling', endermite: 'skittering', silverfish: 'skittering',
  cow: 'mooing', pig: 'oinking', sheep: 'bleating', goat: 'bleating', chicken: 'clucking', horse: 'neighing', donkey: 'braying', mule: 'braying',
  zombie_horse: 'moaning', camel: 'grumbling', camel_husk: 'grumbling', llama: 'snorting', cat: 'meowing', ocelot: 'calling', wolf: 'panting',
  fox: 'yipping', rabbit: 'squeaking', bat: 'squeaking', parrot: 'chattering', polar_bear: 'grunting', panda: 'snuffling', frog: 'croaking',
  turtle: 'chirping', axolotl: 'chirping', dolphin: 'whistling', cod: 'splashing', salmon: 'splashing', tropical_fish: 'splashing',
  squid: 'squelching', glow_squid: 'squelching', guardian: 'humming', elder_guardian: 'moaning', villager: 'muttering', wandering_trader: 'muttering',
  witch: 'chuckling', pillager: 'muttering', vindicator: 'muttering', evoker: 'murmuring', illusioner: 'murmuring', ravager: 'grunting',
  vex: 'shrieking', ghast: 'wailing', happy_ghast: 'humming', blaze: 'breathing', magma_cube: 'squelching', slime: 'squelching',
  piglin: 'snorting', piglin_brute: 'snorting', hoglin: 'growling', strider: 'chirruping', shulker: 'peeking', phantom: 'screeching',
  ender_dragon: 'roaring', wither: 'howling', warden: 'rumbling', allay: 'humming', sniffer: 'sniffing', armadillo: 'squeaking',
  breeze: 'whirling', creaking: 'creaking', fire: 'crackling', water: 'flowing', lava: 'bubbling', beacon: 'humming', conduit: 'pulsing', portal: 'whooshing',
  deadbush: 'rustling', dry_grass: 'rustling', sand: 'whispering', respawn_anchor: 'humming', trial_spawner: 'crackling', vault: 'humming', firefly_bush: 'chirping',
  dried_ghast: 'sighing', candle: 'flickering', ghastling: 'humming', nautilus: 'bubbling', zombie_nautilus: 'bubbling', snow_golem: 'humming', copper_golem: 'clinking',
};
// what it did: a line with @ for what made it (an action missing here reads as its own words)
const DID = {
  ambient: '@ making noise', ambient_land: '@ out of water', ambient_water: '@ under water', ambient_baby: '@ making noise', ambient_with_item: '@ humming', ambient_without_item: '@ humming',
  idle: '@ making noise', idle_air: '@ making noise', idle_water: '@ making noise', idle_ground: '@ making noise',
  hurt: '@ hurt', hurt_land: '@ hurt', hurt_water: '@ hurt', hurt_reduced: '@ shrugs off a hit', hurt_baby: '@ hurt', hurt_closed: '@ hurt',
  death: '@ killed', death_land: '@ killed', death_water: '@ killed', death_baby: '@ killed', death_small: '@ killed',
  eat: '@ eating', drink: '@ drinking', burp: '@ burping', attack: '@ attacking', bite: '@ biting', sting: '@ stinging', shoot: '@ firing',
  throw: '@ thrown', launch: '@ launched', hit: '@ hit', hit_player: 'Arrow hit you', hit_ground: '@ lands', step: '@ walking', swim: '@ swimming',
  splash: '@ splashing', flop: '@ flopping', jump: '@ jumping', long_jump: '@ leaping', land: '@ lands', fly: '@ flying', flap: '@ flapping',
  angry: '@ angry', growl: '@ growling', hiss: '@ hissing', purr: '@ purring', purreow: '@ meowing', stray_ambient: '@ meowing', beg_for_food: '@ begging',
  pant: '@ panting', whine: '@ whining', scream: '@ screaming', stare: '@ staring', warning: '@ warning you', roar: '@ roaring', screech: '@ screeching',
  teleport: '@ teleports', spawn: '@ appears', celebrate: '@ cheering', retreat: '@ backing off', converted_to_zombified: '@ zombified', converted: '@ cured',
  cure: '@ being cured', open: '@ opening', close: '@ closing', toggle: '@ swinging', use: '@ used', break: '@ breaks',
  place: '@ set down', fall: 'Something lands', footsteps: 'Footfalls', fill: '@ filled', empty: '@ emptied', primed: '@ fizzing', explode: 'Explosion',
  extinguish: '@ put out', ambient_sound: 'Strange noise', crackle: '@ crackling', fire_crackle: '@ crackling', smoke: '@ smoking', brew: '@ bubbling',
  activate: '@ wakes', deactivate: '@ goes quiet', charge: '@ charging', saddle: 'Saddle put on', unequip: '@ taken off', equip: '@ put on',
  milk: '@ milked', shear: '@ sheared', snip: '@ snipping', chest: 'Chest fitted', dash: '@ dashing', dash_ready: '@ ready to dash',
  sit: '@ sitting', stand: '@ standing', egg: 'Egg laid', takeoff: '@ takes off', loop: '@ buzzing', loop_aggressive: '@ buzzing angrily',
  pollinate: '@ at a flower', inhale: '@ breathing in', slide: '@ sliding', whirl: '@ whirling', wind_burst: 'Gust bursts', deflect: '@ deflects',
  burn: '@ burning', curse: '@ curses you', play: '@ playing', sleep: '@ snoring', admiring_item: '@ admires', jealous: '@ jealous', trade: '@ trading',
  yes: '@ agrees', no: '@ refuses', thunder: 'Thunder', impact: 'Lightning strikes', rain: 'Rain', paddle_water: 'Paddling', paddle_land: 'Paddling',
  pickup: '@ picked up', levelup: 'Level up', resonate: '@ ringing', chime: '@ chiming', drip: '@ dripping', crack: '@ cracking', hatch: '@ hatching',
  take_result: '@ used', bubble_pop: 'Bubbles pop', page_turn: 'Page turned', put: '@ put down', strip: 'Log stripped', scrape: '@ scraping',
  wax_off: 'Wax scraped off', wax_on: 'Wax put on', till: 'Ground tilled', flatten: 'Ground flattened', block: '@ blocks', return: '@ returns',
  riptide: '@ riptide', fill_fish: 'Fish caught', fill_axolotl: 'Axolotl caught', fill_tadpole: 'Tadpole caught', fill_lava: '@ filled',
  empty_lava: '@ emptied', pick_berries: 'Berries picked', ambient_ominous: '@ rumbling', note: '@ playing', move: '@ moving', burnout: '@ fizzles out',
  trigger: '@ grows louder', travel: '@ fades', dispense: '@ fired', fail: '@ failed', land_on: '@ lands', destroy: '@ breaks apart',
  small_fall: '@ falls', big_fall: '@ falls hard', freeze_hurt: '@ freezing', hurt_freeze: '@ freezing', hurt_drown: '@ drowning', hurt_on_fire: '@ burning',
  hurt_sweet_berry_bush: '@ pricked', damage: '@ damaged', repair: '@ repaired', nearby_close: '@ draws near', nearby_closer: '@ draws nearer',
  nearby_closest: '@ is very close', bad_omen: 'Bad omen', raid_omen: 'Raid omen', trial_omen: 'Trial omen', horn: 'Raid horn sounds',
  dash_ready_land: '@ ready to dash', locked: '@ is locked', ready: '@ ready', click: '@ clicking',
  squish: '@ squelches', squish_small: '@ squelches', jump_small: '@ jumping', tilt_down: '@ tips', tilt_up: '@ tips back', grow: '@ grows', absorb: '@ soaks up water', dries: '@ dries', carve: '@ carved',
};

// an action left as the game's id reads as something happening: 'spawn_mob' -> 'spawning mob'
const AS_IS = new Set(['no', 'ready', 'locked', 'upwards', 'whirlpool', 'power', 'ominous', 'about', 'multi', 'single', 'aggro', 'scute', 'item', 'drip', 'add']);
function happening(act) {
  const w = act.split('_'), v = w[0];
  if (!AS_IS.has(v) && !/(ed|ing|s)$/.test(v) && v.length > 2) {
    w[0] = /[^aeiou]e$/.test(v) ? v.slice(0, -1) + 'ing'
      : /^[^aeiou]*[aeiou][bdgklmnprt]$/.test(v) && v.length <= 5 ? v + v.slice(-1) + 'ing' : v + 'ing';
  }
  return w.join(' ');
}
function words(id) {
  if (id in WHO) return WHO[id];
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const cache = new Map();

export function caption(key) {
  if (!key || !key.startsWith('subtitles.')) return null;
  if (cache.has(key)) return cache.get(key);
  const p = key.split('.');
  let line = null;
  if (key === 'subtitles.ambient.sound') line = DID.ambient_sound;
  else if (p.length >= 4) {
    const thing = p[2], act = p.slice(3).join('_'), last = p[p.length - 1];
    const who = thing === 'generic' && p[1] === 'entity' ? 'Someone' : words(thing);
    if ((act === 'ambient' || act === 'idle') && NOISE[thing]) line = who + ' ' + NOISE[thing];
    else if (act.startsWith('imitate_')) line = who + ' mimics a ' + words(act.slice(8)).toLowerCase();
    else if (act.startsWith('work_')) line = who + ' at work';
    else if (act.startsWith('equip')) line = who + ' put on';
    else if (act.startsWith('unequip')) line = who + ' taken off';
    else {
      const t = DID[act] || DID[last];
      line = t ? t.replace('@', who) : (who + ' ' + happening(act)).trim();
    }
  } else if (p.length === 3) line = words(p[2]);
  line = line ? line.trim() : null;
  if (line) line = line.charAt(0).toUpperCase() + line.slice(1);
  cache.set(key, line);
  return line;
}
