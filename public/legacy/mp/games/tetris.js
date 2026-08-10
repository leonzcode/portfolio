/* ===========================================================================
   Tetris — online adapter.

   Reuses the game's own two-board mode: board 1 is yours, board 2 becomes a
   live view of your opponent. Their falling piece, their stack, their line
   clears, all redrawn from state on the wire.

   Clearing two or more lines already sends garbage to "the other player"
   locally. Online, the other player is on another machine, so that call is
   redirected into a network event and applied on their side.
   =========================================================================== */

(function () {
  'use strict';

  var COLS = 10, ROWS = 20;
  var VACANT_HEX = '#111';
  var GARBAGE_HEX = '#555';
  // Index 0 is empty, 1-7 are the tetromino colours, 8 is garbage. Encoding the
  // board as one 200-character string keeps a full snapshot near 250 bytes.
  var PALETTE = [VACANT_HEX, '#e55', '#5e5', '#ee5', '#55f', '#a5f', '#5ee', '#fa5', GARBAGE_HEX];
  var INDEX = {};
  PALETTE.forEach(function (hex, i) { INDEX[hex] = i; });

  var mp = null;
  var online = false;
  var me = null;
  var mirror = null;
  var iAmDead = false;
  var settled = false;
  var lastSent = '';
  var sinceForced = 0;

  // --- encoding ------------------------------------------------------------

  function encodeBoard(board) {
    var out = '';
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var v = INDEX[board[r][c]];
        out += (v == null ? 0 : v);
      }
    }
    return out;
  }

  function decodeBoard(str) {
    var board = [];
    for (var r = 0; r < ROWS; r++) {
      var row = [];
      for (var c = 0; c < COLS; c++) {
        row.push(PALETTE[Number(str[r * COLS + c]) || 0]);
      }
      board.push(row);
    }
    return board;
  }

  function encodePiece(piece) {
    if (!piece || !piece.active) return null;
    var m = '';
    for (var r = 0; r < piece.active.length; r++) {
      for (var c = 0; c < piece.active[r].length; c++) m += piece.active[r][c] ? 1 : 0;
    }
    return { x: piece.x, y: piece.y, w: piece.active[0].length, m: m, c: INDEX[piece.color] || 1 };
  }

  // --- mirror rendering ----------------------------------------------------

  function renderMirror(d) {
    if (!mirror || !d) return;
    mirror.board = decodeBoard(d.b);
    mirror.drawBoard();
    if (d.p) {
      var color = PALETTE[d.p.c] || '#fff';
      var w = d.p.w;
      for (var i = 0; i < d.p.m.length; i++) {
        if (d.p.m[i] === '1') {
          var r = Math.floor(i / w);
          var c = i % w;
          var y = d.p.y + r;
          if (y >= 0) mirror.drawSquare(d.p.x + c, y, color);
        }
      }
    }
    mirror.score = d.s;
    mirror.lines = d.l;
    mirror.level = d.v;
    mirror.updateDisplay();
  }

  // --- session -------------------------------------------------------------

  function beginOnline() {
    online = true;
    iAmDead = false;
    settled = false;
    lastSent = '';

    startMulti();
    var ps = MultiPlayerGame.getPlayers();
    me = ps[0];
    mirror = ps[1];

    // Both players pull tetrominoes from the same seeded stream, so a loss is
    // about how you stacked, not which pieces you happened to get.
    me.getRandomIdx = seededIdx;

    // A double line clear tells "the other player" to take garbage. Online that
    // player isn't in this browser, so the call becomes a message.
    mirror.addGarbage = function (n) {
      mp.event('garbage', { n: n });
    };

    // The mirror is a view, not a game. Nothing local may advance it.
    ['moveLeft', 'moveRight', 'moveDown', 'rotate', 'hardDrop', 'lock',
      'drop', 'startDrop', 'spawnPiece', 'die', 'reset'].forEach(function (k) {
      mirror[k] = function () {};
    });
    mirror.stopDrop();

    // Your own death ends the match for both sides through the result banner,
    // not through the game's local "Player 2 Wins" overlay.
    me.die = function () {
      if (this.dead) return;
      this.dead = true;
      this.stopDrop();
      iAmDead = true;
      pushState(true);
      mp.event('dead', { s: this.score, l: this.lines });
      finish(false);
    };

    // Re-roll the opening now that the piece source is seeded.
    me.reset();
    relabel();
    pushState(true);
  }

  function seededIdx() {
    var rng = (mp && mp.rng) || Math.random;
    var r;
    do { r = Math.floor(rng() * 7); } while (r === this.lastIdx);
    this.lastIdx = r;
    return r;
  }

  function relabel() {
    var foe = mp.opponent();
    var mine = document.querySelector('.p1-label');
    var theirs = document.querySelector('.p2-label');
    if (mine) mine.textContent = 'You';
    if (theirs) theirs.textContent = foe ? foe.name : 'Waiting…';
  }

  function finish(win) {
    if (settled) return;
    settled = true;
    var foe = mp.opponent();
    mp.showResult({
      win: win,
      title: win ? 'You win' : 'You lose',
      note: win
        ? (foe ? foe.name : 'Your opponent') + ' topped out. You cleared ' + me.lines + ' lines for ' + me.score + '.'
        : 'You topped out on ' + me.lines + ' lines for ' + me.score + '.',
      onAgain: function () {
        beginOnline();
        mp.event('again', {});
      },
    });
  }

  function pushState(force) {
    if (!online || !me || !me.board) return;
    var payload = {
      b: encodeBoard(me.board),
      p: me.dead ? null : encodePiece(me.piece),
      s: me.score,
      l: me.lines,
      v: me.level,
      d: me.dead ? 1 : 0,
    };
    var key = JSON.stringify(payload);
    sinceForced++;
    if (!force && key === lastSent && sinceForced < 20) return;
    sinceForced = 0;
    lastSent = key;
    mp.send(payload);
    mp.setScore(mp.id, me.lines + 'L');
  }

  // --- wiring --------------------------------------------------------------

  function boot() {
    MP.style(
      '@media (min-width: 721px) { html.mp-online .multi-area { padding-right: 280px; } }' +
      // Pausing or restarting mid-race would only desync the two boards.
      'html.mp-online #mp-pause, html.mp-online #mp-restart { display: none; }'
    );

    mp = MP.create({
      game: 'tetris',
      title: 'Tetris',
      modes: ['versus'],
      versusTitle: 'Head to head',
      versusNote: 'Same pieces, two stacks. Clear two lines at once to send garbage.',
      emotes: ['Nice clear', 'Take that', 'Too fast', 'gg'],

      onStart: beginOnline,

      onState: function (id, d) {
        if (!online) return;
        renderMirror(d);
        mp.setScore(id, d.l + 'L');
        if (d.d && !settled) finish(true);
      },

      onEvent: function (id, kind, data) {
        if (!online) return;
        if (kind === 'garbage' && me && !me.dead) {
          me.addGarbage(Math.max(1, Math.min(4, (data && data.n) || 1)));
          mp.toast('+' + ((data && data.n) || 1) + ' garbage', 1400);
          pushState(true);
        } else if (kind === 'dead') {
          finish(true);
        } else if (kind === 'again') {
          beginOnline();
        }
      },

      onJoin: relabel,
      onLeave: function () {
        if (online) mp.toast('Your opponent left');
        relabel();
      },

      onStop: function () {
        online = false;
        me = null;
        mirror = null;
        showMenu();
      },
    });

    var menu = document.getElementById('menu');
    if (menu) {
      var btn = document.createElement('button');
      btn.className = 'mode-btn';
      btn.textContent = 'Online';
      btn.addEventListener('click', function () { mp.openLobby(); });
      menu.appendChild(btn);
    }

    // Online, both key sets drive your board. Capture phase runs before the
    // game's own document listener, so its two-keyboard routing never sees these.
    window.addEventListener('keydown', function (e) {
      if (!online || !me || me.dead) return;
      var key = e.key;
      var lower = key.toLowerCase();
      var acted = true;
      if (key === 'ArrowLeft' || lower === 'a') me.moveLeft();
      else if (key === 'ArrowRight' || lower === 'd') me.moveRight();
      else if (key === 'ArrowDown' || lower === 's') me.moveDown();
      else if (key === 'ArrowUp' || lower === 'w') me.rotate();
      else if (key === ' ' || lower === 'q') me.hardDrop();
      else acted = false;
      if (!acted) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pushState();
    }, true);

    // Leaving via the game's own Menu button should also leave the room.
    var menuBtn = document.getElementById('mp-menu');
    if (menuBtn) {
      menuBtn.addEventListener('click', function () {
        if (online) mp.leave();
      }, true);
    }

    // The piece also falls on a timer, so poll for changes the key handler
    // didn't cause. pushState is a no-op when nothing moved.
    setInterval(pushState, 90);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
