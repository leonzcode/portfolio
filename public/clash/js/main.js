/* Leon Clash: the app. Home, practice against bots, online matches, private
   matches by code, the deck builder, card sheets, the leaderboard, settings.
   Test handle: window.__clash. */
import "./cards.js?v=1";
import "./sim.js?v=1";
import { startBattle, ticketHTML, paintArt } from "./battle.js?v=1";
import { loadArt } from "./art.js?v=1";
import { makeAudio } from "./audio.js?v=1";
import { makeNet, httpBase } from "./net.js?v=1";

const DB = globalThis.LeonClashCards;
const sim = globalThis.LeonClashSim.make(DB);
const BASE = window.__clashBase || "/clash/";
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const audio = makeAudio(BASE);

/* ---------------- what this browser keeps ---------------- */
function load(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, "0")).join(""); }
let token = load("clash.tok", null);
if (!token || !/^[0-9a-f]{32}$/.test(token)) { token = randHex(16); save("clash.tok", token); }
let myName = load("clash.name", null) || ("Climber " + (100 + Math.floor(Math.random() * 900)));
const settings = Object.assign({ reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches }, load("clash.settings", {}));
let decks = load("clash.decks", null);
if (!decks || !Array.isArray(decks.list) || decks.list.length !== 4) {
  decks = { active: 0, list: [
    { name: "Deck 1", cards: DB.DECKS.starter.slice() },
    { name: "Deck 2", cards: DB.DECKS.samples[1].cards.slice() },
    { name: "Deck 3", cards: DB.DECKS.samples[3].cards.slice() },
    { name: "Deck 4", cards: DB.DECKS.samples[5].cards.slice() },
  ] };
}
for (const d of decks.list) if (!sim.deckOk(d.cards)) d.cards = DB.DECKS.starter.slice();
save("clash.decks", decks);
function myDeck() { return decks.list[decks.active].cards.slice(); }
let me = load("clash.me", { tr: 0, w: 0, l: 0, d: 0, best: 0 });   // last known record from the server

function league(tr) {
  let L = DB.LEAGUES[0], i = 0;
  DB.LEAGUES.forEach(function (x, j) { if (tr >= x.min) { L = x; i = j; } });
  return Object.assign({ i }, L);
}

/* ---------------- screens ---------------- */
function go(id) {
  for (const s of $$(".screen")) s.classList.toggle("on", s.id === id);
  if (id === "home") renderHome();
  if (id === "deck") renderDeck();
  if (id === "leaders") renderLeaders();
  if (id === "settings") renderSettings();
}
document.addEventListener("click", function (ev) {
  const g = ev.target.closest("[data-go]");
  if (g) { audio.play("tap"); go(g.dataset.go); return; }
  const c = ev.target.closest("[data-close]");
  if (c) { c.closest(".ov").hidden = true; }
});
function overlay(id, on) { $(id).hidden = !on; }
document.documentElement.classList.toggle("rm", !!settings.reducedMotion);

/* ---------------- home ---------------- */
function renderHome() {
  $(".hm-name").textContent = myName;
  const L = league(me.tr || 0);
  $(".hm-league").textContent = L.name;
  $(".hm-trn").textContent = me.tr || 0;
  drawTrail(L.i, me.tr || 0);
}
function drawTrail(cur, tr) {
  const svg = $(".trail-svg");
  const n = DB.LEAGUES.length;
  // a winding run from the bottom of the mountain to its top
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = 262 - t * 236;
    const x = 180 + Math.sin(t * Math.PI * 2.6) * (110 - t * 70);
    pts.push([x, y]);
  }
  let d = "M" + pts[0][0] + " " + pts[0][1];
  for (let i = 1; i < n; i++) { const p = pts[i - 1], q = pts[i]; d += " Q" + (p[0] + q[0]) / 2 + " " + p[1] + " " + q[0] + " " + q[1]; }
  let done = "M" + pts[0][0] + " " + pts[0][1];
  for (let i = 1; i <= cur; i++) { const p = pts[i - 1], q = pts[i]; done += " Q" + (p[0] + q[0]) / 2 + " " + p[1] + " " + q[0] + " " + q[1]; }
  let h = '<path class="tr-mtn" d="M0 300 L60 150 L110 120 L180 18 L250 110 L300 140 L360 300 Z"/>' +
    '<path class="tr-shade" d="M180 18 L250 110 L300 140 L360 300 L210 300 Z"/>' +
    '<path class="tr-run" d="' + d + '"/><path class="tr-done" d="' + done + '"/>';
  for (let i = 0; i < n; i++) {
    const L = DB.LEAGUES[i], p = pts[i];
    const cls = i < cur ? "" : i === cur ? " now" : " lock";
    const w = L.name.length * 5.6 + 12;
    const left = p[0] > 180;
    const x = left ? p[0] + 8 : p[0] - 8 - w;
    h += '<g class="tr-sign' + cls + '"><rect x="' + x + '" y="' + (p[1] - 9) + '" width="' + w + '" height="16" rx="3"/>' +
      '<text x="' + (x + 6) + '" y="' + (p[1] + 3) + '">' + L.name + "</text></g>";
  }
  const p = pts[cur];
  h += '<circle class="tr-you" cx="' + p[0] + '" cy="' + p[1] + '" r="7"/>';
  svg.innerHTML = h;
  const next = DB.LEAGUES[cur + 1];
  $(".trail-now").textContent = next ? (next.min - tr) + " trophies to " + next.name : "Top of the mountain";
}

