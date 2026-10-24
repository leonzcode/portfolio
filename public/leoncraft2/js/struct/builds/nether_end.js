/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the end city and the bastion remnant, from our
   own designs. Each is drawn in its own file next to this one (end_city.js,
   bastion.js); this one gathers their plans.
--------------------------------------------------------------------------- */
import { endCity } from './end_city.js?v=107';
import { PLANS as BASTION } from './bastion.js?v=107';

export const PLANS = {};

PLANS.end_city = ctx => endCity(ctx);
PLANS.bastion_remnant = BASTION.bastion_remnant;
