/* ---------------------------------------------------------------------------
   Leoncraft 2 - your look kept with your account (2026-10-28, for "a players
   skin does not save to their account").

   The skin, its model, its gallery name, the cape and which parts show were
   options of this browser alone, so another computer (or a cleared browser)
   had the default skin. Now the server keeps them with the account
   (lc2accounts.js, /mc/lc2/account/look): logging in takes the kept look, and
   every change of it here is sent there a moment after.

   An account with nothing kept yet takes this browser's look if it was last
   this account's, or nobody's yet (a skin made before looks were kept); one
   that was another account's is not handed on: the default instead. Guests
   keep theirs in the browser, as before.
--------------------------------------------------------------------------- */
import { Account } from './account.js?v=117';

const KEYS = ['skin', 'skinModel', 'skinName', 'cape', 'capeName', 'skinParts'];
const OWNER = 'lc2_look_owner';
const DEFAULT_LOOK = { skin: 'default', skinModel: 'classic', skinName: '', cape: '', capeName: '',
  skinParts: { hat: true, jacket: true, leftSleeve: true, rightSleeve: true, leftPants: true, rightPants: true, cape: true } };
const owner = () => { try { return localStorage.getItem(OWNER) || ''; } catch (e) { return ''; } };
const setOwner = n => { try { localStorage.setItem(OWNER, n); } catch (e) {} };

export function startLookSync(options) {
  let applying = false, timer = 0, sent = '', pulledFor = '', edits = 0;
  const who = () => { const s = Account.session; return s && !s.guest && s.token && Account.checked ? s.name.toLowerCase() : ''; };
  const lookNow = () => { const o = {}; for (const k of KEYS) { const v = options.get(k); o[k] = v && typeof v === 'object' ? Object.assign({}, v) : v; } return o; };
  const put = l => {
    applying = true;
    try { for (const k of KEYS) if (l[k] !== undefined && JSON.stringify(options.get(k)) !== JSON.stringify(l[k])) options.set(k, l[k] && typeof l[k] === 'object' ? Object.assign({}, l[k]) : l[k]); }
    finally { applying = false; }
  };
  async function send() {
    timer = 0;
    const n = who();
    if (!n) return;
    const look = lookNow(), sig = n + JSON.stringify(look);
    if (sig === sent) return;
    sent = sig;
    setOwner(n);
    const r = await Account.post('/lc2/account/look', { look });
    // (not kept: tried again with the next change)
    if (!r || !r.ok) sent = '';
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(send, 800); };
  async function pull(n) {
    const e0 = edits;
    const r = await Account.post('/lc2/account/look', {});
    if (!r || !r.ok || who() !== n) { if (who() === n) pulledFor = ''; return; }
    // (changed here while the answer was on its way: this one stands)
    if (edits !== e0) { later(); return; }
    if (r.look) {
      put(r.look); setOwner(n);
      sent = n + JSON.stringify(lookNow());
      return;
    }
    // nothing kept for this account yet
    const o = owner();
    if (o && o !== n) put(DEFAULT_LOOK);
    sent = '';
    send();
  }
  options.onChange(k => { if (applying || KEYS.indexOf(k) < 0) return; edits++; if (who()) later(); });
  const check = () => {
    const n = who();
    if (!n) { if (!Account.session) pulledFor = ''; return; }
    if (n === pulledFor) return;
    pulledFor = n;
    pull(n);
  };
  Account.onChange(check);
  check();
}
