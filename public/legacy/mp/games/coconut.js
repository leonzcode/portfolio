/* ===========================================================================
   Coconut Simulator — online adapter.

   A shared island. Everyone rolls their own coconut around the same beach and
   sees the others rolling theirs, names above them, chat floating over whoever
   said it. Scores sit side by side in the rail so it doubles as a leaderboard
   without turning the game into a match.
   =========================================================================== */

(function () {
  'use strict';

  var mp = null;
  var avatars = null;
  var online = false;

  function loaded() {
    try {
      return typeof THREE !== 'undefined' && typeof scene !== 'undefined' &&
        typeof camera !== 'undefined' && typeof renderer !== 'undefined' &&
        typeof coconut !== 'undefined';
    } catch (e) {
      return false;
    }
  }

  function r2(n) {
    return Math.round(n * 100) / 100;
  }

  function pushState() {
    if (!online || !coconut || !coconut.pos) return;
    mp.send({
      x: r2(coconut.pos.x),
      y: r2(coconut.pos.y),
      z: r2(coconut.pos.z),
      sc: Math.round(typeof totalScore === 'number' ? totalScore : 0),
      p: typeof isPlaying !== 'undefined' && isPlaying ? 1 : 0,
    });
    mp.setScore(mp.id, Math.round(typeof totalScore === 'number' ? totalScore : 0));
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
      avatars.place(p, s.x, s.y, s.z, null);
      var pos = avatars.screenPos(p.id, 0.9);
      mp.placeBubble(p.id, pos ? pos.x : null, pos ? pos.y : null);
    }
    avatars.keepOnly(ids);
  }

  function boot() {
    if (!loaded()) return;

    mp = MP.create({
      game: 'coconut',
      title: 'Coconut Simulator',
      modes: ['arena'],
      arenaTitle: 'Share the island',
      arenaNote: 'Roll around the same beach as everyone else online.',
      emotes: ['Over here', 'Watch the crab', 'Nice roll', 'How many?'],

      onStart: function () {
        online = true;
        avatars = MPThree.create({
          THREE: THREE,
          scene: scene,
          camera: camera,
          // Other people are coconuts too, so clone the player's mesh.
          template: function () { return coconut && coconut.mesh ? coconut.mesh : null; },
          height: 0.76, // roughly two coconut radii
          labelScale: 1.6,
        });
        mp.toast('You are on the island with everyone else online.', 4000);
        pushState();
      },

      onState: function (id, d) {
        if (d && typeof d.sc === 'number') mp.setScore(id, d.sc);
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

    var realRender = renderer.render.bind(renderer);
    renderer.render = function (s, c) {
      if (online) {
        syncAvatars();
        pushState();
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
