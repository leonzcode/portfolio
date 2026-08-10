/* ===========================================================================
   Blackjack — online adapter.

   A shared table rather than a duel. Everyone plays their own hand against
   Leon the dealer, but the table strip along the bottom shows what everyone
   else is holding in real time: their cards, their running total, what they
   staked and how it went. Watching someone go all in on 16 and then hit is
   most of the fun of a blackjack table, and none of it needs a shared deck.
   =========================================================================== */

(function () {
  'use strict';

  var mp = null;
  var online = false;
  var strip = null;
  var seats = {};

  // --- table strip ---------------------------------------------------------

  function buildStrip() {
    strip = document.createElement('div');
    strip.className = 'mp-panel';
    strip.style.cssText = 'position:absolute;left:14px;bottom:14px;right:292px;padding:10px 12px;' +
      'pointer-events:auto;display:none;';
    var head = document.createElement('p');
    head.className = 'mp-eyebrow';
    head.textContent = 'At the table';
    head.style.marginBottom = '8px';
    strip.appendChild(head);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;';
    strip.appendChild(row);
    strip.__row = row;
    mp.root.appendChild(strip);
  }

  function seatFor(p) {
    if (seats[p.id]) return seats[p.id];
    var seat = document.createElement('div');
    seat.style.cssText = 'min-width:120px;';

    var name = document.createElement('div');
    name.style.cssText = 'display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;margin-bottom:5px;';
    var dot = document.createElement('span');
    dot.className = 'mp-dot';
    dot.style.background = p.color;
    name.appendChild(dot);
    var label = document.createElement('span');
    label.textContent = p.name;
    name.appendChild(label);
    seat.appendChild(name);

    var cards = document.createElement('div');
    cards.style.cssText = 'display:flex;gap:4px;min-height:30px;margin-bottom:4px;';
    seat.appendChild(cards);

    var line = document.createElement('div');
    line.style.cssText = 'font-family:var(--mp-mono);font-size:11.5px;color:var(--mp-mist);';
    seat.appendChild(line);

    seats[p.id] = { root: seat, cards: cards, line: line, label: label, dot: dot };
    strip.__row.appendChild(seat);
    return seats[p.id];
  }

  function dropSeat(id) {
    if (!seats[id]) return;
    seats[id].root.remove();
    delete seats[id];
  }

  function renderSeat(p, s) {
    var seat = seatFor(p);
    seat.label.textContent = p.name;
    seat.cards.innerHTML = '';
    (s.c || []).forEach(function (card) {
      var el = document.createElement('span');
      var red = card.indexOf('♥') >= 0 || card.indexOf('♦') >= 0;
      el.textContent = card;
      el.style.cssText = 'display:inline-grid;place-items:center;min-width:24px;height:30px;padding:0 3px;' +
        'background:#fff;border-radius:4px;font-size:12px;font-weight:700;color:' +
        (red ? '#d1343a' : '#111') + ';';
      seat.cards.appendChild(el);
    });
    var bits = [];
    if (s.t != null) bits.push(s.t > 21 ? 'bust' : String(s.t));
    if (s.b) bits.push('$' + s.b);
    if (s.m != null) bits.push('$' + s.m + ' left');
    seat.line.textContent = bits.join(' · ');
    seat.line.style.color = s.t > 21 ? '#e5484d' : 'var(--mp-mist)';
  }

  // --- state ---------------------------------------------------------------

  function pushState() {
    if (!online) return;
    mp.send({
      c: yourCards.slice(),
      t: yourCards.length ? calculateTotal(yourCards) : null,
      b: pot,
      m: yourTotalMoney,
    });
    mp.setScore(mp.id, '$' + yourTotalMoney);
  }

  function boot() {
    MP.style(
      '@media (min-width: 721px) { html.mp-online body { padding-bottom: 130px; padding-right: 280px; } }'
    );

    mp = MP.create({
      game: 'blackjack',
      title: 'Blackjack',
      modes: ['arena'],
      arenaTitle: 'Join the table',
      arenaNote: 'Play your own hand against Leon, with everyone watching.',
      emotes: ['All in', 'Hit me', 'Dealer got lucky', 'Nice hand'],

      onStart: function () {
        online = true;
        if (!strip) buildStrip();
        strip.style.display = '';
        pushState();
      },

      onState: function (id, d) {
        if (!online || !d) return;
        var p = mp.players[id];
        if (p) renderSeat(p, d);
        if (d.m != null) mp.setScore(id, '$' + d.m);
      },

      onEvent: function (id, kind, data, p) {
        if (!online) return;
        if (kind === 'result') {
          mp.toast((p ? p.name : 'Someone') + ': ' + (data && data.msg ? data.msg : 'finished a hand'), 3000);
        }
      },

      onLeave: dropSeat,

      onStop: function () {
        online = false;
        if (strip) strip.style.display = 'none';
        Object.keys(seats).forEach(dropSeat);
      },
    });

    var controls = document.getElementById('controls');
    if (controls) {
      var btn = document.createElement('button');
      btn.textContent = 'Play Online';
      btn.addEventListener('click', function () { mp.openLobby(); });
      controls.appendChild(btn);
    }

    // Every action that changes what's on the felt gets broadcast.
    ['bet', 'allIn', 'startGame', 'hit', 'stay', 'dealCard', 'updateYourCards'].forEach(function (name) {
      var real = window[name];
      if (typeof real !== 'function') return;
      window[name] = function () {
        var out = real.apply(this, arguments);
        if (online) setTimeout(pushState, 30);
        return out;
      };
    });

    // Announce how a hand ended, so the table reacts to it.
    var realEnd = window.endGame;
    if (typeof realEnd === 'function') {
      window.endGame = function (msg) {
        var out = realEnd.apply(this, arguments);
        if (online) {
          mp.event('result', { msg: String(msg || '') });
          setTimeout(pushState, 60);
        }
        return out;
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
