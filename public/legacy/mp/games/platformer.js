/* ===========================================================================
   Leon's Platformer — online adapter.

   Both runners take the identical course (platRand is swapped for a seeded
   generator, so platform N is the same platform for everyone), and your
   opponent is drawn as a ghost cube on your screen. Because the world scrolls
   at the same rate for both of you, the gap in score IS the gap in metres, so
   the ghost sits exactly where they are relative to you: ahead, behind, or
   neck and neck. When they hit a spike, you see it happen.
   =========================================================================== */

(function () {
  'use strict';

  var mp = null;
  var online = false;
  var iAmDead = false;
  var settled = false;
  var deadRemotes = {};
  var startScore = 0;

  // --- ghosts --------------------------------------------------------------

  function drawGhosts() {
    if (!online || !ctx || !player) return;
    var remotes = mp.remotes();
    for (var i = 0; i < remotes.length; i++) {
      var p = remotes[i].player;
      var s = remotes[i].state;
      if (!s || typeof s.x !== 'number') continue;

      // Their world position minus yours, in the same pixel units the
      // platforms scroll by.
      var dx = s.x - score;
      var sx = player.x + dx;
      var sy = s.yf * canvas.height;

      var offLeft = sx + player.width < 0;
      var offRight = sx > canvas.width;
      var dead = deadRemotes[p.id];

      if (offLeft || offRight) {
        drawEdgeMarker(p, offRight, sy, dx);
        mp.placeBubble(p.id, null, null);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = dead ? 0.28 : 0.55;
      ctx.translate(sx + player.width / 2, sy + player.height / 2);
      ctx.rotate((s.dy || 0) * 0.03);
      roundedRect(ctx, -player.width / 2, -player.height / 2, player.width, player.height, 10, p.color);
      ctx.globalAlpha = dead ? 0.35 : 0.9;
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(-player.width / 2 + player.width * 0.7, -player.height / 2 + player.height * 0.3, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Name tag, and a cross when they're out.
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      var tag = dead ? p.name + ' — out' : p.name;
      var w = ctx.measureText(tag).width + 12;
      roundedRect(ctx, sx + player.width / 2 - w / 2, sy - 24, w, 17, 8, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = dead ? '#ffb4b6' : '#fff';
      ctx.fillText(tag, sx + player.width / 2, sy - 11);
      ctx.restore();

      mp.placeBubble(p.id, sx + player.width / 2, sy - 30);
    }
  }

  // An arrow at the screen edge when they're out of view, so you always know
  // whether you're winning.
  function drawEdgeMarker(p, right, sy, dx) {
    var x = right ? canvas.width - 26 : 26;
    var y = Math.max(30, Math.min(canvas.height - 30, sy));
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    if (right) {
      ctx.moveTo(x + 10, y); ctx.lineTo(x - 6, y - 9); ctx.lineTo(x - 6, y + 9);
    } else {
      ctx.moveTo(x - 10, y); ctx.lineTo(x + 6, y - 9); ctx.lineTo(x + 6, y + 9);
    }
    ctx.closePath();
    ctx.fill();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(Math.round(Math.abs(dx) / 10) + 'm', x, y + 26);
    ctx.restore();
  }

  function roundedRect(c, x, y, w, h, r, color) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
    c.fillStyle = color;
    c.fill();
  }

  // --- session -------------------------------------------------------------

  function beginOnline() {
    online = true;
    iAmDead = false;
    settled = false;
    deadRemotes = {};
    startScore = 0;

    // Same seed, same platforms, same spikes, in the same order.
    var rng = MP.rngFrom(mp.seed || 1);
    platRand = rng;

    mp.hideResult();
    initGame();
    mp.setScore(mp.id, '0m');
  }

  function endOnline() {
    online = false;
    platRand = Math.random;
  }

  function finish() {
    if (settled || !online) return;
    var others = mp.otherPlayers();
    // The match is over once everyone has come off the course.
    var allOut = others.every(function (p) { return deadRemotes[p.id]; });
    if (!iAmDead || !allOut || !others.length) return;
    settled = true;

    var mine = Math.floor(score / 10);
    var best = null;
    others.forEach(function (p) {
      var d = deadRemotes[p.id];
      if (d && (!best || d.score > best.score)) best = { name: p.name, score: d.score };
    });
    var win = !best || mine > best.score;
    mp.showResult({
      win: win,
      title: win ? 'You win' : (best && mine === best.score ? 'Dead heat' : 'You lose'),
      note: 'You reached ' + mine + 'm' + (best ? '. ' + best.name + ' reached ' + best.score + 'm.' : '.'),
      onAgain: function () {
        beginOnline();
        mp.event('again', {});
      },
    });
  }

  // --- wiring --------------------------------------------------------------

  function boot() {
    MP.style(
      // The game parks its own score chips top-right, where the rail goes.
      '@media (min-width: 721px) {' +
      '  html.mp-online #score { right: 292px; }' +
      '  html.mp-online #highScore { right: 292px; }' +
      '  html.mp-online #menuBtn { right: 292px; }' +
      '}'
    );

    mp = MP.create({
      game: 'platformer',
      title: "Leon's Platformer",
      modes: ['versus'],
      versusTitle: 'Head to head',
      versusNote: 'Same course, same spikes. Last one running wins.',
      emotes: ['Catch me', 'Nice jump', 'That spike…', 'gg'],
      launchStyle: { top: '110px' },

      onStart: beginOnline,

      onEvent: function (id, kind, data, p) {
        if (!online) return;
        if (kind === 'death') {
          deadRemotes[id] = { score: (data && data.score) || 0 };
          mp.toast((p ? p.name : 'Your opponent') + ' went out at ' + ((data && data.score) || 0) + 'm');
          finish();
        } else if (kind === 'again') {
          beginOnline();
        }
      },

      onState: function (id, d) {
        if (d && typeof d.x === 'number') mp.setScore(id, Math.floor(d.x / 10) + 'm');
      },

      onLeave: function (id) {
        delete deadRemotes[id];
      },

      onStop: endOnline,
    });

    // Draw the opponents right after your own cube, and push your position on
    // the same frame. gameLoop calls drawPlayer() once per frame, which makes
    // it the natural place to hang both.
    var realDrawPlayer = window.drawPlayer;
    window.drawPlayer = function () {
      realDrawPlayer.apply(this, arguments);
      if (!online) return;
      drawGhosts();
      if (!iAmDead) {
        mp.send({
          x: score,
          yf: player.y / canvas.height,
          dy: player.dy,
        });
        mp.setScore(mp.id, Math.floor(score / 10) + 'm');
      }
    };

    // Dying online reports the run instead of just opening the local menu.
    var realEndGame = window.endGame;
    window.endGame = function () {
      var wasRunning = gameRunning;
      realEndGame.apply(this, arguments);
      if (!online || !wasRunning || iAmDead) return;
      iAmDead = true;
      var mine = Math.floor(score / 10);
      mp.event('death', { score: mine });
      // The game's own Game Over card would offer a solo restart, which would
      // drop you out of the match.
      var box = document.getElementById('gameOver');
      if (box) box.style.display = 'none';
      var others = mp.otherPlayers();
      var stillUp = others.filter(function (p) { return !deadRemotes[p.id]; });
      if (stillUp.length) {
        mp.toast('You went out at ' + mine + 'm. Watching ' +
          stillUp.map(function (p) { return p.name; }).join(', ') + '…', 4000);
      }
      finish();
    };

    // Keep watching after you're out: the loop stops on death, so redraw the
    // course from the last frame and keep the ghosts moving.
    setInterval(function () {
      if (!online || !iAmDead || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground();
      for (var i = 0; i < platforms.length; i++) drawPlatform(platforms[i]);
      drawGhosts();
    }, 1000 / 30);

    var menuBtn = document.getElementById('menuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', function () {
        if (online) mp.leave();
      }, true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
