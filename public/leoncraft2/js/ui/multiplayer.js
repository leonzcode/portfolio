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

   You play as your account (net/account.js): the server takes your name
   from your session, so the button where the game has Direct Connection
   shows your account (change the password, log out). The owner of a server
   (and an admin) has Settings (ServerSettingsScreen) and Delete for it; a
   session the server no longer takes asks you to log in again.
--------------------------------------------------------------------------- */
import { Screen, Button, TextField, CycleButton, ScrollList, WHITE, GREY, onOff } from './gui.js?v=63';
import { ConfirmScreen } from './menus.js?v=63';
import { Net, listServers, createServer, editServer, deleteServer, FAIL_TEXT, SERVER_DOWN } from '../net/net.js?v=63';
import { Account } from '../net/account.js?v=63';
import { LoginScreen, AccountScreen } from './account.js?v=63';
import { parseSeed } from '../gen/random.js?v=63';

const PW_KEY = 'lc2_pw_';
const savedPassword = id => { try { return localStorage.getItem(PW_KEY + id) || ''; } catch (e) { return ''; } };
const keepPassword = (id, pw) => { try { if (pw) localStorage.setItem(PW_KEY + id, pw); else localStorage.removeItem(PW_KEY + id); } catch (e) {} };
const MODE_NAMES = { survival: 'Survival', creative: 'Creative', adventure: 'Adventure' };

/* ---- a server's own picture (Server Settings' Icon...): data URLs made into images once ---- */
const ICONS = new Map();
function iconImage(url, gui) {
  let im = ICONS.get(url);
  if (!im) { im = new Image(); im.onload = () => gui && gui.markDirty(); im.src = url; ICONS.set(url, im); }
  return im.complete && im.naturalWidth ? im : null;
}
// a picture the owner picks, cut to a square and made 64 x 64 (as the game's server-icon.png), small enough to send
function pickIcon() {
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return res(null);
      const im = new Image(), u = URL.createObjectURL(f);
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const k = Math.min(im.width, im.height), cx = c.getContext('2d');
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(im, (im.width - k) / 2, (im.height - k) / 2, k, k, 0, 0, 64, 64);
        URL.revokeObjectURL(u);
        let d = c.toDataURL('image/png');
        if (d.length > 24000) d = c.toDataURL('image/jpeg', 0.85);
        res(d.length <= 24000 ? d : null);
      };
      im.onerror = () => { URL.revokeObjectURL(u); res(null); };
      im.src = u;
    };
    inp.click();
  });
}

