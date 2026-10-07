/* ---------------------------------------------------------------------------
   Leoncraft 2 - Play Multiplayer.

   The game's multiplayer screens, laid out with its numbers: the server
   list (36 high rows, 305 wide, each server's picture, name, two lines
   under it, the player count and the signal bars on the right), Join
   Server, Create Server, Edit, Delete, Refresh and Back below it.

   The servers are Leoncraft 2's own on the mc server (lc2.js in mlhub), not
   addresses typed in: anyone can make one (three per browser), public or
   private with a password, survival or creative. Edit and Delete are for
   the browser that made it. A private server asks for its password the
   first time and remembers it. Joining shows Connecting to the server...,
   then the world loads as a singleplayer one does (net/net.js); a server
   that turns you away or a connection that drops says why, with Back to
   server list.

   Your name on servers is set with the button where the game has Direct
   Connection (kept in this browser).
--------------------------------------------------------------------------- */
import { Screen, Button, TextField, CycleButton, ScrollList, WHITE, GREY, onOff } from './gui.js?v=23';
import { ConfirmScreen } from './menus.js?v=23';
import { Net, listServers, createServer, editServer, deleteServer, playerName, setPlayerName, cleanName, FAIL_TEXT, SERVER_DOWN } from '../net/net.js?v=23';
import { parseSeed } from '../gen/random.js?v=23';

const PW_KEY = 'lc2_pw_';
const savedPassword = id => { try { return localStorage.getItem(PW_KEY + id) || ''; } catch (e) { return ''; } };
const keepPassword = (id, pw) => { try { if (pw) localStorage.setItem(PW_KEY + id, pw); else localStorage.removeItem(PW_KEY + id); } catch (e) {} };
const MODE_NAMES = { survival: 'Survival', creative: 'Creative', adventure: 'Adventure' };

/* ---- one server in the list ---- */
class ServerEntry {
  constructor(s, screen) { this.s = s; this.screen = screen; }
  render(g, list, i, top, left, width, h, mx, my, hovered) {
    const s = this.s, ping = this.screen.ping;
    g.text(g.font.trim(s.name, width - 80), left + 35, top + 1, WHITE, false);
    const line1 = s.motd || (s.kind === 'private' ? 'A private server' : 'A public server');
    g.text(g.font.trim(line1, width - 40), left + 35, top + 12, 0x808080, false);
    const line2 = (MODE_NAMES[s.mode] || 'Survival') + ' Mode' + (s.cheats ? ', Commands' : '') + (s.kind === 'private' ? ', Password' : '') + (s.mine ? ', yours' : '');
    g.text(g.font.trim(line2, width - 40), left + 35, top + 21, 0x808080, false);
    // the player count and the signal bars, top right
    const count = s.players + '/' + s.max, cw = g.textWidth(count);
    g.text(count, left + width - cw - 17, top + 1, 0x808080, false);
    const bars = ping < 0 ? 5 : ping < 150 ? 0 : ping < 300 ? 1 : ping < 600 ? 2 : ping < 1000 ? 3 : 4;
    g.blit('icons', 0, 176 + bars * 8, 10, 8, left + width - 15, top);
    // the picture: grass and dirt, with a padlock on a private one
    g.fill(left, top, left + 32, top + 32, 0xFF5B3F2B);
    g.fill(left, top, left + 32, top + 8, 0xFF5E8C32);
    g.fill(left, top + 8, left + 32, top + 10, 0xFF4A7027);
    g.fill(left + 4, top + 16, left + 8, top + 20, 0xFF7A5639);
    g.fill(left + 20, top + 22, left + 24, top + 26, 0xFF46301F);
    if (s.kind === 'private') {
      g.fill(left + 10, top + 14, left + 22, top + 26, 0xFFC8A02A);
      g.fill(left + 12, top + 9, left + 14, top + 15, 0xFF9A9A9A); g.fill(left + 18, top + 9, left + 20, top + 15, 0xFF9A9A9A); g.fill(left + 12, top + 8, left + 20, top + 10, 0xFF9A9A9A);
      g.fill(left + 15, top + 18, left + 17, top + 22, 0xFF3A2A08);
    }
    if (hovered) {
      g.fill(left, top, left + 32, top + 32, 0xA0909090);
      g.blit('world_selection', 0, mx - left < 32 ? 32 : 0, 32, 32, left, top);
      // the names of who is on, over the count; the time it took over the bars
      if (mx >= left + width - cw - 17 && mx < left + width - 15 && my < top + 9 && s.names && s.names.length) g.setTooltip(s.names);
      else if (mx >= left + width - 15 && mx < left + width - 5 && my < top + 8) g.setTooltip(ping < 0 ? 'No connection' : ping + 'ms');
    }
  }
  mouseClicked(mx, my, button, list) {
    if (button === 0 && mx - list.rowLeft < 32 && list.onActivate) { list.setSelected(this); list.onActivate(this); return true; }
    return false;
  }
}

