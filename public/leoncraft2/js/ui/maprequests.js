/* ---------------------------------------------------------------------------
   Leoncraft 2 - Map Requests (mods and admins), from the server list.

   The maps players made for Leon Network's Prop Hunt and Chameleon wait here
   until a mod or an admin approves them for the vote. Each row: the map, its
   game and its maker, and Spectate (into Leon Network, flying round the map
   in spectator; /mapapprove or /mapdeny there), Approve and Deny. The list
   and the decisions go over HTTP (mlhub lc2.js /mc/lc2/hub/requests and
   /review); Spectate joins the network with the request in hand
   (window.__lc2HubAction, sent by net/hub.js once the network says hello).
   A second tab, Being Built, lists every players' map not in the vote and
   not waiting (drafts and denied ones) and any map someone is in the
   editor on now, with who and when it last changed; Spectate looks round
   it without changing anything.
--------------------------------------------------------------------------- */
import { Screen, Button, WHITE, GREY } from './gui.js?v=107';
import { mapRequests, mapReview } from '../net/net.js?v=107';

const PER_PAGE = 6;
const STATUS = { draft: '§7Draft', pending: '§eWaiting', approved: '§aApproved', denied: '§cDenied' };
// a time gone by, short: just now, 12 min ago, 3 h ago, 2 days ago
const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
export class MapRequestsScreen extends Screen {
  // spectate(entry): join Leon Network to look round a map (the server list's join, with the hub's entry)
  constructor(spectate) { super('Map Requests'); this.spectate = spectate; this.lists = { wait: [], build: [] }; this.tab = 'wait'; this.page = 0; this.status = 'Loading...'; this.loaded = false; }
  get list() { return this.lists[this.tab] || []; }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    this.rows = [];
    this.waitB = this.add(new Button(W / 2 - 122, 34, 120, 20, 'Waiting', () => this.show('wait'), 'Maps sent for approval'));
    this.buildB = this.add(new Button(W / 2 + 2, 34, 120, 20, 'Being Built', () => this.show('build'), 'Drafts, denied maps, and any map someone is in the editor on now'));
    const top = 60, step = Math.max(22, Math.min(30, Math.floor((H - 120) / PER_PAGE)));
    // (the rows as wide as the screen allows, 400 at most: the words on the left, the buttons to the right)
    const cw = Math.min(W - 16, 400), right = Math.floor((W - cw) / 2) + cw;
    this.left = right - cw; this.right = right;
    for (let i = 0; i < PER_PAGE; i++) {
      const y = top + i * step;
      const row = {
        y,
        spec: this.add(new Button(right - 168, y, 62, 20, 'Spectate', () => this.go(i), 'Fly round it in Leonpixel, then /mapapprove or /mapdeny')),
        ok: this.add(new Button(right - 104, y, 56, 20, '§aApprove', () => this.decide(i, true), 'Put it in the vote')),
        no: this.add(new Button(right - 46, y, 46, 20, '§cDeny', () => this.decide(i, false), 'Send it back to its maker')),
        // (Being Built: only a look round, at the row's end)
        look: this.add(new Button(right - 62, y, 62, 20, 'Spectate', () => this.go(i), 'Fly round it in Leonpixel: nothing is changed')),
      };
      this.rows.push(row);
    }
    this.prevB = this.add(new Button(W / 2 - 154, H - 28, 70, 20, '< Prev', () => { this.page = Math.max(0, this.page - 1); this.update(); }));
    this.nextB = this.add(new Button(W / 2 - 80, H - 28, 70, 20, 'Next >', () => { this.page++; this.update(); }));
    this.add(new Button(W / 2 - 6, H - 28, 75, 20, 'Refresh', () => this.load()));
    this.add(new Button(W / 2 + 73, H - 28, 80, 20, 'Back', () => g.back()));
    this.update();
    if (!this.loaded) { this.loaded = true; this.load(); }
  }
  async load() {
    this.status = 'Loading...'; this.gui.markDirty();
    const r = await mapRequests();
    if (r && r.ok) { this.lists = { wait: r.requests || [], build: r.building || [] }; this.status = this.emptyLine(); }
    else { this.lists = { wait: [], build: [] }; this.status = (r && r.error) || 'Could not load the requests.'; }
    this.page = Math.min(this.page, Math.max(0, Math.ceil(this.list.length / PER_PAGE) - 1));
    this.update();
  }
  emptyLine() { return this.list.length ? '' : this.tab === 'build' ? "No players' maps are being built." : 'No maps are waiting for approval.'; }
  show(tab) { if (this.tab === tab) return; this.tab = tab; this.page = 0; this.status = this.emptyLine(); this.update(); }
  at(i) { return this.list[this.page * PER_PAGE + i] || null; }
  update() {
    const pages = Math.max(1, Math.ceil(this.list.length / PER_PAGE)), wait = this.tab === 'wait';
    if (this.page >= pages) this.page = pages - 1;
    for (let i = 0; i < PER_PAGE; i++) { const on = !!this.at(i), r = this.rows[i]; r.spec.visible = r.ok.visible = r.no.visible = on && wait; r.look.visible = on && !wait; }
    if (this.waitB) {
      this.waitB.message = 'Waiting (' + this.lists.wait.length + ')'; this.buildB.message = 'Being Built (' + this.lists.build.length + ')';
      this.waitB.active = !wait; this.buildB.active = wait;
    }
    this.prevB.active = this.page > 0; this.nextB.active = this.page < pages - 1;
    if (this.gui) this.gui.markDirty();
  }
  go(i) { const m = this.at(i); if (m && this.spectate) { window.__lc2HubAction = { k: 'mapspectate', game: m.game, id: m.id }; this.spectate(); } }
  async decide(i, ok) {
    const m = this.at(i);
    if (!m) return;
    this.status = (ok ? 'Approving ' : 'Denying ') + m.name + '...'; this.gui.markDirty();
    const r = await mapReview(m.game, m.id, ok);
    if (r && r.ok) { this.status = (ok ? 'Approved ' : 'Denied ') + m.name + '.'; await this.load(); this.status = (ok ? 'Approved ' : 'Denied ') + m.name + '.'; }
    else this.status = (r && r.error) || 'That did not work.';
    this.gui.markDirty();
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    g.centered(this.title, this.width / 2, 12, WHITE);
    g.centered(this.tab === 'build' ? 'Maps not in the vote yet, and any being built now' : "Players' maps waiting to go in the vote", this.width / 2, 24, GREY);
    // (a line cut short with ... where it would run into the buttons)
    const fit = (s, w) => { if (g.textWidth(s) <= w) return s; while (s.length > 1 && g.textWidth(s + '...') > w) s = s.slice(0, -1); return s + '...'; };
    for (let i = 0; i < PER_PAGE; i++) {
      const m = this.at(i);
      if (!m) continue;
      const y = this.rows[i].y, x = this.left;
      if (this.tab === 'build') {
        const now = m.now || [], w = this.right - 66 - x;
        g.text(fit('§e' + m.name + '  ' + (STATUS[m.status] || '') + ' §8- ' + m.gameName, w), x, y + 1, WHITE);
        g.text(fit('§7by §f' + m.by + '  ' + (now.length ? '§aBuilding now: §f' + now.slice(0, 3).join(', ') + (now.length > 3 ? '...' : '') : '§8changed ' + ago(m.changed || 0)), w), x, y + 11, WHITE);
        continue;
      }
      const w = this.right - 172 - x;
      g.text(fit('§e' + m.name, w), x, y + 1, WHITE);
      g.text(fit('§7' + m.gameName + ' by §f' + m.by, w), x, y + 11, WHITE);
    }
    if (this.status) g.centered(this.status, this.width / 2, this.height - 44, GREY);
  }
}
