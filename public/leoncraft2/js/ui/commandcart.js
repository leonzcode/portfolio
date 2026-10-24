/* ---------------------------------------------------------------------------
   Leoncraft 2 - the command block minecart's screen (the game's
   MinecartCommandBlockEditScreen): its command in a box 300 wide, what it
   said the last time it ran (Previous Output, with the O / X button that
   keeps it or not), Done and Cancel. Done sets the command and says so.
--------------------------------------------------------------------------- */
import { Screen, Button, TextField } from './gui.js?v=107';

const WHITE = 0xFFFFFF, GREY = 0xA0A0A0;

export class CommandCartScreen extends Screen {
  /* cart: { command, lastOut, track }; say(text, colour): the chat */
  constructor(cart, say) {
    super('Set Console Command for Block');
    this.cart = cart; this.say = say;
    this.background = 'world';
    this.track = cart.track !== false;
    this.field = new TextField(0, 0, 300, 20, { value: cart.command || '', maxLength: 32500, onEnter: () => this.done() });
    this.out = new TextField(0, 0, 276, 20, { value: this.track ? cart.lastOut || '' : '-', maxLength: 32500 });
    this.out.active = false;
  }
  init() {
    const W = this.width, H = this.height, x = Math.floor(W / 2 - 150);
    this.field.x = x; this.field.y = 50;
    this.out.x = x; this.out.y = 135;
    this.add(this.field); this.add(this.out);
    this.trackBtn = this.add(new Button(x + 280, 135, 20, 20, this.track ? 'O' : 'X', () => {
      this.track = !this.track;
      this.trackBtn.message = this.track ? 'O' : 'X';
      this.out.value = this.track ? this.cart.lastOut || '' : '-';
    }, 'Track output'));
    const y = Math.floor(H / 4) + 120 + 12;
    this.add(new Button(W / 2 - 4 - 150, y, 150, 20, 'Done', () => this.done()));
    this.add(new Button(W / 2 + 4, y, 150, 20, 'Cancel', () => this.gui.back()));
    this.gui.focusText(this.field);
  }
  done() {
    const c = this.cart, cmd = this.field.value.trim();
    c.command = cmd; c.track = this.track;
    if (!this.track) c.lastOut = '';
    if (this.say) this.say('Command set: ' + cmd, WHITE);
    this.gui.back();
  }
  onClose() { if (this.gui && this.gui.textFocus) this.gui._blurText(); }
  render(g, mx, my, dt) {
    const W = this.width, x = Math.floor(W / 2 - 150);
    g.centered(this.title, W / 2, 20, WHITE);
    g.text('Console Command', x, 40, GREY);
    g.text('Previous Output', x, 125, GREY);
    super.render(g, mx, my, dt);
  }
}