/* ---------------- practice ---------------- */
let battle = null, lastGame = null;
function practice(level) {
  overlay("#ov-practice", false);
  const seed = (Math.random() * 4294967295) >>> 0;
  const botDeck = DB.DECKS.samples[Math.floor(Math.random() * DB.DECKS.samples.length)].cards.slice();
  begin({ mode: "bot", botLevel: level, seed, decks: [myDeck(), botDeck], mySide: 0,
    names: [myName, "Bot (" + level + ")"], foeTag: "Practice bot" });
}
function begin(o) {
  if (battle) battle.stop();
  lastGame = o;
  go("battle");
  battle = startBattle(Object.assign({ root: $("#battle"), sim, audio, settings, onEnd: showResult }, o));
  window.__clash.battle = battle;
}
function showResult(r) {
  const box = $(".res-box");
  const win = r.winner === r.mySide, draw = r.winner === 2;
  box.classList.toggle("win", win); box.classList.toggle("lose", !win && !draw);
  $(".res-eyebrow").textContent = lastGame.mode === "online" ? (lastGame.ranked ? "Online match" : "Private match") : "Practice";
  $(".res-title").textContent = draw ? "Draw" : win ? "You win" : "You lose";
  $(".res-me").textContent = r.flags[0];
  $(".res-foe").textContent = r.flags[1];
  $(".res-foename").textContent = lastGame.names ? lastGame.names[1 - r.mySide] : "Rival";
  const WHYT = { lodge: "The lodge came down.", time: "Time ran out.", sudden: "Sudden death: first flag won.", tiebreak: draw ? "Time ran out, towers level." : "Time ran out: the weakest tower decided it.", surrender: win ? "They gave up." : "You gave up.", forfeit: win ? "They left the match." : "You left the match." };
  $(".res-why").textContent = WHYT[r.why] || "";
  $(".res-tro").textContent = lastGame.mode === "online" ? (lastGame.ranked ? "Counting trophies..." : "No trophies in a private match") : "No trophies in practice";
  if (lastGame.mode === "online" && lastGame.serverEnd) applyEnd(lastGame.serverEnd);
  $('[data-act="again"]').textContent = lastGame.mode === "online" ? (lastGame.ranked ? "Find another match" : "Rematch") : "Play again";
  overlay("#ov-result", true);
  audio.play(win ? "win" : "lose");
}
function applyEnd(m) {
  if (!lastGame || !lastGame.ranked) return;
  if (m.me) { me = m.me; save("clash.me", me); }
  if (typeof m.delta === "number") {
    $(".res-tro").textContent = m.delta > 0 ? "+" + m.delta + " trophies, now " + m.me.tr
      : m.delta < 0 ? m.delta + " trophies, now " + m.me.tr
      : m.me.tr === 0 && m.w !== 2 ? "No trophies lost: you are at 0" : "Trophies stay at " + m.me.tr;
  }
}

