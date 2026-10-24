/* ---------------------------------------------------------------------------
   Leoncraft 2 - the game's own parts, loaded once the title screen is up.

   The title screen needs none of this: mobs, the world simulating itself,
   the dimensions, the hands, items lying about, chests, signs, the dials,
   advancements, statistics, recipes and the server code (91 modules, about
   600 KB). main.js loads it (loadParts) as soon as the title is shown, and
   a world opened before it is in waits for it only once its ground is made.
   main.js imports the modules below one at a time first, in this order
   (PART_STEPS, with a frame between): a line added here goes there too.
--------------------------------------------------------------------------- */
export { enchantDebug } from './enchanting.js?v=107';
export { Survival } from './survival.js?v=107';
export { survivalHooks, respawnPlayer, respawnSpot } from './life.js?v=107';
export { Drops, dropItem, giveXp } from './drops.js?v=107';
export { Containers } from './containers.js?v=107';
export { Hands } from './hands.js?v=107';
export { Entities } from './entities/manager.js?v=107';
export { Sim } from './sim/sim.js?v=107';
export { Realms } from './dim/realms.js?v=107';
export { structuresApi } from './struct/spawners.js?v=107';
export { Details, isSign } from './details.js?v=107';
export { SignEditScreen } from './ui/sign.js?v=107';
export { tickDials, dialInHotbar, setUse, deathPoint, setDeathPoint } from './dials.js?v=107';
export { MultiplayerScreen, DisconnectedScreen, ReconnectScreen, rejoin } from './ui/multiplayer.js?v=107';
export { advInit, advWorld, advParts, advTick, advState, advLeave, openAdvancements } from './adv/game.js?v=107';
export { statsWorld, statsTick, statsState, statsQuit, statsLeave, openStatistics } from './stats.js?v=107';
export { recipesWorld, recipesTick, recipesState, recipesLeave } from './recipes.js?v=107';
