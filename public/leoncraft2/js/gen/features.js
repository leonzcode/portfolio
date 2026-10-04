/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: carvers and features.
   (filled in below as each part is matched against the game)
--------------------------------------------------------------------------- */
export class Decorator {
  constructor(gen) {
    this.gen = gen;
    this.carve = true;
    this.features = true;
  }
  decorate(blocks, meta, cx, cz, grid) {}
  warmEnoughToMelt(biome, x, y, z) { return false; }
}
