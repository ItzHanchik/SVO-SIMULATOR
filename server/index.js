/* ============================================================
   FRONTLINE: МЕРИДИАН — сервер
   • раздача статики из dist/
   • WebSocket: лобби, комнаты, ретрансляция состояния
   Симуляция (боты, очки, техника) живёт у хоста-клиента;
   сервер владеет комнатами, составом команд и ретрансляцией.
   ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

/* ---------------- статика ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';

  let filePath = path.join(DIST, path.normalize(url));
  if (!filePath.startsWith(DIST)) { res.writeHead(403); return res.end('forbidden'); }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA-fallback
      filePath = path.join(DIST, 'index.html');
      if (!fs.existsSync(filePath)) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Сборка не найдена. Выполните: npm run build');
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

/* ---------------- комнаты ---------------- */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();     // code -> room
const clients = new Map();   // ws -> client

function makeCode() {
  for (let i = 0; i < 50; i++) {
    let c = '';
    for (let j = 0; j < 5; j++) c += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
    if (!rooms.has(c)) return c;
  }
  return 'X' + Date.now().toString(36).toUpperCase().slice(-4);
}

function createRoom(host, settings = {}) {
  const code = makeCode();
  const room = {
    code,
    hostId: host.id,
    name: settings.name || `ЛОББИ ${code}`,
    settings: {
      mode: settings.mode || 'tdm',
      map: settings.map || 'meridian',
      bots: settings.bots ?? 8,
      skill: settings.skill || 'normal',
      limit: settings.limit || 60,
      ...settings
    },
    players: new Map(),   // id -> player
    started: false,
    createdAt: Date.now(),
    maxPlayers: 16
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, cl, team) {
  const counts = teamCounts(room);
  let t = team;
  if (!t || (t === 'vega' && counts.vega >= 8 && counts.argo < 8)) t = 'argo';
  if (t === 'argo' && counts.argo >= 8) t = 'vega';
  const p = {
    id: cl.id, name: cl.name, level: cl.level, rank: cl.rank,
    faction: t || cl.faction || 'vega', ready: false, isBot: false, ping: cl.ping || 0,
    loadout: cl.loadout || null
  };
  room.players.set(cl.id, p);
  cl.room = room;
  return p;
}

function teamCounts(room) {
  let vega = 0, argo = 0;
  for (const p of room.players.values()) {
    if (p.isBot) continue;
    if (p.faction === 'vega') vega++; else argo++;
  }
  return { vega, argo };
}

function removePlayer(room, cl) {
  room.players.delete(cl.id);
  cl.room = null;
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  if (room.hostId === cl.id) {
    const next = room.players.values().next().value;
    room.hostId = next.id;
    const nws = wsOf(next.id);
    if (nws) send(nws, { t: 'youAreHost' });
    broadcastRoom(room, { t: 'hostChanged', hostId: room.hostId, hostName: next.name });
  }
  room.started = false;
  broadcastRoom(room, { t: 'roomUpdate', room: serializeRoom(room) });
  broadcastRoom(room, { t: 'sys', msg: `${cl.name} покинул лобби` });
}

function serializeRoom(room) {
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    started: room.started,
    settings: room.settings,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, level: p.level, rank: p.rank,
      faction: p.faction, ready: p.ready, isBot: p.isBot, ping: p.ping
    }))
  };
}

/* ВАЖНО: clients хранит объект клиента { id, ws, ... }, а не сам сокет */
function wsOf(id) {
  const c = clients.get(id);
  return c && c.ws && c.ws.readyState === WebSocket.OPEN ? c.ws : null;
}

function broadcastRoom(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.isBot) continue;
    if (p.id === exceptId) continue;
    const ws = wsOf(p.id);
    if (ws) { try { ws.send(data); } catch (e) { /* ignore */ } }
  }
}
function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ }
  }
}

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });
let idCounter = 1;

