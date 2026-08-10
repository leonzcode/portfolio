/* ===========================================================================
   Leon's Wordle — online adapter.

   Same word, two boards, a race. You see your opponent's grid as it fills in,
   but only the colours: greens, yellows and greys, never the letters. That's
   the whole tension of competitive Wordle -- you can see they've found three
   greens on guess two and still have no idea what they've got.

   The word itself is chosen by one player and sent to the other rather than
   derived from the seed, because the word lists are fetched at runtime and the
   two players can end up with different ones.
   =========================================================================== */

(function () {
  'use strict';

  var mp = null;
  var panel = null;
  var online = false;
  var myRows = [];
  var iAmDone = false;
  var settled = false;
  var foeDone = {};

  function isHost() {
    var ids = Object.keys(mp.players);
    if (!ids.length) return true;
    ids.sort();
    return ids[0] === mp.id;
  }

  function beginOnline() {
    online = true;
    myRows = [];
    iAmDone = false;
    settled = false;
    foeDone = {};
    mp.hideResult();

    startNewGame();
    if (isHost()) {
      // pickSolution already ran inside startNewGame; share what it chose.
      mp.event('word', { w: solution });
    } else {
      statusEl.textContent = 'Waiting for the word…';
      finished = true; // hold input until the word lands
    }
    panel.show();
    panel.note('');
    mp.setScore(mp.id, '0/6');
    pushState();
  }

  function acceptWord(w) {
    if (!online || !w) return;
    solution = w;
    if (typeof VALID !== 'undefined' && VALID.add) VALID.add(w);
    finished = false;
    statusEl.textContent = 'Same word for both of you. Go.';
  }

  function endOnline() {
    online = false;
    if (panel) panel.hide();
  }

  function pushState() {
    if (!online) return;
    mp.send({ r: myRows, d: iAmDone ? 1 : 0 });
    mp.setScore(mp.id, myRows.length + '/6');
  }

  function finish() {
    if (settled || !online) return;
    var others = mp.otherPlayers();
    if (!others.length) return;
    if (!iAmDone || !others.every(function (p) { return foeDone[p.id]; })) return;
    settled = true;

    var mine = myRows.length;
    var solvedMe = mySolved();
    var best = null;
    others.forEach(function (p) {
      var d = foeDone[p.id];
      if (d && d.solved && (!best || d.guesses < best.guesses)) {
        best = { name: p.name, guesses: d.guesses };
      }
    });

    var win = solvedMe && (!best || mine < best.guesses);
    var tie = solvedMe && best && mine === best.guesses;
    mp.showResult({
      win: win && !tie,
      title: tie ? 'Dead heat' : (win ? 'You win' : 'You lose'),
      note: (solvedMe ? 'You got it in ' + mine : 'You did not get it') +
        (best ? '. ' + best.name + ' got it in ' + best.guesses + '.' : '.') +
        ' The word was ' + String(solution).toUpperCase() + '.',
      onAgain: function () {
        beginOnline();
        mp.event('again', {});
      },
    });
  }

  function mySolved() {
    var last = myRows[myRows.length - 1];
    return !!last && last.every(function (s) { return s === 'correct'; });
  }

  function boot() {
    MP.style('@media (min-width: 721px) { html.mp-online body { padding-right: 250px; padding-left: 220px; } }');

    mp = MP.create({
      game: 'wordle-game',
      title: "Leon's Wordle",
      modes: ['versus'],
      versusTitle: 'Head to head',
      versusNote: 'Same word, and you can watch their colours land. Fewest guesses wins.',
      emotes: ['Got it', 'No idea', 'Three greens!', 'gg'],

      onStart: beginOnline,

      onState: function (id, d) {
        if (!d) return;
        mp.setScore(id, (d.r ? d.r.length : 0) + '/6');
      },

      onEvent: function (id, kind, data, p) {
        if (!online) return;
        if (kind === 'word') {
          acceptWord(data && data.w);
        } else if (kind === 'done') {
          foeDone[id] = { solved: !!(data && data.solved), guesses: (data && data.guesses) || 6 };
          mp.toast((p ? p.name : 'Your opponent') +
            (foeDone[id].solved ? ' solved it in ' + foeDone[id].guesses : ' ran out of guesses'));
          finish();
        } else if (kind === 'again') {
          beginOnline();
        }
      },

      onJoin: function () {
        // A late arrival still needs the word.
        if (online && isHost() && solution) mp.event('word', { w: solution });
      },

      onLeave: function (id) { delete foeDone[id]; },
      onStop: endOnline,
    });

    panel = mp.versusPanel({
      label: 'Their grid',
      width: 150,
      height: 180,
      draw: function (c, s, info) {
        var rows = s.r || [];
        var pad = 3;
        var cw = (info.width - pad * 6) / 5;
        var ch = (info.height - pad * 7) / 6;
        var colors = { correct: '#3fb950', present: '#f2b441', absent: '#2b3648' };
        for (var r = 0; r < 6; r++) {
          for (var col = 0; col < 5; col++) {
            var st = rows[r] ? rows[r][col] : null;
            c.fillStyle = st ? colors[st] : 'rgba(147,166,191,0.10)';
            c.fillRect(pad + col * (cw + pad), pad + r * (ch + pad), cw, ch);
          }
        }
      },
    });

    var bar = document.querySelector('#controls') || document.body;
    var btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Play Online';
    btn.addEventListener('click', function () { mp.openLobby(); });
    if (newBtn && newBtn.parentNode) newBtn.parentNode.insertBefore(btn, newBtn.nextSibling);
    else bar.appendChild(btn);

    // revealGuess is where a submitted guess turns into colours. Capture the
    // pattern there and ship it: colours only, never the letters.
    var realReveal = window.revealGuess;
    window.revealGuess = function (guess) {
      var state = realReveal.apply(this, arguments);
      if (!online) return state;
      myRows.push(state.slice());
      pushState();
      var solved = guess === solution;
      if (solved || myRows.length >= 6) {
        iAmDone = true;
        mp.event('done', { solved: solved, guesses: myRows.length });
        pushState();
        var waiting = mp.otherPlayers().filter(function (p) { return !foeDone[p.id]; });
        if (waiting.length) {
          mp.toast(solved ? 'Solved in ' + myRows.length + '. Waiting…' : 'Out of guesses. Waiting…', 3500);
        }
        finish();
      }
      return state;
    };

    setInterval(function () {
      if (!online || !panel) return;
      panel.paint();
      var foe = mp.opponent();
      var s = foe && mp.stateOf(foe.id);
      panel.stats(s ? ['guess ' + (s.r ? s.r.length : 0) + '/6'] : []);
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
