/* ===========================================================================
   Slope — online adapter.

   Both riders get the same course. The twenty floor segments recycle in a
   fixed cyclic order (segment 0 always wraps first, then 1, then 2...), so
   feeding every course decision from one seeded stream produces the identical
   run on both machines no matter how fast either browser is drawing.

   Your opponent is a translucent ball on your slope. Because distance and
   score are the same quantity here, the gap in score places their ghost exactly
   where they are: ahead of you down the hill, or behind.
   =========================================================================== */

(function () {
  'use strict';

  var mp = null;
  var online = false;
  var iAmOut = false;
  var settled = false;
  var outFoes = {};
  var ghosts = {};        // player id -> THREE.Mesh
  var realRandom = Math.random;

  function gameLoaded() {
    try {
      return typeof renderer !== 'undefined' &&
        typeof floors !== 'undefined' &&
        typeof scene !== 'undefined' &&
        typeof ball !== 'undefined';
    } catch (e) {
      return false;
    }
  }

  // --- course --------------------------------------------------------------

  function seedCourse() {
    var rng = MP.rngFrom(mp.seed || 1);
    // createFloor and three.js both read Math.random while building segments.
    // Swapping it for the seeded stream is what makes the two courses identical.
    Math.random = rng;

    floors.forEach(function (f) { scene.remove(f); });
    floors.length = 0;
    for (var i = 0; i < 20; i++) createFloor(i * -10);

    // Left swapped in for the whole session: the recycle path inside animate()
    // draws from the same stream, in the same order, on both machines.
  }

  function restoreRandom() {
    Math.random = realRandom;
  }

  // --- ghosts --------------------------------------------------------------

  function ghostFor(p) {
    if (ghosts[p.id]) return ghosts[p.id];
    var geo = new THREE.SphereGeometry(0.5, 20, 20);
    var mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.color),
      transparent: true,
      opacity: 0.45,
      emissive: new THREE.Color(p.color),
      emissiveIntensity: 0.35,
      metalness: 0.4,
      roughness: 0.4,
    });
    var mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    ghosts[p.id] = mesh;
    return mesh;
  }

  function dropGhost(id) {
    if (!ghosts[id]) return;
    scene.remove(ghosts[id]);
    ghosts[id].geometry.dispose();
    ghosts[id].material.dispose();
    delete ghosts[id];
  }

  function updateGhosts() {
    if (!online) return;
    var remotes = mp.remotes();
    var live = {};
    for (var i = 0; i < remotes.length; i++) {
      var p = remotes[i].player;
      var s = remotes[i].state;
      if (!s || typeof s.x !== 'number') continue;
      live[p.id] = true;
      var mesh = ghostFor(p);
      // Score and distance are the same thing here: score grows by speed*10
      // per frame while the floor moves by speed, so 10 points is one unit.
      mesh.position.set(s.x, s.y, ball.position.z - (s.sc - score) / 10);
      mesh.material.opacity = outFoes[p.id] ? 0.18 : 0.45;
    }
    for (var id in ghosts) {
      if (!live[id]) dropGhost(id);
    }
  }

  // --- session -------------------------------------------------------------

  function beginOnline() {
    online = true;
    iAmOut = false;
    settled = false;
    outFoes = {};
    seedCourse();
    resetGame();
    mp.hideResult();
    mp.setScore(mp.id, 0);
  }

  function endOnline() {
    online = false;
    restoreRandom();
    for (var id in ghosts) dropGhost(id);
  }

  function finish() {
    if (settled || !online || !iAmOut) return;
    var others = mp.otherPlayers();
    if (!others.length || !others.every(function (p) { return outFoes[p.id]; })) return;
    settled = true;
    var mine = Math.floor(score);
    var best = null;
    others.forEach(function (p) {
      var d = outFoes[p.id];
      if (d && (!best || d.score > best.score)) best = { name: p.name, score: d.score };
    });
    var win = !best || mine > best.score;
    mp.showResult({
      win: win,
      title: win ? 'You win' : (best && mine === best.score ? 'Dead heat' : 'You lose'),
      note: 'You scored ' + mine + (best ? '. ' + best.name + ' scored ' + best.score + '.' : '.'),
      onAgain: function () {
        beginOnline();
        mp.event('again', {});
      },
    });
  }

  function boot() {
    // The game builds a WebGL renderer at load. If that throws (no GL, blocked
    // context) its script aborts and the globals stay in the temporal dead
    // zone, where even typeof raises. Offering online play then would only
    // produce a lobby that leads nowhere.
    if (!gameLoaded()) return;

    MP.style('@media (min-width: 721px) { html.mp-online #speed { right: 292px; } }');

    mp = MP.create({
      game: 'slope',
      title: 'Slope',
      modes: ['versus'],
      versusTitle: 'Head to head',
      versusNote: 'Identical slope, two balls. Ride further than they do.',
      emotes: ['Too fast', 'Nice line', 'Moving platform!', 'gg'],
      launchStyle: { top: '76px' },

      onStart: beginOnline,

      onState: function (id, d) {
        if (d && typeof d.sc === 'number') mp.setScore(id, Math.floor(d.sc));
      },

      onEvent: function (id, kind, data, p) {
        if (!online) return;
        if (kind === 'out') {
          outFoes[id] = { score: (data && data.score) || 0 };
          mp.toast((p ? p.name : 'Your opponent') + ' fell off at ' + ((data && data.score) || 0));
          finish();
        } else if (kind === 'again') {
          beginOnline();
        }
      },

      onLeave: function (id) {
        delete outFoes[id];
        dropGhost(id);
      },

      onStop: endOnline,
    });

    // Falling off reports the run instead of opening the solo restart card.
    var realShowGameOver = window.showGameOver;
    window.showGameOver = function () {
      realShowGameOver.apply(this, arguments);
      if (!online || iAmOut) return;
      iAmOut = true;
      var mine = Math.floor(score);
      mp.event('out', { score: mine });
      var box = document.getElementById('gameOverMenu');
      // Keep the camera on the slope so you can watch them finish.
      setTimeout(function () {
        if (online && box) box.style.display = 'none';
      }, 1050);
      var alive = mp.otherPlayers().filter(function (p) { return !outFoes[p.id]; });
      if (alive.length) mp.toast('You fell off at ' + mine + '. Watching…', 3500);
      finish();
    };

    // The render loop is a bare `animate()`; hang the network work off the
    // renderer instead, which it calls exactly once per frame.
    var realRender = renderer.render.bind(renderer);
    renderer.render = function (sc, cam) {
      if (online) {
        updateGhosts();
        if (!iAmOut) {
          mp.send({ x: ball.position.x, y: ball.position.y, sc: score, sp: speed });
          mp.setScore(mp.id, Math.floor(score));
        }
      }
      realRender(sc, cam);
    };

    document.getElementById('restartButton').addEventListener('click', function () {
      if (online) mp.leave();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
