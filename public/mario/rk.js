/* ---------------------------------------------------------------------------
   Ranked 1v1: the lobby, the invites and the line to the server.

   The race itself is the time trial the game already has. This module only
   knows who is online, who invited whom, and what the server said about the
   battle; the game hands it a few hooks for starting a battle, watching one,
   and moving the other car.

   The line is open from the moment the page is, whatever you are doing: on
   the menu, in a race on your own, in multiplayer. So the ranked list shows
   everybody playing, a challenge reaches you wherever you are, and anybody can
   watch you race.
--------------------------------------------------------------------------- */
const WS = (location.hostname.endsWith('leonzhao.dev'))
  ? 'wss://apps.leonzhao.dev/mc/ws'
  : (new URLSearchParams(location.search).get('ws') || 'wss://apps.leonzhao.dev/mc/ws');

// one id a browser, so a second tab is the same player and is turned away
function browserId() {
  try {
    let u = localStorage.getItem('mkUid');
    if (!u || !/^[A-Za-z0-9_-]{8,40}$/.test(u)) {
      u = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('mkUid', u);
    }
    return u;
  } catch (e) { return ''; }
}

export function makeRanked(g) {
  const { el, esc, time, themes, themeName } = g;
  let ws = null, alive = false, myId = 0, myPoints = 0, myName = '';
  let players = [], sent = null, pickTheme = '';
  const invites = new Map();           // id -> invite shown to me
  let open = false, refusedWhy = '', wantName = '', retry = null;
  let gameSt = { mode: 'title', theme: null, round: 0 }, sentSt = '';

  /* ---- the socket ---- */
  function connect() {
    if (ws) return;
    const uid = browserId();
    const name = (g.name() || '').trim();
    if (!name || away) return;
    wantName = name;
    clearTimeout(retry); retry = null;
    const url = WS + (WS.indexOf('?') >= 0 ? '&' : '?') + 'mode=rk&name=' + encodeURIComponent(name)
      + '&uid=' + encodeURIComponent(uid) + '&cast=' + encodeURIComponent(g.cast());
    try { ws = new WebSocket(url); } catch (e) { ws = null; msg('Ranked could not be reached.'); return; }
    ws.onopen = () => { alive = true; sentSt = ''; report(); };
    ws.onclose = () => {
      const was = alive;
      alive = false; ws = null;
      invites.clear(); drawInvites();
      if (was && g.inBattle()) { msg('Lost the connection to ranked.'); g.lost(); }
      drawList();
      // back on as soon as it can be
      clearTimeout(retry);
      if (!away) retry = setTimeout(connect, refusedWhy ? 20000 : 4000);
    };
    ws.onerror = () => {};
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } on(m); };
  }
  function send(o) { if (alive) { try { ws.send(JSON.stringify(o)); } catch (e) {} } }

  function on(m) {
    const t = m.type;
    if (t === 'refused') { refusedWhy = m.why; msg(m.why); alive = false; drawList(); return; }
    if (t === 'hello') { refusedWhy = ''; myId = m.id; myName = m.name; myPoints = m.points || 0; players = m.players || []; msg(''); drawList(); counted(); return; }
    if (t === 'lobby') {
      players = m.players || [];
      const mine = players.find(p => p.id === myId);
      if (mine) myPoints = mine.points;
      drawList();
      counted();
      return;
    }
    if (t === 'invite') { invites.set(m.id, m); drawInvites(); g.ding && g.ding(); return; }
    if (t === 'invitegone') {
      invites.delete(m.id);
      drawInvites();
      if (sent && sent.id === m.id) {
        const who = sent.to.name;
        sent = null;
        if (m.why === 'expired') msg(who + ' did not answer.');
        else if (m.why === 'left') msg(who + ' left ranked.');
        else if (m.why === 'busy') msg(who + ' started another battle.');
        drawList();
      }
      return;
    }
    if (t === 'sent') { sent = { id: m.id, to: m.to }; msg('Waiting for ' + m.to.name + ' to answer…'); drawList(); return; }
    if (t === 'declined') { if (sent && sent.id === m.id) sent = null; msg(m.by + ' said no this time.'); drawList(); return; }
    if (t === 'error') { msg(m.why); return; }
    if (t === 'match') {
      sent = null;
      invites.clear(); drawInvites();
      show(false);
      g.beginMatch(Object.assign({ me: myId }, m));
      return;
    }
    if (t === 'watching') { show(false); g.beginWatch(m); return; }
    if (t === 'fans') { g.fans(m.n | 0); return; }
    if (t === 'watchstatus') { g.watchStatus(m); return; }
    if (t === 'watchend') { g.watchEnd(m); msg(m.name + ' left the game.'); return; }
    if (t === 'restart') { g.restartOk(m.ok, m.left); return; }
    if (t === 'pos') { g.pos(m); return; }
    if (t === 'oppRestart') { g.oppRestart(m); return; }
    if (t === 'oppFinish') { g.oppFinish(m); return; }
    if (t === 'result') {
      const mine = m.points && Object.prototype.hasOwnProperty.call(m.points, myName) ? m.points[myName] : null;
      if (mine !== null) myPoints = mine;
      g.result(m);
      return;
    }
  }

  /* ---- the lobby card ---- */
  function msg(t) { const b = el('rkmsg'); if (b) { b.textContent = t || ''; b.hidden = !t; } }
  function drawMaps() {
    const box = el('rkmaps');
    box.innerHTML = '<button type="button" data-t=""' + (pickTheme === '' ? ' class="on"' : '') + '>Random</button>'
      + themes().map(id => '<button type="button" data-t="' + id + '"' + (pickTheme === id ? ' class="on"' : '') + '>'
        + esc(themeName(id).split(' ')[0]) + '</button>').join('');
  }
  function drawList() {
    const box = el('rkplayers');
    if (!box) return;
    el('rkme').textContent = (g.name() || 'You') + ' · ' + pts(myPoints) + ' pts';
    const others = players.filter(p => p.id !== myId);
    el('rkn').textContent = players.length ? players.length + ' online' : '';
    if (!alive) { box.innerHTML = (away || refusedWhy) ? '<p class="none">' + esc(away ? AWAY_TEXT : refusedWhy) + '</p>' : ''; return; }
    if (!others.length) {
      box.innerHTML = '<p class="none">Nobody else is playing right now. Stay here and they will show up in this list.</p>';
      return;
    }
    const busy = g.inBattle();
    // the ranked lobby first, then battles, then everybody else playing
    const rank = p => p.status === 'lobby' ? 0 : p.status === 'battle' ? 1 : 2;
    box.innerHTML = others.slice().sort((a, b) => rank(a) - rank(b)).map(p => {
      const fight = p.status === 'battle';
      const invited = sent && sent.to.id === p.id;
      const vs = fight ? players.find(q => q.id !== p.id && q.match === p.match) : null;
      const where = p.theme ? ' \u00b7 ' + esc(themeName(p.theme).split(' ')[0]) : '';
      const doing = fight ? 'battling' + (vs ? ' ' + esc(vs.name) : '') + where
        : p.status === 'lobby' ? 'in the ranked lobby'
        : p.status === 'solo' ? 'racing, singleplayer' + where
        : p.status === 'tt' ? 'time trial' + where
        : p.status === 'multi' ? 'in multiplayer' + where
        : p.status === 'replay' ? 'watching a replay'
        : p.status === 'watch' ? 'watching a battle'
        : 'on the menu';
      const canWatch = fight || ['solo', 'tt', 'multi', 'replay'].indexOf(p.status) >= 0;
      return '<div class="r' + (fight ? ' fight' : '') + '"><span class="nm">' + esc(p.name)
        + '<small>' + pts(p.points) + ' pts \u00b7 ' + doing + '</small></span>'
        + '<span class="acts">'
        + (canWatch ? '<button type="button" data-watch="' + p.id + '">Watch</button>' : '')
        + (invited
          ? '<button type="button" class="go" data-cancel="' + sent.id + '">Cancel</button>'
          : '<button type="button" class="go" data-ask="' + p.id + '"' + (busy || sent ? ' disabled' : '') + '>Challenge</button>')
        + '</span></div>';
    }).join('');
  }
  // the count on the home button, straight from the list rather than waiting for the next poll
  function counted() {
    if (!g.counted) return;
    let ranked = 0;
    const fights = new Set();
    for (const p of players) { if (p.status === 'lobby' || p.status === 'battle') ranked++; if (p.match) fights.add(p.match); }
    g.counted({ players: players.length, ranked, battles: fights.size });
  }
  const pts = n => (Math.round((+n || 0) * 100) / 100).toFixed(2);

  function show(on) {
    open = !!on;
    el('rk').classList.toggle('on', open);
    el('rk').classList.toggle('over', open && g.started());
    report();
    if (open) {
      if (!(g.name() || '').trim()) { msg('Type a name on the title screen first, it is the name the other player sees.'); return; }
      msg(refusedWhy);
      drawMaps(); drawList();
      connect();
    }
  }
  // what this page is doing, for everybody else's list
  function report() {
    const st = open ? { mode: 'lobby', theme: null, round: gameSt.round } : gameSt;
    const key = st.mode + '|' + st.theme + '|' + st.round;
    if (!alive || key === sentSt) return;
    sentSt = key;
    send({ type: 'status', mode: st.mode, theme: st.theme, round: st.round });
  }
  // kept alive in the background too, where the animation loop is paused
  setInterval(() => { if (alive) send({ type: 'ping' }); }, 20000);

  /* Away. Five minutes without a key, a click or a touch and this page stops
     being online: the line closes, so it leaves everybody's list and the
     count. Never in the middle of a battle (leaving one is a forfeit) or while
     watching one, which is sitting still on purpose. The next key or click
     brings it straight back. */
  let awayAfter = 5 * 60 * 1000, lastInput = Date.now(), away = false;
  const AWAY_TEXT = 'You were away for 5 minutes, so you are not shown as online. Press a key or click to come back.';
  function poke() {
    lastInput = Date.now();
    if (!away) return;
    away = false;
    msg('');
    connect();
    drawList();
  }
  for (const t of ['keydown', 'pointerdown', 'touchstart', 'wheel']) addEventListener(t, poke, { capture: true, passive: true });
  function checkAway() {
    if (away || Date.now() - lastInput < awayAfter || g.inBattle() || g.watching()) return;
    away = true;
    clearTimeout(retry); retry = null;
    sent = null;
    if (ws) { try { ws.close(); } catch (e) {} }
    msg(AWAY_TEXT);
    drawList();
  }
  setInterval(checkAway, 5000);

  el('rkmaps').addEventListener('click', e => {
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    pickTheme = b.dataset.t;
    drawMaps();
  });
  el('rkplayers').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.ask) send({ type: 'invite', to: +b.dataset.ask, theme: pickTheme || null });
    else if (b.dataset.cancel) { send({ type: 'cancel', id: +b.dataset.cancel }); sent = null; msg(''); drawList(); }
    else if (b.dataset.watch) send({ type: 'watch', pid: +b.dataset.watch });
  });
  el('rkback').addEventListener('click', () => {
    if (g.started()) { g.home(); return; }
    show(false);
  });

  /* ---- invites: over whatever is on the screen, in a battle too ---- */
  function drawInvites() {
    const box = el('rkinv');
    const list = [...invites.values()];
    box.classList.toggle('on', list.length > 0);
    box.innerHTML = list.map(m =>
      '<div class="inv" data-id="' + m.id + '"><p><b>' + esc(m.from.name) + '</b> (' + pts(m.from.points) + ' pts) challenges you'
      + ' · ' + (m.theme ? esc(themeName(m.theme)) : 'random track') + '</p>'
      + (g.inBattle() ? '<p class="warn">Accepting ends the battle you are in as a loss.</p>'
        : g.racing() ? '<p class="warn">Accepting leaves the race you are in.</p>' : '')
      + '<div class="btns"><button type="button" class="go" data-yes="' + m.id + '">Accept</button>'
      + '<button type="button" data-no="' + m.id + '">Decline</button></div>'
      + '<i style="animation-duration:' + Math.max(1, 30 - (Date.now() - (m.at || Date.now())) / 1000) + 's"></i></div>').join('');
  }
  el('rkinv').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = +(b.dataset.yes || b.dataset.no);
    invites.delete(id);
    drawInvites();
    send({ type: 'reply', id, accept: !!b.dataset.yes });
  });

  return {
    show,
    get open() { return open; },
    get alive() { return alive; },
    get id() { return myId; },
    get name() { return myName; },
    tick() {},
    // the page is up: on the list from now on, if there is a name to be on it under
    presence() { connect(); },
    get away() { return away; },
    // for a test: how long counts as away, and a clock that has already run
    setAway(ms, idleFor) { awayAfter = ms; if (idleFor !== undefined) lastInput = Date.now() - idleFor; checkAway(); },
    // the name was changed on the title screen: come back under the new one
    rename() {
      const n = (g.name() || '').trim();
      if (n === wantName || g.inBattle()) return;
      refusedWhy = '';
      if (ws) { try { ws.close(); } catch (e) {} } else connect();
    },
    status(st) { gameSt = st; report(); },
    msg,
    send,
    pos(o) { send(Object.assign({ type: 'pos' }, o)); },
    restart() { send({ type: 'restart' }); },
    finish(t) { send({ type: 'finish', time: t }); },
    forfeit() { send({ type: 'forfeit' }); },
    unwatch() { send({ type: 'unwatch' }); },
    redraw() { drawList(); drawInvites(); },
  };
}
