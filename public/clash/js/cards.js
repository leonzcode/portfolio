/* Leon Clash: the card data and the rules' numbers. Plain data only.
   Distances are in thousandths of a tile, times in ticks (20 a second),
   damage and health in points. The same bytes run in the browser (an ES module
   import sets globalThis.LeonClashCards) and in Node (require gives the object).
   mlhub keeps a copy as apps/mc/leonclash_cards.js: tools/clash/sync.cjs writes
   it and tools/clash/check.cjs fails when the two differ. */
(function (root) {
  "use strict";

  const RULES = {
    version: 1,
    tps: 20,
    W: 18000, H: 32000,
    streamTop: 15000, streamBot: 17000,
    bridges: [4000, 14000], bridgeHalf: 1300,
    regTicks: 3600,          // 3:00
    doubleAt: 2400,          // double cocoa for the last minute
    otTicks: 2400,           // 2:00 of sudden death
    cocoaStart: 5000, cocoaMax: 10000,
    cocoaTick: 18,           // thousandths of a cocoa a tick (one every 2.8 s)
    maxUnits: 90,            // living troops and buildings a side
    handSize: 4, deckSize: 8,
    pocketDepth: 5500,       // how far past the stream a fallen hut opens your side
    towers: {
      lodge: { name: "Lodge", hp: 3600, dmg: 92, hit: 20, range: 5500, r: 1400, targets: "both", proj: 700 },
      hut:   { name: "Hut",   hp: 2000, dmg: 70,  hit: 16, range: 7000, r: 1000, targets: "both", proj: 700 },
    },
    // where the towers stand for the bottom side; the top side is mirrored (y' = H - y)
    towerSpots: [
      { u: "lodge", x: 9000, y: 29000, lane: -1 },
      { u: "hut", x: 4000, y: 25500, lane: 0 },
      { u: "hut", x: 14000, y: 25500, lane: 1 },
    ],
  };

  /* Every body on the field. Fields left out take the sim's defaults:
     hit 20, range 800, sight 5500, speed 60, r 400, mass 3, targets ground, deploy 20. */
  const UNITS = {
    skipatrol: { name: "Ski Patroller", hp: 340, dmg: 76, hit: 22, range: 800, speed: 60, r: 350, mass: 2 },
    kid:       { name: "Snowball Kid", hp: 70, dmg: 30, hit: 20, range: 2200, speed: 70, r: 250, mass: 1, targets: "both", proj: 260 },
    raven:     { name: "Raven", hp: 78, dmg: 42, hit: 20, range: 800, speed: 80, r: 280, mass: 1, air: 1, targets: "both" },
    biathlete: { name: "Ski Archer", hp: 220, dmg: 66, hit: 24, range: 5000, speed: 60, r: 350, mass: 2, targets: "both", proj: 600 },
    penguin:   { name: "Penguin", hp: 220, dmg: 84, hit: 24, range: 700, speed: 100, r: 300, mass: 1, firstMult: 200 },
    torch:     { name: "Torch Skier", hp: 720, dmg: 108, hit: 28, range: 1000, splash: 1200, speed: 60, r: 420 },
    porter:    { name: "Porter", hp: 980, dmg: 110, hit: 30, range: 900, speed: 50, r: 480, mass: 4, death: { cocoa: 1000 } },
    marmot:    { name: "Marmot", hp: 90, dmg: 55, hit: 18, range: 700, speed: 95, r: 260, mass: 1 },
    goat:      { name: "Mountain Goat", hp: 1550, dmg: 195, hit: 30, range: 900, speed: 90, r: 500, mass: 4, targets: "buildings", leap: 1 },
    stbernard: { name: "St. Bernard", hp: 950, dmg: 70, hit: 24, range: 800, speed: 60, r: 480, mass: 4, heal: { r: 3000, amt: 45, every: 20 } },
    sage:      { name: "Frost Sage", hp: 660, dmg: 115, hit: 32, range: 4600, splash: 1400, speed: 60, r: 400, targets: "both", proj: 350, slowOnHit: { p: 35, t: 30 } },
    golem:     { name: "Snow Golem", hp: 2000, dmg: 120, hit: 30, range: 1000, speed: 50, r: 650, mass: 7, death: { spawn: "snowling", count: 3 } },
    snowling:  { name: "Snowling", hp: 300, dmg: 50, hit: 22, range: 750, speed: 70, r: 300, mass: 1 },
    halfpipe:  { name: "Halfpipe Rider", hp: 980, dmg: 125, hit: 26, range: 900, speed: 80, r: 420, onDeploy: { dmg: 160, r: 2000 } },
    glider:    { name: "Paraglider", hp: 600, dmg: 88, hit: 26, range: 4000, speed: 70, r: 450, air: 1, targets: "both", proj: 400, death: { dmg: 80, r: 2000, knock: 1200 } },
    coach:     { name: "Whistle Coach", hp: 1000, dmg: 75, hit: 24, range: 800, speed: 60, r: 420, pulse: { every: 50, r: 2500, stun: 16 } },
    plow:      { name: "Snowplow", hp: 1000, shield: 800, dmg: 140, hit: 28, range: 1000, speed: 50, r: 650, mass: 8, knockOnHit: 900 },
    keeper:    { name: "Bonfire Keeper", hp: 1000, dmg: 100, hit: 26, range: 900, speed: 60, r: 420, aura: { kind: "haste", r: 2500, p: 30 } },
    fisher:    { name: "Ice Fisher", hp: 880, dmg: 100, hit: 26, range: 1000, speed: 60, r: 420, hook: { range: 6500, cd: 200, speed: 500, stun: 0 } },
    groomer:   { name: "Groomer", hp: 2200, dmg: 225, hit: 30, range: 1100, speed: 50, r: 750, mass: 9, charge: { dist: 2500, speed: 110, mult: 200, knock: 0, stun: 0 } },
    yeti:      { name: "Yeti", hp: 4000, dmg: 240, hit: 34, range: 1100, speed: 45, r: 800, mass: 10, targets: "buildings", death: { dmg: 150, r: 3000, slowP: 50, slowT: 60 } },
    owl:       { name: "Snow Owl", hp: 900, dmg: 110, hit: 30, range: 3500, splash: 1500, speed: 60, r: 500, mass: 4, air: 1, targets: "both", proj: 300 },
    musher:    { name: "Musher", hp: 1500, dmg: 60, hit: 24, range: 900, speed: 50, r: 650, mass: 6, spawn: { unit: "husky", every: 80, count: 1 }, death: { spawn: "husky", count: 2 } },
    husky:     { name: "Husky", hp: 200, dmg: 60, hit: 20, range: 700, speed: 90, r: 300, mass: 1 },
    liftie:    { name: "Liftie", hp: 170, dmg: 58, hit: 20, range: 700, speed: 70, r: 300, mass: 1 },
    // legends: a button on a cooldown while they live
    guide:     { name: "The Old Guide", hp: 1750, dmg: 160, hit: 28, range: 900, speed: 60, r: 480, mass: 4, ability: { kind: "rally", cd: 240, r: 4000, p: 35, t: 80 } },
    matriarch: { name: "Frost Matriarch", hp: 1100, dmg: 160, hit: 34, range: 5000, splash: 1300, speed: 55, r: 450, targets: "both", proj: 330, ability: { kind: "whiteout", cd: 300, r: 3000, t: 40, dmg: 100 } },
    rider:     { name: "The Rider", hp: 1000, dmg: 130, hit: 22, range: 900, speed: 85, r: 420, ability: { kind: "leap", cd: 200, dist: 5000, dmg: 250, r: 2000, knock: 1200, t: 10 } },
    ranger:    { name: "The Ranger", hp: 950, dmg: 120, hit: 30, range: 6000, speed: 60, r: 420, targets: "both", proj: 600, ability: { kind: "flare", cd: 280, dmg: 380, r: 1800, towerPct: 35, delay: 10 } },
    // buildings
    cannon:    { name: "Snow Cannon", building: 1, hp: 950, dmg: 98, hit: 18, range: 5500, r: 650, proj: 450, life: 600 },
    flaretower:{ name: "Flare Tower", building: 1, hp: 1100, dmg: 66, hit: 16, range: 6500, r: 650, targets: "both", proj: 500, life: 620 },
    lifttower: { name: "Lift Tower", building: 1, hp: 800, r: 700, targets: "none", life: 800, spawn: { unit: "liftie", every: 140, count: 2 }, death: { spawn: "liftie", count: 1 } },
    cornice:   { name: "Cornice", building: 1, hp: 400, r: 600, targets: "none", life: 800, trap: { trigger: 1500, dmg: 460, r: 2500, knock: 1500, stun: 0 } },
    catapult:  { name: "Snow Catapult", building: 1, hp: 1100, dmg: 170, hit: 64, range: 11000, minRange: 3000, splash: 1000, r: 700, proj: 260, lob: 1, life: 600, deploy: 70 },
    igloo:     { name: "Igloo", building: 1, hp: 2600, r: 800, targets: "none", life: 700, death: { spawn: "snowling", count: 2 } },
    fence:     { name: "Snow Fence", building: 1, hp: 700, r: 600, targets: "none", life: 600, aura: { kind: "slow", r: 2200, p: 35 } },
  };

  /* The cards. type troop / building / spell; rarity common, rare, epic, legend.
     summit: every Nth play of the card is its Summit form; unit, card and spell
     hold what changes for that play. */
  const CARDS = [
    // ---- troops ----
    { id: "skipatrol", name: "Ski Patrol", type: "troop", rarity: "common", cost: 2, unit: "skipatrol", count: 2,
      role: "Cheap melee pair", text: "Two patrollers who ski in to stop trouble. Good value for two cocoa.",
      summit: { every: 3, text: "Each patroller arrives with a 180 point shield.", unit: { shield: 180 } } },
    { id: "kids", name: "Snowball Kids", type: "troop", rarity: "common", cost: 2, unit: "kid", count: 5,
      role: "Swarm, hits air", text: "Five kids with an endless supply of snowballs. One splash and they are gone.",
      summit: { every: 3, text: "Their snowballs slow what they hit by 25% for 1 s.", unit: { slowOnHit: { p: 25, t: 20 } } } },
    { id: "ravens", name: "Ravens", type: "troop", rarity: "common", cost: 2, unit: "raven", count: 4,
      role: "Air swarm", text: "A flock that pecks at anything. Fast and flying, but fragile.",
      summit: { every: 3, text: "Six ravens instead of four.", card: { count: 6 } } },
    { id: "biathletes", name: "Ski Archers", type: "troop", rarity: "common", cost: 3, unit: "biathlete", count: 2,
      role: "Ranged pair", text: "Two archers on skis. Long range, they hit air and ground.",
      summit: { every: 2, text: "Each one's first shot does triple damage.", unit: { firstMult: 300 } } },
    { id: "penguins", name: "Penguin Sliders", type: "troop", rarity: "common", cost: 3, unit: "penguin", count: 3,
      role: "Fast trio, slide hit", text: "Three penguins that belly slide into battle. Each one's first hit does double damage.",
      summit: { every: 3, text: "Four penguins instead of three.", card: { count: 4 } } },
    { id: "torch", name: "Torch Skier", type: "troop", rarity: "common", cost: 3, unit: "torch",
      role: "Melee splash", text: "Swings a lit torch that hits everything near it. Great against swarms.",
      summit: { every: 2, text: "Lands with a burst of embers: 140 damage around it.", unit: { onDeploy: { dmg: 140, r: 2000 } } } },
    { id: "porter", name: "Porter", type: "troop", rarity: "common", cost: 3, unit: "porter",
      role: "Mini tank, refunds cocoa", text: "Carries a pack of cocoa up the mountain. When he falls, you get 1 cocoa back.",
      summit: { every: 2, text: "Gives back 2 cocoa when he falls.", unit: { death: { cocoa: 2000 } } } },
    { id: "marmots", name: "Marmots", type: "troop", rarity: "common", cost: 1, unit: "marmot", count: 3,
      role: "Cheap fast swarm", text: "Three marmots out of their burrows. Cheap, quick and good bait.",
      summit: { every: 3, text: "Five marmots instead of three.", card: { count: 5 } } },
    { id: "goat", name: "Mountain Goat", type: "troop", rarity: "rare", cost: 4, unit: "goat",
      role: "Building hunter, jumps the stream", text: "Only goes for buildings, and leaps the stream anywhere instead of using a bridge.",
      summit: { every: 2, text: "Its first headbutt stuns for 1 s.", unit: { firstStun: 20 } } },
    { id: "stbernard", name: "St. Bernard", type: "troop", rarity: "rare", cost: 4, unit: "stbernard",
      role: "Healer", text: "Heals friendly troops near it by 45 every second.",
      summit: { every: 2, text: "Arrives with a warm barrel: heals 350 around it.", unit: { onDeploy: { heal: 350, r: 3000 } } } },
    { id: "sage", name: "Frost Sage", type: "troop", rarity: "rare", cost: 5, unit: "sage",
      role: "Ranged splash, slows", text: "Throws frost that splashes and slows what it hits.",
      summit: { every: 2, text: "The frost splashes much wider.", unit: { splash: 2200 } } },
    { id: "golem", name: "Snow Golem", type: "troop", rarity: "rare", cost: 5, unit: "golem",
      role: "Tank, splits on death", text: "A sturdy pile of packed snow. Breaks into three Snowlings when it falls.",
      summit: { every: 2, text: "Its fall also slows enemies near it by 40% for 3 s.", unit: { death: { spawn: "snowling", count: 3, slowP: 40, slowT: 60, r: 3000 } } } },
    { id: "halfpipe", name: "Halfpipe Rider", type: "troop", rarity: "rare", cost: 4, unit: "halfpipe",
      role: "Lands with a hit", text: "Drops in from above and lands with a 160 damage splash.",
      summit: { every: 2, text: "The landing also knocks back and stuns for 0.5 s.", unit: { onDeploy: { dmg: 160, r: 2000, knock: 1500, stun: 10 } } } },
    { id: "glider", name: "Paraglider", type: "troop", rarity: "rare", cost: 4, unit: "glider",
      role: "Flying ranged", text: "Shoots from the air. When it goes down, a gust pushes enemies away.",
      summit: { every: 2, text: "Arrives with a 300 point shield.", unit: { shield: 300 } } },
    { id: "coach", name: "Whistle Coach", type: "troop", rarity: "rare", cost: 4, unit: "coach",
      role: "Stun pulse", text: "Every 2.5 s a sharp whistle stuns enemy troops near the coach.",
      summit: { every: 2, text: "Whistles every 1.75 s.", unit: { pulse: { every: 35, r: 2500, stun: 16 } } } },
    { id: "plow", name: "Snowplow", type: "troop", rarity: "rare", cost: 5, unit: "plow",
      role: "Shielded pusher", text: "A big blade soaks up 800 damage first, and every hit shoves troops aside.",
      summit: { every: 2, text: "The blade shield is 1300.", unit: { shield: 1300 } } },
    { id: "keeper", name: "Bonfire Keeper", type: "troop", rarity: "rare", cost: 4, unit: "keeper",
      role: "Haste aura", text: "Friendly troops near the bonfire move and hit 30% faster.",
      summit: { every: 2, text: "The warmth reaches much further.", unit: { aura: { kind: "haste", r: 3800, p: 30 } } } },
    { id: "fisher", name: "Ice Fisher", type: "troop", rarity: "epic", cost: 4, unit: "fisher",
      role: "Hooks a troop", text: "Casts a line up to 6.5 tiles and reels a ground troop in. Heavy ones reel the fisher to them.",
      summit: { every: 2, text: "The hook also stuns for 1.5 s.", unit: { hook: { range: 6500, cd: 200, speed: 500, stun: 30 } } } },
    { id: "groomer", name: "Groomer", type: "troop", rarity: "epic", cost: 6, unit: "groomer",
      role: "Charging tank", text: "After rolling 2.5 tiles unstopped it charges, and its next hit does double damage.",
      summit: { every: 2, text: "The charge hit knocks back and stuns for 0.5 s.", unit: { charge: { dist: 2500, speed: 110, mult: 200, knock: 1500, stun: 10 } } } },
    { id: "yeti", name: "Yeti", type: "troop", rarity: "epic", cost: 7, unit: "yeti",
      role: "Tank, only buildings", text: "Walks to buildings and smashes them. When it falls it leaves a frost burst that slows.",
      summit: { every: 2, text: "Roars as it lands: enemy troops near it are stunned for 1.2 s.", unit: { onDeploy: { stun: 24, r: 3000 } } } },
    { id: "owl", name: "Snow Owl", type: "troop", rarity: "epic", cost: 5, unit: "owl",
      role: "Flying splash", text: "A big owl that drops ice from above, splashing ground and air.",
      summit: { every: 2, text: "Its first drop does double damage.", unit: { firstMult: 200 } } },
    { id: "musher", name: "Musher", type: "troop", rarity: "epic", cost: 6, unit: "musher",
      role: "Spawner on the move", text: "A dog sled that lets a husky off every 4 s, and two more when it is wrecked.",
      summit: { every: 2, text: "Lets a husky off every 2.75 s.", unit: { spawn: { unit: "husky", every: 55, count: 1 } } } },
    { id: "guide", name: "The Old Guide", type: "troop", rarity: "legend", cost: 5, unit: "guide",
      role: "Legend: Rally", text: "A tough old guide. Ability Rally: friendly troops near him move and hit 35% faster for 4 s.",
      summit: { every: 3, text: "Arrives with a 500 point shield.", unit: { shield: 500 } } },
    { id: "matriarch", name: "Frost Matriarch", type: "troop", rarity: "legend", cost: 6, unit: "matriarch",
      role: "Legend: Whiteout", text: "Ranged splash. Ability Whiteout: freezes enemy troops near her for 2 s.",
      summit: { every: 3, text: "Her attacks also slow by 30% for 1.5 s.", unit: { slowOnHit: { p: 30, t: 30 } } } },
    { id: "rider", name: "The Rider", type: "troop", rarity: "legend", cost: 4, unit: "rider",
      role: "Legend: Big Air", text: "A fast board rider. Ability Big Air: leaps at the nearest enemy and lands for 250 splash.",
      summit: { every: 3, text: "Drops in with a 200 damage landing.", unit: { onDeploy: { dmg: 200, r: 2000 } } } },
    { id: "ranger", name: "The Ranger", type: "troop", rarity: "legend", cost: 5, unit: "ranger",
      role: "Legend: Flare", text: "A long range rifle. Ability Flare: calls a flare onto her target for 380 damage.",
      summit: { every: 3, text: "Arrives with a 350 point shield.", unit: { shield: 350 } } },
    // ---- buildings ----
    { id: "cannon", name: "Snow Cannon", type: "building", rarity: "common", cost: 3, unit: "cannon",
      role: "Ground defence", text: "A snowmaking gun turned into a cannon. Hits ground only. Lasts 30 s.",
      summit: { every: 3, text: "Its shots slow by 30% for 1 s.", unit: { slowOnHit: { p: 30, t: 20 } } } },
    { id: "flaretower", name: "Flare Tower", type: "building", rarity: "rare", cost: 4, unit: "flaretower",
      role: "Air and ground defence", text: "Fires flares at air and ground. Lasts 31 s.",
      summit: { every: 3, text: "Its flares splash a little.", unit: { splash: 900 } } },
    { id: "lifttower", name: "Lift Tower", type: "building", rarity: "rare", cost: 5, unit: "lifttower",
      role: "Spawner", text: "Sends two Lifties down every 7 s, and one more when it falls. Lasts 40 s.",
      summit: { every: 2, text: "Sends three Lifties at a time.", unit: { spawn: { unit: "liftie", every: 140, count: 3 } } } },
    { id: "cornice", name: "Cornice", type: "building", rarity: "epic", cost: 3, unit: "cornice",
      role: "Trap", text: "A snow overhang. When an enemy ground troop comes close it collapses for 460 damage and a big push.",
      summit: { every: 2, text: "The collapse also stuns for 2 s.", unit: { trap: { trigger: 1500, dmg: 460, r: 2500, knock: 1500, stun: 40 } } } },
    { id: "catapult", name: "Snow Catapult", type: "building", rarity: "epic", cost: 6, unit: "catapult",
      role: "Siege", text: "Lobs packed snow 11 tiles. Slow to set up, cannot hit anything closer than 3 tiles.",
      summit: { every: 2, text: "Its shots splash much wider.", unit: { splash: 1800 } } },
    { id: "igloo", name: "Igloo", type: "building", rarity: "rare", cost: 4, unit: "igloo",
      role: "Decoy", text: "Big and sturdy, it draws building hunters. Two Snowlings come out when it falls.",
      summit: { every: 2, text: "Four Snowlings come out.", unit: { death: { spawn: "snowling", count: 4 } } } },
    { id: "fence", name: "Snow Fence", type: "building", rarity: "common", cost: 2, unit: "fence",
      role: "Slow field", text: "Enemy ground troops near the fence move and hit 35% slower.",
      summit: { every: 3, text: "Tougher (1200 health) and slows by 50%.", unit: { hp: 1200, aura: { kind: "slow", r: 2200, p: 50 } } } },
    // ---- spells ----
    { id: "volley", name: "Snowball Volley", type: "spell", rarity: "common", cost: 2,
      spell: { kind: "damage", dmg: 180, r: 2500, towerPct: 35, knock: 500, delay: 14 },
      role: "Small area damage", text: "A volley of hard snowballs. Clears swarms.",
      summit: { every: 3, text: "Covers a much wider area.", spell: { r: 3200 } } },
    { id: "icicles", name: "Icicles", type: "spell", rarity: "common", cost: 1,
      spell: { kind: "damage", dmg: 105, r: 2200, towerPct: 30, delay: 6 },
      role: "Cheap quick damage", text: "Icicles drop almost at once. Finishes off small troops.",
      summit: { every: 3, text: "Also stuns for 0.75 s.", spell: { stun: 15 } } },
    { id: "avalanche", name: "Avalanche", type: "spell", rarity: "rare", cost: 4,
      spell: { kind: "damage", dmg: 380, r: 2800, towerPct: 35, knock: 1500, delay: 18 },
      role: "Big area damage, knockback", text: "Snow slides down and buries what is there, pushing survivors back.",
      summit: { every: 2, text: "Pushes much harder.", spell: { knock: 2600 } } },
    { id: "blizzard", name: "Blizzard", type: "spell", rarity: "rare", cost: 3,
      spell: { kind: "zone", r: 3500, ticks: 100, slowP: 50, dps: 20, towerPct: 30, enemy: 1 },
      role: "Slow field", text: "For 5 s enemies inside move and hit 50% slower and take light damage.",
      summit: { every: 2, text: "Slows by 70%.", spell: { slowP: 70 } } },
    { id: "hotsprings", name: "Hot Springs", type: "spell", rarity: "rare", cost: 3,
      spell: { kind: "zone", r: 3000, ticks: 80, heal: 90, friend: 1 },
      role: "Heal field", text: "For 4 s your troops and buildings inside heal 90 every second.",
      summit: { every: 2, text: "Heals 130 every second.", spell: { heal: 130 } } },
    { id: "freeze", name: "Flash Freeze", type: "spell", rarity: "epic", cost: 4,
      spell: { kind: "freeze", r: 3000, ticks: 60, dmg: 80, towerPct: 50, delay: 8 },
      role: "Freezes an area", text: "Everything of the enemy's inside freezes solid for 3 s, towers too.",
      summit: { every: 2, text: "The freeze lasts 4 s.", spell: { ticks: 80 } } },
    { id: "drop", name: "Snowling Drop", type: "spell", rarity: "common", cost: 3,
      spell: { kind: "spawn", unit: "snowling", count: 4, delay: 20 },
      role: "Troops anywhere", text: "Four Snowlings land anywhere on the field.",
      summit: { every: 3, text: "Six Snowlings land.", spell: { count: 6 } } },
    { id: "roll", name: "Snowball Roll", type: "spell", rarity: "common", cost: 2,
      spell: { kind: "roll", dist: 9000, half: 1300, dmg0: 150, dmg1: 260, knock: 700, speed: 220, towerPct: 35 },
      role: "Rolling line damage", text: "A giant snowball rolls 9 tiles forward, growing as it goes. Ground only.",
      summit: { every: 3, text: "A much wider snowball.", spell: { half: 1900 } } },
    { id: "chinook", name: "Chinook Wind", type: "spell", rarity: "rare", cost: 2,
      spell: { kind: "push", r: 3000, dist: 2500, dmg: 50, delay: 6 },
      role: "Pushes troops back", text: "A warm gust that blows enemy troops back toward their side and makes them pick new targets.",
      summit: { every: 3, text: "Blows them much further.", spell: { dist: 4000 } } },
    { id: "rush", name: "Cocoa Rush", type: "spell", rarity: "epic", cost: 2,
      spell: { kind: "zone", r: 3000, ticks: 100, hasteP: 35, friend: 1 },
      role: "Speed boost", text: "For 5 s your troops inside move and hit 35% faster.",
      summit: { every: 3, text: "Lasts 8 s.", spell: { ticks: 160 } } },
    { id: "icebridge", name: "Ice Bridge", type: "spell", rarity: "rare", cost: 1,
      spell: { kind: "bridge", half: 1300, ticks: 200 },
      role: "New crossing", text: "Freezes the stream into a bridge for 10 s. Ground troops of both sides can use it.",
      summit: { every: 3, text: "The bridge lasts 18 s.", spell: { ticks: 360 } } },
    { id: "rockfall", name: "Rockfall", type: "spell", rarity: "epic", cost: 5,
      spell: { kind: "damage", dmg: 700, r: 2700, towerPct: 30, stun: 10, delay: 24 },
      role: "Heavy delayed damage", text: "Rocks come down after 1.2 s. Huge damage, if they are still there.",
      summit: { every: 2, text: "The rocks fall twice as fast.", spell: { delay: 12 } } },
  ];

  const DECKS = {
    starter: ["skipatrol", "kids", "biathletes", "torch", "cannon", "volley", "goat", "golem"],
    samples: [
      { name: "Goat Rush", cards: ["goat", "skipatrol", "kids", "icicles", "cannon", "biathletes", "volley", "ravens"] },
      { name: "Yeti Push", cards: ["yeti", "sage", "stbernard", "ravens", "avalanche", "marmots", "glider", "keeper"] },
      { name: "Catapult Siege", cards: ["catapult", "fence", "cannon", "icicles", "volley", "biathletes", "kids", "plow"] },
      { name: "Groomer Control", cards: ["groomer", "fisher", "coach", "freeze", "kids", "torch", "flaretower", "roll"] },
      { name: "Musher Swarm", cards: ["musher", "lifttower", "drop", "ravens", "marmots", "rush", "owl", "chinook"] },
      { name: "Rider Cycle", cards: ["rider", "penguins", "marmots", "icicles", "cornice", "halfpipe", "porter", "roll"] },
      { name: "Matriarch Wall", cards: ["matriarch", "golem", "igloo", "hotsprings", "biathletes", "kids", "blizzard", "ravens"] },
      { name: "Guide Bridge", cards: ["guide", "plow", "keeper", "torch", "skipatrol", "rockfall", "icebridge", "glider"] },
    ],
  };

  const RARITY = {
    common: { name: "Green", sign: "circle", colour: "#3f9d4b" },
    rare: { name: "Blue", sign: "square", colour: "#2f6fc4" },
    epic: { name: "Black", sign: "diamond", colour: "#22252b" },
    legend: { name: "Legend", sign: "double", colour: "#d48a1c" },
  };

  // trophy bands, lowest first
  const LEAGUES = [
    { name: "Bunny Hill", min: 0 }, { name: "Magic Carpet", min: 200 }, { name: "Green Run", min: 450 },
    { name: "Blue Run", min: 750 }, { name: "Mogul Field", min: 1100 }, { name: "Black Diamond", min: 1500 },
    { name: "Tree Well", min: 1950 }, { name: "Couloir", min: 2450 }, { name: "Cornice Line", min: 3000 },
    { name: "Summit", min: 3600 },
  ];

  const EMOTES = ["Nice line!", "Brr!", "Good game", "Oops", "Send it!", "Hot cocoa?"];

  const DB = { RULES: RULES, UNITS: UNITS, CARDS: CARDS, DECKS: DECKS, RARITY: RARITY, LEAGUES: LEAGUES, EMOTES: EMOTES };
  if (typeof module === "object" && module && module.exports) module.exports = DB;
  if (root) root.LeonClashCards = DB;
})(typeof globalThis !== "undefined" ? globalThis : null);