/* ---- one server in the list ---- */
class ServerEntry {
  constructor(s, screen) { this.s = s; this.screen = screen; }
  render(g, list, i, top, left, width, h, mx, my, hovered) {
    const s = this.s, ping = this.screen.ping;
    g.text(g.font.trim(s.name, width - 80), left + 35, top + 1, WHITE, false);
    const line1 = s.motd || (s.kind === 'private' ? 'A private server' : 'A public server');
    g.text(g.font.trim(line1, width - 40), left + 35, top + 12, 0x808080, false);
    const line2 = (MODE_NAMES[s.mode] || 'Survival') + ' Mode' + (s.cheats ? ', Commands' : '') + (s.kind === 'private' ? (s.settings && s.settings.password ? ', Password: ' + s.settings.password : ', Password') : '') + (s.mine ? ', yours' : s.owner ? ', ' + s.owner + "'s" : '');
    g.text(g.font.trim(line2, width - 40), left + 35, top + 21, 0x808080, false);
    // the player count and the signal bars, top right
    const count = s.players + '/' + s.max, cw = g.textWidth(count);
    g.text(count, left + width - cw - 17, top + 1, 0x808080, false);
    const bars = ping < 0 ? 5 : ping < 150 ? 0 : ping < 300 ? 1 : ping < 600 ? 2 : ping < 1000 ? 3 : 4;
    g.blit('icons', 0, 176 + bars * 8, 10, 8, left + width - 15, top);
    // the picture: the owner's own, or grass and dirt
    const icon = s.icon ? iconImage(s.icon, this.screen.gui) : null;
    if (icon) { const c = g.ctx, sm = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false; c.drawImage(icon, left, top, 32, 32); c.imageSmoothingEnabled = sm; }
    else {
    g.fill(left, top, left + 32, top + 32, 0xFF5B3F2B);
    g.fill(left, top, left + 32, top + 8, 0xFF5E8C32);
    g.fill(left, top + 8, left + 32, top + 10, 0xFF4A7027);
    g.fill(left + 4, top + 16, left + 8, top + 20, 0xFF7A5639);
    g.fill(left + 20, top + 22, left + 24, top + 26, 0xFF46301F);
    }
    // a private server has a padlock in the picture's top right corner; a public one has none
    if (s.kind === 'private') {
      const ox = left + 19, oy = top + 1;
      g.fill(ox, oy + 6, ox + 12, oy + 18, 0xFFC8A02A);
      g.fill(ox + 2, oy + 1, ox + 4, oy + 7, 0xFF9A9A9A); g.fill(ox + 8, oy + 1, ox + 10, oy + 7, 0xFF9A9A9A); g.fill(ox + 2, oy, ox + 10, oy + 2, 0xFF9A9A9A);
      g.fill(ox + 5, oy + 10, ox + 7, oy + 14, 0xFF3A2A08);
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
    if (Account.guest) this.add(new Button(W / 2 - 50, H - 52, 100, 20, 'Log In', () => g.open(new LoginScreen(null)), 'You are playing as ' + Account.name + '. Log in or make an account.'));
    else this.add(new Button(W / 2 - 50, H - 52, 100, 20, Account.name || 'Account', () => g.open(new AccountScreen()), 'Your account: change your password, or log out'));
    this.add(new Button(W / 2 + 54, H - 52, 100, 20, 'Create Server', () => g.open(new CreateServerScreen())));
    this.editB = this.add(new Button(W / 2 - 154, H - 28, 70, 20, 'Settings', () => { const s = this.sel(); if (s && s.canEdit) g.open(new ServerSettingsScreen(s)); }));
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
    this.editB.active = !!(s && s.canEdit);
    this.delB.active = !!(s && s.canEdit && s.id !== 'main');
    this.editB.tooltip = this.delB.tooltip = s && !s.canEdit ? 'Only the owner of a server can change it' : null;
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
    if (!s || !s.canEdit) return;
    g.open(new ConfirmScreen('Are you sure you want to remove this server?', "'" + s.name + "' will be lost forever! (A long time!)", 'Delete', 'Cancel', async yes => {
      g.back();
      if (!yes) return;
      try { const r = await deleteServer(s.id); if (r && r.error) this.message = r.error; } catch (e) { this.message = 'Could not reach the server.'; }
      this.selectedId = null;
      this.refresh();
    }));
  }
  // join: the password kept for it (or none), and ask for one if it is wrong
  join(s, password, watch) {
    const g = this.gui, pw = watch ? '' : password !== undefined ? password : savedPassword(s.id);
    // (the owner, an admin and a mod go in without it: the server lets them; anyone may watch as a spectator without it)
    if (s.kind === 'private' && !pw && !s.canEdit && !s.free && !watch) { g.open(new PasswordScreen(s, false)); return; }
    const scr = new ConnectingScreen();
    g.open(scr);
    Net.connect(s.id, pw, watch).then(net => {
      if (scr.cancelled) { net.close(); return; }
      if (s.kind === 'private' && !watch) keepPassword(s.id, pw);
      scr.text = 'Joining world...';
      if (this.hooks.play) this.hooks.play(net.entry(), { isNew: false });
    }, err => {
      if (scr.cancelled) return;
      if (err && err.password) { keepPassword(s.id, ''); g.replace(new PasswordScreen(s, !!pw)); return; }
      // (your session ran out, or you were logged out elsewhere: log in, then on to the server)
      if (err && err.session) { g.replace(new LoginScreen(() => this.join(s, pw), { error: 'Your session has expired. Log in again.' })); return; }
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
    this.prot = e && e.spawnProt !== undefined ? (e.spawnProt | 0 ? 16 : 0) : 0;
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
    this.add(new Button(W / 2 - 100, y + 60, 200, 20, 'Spectate', () => {
      const g = this.gui, parent = this.parent;
      g.back();
      if (parent instanceof MultiplayerScreen) parent.join(this.server, '', true);
    }, 'Watch this server as a spectator. No password needed, but you cannot change anything.'));
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

/* ---- Server Settings: for the owner (and an admin) ----
   As a server's server.properties and whitelist would have it: the name and
   message of the day, public or private (and its password), the default game
   mode, Allow Commands, spawn protection, the difficulty, PvP, the most
   players at once, the whitelist and who is on it, and the owner's own OP.
   Delete Server is here too, behind a confirmation. Saved with Done; whoever
   is on hears at once what changed (lc2.js /mc/lc2/edit). */
const DIFFS = ['peaceful', 'easy', 'normal', 'hard'];
const DIFF_NAMES = { peaceful: 'Peaceful', easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const MAXES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
// how many /sethome homes each player may have (EssentialsX's sethome-multiple, 3 by default; operators and admins have no limit)
const HOMES = [1, 2, 3, 4, 5, 10, 20, 50];
export class ServerSettingsScreen extends Screen {
  constructor(s) {
    super('Server Settings');
    this.s = s;
    const st = s.settings || {};
    this.v = { kind: s.kind, mode: s.mode || 'survival', cheats: !!s.cheats, prot: (s.spawnProt | 0) ? 16 : 0, difficulty: st.difficulty || 'normal',
      pvp: st.pvp !== false, max: s.max || 20, wl: !!st.wl, ownerOp: st.ownerOp !== false, homes: HOMES.includes(st.homes) ? st.homes : 3 };
    this.nameField = new TextField(0, 0, 180, 20, { value: s.name, maxLength: 32, onEnter: () => this.done() });
    this.motdField = new TextField(0, 0, 180, 20, { value: s.motd || '', maxLength: 60, hint: 'A line under the name' });
    // (the owner and an admin see the password as it is now)
    this.pwField = new TextField(0, 0, 180, 20, { value: (s.settings && s.settings.password) || '', maxLength: 32, hint: 'Leave blank to keep it' });
    this.wlField = new TextField(0, 0, 180, 20, { value: (st.wlNames || []).join(', '), maxLength: 400, hint: 'Names, with commas between' });
    this.error = '';
  }
  init() {
    const W = this.width, H = this.height, g = this.gui, v = this.v;
    const cw = Math.min(180, Math.floor((W - 16) / 2)), lx = Math.floor(W / 2 - cw - 3), rx = Math.floor(W / 2 + 3);
    let y = Math.max(22, Math.floor((H - 24 - 8 * 22) / 2));
    const top = y;
    this.labels = [];
    for (const [label, f] of [['Server Name', this.nameField], ['Message of the Day', this.motdField], ['Password', this.pwField], ['Whitelisted Players', this.wlField]]) {
      this.labels.push([label, lx, y]); f.x = lx; f.y = y + 10; f.w = cw; this.add(f); y += 32;
    }
    this.pwField.active = v.kind === 'private';
    let x = lx;
    const cyc = (label, key, values, format, tip) => { const b = this.add(new CycleButton(x, y, cw, 20, label, { values, value: v[key], format, onChange: q => { v[key] = q; if (key === 'kind') this.pwField.active = q === 'private'; }, tooltip: tip })); y += 22; return b; };
    const op = cyc('Your OP', 'ownerOp', [true, false], onOff, () => 'Whether you have an operator\'s commands here (you keep the owner\'s either way)');
    op.active = !!this.s.mine;
    cyc('Homes Per Player', 'homes', HOMES, x => String(x), () => 'How many homes each player can set with /sethome (operators have no limit)');
    // the server's picture in the list: Icon... picks one from this computer, shift-click takes it away
    const hw = Math.floor((cw - 2) / 2);
    this.iconBtn = this.add(new Button(lx, y, hw, 20, this.s.icon ? 'Icon: Yours' : 'Icon...', async () => {
      if (window.event && window.event.shiftKey) { this.v.icon = ''; this.iconBtn.message = 'Icon: None'; this.gui.markDirty(); return; }
      const d = await pickIcon();
      if (d) { this.v.icon = d; this.iconBtn.message = 'Icon: New'; this.error = ''; } else if (d === null) this.error = '';
      this.gui.markDirty();
    }));
    this.iconBtn.tooltip = 'The picture beside your server in the list (shift-click to take it away)';
    this.add(new Button(lx + hw + 2, y, cw - hw - 2, 20, 'Delete Server', () => this.remove())).active = this.s.id !== 'main';
    const leftEnd = y + 22;
    y = top; x = rx;
    cyc('', 'kind', ['public', 'private'], x => (x === 'public' ? 'Public' : 'Private'), x => (x === 'public' ? 'Anyone can join' : 'Only people with the password can join'));
    cyc('Default Game Mode', 'mode', ['survival', 'creative', 'adventure'], x => MODE_NAMES[x]);
    cyc('Difficulty', 'difficulty', DIFFS, x => DIFF_NAMES[x]);
    cyc('PvP', 'pvp', [true, false], onOff, () => 'Whether players can hurt each other');
    cyc('Max Players', 'max', MAXES, x => String(x));
    cyc('Whitelist', 'wl', [false, true], onOff, () => 'Only the players on the whitelist (and operators) can join');
    cyc('Allow Commands', 'cheats', [false, true], onOff, () => 'Whether everyone on the server can use commands like /gamemode and /time');
    cyc('Spawn Protection', 'prot', [16, 0], x => (x ? x + ' blocks' : 'OFF'), () => 'Only operators can break, place or use blocks this close to the world spawn');
    const by = Math.min(H - 24, Math.max(y, leftEnd) + 4);
    this.add(new Button(W / 2 - 100, by, 98, 20, 'Done', () => this.done()));
    this.add(new Button(W / 2 + 2, by, 98, 20, 'Cancel', () => g.back()));
    this.errY = by - 11;
    this.top = top;
    void g;
  }
  async done() {
    if (this.busy) return;
    const v = this.v, name = this.nameField.value.trim();
    if (!name) { this.error = 'Give your server a name.'; this.gui.markDirty(); return; }
    if (v.kind === 'private' && this.s.kind !== 'private' && !this.pwField.value) { this.error = 'A private server needs a password.'; this.gui.markDirty(); return; }
    this.busy = true; this.error = 'Saving...'; this.gui.markDirty();
    const o = { id: this.s.id, name, motd: this.motdField.value.trim(), kind: v.kind, mode: v.mode, cheats: v.cheats, spawnProt: v.prot, difficulty: v.difficulty,
      pvp: v.pvp, max: v.max, wl: v.wl, wlNames: this.wlField.value.split(/[\s,]+/).filter(Boolean), homes: v.homes };
    if (this.s.mine) o.ownerOp = v.ownerOp;
    if (typeof v.icon === 'string') o.icon = v.icon;
    if (this.pwField.value) o.password = this.pwField.value;
    let r;
    try { r = await editServer(o); } catch (e) { r = { error: 'Could not reach the server.' }; }
    this.busy = false;
    if (!r || r.error) { this.error = (r && r.error) || 'Something went wrong.'; this.gui.markDirty(); return; }
    if (v.kind === 'private' && this.pwField.value) keepPassword(this.s.id, this.pwField.value);
    const parent = this.parent;
    this.gui.back();
    if (parent instanceof MultiplayerScreen) { parent.message = ''; parent.refresh(); }
  }
  remove() {
    const s = this.s, g = this.gui, parent = this.parent;
    g.open(new ConfirmScreen('Are you sure you want to delete this server?', "'" + s.name + "' will be lost forever! (A long time!) Everyone on it is sent back to the server list.", 'Delete', 'Cancel', async yes => {
      g.back();
      if (!yes) return;
      let r;
      try { r = await deleteServer(s.id); } catch (e) { r = { error: 'Could not reach the server.' }; }
      if (r && r.error) { this.error = r.error; g.markDirty(); return; }
      g.back();
      if (parent instanceof MultiplayerScreen) { parent.selectedId = null; parent.refresh(); }
    }));
  }
  render(g, mx, my, dt) {
    g.centered(this.title + ': ' + this.s.name, this.width / 2, Math.max(4, this.top - 18), WHITE);
    for (const [t, x, y] of this.labels) g.text(t, x, y, GREY);
    super.render(g, mx, my, dt);
    if (this.error) g.centered(this.error, this.width / 2, this.errY, this.busy ? GREY : 0xFF5555);
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