/* ---------------- online ---------------- */
let net = null, netState = "off", queueT = 0, queueTimer = 0;
function ensureNet() {
  if (net) { net.connect(); return net; }
  net = makeNet(onNet, function (s) {
    netState = s;
    const st = $(".hm-status");
    if (s === "open") st.textContent = "Online";
    else if (s === "gone" || s === "failed") st.textContent = "Can't reach the game server. Practice still works; trophies need the server.";
    if ((s === "gone" || s === "failed") && !$("#ov-queue").hidden) { $(".q-msg").textContent = "Can't reach the game server."; $(".q-bot").hidden = false; }
    if (s === "closed" && battle && lastGame && lastGame.mode === "online") battle.toast("Connection lost. Reconnecting...");
  });
  net.hello({ t: "hello", tok: token, name: myName, v: 1 });
  net.connect();
  return net;
}
function onNet(m) {
  if (m.t === "hi") {
    if (m.me) { me = m.me; save("clash.me", me); if (m.me.name && m.me.name !== myName) { myName = m.me.name; save("clash.name", myName); } }
    if ($("#home").classList.contains("on")) renderHome();
    $(".hm-status").textContent = "Online" + (m.online ? ", " + m.online + " playing" : "");
  } else if (m.t === "queued") {
    $(".q-msg").textContent = "Looking for someone near " + (me.tr || 0) + " trophies";
  } else if (m.t === "lonely") {
    $(".q-bot").hidden = false;
  } else if (m.t === "pcode") {
    $(".pv-code").hidden = false; $(".pv-big").textContent = m.code; $(".pv-err").textContent = "";
    $('[data-act="pmake"]').hidden = true;
  } else if (m.t === "perr") {
    $(".pv-err").textContent = m.e || "That code did not work.";
  } else if (m.t === "start") {
    stopQueue();
    overlay("#ov-private", false); overlay("#ov-result", false);
    const st = m.snap || null;
    begin({ mode: "online", net, ranked: !!m.ranked, seed: m.seed, decks: m.decks, mySide: m.side, state: st,
      names: m.names, foeTag: m.ranked ? (m.tr[1 - m.side] + " trophies") : "Private match", mid: m.mid, autoplay: window.__clash.autoplay || null });
    battle.confirm(m.k || 0);
  } else if (m.t === "c") {
    if (battle) battle.serverCmd(m.k, m.c);
  } else if (m.t === "k") {
    if (battle) battle.confirm(m.k);
  } else if (m.t === "snap") {
    if (battle) { battle.resync(m.st); battle.confirm(m.k); for (const c of (m.cmds || [])) battle.serverCmd(c.k, c.c); }
  } else if (m.t === "end") {
    window.__clash.lastEnd = m;
    if (lastGame) lastGame.serverEnd = m;
    if (!$("#ov-result").hidden) applyEnd(m);
  } else if (m.t === "emote") {
    if (battle) battle.emote(m.s, m.e);
  } else if (m.t === "away") {
    if (battle) battle.toast("Your rival lost connection");
  } else if (m.t === "back") {
    if (battle) battle.toast("Your rival is back");
  } else if (m.t === "rematch") {
    if (!$("#ov-result").hidden) $(".res-tro").textContent = "Your rival wants a rematch";
  } else if (m.t === "err") {
    if (battle) battle.toast(m.e || "The server said no");
    else $(".hm-status").textContent = m.e || "";
  }
}
function startQueue() {
  ensureNet();
  overlay("#ov-queue", true);
  $(".q-bot").hidden = true;
  $(".q-msg").textContent = "Connecting";
  queueT = Date.now();
  clearInterval(queueTimer);
  queueTimer = setInterval(function () {
    const s = Math.floor((Date.now() - queueT) / 1000);
    $(".q-time").textContent = s + " s";
    if (s >= 20) $(".q-bot").hidden = false;
  }, 500);
  sendWhenOpen({ t: "queue", deck: myDeck() });
}
function stopQueue() { clearInterval(queueTimer); overlay("#ov-queue", false); }
function sendWhenOpen(m, n) {
  if (net && net.open) { net.send(m); return; }
  if ((n || 0) > 40) return;
  setTimeout(function () { sendWhenOpen(m, (n || 0) + 1); }, 150);
}

