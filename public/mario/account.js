/* ---------------------------------------------------------------------------
   Leon Cart - accounts, coins and the shop.

   Signing in happens on the title screen, before there is a lobby to join, so
   it goes over plain http to the same box the lobby runs on. What comes back is
   a token; the lobby connection presents that later instead of the password,
   which is also what keeps you signed in between visits.

   Coins come from two places: the ones you pick up on the circuit, and what the
   race itself pays. The payout is settled by the server, because the server is
   the only thing that knows the whole grid, and it pays for people beaten
   rather than for the number next to your name.

   Everything here degrades to nothing. Signed out, or with the server down, the
   game is exactly the game it was: you race, you just do not keep anything.
--------------------------------------------------------------------------- */

const HTTP = (location.hostname.endsWith('leonzhao.dev'))
  ? 'https://apps.leonzhao.dev/mc'
  : (() => {
      // in a test the lobby is passed as a ws url; the http face is the same box
      const ws = new URLSearchParams(location.search).get('ws') || 'wss://apps.leonzhao.dev/mc/ws';
      return ws.replace(/^ws/, 'http').replace(/\/ws(\?.*)?$/, '');
    })();

/* What everybody starts with. The rest of the garage is in the shop, which is
   what gives a race something to be for. */
export const FREE = {
  chassis: ['formula'], wheels: ['slick'], trail: ['spark'],
  hat: ['cap'], face: ['plain'], suit: ['race'],
};

const state = {
  user: null, token: null, coins: 0, owned: [], stats: null, shop: [],
  err: '', busy: false,
};
let listeners = [];
export const onChange = fn => { listeners.push(fn); return () => { listeners = listeners.filter(f => f !== fn); }; };
const changed = () => { for (const f of listeners) { try { f(state); } catch (e) {} } };

export const acct = state;
export const signedIn = () => !!state.user;

/* Does this account have this part? Free parts are owned by everybody, and
   anybody who is not signed in has exactly the free ones - which is the whole
   reason to sign in. */
export function owns(part, id) {
  if ((FREE[part] || []).indexOf(id) >= 0) return true;
  return state.owned.indexOf(part + ':' + id) >= 0;
}
export function tags() {
  return state.owned.filter(o => o.slice(0, 4) === 'tag:').map(o => o.slice(4));
}
export function priceOf(part, id) {
  const it = state.shop.find(x => x.part === part && x.of === id);
  return it ? it.cost : null;
}

async function call(body) {
  state.busy = true;
  changed();
  try {
    const r = await fetch(HTTP + '/mk/acct', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    return { err: 'Cannot reach the server' };
  } finally {
    state.busy = false;
  }
}

function take(r) {
  if (!r || r.err) { state.err = (r && r.err) || 'Something went wrong'; changed(); return false; }
  state.err = '';
  state.user = r.user;
  state.coins = r.coins | 0;
  state.owned = r.owned || [];
  state.stats = r.stats || null;
  if (r.shop) state.shop = r.shop;
  if (r.token) {
    state.token = r.token;
    try { localStorage.setItem('mkAuth', JSON.stringify({ user: r.user, token: r.token })); } catch (e) {}
  }
  changed();
  return true;
}

export async function signup(user, pass) { return take(await call({ do: 'signup', user, pass })); }
export async function login(user, pass) { return take(await call({ do: 'login', user, pass })); }
export async function buy(id) { return take(await call({ do: 'buy', id, user: state.user, token: state.token })); }

/* A race run on your own. The lobby settles a lobby race; this settles the
   other kind, so the coins you pick up racing the computer are worth the same
   as the coins you pick up racing people. */
export async function bankRace(place, field, coinsCollected, lap, theme) {
  if (!state.user) return null;
  const r = await call({ do: 'finish', user: state.user, token: state.token,
                         place, field, coins: coinsCollected, lap, theme });
  if (!r || r.err) return null;
  const was = state.coins;
  take(r);
  return state.coins - was;
}

export async function logout() {
  const was = { user: state.user, token: state.token };
  state.user = null; state.token = null; state.coins = 0; state.owned = []; state.stats = null;
  try { localStorage.removeItem('mkAuth'); } catch (e) {}
  changed();
  if (was.user) call({ do: 'logout', user: was.user, token: was.token });
}

/* Coming back. The catalogue is fetched either way, so the shop can be looked
   at by somebody who has not signed in yet and knows what they are signing in
   for. */
export async function resume() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('mkAuth') || 'null'); } catch (e) {}
  if (saved && saved.user && saved.token) {
    const r = await call({ do: 'resume', user: saved.user, token: saved.token });
    if (r && !r.err) return take(r);
    try { localStorage.removeItem('mkAuth'); } catch (e) {}
  }
  try {
    const r = await fetch(HTTP + '/mk/board');
    const j = await r.json();
    if (j && j.shop) { state.shop = j.shop; changed(); }
  } catch (e) {}
  return false;
}

export async function board() {
  try {
    const r = await fetch(HTTP + '/mk/board');
    const j = await r.json();
    return (j && j.rows) || [];
  } catch (e) { return []; }
}

/* The lobby pays a race, and says so. This keeps the title screen's idea of the
   balance in step without another round trip. */
export function banked(view) {
  if (!view || !view.user || view.user !== state.user) return;
  state.coins = view.coins | 0;
  state.owned = view.owned || state.owned;
  state.stats = view.stats || state.stats;
  changed();
}
