/* ---------------------------------------------------------------------------
   Leon Kart - the pages behind the home screen.

   The home screen keeps to the car, the board and the three ways to play.
   Everything else sits one tap away in a row of small buttons under them, and
   each opens a page of its own over the menu:

     Inventory     every cosmetic, won or not, and what you are wearing
     Stats         your runs, laps, speeds and maps, or anybody else's
     Custom maps   maps people have built: play them, rate them, build one
     Requests      ask for something

   Nothing here touches the race itself; the game hands in what it knows
   through `g` and is told what to do through the callbacks.
--------------------------------------------------------------------------- */
import { CATALOG, KINDS, TIER_NAME, TIER_COLOUR, HOW_TO_WIN, PRIZE_ROWS, owns, itemById } from './cosmetics.js?v=100';
import { icon, KIND_ICON, fillIcons } from './icons.js?v=100';
import { thumbFor, portraitFor } from './thumbs.js?v=100';

export function makeHub(g) {
  const { el, esc, MC } = g;
  fillIcons();
  let profile = null;            // the last profile the server sent for you
  let open = null;

  function show(id) {
    for (const p of ['inv', 'stats', 'cmaps', 'req']) el(p).classList.toggle('on', p === id);
    open = id;
    if (id === 'inv') drawInv();
    if (id === 'stats') loadStats(g.name());
    if (id === 'cmaps') loadMaps();
    if (id === 'req') drawReq();
  }
  function hide() { if (open) el(open).classList.remove('on'); open = null; hideTip(); }
  for (const [btn, page] of [['hubinv', 'inv'], ['hubstats', 'stats'], ['hubmaps', 'cmaps'], ['hubreq', 'req']]) {
    el(btn).addEventListener('click', () => show(page));
  }
  document.querySelectorAll('.hubback').forEach(b => b.addEventListener('click', hide));
  addEventListener('keydown', e => { if (e.key === 'Escape' && open && !g.typing()) { hide(); e.stopPropagation(); } }, true);

  /* ---- inventory ---------------------------------------------------------- */
  const INV_TABS = [
    { id: 'prizes', name: 'Prizes' },
    { id: 'kart', name: 'Kart', kinds: ['skin', 'body'] },
    { id: 'driver', name: 'Driver', kinds: ['hat', 'face', 'driver'] },
    { id: 'extras', name: 'Extras', kinds: ['glider', 'plate', 'decor', 'aura'] },
  ];
  let invTab = 'prizes';
  el('invtabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b || b.dataset.tab === invTab) return;
    invTab = b.dataset.tab;
    el('invnote').textContent = '';
    drawInv();
  });
  function drawInv() {
    const inv = g.inv();
    const st = g.style();
    const box = el('invbody');
    const owned = CATALOG.filter(c => c.tier !== 'free' && inv[c.id]).length;
    const total = CATALOG.filter(c => c.tier !== 'free').length;
    el('invcount').textContent = owned + ' of ' + total + ' unlocked';
    el('invnote').textContent = '';
    const heldWhy = g.held() || {};
    const slotOf = kind => (KINDS.find(K => K.id === kind) || KINDS[0]).slot;
    const wornIn = slot => (st[slot[0]] || {})[slot[1]] || null;
    /* One tile; a prize says what it takes, or that you hold it and why. The
       info button sits beside the tile rather than in it, so a locked tile's
       fading does not fade it too. */
    const tile = c => {
      const slot = slotOf(c.kind);
      const have = owns(inv, c.id);
      const label = c.src ? (have && heldWhy[c.id] ? 'Held' : have ? 'Yours' : c.need) : TIER_NAME[c.tier];
      return '<div class="tw"><button type="button" class="tile ' + c.tier + (have ? '' : ' locked') + (wornIn(slot) === c.id ? ' on' : '') + '"'
        + ' data-slot="' + slot.join('.') + '" data-id="' + c.id + '" style="--t:' + TIER_COLOUR[c.tier] + '">'
        + '<i class="pic" data-th="' + c.id + '">' + icon(KIND_ICON[c.kind]) + '</i><b>' + esc(c.name) + '</b><small>'
        + (have ? '' : icon('lock') + ' ') + esc(label) + '</small></button>'
        + '<button type="button" class="info" data-info="' + c.id + '" aria-label="How to get ' + esc(c.name) + '">' + icon('info') + '</button></div>';
    };
    const legend = ['common', 'rare', 'epic', 'legendary'].map(t =>
      '<span class="lg"><i style="background:' + TIER_COLOUR[t] + '"></i><b>' + TIER_NAME[t] + '</b> ' + esc(HOW_TO_WIN[t]) + '</span>').join('');
    el('invlegend').innerHTML = legend;
    if (!(g.name() || '').trim()) {
      el('invtabs').innerHTML = '';
      box.innerHTML = '<p class="none">Type a name on the title screen first: it is your account, and what you win is kept under it.</p>';
      return;
    }
    /* One tab at a time, so the page is never a long scroll (Leon asked for
       it shorter on 2026-10-02). Each tab says how many of its own you have. */
    const inTab = t => t.id === 'prizes' ? CATALOG.filter(c => c.src) : CATALOG.filter(c => !c.src && t.kinds.includes(c.kind));
    el('invtabs').innerHTML = INV_TABS.map(t => {
      const list = inTab(t).filter(c => c.tier !== 'free');
      return '<button type="button" role="tab" data-tab="' + t.id + '" aria-selected="' + (invTab === t.id) + '"' + (invTab === t.id ? ' class="on"' : '') + '>'
        + esc(t.name) + '<small>' + list.filter(c => owns(inv, c.id)).length + '/' + list.length + '</small></button>';
    }).join('');
    const tab = INV_TABS.find(t => t.id === invTab) || INV_TABS[0];
    /* The prizes, a row for each place they come from: every track, all
       tracks, ranked, and ranked wins, two rows across where there is room.
       1st holds the 1st, 2nd, 3rd and top 10 prizes; 2nd the last three; 3rd
       the last two; the rest of the top 10 the last one. */
    if (tab.id === 'prizes') {
      box.innerHTML = '<section class="prizes">'
        + '<p class="hsub">For where you stand. A place prize is yours while you hold the place and goes if somebody takes it. '
        + '1st gets every prize in its row, 2nd the last three, 3rd the last two, and the rest of the top 10 the last one.</p><div class="prows">'
        + PRIZE_ROWS.map(R => {
          const items = CATALOG.filter(c => c.src === R.src);
          return '<div class="prow' + (items.length > 4 ? ' wide' : '') + '"><h4>' + esc(R.name) + '<small>' + esc(R.note) + '</small></h4><div class="tiles">'
            + items.map(tile).join('') + '</div></div>';
        }).join('') + '</div></section>';
    } else {
      // small groups sit side by side, so a one-item group does not take a whole row
      box.innerHTML = '<div class="secs">' + tab.kinds.map(id => KINDS.find(K => K.id === id)).filter(Boolean).map(K => {
        const items = CATALOG.filter(c => c.kind === K.id && !c.src);
        const worn = (st[K.slot[0]] || {})[K.slot[1]] || null;
        return '<section><h3>' + esc(K.name) + '</h3><div class="tiles">'
          + '<button type="button" class="tile none' + (!worn ? ' on' : '') + '" data-slot="' + K.slot.join('.') + '" data-id="">'
          + '<i>' + icon('none') + '</i><b>None</b></button>'
          + items.map(tile).join('') + '</div></section>';
      }).join('') + '</div>';
    }
    // and each one's own picture, drawn in your colours, as each is ready
    const racer = g.racer(), build = g.build();
    box.querySelectorAll('[data-th]').forEach(e => {
      const it = itemById(e.dataset.th);
      if (it) thumbFor(it, racer, build).then(url => { if (url && e.isConnected) e.innerHTML = '<img alt="" src="' + url + '">'; });
    });
  }
  /* ---- how to get each one: the tip by the info button -------------------- */
  const TIER_HOW = {
    free: 'Free. Everyone has it.',
    common: 'Win a multiplayer race against at least one other player. Each win unlocks a random common cosmetic you do not have yet.',
    rare: 'Reach a new best place in the top 10 of a track\'s time trial board. Each one unlocks a random rare cosmetic you do not have yet.',
    epic: 'Win a ranked battle. Each win unlocks a random epic cosmetic you do not have yet (every third win gives a legendary instead).',
    legendary: 'Set the fastest time trial on a track, or win every third ranked battle (the 3rd, 6th, 9th and so on). Each one unlocks a random legendary cosmetic you do not have yet.',
  };
  function howToGet(c) {
    if (!c.src) return TIER_HOW[c.tier] || HOW_TO_WIN[c.tier] || '';
    if (c.src === 'wins') return c.how + '.';
    return c.how + '. It is yours while you hold the place, and goes if somebody takes it.';
  }
  const tip = document.createElement('div');
  tip.id = 'invtip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipFor = null;
  function showTip(btn) {
    const c = itemById(btn.dataset.info);
    if (!c) return;
    const have = owns(g.inv(), c.id), why = (g.held() || {})[c.id];
    const status = c.tier === 'free' ? '' : have && why ? 'You hold it now: ' + why + '.' : have ? 'Unlocked.' : 'Not unlocked yet.';
    tip.innerHTML = '<b>' + esc(c.name) + '</b><span class="tt" style="color:' + TIER_COLOUR[c.tier] + '">' + esc(TIER_NAME[c.tier] || '') + '</span>'
      + '<p>' + esc(howToGet(c)) + '</p>' + (status ? '<p class="tst' + (have ? ' have' : '') + '">' + esc(status) + '</p>' : '');
    tip.hidden = false;
    if (tipFor) tipFor.classList.remove('on');
    tipFor = btn; btn.classList.add('on');
    // above the button if it fits, otherwise below, and never off the screen
    const r = btn.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const y = r.top - h - 8 >= 8 ? r.top - h - 8 : Math.min(innerHeight - h - 8, r.bottom + 8);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { tip.hidden = true; if (tipFor) tipFor.classList.remove('on'); tipFor = null; }
  const invb = el('invbody');
  invb.addEventListener('mouseover', e => { const b = e.target.closest('button.info'); if (b) showTip(b); });
  invb.addEventListener('mouseout', e => { const b = e.target.closest('button.info'); if (b && !b.contains(e.relatedTarget)) hideTip(); });
  invb.addEventListener('focusin', e => { const b = e.target.closest('button.info'); if (b) showTip(b); else hideTip(); });
  invb.addEventListener('focusout', e => { if (e.target.closest('button.info')) hideTip(); });
  addEventListener('pointerdown', e => { if (!tip.hidden && !e.target.closest('button.info')) hideTip(); }, true);
  addEventListener('scroll', hideTip, true);
  addEventListener('resize', hideTip);
  el('invbody').addEventListener('click', e => {
    /* A tap on the info button shows the tip (there is no hover on a phone).
       It only ever shows it: a tap sends a hover first, so a toggle would
       open and shut it in one go. A tap anywhere else puts it away. */
    const inf = e.target.closest('button.info');
    if (inf) { showTip(inf); return; }
    hideTip();
    const b = e.target.closest('button.tile');
    if (!b) return;
    const id = b.dataset.id;
    if (id && !owns(g.inv(), id)) {
      const it = itemById(id);
      el('invnote').textContent = it ? (it.how || HOW_TO_WIN[it.tier]) + ' to unlock ' + it.name + '.' : 'Not unlocked yet.';
      return;
    }
    // the one you are wearing, clicked again, comes off (as if None were picked)
    const [a, k] = b.dataset.slot.split('.');
    g.setStyle(s => { s[a] = s[a] || {}; if (id && s[a][k] !== id) s[a][k] = id; else delete s[a][k]; });
    drawInv();
  });

  /* ---- stats ---------------------------------------------------------------- */
  const fmt = t => g.time(t);
  // built maps by their own names, for the stats page
  const mapNames = {};
  function knowMaps() {
    return fetch(MC + '/kart/maps', { cache: 'no-store' }).then(r => r.json())
      .then(j => { for (const m of (j && j.maps) || []) mapNames['c:' + m.id] = m.name; }).catch(() => {});
  }
  const nameOfMap = id => mapNames[id] || g.mapName(id);
  function loadStats(name) {
    const n = (name || '').trim();
    el('statsname').value = n;
    const box = el('statsbody');
    if (!n) { box.innerHTML = '<p class="none">Type a name to look somebody up, or put your own on the title screen.</p>'; return; }
    box.innerHTML = '<p class="none">Loading…</p>';
    Promise.all([fetch(MC + '/kart/profile?name=' + encodeURIComponent(n), { cache: 'no-store' }).then(r => r.json()), knowMaps()])
      .then(([p]) => drawStats(p, n)).catch(() => { box.innerHTML = '<p class="none">The server could not be reached.</p>'; });
  }
  function drawStats(p, asked) {
    const box = el('statsbody');
    if (!p || !p.stats) { box.innerHTML = '<p class="none">Nothing for that name.</p>'; return; }
    const s = p.stats;
    const avgLap = s.laps ? s.lapSum / s.laps : 0;
    const avgSpeed = s.timeSum ? s.distSum / s.timeSum * 3.6 : 0;
    const maps = Object.keys(s.maps || {});
    // the track you are quickest on: the best average speed
    let fastest = null, fv = 0;
    for (const m of maps) { const r = s.maps[m]; const v = r.avgN ? r.avgSum / r.avgN : 0; if (v > fv) { fv = v; fastest = m; } }
    const rk = p.ranked || {};
    const rate = rk.matches ? Math.round(rk.wins / rk.matches * 100) : null;
    const tile = (label, value) => '<div class="st"><b>' + value + '</b><span>' + label + '</span></div>';
    const L = p.look || {};
    const R = g.racers[L.cast || 0] || g.racers[0];
    const bits = [];
    if (L.build) bits.push(['Body', L.build.chassis], ['Wheels', L.build.wheels], ['Trail', L.build.trail]);
    const C = L.char || {}, K = L.kart || {};
    const nameOf = id => { const it = itemById(id); return it ? it.name : id; };
    for (const [lab, v] of [['Hat', C.hat], ['Face', C.face], ['Unique driver', C.driver], ['Kart skin', K.skin], ['Themed kart', K.body],
                             ['Glider', K.glider], ['Decoration', K.decor], ['Plates', K.plate], ['Aura', K.aura]]) if (v) bits.push([lab, nameOf(v)]);
    const sw = v => (typeof v === 'number') ? '<i class="sw" style="background:#' + v.toString(16).padStart(6, '0') + '"></i>' : '';
    box.innerHTML = '<h3 class="who">' + esc(p.name || asked) + (p.exists ? '' : ' <small>(no runs yet)</small>') + '</h3>'
      + '<div class="sts">'
      + tile('Total runs', s.runs || 0) + tile('Finished', s.finished || 0)
      + tile('Average lap', avgLap ? fmt(avgLap) : '—') + tile('Average speed', avgSpeed ? Math.round(avgSpeed) + ' km/h' : '—')
      + tile('Top speed', s.topSpeed ? Math.round(s.topSpeed) + ' km/h' : '—')
      + tile('Fastest map', fastest ? esc(nameOfMap(fastest)) : '—')
      + tile('Ranked win rate', rate === null ? '—' : rate + '%') + tile('Ranked', rk.matches ? rk.wins + '–' + rk.losses : '—')
      + tile('Races won', s.raceWins || 0) + tile('Podiums', s.podiums || 0)
      + '</div>'
      + '<h4>Every map</h4>'
      + (maps.length ? '<div class="rows mapstats">' + maps.sort().map(m => {
        const r = s.maps[m];
        return '<div class="r"><span>' + esc(nameOfMap(m)) + '<small>' + r.runs + ' runs</small></span>'
          + '<span class="t"><em>Best lap</em>' + (r.bestLap ? fmt(r.bestLap) : '—') + '</span>'
          + '<span class="t"><em>Race</em>' + (r.raceBest ? fmt(r.raceBest) : '—') + '</span>'
          + '<span class="t"><em>Time trial</em>' + (r.ttBest ? fmt(r.ttBest) : '—') + '</span></div>';
      }).join('') + '</div>' : '<p class="none">No laps yet.</p>')
      + '<h4>Build and character</h4>'
      + '<div class="build"><p><b>Driver</b> ' + esc(R ? R.name : '—') + ' '
      + (C.skin !== undefined ? 'skin ' + sw(C.skin) : '') + (C.shirt !== undefined ? ' shirt ' + sw(C.shirt) : '') + (C.pants !== undefined ? ' trousers ' + sw(C.pants) : '')
      + (K.paint !== undefined ? ' paint ' + sw(K.paint) : '') + (K.paint2 !== undefined && K.grad && K.grad !== 'none' ? ' to ' + sw(K.paint2) : '') + '</p>'
      + (bits.length ? '<p>' + bits.map(b => '<span class="chip"><em>' + esc(b[0]) + '</em> ' + esc(String(b[1])) + '</span>').join('') + '</p>' : '')
      + '</div>';
  }
  el('statsgo').addEventListener('click', () => loadStats(el('statsname').value));
  el('statsname').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') loadStats(el('statsname').value); });

  /* ---- requests ----------------------------------------------------------- */
  function drawReq() {
    el('reqmsg').textContent = '';
    el('reqadmin').hidden = !g.admin();
    if (g.admin()) loadReqs();
  }
  el('reqsend').addEventListener('click', () => {
    const text = el('reqtext').value.trim();
    if (text.length < 3) { el('reqmsg').textContent = 'Write a little more first.'; return; }
    el('reqsend').disabled = true;
    fetch(MC + '/kart/request', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: g.name(), kind: el('reqkind').value, text }) })
      .then(r => r.json()).then(j => {
        el('reqsend').disabled = false;
        if (j && j.ok) { el('reqtext').value = ''; el('reqmsg').textContent = 'Sent. Thank you!'; }
        else el('reqmsg').textContent = (j && j.error) || 'That did not go through.';
      }).catch(() => { el('reqsend').disabled = false; el('reqmsg').textContent = 'The server could not be reached.'; });
  });
  el('reqtext').addEventListener('keydown', e => e.stopPropagation());
  function loadReqs() {
    fetch(MC + '/kart/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: g.admin() }) })
      .then(r => r.json()).then(j => {
        const box = el('reqlist');
        if (!j || !j.requests) { box.innerHTML = '<p class="none">' + esc((j && j.error) || 'Could not load them.') + '</p>'; return; }
        box.innerHTML = j.requests.length ? j.requests.map(r =>
          '<div class="rq' + (r.done ? ' done' : '') + '"><p><b>' + esc(r.name) + '</b> <em>' + esc(r.kind) + '</em> <small>'
          + new Date(r.at).toLocaleString() + '</small></p><p>' + esc(r.text) + '</p>'
          + '<button type="button" data-id="' + r.id + '" data-done="' + (r.done ? '0' : '1') + '">' + (r.done ? 'Not done' : 'Done') + '</button>'
          + '<button type="button" data-id="' + r.id + '" data-done="delete">Delete</button></div>').join('') : '<p class="none">No requests yet.</p>';
      });
  }
  el('reqlist').addEventListener('click', e => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const done = b.dataset.done === 'delete' ? 'delete' : b.dataset.done === '1';
    fetch(MC + '/kart/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: g.admin(), id: b.dataset.id, done }) })
      .then(() => loadReqs());
  });

  /* ---- custom maps ---------------------------------------------------------- */
  let mapList = [], mapSettings = {};
  function loadMaps() {
    el('cmlist').innerHTML = '<p class="none">Loading…</p>';
    el('cmadmin').hidden = !g.admin();
    fetch(MC + '/kart/maps', { cache: 'no-store' }).then(r => r.json()).then(j => {
      mapList = (j && j.maps) || [];
      mapSettings = (j && j.settings) || {};
      drawMaps();
      if (g.admin()) drawMapAdmin();
    }).catch(() => { el('cmlist').innerHTML = '<p class="none">The server could not be reached.</p>'; });
  }
  function drawMaps() {
    const box = el('cmlist');
    if (!mapList.length) { box.innerHTML = '<p class="none">No maps yet. Build the first one!</p>'; return; }
    box.innerHTML = mapList.map(m =>
      '<div class="cm' + (m.featured ? ' feat' : '') + '" data-id="' + m.id + '">'
      + '<div class="th">' + (m.hasThumb ? '<img loading="lazy" alt="" src="' + MC + '/kart/maps/thumb?id=' + m.id + '&v=' + m.updated + '">' : '<span>' + icon('flag') + '</span>')
      + (m.featured ? '<em>Featured</em>' : '') + '</div>'
      + '<div class="inf"><h4>' + esc(m.name) + '</h4><p>by ' + esc(m.author) + ' · ' + (m.plays || 0) + ' plays</p>'
      + '<div class="vote"><button type="button" data-v="1" aria-label="Like">' + icon('thumbup') + ' <b>' + (m.likes || 0) + '</b></button>'
      + '<button type="button" data-v="-1" aria-label="Dislike">' + icon('thumbdown') + ' <b>' + (m.dislikes || 0) + '</b></button></div>'
      + '<div class="acts"><button type="button" class="go" data-a="tt">Time trial</button><button type="button" data-a="race">Race</button>'
      + '<button type="button" data-a="edit">Edit</button>' + (g.admin() ? '<button type="button" data-a="del" class="bad">Delete</button>' : '') + '</div></div>'
      + '<div class="lb"><h5>Best times</h5>' + (m.top && m.top.length ? m.top.map((r, i) =>
        '<p><span>' + (i + 1) + '</span>' + esc(r.name) + '<b>' + fmt(r.time) + '</b></p>').join('') : '<p class="none">No times yet</p>')
      + '<button type="button" data-a="board" class="more">Full board</button></div></div>').join('');
  }
  el('cmlist').addEventListener('click', e => {
    const card = e.target.closest('.cm');
    if (!card) return;
    const id = card.dataset.id;
    const m = mapList.find(x => x.id === id);
    const vb = e.target.closest('button[data-v]');
    if (vb) {
      fetch(MC + '/kart/maps/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: g.name(), vote: +vb.dataset.v }) }).then(r => r.json()).then(j => {
        if (j && j.ok && m) { m.likes = j.likes; m.dislikes = j.dislikes; drawMaps(); }
      });
      return;
    }
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'tt' || a === 'race') { hide(); g.playMap(id, a); }
    else if (a === 'edit') askEdit(m);
    else if (a === 'board') showBoard(m, card);
    else if (a === 'del') {
      if (!confirm('Delete "' + m.name + '" for good?')) return;
      fetch(MC + '/kart/maps/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, admin: g.admin() }) })
        .then(r => r.json()).then(j => { if (j && j.ok) loadMaps(); else alert((j && j.error) || 'Could not delete it.'); });
    }
  });
  function showBoard(m, card) {
    fetch(MC + '/kart/maps/board?id=' + m.id, { cache: 'no-store' }).then(r => r.json()).then(j => {
      const lb = card.querySelector('.lb');
      const rows = (j && j.board) || [];
      lb.innerHTML = '<h5>Best times</h5>' + (rows.length ? rows.map((r, i) => '<p><span>' + (i + 1) + '</span>' + esc(r.name) + '<b>' + fmt(r.time) + '</b>'
        + (g.admin() ? '<button type="button" class="x" data-rm="' + esc(r.name) + '">×</button>' : '') + '</p>').join('') : '<p class="none">No times yet</p>');
      lb.querySelectorAll('[data-rm]').forEach(x => x.addEventListener('click', ev => {
        ev.stopPropagation();
        fetch(MC + '/kart/maps/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin: g.admin(), removeTime: { id: m.id, name: x.dataset.rm } }) }).then(() => showBoard(m, card));
      }));
    });
  }
  /* Editing a map takes its password, the way a Leoncraft minigame does; an
     admin goes straight in. */
  function askEdit(m) {
    if (g.admin()) { hide(); g.editMap(m.id, null); return; }
    const pw = prompt('Password for "' + m.name + '"');
    if (!pw) return;
    fetch(MC + '/kart/maps/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id, password: pw }) })
      .then(r => r.json()).then(j => {
        if (j && j.ok) { hide(); g.editMap(m.id, pw); }
        else alert((j && j.error) || 'Wrong password.');
      });
  }
  el('cmnew').addEventListener('click', () => { hide(); g.editMap(null, null); });
  function drawMapAdmin() {
    const s = mapSettings;
    el('cmadmin').innerHTML = '<h4>Admin: map settings</h4>'
      + '<label><input type="checkbox" id="cmaopen"' + (s.open !== false ? ' checked' : '') + '> Anyone can publish maps</label>'
      + '<label>Most maps a person can make <input type="number" id="cmamax" min="1" max="200" value="' + (s.maxPerAuthor || 20) + '"></label>'
      + '<label>Laps on a new map <input type="number" id="cmalaps" min="1" max="9" value="' + (s.laps || 3) + '"></label>'
      + '<label>Featured map <select id="cmafeat"><option value="">None</option>' + mapList.map(m => '<option value="' + m.id + '"' + (s.featured === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></label>'
      + '<button type="button" id="cmasave" class="go">Save settings</button> <span id="cmamsg"></span>';
    el('cmasave').addEventListener('click', () => {
      const settings = { open: el('cmaopen').checked, maxPerAuthor: +el('cmamax').value, laps: +el('cmalaps').value, featured: el('cmafeat').value };
      fetch(MC + '/kart/maps/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: g.admin(), settings }) })
        .then(r => r.json()).then(j => { el('cmamsg').textContent = j && j.ok ? 'Saved.' : ((j && j.error) || 'Not saved.'); if (j && j.ok) loadMaps(); });
    });
    el('cmadmin').querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
  }

  return {
    show, hide,
    get open() { return open; },
    refresh(p) { profile = p; if (open === 'inv') drawInv(); },
    thumb: (it, racer, build) => thumbFor(it, racer, build),
    portrait: i => portraitFor(i),
    reloadMaps: loadMaps,
  };
}
