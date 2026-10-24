/* ---------------------------------------------------------------------------
   Leoncraft 2 - logging in, your account, and the admin's screen.

   Log In: the screen that comes up over the title until you are logged in
   (net/account.js), in the game's own widgets: Username, Password, Log In,
   and Create Account (which asks for the password twice). What goes wrong
   is said under the fields in the game's words: a name that is taken, a
   name that is not allowed, a wrong password, a name locked after too many
   wrong passwords, a banned account, and no connection.

   Account: change your password, or log out.

   Admin (admin accounts only): every account (ban and unban, reset a
   password, delete) and every server (give it to another owner, delete it).
--------------------------------------------------------------------------- */
import { Screen, Button, TextField, ScrollList, WHITE, GREY } from './gui.js?v=107';
import { Account, NO_CONNECTION } from '../net/account.js?v=107';

const RED = 0xFF5555;
const fmtDate = t => { if (!t) return 'never'; const d = new Date(t); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

/* Before the title's buttons work: open the login screen unless an account is
   ready (logged in, or the kept session trusted offline), then go on. */
export function withAccount(gui, then) {
  if (Account.ready) { then(); return; }
  if (Account.checking) { Account.checking.then(() => (Account.ready ? then() : gui.open(new LoginScreen(then)))); return; }
  gui.open(new LoginScreen(then));
}

/* ---- Log In / Create Account ---- */
export class LoginScreen extends Screen {
  constructor(then, opts = {}) {
    super('Log In');
    this.then = then || null;
    this.creating = !!opts.create;
    this.error = opts.error || Account.lastError || '';
    Account.lastError = '';
    this.busy = false;
    this.closeOnEsc = false;
    this.nameField = new TextField(0, 0, 200, 20, { value: opts.name || '', maxLength: 16, filter: v => /^[A-Za-z0-9_]*$/.test(v), onEnter: () => this.focusNext() });
    this.pwField = new TextField(0, 0, 200, 20, { value: '', maxLength: 64, password: true, onEnter: () => (this.creating ? this.focusNext() : this.go()) });
    this.pw2Field = new TextField(0, 0, 200, 20, { value: '', maxLength: 64, password: true, onEnter: () => this.go() });
  }
  get fields() { return this.creating ? [this.nameField, this.pwField, this.pw2Field] : [this.nameField, this.pwField]; }
  init() {
    const W = this.width, H = this.height, g = this.gui, x = Math.floor(W / 2 - 100);
    this.title = this.creating ? 'Create Account' : 'Log In';
    const n = this.fields.length;
    // (a quarter down, but never so low that Quit Game runs off the bottom of a small window: fields, the line under them, three buttons)
    const need = n * 34 + 22 + 92;
    let y = Math.max(28, Math.min(Math.max(40, Math.floor(H / 4) - (this.creating ? 6 : 0)), H - 4 - need));
    this.labels = [];
    const labels = ['Username', 'Password', 'Confirm Password'];
    this.fields.forEach((f, i) => { this.labels.push([labels[i], x, y]); f.x = x; f.y = y + 10; this.add(f); y += 34; });
    this.errY = y;
    y += 22;
    this.mainB = this.add(new Button(x, y, 200, 20, this.creating ? 'Create Account' : 'Log In', () => this.go()));
    this.add(new Button(x, y + 24, 200, 20, this.creating ? 'I have an account' : 'Create an Account', () => {
      this.creating = !this.creating; this.error = ''; this.pwField.setValue(''); this.pw2Field.setValue('');
      g.replace(this);
    }));
    this.add(new Button(x, y + 48, 200, 20, 'Play as Guest', () => {
      Account.playAsGuest();
      const then = this.then, gg = this.gui;
      gg.back();
      if (then) then();
    }, 'Play without an account. You can make one later.'));
    this.add(new Button(x, y + 72, 200, 20, 'Quit Game', () => { if (this.hooks.quit) this.hooks.quit(); else location.href = '/'; }));
    this.top = this.labels[0][2];
    g.focusText(!this.nameField.value ? this.nameField : this.fields[1]);
    void n;
  }
  focusNext() {
    const f = this.fields, i = f.indexOf(this.gui.textFocus);
    this.gui.focusText(f[(i + 1) % f.length]);
  }
  keyPressed(e) {
    if (e.key === 'Tab') { this.focusNext(); return true; }
    return super.keyPressed(e);
  }
  async go() {
    if (this.busy) return;
    const name = this.nameField.value.trim(), pw = this.pwField.value;
    if (!name) { this.say('Enter your username.'); return; }
    if (!pw) { this.say('Enter your password.'); return; }
    if (this.creating && pw !== this.pw2Field.value) { this.say('The passwords do not match.'); return; }
    this.busy = true; this.say(this.creating ? 'Creating account...' : 'Logging in...');
    const r = this.creating ? await Account.create(name, pw) : await Account.login(name, pw);
    this.busy = false;
    if (!r || !r.ok) {
      this.say((r && r.error) || NO_CONNECTION, true);
      if (r && r.reason) this.error += ' Reason: ' + r.reason;
      if (r && (r.code === 'wrong' || r.code === 'short' || r.code === 'locked')) { this.pwField.setValue(''); this.pw2Field.setValue(''); }
      this.gui.markDirty();
      return;
    }
    const then = this.then, g = this.gui;
    g.back();
    if (then) then();
  }
  say(text, bad) { this.error = text; this.bad = bad !== undefined ? bad : !this.busy; if (this.gui) this.gui.markDirty(); }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, Math.max(8, this.top - 24), WHITE);
    for (const [t, x, y] of this.labels) g.text(t, x, y, GREY);
    super.render(g, mx, my, dt);
    if (this.error) {
      const lines = g.font.wrap(this.error, Math.min(300, this.width - 20));
      lines.forEach((l, i) => g.centered(l, this.width / 2, this.errY + i * 9 - (lines.length > 1 ? 3 : -2), this.busy ? GREY : RED));
    } else if (this.creating) g.centered('3 to 16 letters, numbers and _', this.width / 2, this.errY + 2, 0x808080);
  }
}

