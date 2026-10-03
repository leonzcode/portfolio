/* The shape of the world, shared by the game and the workers.
   Heights run 0..383 here, which is Minecraft's -64..319: Y0 is the offset. */
export const CH = 16;          // a chunk is 16 x 16 columns
export const H = 384;          // and 384 tall
export const Y0 = -64;         // world y = index y + Y0
export const SEA = 63 - Y0;    // sea level, in index terms (127)
export const VOL = CH * CH * H;
export const idx = (x, y, z) => (y << 8) | (z << 4) | x;   // x, z 0..15, y 0..383

// fluid state in the meta byte: level 0 (source) .. 7, and a bit for falling
export const LEVEL = 7, FALLING = 8;