export class MultiplayerScreen extends Screen {
  constructor(message) {
    super('Play Multiplayer');
    this.servers = []; this.ping = -1; this.status = 'Pinging...'; this.message = message || '';
    this.selectedId = null;
  }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    this.list = this.add(new ScrollList(0, 32, W, H - 64 - 32, 36, {
      rowWidth: 305, selectable: true,
      onSelect: e => { this.selectedId = e ? e.s.id : null; this.updateButtons(); },
      onActivate: e => this.join(e.s),
    }));
    this.joinB = this.add(new Button(W / 2 - 154, H - 52, 100, 20, 'Join Server', () => { const s = this.sel(); if (s) this.join(s); }));
    this.add(new Button(W / 2 - 50, H - 52, 100, 20, 'Name: ' + playerName(), () => g.open(new NameScreen())));
    this.add(new Button(W / 2 + 54, H - 52, 100, 20, 'Create Server', () => g.open(new CreateServerScreen())));
    this.editB = this.add(new Button(W / 2 - 154, H - 28, 70, 20, 'Edit', () => { const s = this.sel(); if (s && s.mine) g.open(new CreateServerScreen(s)); }));
    this.delB = this.add(new Button(W / 2 - 74, H - 28, 70, 20, 'Delete', () => this.remove()));
    this.add(new Button(W / 2 + 4, H - 28, 70, 20, 'Refresh', () => this.refresh()));
    this.add(new Button(W / 2 + 80, H - 28, 75, 20, 'Back', () => g.back()));
    this.fill();
    if (!this.loaded) { this.loaded = true; this.refresh(); }
  }
  sel() { const e = this.list.selected; return e ? e.s : null; }
  updateButtons() {
    const s = this.sel();
    this.joinB.active = !!s;
    this.editB.active = this.delB.active = !!(s && s.mine);
    this.editB.tooltip = this.delB.tooltip = s && !s.mine ? 'Only the browser that made a server can change it' : null;
  }
  fill() {
    this.list.entries = this.servers.map(s => new ServerEntry(s, this));
    this.list.selected = this.list.entries.find(e => e.s.id === this.selectedId) || null;
    this.list.setScroll(this.list.scroll);
    this.updateButtons();
    if (this.gui) this.gui.markDirty();
  }
  async refresh() {
    this.status = 'Pinging...'; this.ping = -1;
    if (this.gui) this.gui.markDirty();
    this.status2 = '';
    try {
      const r = await listServers();
      this.servers = r.servers; this.ping = r.ping; this.status = '';
    } catch (e) {
      // nothing answering, or an mc server without Leoncraft 2 on it yet: said plainly (net.js FAIL_TEXT)
      const t = FAIL_TEXT[(e && e.kind) || SERVER_DOWN] || FAIL_TEXT.down;
      this.servers = []; this.status = t[0]; this.status2 = t[1];
    }
    this.fill();
  }
  remove() {
    const s = this.sel(), g = this.gui;
    if (!s || !s.mine) return;
    g.open(new ConfirmScreen('Are you sure you want to remove this server?', "'" + s.name + "' will be lost forever! (A long time!)", 'Delete', 'Cancel', async yes => {
      g.back();
      if (!yes) return;
      try { const r = await deleteServer(s.id); if (r && r.error) this.message = r.error; } catch (e) { this.message = 'Could not reach the server.'; }
      this.selectedId = null;
      this.refresh();
    }));
  }
  // join: the password kept for it (or none), and ask for one if it is wrong
  join(s, password) {
    const g = this.gui, pw = password !== undefined ? password : savedPassword(s.id);
    if (s.kind === 'private' && !pw) { g.open(new PasswordScreen(s, false)); return; }
    const scr = new ConnectingScreen();
    g.open(scr);
    Net.connect(s.id, pw, playerName()).then(net => {
      if (scr.cancelled) { net.close(); return; }
      if (s.kind === 'private') keepPassword(s.id, pw);
      scr.text = 'Joining world...';
      if (this.hooks.play) this.hooks.play(net.entry(), { isNew: false });
    }, err => {
      if (scr.cancelled) return;
      if (err && err.password) { keepPassword(s.id, ''); g.replace(new PasswordScreen(s, !!pw)); return; }
      g.replace(new DisconnectedScreen('Failed to connect to the server', (err && err.reason) || 'Connection refused'));
    });
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    g.centered(this.title, this.width / 2, 20, WHITE);
    if (this.status) {
      const y = 32 + Math.floor((this.height - 96) / 2) - 4;
      // (a server that cannot be reached is said in the game's dark red, with why under it)
      g.centered(this.status, this.width / 2, y - (this.status2 ? 5 : 0), this.status2 ? 0xAA0000 : GREY);
      if (this.status2) for (const [i, l] of g.font.wrap(this.status2, this.width - 50).entries()) g.centered(l, this.width / 2, y + 6 + i * 10, GREY);
    }
    if (this.message) g.centered(this.message, this.width / 2, this.height - 64 - 4 - 9, 0xFF5555);
  }
  keyPressed(e) {
    if (super.keyPressed(e)) return true;
    const L = this.list, n = L.entries.length;
    if (e.key === 'F5') { this.refresh(); return true; }
    if (!n) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      let i = L.entries.indexOf(L.selected);
      i = e.key === 'ArrowDown' ? Math.min(n - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      L.setSelected(L.entries[i]); L.ensureVisible(L.entries[i]);
      return true;
    }
    if (e.key === 'Enter' && L.selected) { this.join(L.selected.s); return true; }
    return false;
  }
}

