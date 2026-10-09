/* ---------------------------------------------------------------------------
   Leon Kart - how much scenery to build.

   Everything round a circuit that you cannot drive into - catch fencing every
   four metres down both sides, scrub, woods, floodlights, billboards, radar
   dishes, the crowd, the skyline - costs memory for its models and instance
   lists, and time on the graphics card every frame, because none of it is
   culled (it is instanced, one box round the whole lap). On a slower machine
   that is most of what a frame costs.

   So four levels. Each one is a share (0 to 1) of each kind of thing. What
   races is never touched: the barriers are the wall, so they stay; ice, lava,
   boulders, hazards, cones and item boxes are the same at every level, so a
   lobby still races the same circuit whatever each player picked. A kind at 0
   is not built at all, and its model is never downloaded.
--------------------------------------------------------------------------- */
export const PERF_LEVELS = [
  { id: 'full', name: 'Full', note: 'Everything round the circuit.',
    k: {} },
  { id: 'balanced', name: 'Balanced', note: 'Catch fence on one side, less scrub and fewer far trees.',
    k: { fence: 0.5, scrub: 0.5, pylons: 0.5, dishes: 0.5, worldTrees: 0.6, towers: 0.75 } },
  { id: 'light', name: 'Light', note: 'No fences, rails, scrub or tents; half the boards, lights and woods.',
    k: { fence: 0, rails: 0, scrub: 0, pylons: 0, dishes: 0, tents: 0, flags: 0, boardsLow: 0, boards: 0.5, flood: 0.5,
         lamps: 0.5, trees: 0.6, worldTrees: 0.35, skylineFar: 0, towers: 0.5 } },
  { id: 'minimal', name: 'Minimal', note: 'Just the road, its barriers, the stands and a few trees. For slow machines.',
    k: { fence: 0, rails: 0, scrub: 0, pylons: 0, dishes: 0, tents: 0, flags: 0, boardsLow: 0, boards: 0, flood: 0,
         lamps: 0, pits: 0, crowd: 0, trees: 0.25, worldTrees: 0.15, skylineNear: 0.5, skylineFar: 0, towers: 0.3 } },
];
const KEY = 'mk_perf';

export function perfId() {
  let v = null;
  try { v = localStorage.getItem(KEY); } catch (e) {}
  return PERF_LEVELS.some(l => l.id === v) ? v : 'full';
}
export function setPerf(id) {
  try { localStorage.setItem(KEY, id); } catch (e) {}
}
/* A level used for now without being saved as the choice: split screen draws
   the world twice, so it races one step lighter than whatever was picked. */
let override = null;
export function perfOverride(id) {
  override = id && PERF_LEVELS.some(l => l.id === id) ? id : null;
  return override;
}
export function perfLevel() { return PERF_LEVELS.find(l => l.id === (override || perfId())) || PERF_LEVELS[0]; }
// the share of one kind of thing at the current level
export function share(kind) {
  const k = perfLevel().k[kind];
  return k === undefined ? 1 : k;
}
/* A share of a list, spread evenly along it rather than its first part, so
   half the boards is every other board and not the first half of the lap. */
export function thin(list, kind) {
  const k = share(kind);
  if (k >= 1) return list;
  if (k <= 0) return [];
  return list.filter((_, i) => Math.floor((i + 1) * k) > Math.floor(i * k));
}

/* The scenery the track builder made, trimmed to the current level without
   building anything again: an instanced mesh can be told to draw only its
   first so many instances. The builder lays these out so that any first part
   is an even share (the woods are in random order, the skyline is
   interleaved). Each one carries userData.perf (its kind) and userData.full
   (how many it was made with). */
export function applyToTrack(group) {
  if (!group) return;
  group.traverse(o => {
    if (!o.isInstancedMesh || !o.userData || !o.userData.perf) return;
    const n = Math.round(o.userData.full * share(o.userData.perf));
    o.count = n;
    o.visible = n > 0;
  });
}