/* ---- your account: change the password, log out ---- */
export class AccountScreen extends Screen {
  constructor() {
    super('Account');
    this.old = new TextField(0, 0, 200, 20, { maxLength: 64, password: true, onEnter: () => this.gui.focusText(this.pw) });
    this.pw = new TextField(0, 0, 200, 20, { maxLength: 64, password: true, onEnter: () => this.gui.focusText(this.pw2) });
    this.pw2 = new TextField(0, 0, 200, 20, { maxLength: 64, password: true, onEnter: () => this.change() });
    this.msg = ''; this.bad = false;
  }
  init() {
    const W = this.width, H = this.height, x = Math.floor(W / 2 - 100);
    let y = Math.max(44, Math.floor(H / 4) - 4);
    this.labels = [];
    for (const [t, f] of [['Current Password', this.old], ['New Password', this.pw], ['Confirm New Password', this.pw2]]) { this.labels.push([t, x, y]); f.x = x; f.y = y + 10; this.add(f); y += 34; }
    this.msgY = y + 2;
    y += 16;
    this.add(new Button(x, y, 200, 20, 'Change Password', () => this.change()));
    this.add(new Button(x, y + 24, 98, 20, 'Log Out', () => logOut(this.gui)));
    this.add(new Button(x + 102, y + 24, 98, 20, 'Done', () => this.gui.back()));
    this.top = this.labels[0][2];
  }
  async change() {
    if (this.pw.value !== this.pw2.value) { this.msg = 'The passwords do not match.'; this.bad = true; this.gui.markDirty(); return; }
    this.msg = 'Saving...'; this.bad = false; this.gui.markDirty();
    const r = await Account.changePassword(this.old.value, this.pw.value);
    if (r && r.ok) { this.msg = 'Your password was changed.'; this.bad = false; this.old.setValue(''); this.pw.setValue(''); this.pw2.setValue(''); }
    else { this.msg = (r && r.error) || NO_CONNECTION; this.bad = true; if (r && r.code === 'session') { Account.expired(); } }
    this.gui.markDirty();
  }
  render(g, mx, my, dt) {
    g.centered('Account: ' + Account.name, this.width / 2, Math.max(8, this.top - 26), WHITE);
    for (const [t, x, y] of this.labels) g.text(t, x, y, GREY);
    super.render(g, mx, my, dt);
    if (this.msg) g.centered(this.msg, this.width / 2, this.msgY, this.bad ? RED : GREY);
  }
}

// Log Out: forget the session here and on the server, back to the login screen over the title
export function logOut(gui) {
  Account.logout();
  while (gui.stack.length > 1) gui.back();
  gui.open(new LoginScreen(null));
}