/* ---------------- buttons ---------------- */
document.addEventListener("click", function (ev) {
  const a = ev.target.closest("[data-act]");
  if (a) {
    const act = a.dataset.act;
    audio.play("tap");
    if (act === "battle") startQueue();
    else if (act === "practice") overlay("#ov-practice", true);
    else if (act === "private") { ensureNet(); overlay("#ov-private", true); $(".pv-code").hidden = true; $(".pv-err").textContent = ""; $('[data-act="pmake"]').hidden = false; }
    else if (act === "qcancel") { stopQueue(); net && net.send({ t: "cancel" }); }
    else if (act === "qbot") { stopQueue(); net && net.send({ t: "cancel" }); practice("medium"); }
    else if (act === "pmake") sendWhenOpen({ t: "pmake", deck: myDeck() });
    else if (act === "pjoin") { const c = $(".pv-in").value.trim().toUpperCase(); if (/^[A-Z]{4}$/.test(c)) sendWhenOpen({ t: "pjoin", code: c, deck: myDeck() }); else $(".pv-err").textContent = "A code is four letters."; }
    else if (act === "pcancel") { overlay("#ov-private", false); net && net.send({ t: "cancel" }); }
    else if (act === "home") { overlay("#ov-result", false); if (battle) { battle.stop(); battle = null; } if (net && lastGame && lastGame.mode === "online") net.send({ t: "leave" }); go("home"); }
    else if (act === "again") {
      overlay("#ov-result", false);
      if (lastGame.mode === "bot") practice(lastGame.botLevel);
      else if (lastGame.ranked) { if (battle) { battle.stop(); battle = null; } net.send({ t: "leave" }); go("home"); startQueue(); }
      else { net.send({ t: "rematch" }); $(".res-tro").textContent = "Asked for a rematch"; overlay("#ov-result", true); }
    }
    return;
  }
  const l = ev.target.closest("[data-lvl]");
  if (l) { audio.play("tap"); practice(l.dataset.lvl); }
});

/* ---------------- deck builder ---------------- */
let filter = "all", chosen = null;
function renderDeck() {
  const slots = $(".dk-slots");
  slots.innerHTML = decks.list.map((d, i) => '<button role="tab" aria-selected="' + (i === decks.active) + '" data-slot="' + i + '">' + (i + 1) + "</button>").join("");
  const cards = decks.list[decks.active].cards;
  $(".dk-deck").innerHTML = cards.map(id => { const c = sim.CARD[id]; return '<button class="ticket r-' + c.rarity + (chosen ? " pick" : "") + '" data-deckcard="' + id + '" aria-label="' + c.name + '">' + ticketHTML(c) + "</button>"; }).join("");
  const avg = cards.reduce((a, id) => a + sim.CARD[id].cost, 0) / 8;
  $(".dk-avg").textContent = "Average cost " + avg.toFixed(1);
  const all = DB.CARDS.filter(c => filter === "all" || c.type === filter);
  $(".dk-all").innerHTML = all.map(c => '<button class="ticket r-' + c.rarity + (cards.includes(c.id) ? " indeck" : "") + (chosen === c.id ? " chosen" : "") + '" data-card="' + c.id + '" aria-label="' + c.name + '">' + ticketHTML(c) + "</button>").join("");
  for (const b of $$(".dk-filter button")) b.classList.toggle("on", b.dataset.f === filter);
  paintArt($("#deck"));
}
$("#deck").addEventListener("click", function (ev) {
  const s = ev.target.closest("[data-slot]");
  if (s) { decks.active = +s.dataset.slot; chosen = null; save("clash.decks", decks); renderDeck(); return; }
  const f = ev.target.closest("[data-f]");
  if (f) { filter = f.dataset.f; renderDeck(); return; }
  const dc = ev.target.closest("[data-deckcard]");
  if (dc) {
    if (chosen) { swapIn(chosen, dc.dataset.deckcard); return; }
    sheet(dc.dataset.deckcard, "deck");
    return;
  }
  const c = ev.target.closest("[data-card]");
  if (c) {
    const cards = decks.list[decks.active].cards;
    if (cards.includes(c.dataset.card)) { sheet(c.dataset.card, "deck"); return; }
    sheet(c.dataset.card, "pick");
  }
});
function swapIn(newId, oldId) {
  const cards = decks.list[decks.active].cards;
  const next = cards.map(id => id === oldId ? newId : id);
  if (!sim.deckOk(next)) {
    chosen = null; renderDeck();
    $(".dk-hint").textContent = "A deck can hold only one Legend.";
    return;
  }
  decks.list[decks.active].cards = next;
  chosen = null;
  save("clash.decks", decks);
  $(".dk-hint").textContent = sim.CARD[newId].name + " is in. " + sim.CARD[oldId].name + " is out.";
  renderDeck();
}