wss.on('connection', (ws, req) => {
  const id = 'p' + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
  const cl = { id, ws, name: 'ИГРОК', level: 1, rank: 'НОВОБРАНЕЦ', faction: 'vega', ping: 0, room: null, loadout: null };
  clients.set(id, cl);
  send(ws, { t: 'welcome', id, rooms: rooms.size });

  let lastRelay = 0, relayBudget = 0;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    handle(cl, m, ws, () => { lastRelay = Date.now(); relayBudget++; });
  });

  ws.on('close', () => {
    if (cl.room) removePlayer(cl.room, cl);
    clients.delete(id);
  });
  ws.on('error', () => { try { ws.close(); } catch (e) {} });
});

function handle(cl, m, ws) {
  switch (m.t) {

    case 'setProfile':
      cl.name = String(m.name || 'ИГРОК').slice(0, 18) || 'ИГРОК';
      cl.level = Math.max(1, Math.min(99, Number(m.level) || 1));
      cl.rank = String(m.rank || '').slice(0, 40);
      cl.faction = m.faction === 'argo' ? 'argo' : 'vega';
      cl.loadout = m.loadout || null;
      if (cl.room) {
        const p = cl.room.players.get(cl.id);
        if (p) { p.name = cl.name; p.level = cl.level; p.rank = cl.rank; p.loadout = cl.loadout; }
        broadcastRoom(cl.room, { t: 'roomUpdate', room: serializeRoom(cl.room) });
      }
      send(ws, { t: 'rooms', rooms: listRooms() });
      break;

    case 'listRooms':
      send(ws, { t: 'rooms', rooms: listRooms() });
      break;

    case 'createRoom': {
      if (cl.room) removePlayer(cl.room, cl);
      const room = createRoom(cl, m.settings || {});
      addPlayer(room, cl, cl.faction);
      send(ws, { t: 'joined', room: serializeRoom(room) });
      send(ws, { t: 'youAreHost' });
      send(ws, { t: 'rooms', rooms: listRooms() });
      broadcastList();
      break;
    }

    case 'joinRoom': {
      const code = String(m.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: 'Лобби не найдено. Проверьте код.' });
      if (room.players.size >= room.maxPlayers) return send(ws, { t: 'error', msg: 'Лобби заполнено.' });
      if (cl.room) removePlayer(cl.room, cl);
      addPlayer(room, cl, m.team || cl.faction);
      send(ws, { t: 'joined', room: serializeRoom(room) });
      if (room.hostId === cl.id) send(ws, { t: 'youAreHost' });
      broadcastRoom(room, { t: 'roomUpdate', room: serializeRoom(room) });
      broadcastRoom(room, { t: 'sys', msg: `${cl.name} присоединился` }, cl.id);
      broadcastList();
      break;
    }

    case 'quickMatch': {
      const mode = m.mode || 'tdm';
      let target = null;
      for (const r of rooms.values()) {
        if (r.started) continue;
        if (r.settings.mode !== mode) continue;
        if (r.players.size >= r.maxPlayers) continue;
        if (!target || r.players.size > target.players.size) target = r;
      }
      if (!target) target = createRoom(cl, { mode, ...m });
      if (cl.room) removePlayer(cl.room, cl);
      addPlayer(target, cl, m.faction || cl.faction);
      send(ws, { t: 'joined', room: serializeRoom(target) });
      if (target.hostId === cl.id) send(ws, { t: 'youAreHost' });
      broadcastRoom(target, { t: 'roomUpdate', room: serializeRoom(target) });
      broadcastList();
      break;
    }

    case 'leaveRoom':
      if (cl.room) { removePlayer(cl.room, cl); broadcastList(); }
      send(ws, { t: 'left' });
      break;

    case 'setTeam': {
      if (!cl.room) break;
      const p = cl.room.players.get(cl.id);
      const t = m.team === 'argo' ? 'argo' : 'vega';
      if (p) { p.faction = t; p.ready = false; }
      broadcastRoom(cl.room, { t: 'roomUpdate', room: serializeRoom(cl.room) });
      break;
    }

    case 'setReady': {
      if (!cl.room) break;
      const p = cl.room.players.get(cl.id);
      if (p) p.ready = !!m.value;
      broadcastRoom(cl.room, { t: 'roomUpdate', room: serializeRoom(cl.room) });
      break;
    }

    case 'setSettings': {
      if (!cl.room || cl.room.hostId !== cl.id) break;
      const s = cl.room.settings;
      for (const k of ['mode', 'map', 'skill', 'name']) if (m.settings[k] !== undefined) s[k] = m.settings[k];
      for (const k of ['bots', 'limit']) if (m.settings[k] !== undefined) s[k] = Math.max(0, Math.min(999, Number(m.settings[k]) || 0));
      broadcastRoom(cl.room, { t: 'roomUpdate', room: serializeRoom(cl.room) });
      break;
    }

    case 'startMatch': {
      const room = cl.room;
      if (!room || room.hostId !== cl.id) break;
      room.started = true;
      const players = [...room.players.values()].map(p => ({
        id: p.id, name: p.name, faction: p.faction, level: p.level, rank: p.rank,
        loadout: p.loadout, isBot: false, ping: p.ping
      }));
      const payload = {
        t: 'matchStart',
        room: serializeRoom(room),
        hostId: room.hostId,
        seed: (Math.random() * 1e9) | 0,
        players
      };
      for (const p of room.players.values()) {
        if (p.isBot) continue;
        const w = wsOf(p.id);
        if (w) send(w, { ...payload, youAreHost: p.id === room.hostId });
      }
      broadcastList();
      break;
    }

    case 'endMatch': {
      const room = cl.room;
      if (!room || room.hostId !== cl.id) break;
      room.started = false;
      for (const p of room.players.values()) if (!p.isBot) p.ready = false;
      broadcastRoom(room, { t: 'roomUpdate', room: serializeRoom(room) });
      broadcastList();
      break;
    }

    case 'chat': {
      if (!cl.room) break;
      const msg = String(m.msg || '').slice(0, 140);
      if (!msg.trim()) break;
      broadcastRoom(cl.room, { t: 'chat', from: cl.name, id: cl.id, msg });
      send(ws, { t: 'chat', from: cl.name, id: cl.id, msg });
      break;
    }

    case 'ping':
      send(ws, { t: 'pong', ts: m.ts });
      break;

    /* --- ретрансляция игрового трафика (с ограничением частоты) --- */
    case 'relay': {
      const room = cl.room;
      if (!room || !room.started) break;
      /* from обязателен: хост по нему понимает, чей это пакет (см. Game.handleNet 'in') */
      if (!m.to) broadcastRoom(room, { t: 'net', d: m.d, from: cl.id }, cl.id);
      else {
        const w = wsOf(m.to);
        if (w) send(w, { t: 'net', d: m.d, from: cl.id });
      }
      break;
    }

    /* хост рассылает симуляцию всем, кроме себя */
    case 'hostCast': {
      const room = cl.room;
      if (!room || room.hostId !== cl.id) break;
      broadcastRoom(room, { t: 'net', d: m.d, from: cl.id }, cl.id);
      break;
    }

    case 'reportPing': {
      cl.ping = Math.max(0, Math.min(999, Number(m.ping) || 0));
      if (cl.room) {
        const p = cl.room.players.get(cl.id);
        if (p && Math.abs(p.ping - cl.ping) > 12) {
          p.ping = cl.ping;
          broadcastRoom(cl.room, { t: 'roomUpdate', room: serializeRoom(cl.room) });
        }
      }
      break;
    }

    default: break;
  }
}

function listRooms() {
  return [...rooms.values()]
    .filter(r => !r.started)
    .sort((a, b) => b.players.size - a.players.size)
    .slice(0, 24)
    .map(r => ({
      code: r.code, name: r.name, mode: r.settings.mode, map: r.settings.map,
      players: r.players.size, max: r.maxPlayers, host: r.hostId,
      inGame: r.started
    }));
}

function broadcastList() {
  const roomsJson = JSON.stringify({ t: 'rooms', rooms: listRooms() });
  for (const c of clients.values()) {
    if (c.ws && c.ws.readyState === WebSocket.OPEN) { try { c.ws.send(roomsJson); } catch (e) {} }
  }
}

/* периодическая рассылка списка + чистка мёртвых комнат */
setInterval(() => {
  for (const [code, r] of rooms) {
    if (r.players.size === 0) rooms.delete(code);
  }
  broadcastList();
}, 5000);

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║   FRONTLINE: МЕРИДИАН                         ║');
  console.log(`  ║   http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`.padEnd(48) + '║');
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
});
