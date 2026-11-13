/* Leon Clash: the line to the game server (mlhub apps/mc/leonclash.js).
   wss://apps.leonzhao.dev/mc/ws?mode=clash, or ?mp=ws://127.0.0.1:PORT/mc/ws
   on a page served from this computer (ignored anywhere else). The server
   orders every play, stamps it with a tick, runs the same sim and decides the
   result. If the line drops in a match we try again for a while and pick the
   match back up from the server's snapshot. */

export function serverUrl() {
  let mp = null;
  try { mp = new URLSearchParams(location.search).get("mp"); } catch (e) {}
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(location.hostname);
  if (mp && local && /^wss?:\/\//.test(mp)) return mp.replace(/[?#].*$/, "") + "?mode=clash";
  return "wss://apps.leonzhao.dev/mc/ws?mode=clash";
}
export function httpBase() {
  return serverUrl().replace(/^ws/, "http").replace(/\/ws\?.*$/, "/clash/");
}

export function makeNet(onMsg, onState) {
  let ws = null, want = false, tries = 0, timer = 0, open = false;
  let helloMsg = null;
  const outbox = [];
  function connect() {
    want = true;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    clearTimeout(timer);
    let sock;
    try { sock = new WebSocket(serverUrl()); } catch (e) { fail(); return; }
    ws = sock;
    const giveUp = setTimeout(function () { if (sock.readyState !== 1) { try { sock.close(); } catch (e) {} } }, 5000);
    sock.onopen = function () {
      clearTimeout(giveUp);
      open = true; tries = 0;
      onState && onState("open");
      if (helloMsg) raw(helloMsg);
      while (outbox.length) raw(outbox.shift());
    };
    sock.onmessage = function (ev) {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      onMsg && onMsg(m);
    };
    sock.onclose = function () {
      clearTimeout(giveUp);
      const was = open;
      open = false;
      if (ws === sock) ws = null;
      onState && onState(was ? "closed" : "failed");
      if (want) fail();
    };
    sock.onerror = function () {};
  }
  function fail() {
    tries++;
    if (!want || tries > 20) { onState && onState("gone"); return; }
    timer = setTimeout(connect, Math.min(4000, 800 + tries * 400));
  }
  function raw(m) { try { ws.send(JSON.stringify(m)); } catch (e) {} }
  function send(m) {
    if (ws && ws.readyState === 1) raw(m);
    else if (m.t === "play" || m.t === "ability" || m.t === "surrender") outbox.push(m);
  }
  return {
    connect, send,
    hello(m) { helloMsg = m; if (ws && ws.readyState === 1) raw(m); },
    close() { want = false; clearTimeout(timer); if (ws) { try { ws.close(); } catch (e) {} } ws = null; },
    get open() { return open; },
  };
}
