/* Leon Clash: one match on screen. Runs the sim at 20 ticks a second, takes your
   plays (drag a card onto the field, or tap a card then tap the field, or keys
   1 to 4), and draws through render.js. Against a bot everything is local; online
   the server stamps every play with a tick and this page only steps up to the
   tick the server has confirmed, so both pages run exactly the same match. */
import { makeRenderer } from "./render.js?v=1";
import { makeBot } from "./bot.js?v=1";
import { drawCardArt } from "./art.js?v=1";

const RARE_SIGN = { common: "circle", rare: "square", epic: "diamond", legend: "double" };

export function ticketHTML(card, opts) {
  opts = opts || {};
  const sign = RARE_SIGN[card.rarity];
  return '<span class="tk-art" data-art="' + card.id + '"></span>' +
    '<span class="tk-cost" aria-label="' + card.cost + ' cocoa">' + card.cost + "</span>" +
    '<span class="tk-sign tk-' + sign + '" aria-hidden="true"></span>' +
    (opts.name === false ? "" : '<span class="tk-name">' + card.name + "</span>");
}
// paint card portraits into every empty art slot under root
export function paintArt(root) {
  for (const el of root.querySelectorAll(".tk-art[data-art]")) {
    if (el.dataset.done === el.dataset.art) continue;
    const id = el.dataset.art;
    let cv = el.querySelector("canvas");
    if (!cv) { cv = document.createElement("canvas"); el.appendChild(cv); }
    cv.width = 96; cv.height = 96;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, 96, 96);
    if (drawCardArt(g, id, 0, 0, 96, 96)) el.dataset.done = id;
    else { el.classList.add("tk-noart"); el.textContent = ""; el.dataset.done = id; el.setAttribute("data-glyph", id.slice(0, 2).toUpperCase()); }
  }
}

