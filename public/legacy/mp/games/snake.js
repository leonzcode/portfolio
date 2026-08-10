/* ===========================================================================
   Snake — online adapter.

   Two snakes, two boards, one food sequence. The food positions come from the
   shared match seed, so you are both eating the same apples in the same order
   and a win is about who survives their own tail. Their board is redrawn live
   in the opponent panel, so you can watch them box themselves in.
   =========================================================================== */

(function () {
  'use strict';

  var mp = null;
  var panel = null;
  var online = false;
  var iAmDead = false;
  var settled = false;
  var deadFoes = {};
  var lastSent = '';
  var sinceForced = 0;

  function beginOnline() {
    online = true;
    iAmDead = false;
    settled = false;
    deadFoes = {};
    lastSent = '';

    // Same apples, same order, for everyone in the match.
    var rng = MP.rngFrom(mp.seed || 1);
    window.randomFood = function () {
      var cols = canvas.width / 20;
      var rows = canvas.height / 20;
      return {
        x: Math.floor(rng() * cols) * 20,
        y: Math.floor(rng() * rows) * 20,
      };
    };

    startOverlay.style.display = 'none';
    gameOverOverlay.style.display = 'none';
    clearInterval(game);
    resetGame();
    game = setInterval(drawGame, 100);

    panel.show();
    panel.note('');
    mp.setScore(mp.id, 0);
    pushState(true);
  }

  function endOnline() {
    online = false;
    window.randomFood = realRandomFood;
    clearInterval(game);
    if (panel) panel.hide();
    startOverlay.style.display = 'flex';
  }

  var realRandomFood = window.randomFood;

  function pushState(force) {
    if (!online || typeof snake === 'undefined' || !snake) return;
    var payload = {
      // Flat [x,y,x,y,...] in grid cells: a 40-segment snake is under 100 bytes.
      s: snake.map(function (seg) { return [seg.x / 20, seg.y / 20]; }),
      f: food ? [food.x / 20, food.y / 20] : null,
      p: score,
      d: iAmDead ? 1 : 0,
    };
    var key = JSON.stringify(payload);
    sinceForced++;
    if (!force && key === lastSent && sinceForced < 20) return;
    sinceForced = 0;
    lastSent = key;
    mp.send(payload);
    mp.setScore(mp.id, score);
  }

  function finish() {
    if (settled || !online || !iAmDead) return;
    var others = mp.otherPlayers();
    if (!others.length) return;
    if (!others.every(function (p) { return deadFoes[p.id]; })) return;
    settled = true;

    var best = null;
    others.forEach(function (p) {
      var d = deadFoes[p.id];
      if (d && (!best || d.score > best.score)) best = { name: p.name, score: d.score };
    });
    var win = !best || score > best.score;
    var tie = best && score === best.score;
    mp.showResult({
      win: win && !tie,
      title: tie ? 'Dead heat' : (win ? 'You win' : 'You lose'),
      note: 'You ate ' + score + (best ? '. ' + best.name + ' ate ' + best.score + '.' : '.'),
      onAgain: function () {
        beginOnline();
        mp.event('again', {});
      },
    });
  }

  function boot() {
    MP.style('@media (min-width: 721px) { html.mp-online body { padding-right: 260px; } }');

    mp = MP.create({
      game: 'snake',
      title: 'Snake',
      modes: ['versus'],
      versusTitle: 'Head to head',
      versusNote: 'Same apples in the same order. Outlast them.',
      emotes: ['Nice', 'So close', 'Watch your tail', 'gg'],

      onStart: beginOnline,

      onState: function (id, d) {
        if (d) mp.setScore(id, d.p);
        if (d && d.d && !deadFoes[id]) {
          deadFoes[id] = { score: d.p };
          finish();
        }
      },

      onEvent: function (id, kind, data, p) {
        if (!online) return;
        if (kind === 'dead') {
          deadFoes[id] = { score: (data && data.score) || 0 };
          mp.toast((p ? p.name : 'Your opponent') + ' crashed on ' + ((data && data.score) || 0));
          finish();
        } else if (kind === 'again') {
          beginOnline();
        }
      },

      onLeave: function (id) { delete deadFoes[id]; },
      onStop: endOnline,
    });

    panel = mp.versusPanel({
      label: 'Their board',
      width: 160,
      height: 160,
      draw: function (c, s, info) {
        var cell = info.width / 20; // the real board is a 20x20 grid
        c.fillStyle = '#000';
        c.fillRect(0, 0, info.width, info.height);
        if (s.f) {
          c.fillStyle = '#e5484d';
          c.fillRect(s.f[0] * cell, s.f[1] * cell, cell, cell);
        }
        (s.s || []).forEach(function (seg, i) {
          c.fillStyle = i === 0 ? info.player.color : 'rgba(255,255,255,0.45)';
          c.fillRect(seg[0] * cell, seg[1] * cell, cell - 0.5, cell - 0.5);
        });
        if (s.d) {
          c.fillStyle = 'rgba(0,0,0,0.6)';
          c.fillRect(0, 0, info.width, info.height);
          c.fillStyle = '#fff';
          c.font = '600 13px system-ui, sans-serif';
          c.textAlign = 'center';
          c.fillText('crashed', info.width / 2, info.height / 2 + 4);
        }
      },
    });

    var btn = document.createElement('button');
    btn.textContent = 'Play Online';
    btn.style.marginTop = '10px';
    btn.addEventListener('click', function () { mp.openLobby(); });
    startOverlay.appendChild(btn);

    // Every tick: repaint their board, ship yours, and notice if you died.
    var realDrawGame = window.drawGame;
    window.drawGame = function () {
      realDrawGame.apply(this, arguments);
      if (!online) return;
      panel.paint();
      var foe = mp.opponent();
      panel.stats(foe ? ['score ' + (mp.stateOf(foe.id) ? mp.stateOf(foe.id).p : 0)] : []);
      if (!iAmDead && gameOverOverlay.style.display === 'flex') {
        iAmDead = true;
        gameOverOverlay.style.display = 'none';
        mp.event('dead', { score: score });
        pushState(true);
        var alive = mp.otherPlayers().filter(function (p) { return !deadFoes[p.id]; });
        if (alive.length) mp.toast('You crashed on ' + score + '. Watching…', 3500);
        finish();
      } else if (!iAmDead) {
        pushState();
      }
    };

    // Keep the opponent's board updating after you're out.
    setInterval(function () {
      if (online && iAmDead && panel) panel.paint();
    }, 120);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
