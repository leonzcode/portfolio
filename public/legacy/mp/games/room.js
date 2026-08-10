/* ===========================================================================
   Shared online room.

   Some games in the arcade keep their whole simulation inside a closure or a
   module, with no seam to hook a live opponent into without rewriting them.
   Those still get a real online room through this adapter: matchmaking or a
   shared lobby, everyone who's in it, a live status line per player scraped
   from the game's own scoreboard, chat, and emotes.

   Configure it from the script tag, so no game needs bespoke code:

     <script src="/legacy/mp/games/room.js"
             data-game="tennis" data-title="Tennis" data-mode="versus"
             data-status="#score" data-emotes="Nice shot|Out|gg"></script>

   data-status is a CSS selector whose text is broadcast as that player's status.
   =========================================================================== */

(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var cfg = {
    game: script.getAttribute('data-game'),
    title: script.getAttribute('data-title') || script.getAttribute('data-game'),
    mode: script.getAttribute('data-mode') || 'arena',
    status: script.getAttribute('data-status') || '',
    label: script.getAttribute('data-label') || '',
    note: script.getAttribute('data-note') || '',
    emotes: (script.getAttribute('data-emotes') || 'Nice|Good luck|So close|gg').split('|'),
  };
  if (!cfg.game) return;

  var mp = null;
  var online = false;
  var lastStatus = '';

  function readStatus() {
    if (!cfg.status) return '';
    var el = document.querySelector(cfg.status);
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
  }

  function boot() {
    var opts = {
      game: cfg.game,
      title: cfg.title,
      modes: [cfg.mode],
      emotes: cfg.emotes,

      onStart: function () {
        online = true;
        mp.toast(cfg.mode === 'versus'
          ? 'Matched. Play your round and watch the scores.'
          : 'You are in the room. Say hello.', 4000);
        push(true);
      },

      onState: function (id, d) {
        if (d && d.s != null) mp.setScore(id, d.s);
      },

      onStop: function () {
        online = false;
        lastStatus = '';
      },
    };

    if (cfg.mode === 'versus') {
      opts.versusTitle = cfg.label || 'Head to head';
      opts.versusNote = cfg.note || 'Get matched against one other player.';
    } else {
      opts.arenaTitle = cfg.label || 'Join the room';
      opts.arenaNote = cfg.note || 'Share a room with everyone else online.';
    }

    mp = MP.create(opts);
    setInterval(push, 700);
  }

  function push(force) {
    if (!online) return;
    var s = readStatus();
    if (!force && s === lastStatus) return;
    lastStatus = s;
    mp.send({ s: s });
    mp.setScore(mp.id, s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
