/* ---------------------------------------------------------------------------
   Leoncraft 2 - Open to LAN, from the game menu.

   The game's screen: "LAN World", Game Mode (Survival, Spectator,
   Creative, Adventure) and Allow Commands side by side, the port under
   them, Start LAN World and Cancel along the bottom. As in the game,
   starting it puts you in the game mode chosen and allows commands (or
   not) for as long as the world stays open; the game menu's button is
   then greyed out. Nobody else can join yet: there is no network play.

   hooks.lan(): { mode, cheats, open } for the world being played;
   hooks.startLan(mode, cheats, port) does the rest (main.js).
--------------------------------------------------------------------------- */
import { Screen, Button, CycleButton, TextField, onOff, WHITE } from './gui.js?v=107';

const MODE_NAMES = { survival: 'Survival', spectator: 'Spectator', creative: 'Creative', adventure: 'Adventure' };
const validPort = s => /^\d+$/.test(s) && +s >= 1024 && +s <= 65535;

export class LanScreen extends Screen {
  constructor() {
    super('LAN World');
    this.mode = null; this.cheats = null;
    // a free port, as the game finds one: anything from 1024 up
    this.portField = new TextField(0, 0, 150, 20, { value: String(1024 + Math.floor(Math.random() * 64000)), maxLength: 5,
      filter: v => /^\d*$/.test(v), onChange: () => this.check(), onEnter: () => this.start() });
  }
  init() {
    const W = this.width, H = this.height, st = this.hooks.lan ? this.hooks.lan() : { mode: 'survival', cheats: false };
    if (this.mode === null) { this.mode = st.mode; this.cheats = st.cheats; }
    this.add(new CycleButton(W / 2 - 155, 100, 150, 20, 'Game Mode', { values: ['survival', 'spectator', 'creative', 'adventure'], value: this.mode,
      format: v => MODE_NAMES[v], onChange: v => { this.mode = v; } }));
    this.add(new CycleButton(W / 2 + 5, 100, 150, 20, 'Allow Commands', { values: [false, true], value: this.cheats, format: onOff, onChange: v => { this.cheats = v; } }));
    this.portField.x = W / 2 - 75; this.portField.y = 160;
    this.add(this.portField);
    this.startBtn = this.add(new Button(W / 2 - 155, H - 28, 150, 20, 'Start LAN World', () => this.start(),
      'Sets your game mode and commands for this world. Other players cannot join: there is no network play in Leoncraft 2'));
    this.add(new Button(W / 2 + 5, H - 28, 150, 20, 'Cancel', () => this.gui.back()));
    this.check();
  }
  check() { if (this.startBtn) this.startBtn.active = validPort(this.portField.value); }
  start() {
    if (!validPort(this.portField.value)) return;
    if (this.hooks.startLan) this.hooks.startLan(this.mode, this.cheats, +this.portField.value);
  }
  render(g, mx, my, dt) {
    const cx = this.width / 2;
    g.centered(this.title, cx, 50, WHITE);
    g.centered('Settings for Other Players', cx, 82, WHITE);
    g.centered('Port Number', cx, 142, WHITE);
    if (!validPort(this.portField.value)) g.centered('Port must be between 1024 and 65535', cx, 185, 0xFF5555);
    super.render(g, mx, my, dt);
  }
}
