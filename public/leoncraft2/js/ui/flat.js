/* ---------------------------------------------------------------------------
   Leoncraft 2 - the Superflat screens of Create World (gen/flat.js makes
   the world), laid out as the game's:

     Superflat Customization   the layers, top first, each with its height
                               (Remove Layer takes the selected one away);
                               Presets, Done, Cancel
     Select a Preset           the game's nine presets, the code of the one
                               picked in a field you can edit or paste into
                               ("Share your preset with your friends!");
                               Use Preset, Cancel

   Done hands the code and its structures back (onDone(code, structures)).
--------------------------------------------------------------------------- */
import { Screen, Button, TextField, ScrollList, WHITE, GREY } from './gui.js?v=107';
import { BLOCKS } from '../blocks.js?v=107';
import { PRESETS, parseFlat, presetOf } from '../gen/flat.js?v=107';

const nameOf = id => (id ? (BLOCKS[id].display || BLOCKS[id].name) : 'Air');
// the code for a list of layers (bottom first) and a biome
const codeOf = (layers, biome) => layers.map(([id, , n]) => (n > 1 ? n + '*' : '') + 'minecraft:' + (id ? BLOCKS[id].name : 'air')).join(',') + ';minecraft:' + biome;

class LayerRow {
  constructor(layer, top, bottom) { this.layer = layer; this.top = top; this.bottom = bottom; }
  render(g, list, i, y, x, w) {
    const [id, , n] = this.layer;
    g.text(nameOf(id), x + 4, y + 6, WHITE);
    const where = this.top && this.bottom ? 'Top / Bottom - Height ' : this.top ? 'Top - Height ' : this.bottom ? 'Bottom - Height ' : 'Height ';
    const t = where + n;
    g.text(t, x + w - g.textWidth(t) - 8, y + 6, WHITE);
  }
}
class PresetRow {
  constructor(p) { this.p = p; }
  render(g, list, i, y, x) { g.text(this.p.name, x + 4, y + 6, WHITE); }
}

export class FlatCustomizeScreen extends Screen {
  constructor(code, structures, onDone) {
    super('Superflat Customization');
    this.code = code; this.structures = structures || []; this.onDone = onDone;
    const def = parseFlat(code) || parseFlat(PRESETS[0].code);
    this.layers = def.layers.map(l => l.slice());
    this.biome = def.biomeName;
  }
  init() {
    const W = this.width, H = this.height;
    this.list = this.add(new ScrollList(0, 32, W, H - 96, 24, { rowWidth: 280, selectable: true }));
    this.fillList();
    this.remove = this.add(new Button(W / 2 - 155, H - 52, 150, 20, 'Remove Layer', () => {
      const e = this.list.selected;
      if (!e) return;
      const i = this.layers.indexOf(e.layer);
      if (i >= 0) this.layers.splice(i, 1);
      this.fillList();
    }));
    this.add(new Button(W / 2 + 5, H - 52, 150, 20, 'Presets', () => {
      this.gui.open(new FlatPresetScreen(this.currentCode(), (code, structures) => {
        const def = parseFlat(code);
        if (def) { this.layers = def.layers.map(l => l.slice()); this.biome = def.biomeName; this.structures = structures; }
      }));
    }));
    this.add(new Button(W / 2 - 155, H - 28, 150, 20, 'Done', () => { this.onDone(this.currentCode(), this.structures); this.gui.back(); }));
    this.add(new Button(W / 2 + 5, H - 28, 150, 20, 'Cancel', () => this.gui.back()));
  }
  currentCode() {
    const code = codeOf(this.layers.length ? this.layers : [[0, 0, 1]], this.biome);
    // a preset left as it was keeps its structures; one changed by hand has none of its own
    const p = presetOf(code);
    if (p) this.structures = p.structures;
    else if (presetOf(this.code) && code !== this.code) this.structures = [];
    return code;
  }
  fillList() {
    this.list.entries = [];
    for (let i = this.layers.length - 1; i >= 0; i--) this.list.entries.push(new LayerRow(this.layers[i], i === this.layers.length - 1, i === 0));
    this.list.selected = null;
    if (this.remove) this.remove.active = false;
    this.list.onSelect = () => { this.remove.active = true; };
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    this.drawTitle(g, 8);
    g.text('Layer Material', this.width / 2 - 136, 20, WHITE);
    g.text('Height', this.width / 2 + 106, 20, WHITE);
  }
}

export class FlatPresetScreen extends Screen {
  constructor(code, onUse) {
    super('Select a Preset');
    this.onUse = onUse;
    this.field = new TextField(0, 0, 274, 20, { value: code, maxLength: 1300, onEnter: () => this.use() });
  }
  init() {
    const W = this.width, H = this.height;
    this.field.x = W / 2 - 137; this.field.y = 40;
    this.add(this.field);
    this.list = this.add(new ScrollList(0, 80, W, H - 117, 24, { rowWidth: 280, selectable: true,
      onSelect: e => { this.field.value = e.p.code; this.picked = e.p; }, onActivate: () => this.use() }));
    this.list.entries = PRESETS.map(p => new PresetRow(p));
    this.add(new Button(W / 2 - 155, H - 28, 150, 20, 'Use Preset', () => this.use()));
    this.add(new Button(W / 2 + 5, H - 28, 150, 20, 'Cancel', () => this.gui.back()));
  }
  use() {
    const code = this.field.value.trim();
    if (!parseFlat(code)) { this.bad = true; this.gui.markDirty(); return; }
    const p = presetOf(code);
    this.onUse(code, p ? p.structures : []);
    this.gui.back();
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    this.drawTitle(g, 8);
    g.text('Share your preset with your friends!', this.width / 2 - 136, 28, GREY);
    g.text(this.bad ? 'That preset cannot be read' : 'Select a Preset', this.width / 2 - 136, 68, this.bad ? 0xFFFF5555 : WHITE);
  }
}
