/* ============================================================
   ТЕСТ МУЛЬТИПЛЕЕРНОГО СЕРВЕРА
   поднимает настоящий server/index.js и гоняет протокол лобби:
   создание/подключение по коду, команды, чат, старт боя, ретрансляция
   ============================================================ */
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8791 + ((Math.random() * 60) | 0);
const URL = `ws://127.0.0.1:${PORT}/ws`;

const results = [];
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; results.push(['PASS', name, '']); }
  catch (e) { fail++; results.push(['FAIL', name, (e && e.message || String(e))]); }
}

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = {
      ws, id: null, box: [], waiters: [],
      send: (m) => ws.send(JSON.stringify(m)),
      next: (pred, timeout = 2500) => new Promise((res, rej) => {
        const hit = c.box.find(pred);
        if (hit) return res(hit);
        const t = setTimeout(() => rej(new Error('timeout: ' + pred.toString().slice(0, 60))), timeout);
        c.waiters.push({ pred, res, rej, t });
      })
    };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      c.box.push(m);
      for (let i = c.waiters.length - 1; i >= 0; i--) {
        const w = c.waiters[i];
        if (w.pred(m)) { clearTimeout(w.t); c.waiters.splice(i, 1); w.res(m); }
      }
    });
    ws.on('open', () => {
      ws.on('message', () => {});
      resolve(c);
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 4000);
  });
}
const has = (t, extra = {}) => (m) => m.t === t && Object.entries(extra).every(([k, v]) => m[k] === v);

