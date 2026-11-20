const http = require("http"), fs = require("fs"), path = require("path");
const { WebSocketServer } = require("ws");
const PORT = process.env.PORT || 3000, PUB = path.join(__dirname, "public");

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/health") return res.end("ok");
  const f = path.join(PUB, url === "/" ? "index.html" : url);
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/manifest+json", ".svg": "image/svg+xml" })[path.extname(f)] || "text/plain" });
    res.end(d);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
const send = (w, o) => w && w.readyState === 1 && w.send(JSON.stringify(o));
const lobby = r => r.seats.forEach(w => send(w, { t: "lobby", players: r.names, avs: r.avs }));
const tok = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const newCode = () => {
  let c;
  do { c = Array.from({ length: 4 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ"[Math.random() * 23 | 0]).join(""); } while (rooms.has(c));
  return c;
};

wss.on("connection", ws => {
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === "create") {
      const code = newCode(), token = tok();
      const r = { code, seats: [ws, null, null, null], tokens: [token, null, null, null], timers: [], avs: [String(m.av || "").slice(0, 8), "", "", ""], names: [String(m.name || "হোস্ট").slice(0, 14), null, null, null], started: false, snap: null };
      rooms.set(code, r); ws.room = r; ws.seat = 0;
      send(ws, { t: "room", code, seat: 0, token }); lobby(r);
    } else if (m.t === "join") {
      const r = rooms.get(String(m.code || "").toUpperCase());
      if (!r) return send(ws, { t: "err", msg: "রুম পাওয়া যায়নি" });
      if (r.started) return send(ws, { t: "err", msg: "খেলা শুরু হয়ে গেছে" });
      const s = r.seats.findIndex((x, i) => i && !x);
      if (s < 0) return send(ws, { t: "err", msg: "রুম ভর্তি" });
      const token = tok();
      r.seats[s] = ws; r.tokens[s] = token; r.names[s] = String(m.name || "প্লেয়ার").slice(0, 14); r.avs[s] = String(m.av || "").slice(0, 8);
      ws.room = r; ws.seat = s;
      send(ws, { t: "room", code: r.code, seat: s, token }); lobby(r);
    } else if (m.t === "rejoin") {
      const r = rooms.get(String(m.code || "").toUpperCase());
      const s = r && m.token ? r.tokens.indexOf(m.token) : -1;
      if (s < 0) return send(ws, { t: "err", msg: "আগের রুম আর নেই", fatal: true });
      const old = r.seats[s];
      if (old && old !== ws) { old.room = null; try { old.close(); } catch {} }
      clearTimeout(r.timers[s]);
      r.seats[s] = ws; ws.room = r; ws.seat = s;
      send(ws, { t: "room", code: r.code, seat: s, token: m.token });
      if (s === 0) {
        clearTimeout(r.del);
        if (r.snap) send(ws, { t: "snap", g: r.snap }); else lobby(r);
        r.seats.forEach((w, i) => i && send(w, { t: "hostback" }));
      } else if (r.started) send(r.seats[0], { t: "back", seat: s });
      else lobby(r);
    } else if (ws.room) {
      const r = ws.room;
      if (ws.seat === 0) {
        if (m.t === "start") r.started = true;
        else if (m.t === "snap") r.snap = m.g;
        else if (m.t === "toSeat") send(r.seats[m.seat], m.m);
      } else if (m.t === "act") send(r.seats[0], { t: "act", seat: ws.seat, m: m.m });
    }
  });
  ws.on("close", () => {
    const r = ws.room;
    if (!r || r.seats[ws.seat] !== ws) return;
    if (ws.seat === 0) {
      r.seats.forEach((w, i) => i && send(w, { t: "hostaway" }));
      r.del = setTimeout(() => { r.seats.forEach((w, i) => i && send(w, { t: "closed" })); rooms.delete(r.code); }, 180000);
    } else if (!r.started) {
      r.seats[ws.seat] = null; r.names[ws.seat] = null; r.tokens[ws.seat] = null; lobby(r);
    } else {
      const s = ws.seat;
      send(r.seats[0], { t: "away", seat: s });
      r.timers[s] = setTimeout(() => { r.seats[s] = null; r.tokens[s] = null; send(r.seats[0], { t: "left", seat: s }); }, 45000);
    }
  });
});
setInterval(() => wss.clients.forEach(w => w.readyState === 1 && w.ping()), 25000);
server.listen(PORT, () => console.log("২৯ গেম চালু, পোর্ট " + PORT));
