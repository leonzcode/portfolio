/* ===========================================================================
   Leonski 2 — online adapter.

   This one rebuilds any real ski resort on demand, which means two people in
   the same room can be standing on two different mountains. So the state
   carries which mountain you're on: riders on your mountain appear on the snow
   beside you, and everyone else shows up in the rail with their resort next to
   their name. Chat still reaches the whole room either way, which is how you
   agree to meet somewhere.

   The game itself is an ES module, so none of its bindings are reachable from a
   classic script. leonski2.html publishes the handful this needs on
   window.__leonski2, as getters -- the renderer, scene, camera and skier are
   all rebuilt whenever you fly to a different mountain.
   =========================================================================== */

(function () {
  'use strict';

  var G = null;               // window.__leonski2
  var mp = null;
  var avatars = null;
  var online = false;
  var myResort = '';

  function sceneReady() {
    return !!(G && G.THREE && G.renderer && G.scene && G.camera);
  }

  function resortName() {
    var el = document.getElementById('resortName');
    var name = el ? (el.textContent || '').trim() : '';
    return name === '—' || name === '-' ? '' : name;
  }

  function r3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function pushState() {
    if (!online) return;
    var here = resortName();
    if (here !== myResort) {
      myResort = here;
      mp.event('resort', { r: here });
    }
    var skier = G.skier;
    if (!skier || !skier.visible) {
      mp.send({ r: here, off: 1 });
      return;
    }
    var p = skier.position;
    var q = skier.quaternion;
    var ski = G.ski;
    mp.send({
      r: here,
      x: r3(p.x), y: r3(p.y), z: r3(p.z),
      qx: r3(q.x), qy: r3(q.y), qz: r3(q.z), qw: r3(q.w),
      s: ski ? Math.round(Math.hypot(ski.vx || 0, ski.vz || 0) * 3.6) : 0,
      a: ski && ski.air ? 1 : 0,
    });
  }

  function syncAvatars() {
    if (!online || !avatars) return;
    var remotes = mp.remotes();
    var ids = [];
    for (var i = 0; i < remotes.length; i++) {
      var p = remotes[i].player;
      var s = remotes[i].state;
      if (!s || s.off || typeof s.x !== 'number') continue;
      // Only draw people actually on this mountain: world coordinates from a
      // different resort would put them somewhere meaningless.
      if (!myResort || s.r !== myResort) continue;
      ids.push(p.id);
      var a = avatars.place(p, s.x, s.y, s.z, null);
      if (typeof s.qw === 'number') a.group.quaternion.set(s.qx, s.qy, s.qz, s.qw);
      var pos = avatars.screenPos(p.id, 4);
      mp.placeBubble(p.id, pos ? pos.x : null, pos ? pos.y : null);
    }
    avatars.keepOnly(ids);
  }

  function refreshRoster() {
    if (!online) return;
    mp.otherPlayers().forEach(function (p) {
      var s = mp.stateOf(p.id);
      var sameHill = myResort && s && s.r === myResort;
      mp.setScore(p.id, sameHill ? (s.s || 0) + ' km/h' : shorten(s && s.r));
    });
    mp.setScore(mp.id, myResort ? shorten(myResort) : 'no mountain');
  }

  function shorten(name) {
    if (!name) return '…';
    return name.length > 12 ? name.slice(0, 11) + '…' : name;
  }

  function buildAvatars() {
    if (avatars || !sceneReady()) return;
    avatars = MPThree.create({
      THREE: G.THREE,
      scene: G.scene,
      camera: G.camera,
      template: function () { return G.skier || null; },
      height: 1.8,
      labelScale: 2.4,
    });
  }

  function boot(attempt) {
    G = window.__leonski2;
    if (!G) {
      // Module scripts are deferred, so on a slow parse the export can land
      // after this runs. Give it a few seconds before giving up.
      if ((attempt || 0) < 20) setTimeout(function () { boot((attempt || 0) + 1); }, 250);
      return;
    }

    mp = MP.create({
      game: 'leonski2',
      title: 'Leonski 2',
      modes: ['arena'],
      arenaTitle: 'Ride together',
      arenaNote: 'Load the same mountain as someone else and you will see them on the snow.',
      emotes: ['Follow me', 'Nice line', 'Meet at the lift', 'What mountain?'],

      onStart: function () {
        online = true;
        myResort = resortName();
        buildAvatars();
        mp.toast(myResort
          ? 'Riding ' + myResort + '. Anyone on the same mountain will appear.'
          : 'Pick a mountain, then anyone else on it will appear.', 5000);
        pushState();
      },

      onState: refreshRoster,

      onEvent: function (id, kind, data, p) {
        if (!online) return;
        if (kind === 'resort' && data) {
          mp.toast((p ? p.name : 'Someone') + ' went to ' + (data.r || 'the start screen'), 3500);
          refreshRoster();
        }
      },

      onJoin: refreshRoster,

      onLeave: function (id) {
        if (avatars) avatars.remove(id);
        refreshRoster();
      },

      onStop: function () {
        online = false;
        if (avatars) avatars.clear();
        avatars = null;
      },
    });

    // The renderer appears only once a mountain has been reconstructed, and is
    // replaced when you fly to a new one, so keep re-hooking whichever is live.
    var hooked = null;
    var tick = 0;
    setInterval(function () {
      if (!sceneReady()) return;
      buildAvatars();
      var current = G.renderer;
      if (hooked === current) return;
      hooked = current;
      var realRender = current.render.bind(current);
      current.render = function (s, c) {
        if (online) {
          syncAvatars();
          pushState();
          if ((tick = (tick + 1) % 30) === 0) refreshRoster();
        }
        realRender(s, c);
      };
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