/* ---------------- card sheets: every number ---------------- */
const TPS = DB.RULES.tps;
function tiles(v) { return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1); }
function secs(t) { const s = t / TPS; return (Math.round(s * 100) / 100) + " s"; }
function speedName(sp) { return sp <= 50 ? "Slow" : sp <= 65 ? "Medium" : sp <= 85 ? "Fast" : "Very fast"; }
function targetName(t) { return t === "both" ? "Air and ground" : t === "buildings" ? "Buildings only" : t === "none" ? "Nothing" : "Ground"; }
function unitRows(u, count) {
  const rows = [];
  rows.push(["Health" + (count > 1 ? " (each)" : ""), u.hp]);
  if (u.shield) rows.push(["Shield", u.shield]);
  if (u.dmg) {
    rows.push(["Damage", u.dmg]);
    rows.push(["Hit speed", secs(u.hit)]);
    rows.push(["Damage a second", Math.round(u.dmg * TPS / u.hit)]);
    rows.push(["Range", u.range <= 1100 ? "Melee (" + tiles(u.range) + ")" : tiles(u.range) + " tiles"]);
    if (u.minRange) rows.push(["Blind spot", "under " + tiles(u.minRange) + " tiles"]);
    if (u.splash) rows.push(["Splash radius", tiles(u.splash) + " tiles"]);
  }
  rows.push(["Targets", targetName(u.targets || "ground")]);
  if (!u.building) rows.push(["Speed", speedName(u.speed || 60) + " (" + ((u.speed || 60) * TPS / 1000).toFixed(1) + " tiles/s)"]);
  if (u.air) rows.push(["Flies", "Yes"]);
  if (u.life) rows.push(["Lasts", secs(u.life)]);
  rows.push(["Deploy time", secs(u.deploy == null ? 20 : u.deploy)]);
  if (count > 1) rows.push(["Count", "x" + count]);
  return rows;
}
function specials(u) {
  const out = [];
  if (u.firstMult) out.push("First hit does " + (u.firstMult / 100) + "x damage.");
  if (u.firstStun) out.push("First hit stuns for " + secs(u.firstStun) + ".");
  if (u.slowOnHit) out.push("Hits slow by " + u.slowOnHit.p + "% for " + secs(u.slowOnHit.t) + ".");
  if (u.knockOnHit) out.push("Hits push troops " + tiles(u.knockOnHit) + " tiles (less for heavy ones).");
  if (u.leap) out.push("Jumps the stream anywhere.");
  if (u.heal) out.push("Heals friendly troops within " + tiles(u.heal.r) + " tiles by " + u.heal.amt + " every " + secs(u.heal.every) + ".");
  if (u.aura) out.push((u.aura.kind === "haste" ? "Friendly troops within " + tiles(u.aura.r) + " tiles move and hit " + u.aura.p + "% faster." : "Enemy ground troops within " + tiles(u.aura.r) + " tiles move and hit " + u.aura.p + "% slower."));
  if (u.pulse) out.push("Every " + secs(u.pulse.every) + ": stuns enemy troops within " + tiles(u.pulse.r) + " tiles for " + secs(u.pulse.stun) + ".");
  if (u.spawn) out.push("Sends out " + u.spawn.count + " " + sim.UNIT[u.spawn.unit].name + (u.spawn.count > 1 ? "s" : "") + " every " + secs(u.spawn.every) + ".");
  if (u.hook) out.push("Hook: range " + tiles(u.hook.range) + " tiles, every " + secs(u.hook.cd) + (u.hook.stun ? ", stuns " + secs(u.hook.stun) : "") + ".");
  if (u.charge) out.push("Charges after " + tiles(u.charge.dist) + " tiles: " + (u.charge.speed * TPS / 1000).toFixed(1) + " tiles/s, next hit " + (u.charge.mult / 100) + "x" + (u.charge.knock ? ", knocks back" : "") + (u.charge.stun ? ", stuns " + secs(u.charge.stun) : "") + ".");
  if (u.trap) out.push("Collapses when an enemy ground troop comes within " + tiles(u.trap.trigger) + " tiles: " + u.trap.dmg + " damage in " + tiles(u.trap.r) + " tiles" + (u.trap.stun ? ", stun " + secs(u.trap.stun) : "") + ".");
  if (u.onDeploy) { const o = u.onDeploy; out.push("On landing: " + [o.dmg ? o.dmg + " damage" : "", o.heal ? "heals " + o.heal : "", o.stun ? "stun " + secs(o.stun) : "", o.knock ? "knockback" : ""].filter(Boolean).join(", ") + " within " + tiles(o.r) + " tiles."); }
  if (u.death) { const d = u.death; out.push("When it falls: " + [d.cocoa ? "+" + d.cocoa / 1000 + " cocoa" : "", d.dmg ? d.dmg + " damage" : "", d.slowP ? "slows " + d.slowP + "% for " + secs(d.slowT) : "", d.knock ? "knockback" : "", d.spawn ? d.count + " " + sim.UNIT[d.spawn].name + (d.count > 1 ? "s" : "") : ""].filter(Boolean).join(", ") + (d.r ? " within " + tiles(d.r) + " tiles" : "") + "."); }
  if (u.ability) {
    const a = u.ability;
    const T = { rally: "Rally: friendly troops within " + tiles(a.r) + " tiles move and hit " + a.p + "% faster for " + secs(a.t) + ".",
      whiteout: "Whiteout: freezes enemy troops within " + tiles(a.r) + " tiles for " + secs(a.t) + " and deals " + a.dmg + ".",
      leap: "Big Air: leaps up to " + tiles(a.dist) + " tiles at the nearest enemy, lands for " + a.dmg + " in " + tiles(a.r) + " tiles.",
      flare: "Flare: " + a.dmg + " damage in " + tiles(a.r) + " tiles on her target (" + a.towerPct + "% to towers)." };
    out.push("Ability, every " + secs(a.cd) + ". " + T[a.kind]);
  }
  return out;
}
function spellRows(s) {
  const rows = [];
  if (s.dmg) rows.push(["Damage", s.dmg]);
  if (s.dmg0) rows.push(["Damage", s.dmg0 + " to " + s.dmg1 + " as it rolls"]);
  if (s.towerPct) rows.push(["To towers", s.towerPct + "%"]);
  if (s.r) rows.push(["Radius", tiles(s.r) + " tiles"]);
  if (s.half) rows.push(["Width", tiles(s.half * 2) + " tiles"]);
  if (s.dist && s.kind === "roll") rows.push(["Rolls", tiles(s.dist) + " tiles"]);
  if (s.dist && s.kind === "push") rows.push(["Push", tiles(s.dist) + " tiles"]);
  if (s.knock) rows.push(["Knockback", tiles(s.knock) + " tiles"]);
  if (s.stun) rows.push(["Stun", secs(s.stun)]);
  if (s.delay) rows.push(["Lands after", secs(s.delay)]);
  if (s.ticks) rows.push([s.kind === "freeze" ? "Freeze" : "Lasts", secs(s.ticks)]);
  if (s.slowP) rows.push(["Slow", s.slowP + "%"]);
  if (s.dps) rows.push(["Damage a second", s.dps]);
  if (s.heal) rows.push(["Heal a second", s.heal]);
  if (s.hasteP) rows.push(["Faster by", s.hasteP + "%"]);
  if (s.kind === "spawn") rows.push(["Troops", s.count + " " + sim.UNIT[s.unit].name + "s"]);
  return rows;
}
function sheet(id, mode) {
  const c = sim.CARD[id];
  const box = $(".card-sheet");
  const R = DB.RARITY[c.rarity];
  let rows, sp = [];
  if (c.type === "spell") rows = spellRows(c.spell);
  else { const u = sim.UNIT[c.unit]; rows = unitRows(u, c.count || 1); sp = specials(u); }
  const sm = c.summit;
  let h = '<div class="cs-head"><div class="ticket r-' + c.rarity + '">' + ticketHTML(c, { name: false }) + "</div><div>" +
    '<h3 class="cs-title">' + c.name + "</h3>" +
    '<p class="cs-sub">' + R.name + " " + (c.type === "troop" ? "troop" : c.type) + ", " + c.cost + " cocoa</p>" +
    '<p class="cs-sub">' + c.role + "</p></div></div>" +
    '<p class="cs-text">' + c.text + "</p>" +
    '<dl class="cs-stats">' + rows.map(r => "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>").join("") + "</dl>";
  if (sp.length) h += '<p class="cs-text">' + sp.join("<br>") + "</p>";
  if (sm) h += '<div class="cs-summit"><b>Summit form</b>, every ' + (sm.every === 2 ? "2nd" : sm.every === 3 ? "3rd" : sm.every + "th") + " play: " + sm.text + "</div>";
  h += '<div class="cs-actions">';
  if (mode === "pick") h += '<button class="btn" data-sheet="use">Use this card</button>';
  h += '<button class="btn-quiet" data-close>Close</button></div>';
  box.innerHTML = h;
  box.dataset.card = id;
  paintArt(box);
  overlay("#ov-card", true);
}
$("#ov-card").addEventListener("click", function (ev) {
  if (ev.target.id === "ov-card") { overlay("#ov-card", false); return; }
  const b = ev.target.closest("[data-sheet]");
  if (b && b.dataset.sheet === "use") {
    chosen = $(".card-sheet").dataset.card;
    overlay("#ov-card", false);
    $(".dk-hint").textContent = "Now tap the deck card " + sim.CARD[chosen].name + " should replace.";
    renderDeck();
  }
});

