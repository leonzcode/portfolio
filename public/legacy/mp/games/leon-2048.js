/* ===========================================================================
   LEON 2048 — online adapter.

   The game already ships a local two-player mode where making LEON drops a
   grey BLOCK on the other board. Online play is that same mode with the second
   board driven over the wire: you own board 0, board 1 is a live mirror of
   your opponent, and the BLOCK attack becomes a network event.

   The game declares `Player`, `players`, `mode` and friends at the top level of
   a classic script, so this file can reach them by name. Nothing in the game's
   own logic is edited; the mirror board is neutered by overriding methods on
   that one instance.
   =========================================================================== */

(function () {
  'use strict';

  var mp = null;
  var online = false;
  var mirror = null;      // players[1], the opponent's board
  var me = null;          // players[0], yours
  var lastSent = '';
  var opponentDead = false;
  var iAmDead = false;
  var settled = false;
  var pendingRemote = null;
  var sinceForced = 0;

  // --- serialising a board -------------------------------------------------
  // Tile ids travel with the grid so the mirror can move the same element
  // instead of rebuilding it, which is what makes the opponent's slides read
  // as moves rather than as a slideshow.

  function packGrid(player) {
    var out = [];
    for (var r = 0; r < 4; r++) {
      var row = [];
      for (var c = 0; c < 4; c++) {
        var t = player.grid && player.grid[r] ? player.grid[r][c] : null;
        row.push(t ? [t.id, t.value] : 0);
      }
      out.push(row);
    }
    return out;
  }

  function applyRemote(player, packed, score, leons) {
    if (!player || !packed) return;
    // The mirror's grid only exists once the game's own reset() has run on the
    // next animation frame. Opponent state can beat that, so hold the newest
    // snapshot and replay it when the board is ready.
    if (!player.grid) {
      pendingRemote = { g: packed, s: score, l: leons };
      return;
    }
    var seen = {};
    var r, c;

    for (r = 0; r < 4; r++) {
      for (c = 0; c < 4; c++) {
        var cell = packed[r][c];
        if (!cell) {
          player.grid[r][c] = null;
          continue;
        }
        var id = cell[0];
        var value = cell[1];
        seen[id] = true;
        player.grid[r][c] = { id: id, value: value };

        var el = player.tileEls[id];
        if (!el) {
          el = player.createTileEl({ id: id, value: value }, r, c);
          el.classList.add('tile-new');
          if (value === 'BLOCK') el.textContent = 'LEON';
        } else {
          if (el.textContent !== value && value !== 'BLOCK') {
            el.textContent = value;
            el.className = 'tile tile-' + value;
            el.style.fontSize = player.fsize(value) + 'px';
          }
          var tx = player.posL(c) + 'px';
          var ty = player.posT(r) + 'px';
          el.style.setProperty('--tx', tx);
          el.style.setProperty('--ty', ty);
          el.style.transform = 'translate(' + tx + ',' + ty + ')';
        }
      }
    }

    for (var key in player.tileEls) {
      if (!seen[key]) {
        player.tileEls[key].remove();
        delete player.tileEls[key];
      }
    }

    player.score = score;
    player.leonCount = leons;
    player.updateDisplay();
  }

  // --- online session ------------------------------------------------------

  function beginOnline() {
    online = true;
    opponentDead = false;
    iAmDead = false;
    settled = false;
    lastSent = '';

    startGame(2);
    me = players[0];
    mirror = players[1];

    // Your tiles come from the match seed instead of Math.random, so both
    // players open on the same position and draw from the same letter stream.
    me.spawn = seededSpawn;

    // The game resets both boards on the next animation frame. Make that reset
    // run exactly once per round, whoever gets there first: if the tab is in the
    // background its rAF is frozen and the fallback below has to do the job.
    me.__mpReset = false;
    mirror.__mpReset = false;
    me.reset = mirror.reset = function () {
      if (this.__mpReset) return;
      this.__mpReset = true;
      Player.prototype.reset.call(this);
    };

    // The mirror is a display surface, not a player: it must never simulate.
    mirror.move = function () {};
    mirror.isGameOver = function () { return false; };
    mirror.spawn = function () {};
    // A LEON merge on your board asks the game to block "the opponent". Online,
    // that opponent lives on another machine, so the call becomes a message.
    mirror.placeBlock = function () {
      mp.event('block', {});
    };

    // Timer, not rAF: a background tab freezes rAF and the match would never
    // lay out its boards.
    setTimeout(function () {
      if (me) me.reset();
      if (mirror) mirror.reset();
      relabel();
      if (pendingRemote && mirror && mirror.grid) {
        applyRemote(mirror, pendingRemote.g, pendingRemote.s, pendingRemote.l);
        pendingRemote = null;
      }
      pushState(true);
    }, 60);
  }

  /** The game's spawn(), drawing from the shared match seed instead of Math.random. */
  function seededSpawn() {
    var rng = (mp && mp.rng) || Math.random;
    var empty = [];
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) if (!this.grid[r][c]) empty.push({ r: r, c: c });
    }
    if (!empty.length) return;
    var cell = empty[Math.floor(rng() * empty.length)];
    var letters = ['L', 'E', 'O', 'N'];
    var tile = { id: this.nextId++, value: letters[Math.floor(rng() * 4)] };
    this.grid[cell.r][cell.c] = tile;
    this.createTileEl(tile, cell.r, cell.c).classList.add('tile-new');
  }

  function relabel() {
    var foe = mp.opponent();
    var labels = document.querySelectorAll('.player-label');
    if (labels[0]) labels[0].innerHTML = 'You <span>(arrows or WASD)</span>';
    if (labels[1]) {
      labels[1].innerHTML = foe
        ? foe.name + ' <span>(online)</span>'
        : 'Waiting… <span>(online)</span>';
    }
    if (infoBar) {
      infoBar.innerHTML = 'Build <strong>LEON</strong> to drop a block on your opponent. ' +
        'Most LEONs when you both top out wins.';
    }
  }

  function endOnline() {
    online = false;
    mirror = null;
    me = null;
    if (typeof backToMenu === 'function') backToMenu();
  }

  // --- state ---------------------------------------------------------------

  function pushState(force) {
    if (!online || !me) return;
    var payload = {
      g: packGrid(me),
      s: me.score,
      l: me.leonCount,
      d: me.dead ? 1 : 0,
    };
    var key = JSON.stringify(payload);
    // Resend unchanged state every couple of seconds so a peer that joined or
    // recovered late still converges instead of showing a stale board forever.
    sinceForced++;
    if (!force && key === lastSent && sinceForced < 20) return;
    sinceForced = 0;
    lastSent = key;
    mp.send(payload);
    mp.setScore(mp.id, me.leonCount + ' LEON');
  }

  function judge() {
    if (settled || !online) return;
    if (!iAmDead || !opponentDead) return;
    settled = true;
    var foe = mp.opponent();
    var mine = me ? me.leonCount : 0;
    var theirs = mirror ? mirror.leonCount : 0;
    var myScore = me ? me.score : 0;
    var theirScore = mirror ? mirror.score : 0;
    var win = mine > theirs || (mine === theirs && myScore > theirScore);
    var tie = mine === theirs && myScore === theirScore;
    mp.showResult({
      win: win && !tie,
      title: tie ? 'Dead heat' : (win ? 'You win' : 'You lose'),
      note: 'You made ' + mine + ' LEON' + (mine === 1 ? '' : 's') + ' for ' + myScore +
        ' points. ' + (foe ? foe.name : 'They') + ' made ' + theirs + ' for ' + theirScore + '.',
      onAgain: function () {
        beginOnline();
        mp.event('again', {});
      },
    });
  }

  // --- wiring --------------------------------------------------------------

  function boot() {
    // Keep the opponent's board clear of the chat rail. Below 720px the rail
    // moves to the bottom of the screen, so the reserve only applies above that.
    MP.style(
      '@media (min-width: 721px) {' +
      '  html.mp-online .players-area { padding-right: 286px; }' +
      '  html.mp-online .top-bar { padding-right: 286px; }' +
      '}'
    );

    mp = MP.create({
      game: 'leon-2048',
      title: 'LEON 2048',
      modes: ['versus'],
      versusTitle: 'Head to head',
      versusNote: 'Race someone to LEON. Every LEON you build blocks their board.',
      emotes: ['Nice merge', 'Stop blocking me', 'Almost had it', 'gg'],

      onStart: function () {
        beginOnline();
      },

      onState: function (id, d) {
        if (!online || !mirror) return;
        applyRemote(mirror, d.g, d.s, d.l);
        mp.setScore(id, d.l + ' LEON');
        if (d.d && !opponentDead) {
          opponentDead = true;
          mirror.dead = true;
          mirror.boardEl.classList.add('dead');
          mp.toast((mp.opponent() ? mp.opponent().name : 'Your opponent') + ' topped out');
          judge();
        }
      },

      onEvent: function (id, kind) {
        if (!online) return;
        if (kind === 'block' && me && !me.dead) {
          Player.prototype.placeBlock.call(me);
          mp.toast('Blocked!', 1400);
        } else if (kind === 'again') {
          beginOnline();
        }
      },

      onJoin: relabel,
      onLeave: function () {
        if (online) mp.toast('Your opponent left');
        relabel();
      },

      onStop: endOnline,
    });

    // A native-looking entry point on the game's own menu, so online play
    // doesn't read as bolted on.
    var btns = document.querySelector('.mode-btns');
    if (btns) {
      var btn = document.createElement('button');
      btn.className = 'mode-btn';
      btn.textContent = 'Online';
      btn.addEventListener('click', function () {
        mp.openLobby();
      });
      btns.appendChild(btn);
    }

    // Online is a two-board layout, but only one of them is yours, so both key
    // sets drive board 0. Capture phase beats the game's own window handler.
    window.addEventListener('keydown', function (e) {
      if (!online || !me) return;
      var map = {
        ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
        w: 'up', a: 'left', s: 'down', d: 'right',
        W: 'up', A: 'left', S: 'down', D: 'right',
      };
      var dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      me.move(dir);
    }, true);

    // Same for swipes: every board maps to yours.
    document.addEventListener('touchend', function () {
      if (online) setTimeout(pushState, 60);
    }, { passive: true });

    // The game's own overlay would announce a local winner. Online, the result
    // banner does that job instead.
    var realCheck = window.checkGameEnd;
    window.checkGameEnd = function () {
      if (!online) return realCheck.apply(this, arguments);
      if (me && me.dead && !iAmDead) {
        iAmDead = true;
        pushState(true);
        mp.event('dead', { s: me.score, l: me.leonCount });
        if (!opponentDead) {
          mp.toast('You topped out. Waiting for your opponent…', 4000);
        }
        judge();
      }
    };

    // Board state changes land across a couple of animation frames, so a light
    // poll is both simpler and more reliable than hooking every mutation.
    // pushState is a no-op unless something actually changed.
    setInterval(pushState, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