/* ---- Create Server, and Edit Server for the one who made it ---- */
export class CreateServerScreen extends Screen {
  constructor(editing) {
    super(editing ? 'Edit Server Info' : 'Create Server');
    const e = this.editing = editing || null;
    this.kind = e ? e.kind : 'public';
    this.mode = e ? e.mode : 'survival';
    this.cheats = e ? !!e.cheats : false;
    // spawn protection, as server.properties has it: 16 blocks round the world spawn that only operators can change (0 for none)
    this.prot = e && e.spawnProt !== undefined ? (e.spawnProt | 0 ? 16 : 0) : 16;
    this.nameField = new TextField(0, 0, 200, 20, { value: e ? e.name : 'Leoncraft Server', maxLength: 32, onEnter: () => this.done() });
    this.motdField = new TextField(0, 0, 200, 20, { value: e ? e.motd || '' : '', maxLength: 60, hint: 'A line under the name' });
    this.pwField = new TextField(0, 0, 200, 20, { value: '', maxLength: 32, hint: e ? 'Leave blank to keep it' : 'Needed to join', onEnter: () => this.done() });
    this.seedField = new TextField(0, 0, 200, 20, { value: '', maxLength: 32, hint: 'Leave blank for a random seed', onEnter: () => this.done() });
    this.error = '';
  }
  init() {
    const W = this.width, H = this.height, g = this.gui, x = Math.floor(W / 2 - 100);
    // a quarter of the way down where there is room, never so low the buttons run into the fields
    const contentH = 32 * (this.editing ? 3 : 4) + 24 * (this.editing ? 3 : 2);
    let y = Math.max(28, Math.min(Math.floor(H / 4) - 36, H - 28 - 22 - contentH));
    this.labels = [];
    const field = (label, f) => { this.labels.push([label, x, y]); f.x = x; f.y = y + 10; this.add(f); y += 32; };
    field('Server Name', this.nameField);
    field('Message of the Day', this.motdField);
    this.add(new CycleButton(x, y, 98, 20, '', { values: ['public', 'private'], value: this.kind, format: v => (v === 'public' ? 'Public' : 'Private'),
      tooltip: v => (v === 'public' ? 'Anyone can join' : 'Only people with the password can join'), onChange: v => { this.kind = v; this.pwField.active = v === 'private'; } }));
    this.add(new CycleButton(x + 102, y, 98, 20, '', { values: ['survival', 'creative'], value: this.mode, format: v => MODE_NAMES[v], onChange: v => { this.mode = v; } }));
    y += 24;
    this.add(new CycleButton(x, y, 200, 20, 'Allow Commands', { values: [false, true], value: this.cheats, format: onOff, onChange: v => { this.cheats = v; },
      tooltip: () => 'Whether everyone on the server can use commands like /gamemode and /time' }));
    y += 24;
    // (on Edit, where the seed's row would be: a new server starts with the game's 16)
    if (this.editing) {
      this.add(new CycleButton(x, y, 200, 20, 'Spawn Protection', { values: [16, 0], value: this.prot, format: v => (v ? v + ' blocks' : 'OFF'), onChange: v => { this.prot = v; },
        tooltip: () => 'Only operators can break, place or use blocks this close to the world spawn' }));
      y += 24;
    }
    field('Password', this.pwField);
    this.pwField.active = this.kind === 'private';
    if (!this.editing) field('Seed for the World Generator', this.seedField);
    const by = Math.min(H - 28, y + 20);
    this.add(new Button(W / 2 - 100, by, 98, 20, this.editing ? 'Done' : 'Create', () => this.done()));
    this.add(new Button(W / 2 + 2, by, 98, 20, 'Cancel', () => g.back()));
    this.errY = by - 12;
  }
  async done() {
    if (this.busy) return;
    const name = this.nameField.value.trim();
    if (!name) { this.error = 'Give your server a name.'; this.gui.markDirty(); return; }
    const pw = this.pwField.value;
    if (this.kind === 'private' && !pw && !(this.editing && this.editing.kind === 'private')) { this.error = 'A private server needs a password.'; this.gui.markDirty(); return; }
    this.busy = true; this.error = this.editing ? 'Saving...' : 'Creating...'; this.gui.markDirty();
    let r;
    try {
      const o = { name, motd: this.motdField.value.trim(), kind: this.kind, mode: this.mode, cheats: this.cheats, spawnProt: this.prot };
      if (pw) o.password = pw;
      if (this.editing) { o.id = this.editing.id; r = await editServer(o); }
      else { o.seed = parseSeed(this.seedField.value); r = await createServer(o); }
    } catch (e) { r = { error: 'Could not reach the server.' }; }
    this.busy = false;
    if (!r || r.error) { this.error = (r && r.error) || 'Something went wrong.'; this.gui.markDirty(); return; }
    if (this.kind === 'private' && pw) keepPassword(this.editing ? this.editing.id : r.id, pw);
    const parent = this.parent;
    this.gui.back();
    if (parent instanceof MultiplayerScreen) { parent.selectedId = this.editing ? this.editing.id : r.id; parent.message = ''; parent.refresh(); }
  }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, 17, WHITE);
    for (const [t, x, y] of this.labels) g.text(t, x, y, GREY);
    super.render(g, mx, my, dt);
    if (this.error) g.centered(this.error, this.width / 2, this.errY, this.busy ? GREY : 0xFF5555);
  }
}

