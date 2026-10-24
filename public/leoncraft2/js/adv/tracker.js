/* ---------------------------------------------------------------------------
   Leoncraft 2 - advancements: the list, and one player's progress.

   ADV holds every advancement (advdata.js) by id, with its children; TABS
   the five roots in the game's order. A Progress is one player's record in
   one world: which criteria are met, so which advancements are made. It
   answers the game's own rules:

     made        every requirement group has a criterion met (a group is an
                 "or", the groups an "and")
     progress    "n/m" requirement groups met, when there are two or more
     visible     made, or anything below it made; otherwise the first of
                 itself, its parent and its grandparent that says so: made
                 shows it, hidden and not made keeps it out (so two steps
                 ahead of what you have done can be seen, and a hidden
                 advancement only once it is made)
     a tab       shows once its root is visible; tabs go left to right in
                 the order they first appeared

   Criteria come in through trigger(type, event, env), which tries every
   criterion of that trigger not yet met (adv/match.js decides), and
   through grant / revoke (the /advancement command). Whoever wants to know
   (the toast, the chat line, the reward) listens with onMade.
--------------------------------------------------------------------------- */
import { ADVANCEMENTS } from './advdata.js?v=107';
import { test } from './match.js?v=107';

export const ADV = new Map();
for (const a of ADVANCEMENTS) { a.children = []; a.tab = a.id.split('/')[0]; ADV.set(a.id, a); }
for (const a of ADVANCEMENTS) if (a.parent && ADV.has(a.parent)) ADV.get(a.parent).children.push(a);
// (children top to bottom, as the tree draws them)
for (const a of ADVANCEMENTS) a.children.sort((p, q) => p.y - q.y);
export const TABS = ['story', 'nether', 'end', 'adventure', 'husbandry'].map(t => ADV.get(t + '/root')).filter(Boolean);
// every criterion by its trigger: [advancement, criterion name, conditions]
const BY = {};
for (const a of ADVANCEMENTS) for (const [n, t, c] of a.crit) (BY[t] = BY[t] || []).push([a, n, c]);
export const TRIGGERS = Object.keys(BY);

export class Progress {
  constructor() {
    this.met = new Map();          // id -> Set of criteria met
    this.made = new Set();         // ids made
    this.tabOrder = [];            // roots, in the order their tabs appeared
    this.extra = {};               // what the triggers keep between events (where you entered the Nether)
    this.listeners = [];
    this.version = 0;              // goes up with every change (the screen redraws)
    this._vis = null;
  }
  onMade(fn) { this.listeners.push(fn); }
  has(id, crit) { const s = this.met.get(id); return !!(s && s.has(crit)); }
  isMade(id) { return this.made.has(id); }
  // made: every group has one met
  _complete(a) {
    const s = this.met.get(a.id);
    if (!s || !a.req.length) return false;
    return a.req.every(g => g.some(c => s.has(c)));
  }
  // the requirement groups met and how many there are
  counts(id) {
    const a = ADV.get(id), s = this.met.get(id);
    if (!a) return [0, 0];
    let n = 0;
    for (const g of a.req) if (s && g.some(c => s.has(c))) n++;
    return [n, a.req.length];
  }
  progressText(id) { const [n, m] = this.counts(id); return m > 1 ? n + '/' + m : null; }
  percent(id) { const [n, m] = this.counts(id); return m ? n / m : 0; }