export function startBattle(o) {
  const sim = o.sim, R = sim.R;
  const root = o.root;
  const mySide = o.mySide || 0, foe = 1 - mySide;
  const audio = o.audio;
  const settings = o.settings || {};
  root.innerHTML = "";
  root.classList.add("bt");
  root.innerHTML =
    '<div class="bt-field"><canvas class="bt-canvas" aria-label="The field"></canvas>' +
    '<div class="bt-top"><div class="bt-foe"><span class="bt-name bt-foename"></span><span class="bt-tag bt-foetag"></span></div>' +
    '<div class="bt-clock" role="timer"><span class="bt-time">3:00</span><span class="bt-mode"></span></div>' +
    '<button class="bt-menu" aria-label="Match menu">&#9776;</button></div>' +
    '<div class="bt-flags" aria-live="polite"><span class="bt-fl bt-flfoe" title="Their flags">0</span><span class="bt-fl bt-flme" title="Your flags">0</span></div>' +
    '<div class="bt-toast" role="status"></div>' +
    '<div class="bt-bubble bt-bubfoe"></div><div class="bt-bubble bt-bubme"></div>' +
    '<button class="bt-ability" hidden><span class="bt-abring"></span><span class="bt-abname"></span></button>' +
    '<button class="bt-emote" aria-label="Emotes">&#128172;</button><div class="bt-emotes" hidden></div>' +
    '<div class="bt-menubox" hidden><button data-a="resume">Back to the match</button><button data-a="mute"></button><button data-a="quit" class="danger">Give up</button></div>' +
    "</div>" +
    '<div class="bt-tray"><div class="bt-next"><span class="bt-nextlab">Next</span><div class="ticket mini bt-nextcard"></div></div>' +
    '<div class="bt-hand"></div>' +
    '<div class="bt-cocoa"><span class="bt-mug"><span class="bt-cn">5</span></span><div class="bt-bar"><div class="bt-fill"></div><div class="bt-ticks"></div></div></div></div>';
  const $ = (s) => root.querySelector(s);
  const canvas = $(".bt-canvas"), field = $(".bt-field");
  const rnd = makeRenderer(canvas, sim, { reducedMotion: settings.reducedMotion });
  rnd.setView(mySide);
  const ticks = $(".bt-ticks");
  const fillEl = $(".bt-fill");
  for (let i = 1; i < 10; i++) { const t = document.createElement("i"); t.style.left = i * 10 + "%"; ticks.appendChild(t); }
  $(".bt-foename").textContent = o.names ? o.names[foe] : "Rival";
  $(".bt-foetag").textContent = o.foeTag || "";
  const hand = $(".bt-hand");
  for (let i = 0; i < 4; i++) {
    const b = document.createElement("button");
    b.className = "ticket bt-card"; b.dataset.i = i;
    b.innerHTML = '<span class="tk-key">' + (i + 1) + "</span>";
    hand.appendChild(b);
  }
  const em = $(".bt-emotes");
  for (const t of sim.DB.EMOTES) { const b = document.createElement("button"); b.textContent = t; em.appendChild(b); }

  let st = o.state || sim.create({ seed: o.seed, decks: o.decks });
  const prev = new Map();
  const queue = [];                 // local plays waiting for the next tick
  const online = new Map();         // tick -> [cmds] from the server
  let confirmed = o.mode === "online" ? 0 : Infinity;
  const bot = o.mode === "bot" && o.botLevel !== "none" ? makeBot(sim, foe, o.botLevel || "medium", (o.seed ^ 0x5bd1e995) >>> 0) : null;
  // a bot for your own side too (demos, tests)
  const auto = o.autoplay ? makeBot(sim, mySide, o.autoplay, (o.seed ^ 0x2545f491) >>> 0) : null;
  let stopped = false, raf = 0, last = 0, acc = 0, paused = false;
  let sel = -1;                     // selected hand slot
  let drag = null;                  // { card, side, x, y, i }
  let ended = false, endAt = 0;
  let handSig = "";
  let lastTime = "", lastCocoaN = -1, lastFill = "";
  let hashEvery = 40;
  const timing = { sim: 0, draw: 0, hud: 0, frames: 0, steps: 0 };

  function size() {
    const r = field.getBoundingClientRect();
    const top = root.querySelector(".bt-top").getBoundingClientRect();
    rnd.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1), Math.max(0, top.bottom - r.top) + 2);
  }
  size();
  const ro = new ResizeObserver(size); ro.observe(field);

  function toast(msg) {
    const t = $(".bt-toast");
    t.textContent = msg; t.classList.remove("on"); void t.offsetWidth; t.classList.add("on");
  }
  const WHY = { cocoa: "Not enough cocoa", zone: "You can't place it there", hand: "That card is not in your hand", alive: "Your legend is already out", ability: "Not ready yet", over: "The match is over" };

  /* ---------------- plays ---------------- */
  function submit(cmd) {
    if (ended) return;
    if (o.mode === "online") { o.net.send(cmd.k === "play" ? { t: "play", card: cmd.card, x: cmd.x, y: cmd.y } : cmd.k === "ab" ? { t: "ability" } : { t: "surrender" }); return; }
    queue.push(Object.assign({ s: mySide }, cmd));
  }
  function tryPlay(card, x, y) {
    const why = sim.canPlay(st, mySide, card, x, y);
    if (why) { toast(WHY[why] || "Not now"); audio && audio.play("nope"); return false; }
    submit({ k: "play", card, x, y });
    audio && audio.play("deploy");
    return true;
  }

  /* ---------------- input ---------------- */
  function worldAt(ev, touch) {
    const r = canvas.getBoundingClientRect();
    const px = (ev.clientX - r.left) * rnd.dpr, py = (ev.clientY - r.top - (touch ? 34 : 0)) * rnd.dpr;
    return rnd.toWorld(px, py);
  }
  function overField(ev) {
    const r = canvas.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  }
  function select(i) {
    sel = i;
    for (const b of hand.children) b.classList.toggle("sel", +b.dataset.i === i);
    if (i >= 0) drag = { card: st.sides[mySide].hand[i], side: mySide, i, x: null, y: null };
    else drag = null;
  }
  let down = null;
  hand.addEventListener("pointerdown", function (ev) {
    const b = ev.target.closest(".bt-card");
    if (!b || ended) return;
    ev.preventDefault();
    const i = +b.dataset.i;
    if (sel === i && !down) { select(-1); return; }
    select(i);
    down = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false, touch: ev.pointerType !== "mouse" };
    audio && audio.play("tap");
  });
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  function onMove(ev) {
    if (!down || ev.pointerId !== down.id || !drag) return;
    if (Math.abs(ev.clientX - down.x) + Math.abs(ev.clientY - down.y) > 8) down.moved = true;
    if (overField(ev)) { const w = worldAt(ev, down.touch); drag.x = w[0]; drag.y = w[1]; }
    else { drag.x = null; }
  }
  function onUp(ev) {
    if (!down || ev.pointerId !== down.id) return;
    const d = down; down = null;
    if (!drag) return;
    if (d.moved && overField(ev)) {
      const w = worldAt(ev, d.touch);
      if (tryPlay(drag.card, w[0], w[1])) select(-1);
      else { drag.x = null; }
    } else if (d.moved) {
      select(-1);
    }
  }
  canvas.addEventListener("pointerdown", function (ev) {
    if (sel < 0 || !drag || ended) return;
    ev.preventDefault();
    const w = worldAt(ev, false);
    drag.x = w[0]; drag.y = w[1];
    canvas.setPointerCapture(ev.pointerId);
    const move = function (e2) { const w2 = worldAt(e2, false); drag && (drag.x = w2[0], drag.y = w2[1]); };
    const up = function (e2) {
      canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up);
      if (!drag) return;
      const w2 = worldAt(e2, false);
      if (tryPlay(drag.card, w2[0], w2[1])) select(-1);
    };
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up);
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (sel >= 0 && drag && !down && ev.pointerType === "mouse") { const w = worldAt(ev, false); drag.x = w[0]; drag.y = w[1]; }
  });
  function onKey(ev) {
    if (ended || ev.target.tagName === "INPUT") return;
    if (ev.key >= "1" && ev.key <= "4") { select(+ev.key - 1); ev.preventDefault(); }
    else if (ev.key === "Escape") { if (sel >= 0) select(-1); else toggleMenu(); }
    else if (ev.key === "q" || ev.key === "Q") { $(".bt-ability").hidden || submit({ k: "ab" }); }
  }
  window.addEventListener("keydown", onKey);
  $(".bt-ability").addEventListener("click", function () { submit({ k: "ab" }); audio && audio.play("tap"); });
  $(".bt-emote").addEventListener("click", function () { em.hidden = !em.hidden; });
  em.addEventListener("click", function (ev) {
    const b = ev.target.closest("button"); if (!b) return;
    em.hidden = true;
    const idx = sim.DB.EMOTES.indexOf(b.textContent);
    showEmote(mySide, idx);
    if (o.mode === "online") o.net.send({ t: "emote", e: idx });
    else if (bot && Math.random() < 0.4) setTimeout(function () { showEmote(foe, Math.floor(Math.random() * sim.DB.EMOTES.length)); }, 900);
  });
  function showEmote(side, idx) {
    const el = side === mySide ? $(".bt-bubme") : $(".bt-bubfoe");
    el.textContent = sim.DB.EMOTES[idx] || "";
    el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
    audio && audio.play("emote");
  }
  function toggleMenu(force) {
    const m = $(".bt-menubox");
    m.hidden = force != null ? !force : !m.hidden;
    m.querySelector('[data-a="mute"]').textContent = audio && audio.muted ? "Sound on" : "Sound off";
    if (o.mode === "bot") paused = !m.hidden;
  }
  $(".bt-menu").addEventListener("click", function () { toggleMenu(); });
  $(".bt-menubox").addEventListener("click", function (ev) {
    const a = ev.target.dataset.a;
    if (a === "resume") toggleMenu(false);
    else if (a === "mute") { audio && audio.setMuted(!audio.muted); toggleMenu(true); o.onMute && o.onMute(audio.muted); }
    else if (a === "quit") { toggleMenu(false); paused = false; submit({ k: "quit" }); }
  });

  /* ---------------- the clock ---------------- */
  function snapPrev() {
    prev.clear();
    for (const e of st.ents) prev.set(e.id, [e.x, e.y]);
    for (const p of st.projs) prev.set(-p.id, [p.x, p.y]);
  }
  function stepOnce() {
    snapPrev();
    const cmds = [];
    if (o.mode === "online") { const c = online.get(st.tick); if (c) { for (const x of c) cmds.push(x); online.delete(st.tick); } }
    else {
      while (queue.length) cmds.push(queue.shift());
      if (bot) { const c = bot.think(st); if (c) cmds.push(c); }
      if (auto) { const c = auto.think(st); if (c) cmds.push(c); }
    }
    sim.step(st, cmds);
    handleEvents(st.ev);
    if (auto && o.mode === "online" && !ended) { const c = auto.think(st); if (c) submit(c); }
    if (o.mode === "online" && st.tick % hashEvery === 0) o.net.send({ t: "hash", tick: st.tick, h: sim.hash(st) });
    if (o.onTick) o.onTick(st);
  }
  function handleEvents(evs) {
    if (!evs.length) return;
    rnd.onEvents(st, evs);
    for (const e of evs) {
      if (e.k === "tower") { rnd.noteTowers(st); audio && audio.play(e.lodge ? "lodge" : "tower"); if (e.s !== mySide) toast(e.lodge ? "Their lodge is down!" : "You took a hut! A flag for you"); else toast(e.lodge ? "Your lodge fell" : "They took one of your huts"); }
      else if (e.k === "reject" && e.s === mySide) toast(WHY[e.why] || "Not now");
      else if (e.k === "play") audio && audio.play(sim.CARD[e.card].type === "spell" ? "spell" : "deploy", e.s === mySide ? 1 : 0.6);
      else if (e.k === "atk") audio && audio.atk(e.u);
      else if (e.k === "die" && e.kind === 0) audio && audio.play("poof", 0.5);
      else if (e.k === "boom") audio && audio.play(e.kind === "freeze" || e.kind === "whiteout" ? "freeze" : e.kind === "pulse" ? "whistle" : "boom", 0.8);
      else if (e.k === "overtime") toast("Overtime: the next flag wins");
      else if (e.k === "end") { ended = true; endAt = performance.now(); select(-1); }
      else if (e.k === "abil") audio && audio.play("ability");
    }
    if (st.tick === R.doubleAt + 1) toast("Double cocoa!");
  }
  function frame(ts) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (!last) last = ts;
    const dt = Math.min(250, ts - last); last = ts;
    if (!paused) acc += dt;
    let n = 0;
    const behind = confirmed !== Infinity ? confirmed - st.tick : 0;
    const maxN = behind > 10 ? 40 : 8;
    const t0 = performance.now();
    while ((acc >= 50 || (behind > 10 && n < maxN)) && n < maxN && st.tick < confirmed && st.phase !== 2) {
      stepOnce(); acc = Math.max(0, acc - 50); n++;
    }
    const t1 = performance.now();
    if (st.tick >= confirmed || st.phase === 2) acc = Math.min(acc, 50);
    if (acc > 300) acc = 300;
    const alpha = st.phase === 2 ? 1 : Math.min(1, acc / 50);
    rnd.draw(st, alpha, prev, { drag }, ts);
    const t2 = performance.now();
    hud();
    const t3 = performance.now();
    timing.sim += t1 - t0; timing.draw += t2 - t1; timing.hud += t3 - t2; timing.frames++; timing.steps += n;
    if (ended && o.onEnd && performance.now() - endAt > 1600) { const f = o.onEnd; o.onEnd = null; f(result()); }
  }
  function result() {
    return { winner: st.winner, mySide, why: st.why, flags: [st.sides[mySide].crowns, st.sides[foe].crowns], tick: st.tick, hash: sim.hash(st) };
  }

  /* ---------------- the HUD ---------------- */
  function hud() {
    const S = st.sides[mySide];
    const sig = S.hand.join() + "|" + S.queue[0];
    if (sig !== handSig) {
      handSig = sig;
      const kids = hand.children;
      for (let i = 0; i < 4; i++) {
        kids[i]._k = "";
        const c = sim.CARD[S.hand[i]];
        kids[i].dataset.card = c.id;
        kids[i].className = "ticket bt-card r-" + c.rarity + (i === sel ? " sel" : "");
        kids[i].innerHTML = '<span class="tk-key">' + (i + 1) + "</span>" + ticketHTML(c) + '<span class="tk-wait"></span>';
        kids[i].setAttribute("aria-label", c.name + ", " + c.cost + " cocoa");
      }
      const nc = sim.CARD[S.queue[0]];
      const nx = $(".bt-nextcard");
      nx.className = "ticket mini bt-nextcard r-" + nc.rarity;
      nx.innerHTML = ticketHTML(nc, { name: false });
      paintArt(root);
      if (drag && sel >= 0) drag.card = S.hand[sel];
    }
    const cocoa = S.cocoa;
    for (let i = 0; i < 4; i++) {
      const b = hand.children[i];
      const c = sim.CARD[S.hand[i]];
      const need = c.cost * 1000;
      const ok = cocoa >= need;
      const sm = sim.summitNext(st, mySide, c.id);
      const tf = "scaleY(" + (ok ? 0 : 1 - cocoa / need).toFixed(2) + ")";
      const key = (ok ? 1 : 0) + (sm ? 2 : 0) + tf;
      if (b._k !== key) {
        b._k = key;
        b.classList.toggle("poor", !ok);
        b.classList.toggle("summit", sm);
        const w = b.lastChild;
        if (w) w.style.transform = tf;
      }
    }
    const fillT = "scaleX(" + (cocoa / R.cocoaMax).toFixed(3) + ")";
    if (fillT !== lastFill) { lastFill = fillT; fillEl.style.transform = fillT; }
    const cn = Math.floor(cocoa / 1000);
    if (cn !== lastCocoaN) { lastCocoaN = cn; $(".bt-cn").textContent = cn; }
    const left = Math.max(0, sim.timeLeft(st));
    const secs = Math.ceil(left / 20);
    const txt = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    if (txt !== lastTime) {
      lastTime = txt;
      $(".bt-time").textContent = txt;
      const mode = st.phase === 1 ? "Overtime" : st.tick >= R.doubleAt ? "Double cocoa" : "";
      $(".bt-mode").textContent = mode;
      $(".bt-clock").classList.toggle("hot", st.tick >= R.doubleAt);
      $(".bt-flfoe").textContent = st.sides[foe].crowns;
      $(".bt-flme").textContent = S.crowns;
    }
    // legend ability
    const ab = $(".bt-ability");
    if (S.leg) {
      const e = sim.byId(st, S.leg);
      if (e && e.dep === 0) {
        const a = sim.UNIT[e.u].ability;
        ab.hidden = false;
        const ready = st.tick >= S.abilAt;
        const k = ready ? 1 : 1 - (S.abilAt - st.tick) / a.cd;
        ab.classList.toggle("ready", ready);
        ab.style.setProperty("--k", Math.max(0, Math.min(1, k)).toFixed(3));
        const nm = { rally: "Rally", whiteout: "Whiteout", leap: "Big Air", flare: "Flare" }[a.kind];
        if (ab.dataset.k !== nm) { ab.dataset.k = nm; ab.querySelector(".bt-abname").textContent = nm; ab.setAttribute("aria-label", nm + " (Q)"); }
      } else ab.hidden = true;
    } else ab.hidden = true;
  }

  raf = requestAnimationFrame(frame);
  if (audio) audio.music(true);

  return {
    get state() { return st; },
    sim, renderer: rnd,
    stop() {
      stopped = true; cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      if (audio) audio.music(false);
    },
    // online plumbing
    serverCmd(tick, c) { if (!online.has(tick)) online.set(tick, []); online.get(tick).push(c); },
    confirm(tick) { if (tick > confirmed) confirmed = tick; },
    resync(snap, cmdsAfter) {
      st = snap; prev.clear(); rnd.reset(); rnd.noteTowers(st);
      for (const [t] of online) if (t < st.tick) online.delete(t);
      handSig = "";
    },
    emote(side, idx) { showEmote(side, idx); },
    toast,
    submit, tryPlay, select,
    // tests: queue any play for either side (practice matches only)
    inject(cmd) { if (o.mode !== "online") queue.push(cmd); },
    timing,
    // tests: run ticks now without waiting for the clock
    stepN(n) { for (let i = 0; i < n && st.phase !== 2 && st.tick < confirmed; i++) stepOnce(); },
    setPaused(v) { paused = v; },
    setFoeName(n, tag) { $(".bt-foename").textContent = n; $(".bt-foetag").textContent = tag || ""; },
  };
}
