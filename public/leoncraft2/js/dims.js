/* ---------------------------------------------------------------------------
   Leoncraft 2 - the three dimensions.

   Each has its own World (generator, chunks, workers) and its own corner of
   the save (save.js keys "<world>~the_nether:..." and "<world>~the_end:...").
   Heights stay in the same 0..383 index space everywhere (world y = index +
   Y0), so the Nether's and the End's 0..255 sit at index 64..319 and nothing
   else in the engine has to know.

     scale       horizontal blocks per Overworld block (the Nether's 8:1)
     minY        the bottom of the dimension (world y)
     logical     the height portals and respawning work within (world y)
     hasSky      sky light (the Nether has none)
     ambient     the dimension's ambient light (the Nether's 0.1)
     fixedTime   a clock that never moves (the Nether 18000, the End 6000)
     sky         'normal' | 'none' | 'end'
     constAmb    the Nether's even face shading (top and bottom 0.9)
     ultrawarm   water cannot be placed there
     bedsWork    a bed sets the spawn point (elsewhere it explodes)
     anchorsWork respawn anchors work (the Nether only)
--------------------------------------------------------------------------- */
export const DIMS = {
  overworld: { id: 'overworld', name: 'Overworld', scale: 1, minY: -64, logical: 320, hasSky: true, ambient: 0, fixedTime: null,
    sky: 'normal', clouds: true, constAmb: false, ultrawarm: false, bedsWork: true, anchorsWork: false, suffix: '', code: 0 },
  the_nether: { id: 'the_nether', name: 'The Nether', scale: 8, minY: 0, logical: 128, hasSky: false, ambient: 0.1, fixedTime: 18000,
    sky: 'none', clouds: false, constAmb: true, ultrawarm: true, bedsWork: false, anchorsWork: true, foggy: true, suffix: '~the_nether', code: 1 },
  the_end: { id: 'the_end', name: 'The End', scale: 1, minY: 0, logical: 256, hasSky: true, ambient: 0, fixedTime: 6000,
    sky: 'end', clouds: false, constAmb: false, ultrawarm: false, bedsWork: false, anchorsWork: false, brightLightmap: true, suffix: '~the_end', code: 2 },
};
export const DIM_IDS = ['overworld', 'the_nether', 'the_end'];
export const dimOf = id => DIMS[id] || DIMS.overworld;
