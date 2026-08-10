/* ===========================================================================
   Pong — online adapter.

   Real net play rather than mirrored boards: one shared ball, one paddle each.
   Somebody has to own the ball or the two screens disagree about who scored,
   so the player whose id sorts first simulates it and broadcasts; the other
   renders what arrives and sends back only their paddle. Both sides keep their
   own paddle locally, so your own input never feels laggy.

   Left paddle (green) is the host, right paddle (red) is the guest. First to 7.
   =========================================================================== */

(function () {
  'use strict';

  var TARGET = 7;

  var mp = null;
  var online = false;
  var host = false;
  var settled = false;
  var myPaddle = null;
  var foePaddle = null;

  function pickHost() {
    var ids = Object.keys(mp.players);
    if (!ids.length) return true;
    ids.sort();
    return ids[0] === mp.id;
  }

  function beginOnline() {
    online = true;
    settled = false;
    host = pickHost();

    myPaddle = host ? player1 : bot;
    foePaddle = host ? bot : player1;

    player1Score = 0;
    botScore = 0;
    player1.y = canvas.height / 2 - 40;
    bot.y = canvas.height / 2 - 40;
    if (host) resetBall();

    updateScoreboard();
    mp.hideResult();
    mp.setScore(mp.id, 0);
  }

  function endOnline() {
    online = false;
    myPaddle = null;
    foePaddle = null;
  }

  function updateScoreboard() {
    var foe = mp.opponent();
    var mine = host ? player1Score : botScore;
    var theirs = host ? botScore : player1Score;
    var el = document.getElementById('score');
    if (el) el.innerText = 'You: ' + mine + ' | ' + (foe ? foe.name : 'Opponent') + ': ' + theirs;
    mp.setScore(mp.id, mine);
    if (foe) mp.setScore(foe.id, theirs);
  }

  function checkWin() {
    if (settled || !online) return;
    if (player1Score < TARGET && botScore < TARGET) return;
    settled = true;
    var mine = host ? player1Score : botScore;
    var theirs = host ? botScore : player1Score;
    var foe = mp.opponent();
    mp.showResult({
      win: mine > theirs,
      title: mine > theirs ? 'You win' : 'You lose',
      note: mine + ' - ' + theirs + ' against ' + (foe ? foe.name : 'your opponent') + '.',
      onAgain: function () {
        beginOnline();
        mp.event('again', {});
      },
    });
  }

  function boot() {
    MP.style('@media (min-width: 721px) { html.mp-online #score { position: fixed; left: 20px; top: 20px; } }');

    mp = MP.create({
      game: 'pong',
      title: 'Pong',
      modes: ['versus'],
      versusTitle: 'Head to head',
      versusNote: 'One ball, one paddle each. First to ' + TARGET + '.',
      emotes: ['Nice shot', 'Lucky', 'Wall', 'gg'],
      launchStyle: { top: '64px' },

      onStart: beginOnline,

      onState: function (id, d) {
        if (!online || !d) return;
        // The guest takes the ball and the score from the host; the host takes
        // only the guest's paddle.
        if (!host && typeof d.bx === 'number') {
          ball.x = d.bx;
          ball.y = d.by;
          if (player1Score !== d.s1 || botScore !== d.s2) {
            player1Score = d.s1;
            botScore = d.s2;
            updateScoreboard();
            checkWin();
          }
          var smash = document.getElementById('smash');
          if (smash) smash.style.display = d.sm ? 'block' : 'none';
        }
      },

      onEvent: function (id, kind) {
        if (kind === 'again' && online) beginOnline();
      },

      onJoin: updateScoreboard,
      onStop: endOnline,
    });

    // Your keys drive your own paddle, whichever side you're on.
    var realMovePlayer = window.movePlayer;
    window.movePlayer = function () {
      if (!online) return realMovePlayer.apply(this, arguments);
      if (!myPaddle) return;
      if (keys.w || keys.ArrowUp) myPaddle.y -= paddleSpeed;
      if (keys.s || keys.ArrowDown) myPaddle.y += paddleSpeed;
      myPaddle.y = Math.max(0, Math.min(canvas.height - 80, myPaddle.y));
    };

    // No AI online: that paddle is a person, interpolated between packets.
    var realMoveBot = window.moveBot;
    window.moveBot = function () {
      if (!online) return realMoveBot.apply(this, arguments);
      var foe = mp.opponent();
      if (!foe || !foePaddle) return;
      var s = mp.smooth(foe.id);
      if (s && typeof s.py === 'number') foePaddle.y = s.py;
    };

    // Only the host advances the ball. Everyone sends their paddle every frame.
    var realUpdateBall = window.updateBall;
    window.updateBall = function () {
      if (!online) return realUpdateBall.apply(this, arguments);
      if (host) {
        realUpdateBall.apply(this, arguments);
        var smash = document.getElementById('smash');
        mp.send({
          py: player1.y,
          bx: ball.x,
          by: ball.y,
          s1: player1Score,
          s2: botScore,
          sm: smash && smash.style.display === 'block' ? 1 : 0,
        });
        updateScoreboard();
        checkWin();
      } else {
        mp.send({ py: bot.y });
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
