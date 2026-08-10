/* ===========================================================================
   Leonski — online adapter.

   A shared slope. Everyone who joins skis the same mountain and can see each
   other carving, jumping and crashing in real time, with names over their heads
   and chat that appears as a speech bubble above whoever said it.

   No matchmaking and no winner: it's a mountain, not a match. The scoreboard in
   the rail keeps everyone's trick score so there's still something to beat.
   =========================================================================== */

(function () {
  'use strict';

  var mp = null;
  var avatars = null;
  var online = false;

  function gameLoaded() {
    try {
      return typeof renderer !== 'undefined' && typeof scene !== 'undefined' &&
        typeof camera !== 'undefined' && typeof sk !== 'undefined';
    } catch (e) {
      return false;
    }
  }

  function pushState() {
    if (!online) return;
    // Position, heading and what the body is doing. Two decimals is well below
    // what anyone can see at skiing speed and keeps the packet small.
    mp.send({
      x: round(sk.pos.x),
      y: round(sk.pos.y),
      z: round(sk.pos.z),
      f: round(sk.facing),
      st: sk.state,
      sc: Math.round(typeof score === 'number' ? score : 0),
      sp: round(sk.vel ? sk.vel.length() : 0),
    });
    mp.setScore(mp.id, Math.round(typeof score === 'number' ? score : 0));
  }

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  function syncAvatars() {
    if (!online || !avatars) return;
    var remotes = mp.remotes();
    var ids = [];
    for (var i = 0; i < remotes.length; i++) {
      var p = remotes[i].player;
      var s = remotes[i].state;
      if (!s || typeof s.x !== 'number') continue;
      ids.push(p.id);
      avatars.place(p, s.x, s.y, s.z, s.f);
      var pos = avatars.screenPos(p.id);
      mp.placeBubble(p.id, pos ? pos.x : null, pos ? pos.y : null);
    }
    avatars.keepOnly(ids);
  }

  function boot() {
    if (!gameLoaded()) return;

    mp = MP.create({
      game: 'ski',
      title: 'Leonski',
      modes: ['arena'],
      arenaTitle: 'Ride the mountain',
      arenaNote: 'Share the slope with everyone else online right now.',
      emotes: ['Follow me', 'Nice line', 'Send it', 'Watch this'],
      launchStyle: { top: '14px', right: '14px' },

      onStart: function () {
        online = true;
        avatars = MPThree.create({
          THREE: THREE,
          scene: scene,
          camera: camera,
          // Clone the game's own skier so other riders look like riders.
          template: function () { return typeof skier !== 'undefined' ? skier : null; },
          height: 1.8,
        });
        mp.toast('You are on the mountain. Others show up as you meet them.', 4000);
        pushState();
      },

      onState: function (id, d) {
        if (d && typeof d.sc === 'number') mp.setScore(id, d.sc);
      },

      onEvent: function (id, kind, data, p) {
        if (!online) return;
        if (kind === 'crash') mp.toast((p ? p.name : 'Someone') + ' ate it');
        else if (kind === 'trick' && data && data.name) {
          mp.toast((p ? p.name : 'Someone') + ': ' + data.name);
        }
      },

      onLeave: function (id) {
        if (avatars) avatars.remove(id);
      },

      onStop: function () {
        online = false;
        if (avatars) avatars.clear();
        avatars = null;
      },
    });

    // The scene renders once per frame; that's the right beat for both moving
    // everyone else and reporting where you are.
    var realRender = renderer.render.bind(renderer);
    var lastState = '';
    renderer.render = function (s, c) {
      if (online) {
        syncAvatars();
        if (typeof gameState === 'undefined' || gameState === 'playing') pushState();
        // Announce a crash once, on the transition into it.
        if (sk.state !== lastState) {
          if (sk.state === 'crash') mp.event('crash', {});
          lastState = sk.state;
        }
      }
      realRender(s, c);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