/* ---- a line of text asked for (a reason, a new password, a new owner) ---- */
class AskScreen extends Screen {
  constructor(title, label, cb, opts = {}) {
    super(title);
    this.label = label; this.cb = cb;
    this.field = new TextField(0, 0, 200, 20, { value: opts.value || '', maxLength: opts.max || 64, password: !!opts.password, onEnter: () => this.done(true) });
  }
  init() {
    const W = this.width, H = this.height, y = Math.floor(H / 4) + 30;
    this.field.x = W / 2 - 100; this.field.y = y;
    this.add(this.field);
    this.add(new Button(W / 2 - 100, y + 36, 98, 20, 'Done', () => this.done(true)));
    this.add(new Button(W / 2 + 2, y + 36, 98, 20, 'Cancel', () => this.done(false)));
    this.gui.focusText(this.field);
    this.top = y;
  }
  done(yes) { const v = this.field.value, g = this.gui; g.back(); if (yes) this.cb(v); }
  onEscape() { this.done(false); }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, this.top - 30, WHITE);
    g.centered(this.label, this.width / 2, this.top - 14, GREY);
    super.render(g, mx, my, dt);
  }
}
class YesNo extends Screen {
  constructor(title, message, yes, cb) { super(title); this.message = message; this.yes = yes; this.cb = cb; }
  init() {
    const W = this.width, y = Math.floor(this.height / 2) + 10;
    this.add(new Button(W / 2 - 155, y, 150, 20, this.yes, () => { this.gui.back(); this.cb(); }));
    this.add(new Button(W / 2 + 5, y, 150, 20, 'Cancel', () => this.gui.back()));
    this.y = y;
  }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, this.y - 40, WHITE);
    g.centered(this.message, this.width / 2, this.y - 22, WHITE);
    super.render(g, mx, my, dt);
  }
}

