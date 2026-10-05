/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the end city and the bastion remnant, from our
   own designs. Each is drawn in its own file next to this one (end_city.js,
   bastion_remnant.js); this one gathers their plans.
--------------------------------------------------------------------------- */
import { endCity } from './end_city.js?v=13';

export const PLANS = {};

PLANS.end_city = ctx => endCity(ctx);
