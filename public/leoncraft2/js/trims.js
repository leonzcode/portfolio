/* ---------------------------------------------------------------------------
   Leoncraft 2 - armour trims on the item pictures.

   A trimmed helmet, chestplate, pair of leggings or boots shows its trim in
   the inventory, in the colour of the trim's material, as in the game. The
   game keeps a grey trim picture per piece and recolours it from a palette
   per material; this does the same with its own trim pictures (drawn here
   for our armour pictures, a palette step per pixel, 0 the lightest) and the
   material palettes of Pixel Perfection Legacy (CC BY-SA 4.0, credited in
   textures/LICENSE.txt). The trim only shows on the piece's own pixels, and
   a trim of the armour's own material is drawn in darker steps, as the game
   does.

     trimPiece(name)            'helmet', 'chestplate', 'leggings', 'boots'
                                or null, for an item name
     applyTrim(px, name, trim)  recolours a 16 x 16 RGBA picture in place
                                (trim: [pattern, material], as on a stack)
--------------------------------------------------------------------------- */

// eight steps per material, lightest first (Pixel Perfection Legacy's trims/color_palettes)
const PALETTES = {
  amethyst: [0xDEBEF0, 0xC69CDF, 0xAA7CC5, 0x9E6BBC, 0x8F56B1, 0x8246A5, 0x723597, 0x632389],
  copper: [0xD36E4D, 0xC36447, 0xAD5A41, 0x93503A, 0x834836, 0x774432, 0x6B3E2F, 0x4F2E24],
  diamond: [0xDBEEFC, 0xA8E2FF, 0x77CEFB, 0x5FAED8, 0x5698C4, 0x4F81AD, 0x46729F, 0x3D6287],
  emerald: [0x9FF7C5, 0x53D58B, 0x31BC6D, 0x1B9958, 0x1E8454, 0x1E7251, 0x1C5B48, 0x184F3F],
  gold: [0xFFD97D, 0xF7C54C, 0xE5A530, 0xD99434, 0xC78529, 0xAE6C23, 0xA05A2B, 0x874025],
  iron: [0xE5E4E0, 0xC9C7C1, 0xAFACA5, 0x938E88, 0x847E77, 0x6B635E, 0x54514F, 0x3D3D3D],
  lapis: [0x84A4D3, 0x5882C0, 0x3B6BB4, 0x2759A5, 0x20459B, 0x1C3C89, 0x1E387F, 0x1C306B],
  netherite: [0x3D3935, 0x38322E, 0x302A26, 0x28221E, 0x211D1B, 0x1A1816, 0x171313, 0x090707],
  quartz: [0xC9BCB9, 0xBAABA5, 0xA59790, 0x938983, 0x897E76, 0x80726B, 0x786862, 0x705F59],
  redstone: [0xD13A30, 0xAF2C23, 0x932B26, 0x7F2325, 0x70212A, 0x70212A, 0x601F2B, 0x601F2B],
  resin: [0xFFC068, 0xFFA54C, 0xFF7D32, 0xDB5F32, 0xBF5031, 0x933927, 0x782C29, 0x602A2A],
};

// where the trim sits on each piece's picture: a palette step per pixel ('.' none), lit from the upper left
// as the pictures are. Drawn for our pictures (the rim of the helmet, the chestplate's shoulders, collar and
// hem, the leggings' belt and knees, the boots' cuffs and toes).
const MASKS = {
  helmet: [
    '................',
    '................',
    '................',
    '................',
    '.......12.......',
    '................',
    '................',
    '....11222334....',
    '................',
    '................',
    '....2......4....',
    '....3......5....',
    '................',
    '................',
    '................',
    '................'],
  chestplate: [
    '................',
    '................',
    '................',
    '.1122......3344.',
    '......1..3......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....223344.....',
    '................',
    '................'],
  leggings: [
    '................',
    '................',
    '................',
    '....11223344....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '....23....34....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................'],
  boots: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....12....23....',
    '................',
    '................',
    '................',
    '................',
    '..23........34..',
    '................',
    '................',
    '................',
    '................',
    '................'],
};
// the armour materials whose own trim material is drawn darker
const OWN = { iron: 'iron', golden: 'gold', diamond: 'diamond', netherite: 'netherite', copper: 'copper' };

export function trimPiece(name) {
  const m = /_(helmet|chestplate|leggings|boots)$/.exec(name || '');
  return m ? m[1] : null;
}

export function applyTrim(px, name, trim) {
  const piece = trimPiece(name), pal = trim && PALETTES[trim[1]];
  if (!piece || !pal) return;
  const mask = MASKS[piece];
  const dark = OWN[name.slice(0, name.indexOf('_'))] === trim[1] ? 2 : 0;
  for (let y = 0; y < 16; y++) {
    const row = mask[y];
    for (let x = 0; x < 16; x++) {
      const c = row.charCodeAt(x) - 48;
      if (c < 0 || c > 7) continue;
      const i = (y * 16 + x) * 4;
      if (px[i + 3] < 128) continue;
      const col = pal[Math.min(7, c + dark)];
      px[i] = col >> 16 & 255; px[i + 1] = col >> 8 & 255; px[i + 2] = col & 255;
    }
  }
}