/* ---- the password for a private server ---- */
export class PasswordScreen extends Screen {
  constructor(server, wrong) {
    super('Join ' + server.name);
    this.server = server; this.wrong = wrong;
    this.field = new TextField(0, 0, 200, 20, { value: '', maxLength: 32, onEnter: () => this.go() });
  }
  init() {
    const W = this.width, H = this.height, y = Math.floor(H / 4) + 30;
    this.field.x = W / 2 - 100; this.field.y = y;
    this.add(this.field);
    this.add(new Button(W / 2 - 100, y + 36, 98, 20, 'Join Server', () => this.go()));
    this.add(new Button(W / 2 + 2, y + 36, 98, 20, 'Cancel', () => this.gui.back()));
    this.gui.focusText(this.field);
    this.top = y;
  }
  go() {
    const pw = this.field.value;
    if (!pw) return;
    const g = this.gui, parent = this.parent;
    g.back();
    if (parent instanceof MultiplayerScreen) parent.join(this.server, pw);
  }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, this.top - 40, WHITE);
    g.centered(this.wrong ? 'Wrong password. Try again:' : 'This server has a password:', this.width / 2, this.top - 14, this.wrong ? 0xFF5555 : GREY);
    super.render(g, mx, my, dt);
  }
}

/* Back onto a server after the page loaded again (a change of graphics or
   resource packs reloads it): the list, then straight into that server, with
   its password if one is kept. */
