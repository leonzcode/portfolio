/* ===========================================================================
   Clash Royale — online adapter.

   Real 1v1: the bot stops making decisions and your opponent's card plays
   arrive instead. When they drop a giant on their left lane, a giant appears
   pushing down your right lane, because their board is your board rotated 180
   degrees. The mirror axis is measured from the two king towers rather than
   hard-coded, so it stays correct whatever the arena dimensions are.

   Each side still runs its own simulation, so the two boards can drift a little
   under heavy fights. That's the honest trade for not rewriting the game around
   an authoritative server, and at this scale it reads fine.
   =========================================================================== */

(function () {
  'use strict';

  var mp = null;
  var online = false;
  var settled = false;

  function loaded() {
    try {
      return typeof CARDS !== 'undefined' && typeof Entity !== 'undefined' &&
        typeof CONSTANTS !== 'undefined';
    } catch (e) {
      return false;
    }
  }

  function live() {
    try {
      return online && G && !G.gameOver;
    } catch (e) {
      return false;
    }
  }

  /** Their board is yours rotated about the midpoint between the kings. */
  function mirror(x, y) {
    var bk = null, rk = null;
    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];
      if (!e.isKing) continue;
      if (e.team === 'blue') bk = e;
      else if (e.team === 'red') rk = e;
    }
    var midX = bk && rk ? (bk.x + rk.x) / 2 : CONSTANTS.CENTER_X;
    var midY = bk && rk ? (bk.y + rk.y) / 2 : CONSTANTS.RIVER_Y;
    return { x: 2 * midX - x, y: 2 * midY - y };
  }

  /** Put the opponent's card on the board as the red team. */
  function deployEnemy(key, x, y) {
    if (!live()) return;
    var stats = CARDS[key];
    if (!stats) return;
    var m = mirror(x, y);

    try {
      if (stats.type === 'spell') {
        var kTower = G.entities.find(function (e) { return e.team === 'red' && e.isKing; });
        var sx = kTower ? kTower.x : CONSTANTS.CENTER_X;
        var sy = kTower ? kTower.y : 80;
        if (key === 'goblinbarrel' || key === 'rocket') {
          var p = new Projectile(sx, sy, null, key, 'red');
          p.targetPos = { x: m.x, y: m.y };
          p.damage = stats.dmg;
          p.radius = stats.radius;
          p.stunDuration = stats.stunDuration || 0;
          p.speed = key === 'goblinbarrel' ? 400 : 250;
          G.projectiles.push(p);
        } else {
          var q = new Projectile(m.x, m.y, null, key, 'red');
          q.targetPos = { x: m.x, y: m.y };
          q.damage = stats.dmg;
          q.radius = stats.radius;
          q.stunDuration = stats.stunDuration || 0;
          G.createSpellEffect(q, m.x, m.y);
        }
        return;
      }

      if (stats.type === 'building') {
        var b = new Entity('red', key, m.x, m.y);
        G.applyStats(b, stats);
        b.isBuilding = true;
        G.entities.push(b);
        return;
      }

      if (key === 'goblingang') {
        spawnGroup('goblins', 3, m.x, m.y);
        spawnGroup('speargoblins', 3, m.x, m.y + 20);
        return;
      }

      spawnGroup(key, stats.count || 1, m.x, m.y);
    } catch (err) {
      if (window.console) console.warn('[mp] could not place ' + key, err);
    }
  }

  function spawnGroup(key, count, x, y) {
    var stats = CARDS[key];
    for (var i = 0; i < count; i++) {
      var ox = i * 20 - (count - 1) * 10;
      var u = new Entity('red', key, x + ox, y);
      G.applyStats(u, stats);
      G.entities.push(u);
    }
  }

  function towerHp(team) {
    if (!G || !G.entities) return 0;
    var total = 0;
    G.entities.forEach(function (e) {
      if (e.team === team && (e.isKing || e.isTower)) total += Math.max(0, e.hp || 0);
    });
    return Math.round(total);
  }

  function crownsFor(team) {
    if (!G || !G.entities) return 0;
    var alive = 0;
    G.entities.forEach(function (e) {
      if (e.team === team && (e.isKing || e.isTower) && e.hp > 0) alive++;
    });
    return Math.max(0, 3 - alive);
  }

  function boot() {
    if (!loaded()) return;

    mp = MP.create({
      game: 'clash',
      title: 'Clash Royale',
      modes: ['versus'],
      versusTitle: 'Head to head',
      versusNote: 'A real opponent instead of the bot. Their cards land on your side.',
      emotes: ['Good luck', 'Nice one', 'Oops', 'Thanks!'],

      onStart: function () {
        online = true;
        settled = false;
        mp.toast('Matched. Start a battle and the bot steps aside for them.', 5000);
      },

      onEvent: function (id, kind, data, p) {
        if (!online) return;
        if (kind === 'play' && data) {
          deployEnemy(data.k, data.x, data.y);
          mp.toast((p ? p.name : 'They') + ' played ' +
            ((CARDS[data.k] && CARDS[data.k].name) || data.k), 1600);
        } else if (kind === 'result' && !settled) {
          settled = true;
          mp.showResult({
            win: !(data && data.win),
            title: data && data.win ? 'You lose' : 'You win',
            note: 'Crowns ' + crownsFor('red') + ' - ' + crownsFor('blue') + '.',
            onAgain: function () { settled = false; },
          });
        }
      },

      onStop: function () { online = false; },
    });

    // Your deployments become messages. deployCard already checked elixir and
    // placement, so anything that gets past it is a play that really happened.
    var realDeploy = null;
    var hookDeploy = function () {
      try {
        if (!G || G.__mpHooked) return;
        G.__mpHooked = true;
        realDeploy = G.deployCard.bind(G);
        G.deployCard = function (idx, x, y) {
          var key = G.hand[idx];
          var before = G.elixir;
          var out = realDeploy(idx, x, y);
          // Elixir only drops when the card actually went down.
          if (online && key && G.elixir < before) mp.event('play', { k: key, x: x, y: y });
          return out;
        };
      } catch (e) { /* battle not running yet */ }
    };

    setInterval(function () {
      hookDeploy();
      if (!online) return;
      if (!live()) {
        // Between battles there's no G to read, but your opponent should still
        // see that you're there and waiting.
        mp.send({ hp: 0, c: 0, e: 0, idle: 1 });
        mp.setScore(mp.id, 'in menu');
        return;
      }
      // Silence the bot: with no elixir and its next move pushed away, it
      // stops acting, and the only red cards are the ones your opponent plays.
      G.botElixir = 0;
      G.botNextMove = 999;
      mp.send({ hp: towerHp('blue'), c: crownsFor('red'), e: Math.floor(G.elixir) });
      mp.setScore(mp.id, crownsFor('red') + ' crowns');
      var foe = mp.opponent();
      if (foe) {
        var s = mp.stateOf(foe.id);
        if (s) mp.setScore(foe.id, (s.c || 0) + ' crowns');
      }
      if (G.gameOver && !settled) {
        settled = true;
        var iWon = crownsFor('red') > crownsFor('blue');
        mp.event('result', { win: iWon });
        mp.showResult({
          win: iWon,
          title: iWon ? 'You win' : 'You lose',
          note: 'Crowns ' + crownsFor('red') + ' - ' + crownsFor('blue') + '.',
          onAgain: function () { settled = false; },
        });
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