try {
  // ждём подъёма сервера
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { const c = await connect(); c.ws.close(); up = true; } catch (e) { await sleep(120); }
  }
  assert.ok(up, 'сервер не поднялся:\n' + serverLog);

  let A, B, C;

  await test('подключение: сервер выдаёт welcome с id', async () => {
    A = await connect(); B = await connect(); C = await connect();
    const w = await A.next(has('welcome'));
    assert.ok(w.id && typeof w.id === 'string', 'нет id');
    A.id = w.id;
    B.id = (await B.next(has('welcome'))).id;
    C.id = (await C.next(has('welcome'))).id;
    assert.notEqual(A.id, B.id);
  });

  await test('профиль: setProfile не роняет соединение', async () => {
    A.send({ t: 'setProfile', name: 'КРЕЧЕТ', level: 7, rank: 'ЛЕЙТЕНАНТ', faction: 'vega',
      loadout: { primary: 'vixen', secondary: 'gyurza', gadgets: ['frag'], drone: 'striker' } });
    B.send({ t: 'setProfile', name: 'ГРАНИТ', level: 3, rank: 'ЕФРЕЙТОР', faction: 'argo' });
    C.send({ t: 'setProfile', name: 'ШТОРМ', level: 12, rank: 'КАПИТАН', faction: 'vega' });
    const r = await A.next(has('rooms'));
    assert.ok(Array.isArray(r.rooms));
  });

  let code = null;
  await test('лобби: создание комнаты даёт код и право хоста', async () => {
    A.send({ t: 'createRoom', settings: { name: 'ЛОББИ КРЕЧЕТ', mode: 'tdm', map: 'meridian', bots: 8, skill: 'normal', limit: 60 } });
    const j = await A.next(has('joined'));
    assert.ok(j.room.code && j.room.code.length >= 4, 'нет кода');
    assert.equal(j.room.hostId, A.id, 'создатель не стал хостом');
    assert.equal(j.room.players.length, 1);
    code = j.room.code;
    const h = await A.next(has('youAreHost'));
    assert.ok(h);
  });

  await test('лобби: список комнат содержит созданную', async () => {
    A.send({ t: 'listRooms' });
    const r = await A.next((m) => m.t === 'rooms' && m.rooms.some(x => x.code === code));
    const found = r.rooms.find(x => x.code === code);
    assert.equal(found.mode, 'tdm');
    assert.equal(found.map, 'meridian');
  });

  await test('лобби: подключение по коду (в т.ч. lowercase)', async () => {
    B.box.length = 0;
    B.send({ t: 'joinRoom', code: code.toLowerCase(), team: 'argo' });
    const j = await B.next(has('joined'));
    assert.equal(j.room.code, code);
    assert.equal(j.room.players.length, 2);
    const me = j.room.players.find(p => p.id === B.id);
    assert.equal(me.faction, 'argo', 'команда не применена');
  });

  await test('лобби: неверный код даёт понятную ошибку', async () => {
    C.box.length = 0;
    C.send({ t: 'joinRoom', code: 'ZZZZZ' });
    const e = await C.next(has('error'));
    assert.match(e.msg, /не найдено/i);
  });

  await test('лобби: смена команды и готовность видны всем', async () => {
    B.box.length = 0; A.box.length = 0;
    B.send({ t: 'setTeam', team: 'vega' });
    const u = await A.next((m) => m.t === 'roomUpdate' &&
      m.room.players.find(p => p.id === B.id)?.faction === 'vega');
    assert.ok(u);
    B.send({ t: 'setReady', value: true });
    const u2 = await A.next((m) => m.t === 'roomUpdate' &&
      m.room.players.find(p => p.id === B.id)?.ready === true);
    assert.ok(u2);
  });

  await test('лобби: настройки меняет только хост', async () => {
    B.box.length = 0; A.box.length = 0;
    B.send({ t: 'setSettings', settings: { mode: 'dom' } });
    await sleep(250);
    assert.ok(!A.box.some(m => m.t === 'roomUpdate' && m.room.settings.mode === 'dom'),
      'не-хост смог поменять настройки');
    A.send({ t: 'setSettings', settings: { mode: 'dom', bots: 12 } });
    const u = await A.next((m) => m.t === 'roomUpdate' && m.room.settings.mode === 'dom');
    assert.equal(u.room.settings.bots, 12);
  });

  await test('чат: сообщение приходит всем в лобби', async () => {
    B.box.length = 0; C.box.length = 0;
    A.send({ t: 'chat', msg: 'всем привет' });
    const m = await B.next(has('chat'));
    assert.equal(m.msg, 'всем привет');
    assert.equal(m.from, 'КРЕЧЕТ');
  });

  await test('quickMatch: третий игрок попадает в существующее лобби того же режима', async () => {
    C.box.length = 0;
    C.send({ t: 'quickMatch', mode: 'dom', faction: 'vega' });
    const j = await C.next(has('joined'));
    assert.equal(j.room.code, code, 'создал новое лобби вместо существующего');
    assert.equal(j.room.players.length, 3);
  });

  let startMsg = null;
  await test('старт боя: всем приходит matchStart с составом и флагом хоста', async () => {
    A.box.length = 0; B.box.length = 0; C.box.length = 0;
    A.send({ t: 'startMatch' });
    startMsg = await A.next(has('matchStart'));
    assert.equal(startMsg.youAreHost, true, 'хост не помечен');
    assert.equal(startMsg.players.length, 3);
    assert.ok(startMsg.seed > 0, 'нет сида карты');
    const bStart = await B.next(has('matchStart'));
    assert.equal(bStart.youAreHost, false, 'не-хост помечен хостом');
    const cStart = await C.next(has('matchStart'));
    assert.ok(cStart.room.settings.mode === 'dom');
  });

  await test('ретрансляция: relay от игрока доходит до остальных', async () => {
    B.box.length = 0; C.box.length = 0;
    B.send({ t: 'relay', d: { t: 'in', p: [1, 2, 3], y: 0.5 } });
    const m = await C.next(has('net'));
    assert.deepEqual(m.d.p, [1, 2, 3]);
    assert.equal(m.from, B.id);
  });

  await test('hostCast: рассылка хоста не возвращается самому хосту', async () => {
    A.box.length = 0; B.box.length = 0;
    A.send({ t: 'hostCast', d: { t: 'sim', sc: [3, 1] } });
    const m = await B.next((x) => x.t === 'net' && x.d.t === 'sim');
    assert.deepEqual(m.d.sc, [3, 1]);
    await sleep(200);
    assert.ok(!A.box.some(x => x.t === 'net' && x.d && x.d.t === 'sim'), 'хост получил собственную рассылку');
  });

  await test('анти-спуфинг: hostCast от не-хоста игнорируется', async () => {
    C.box.length = 0; B.box.length = 0;
    C.send({ t: 'hostCast', d: { t: 'sim', sc: [99, 99] } });
    await sleep(250);
    assert.ok(!B.box.some(x => x.t === 'net' && x.d && x.d.sc && x.d.sc[0] === 99),
      'не-хост смог разослать симуляцию');
  });

  await test('ping: сервер отвечает pong и принимает reportPing', async () => {
    A.box.length = 0;
    A.send({ t: 'ping', ts: 12345 });
    const p = await A.next(has('pong'));
    assert.equal(p.ts, 12345);
    A.send({ t: 'reportPing', ping: 42 });
    await sleep(150);
  });

  await test('миграция хоста: после выхода хоста назначается новый', async () => {
    B.box.length = 0; C.box.length = 0;
    A.send({ t: 'leaveRoom' });
    A.ws.close();
    const h = await B.next(has('hostChanged'), 4000);
    assert.ok(h.hostId === B.id || h.hostId === C.id, 'новый хост не назначен');
    const target = h.hostId === B.id ? B : C;
    const y = await target.next(has('youAreHost'), 2000);
    assert.ok(y);
  });

  await test('выход: комната удаляется, когда все вышли', async () => {
    B.send({ t: 'leaveRoom' });
    C.send({ t: 'leaveRoom' });
    await sleep(300);
    const D = await connect();
    D.send({ t: 'listRooms' });
    const r = await D.next(has('rooms'));
    assert.ok(!r.rooms.some(x => x.code === code), 'пустая комната не удалена');
    D.ws.close();
  });

  await test('защита: мусорные сообщения не роняют сервер', async () => {
    const E = await connect();
    E.ws.send('не json {{{');
    E.ws.send(JSON.stringify(null));
    E.ws.send(JSON.stringify({ t: 12345 }));
    E.ws.send(JSON.stringify({ t: 'несуществующий_тип' }));
    await sleep(250);
    E.send({ t: 'listRooms' });
    const r = await E.next(has('rooms'), 3000);
    assert.ok(Array.isArray(r.rooms), 'сервер перестал отвечать');
    E.ws.close();
  });

} catch (e) {
  fail++;
  results.push(['FAIL', 'общий сценарий', (e && e.stack || String(e)).split('\n').slice(0, 3).join(' | ')]);
} finally {
  try { server.kill('SIGTERM'); } catch (e) {}
}

console.log('');
console.log('  ════════════════════════════════════════════════════════════');
for (const [st, name, err] of results) {
  console.log(`  ${st === 'PASS' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  if (err) console.log(`      \x1b[31m${err}\x1b[0m`);
}
console.log('  ════════════════════════════════════════════════════════════');
console.log(`  ${pass} пройдено, ${fail} провалено`);
console.log('');
process.exit(fail ? 1 : 0);
