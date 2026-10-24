/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the plans for every structure drawn from our
   own designs (see ../build.js). PLANS[type](ctx) returns the structure's
   pieces (Builds) for a start; ctx is described in ../starts.js.

   Each file next to this one designs a family and exports its own PLANS;
   this one gathers them. PLANS.abandoned_camp handles every
   abandoned_camp_<biome> type (ctx.type says which).
--------------------------------------------------------------------------- */
import { PLANS as VILLAGES } from './villages.js?v=107';
import { PLANS as SMALL } from './small.js?v=107';
import { PLANS as PORTALS } from './portals.js?v=107';
import { PLANS as OCEAN } from './ocean.js?v=107';
import { PLANS as MANSION } from './mansion.js?v=107';
import { PLANS as TRAIL } from './trail.js?v=107';
import { PLANS as TRIAL } from './trial.js?v=107';
import { PLANS as ANCIENT } from './ancient_city.js?v=107';
import { PLANS as NETHER_END } from './nether_end.js?v=107';

export const PLANS = Object.assign({}, VILLAGES, SMALL, PORTALS, OCEAN, MANSION, TRAIL, TRIAL, ANCIENT, NETHER_END);