  /* Meet one criterion. True when that made the advancement (then everyone
     listening hears about it, with how: 'game' or 'command'). */
  award(id, crit, how = 'game') {
    const a = ADV.get(id);
    if (!a || !a.crit.some(c => c[0] === crit)) return false;
    if (this.made.has(id)) return false;
    let s = this.met.get(id);
    if (!s) { s = new Set(); this.met.set(id, s); }
    if (s.has(crit)) return false;
    s.add(crit);
    this.changed();
    if (this._complete(a)) {
      this.made.add(id);
      this.changed();
      for (const fn of this.listeners) { try { fn(a, how); } catch (e) { console.error(e); } }
      return true;
    }
    return false;
  }
  // every criterion of it (the command's grant): true when that made it
  grant(id, how = 'command') {
    const a = ADV.get(id);
    if (!a || this.made.has(id)) return false;
    let got = false;
    for (const [n] of a.crit) if (!this.has(id, n)) got = this.award(id, n, how) || got;
    return got;
  }
  // take one criterion (or all of them) away; true when it took anything
  revoke(id, crit) {
    const a = ADV.get(id), s = this.met.get(id);
    if (!a || !s || !s.size) return false;
    if (crit !== undefined) { if (!s.delete(crit)) return false; }
    else s.clear();
    if (!s.size) this.met.delete(id);
    this.made.delete(id);
    if (this._complete(a)) this.made.add(id);
    this.changed();
    return true;
  }
  changed() { this.version++; this._vis = null; }

  /* Something happened: every criterion of that trigger not yet met is tried. */
  trigger(type, ev, env) {
    const list = BY[type];
    if (!list) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const [a, name, cond] = list[i];
      if (this.made.has(a.id) || this.has(a.id, name)) continue;
      let ok = false;
      try { ok = test(type, cond, ev || {}, env || {}); } catch (e) { console.warn('advancement', a.id, name, e); ok = false; }
      if (ok) { this.award(a.id, name); n++; }
    }
    return n;
  }
  // is any criterion of this trigger still to be met? (so a hook can skip building its event)
  wants(type) {
    const list = BY[type];
    if (!list) return false;
    for (let i = 0; i < list.length; i++) { const [a, name] = list[i]; if (!this.made.has(a.id) && !this.has(a.id, name)) return true; }
    return false;
  }
  // the criteria still wanted of a trigger (for hooks that only need to watch a few things)
  wanted(type) {
    const out = [];
    for (const [a, name, cond] of BY[type] || []) if (!this.made.has(a.id) && !this.has(a.id, name)) out.push([a, name, cond]);
    return out;
  }

  /* ---- what the screen shows ---- */
  visibility() {
    if (this._vis) return this._vis;
    const out = new Map(), stack = [];
    const walk = a => {
      const done = this.made.has(a.id);
      stack.push(done ? 1 : a.hidden ? -1 : 0);
      let below = done;
      for (const c of a.children) below = walk(c) || below;
      let vis = below;
      if (!vis) for (let i = stack.length - 1; i >= Math.max(0, stack.length - 3); i--) { if (stack[i] === 1) { vis = true; break; } if (stack[i] === -1) break; }
      stack.pop();
      out.set(a.id, vis);
      return below;
    };
    for (const r of TABS) walk(r);
    this._vis = out;
    // a tab joins the row the first time its root shows
    for (const r of TABS) if (out.get(r.id) && !this.tabOrder.includes(r.id)) this.tabOrder.push(r.id);
    return out;
  }
  visible(id) { return !!this.visibility().get(id); }
  tabs() { this.visibility(); return this.tabOrder.map(id => ADV.get(id)).filter(Boolean); }

  /* ---- saved with the world (and on a server, with your own record) ---- */
  toJSON() {
    const c = {};
    for (const [id, s] of this.met) if (s.size) c[id] = [...s];
    return { c, x: this.extra };
  }
  fromJSON(o) {
    this.met.clear(); this.made.clear(); this.tabOrder = [];
    this.extra = (o && o.x && typeof o.x === 'object') ? o.x : {};
    const c = o && o.c ? o.c : {};
    for (const id in c) {
      const a = ADV.get(id);
      if (!a || !Array.isArray(c[id])) continue;
      const names = new Set(a.crit.map(e => e[0]));
      const s = new Set(c[id].filter(n => names.has(n)));
      if (!s.size) continue;
      this.met.set(id, s);
      if (this._complete(a)) this.made.add(id);
    }
    // the tabs as the game lists them when you join: its own order
    this.changed();
    for (const r of TABS) if (this.visibility().get(r.id) && !this.tabOrder.includes(r.id)) this.tabOrder.push(r.id);
  }
}
