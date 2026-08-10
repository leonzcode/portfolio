/* ===========================================================================
   Neon Velocity — online adapter.

   A race, with your rival actually on the road. The track is drawn as a strip
   of projected segments, so a car at distance D belongs on the segment at that
   distance: take the segment the opponent is on, read the screen coordinates
   the renderer already computed for it this frame, and draw them there. They
   grow as you close on them and slide across the road as they steer.

   Both cars run the same track, so position is directly comparable and the gap
   readout is honest.
   =========================================================================== */

(function () {
  'use strict';

  var mp = null;
  var online = false;
  var iFinished = false;
  var settled = false;
  var finishers = {};
  var startedAt = 0;

  function loaded() {
    try {
      return typeof lines !== 'undefined' && typeof position !== 'undefined' &&
        typeof ctx !== 'undefined' && typeof SEGMENT_LENGTH !== 'undefined';
    } catch (e) {
      return false;
    }
  }

  function trackLength() {
    return lines.length * SEGMENT_LENGTH;
  }

  // --- ghost cars ----------------------------------------------------------

  function drawGhosts() {
    if (!online) return;
    var remotes = mp.remotes();
    var myLen = trackLength();
    for (var i = 0; i < remotes.length; i++) {
      var p = remotes[i].player;
      var s = remotes[i].state;
      if (!s || typeof s.p !== 'number') continue;

      var ahead = s.p - position;
      // Only cars in front of you and inside the draw distance can be on screen.
      if (ahead < SEGMENT_LENGTH || ahead > DRAW_DISTANCE * SEGMENT_LENGTH * 0.85) {
        mp.placeBubble(p.id, null, null);
        continue;
      }
      var idx = Math.floor(s.p / SEGMENT_LENGTH) % lines.length;
      var line = lines[idx];
      if (!line || !line.screen || !line.screen.w || line.screen.w <= 0) continue;
      if (line.screen.y < 0 || line.screen.y > height) continue;

      var w = line.screen.w * 0.62;                       // car ~62% of a lane pair
      var h = w * 0.5;
      var cx = line.screen.x + line.screen.w * (s.x || 0);
      var cy = line.screen.y - h * 0.35;

      ctx.save();
      ctx.globalAlpha = 0.92;

      // Body
      ctx.fillStyle = p.color;
      roundRect(ctx, cx - w / 2, cy - h / 2, w, h, Math.max(2, w * 0.12));
      ctx.fill();

      // Cabin + lights, so it reads as a car and not a coloured box.
      ctx.fillStyle = 'rgba(10,16,28,0.75)';
      roundRect(ctx, cx - w * 0.28, cy - h * 0.34, w * 0.56, h * 0.42, Math.max(1, w * 0.07));
      ctx.fill();
      ctx.fillStyle = '#ff4d4d';
      ctx.fillRect(cx - w * 0.44, cy + h * 0.1, w * 0.16, h * 0.16);
      ctx.fillRect(cx + w * 0.28, cy + h * 0.1, w * 0.16, h * 0.16);

      // Name, only when they're close enough to read.
      if (w > 26) {
        ctx.font = '600 ' + Math.max(9, Math.min(15, w * 0.22)) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        var tw = ctx.measureText(p.name).width + 10;
        roundRect(ctx, cx - tw / 2, cy - h / 2 - 20, tw, 16, 8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(p.name, cx, cy - h / 2 - 8);
      }
      ctx.restore();

      mp.placeBubble(p.id, cx, cy - h / 2 - 26);
    }
  }

  function roundRect(c, x, y, w, h, r) {
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
  }

  // --- session -------------------------------------------------------------

  function beginOnline() {
    online = true;
    iFinished = false;
    settled = false;
    finishers = {};
    startedAt = Date.now();
    mp.hideResult();
    mp.toast('Green light. Your rival is on the same track.', 3000);
  }

  function pushState() {
    if (!online) return;
    mp.send({
      p: Math.round(position),
      x: Math.round((typeof playerX === 'number' ? playerX : 0) * 1000) / 1000,
      s: Math.round(typeof speed === 'number' ? speed : 0),
      f: iFinished ? 1 : 0,
    });
    var gap = gapText();
    mp.setScore(mp.id, gap);
  }

  function gapText() {
    var foe = mp.opponent();
    if (!foe) return '—';
    var s = mp.stateOf(foe.id);
    if (!s) return '—';
    var d = Math.round((position - s.p) / SEGMENT_LENGTH);
    if (d === 0) return 'level';
    return (d > 0 ? '+' : '') + d;
  }

  function checkFinish() {
    if (!online || iFinished) return;
    if (typeof finishLineSegment !== 'number' || !finishLineSegment) return;
    if (position < finishLineSegment * SEGMENT_LENGTH) return;
    iFinished = true;
    var t = (Date.now() - startedAt) / 1000;
    mp.event('finish', { t: Math.round(t * 100) / 100 });
    pushState();
    settle();
  }

  function settle() {
    if (settled || !online || !iFinished) return;
    var others = mp.otherPlayers();
    if (!others.length) return;
    if (!others.every(function (p) { return finishers[p.id]; })) {
      mp.toast('You finished. Waiting for your rival…', 4000);
      return;
    }
    settled = true;
    var mine = (Date.now() - startedAt) / 1000;
    var best = null;
    others.forEach(function (p) {
      var f = finishers[p.id];
      if (f && (!best || f.t < best.t)) best = { name: p.name, t: f.t };
    });
    var win = !best || mine < best.t;
    mp.showResult({
      win: win,
      title: win ? 'You win' : 'You lose',
      note: 'Your time ' + mine.toFixed(2) + 's' + (best ? '. ' + best.name + ' ran ' + best.t.toFixed(2) + 's.' : '.'),
      onAgain: function () {
        beginOnline();
        if (typeof startGame === 'function') startGame(1);
        mp.event('again', {});
      },
    });
  }

  function boot() {
    if (!loaded()) return;

    mp = MP.create({
      game: 'car',
      title: 'Neon Velocity',
      modes: ['versus'],
      versusTitle: 'Head to head',
      versusNote: 'Same track, two cars. Theirs is on the road ahead of you.',
      emotes: ['Nice line', 'Off track!', 'Catching you', 'gg'],
      launchStyle: { top: '14px', right: '14px' },

      onStart: beginOnline,

      onState: function (id) {
        if (online) mp.setScore(id, '');
      },

      onEvent: function (id, kind, data, p) {
        if (!online) return;
        if (kind === 'finish') {
          finishers[id] = { t: (data && data.t) || 999 };
          mp.toast((p ? p.name : 'Your rival') + ' finished in ' + finishers[id].t.toFixed(2) + 's');
          settle();
        } else if (kind === 'again') {
          beginOnline();
          if (typeof startGame === 'function') startGame(1);
        }
      },

      onLeave: function (id) { delete finishers[id]; },

      onStop: function () { online = false; },
    });

    // drawCar paints your own car last, so ghosts drawn just before it end up
    // correctly behind you in the depth order.
    var realDrawCar = window.drawCar;
    if (typeof realDrawCar === 'function') {
      window.drawCar = function () {
        if (online) {
          drawGhosts();
          pushState();
          checkFinish();
        }
        return realDrawCar.apply(this, arguments);
      };
    }

    // drawCar only runs while a race is on screen. Keep reporting between races
    // too, so someone sitting in the menu still shows up for their opponent.
    setInterval(function () {
      if (online) pushState();
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