export function rejoin(gui, id) {
  const list = new MultiplayerScreen();
  gui.open(list);
  list.join({ id, name: 'the server', kind: 'public' }, savedPassword(id));
}

/* ---- your name on servers ---- */
export class NameScreen extends Screen {
  constructor() {
    super('Your Name');
    this.field = new TextField(0, 0, 200, 20, { value: playerName(), maxLength: 16, filter: v => /^[A-Za-z0-9_ -]*$/.test(v), onEnter: () => this.done() });
  }
  init() {
    const W = this.width, H = this.height, y = Math.floor(H / 4) + 30;
    this.field.x = W / 2 - 100; this.field.y = y;
    this.add(this.field);
    this.add(new Button(W / 2 - 100, y + 36, 200, 20, 'Done', () => this.done()));
    this.gui.focusText(this.field);
    this.top = y;
  }
  done() {
    const n = cleanName(this.field.value);
    if (n) setPlayerName(n);
    // (going back lays the list out again, with the new name on its button)
    this.gui.back();
  }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, this.top - 30, WHITE);
    g.centered('What other players see over your head', this.width / 2, this.top - 14, GREY);
    super.render(g, mx, my, dt);
  }
}

/* ---- Connecting to the server... ---- */
export class ConnectingScreen extends Screen {
  constructor() { super(''); this.text = 'Connecting to the server...'; this.closeOnEsc = false; this.animates = true; }
  init() {
    const W = this.width, H = this.height;
    this.add(new Button(W / 2 - 100, Math.floor(H / 4) + 132, 200, 20, 'Cancel', () => { this.cancelled = true; this.gui.back(); }));
  }
  render(g, mx, my, dt) {
    g.centered(this.text, this.width / 2, Math.floor(this.height / 2) - 50, WHITE);
    super.render(g, mx, my, dt);
  }
}

/* ---- turned away, or the connection lost ---- */
export class DisconnectedScreen extends Screen {
  constructor(title, reason) { super(title); this.reason = reason || ''; this.closeOnEsc = false; }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    this.lines = g.font.wrap(this.reason, W - 50);
    const th = this.lines.length * 9;
    this.top = Math.floor(H / 2 - th / 2);
    this.add(new Button(W / 2 - 100, Math.min(H - 30, this.top + th + 9), 200, 20, 'Back to server list', () => this.done()));
  }
  done() {
    const g = this.gui;
    // back to the list under the title screen, whichever way this screen was reached
    const p = this.parent;
    if (p instanceof MultiplayerScreen) { g.back(); p.refresh(); }
    else { g.back(); g.open(new MultiplayerScreen()); }
  }
  onEscape() { this.done(); }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, this.top - 9 * 2, GREY);
    for (let i = 0; i < this.lines.length; i++) g.centered(this.lines[i], this.width / 2, this.top + i * 9, WHITE);
    super.render(g, mx, my, dt);
  }
}