/* ---------------- leaderboard ---------------- */
async function renderLeaders() {
  const list = $(".ld-list");
  $(".ld-status").textContent = "Loading";
  list.innerHTML = "";
  try {
    const r = await fetch(httpBase() + "top", { cache: "no-store" });
    const j = await r.json();
    const rows = j.top || [];
    if (!rows.length) { $(".ld-status").textContent = "Nobody has trophies yet. Win an online match to be first."; return; }
    $(".ld-status").textContent = "Top " + rows.length + " by trophies";
    list.innerHTML = rows.map((p, i) => '<li class="' + (p.name === myName && p.tr === me.tr ? "me" : "") + '"><span class="ld-rank">' + (i + 1) + '</span><span class="ld-name">' + esc(p.name) + "<small>" + league(p.tr).name + ", " + p.w + (p.w === 1 ? " win" : " wins") + "</small></span><span class=\"ld-tro\">" + p.tr + "</span></li>").join("");
  } catch (e) {
    $(".ld-status").textContent = "Can't reach the game server, so the leaderboard can't load right now.";
  }
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ---------------- settings ---------------- */
function renderSettings() {
  $(".set-name").value = myName;
  $(".set-sound").checked = !audio.muted;
  $(".set-motion").checked = !!settings.reducedMotion;
  $(".set-stats").innerHTML = "Trophies: <b>" + (me.tr || 0) + "</b> (" + league(me.tr || 0).name + ")<br>Best: " + (me.best || 0) +
    "<br>Online wins: " + (me.w || 0) + ", losses: " + (me.l || 0) + (me.d ? ", draws: " + me.d : "");
}
$(".set-name").addEventListener("change", function () {
  const v = this.value.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 16);
  if (v.length >= 3) { myName = v; save("clash.name", myName); if (net) net.hello({ t: "hello", tok: token, name: myName, v: 1 }); if (net && net.open) net.send({ t: "name", name: myName }); }
  this.value = myName;
});
$(".set-sound").addEventListener("change", function () { audio.setMuted(!this.checked); });
$(".set-motion").addEventListener("change", function () { settings.reducedMotion = this.checked; save("clash.settings", settings); document.documentElement.classList.toggle("rm", this.checked); });

/* ---------------- boot ---------------- */
go("home");
loadArt(BASE).then(function () { paintArt(document); });
// say hello quietly so the home screen knows our trophies
setTimeout(function () { ensureNet(); }, 300);
window.__clash = {
  sim, DB, get battle() { return battle; }, set battle(b) { battle = b; },
  get state() { return battle && battle.state; },
  startBot(level, seed, decksIn, autoplay) {
    begin({ mode: "bot", botLevel: level || "medium", seed: seed >>> 0 || 1, decks: decksIn || [myDeck(), DB.DECKS.samples[0].cards.slice()], mySide: 0, names: [myName, "Bot"], foeTag: "Practice bot", autoplay: autoplay || null });
    return battle;
  },
  step(n) { battle && battle.stepN(n || 1); return battle && battle.state.tick; },
  play(card, x, y) { return battle && battle.tryPlay(card, x, y); },
  hash() { return battle && sim.hash(battle.state); },
  autoplay: null,
  go, get net() { return net; }, get netState() { return netState; }, get me() { return me; },
};
