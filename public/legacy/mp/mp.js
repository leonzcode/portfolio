/* ===========================================================================
   MP — the online layer shared by every game in the leonzhao.dev arcade.
   Pairs with mp.css. Load both, then call MP.create() from a per-game adapter.

     const mp = MP.create({
       game: 'tetris',
       modes: ['versus'],
       onStart(ctx) { ... },          // arena joined, or versus countdown done
       onState(id, data, player) { ... },
       onEvent(id, kind, data, player) { ... },
       onStop() { ... },
     });

   The server never simulates a game, so neither does this. It carries identity,
   rooms, a shared seed, chat, and everyone's state; the adapter decides what
   any of it means.
   =========================================================================== */

(function (global) {
  'use strict';

  var DEFAULT_SERVER = 'wss://apps.leonzhao.dev/mp/ws';
  var RECONNECT_MS = [800, 1600, 3200, 6000, 10000];
  var STATE_HZ = 20;
  var INTERP_DELAY = 110; // ms of deliberate lag, so interpolation has two real samples

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function serverUrl(game) {
    if (global.MP_SERVER) return global.MP_SERVER + '?game=' + encodeURIComponent(game);
    var host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'ws://' + host + ':8600/mp/ws?game=' + encodeURIComponent(game);
    }
    return DEFAULT_SERVER + '?game=' + encodeURIComponent(game);
  }

  // Deterministic PRNG. Both sides of a match seed from the same number, so
  // "the same game" means the same pieces in the same order, not just the same rules.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var fontsLoaded = false;
  function loadFonts() {
    if (fontsLoaded) return;
    fontsLoaded = true;
    var link = el('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }

  function storedName() {
    try {
      return localStorage.getItem('mp:name') || '';
    } catch (e) {
      return '';
    }
  }

  function storeName(name) {
    try {
      localStorage.setItem('mp:name', name);
    } catch (e) {
      /* private browsing; not worth surfacing */
    }
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name || '?').slice(0, 2).toUpperCase();
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  function Session(opts) {
    this.opts = opts;
    this.game = opts.game;
    this.title = opts.title || opts.game;
    this.modes = opts.modes || ['arena'];
    this.emotes = opts.emotes || ['Nice', 'Close one', 'Good luck', 'gg'];

    this.ws = null;
    this.id = null;
    this.name = storedName();
    this.color = '#4c9ae8';
    this.room = null;
    this.mode = null;
    this.seed = 0;
    this.rng = mulberry32(1);
    this.players = {};       // id -> {id, name, color, meta}
    this.states = {};        // id -> {prev, curr, prevT, currT}
    this.scores = {};        // id -> display value in the player list
    this.active = false;     // an online session is running
    this.typing = false;
    this.clockOffset = 0;    // serverNow() = Date.now() + clockOffset
    this.ping = null;

    this._queued = false;
    this._retry = 0;
    this._closing = false;
    this._pendingState = null;
    this._lastSent = 0;
    this._stateTimer = null;
    this._bubbles = {};
    this._panel = null;
    this._wantMode = null;
    this._wantCode = null;

    this._build();
    this._bindKeyGuard();
  }

  Session.prototype = {

    // --- DOM -------------------------------------------------------------

    _build: function () {
      loadFonts();
      var self = this;
      var opts = this.opts;
      var root = el('div', 'mp-root');
      this.root = root;

      // Launcher
      var launch = el('button', 'mp-launch');
      launch.type = 'button';
      this.pip = el('span', 'mp-pip');
      this.pip.setAttribute('data-empty', '1');
      launch.appendChild(this.pip);
      launch.appendChild(el('span', null, 'Play online'));
      this.launchCount = el('span', 'mp-launch-count', '');
      launch.appendChild(this.launchCount);
      launch.addEventListener('click', function () {
        self.openLobby();
      });
      this.launch = launch;
      root.appendChild(launch);

      // Lobby
      var scrim = el('div', 'mp-scrim');
      scrim.hidden = true;
      this.scrim = scrim;
      scrim.addEventListener('mousedown', function (e) {
        if (e.target === scrim && !self._queued) self.closeLobby();
      });

      var lobby = el('div', 'mp-panel mp-lobby');
      this.lobby = lobby;
      scrim.appendChild(lobby);
      root.appendChild(scrim);

      // In-game rail
      var rail = el('div', 'mp-panel mp-rail');
      rail.hidden = true;
      this.rail = rail;

      var head = el('div', 'mp-rail-head');
      this.roomCode = el('span', 'mp-room-code', '');
      head.appendChild(this.roomCode);
      this.pingEl = el('span', 'mp-ping', '');
      head.appendChild(this.pingEl);
      var leaveBtn = el('button', 'mp-icon-btn', '✕');
      leaveBtn.type = 'button';
      leaveBtn.title = 'Leave online play';
      leaveBtn.setAttribute('aria-label', 'Leave online play');
      leaveBtn.addEventListener('click', function () {
        self.leave();
      });
      head.appendChild(leaveBtn);
      rail.appendChild(head);

      this.playerList = el('ul', 'mp-players');
      rail.appendChild(this.playerList);

      this.log = el('div', 'mp-log');
      rail.appendChild(this.log);

      this.emoteRow = el('div', 'mp-emotes');
      rail.appendChild(this.emoteRow);

      var say = el('form', 'mp-say');
      this.chatInput = el('input', 'mp-input');
      this.chatInput.type = 'text';
      this.chatInput.maxLength = 200;
      this.chatInput.placeholder = 'Say something';
      this.chatInput.setAttribute('aria-label', 'Chat message');
      say.appendChild(this.chatInput);
      var sendBtn = el('button', 'mp-icon-btn', '↵');
      sendBtn.type = 'submit';
      sendBtn.setAttribute('aria-label', 'Send message');
      say.appendChild(sendBtn);
      say.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = self.chatInput.value.trim();
        if (!text) return;
        self.chat(text);
        self.chatInput.value = '';
      });
      rail.appendChild(say);
      root.appendChild(rail);

      // Countdown, result, toast
      this.countEl = el('div', 'mp-count');
      this.countEl.hidden = true;
      root.appendChild(this.countEl);

      this.result = el('div', 'mp-panel mp-result');
      this.result.hidden = true;
      root.appendChild(this.result);

      this.toastEl = el('div', 'mp-toast');
      this.toastEl.hidden = true;
      root.appendChild(this.toastEl);

      // Some games park their own HUD top-right; let an adapter move ours.
      if (opts.launchStyle) {
        for (var key in opts.launchStyle) launch.style[key] = opts.launchStyle[key];
      }

      var mount = function () {
        (opts.mount || document.body).appendChild(root);
      };
      if (document.body) mount();
      else document.addEventListener('DOMContentLoaded', mount);
    },

    // Typing in chat must not also drive the game. A capture-phase listener on
    // window sees the event before the game's own document/window handlers and
    // stops it dead when it came from our input.
    _bindKeyGuard: function () {
      var self = this;
      var guard = function (e) {
        if (!self.typing) return;
        if (e.target === self.chatInput || (self.root && self.root.contains(e.target))) {
          e.stopImmediatePropagation();
        }
      };
      window.addEventListener('keydown', guard, true);
      window.addEventListener('keyup', guard, true);
      window.addEventListener('keypress', guard, true);

      this.chatInput.addEventListener('focus', function () { self.typing = true; });
      this.chatInput.addEventListener('blur', function () { self.typing = false; });
      // Escape hands the keyboard back to the game.
      this.chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') self.chatInput.blur();
      });
    },

    // --- lobby screens ----------------------------------------------------

    openLobby: function () {
      this.scrim.hidden = false;
      this.connect();
      this._renderLobby();
    },

    closeLobby: function () {
      this.scrim.hidden = true;
      if (!this.active) this._disconnectIfIdle();
    },

    _lobbyShell: function (heading) {
      var self = this;
      this.lobby.innerHTML = '';
      var head = el('div', 'mp-lobby-head');
      var left = el('div');
      left.appendChild(el('p', 'mp-eyebrow', this.title + ' · online'));
      left.appendChild(el('h2', null, heading));
      head.appendChild(left);
      var close = el('button', 'mp-close', '✕');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', function () {
        if (self._queued) self.unqueue();
        self.closeLobby();
      });
      head.appendChild(close);
      this.lobby.appendChild(head);
      return this.lobby;
    },

    _renderLobby: function () {
      var self = this;
      var body = this._lobbyShell('Play with other people');

      var field = el('div', 'mp-field');
      var label = el('label', 'mp-eyebrow', 'Your name');
      label.htmlFor = 'mp-name-input';
      field.appendChild(label);
      var input = el('input', 'mp-input');
      input.id = 'mp-name-input';
      input.type = 'text';
      input.maxLength = 16;
      input.placeholder = 'Guest';
      input.value = this.name;
      input.addEventListener('input', function () {
        self.name = input.value;
      });
      field.appendChild(input);
      body.appendChild(field);

      var modes = el('div', 'mp-modes');
      if (this.modes.indexOf('arena') >= 0) {
        modes.appendChild(this._modeButton('circle', this.opts.arenaTitle || 'Open slope',
          this.opts.arenaNote || 'Share one world with everyone online.', 'arena'));
      }
      if (this.modes.indexOf('versus') >= 0) {
        modes.appendChild(this._modeButton('diamond', this.opts.versusTitle || 'Head to head',
          this.opts.versusNote || 'Get matched against one other player.', 'versus'));
      }
      body.appendChild(modes);

      var codeRow = el('div', 'mp-row');
      var code = el('input', 'mp-input');
      code.type = 'text';
      code.maxLength = 6;
      code.placeholder = 'Room code';
      code.setAttribute('aria-label', 'Room code');
      code.style.textTransform = 'uppercase';
      codeRow.appendChild(code);
      var joinBtn = el('button', 'mp-btn mp-btn-quiet', 'Join');
      joinBtn.type = 'button';
      joinBtn.style.width = 'auto';
      joinBtn.addEventListener('click', function () {
        var value = code.value.trim().toUpperCase();
        if (!value) {
          self._showError('Enter a room code, or pick a mode above.');
          return;
        }
        self._go(self.modes.indexOf('arena') >= 0 ? 'arena' : 'versus', value);
      });
      codeRow.appendChild(joinBtn);
      body.appendChild(codeRow);

      body.appendChild(el('p', 'mp-hint', 'Share a room code to play with people you know.'));

      this.errorEl = el('p', 'mp-error');
      this.errorEl.hidden = true;
      body.appendChild(this.errorEl);
    },

    _modeButton: function (shape, title, note, mode) {
      var self = this;
      var btn = el('button', 'mp-mode');
      btn.type = 'button';
      btn.appendChild(el('span', 'mp-marker mp-marker-' + shape));
      var text = el('span', 'mp-mode-text');
      text.appendChild(el('strong', null, title));
      text.appendChild(el('span', null, note));
      btn.appendChild(text);
      btn.addEventListener('click', function () {
        self._go(mode, '');
      });
      return btn;
    },

    _go: function (mode, code) {
      this.name = (this.name || '').trim() || 'Guest';
      storeName(this.name);
      this._qn = null;
      this._qplace = null;
      this._wantMode = mode;
      this._wantCode = code;
      this.connect();
      if (this.ws && this.ws.readyState === 1) this._sendIntent();
      else this._renderConnecting();
    },

    _sendIntent: function () {
      if (!this._wantMode) return;
      this._say({ t: 'hello', name: this.name, meta: this.opts.meta || {} });
      if (this._wantMode === 'arena') {
        this._say({ t: 'arena', code: this._wantCode || '' });
        this._renderConnecting();
      } else if (this._wantCode) {
        this._say({ t: 'invite', code: this._wantCode });
        this._renderWaitingRoom();
      } else {
        this._say({ t: 'queue' });
        this._queued = true;
        this._renderQueue(1, 2);
      }
      this._wantMode = null;
      this._wantCode = null;
    },

    _renderConnecting: function () {
      var body = this._lobbyShell('Connecting');
      body.appendChild(el('p', 'mp-hint', 'Reaching the server…'));
    },

    // The signature screen: the lift line.
    _renderQueue: function (n, need, place) {
      var self = this;
      var body = this._lobbyShell('Waiting for a match');
      var mine = (place || 1) - 1;

      var lift = el('div', 'mp-lift');
      var shown = Math.max(1, Math.min(n, 6));
      for (var i = 0; i < shown; i++) {
        var chair = el('div', 'mp-chair');
        chair.style.setProperty('--mp-i', String(i));
        chair.style.animationDelay = -(i * (9 / 6)) + 's';
        var isYou = i === Math.min(mine, shown - 1);
        if (isYou) chair.setAttribute('data-you', '1');
        chair.appendChild(el('i'));
        chair.appendChild(el('b', null, isYou ? initials(this.name) : '·'));
        lift.appendChild(chair);
      }
      var status = el('div', 'mp-lift-status');
      status.appendChild(el('strong', null, n + ' / ' + need));
      status.appendChild(el('span', null, n >= need ? 'Starting…' :
        'in the lift line · need ' + (need - n) + ' more'));
      lift.appendChild(status);
      body.appendChild(lift);

      var cancel = el('button', 'mp-btn mp-btn-quiet', 'Leave the line');
      cancel.type = 'button';
      cancel.addEventListener('click', function () {
        self.unqueue();
        self._renderLobby();
      });
      body.appendChild(cancel);
      body.appendChild(el('p', 'mp-hint', 'Open this game in another tab to fill the line yourself.'));
    },

    _renderWaitingRoom: function () {
      var self = this;
      var body = this._lobbyShell('Private room');
      var codeText = this.room ? this.room.code : (this._wantCode || '…');
      var big = el('div', 'mp-lift-status');
      big.style.position = 'static';
      big.appendChild(el('strong', null, codeText));
      big.appendChild(el('span', null, 'Send this code to whoever you want to play'));
      body.appendChild(big);
      body.appendChild(el('div', null, ' '));
      var cancel = el('button', 'mp-btn mp-btn-quiet', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', function () {
        self.leave();
        self._renderLobby();
      });
      body.appendChild(cancel);
    },

    _renderReady: function () {
      var self = this;
      var others = this.otherPlayers();
      var who = others.length ? others.map(function (p) { return p.name; }).join(', ') : 'your opponent';
      var body = this._lobbyShell('Match found');
      body.appendChild(el('p', 'mp-hint', 'You’re up against ' + who + '.'));
      var ready = el('button', 'mp-btn', 'I’m ready');
      ready.type = 'button';
      ready.addEventListener('click', function () {
        self._say({ t: 'ready', v: true });
        ready.disabled = true;
        ready.textContent = 'Waiting for ' + who + '…';
        ready.style.opacity = '0.7';
        ready.style.cursor = 'default';
      });
      body.appendChild(ready);
      var out = el('button', 'mp-btn mp-btn-quiet', 'Back out');
      out.type = 'button';
      out.style.marginTop = '9px';
      out.addEventListener('click', function () {
        self.leave();
        self._renderLobby();
      });
      body.appendChild(out);
    },

    _showError: function (message) {
      if (!this.errorEl) return;
      this.errorEl.textContent = message;
      this.errorEl.hidden = false;
    },

    // --- socket -----------------------------------------------------------

    connect: function () {
      if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
      var self = this;
      this._closing = false;
      var ws;
      try {
        ws = new WebSocket(serverUrl(this.game));
      } catch (e) {
        this._showError('Could not reach the game server.');
        return;
      }
      this.ws = ws;

      ws.onopen = function () {
        self._retry = 0;
        self._say({ t: 'hello', name: self.name || 'Guest', meta: self.opts.meta || {} });
        self._sendIntent();
        self._startPing();
      };

      ws.onmessage = function (e) {
        var msg;
        try {
          msg = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        self._handle(msg);
      };

      ws.onclose = function () {
        self._stopPing();
        if (self._closing) return;
        if (self.active || self._queued) {
          self._sys('Connection lost. Reconnecting…');
          var wait = RECONNECT_MS[Math.min(self._retry, RECONNECT_MS.length - 1)];
          self._retry++;
          setTimeout(function () {
            if (!self._closing) self.connect();
          }, wait);
        }
      };

      ws.onerror = function () {
        if (!self.active) self._showError('Could not reach the game server. Try again in a moment.');
      };
    },

    _say: function (obj) {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify(obj));
        return true;
      }
      return false;
    },

    _startPing: function () {
      var self = this;
      this._stopPing();
      var beat = function () {
        self._pingSentAt = Date.now();
        self._say({ t: 'ping', c: self._pingSentAt });
      };
      beat();
      this._pingTimer = setInterval(beat, 5000);
    },

    _stopPing: function () {
      if (this._pingTimer) clearInterval(this._pingTimer);
      this._pingTimer = null;
    },

    _handle: function (msg) {
      switch (msg.t) {
        case 'welcome':
          this.id = msg.id;
          this.color = msg.color;
          this.clockOffset = msg.now - Date.now();
          break;

        case 'you':
          this.id = msg.id;
          this.name = msg.name;
          this.color = msg.color;
          break;

        case 'count':
          this._setCount(msg.online, msg.queued);
          break;

        case 'queue':
          this._queued = true;
          // Only rebuild when the numbers actually move, otherwise the chairs
          // restart their ride every few seconds.
          if (!this.scrim.hidden && (this._qn !== msg.n || this._qplace !== msg.place)) {
            this._qn = msg.n;
            this._qplace = msg.place;
            this._renderQueue(msg.n, msg.need, msg.place);
          }
          break;

        case 'match':
          this._queued = false;
          this.mode = 'versus';
          this.room = { code: msg.code, mode: 'versus' };
          this.seed = msg.seed;
          this.rng = mulberry32(msg.seed);
          this._setPlayers(msg.players);
          this.scrim.hidden = false;
          this._renderReady();
          break;

        case 'room':
          this.room = msg;
          this.mode = msg.mode;
          this.seed = msg.seed;
          this.rng = mulberry32(msg.seed);
          this._setPlayers(msg.players);
          if (msg.mode === 'arena') {
            if (!this.active) this._begin('arena');
            this._renderPlayers();
          } else {
            this._renderPlayers();
            if (!this.active && !this.scrim.hidden) {
              if (msg.players.length >= msg.cap) this._renderReady();
              else this._renderWaitingRoom();
            }
          }
          this._emit('onRoom', [msg]);
          break;

        case 'joined':
          this.players[msg.p.id] = msg.p;
          this._sys(msg.p.name + ' joined');
          this._renderPlayers();
          // Games that only send state when something happens (a card dealt, a
          // bet placed) would otherwise be invisible to whoever just walked in.
          if (this.active && this._lastState != null) this._pendingState = this._lastState;
          this._emit('onJoin', [msg.p]);
          if (this.mode === 'versus' && !this.active && !this.scrim.hidden) this._renderReady();
          break;

        case 'left':
          this._sys((msg.name || 'A player') + ' left');
          delete this.players[msg.id];
          delete this.states[msg.id];
          delete this.scores[msg.id];
          this._dropBubble(msg.id);
          this._renderPlayers();
          this._emit('onLeave', [msg.id]);
          break;

        case 'ready':
          if (this.players[msg.id]) {
            this._sys(this.players[msg.id].name + (msg.v ? ' is ready' : ' is not ready'));
          }
          break;

        case 'start':
          this.seed = msg.seed;
          this.rng = mulberry32(msg.seed);
          this._countdownTo(msg.at);
          break;

        case 's': {
          var slot = this.states[msg.id];
          var t = Date.now();
          if (!slot) {
            this.states[msg.id] = { prev: msg.d, curr: msg.d, prevT: t, currT: t };
          } else {
            slot.prev = slot.curr;
            slot.prevT = slot.currT;
            slot.curr = msg.d;
            slot.currT = t;
          }
          this._emit('onState', [msg.id, msg.d, this.players[msg.id]]);
          break;
        }

        case 'e':
          this._emit('onEvent', [msg.id, msg.k, msg.d, this.players[msg.id]]);
          break;

        case 'chat':
          this._logChat(msg);
          this._emit('onChat', [msg]);
          break;

        case 'left_room':
          break;

        case 'pong':
          if (msg.c === this._pingSentAt) {
            this.ping = Date.now() - msg.c;
            // One-way delay is roughly half the round trip.
            this.clockOffset = msg.s + this.ping / 2 - Date.now();
            if (this.pingEl) this.pingEl.textContent = this.ping + ' ms';
          }
          break;

        case 'error':
          this._showError(msg.m);
          this.toast(msg.m);
          break;

        default:
          break;
      }
    },

    // --- session lifecycle ------------------------------------------------

    // Timer-driven, not requestAnimationFrame-driven: browsers freeze rAF in a
    // background tab, and a player who alt-tabs while waiting for the countdown
    // would otherwise never get their match started.
    _countdownTo: function (at) {
      var self = this;
      this.scrim.hidden = true;
      this._begin('versus', true);
      clearInterval(this._countTimer);
      var fire = function () {
        clearInterval(self._countTimer);
        self._countTimer = null;
        self.countEl.hidden = true;
        self._emit('onStart', [self.context()]);
      };
      var tick = function () {
        var left = at - self.serverNow();
        if (left <= 0) {
          fire();
          return;
        }
        self.countEl.hidden = false;
        self.countEl.textContent = String(Math.ceil(left / 1000));
      };
      tick();
      this._countTimer = setInterval(tick, 100);
      // Belt and braces: even if the clock offset is wildly off, the match starts.
      clearTimeout(this._countFallback);
      this._countFallback = setTimeout(function () {
        if (self._countTimer) fire();
      }, Math.max(0, at - this.serverNow()) + 1200);
    },

    _begin: function (mode, deferStart) {
      this.mode = mode;
      this.active = true;
      this.scrim.hidden = true;
      this.launch.hidden = true;
      this.rail.hidden = false;
      // Games reflow around the rail by styling html.mp-online in their adapter.
      document.documentElement.classList.add('mp-online');
      this.result.hidden = true;
      this._renderPlayers();
      this._renderEmotes();
      if (this.room) {
        this.roomCode.textContent = (this.room.private || mode === 'versus' ? 'Room ' : '') +
          (this.room.code || '');
      }
      this._startStateLoop();
      if (!deferStart) this._emit('onStart', [this.context()]);
    },

    leave: function () {
      var wasActive = this.active;
      this._say({ t: 'leave' });
      this.active = false;
      this._queued = false;
      this.room = null;
      this.mode = null;
      this.players = {};
      this.states = {};
      this.scores = {};
      this._lastState = null;
      this._stopStateLoop();
      this._clearBubbles();
      clearInterval(this._countTimer);
      clearTimeout(this._countFallback);
      this._countTimer = null;
      this.rail.hidden = true;
      this.launch.hidden = false;
      document.documentElement.classList.remove('mp-online');
      this.result.hidden = true;
      this.countEl.hidden = true;
      if (this._panel) this._panel.root.hidden = true;
      this.log.innerHTML = '';
      this.scrim.hidden = true;
      if (wasActive) this._emit('onStop', []);
      this._disconnectIfIdle();
    },

    unqueue: function () {
      this._queued = false;
      this._say({ t: 'unqueue' });
    },

    _disconnectIfIdle: function () {
      if (this.active || this._queued) return;
      // Stay connected while the lobby is open so the live count keeps updating.
      if (!this.scrim.hidden) return;
      this._closing = true;
      if (this.ws) {
        try { this.ws.close(); } catch (e) { /* already gone */ }
      }
      this._stopPing();
    },

    // --- outbound ---------------------------------------------------------

    _startStateLoop: function () {
      var self = this;
      this._stopStateLoop();
      this._stateTimer = setInterval(function () {
        if (self._pendingState == null) return;
        self._say({ t: 's', d: self._pendingState });
        self._pendingState = null;
      }, 1000 / STATE_HZ);
    },

    _stopStateLoop: function () {
      if (this._stateTimer) clearInterval(this._stateTimer);
      this._stateTimer = null;
      this._pendingState = null;
    },

    /** Queue a state snapshot. Latest wins; the loop drains at STATE_HZ. */
    send: function (data) {
      if (!this.active) return;
      this._pendingState = data;
      this._lastState = data;
    },

    /** Send an event now. Use for discrete things: a death, a line clear, a goal. */
    event: function (kind, data) {
      if (!this.active) return;
      this._say({ t: 'e', k: kind, d: data == null ? {} : data });
    },

    chat: function (text) {
      if (!this.active) return;
      this._say({ t: 'chat', m: text });
      // Echo locally: the server only relays to other people.
      this._logChat({ id: this.id, name: this.name, color: this.color, m: text });
    },

    // --- inbound rendering ------------------------------------------------

    _setCount: function (online, queued) {
      var others = Math.max(0, online - 1);
      this.pip.setAttribute('data-empty', others > 0 ? '0' : '1');
      if (others > 0) {
        this.launchCount.textContent = others + (queued ? ' · ' + queued + ' in line' : '');
      } else {
        this.launchCount.textContent = '';
      }
    },

    _setPlayers: function (list) {
      this.players = {};
      for (var i = 0; i < list.length; i++) this.players[list[i].id] = list[i];
    },

    otherPlayers: function () {
      var out = [];
      for (var id in this.players) {
        if (id !== this.id) out.push(this.players[id]);
      }
      return out;
    },

    opponent: function () {
      var others = this.otherPlayers();
      return others.length ? others[0] : null;
    },

    /** Display value shown beside a player in the rail (score, laps, depth...). */
    setScore: function (id, value) {
      this.scores[id] = value;
      this._renderPlayers();
    },

    _renderPlayers: function () {
      var list = this.playerList;
      list.innerHTML = '';
      var ids = Object.keys(this.players);
      if (this.id && ids.indexOf(this.id) < 0) ids.unshift(this.id);
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var p = this.players[id] || { id: id, name: this.name, color: this.color };
        var li = el('li');
        if (id === this.id) li.setAttribute('data-you', '1');
        var dot = el('span', 'mp-dot');
        dot.style.background = p.color;
        li.appendChild(dot);
        li.appendChild(el('span', 'mp-name', p.name + (id === this.id ? ' (you)' : '')));
        if (this.scores[id] != null) li.appendChild(el('span', 'mp-score', String(this.scores[id])));
        list.appendChild(li);
      }
    },

    _renderEmotes: function () {
      var self = this;
      this.emoteRow.innerHTML = '';
      this.emotes.forEach(function (text) {
        var btn = el('button', 'mp-emote', text);
        btn.type = 'button';
        btn.addEventListener('click', function () {
          self.chat(text);
        });
        self.emoteRow.appendChild(btn);
      });
    },

    _logChat: function (msg) {
      var p = el('p');
      var from = el('span', 'mp-from', (msg.name || 'Player') + ': ');
      from.style.color = msg.color || 'inherit';
      p.appendChild(from);
      p.appendChild(document.createTextNode(msg.m));
      this._append(p);
      if (msg.id && msg.id !== this.id) this._bubble(msg.id, msg.m);
    },

    _sys: function (text) {
      this._append(el('p', 'mp-sys', text));
    },

    _append: function (node) {
      this.log.appendChild(node);
      while (this.log.childNodes.length > 60) this.log.removeChild(this.log.firstChild);
      this.log.scrollTop = this.log.scrollHeight;
    },

    // --- world-anchored speech bubbles ------------------------------------

    _bubble: function (id, text) {
      var self = this;
      this._dropBubble(id);
      var node = el('div', 'mp-bubble', text);
      node.style.display = 'none';
      this.root.appendChild(node);
      this._bubbles[id] = {
        node: node,
        until: Date.now() + 4500,
      };
      setTimeout(function () {
        self._dropBubble(id);
      }, 4500);
    },

    _dropBubble: function (id) {
      var b = this._bubbles[id];
      if (!b) return;
      if (b.node.parentNode) b.node.parentNode.removeChild(b.node);
      delete this._bubbles[id];
    },

    _clearBubbles: function () {
      for (var id in this._bubbles) this._dropBubble(id);
    },

    /**
     * Park a player's speech bubble at a screen position. Adapters call this
     * each frame with wherever that player currently is on screen; pass null
     * when they're off screen.
     */
    placeBubble: function (id, x, y) {
      var b = this._bubbles[id];
      if (!b) return;
      if (x == null || y == null) {
        b.node.style.display = 'none';
        return;
      }
      b.node.style.display = '';
      b.node.style.left = Math.round(x) + 'px';
      b.node.style.top = Math.round(y) + 'px';
    },

    // --- remote state -----------------------------------------------------

    /** Latest raw snapshot from a player. */
    stateOf: function (id) {
      var slot = this.states[id];
      return slot ? slot.curr : null;
    },

    /**
     * Snapshot interpolated INTERP_DELAY ms in the past, so remote players move
     * smoothly instead of teleporting between packets. Numeric fields are
     * blended; everything else comes from the newer snapshot.
     */
    smooth: function (id) {
      var slot = this.states[id];
      if (!slot) return null;
      var span = slot.currT - slot.prevT;
      if (span <= 0) return slot.curr;
      var t = (Date.now() - INTERP_DELAY - slot.prevT) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var out = {};
      for (var k in slot.curr) {
        var a = slot.prev[k];
        var b = slot.curr[k];
        out[k] = (typeof a === 'number' && typeof b === 'number') ? a + (b - a) * t : b;
      }
      return out;
    },

    /** Every other player's smoothed state, as [{player, state}]. */
    remotes: function () {
      var out = [];
      var others = this.otherPlayers();
      for (var i = 0; i < others.length; i++) {
        var s = this.smooth(others[i].id);
        if (s) out.push({ player: others[i], state: s });
      }
      return out;
    },

    // --- versus panel -----------------------------------------------------

    /**
     * The shared "watch your opponent" frame. The adapter supplies draw(), which
     * renders one opponent snapshot into a canvas; everything around it (name,
     * colour, stat line, empty state) is the same in every game so the arcade
     * reads as one product.
     */
    versusPanel: function (config) {
      var self = this;
      if (this._panel) return this._panel;
      var root = el('div', 'mp-panel mp-versus');
      root.hidden = true;
      root.appendChild(el('p', 'mp-eyebrow', config.label || 'Opponent'));
      var head = el('div', 'mp-versus-head');
      var dot = el('span', 'mp-dot');
      var name = el('span', 'mp-name', '—');
      head.appendChild(dot);
      head.appendChild(name);
      root.appendChild(head);
      var canvas = el('canvas');
      canvas.width = config.width || 160;
      canvas.height = config.height || 200;
      root.appendChild(canvas);
      var stats = el('div', 'mp-versus-stats');
      root.appendChild(stats);
      var note = el('p', 'mp-versus-note');
      note.hidden = true;
      root.appendChild(note);
      this.root.appendChild(root);

      var panel = {
        root: root,
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        show: function () { root.hidden = false; },
        hide: function () { root.hidden = true; },
        note: function (text) {
          note.hidden = !text;
          note.textContent = text || '';
        },
        stats: function (pairs) {
          stats.innerHTML = '';
          (pairs || []).forEach(function (pair) {
            stats.appendChild(el('span', null, pair));
          });
        },
        /** Redraw from the opponent's newest snapshot. Safe to call every frame. */
        paint: function () {
          var foe = self.opponent();
          if (!foe) {
            name.textContent = 'Waiting…';
            dot.style.background = 'transparent';
            panel.ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
          }
          name.textContent = foe.name;
          dot.style.background = foe.color;
          var state = self.stateOf(foe.id);
          panel.ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (state && config.draw) {
            config.draw(panel.ctx, state, {
              width: canvas.width,
              height: canvas.height,
              player: foe,
            });
          }
        },
      };
      this._panel = panel;
      return panel;
    },

    // --- results ----------------------------------------------------------

    showResult: function (config) {
      var self = this;
      this.result.innerHTML = '';
      this.result.setAttribute('data-win', config.win ? '1' : '0');
      this.result.appendChild(el('p', 'mp-eyebrow', config.label || (this.title + ' · online')));
      this.result.appendChild(el('h3', null, config.title || (config.win ? 'You win' : 'You lose')));
      this.result.appendChild(el('p', null, config.note || ''));
      var again = el('button', 'mp-btn', config.againLabel || 'Play again');
      again.type = 'button';
      again.addEventListener('click', function () {
        self.result.hidden = true;
        if (config.onAgain) config.onAgain();
        else self._say({ t: 'ready', v: true });
      });
      this.result.appendChild(again);
      var out = el('button', 'mp-btn mp-btn-quiet', 'Leave');
      out.type = 'button';
      out.style.marginTop = '9px';
      out.addEventListener('click', function () {
        self.leave();
      });
      this.result.appendChild(out);
      this.result.hidden = false;
    },

    hideResult: function () {
      this.result.hidden = true;
    },

    toast: function (text, ms) {
      var self = this;
      this.toastEl.textContent = text;
      this.toastEl.hidden = false;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(function () {
        self.toastEl.hidden = true;
      }, ms || 2600);
    },

    // --- misc -------------------------------------------------------------

    serverNow: function () {
      return Date.now() + this.clockOffset;
    },

    context: function () {
      return {
        mode: this.mode,
        seed: this.seed,
        rng: this.rng,
        players: this.players,
        you: this.id,
        room: this.room,
      };
    },

    _emit: function (name, args) {
      var fn = this.opts[name];
      if (typeof fn !== 'function') return;
      try {
        fn.apply(this, args);
      } catch (e) {
        // A broken adapter shouldn't take down the socket or the game.
        if (global.console) console.error('[mp] ' + name + ' failed', e);
      }
    },
  };

  global.MP = {
    create: function (opts) {
      var session = new Session(opts);
      // One session per page. Exposed for debugging from the console.
      global.__mpSession = session;
      return session;
    },
    rngFrom: mulberry32,
    /** Per-game CSS, usually a rule that reflows the layout around the rail. */
    style: function (css) {
      var tag = el('style');
      tag.textContent = css;
      (document.head || document.documentElement).appendChild(tag);
      return tag;
    },
  };
})(window);