/* ---- Admin ---- */
class AccountRow {
  constructor(a) { this.a = a; }
  render(g, list, i, top, left, width) {
    const a = this.a;
    g.text((a.admin ? '§c[ADMIN] §f' : a.mod ? '§2[MOD] §f' : '') + a.name + (a.online ? ' §a(online)' : ''), left + 2, top + 1, WHITE, false);
    g.text(g.font.trim(a.banned ? '§cBanned: ' + a.banned : 'Last login ' + fmtDate(a.lastLogin) + ', made ' + fmtDate(a.createdAt), width - 6), left + 2, top + 12, 0x808080, false);
  }
}
class ServerRow {
  constructor(s) { this.s = s; }
  render(g, list, i, top, left, width) {
    const s = this.s;
    g.text(g.font.trim(s.name, width - 40), left + 2, top + 1, WHITE, false);
    const c = s.players + '/' + s.max;
    g.text(c, left + width - g.textWidth(c) - 4, top + 1, 0x808080, false);
    g.text(g.font.trim('Owner: ' + (s.owner || 'nobody') + '  (' + s.kind + ', ' + s.mode + ')', width - 6), left + 2, top + 12, 0x808080, false);
  }
}
export class AdminScreen extends Screen {
  constructor() { super('Admin'); this.tab = 'accounts'; this.rows = []; this.msg = 'Loading...'; this.bad = false; this.selName = null; }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    this.list = this.add(new ScrollList(0, 32, W, H - 64 - 32, 24, { rowWidth: 305, selectable: true, onSelect: e => { this.selName = e ? this.keyOf(e) : null; this.buttons(); } }));
    this.tabB = this.add(new Button(W / 2 - 154, 6, 150, 20, 'Accounts', () => { this.tab = 'accounts'; this.selName = null; this.refresh(); g.replace(this); }));
    this.tabS = this.add(new Button(W / 2 + 4, 6, 150, 20, 'Servers', () => { this.tab = 'servers'; this.selName = null; this.refresh(); g.replace(this); }));
    this.tabB.active = this.tab !== 'accounts'; this.tabS.active = this.tab !== 'servers';
    const by = H - 52;
    if (this.tab === 'accounts') {
      this.b1 = this.add(new Button(W / 2 - 154, by, 74, 20, 'Ban', () => this.ban()));
      this.b2 = this.add(new Button(W / 2 - 76, by, 74, 20, 'Unban', () => this.act('unban')));
      this.b3 = this.add(new Button(W / 2 + 2, by, 74, 20, 'Reset Pass', () => this.reset()));
      this.b4 = this.add(new Button(W / 2 + 80, by, 74, 20, 'Delete', () => this.del()));
    } else {
      this.b1 = this.add(new Button(W / 2 - 154, by, 150, 20, 'Change Owner', () => this.owner()));
      this.b4 = this.add(new Button(W / 2 + 4, by, 150, 20, 'Delete Server', () => this.sdel()));
      this.b2 = this.b3 = null;
    }
    // (only the Leon account makes and removes mods: the server checks it too)
    this.modB = null;
    if (this.tab === 'accounts' && String(Account.name || '').toLowerCase() === 'leon') {
      this.modB = this.add(new Button(W / 2 - 154, H - 28, 100, 20, 'Make Mod', () => this.mod(), 'A mod sees and joins every server, private ones and Leonpixel too, without a password'));
      this.add(new Button(W / 2 - 50, H - 28, 100, 20, 'Refresh', () => this.refresh()));
      this.add(new Button(W / 2 + 54, H - 28, 100, 20, 'Done', () => g.back()));
    } else {
      this.add(new Button(W / 2 - 154, H - 28, 150, 20, 'Refresh', () => this.refresh()));
      this.add(new Button(W / 2 + 4, H - 28, 150, 20, 'Done', () => g.back()));
    }
    this.fill();
    if (!this.loaded) { this.loaded = true; this.refresh(); }
  }
  keyOf(e) { return e.a ? e.a.name : e.s.id; }
  sel() { const e = this.list.selected; return e ? (e.a || e.s) : null; }
  fill() {
    this.list.entries = this.rows.map(r => (this.tab === 'accounts' ? new AccountRow(r) : new ServerRow(r)));
    this.list.selected = this.list.entries.find(e => this.keyOf(e) === this.selName) || null;
    this.list.setScroll(this.list.scroll);
    this.buttons();
    if (this.gui) this.gui.markDirty();
  }
  buttons() {
    const s = this.sel();
    for (const b of [this.b1, this.b2, this.b3, this.b4]) if (b) b.active = !!s;
    if (s && this.tab === 'accounts') { this.b1.active = !s.admin && !s.banned; this.b2.active = !!s.banned; this.b4.active = !s.admin; }
    if (this.modB) { this.modB.active = !!s && !s.admin; this.modB.message = s && s.mod ? 'Remove Mod' : 'Make Mod'; }
    if (s && this.tab === 'servers') this.b4.active = s.id !== 'main';
  }
  async refresh() {
    this.msg = 'Loading...'; this.bad = false;
    const r = await Account.admin_(this.tab === 'accounts' ? 'accounts' : 'servers');
    if (r && r.ok) { this.rows = r.accounts || r.servers || []; this.msg = ''; }
    else { this.rows = []; this.msg = (r && r.error) || NO_CONNECTION; this.bad = true; }
    this.fill();
  }
  async run(op, o, okText) {
    const r = await Account.admin_(op, o);
    const ok = !!(r && r.ok), text = ok ? okText : (r && r.error) || NO_CONNECTION;
    await this.refresh();
    // (what the action said stays up after the list is fetched again, unless fetching it failed)
    if (!this.bad) { this.msg = text; this.bad = !ok; }
    if (this.gui) this.gui.markDirty();
  }
  mod() { const s = this.sel(); if (s && !s.admin) this.run('mod', { name: s.name, on: !s.mod }, s.mod ? s.name + ' is no longer a mod' : s.name + ' is a mod now'); }
  act(op) { const s = this.sel(); if (s) this.run(op, { name: s.name }, op === 'unban' ? 'Unbanned ' + s.name : 'Done'); }
  ban() { const s = this.sel(); if (s) this.gui.open(new AskScreen('Ban ' + s.name, 'Reason (shown to them)', v => this.run('ban', { name: s.name, reason: v }, 'Banned ' + s.name), { max: 200 })); }
  reset() { const s = this.sel(); if (s) this.gui.open(new AskScreen('Reset Password', 'A new password for ' + s.name + ' (6 or more characters)', v => this.run('reset', { name: s.name, password: v }, 'Reset the password of ' + s.name), { password: true })); }
  del() { const s = this.sel(); if (s) this.gui.open(new YesNo('Delete ' + s.name + '?', 'The account will be gone for good.', 'Delete', () => this.run('delete', { name: s.name }, 'Deleted ' + s.name))); }
  owner() { const s = this.sel(); if (s) this.gui.open(new AskScreen('Change Owner', 'The account that will own ' + s.name, v => this.run('owner', { id: s.id, name: v.trim() }, 'Gave ' + s.name + ' to ' + v.trim()), { value: s.owner || '', max: 16 })); }
  sdel() { const s = this.sel(); if (s) this.gui.open(new YesNo('Delete ' + s.name + '?', "Everyone on it is sent back to the server list.", 'Delete', () => this.run('sdelete', { id: s.id }, 'Deleted ' + s.name))); }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    if (this.msg) g.centered(this.msg, this.width / 2, this.height - 64 - 4 - 9, this.bad ? RED : GREY);
  }
}
