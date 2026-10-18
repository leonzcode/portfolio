/* ---------------------------------------------------------------------------
   Leoncraft 2 - Map Requests (mods and admins), from the server list.

   The maps players made for Leon Network's Prop Hunt and Chameleon wait here
   until a mod or an admin approves them for the vote. Each row: the map, its
   game and its maker, and Spectate (into Leon Network, flying round the map
   in spectator; /mapapprove or /mapdeny there), Approve and Deny. The list
   and the decisions go over HTTP (mlhub lc2.js /mc/lc2/hub/requests and
   /review); Spectate joins the network with the request in hand
   (window.__lc2HubAction, sent by net/hub.js once the network says hello).
--------------------------------------------------------------------------- */
import { Screen, Button, WHITE, GREY } from './gui.js?v=97';
import { mapRequests, mapReview } from '../net/net.js?v=97';

const PER_PAGE = 6;
export class MapRequestsScreen extends Screen {
  // spectate(entry): join Leon Network to look round a map (the server list's join, with the hub's entry)
  constructor(spectate) { super('Map Requests'); this.spectate = spectate; this.list = []; this.page = 0; this.status = 'Loading...'; this.loaded = false; }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    this.rows = [];
    const top = 40, step = Math.max(24, Math.min(30, Math.floor((H - 100) / PER_PAGE)));
    for (let i = 0; i < PER_PAGE; i++) {
      const y = top + i * step, x = W / 2 + 10;
      const row = {
        y,
        spec: this.add(new Button(x, y, 62, 20, 'Spectate', () => this.go(i), 'Fly round it in Leonpixel, then /mapapprove or /mapdeny')),
        ok: this.add(new Button(x + 64, y, 56, 20, '§aApprove', () => this.decide(i, true), 'Put it in the vote')),
        no: this.add(new Button(x + 122, y, 46, 20, '§cDeny', () => this.decide(i, false), 'Send it back to its maker')),
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
    if (r && r.ok) { this.list = r.requests || []; this.status = this.list.length ? '' : 'No maps are waiting for approval.'; }
    else { this.list = []; this.status = (r && r.error) || 'Could not load the requests.'; }
    this.page = Math.min(this.page, Math.max(0, Math.ceil(this.list.length / PER_PAGE) - 1));
    this.update();
  }
  at(i) { return this.list[this.page * PER_PAGE + i] || null; }
  update() {
    const pages = Math.max(1, Math.ceil(this.list.length / PER_PAGE));
    if (this.page >= pages) this.page = pages - 1;
    for (let i = 0; i < PER_PAGE; i++) { const on = !!this.at(i), r = this.rows[i]; r.spec.visible = r.ok.visible = r.no.visible = on; }
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
    g.centered('Players\' maps waiting to go in the vote', this.width / 2, 24, GREY);
    for (let i = 0; i < PER_PAGE; i++) {
      const m = this.at(i);
      if (!m) continue;
      const y = this.rows[i].y, x = this.width / 2 - 200;
      g.text('§e' + m.name, x, y + 1, WHITE);
      g.text('§7' + m.gameName + ' by §f' + m.by, x, y + 11, WHITE);
    }
    if (this.status) g.centered(this.status, this.width / 2, this.height - 44, GREY);
  }
}
