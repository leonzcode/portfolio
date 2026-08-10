# Online play

The shared multiplayer layer for the games in `public/legacy/`. Added August 2026.

## How it fits together

```
legacy/<game>.html
  ├── <link href="/legacy/mp/mp.css">        shared UI styling
  ├── ... the game, untouched ...
  ├── <script src="/legacy/mp/mp.js">        SDK: socket, lobby, chat, rail
  ├── <script src="/legacy/mp/three-avatars.js">   (3D games only)
  └── <script src="/legacy/mp/games/<slug>.js">    per-game adapter
                    │
                    └──► wss://apps.leonzhao.dev/mp/ws?game=<slug>
                         (mlhub/apps/mp/server.js on the Hetzner box)
```

The server is a **relay**, not a referee. It owns identity, rooms, matchmaking
and fan-out; it never simulates a game. Each client sends its own state and the
server passes it on. For a portfolio arcade that trade is right: cheating isn't
a threat model, and one small service carries eighteen unrelated games.

## Two shapes

**Arena** — one shared world, everyone sees everyone. Used by the simulation and
party games: `ski`, `leonski2`, `blackjoy`, `coconut`, `imposter`, `castlefall`,
`blackjack`.

**Versus** — a queue pairs you with one other player into a private match. Used
by the head-to-head games: `leon-2048`, `tetris`, `platformer`, `snake`, `pong`,
`tennis`, `car`, `slope`, `wordle-game`, `clash`, `basket`.

Both carry chat, per-game quick emotes, a live player list, and private rooms by
4-letter code.

## Why matches are fair

The server generates one `seed` per match and sends it to both players. Adapters
feed it into `MP.rngFrom(seed)` and use that instead of `Math.random` for
anything that shapes the game: the tetromino order, the 2048 letter stream, the
platformer's course, Slope's floor layout, Snake's apples. Same seed, same game.

## Adding online play to a game

1. Add the slug to `GAMES` in `mlhub/apps/mp/server.js` with `arena: {cap}`
   and/or `versus: {need}`.
2. Write `games/<slug>.js`. Adapters run as a classic script **after** the game,
   so top-level `let`/`const`/`function` from the game's own script are in scope
   by name, and its functions can be wrapped:

   ```js
   var realDraw = window.draw;
   window.draw = function () { realDraw.apply(this, arguments); drawGhosts(); };
   ```

3. Add the three tags to the game's HTML, after its own `<script>`.

Prefer wrapping over editing. Where the game had to change, it was kept to the
smallest possible seam — Tetris exports `getPlayers()`, the platformer routes its
course randomness through a swappable `platRand`, Leonski 2 publishes
`window.__leonski2`.

### Gotchas worth knowing

- **Module games.** `<script type="module">` scope is sealed. leonski2 publishes
  a `window.__leonski2` object of getters; anything similar needs the same.
- **Background tabs freeze `requestAnimationFrame`.** Anything that must keep
  running when the player tabs away (countdowns, board setup) uses timers.
- **Don't round-trip these HTML files through PowerShell** `Get-Content` /
  `Set-Content`; it double-encodes their UTF-8. Use an editor or Node.
- **Chat must not drive the game.** The SDK installs a capture-phase key guard
  while the chat box is focused, so typing "wasd" doesn't move anything.

## Files

| File | What it is |
|---|---|
| `mp.js` | SDK: connection, lobby, matchmaking UI, chat rail, versus panel, interpolation |
| `mp.css` | All the shared UI. Ski-resort signage: trail markers for players, a chairlift for the queue |
| `three-avatars.js` | Remote players in a Three.js scene — cloned from the game's own player model, name labels, screen projection for chat bubbles |
| `games/<slug>.js` | One adapter per game |
| `games/room.js` | Config-driven fallback for games whose internals sit inside a closure or module. Gives the room, presence, live status and chat, but not action-level sync |

`window.__mpSession` is the live session object, handy from the console.
