/* ============================================================
   СМОУК-ТЕСТ ЯДРА ИГРЫ
   Запускает НАСТОЯЩИЕ модули (карта, физика, ИИ ботов, бой,
   захват точек, техника, дроны) в Node со стабом DOM/WebGL.
   ============================================================ */
import { strict as assert } from 'node:assert';

/* ---------- стабы окружения ---------- */
function make2D() {
  const grad = { addColorStop() {} };
  const noop = () => {};
  return new Proxy({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop, getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    measureText: () => ({ width: 10 }),
    drawImage: noop
  }, {
    get(t, k) { return k in t ? t[k] : noop; },
    set() { return true; }
  });
}
const fakeCanvas = () => ({
  width: 1024, height: 1024, style: {},
  getContext: (t) => (t === '2d' ? make2D() : null),
  addEventListener() {}, removeEventListener() {},
  requestPointerLock() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
});
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? fakeCanvas() : { style: {}, appendChild() {}, addEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
  pointerLockElement: null, exitPointerLock: null, getElementById: () => null,
  body: { classList: { add() {}, remove() {}, toggle() {} } }
};
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  AudioContext: null, requestAnimationFrame: () => 0
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
/* rAF с очередью: тесты могут «прокачивать» кадры как браузер */
const _rafQ = [];
globalThis.requestAnimationFrame = (cb) => { _rafQ.push(cb); return _rafQ.length; };
globalThis.__pumpRaf = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const cbs = _rafQ.splice(0, _rafQ.length);
    for (const cb of cbs) cb(performance.now());
  }
};
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k)
};
globalThis.WebSocket = class { constructor() { throw new Error('no ws in test'); } };

/* ---------- импорты ---------- */
const THREE = await import('three');
const data = await import('../src/core/data.js');
const { rankByXp, RANKS, WEAPONS, DRONES, VEHICLES, MODES, MAPS, FACTIONS } = data;
const { GameMap, ColliderGrid } = await import('../src/world/map.js');
const { Actor } = await import('../src/game/actor.js');
const { Bot } = await import('../src/game/bot.js');
const { Effects } = await import('../src/game/effects.js');
const { Vehicle, FpvDrone } = await import('../src/game/machines.js');
const { Game } = await import('../src/game/game.js');
const { Profile, Sfx } = await import('../src/core/store.js');

let pass = 0, fail = 0;
const results = [];
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function runAll() {
  for (const t of tests) {
    try { await t.fn(); pass++; results.push(['PASS', t.name, '']); }
    catch (e) { fail++; results.push(['FAIL', t.name, (e && e.message || String(e)) + '\n' + ((e && e.stack) || '').split('\n').slice(1, 3).join('\n')]); }
  }
}
const finite = (v, what) => assert.ok(Number.isFinite(v), `${what} = ${v} (не число)`);

/* =============== 1. ДАННЫЕ =============== */
test('данные: все ранги строго возрастают по XP', () => {
  for (let i = 1; i < RANKS.length; i++) assert.ok(RANKS[i].xp > RANKS[i - 1].xp, `ранг ${i}`);
  for (const r of RANKS) assert.ok(r.n && r.lvl > 0, 'ранг без имени/уровня');
});

test('данные: rankByXp корректен на границах', () => {
  assert.equal(rankByXp(0).idx, 0);
  assert.equal(rankByXp(299).idx, 0);
  assert.equal(rankByXp(300).idx, 1);
  assert.equal(rankByXp(1e9).idx, RANKS.length - 1);
  assert.equal(rankByXp(1e9).next, null);
  const mid = rankByXp(10000);
  assert.ok(mid.prog >= 0 && mid.prog <= 1, `prog=${mid.prog}`);
});

test('данные: всё оружие валидно', () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    assert.ok(w.name && w.type, `${id}: нет имени`);
    assert.ok(['primary', 'secondary', 'gadget'].includes(w.kind), `${id}: kind`);
    if (w.dmg !== undefined) assert.ok(w.dmg > 0, `${id}: dmg`);
    if (w.mag !== undefined) assert.ok(w.mag > 0 && w.reserve > 0, `${id}: mag/reserve`);
    if (w.bars) for (const [k, v] of Object.entries(w.bars)) assert.ok(v >= 0 && v <= 1, `${id}.${k}=${v}`);
  }
  for (const [id, d] of Object.entries(DRONES)) assert.ok(d.speed > 0 && d.warhead > 0, id);
  for (const [id, v] of Object.entries(VEHICLES)) assert.ok(v.hp > 0 && v.speed > 0, id);
  for (const k of ['tdm', 'dom', 'pve', 'pvp']) assert.ok(MODES[k], k);
  for (const k of ['meridian', 'ridge', 'urban']) assert.ok(MAPS[k], k);
  assert.ok(FACTIONS.vega.color !== FACTIONS.argo.color, 'цвета сторон совпадают');
});

test('данные: комплект по умолчанию разблокирован на 1 уровне', () => {
  const def = { primary: 'vixen', secondary: 'gyurza', gadgets: ['frag', 'smoke', 'plate'], drone: 'striker' };
  for (const id of [def.primary, def.secondary, ...def.gadgets, def.drone]) {
    const it = WEAPONS[id] || DRONES[id];
    assert.ok(it, `${id} не найден`);
    assert.ok((it.unlockLvl ?? 1) <= 1, `${id} заблокирован на старте`);
  }
});

/* =============== 2. ПРОФИЛЬ =============== */
test('профиль: сохранение/загрузка и прогресс ранга', () => {
  Profile.load();
  assert.ok(Profile.data.name !== undefined);
  const r0 = Profile.rankInfo;
  assert.equal(r0.idx, 0);
  const res = Profile.addXp(5000);
  assert.equal(Profile.rankInfo.idx, res.after.idx);
  assert.ok(Profile.rankInfo.idx > r0.idx, 'ранг не вырос после 5000 XP');
  assert.ok(res.promoted, 'promoted=false при повышении');
  Profile.data.xp = 0; Profile.save();
});

/* =============== 3. КАРТА =============== */
const maps = {};
for (const id of Object.keys(MAPS)) {
  test(`карта «${MAPS[id].name}»: генерация без NaN`, () => {
    const m = new GameMap(MAPS[id]);
    maps[id] = m;
    assert.ok(m.heights.length === (m.seg + 1) ** 2);
    let nan = 0, min = Infinity, max = -Infinity;
    for (const h of m.heights) { if (!Number.isFinite(h)) nan++; if (h < min) min = h; if (h > max) max = h; }
    assert.equal(nan, 0, `${nan} NaN в heightfield`);
    assert.ok(max - min > 3, `плоская карта: ${min}..${max}`);
    for (const p of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(50, 0, -30), new THREE.Vector3(-120, 0, 90)]) {
      finite(m.heightAt(p.x, p.z), `heightAt(${p.x},${p.z})`);
    }
    assert.ok(m.colliders.list.length > 100, `мало коллайдеров: ${m.colliders.list.length}`);
    assert.ok(m.buildings.length > 5, `мало построек: ${m.buildings.length}`);
    assert.equal(m.objectives.length, 3, 'должно быть 3 точки захвата');
    assert.ok(m.spawn.vega.length >= 20 && m.spawn.argo.length >= 20, 'мало точек спавна');
    assert.ok(m.vehiclesSpots.length >= 4, 'мало мест техники');
    assert.ok(m.coverPoints.length > 20, 'мало точек укрытий');
    assert.ok(m.terrainCanvas, 'нет текстуры для миникарты');
    // вода не должна затапливать карту и ключевые точки
    let under = 0;
    for (const h of m.heights) if (h < m.waterLevel) under++;
    const waterPct = under / m.heights.length;
    assert.ok(waterPct < 0.35, `слишком много воды: ${(waterPct * 100).toFixed(1)}%`);
    assert.ok(waterPct > 0.01, 'реки не видно вообще');
    for (const f of ['vega', 'argo']) {
      assert.ok(m.base[f].y > m.waterLevel, `база ${f} в воде`);
      assert.ok(m.spawn[f].every(p => p.y > m.waterLevel), `спавны ${f} в воде`);
    }
    for (const o of m.objectives) assert.ok(o.pos.y > m.waterLevel, `точка ${o.name} в воде`);
    for (const v of m.vehiclesSpots) assert.ok(v.pos.y > m.waterLevel, 'техника в воде');
  });
}

test('карта: границы спавна внутри карты и не в воде', () => {
  const m = maps.meridian;
  const half = m.size / 2;
  for (const f of ['vega', 'argo']) {
    for (const p of m.spawn[f]) {
      assert.ok(Math.abs(p.x) < half && Math.abs(p.z) < half, 'спавн за границей');
      finite(p.y, 'spawn.y');
    }
  }
  assert.ok(m.base.vega.distanceTo(m.base.argo) > m.size * 0.8, 'базы слишком близко');
});

test('карта: normalAt возвращает единичный вектор', () => {
  const m = maps.meridian;
  for (const [x, z] of [[0, 0], [80, -40], [-150, 120]]) {
    const n = m.normalAt(x, z);
    assert.ok(Math.abs(n.length() - 1) < 1e-3, `|n|=${n.length()}`);
    assert.ok(n.y > 0.4, `нормаль смотрит вниз: ${n.y}`);
  }
});

test('коллизии: resolve выталкивает из коробки', () => {
  const g = new ColliderGrid(10);
  g.add({ min: new THREE.Vector3(-2, 0, -2), max: new THREE.Vector3(2, 3, 2) }, 'box');
  const p = new THREE.Vector3(0, 1, 0);
  g.resolve(p, 0.42, 0);
  assert.ok(p.length() > 1.5, `не вытолкнуло: ${p}`);
});

test('коллизии: raycast находит стену и не находит мимо', () => {
  const g = new ColliderGrid(10);
  g.add({ min: new THREE.Vector3(-5, 0, -5), max: new THREE.Vector3(5, 4, 5) }, 'box');
  const hit = g.raycast({ x: 0, y: 1, z: -20 }, { x: 0, y: 0, z: 1 }, 60);
  assert.ok(hit, 'луч не попал в стену');
  assert.ok(Math.abs(hit.dist - 15) < 0.6, `дистанция ${hit.dist}, ожидали ~15`);
  const miss = g.raycast({ x: 0, y: 1, z: -20 }, { x: 1, y: 0, z: 0 }, 60);
  assert.equal(miss, null, 'луч попал, хотя шёл мимо');
});

test('карта: line of sight блокируется зданием', () => {
  const m = maps.meridian;
  const b = m.buildings.find(x => x.h > 6);
  assert.ok(b, 'нет высокого здания');
  const gy = m.heightAt(b.x, b.z);
  const a = new THREE.Vector3(b.x - 12, gy + 1.6, b.z);
  const c = new THREE.Vector3(b.x + 12, gy + 1.6, b.z);
  assert.equal(m.hasLineOfSight(a, c), false, 'стена не блокирует видимость');
  const d = new THREE.Vector3(b.x - 12, gy + 1.6, b.z - 30);
  assert.equal(m.hasLineOfSight(a, d), true, 'видимость заблокирована на пустом месте');
});

/* =============== 4. АКТЁР / ФИЗИКА =============== */
test('актёр: 5 секунд физики без NaN и вне карты', () => {
  const m = maps.meridian;
  const a = new Actor({ id: 't1', name: 'TEST', faction: 'vega', isLocal: true });
  a.setLoadout('vixen', 'gyurza', ['frag'], 'striker');
  a.respawn(m.spawn.vega[0].clone(), 0);
  const input = { fwd: 1, right: 0.3, jump: false, crouch: false, sprint: true };
  for (let i = 0; i < 300; i++) {
    input.jump = i % 60 === 0;
    a.step(1 / 60, input, m);
  }
  finite(a.pos.x, 'pos.x'); finite(a.pos.y, 'pos.y'); finite(a.pos.z, 'pos.z');
  finite(a.vel.x, 'vel.x');
  assert.ok(Math.abs(a.pos.x) <= m.size / 2 && Math.abs(a.pos.z) <= m.size / 2, 'вышел за карту');
  assert.ok(a.pos.y >= m.heightAt(a.pos.x, a.pos.z) - 0.5, 'провалился под землю');
  assert.ok(a.pos.distanceTo(m.spawn.vega[0]) > 2, 'не сдвинулся с места');
  assert.ok(a.eyeHeight > 1 && a.eyeHeight < 1.8, `eyeHeight=${a.eyeHeight}`);
});

test('актёр: не проходит сквозь здание', () => {
  const m = maps.meridian;
  const b = m.buildings[0];
  const a = new Actor({ id: 't2', name: 'T', faction: 'vega', isLocal: true });
  a.setLoadout('vixen', 'gyurza', [], 'striker');
  const gy = m.heightAt(b.x - b.w, b.z);
  a.pos.set(b.x - b.w, gy, b.z);
  a.yaw = Math.PI / 2; // лицом к зданию
  for (let i = 0; i < 240; i++) a.step(1 / 60, { fwd: 1, right: 0, jump: false, crouch: false, sprint: true }, m);
  const inside = Math.abs(a.pos.x - b.x) < b.w / 2 - 0.2 && Math.abs(a.pos.z - b.z) < b.d / 2 - 0.2;
  assert.ok(!inside, `актёр внутри здания: ${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)} vs ${b.x.toFixed(1)},${b.z.toFixed(1)}`);
});

test('актёр: урон, броня, смерть и респаун', () => {
  const a = new Actor({ id: 't3', name: 'V', faction: 'argo' });
  a.setLoadout('vixen', 'gyurza', [], 'striker');
  a.respawn(new THREE.Vector3(0, 0, 0), 0);
  a.spawnProtection = 0;
  const killer = new Actor({ id: 't4', name: 'K', faction: 'vega' });
  a.armor = 50;
  const dealt = a.applyDamage(30, killer, 'body');
  assert.ok(dealt > 0 && dealt < 30, `броня не поглотила: ${dealt}`);
  assert.ok(a.armor < 50, 'броня не уменьшилась');
  let died = false;
  a.onDeath = () => { died = true; };
  a.applyDamage(9999, killer, 'body');
  assert.equal(a.alive, false);
  assert.ok(died, 'onDeath не вызван');
  assert.equal(a.deaths, 1);
  a.respawn(new THREE.Vector3(5, 0, 5), 0);
  assert.equal(a.alive, true);
  assert.equal(a.hp, a.maxHp);
  assert.ok(a.slots[0].mag === a.slots[0].def.mag, 'магазин не восстановился');
});

test('актёр: хедшот бьёт сильнее тела', () => {
  const mk = () => { const a = new Actor({ id: 'x', name: 'x', faction: 'argo' }); a.setLoadout('vixen', 'gyurza', [], 'striker'); a.respawn(new THREE.Vector3(), 0); a.spawnProtection = 0; a.armor = 0; return a; };
  const body = mk(), head = mk();
  const dBody = body.applyDamage(20, null, 'body');
  const dHead = head.applyDamage(20, null, 'head');
  assert.ok(dHead > dBody * 1.5, `head=${dHead} body=${dBody}`);
});

test('актёр: перезарядка и расход патронов', () => {
  const a = new Actor({ id: 't5', name: 'R', faction: 'vega' });
  a.setLoadout('vixen', 'gyurza', [], 'striker');
  a.respawn(new THREE.Vector3(), 0);
  const before = a.weapon.mag;
  a.weapon.mag = 5;
  a.startReload(0);
  assert.ok(a.reloadUntil > 0, 'reloadUntil не установлен');
  a.reloadUntil = 0.0001;
  a.finishReload();
  assert.equal(a.weapon.mag, before, 'магазин не заполнен');
  assert.ok(a.weapon.reserve < 210, 'запас не уменьшился');
});

test('актёр: разброс растёт в движении и падает в прицеле', () => {
  const a = new Actor({ id: 't6', name: 'S', faction: 'vega' });
  a.setLoadout('sokol', 'gyurza', [], 'striker');
  a.respawn(new THREE.Vector3(), 0);
  a.vel.set(0, 0, 0); a.onGround = true;
  a.ads = false; const hip = a.currentSpread();
  a.ads = true; const ads = a.currentSpread();
  a.ads = false; a.vel.set(8, 0, 0); a.onGround = true; const move = a.currentSpread();
  assert.ok(ads < hip, `ads=${ads} hip=${hip}`);
  assert.ok(move > hip, `move=${move} hip=${hip}`);
});

/* =============== 5. БОТЫ =============== */
test('бот: ИИ 10 секунд — двигается, целится, стреляет', () => {
  const m = maps.meridian;
  const effects = new Effects(new THREE.Scene(), m);
  const fakeGame = { map: m, effects, onBotUseGadget() {}, throwGrenade() {} };
  const bot = new Bot({ id: 'b1', faction: 'vega', skill: 'normal', name: 'TEST' });
  bot.assignKit();
  bot.game = fakeGame;
  bot.respawn(m.spawn.vega[0].clone(), 0);

  const enemy = new Actor({ id: 'e1', name: 'ENEMY', faction: 'argo' });
  enemy.setLoadout('bulat', 'gyurza', [], 'striker');
  enemy.respawn(new THREE.Vector3(bot.pos.x + 14, 0, bot.pos.z + 3), 0);
  enemy.pos.y = m.heightAt(enemy.pos.x, enemy.pos.z);
  enemy.alive = true;

  const actors = [bot, enemy];
  let shots = 0, movedMax = 0;
  const start = bot.pos.clone();
  for (let i = 0; i < 600; i++) {
    // держим врага живым и рядом, чтобы бот точно вошёл в бой
    if (!enemy.alive) { enemy.respawn(new THREE.Vector3(bot.pos.x + 12, 0, bot.pos.z), 0); enemy.pos.y = m.heightAt(enemy.pos.x, enemy.pos.z); enemy.spawnProtection = 0; }
    enemy.hp = enemy.maxHp;
    bot.tick(1 / 60, { game: fakeGame, actors, mode: 'tdm', objectives: m.objectives, enemyBase: () => m.base.argo });
    if (bot.wantsFire) shots++;
    movedMax = Math.max(movedMax, bot.pos.distanceTo(start));
    finite(bot.pos.x, 'bot.x'); finite(bot.yaw, 'bot.yaw');
    effects.update(1 / 60);
  }
  assert.equal(bot.aiState, 'engage', `бот не вошёл в бой (aiState=${bot.aiState})`);
  assert.ok(shots > 0, 'бот ни разу не выстрелил');
  assert.ok(movedMax > 1.5, `бот не двигался (${movedMax.toFixed(2)}м)`);
});

test('бот: все уровни сложности настраиваются', () => {
  for (const s of ['easy', 'normal', 'hard']) {
    const b = new Bot({ id: 'b_' + s, faction: 'argo', skill: s });
    b.assignKit();
    assert.ok(b.sk && b.sk.react > 0, s);
    assert.ok(b.maxHp > 0, s);
    assert.ok(b.weapon && b.weapon.def, `${s}: нет оружия`);
  }
});

/* =============== 6. ТЕХНИКА И ДРОНЫ =============== */
test('техника: танк едет, стреляет, уничтожается', () => {
  const m = maps.meridian;
  const scene = new THREE.Scene();
  const effects = new Effects(scene, m);
  const g = { map: m, scene, effects, onVehicleDestroyed: () => { destroyed = true; }, onVehicleImpact() {},
    fireVehicleShell() { shells++; }, fireVehicleMG() {} };
  let destroyed = false, shells = 0;
  // берём самое ровное и свободное место под танк, иначе он упирается в рельеф
  // карта обязана выдавать под технику свободные площадки
  const spot = m.vehiclesSpots.find(sp => !m.colliders.query(sp.pos.x, sp.pos.z, 7).length);
  assert.ok(spot, 'нет свободной точки под технику');
  const v = new Vehicle('bulat_mb', spot.pos.clone(), 'vega', g);
  const driver = new Actor({ id: 'dr', name: 'D', faction: 'vega', isLocal: true });
  driver.setLoadout('vixen', 'gyurza', [], 'striker');
  assert.equal(v.enter(driver), 'driver');
  assert.equal(driver.state, 'vehicle');
  const start = v.mesh.position.clone();
  let maxSpeed = 0;
  for (let i = 0; i < 300; i++) {
    v.step(1 / 60, { throttle: 1, steer: 0.15 });
    maxSpeed = Math.max(maxSpeed, Math.abs(v.speed));
  }
  assert.ok(maxSpeed > 3, `танк не разогнался: максимум ${maxSpeed.toFixed(2)} м/с`);
  assert.ok(v.mesh.position.distanceTo(start) > 10, `танк не проехал: ${v.mesh.position.distanceTo(start).toFixed(1)} м`);
  finite(v.mesh.position.x, 'veh.x');
  assert.ok(v.mesh.position.y > m.heightAt(v.mesh.position.x, v.mesh.position.z) - 2, 'танк под землёй');
  assert.ok(v.fireCannon(new THREE.Vector3(0, 0, -1)), 'орудие не выстрелило');
  assert.equal(v.fireCannon(new THREE.Vector3(0, 0, -1)), false, 'нет перезарядки орудия');
  assert.equal(shells, 1);
  v.applyDamage(99999, driver);
  assert.equal(v.alive, false);
  assert.ok(destroyed, 'onVehicleDestroyed не вызван');
  v.exit(driver);
  assert.equal(driver.state, 'ground');
});

test('техника: все 4 модели создаются и имеют башню где надо', () => {
  const m = maps.meridian;
  const g = { map: m, scene: new THREE.Scene(), effects: new Effects(new THREE.Scene(), m),
    onVehicleDestroyed() {}, onVehicleImpact() {}, fireVehicleShell() {}, fireVehicleMG() {} };
  for (const t of Object.keys(VEHICLES)) {
    const v = new Vehicle(t, m.vehiclesSpots[0].pos, 'vega', g);
    assert.ok(v.mesh, t);
    assert.equal(v.def.id, t);
    if (v.def.cannon) assert.ok(v.mesh.userData.turret, `${t}: нет башни`);
    v.remove();
  }
});

test('дрон: ФПВ летит, садится и детонирует', () => {
  const m = maps.meridian;
  const scene = new THREE.Scene();
  const effects = new Effects(scene, m);
  let detonated = false;
  const g = { map: m, scene, effects, droneDetonate: () => { detonated = true; } };
  const owner = new Actor({ id: 'op', name: 'OP', faction: 'vega', isLocal: true });
  owner.setLoadout('vixen', 'gyurza', [], 'striker');
  owner.respawn(m.spawn.vega[0].clone(), 0);
  const d = new FpvDrone(owner, g, 'striker');
  for (let i = 0; i < 120; i++) d.step(1 / 60, { throttle: 1, pitch: 0.3, roll: 0.2, yaw: 0.4 }, m);
  finite(d.pos.x, 'drone.x'); finite(d.pos.y, 'drone.y');
  assert.ok(d.pos.y > m.heightAt(d.pos.x, d.pos.z), 'дрон под землёй');
  assert.ok(d.battery < d.maxBattery, 'батарея не расходуется');
  assert.ok(d.mesh.userData.props.length === 4);
  // роняем дрон на землю с большой скоростью
  d.pos.set(d.pos.x, m.heightAt(d.pos.x, d.pos.z) + 2.2, d.pos.z);
  d.vel.set(10, -45, 0);
  for (let i = 0; i < 30 && !detonated; i++) d.step(1 / 60, { throttle: 0, pitch: 0, roll: 0, yaw: 0 }, m);
  assert.ok(detonated, 'дрон не сдетонировал при падении');
  assert.equal(d.alive, false, 'дрон остался жив после детонации');
});

test('дрон: батарея садится и дрон падает', () => {
  const m = maps.meridian;
  const g = { map: m, scene: new THREE.Scene(), effects: new Effects(new THREE.Scene(), m), droneDetonate() { done = true; } };
  let done = false;
  const owner = new Actor({ id: 'op2', name: 'OP', faction: 'argo' });
  owner.setLoadout('vixen', 'gyurza', [], 'striker');
  owner.respawn(m.spawn.argo[0].clone(), 0);
  const d = new FpvDrone(owner, g, 'swift');
  for (let i = 0; i < 60 * 60 && !done; i++) d.step(1 / 60, { throttle: 0.5, pitch: 0, roll: 0, yaw: 0 }, m);
  assert.ok(done, 'дрон не упал после разряда батареи');
});

/* =============== 7. ПОЛНЫЙ МАТЧ =============== */
function makeUiStub() {
  const calls = { toast: [], killfeed: [], deaths: 0, results: null, hudShown: null };
  const hud = new Proxy({
    calls,
    setMode() {}, updateVitals() {}, updateAmmo() {}, updateSlots() {}, updateGadgets() {},
    setStance() {}, setCrosshairGap() {}, hitmarker() {}, shake() {}, damage() {},
    objective() {}, wave() {}, interact() {}, setFps() {}, setVehicle() {}, setVehicleStats() {},
    setDrone() {}, setDroneStats() {}, onRespawn() {}, setRespawn() {}, showScoreboard() {},
    hideScoreboard() {}, setClock() {}, setScores() {}, drawMinimap() {}, drawCompass() {},
    toast: (t) => calls.toast.push(t),
    killfeed: (e) => calls.killfeed.push(e),
    onDeath: () => { calls.deaths++; }
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const ui = {
    hud, calls, settings: { sens: 1, adsSens: 0.8, fov: 82, volume: 0.7, quality: 'low',
      showFps: false, autoReload: true, invertY: false, minimapScale: 1 },
    showHud: (v) => { calls.hudShown = v; },
    showResults: (v, s, st) => { calls.results = { v, s, st }; },
    togglePause() {}, setScoreboard() {}, setLocked() {}, toast: (t) => calls.toast.push(t)
  };
  return ui;
}

function makeGame() {
  const g = Object.create(Game.prototype);
  // поля конструктора (без WebGL/DOM)
  Object.assign(g, {
    canvas: fakeCanvas(), running: false, paused: false, matchOver: false,
    actors: new Map(), vehicles: [], drones: [], grenades: [], shells: [], mines: [],
    input: { fwd: 0, right: 0, jump: false, crouch: false, sprint: false, throttle: 0, steer: 0, pitch: 0, roll: 0, yaw: 0 },
    keys: new Set(), mouseDown: [false, false, false], pointerLocked: false,
    netTick: 0, lastFrame: performance.now(), fpsAcc: 0, fpsN: 0, fps: 60,
    mode: 'tdm', scores: { vega: 0, argo: 0 }, limit: 60, matchTime: 900, clock: 900, wave: 0,
    isHost: true, netId: 'local', matchPlayers: [], _localStats: null,
    renderer: { render() {}, setPixelRatio() {}, setSize() {} },
    scene: new THREE.Scene(),
    sens: 1, adsSensMul: 0.8, invertY: false, showFps: false, autoReload: true
  });
  g.camera = new THREE.PerspectiveCamera(82, 16 / 9, 0.08, 1400);
  g.scene.add(g.camera);
  g.vmGroup = new THREE.Group();
  g.camera.add(g.vmGroup);
  g.viewModel = null;
  return g;
}

function startMatch(mode, opts = {}) {
  const ui = makeUiStub();
  const g = makeGame();
  g.ui = ui;
  g.startMatch({
    mode, map: opts.map || 'meridian', bots: opts.bots ?? 8, skill: opts.skill || 'normal',
    limit: opts.limit ?? 25, seed: 12345, isHost: true, myId: 'local',
    players: [{ id: 'local', name: 'ИГРОК', faction: opts.faction || 'vega', level: 5,
      loadout: { primary: 'vixen', secondary: 'gyurza', gadgets: ['frag', 'smoke', 'plate'], drone: 'striker' } }],
    me: { name: 'ИГРОК', faction: opts.faction || 'vega', level: 5, rankName: 'СЕРЖАНТ',
      loadout: { primary: 'vixen', secondary: 'gyurza', gadgets: ['frag', 'smoke', 'plate'], drone: 'striker' } }
  });
  return { g, ui };
}

test('матч TDM: старт — игрок, 8 ботов, техника, HUD показан', () => {
  const { g, ui } = startMatch('tdm', { limit: 999 });
  assert.ok(g.running, 'матч не запущен');
  assert.ok(g.me && g.me.alive, 'игрок не заспавнен');
  assert.equal(ui.calls.hudShown, true);
  const bots = [...g.actors.values()].filter(a => a.isBotSim);
  assert.equal(bots.length, 8, `ботов: ${bots.length}`);
  assert.ok(bots.filter(b => b.faction === 'vega').length >= 4, 'нет ботов VEGA');
  assert.ok(bots.filter(b => b.faction === 'argo').length >= 4, 'нет ботов ARGO');
  assert.ok(g.vehicles.length >= 4, `техники: ${g.vehicles.length}`);
  assert.equal(g.objectives.length, 3);
  assert.ok(g.me.weapon && g.me.weapon.def.id === 'vixen', 'не то оружие');
  assert.equal(g.me.gadgets.length, 3);
  g.quit();
});

test('матч TDM: симуляция боя — боты воюют, счёт растёт', () => {
  const { g } = startMatch('tdm', { limit: 999, skill: 'normal', bots: 16 });
  g._primaryDown = false;
  let maxScore = 0;
  for (let i = 0; i < 60 * 120; i++) {
    g.lastFrame = performance.now() - 16.7;
    g.loop();
    maxScore = Math.max(maxScore, g.scores.vega + g.scores.argo);
  }
  assert.ok(g.running, 'матч неожиданно завершился');
  assert.ok(g.clock < 900, `таймер не идёт: ${g.clock}`);
  assert.ok(maxScore > 0, `за 120 секунд никто никого не убил (счёт ${maxScore})`);
  const totalDeaths = [...g.actors.values()].reduce((s, a) => s + a.deaths, 0);
  assert.ok(totalDeaths > 0, 'нет смертей');
  g.quit();
});

test('матч: игровой цикл сам крутится после старта (rAF), камера у игрока', () => {
  const { g } = startMatch('tdm', { limit: 999, bots: 0 });
  // как в браузере: кадры качаем через requestAnimationFrame, а не вручную
  for (let i = 0; i < 120; i++) { g.lastFrame = performance.now() - 16.7; globalThis.__pumpRaf(); }
  assert.ok(g.time > 1, `игровое время не идёт: ${g.time.toFixed(2)}`);
  const eye = g.me.eyePos(new THREE.Vector3());
  assert.ok(g.camera.position.distanceTo(eye) < 2,
    `камера не у игрока: ${g.camera.position.distanceTo(eye).toFixed(1)} м от глаз`);
  g.quit();
});

test('матч: оружие видно в кадре и перезарядка анимируется', () => {
  const { g } = startMatch('tdm', { limit: 999, bots: 0 });
  for (let i = 0; i < 30; i++) { g.lastFrame = performance.now() - 16.7; globalThis.__pumpRaf(); }
  assert.ok(g.viewModel, 'нет вью-модели оружия');
  assert.ok(g.vmGroup.visible, 'вью-модель скрыта');
  const p = g.vmGroup.position;
  assert.ok([p.x, p.y, p.z].every(Number.isFinite), `vmGroup улетел в NaN: ${p.x}, ${p.y}, ${p.z}`);
  const dist = g.vmGroup.position.distanceTo(new THREE.Vector3(0.22, -0.2, -0.42));
  assert.ok(dist < 0.3, `вью-модель не на месте: ${dist.toFixed(2)}`);

  // перезарядка: наклон ствола и выпадение магазина
  g.me.weapon.mag = 5;
  assert.ok(g.me.startReload(g.time), 'перезарядка не началась');
  const mag = g.viewModel.userData.mag;
  const magBase = mag.position.y;
  let maxTilt = 0, maxDrop = 0;
  for (let i = 0; i < 160; i++) {
    g.lastFrame = performance.now() - 16.7; globalThis.__pumpRaf();
    maxTilt = Math.max(maxTilt, g.viewModel.rotation.x);
    maxDrop = Math.max(maxDrop, magBase - mag.position.y);
  }
  assert.ok(maxTilt > 0.2, `ствол не клюёт при перезарядке: ${maxTilt.toFixed(3)}`);
  assert.ok(maxDrop > 0.05, `магазин не выпадает: ${maxDrop.toFixed(3)}`);
  assert.equal(g.me.weapon.mag, g.me.weapon.def.mag, 'магазин не дозаправился');
  assert.ok(g.viewModel.rotation.x < 0.05, 'анимация не вернулась после перезарядки');
  g.quit();
});

test('матч: победа по лимиту фрагов завершает бой', () => {
  const { g, ui } = startMatch('tdm', { limit: 3, skill: 'normal', bots: 16 });
  for (let i = 0; i < 60 * 180 && g.running; i++) {
    g.lastFrame = performance.now() - 16.7;
    g.loop();
  }
  assert.equal(g.running, false, `бой не завершился по лимиту (счёт ${g.scores.vega}:${g.scores.argo}, время ${Math.round(g.matchTime - g.clock)}с)`);
  const total = g.scores.vega + g.scores.argo;
  assert.ok(total >= 3, `счёт ${g.scores.vega}:${g.scores.argo} < лимита 3`);
  assert.ok(ui.calls.results, 'экран результатов не показан');
  assert.ok(['win', 'lose', 'draw'].includes(ui.calls.results.v), `verdict=${ui.calls.results.v}`);
});

test('матч DOM: захват точки даёт очки и меняет владельца', () => {
  const { g } = startMatch('dom', { limit: 999, bots: 0 });
  const o = g.objectives[0];
  assert.equal(o.owner, 'none');
  // телепортируем игрока на точку
  g.me.pos.set(o.pos.x, o.pos.y, o.pos.z);
  for (let i = 0; i < 60 * 12; i++) {
    g.me.pos.set(o.pos.x, g.map.heightAt(o.pos.x, o.pos.z), o.pos.z);
    g.me.vel.set(0, 0, 0);
    g.lastFrame = performance.now() - 16.7;
    g.loop();
    if (o.owner === g.me.faction) break;
  }
  assert.equal(o.owner, g.me.faction, `точка не захвачена (owner=${o.owner})`);
  // держим ещё 4 секунды — очки капают каждые 3с
  for (let i = 0; i < 60 * 4; i++) {
    g.me.pos.set(o.pos.x, g.map.heightAt(o.pos.x, o.pos.z), o.pos.z);
    g.me.vel.set(0, 0, 0);
    g.lastFrame = performance.now() - 16.7;
    g.loop();
  }
  assert.ok(g.scores[g.me.faction] > 0, 'очки за удержание не начислены');
  g.quit();
});

test('матч PvE: волны наращиваются', () => {
  const { g } = startMatch('pve', { limit: 999, bots: 4 });
  const w0 = g.wave;
  for (let i = 0; i < 60 * 70; i++) {
    g.lastFrame = performance.now() - 16.7;
    g.loop();
    if (g.wave > w0) break;
  }
  assert.ok(g.wave > w0, `волна не сменилась (${g.wave})`);
  g.quit();
});

test('матч PvP: боты не спавнятся', () => {
  const { g } = startMatch('pvp', { bots: 12 });
  const bots = [...g.actors.values()].filter(a => a.isBotSim);
  assert.equal(bots.length, 0, `в PvP заспавнились боты: ${bots.length}`);
  g.quit();
});

test('матч: игрок может стрелять и попадать по боту', () => {
  const { g } = startMatch('tdm', { limit: 999, bots: 0 });
  // ставим врага прямо перед игроком
  const enemy = new Actor({ id: "victim", name: "ЖЕРТВА", faction: "argo" });
  enemy.setLoadout('bulat', 'gyurza', [], 'striker');
  enemy.respawn(g.me.pos.clone(), 0);
  // ищем направление с чистой видимостью, чтобы тест не зависел от случайного мусора на карте
  let placed = false;
  for (let a = 0; a < Math.PI * 2 && !placed; a += Math.PI / 24) {
    const dist = 7;
    const px = g.me.pos.x - Math.sin(a) * dist, pz = g.me.pos.z - Math.cos(a) * dist;
    const py = g.map.heightAt(px, pz);
    const from = g.me.eyePos(new THREE.Vector3());
    const to = new THREE.Vector3(px, py + 1.4, pz);
    if (!g.map.hasLineOfSight(from, to)) continue;
    if (g._rayWorld(from, to.clone().sub(from).normalize(), dist + 1) < dist) continue;
    enemy.pos.set(px, py, pz);
    g.me.yaw = a;
    g.me.pitch = Math.atan2(to.y - from.y, dist);
    placed = true;
  }
  assert.ok(placed, 'не нашлось направления с чистой видимостью');
  enemy.netPos.copy(enemy.pos);
  enemy.spawnProtection = 0;
  g.scene.add(enemy.mesh);
  g.actors.set(enemy.id, enemy);
  g.camera.rotation.order = 'YXZ';

  const hpBefore = enemy.hp;
  let fired = 0;
  for (let i = 0; i < 40 && enemy.alive; i++) {
    g.lastFrame = performance.now() - 16.7;
    g._primaryDown = true;
    g.loop();
    // актёр оседает на рельефе — наводимся заново по фактическим позициям
    enemy.pos.y = g.map.heightAt(enemy.pos.x, enemy.pos.z);
    enemy.netPos.copy(enemy.pos);
    const from = g.me.eyePos(new THREE.Vector3());
    const dx = enemy.pos.x - from.x, dz = enemy.pos.z - from.z;
    g.me.yaw = Math.atan2(-dx, -dz);
    g.me.pitch = Math.atan2((enemy.pos.y + 1.3) - from.y, Math.hypot(dx, dz));
    fired++;
  }
  assert.ok(fired > 0);
  assert.ok(enemy.hp < hpBefore || !enemy.alive, `урон не прошёл: ${hpBefore} -> ${enemy.hp}`);
  g.quit();
});

test('матч: граната взрывается и наносит урон', () => {
  const { g } = startMatch('tdm', { limit: 999, bots: 0 });
  const enemy = new Actor({ id: 'gv', name: 'G', faction: 'argo' });
  enemy.setLoadout('bulat', 'gyurza', [], 'striker');
  enemy.respawn(g.me.pos.clone(), 0);
  enemy.pos.add(new THREE.Vector3(3, 0, 0));
  enemy.pos.y = g.map.heightAt(enemy.pos.x, enemy.pos.z);
  enemy.spawnProtection = 0;
  g.scene.add(enemy.mesh);
  g.actors.set(enemy.id, enemy);

  g.throwGrenade(g.me, enemy.pos.clone(), 'frag');
  assert.equal(g.grenades.length, 1);
  for (let i = 0; i < 60 * 5; i++) {
    g.lastFrame = performance.now() - 16.7;
    g.loop();
  }
  assert.equal(g.grenades.length, 0, 'граната не взорвалась');
  assert.ok(enemy.hp < enemy.maxHp || !enemy.alive, 'граната не нанесла урона');
  g.quit();
});

test('матч: дымовая завеса блокирует видимость', () => {
  const { g } = startMatch('tdm', { limit: 999, bots: 0 });
  const a = g.me.pos.clone(); a.y += 1.5;
  const b = a.clone().add(new THREE.Vector3(14, 0, 0));
  assert.equal(g.effects.blocksVision(a, b), false);
  g.effects.addSmokeField(a.clone().add(new THREE.Vector3(7, 0, 0)).setY(g.map.heightAt(a.x + 7, a.z) + 1), 10, 7);
  assert.equal(g.effects.blocksVision(a, b), true, 'дым не блокирует видимость');
});

test('матч: дрон запускается и возвращается', () => {
  const { g } = startMatch('tdm', { limit: 999, bots: 0 });
  g._toggleDrone();
  assert.ok(g.activeDrone, 'дрон не запущен');
  assert.equal(g.me.state, 'drone');
  for (let i = 0; i < 90; i++) {
    g.input.throttle = 1; g.input.pitch = 0.4;
    g.lastFrame = performance.now() - 16.7;
    g.loop();
  }
  finite(g.activeDrone ? g.activeDrone.pos.y : 0, 'drone y');
  g._endDrone();
  assert.equal(g.activeDrone, null, 'дрон не завершён');
  assert.equal(g.me.state, 'ground');
  g.quit();
});

test('матч: игрок садится в технику и выходит', () => {
  const { g } = startMatch('tdm', { limit: 999, bots: 0 });
  const v = g.vehicles.find(x => x.alive);
  g.me.pos.copy(v.mesh.position).add(new THREE.Vector3(2, 0, 0));
  g.me.pos.y = g.map.heightAt(g.me.pos.x, g.me.pos.z);
  g._tryInteract();
  assert.equal(g.me.state, 'vehicle', 'не сел в технику');
  assert.equal(v.driver, g.me);
  for (let i = 0; i < 60; i++) { g.lastFrame = performance.now() - 16.7; g.loop(); }
  g._tryInteract();
  assert.equal(g.me.state, 'ground', 'не вышел из техники');
  assert.equal(v.driver, null);
  g.quit();
});

test('матч: смерть и авто-респаун игрока', async () => {
  const { g, ui } = startMatch('tdm', { limit: 999, bots: 0 });
  g.me.spawnProtection = 0;
  g.me.applyDamage(9999, null, 'body');
  assert.equal(g.me.alive, false);
  assert.equal(ui.calls.deaths, 1);
  // респаун идёт по игровому времени — прокручиваем цикл
  for (let i = 0; i < 60 * 12 && !g.me.alive; i++) {
    g.lastFrame = performance.now() - 16.7;
    g.loop();
  }
  assert.ok(g.me.alive, 'игрок не возродился');
  assert.equal(g.me.hp, g.me.maxHp);
  g.quit();
});

test('матч: все 3 карты запускаются и играбельны', () => {
  for (const mapId of Object.keys(MAPS)) {
    const { g } = startMatch('tdm', { limit: 999, map: mapId, bots: 4 });
    assert.ok(g.running, mapId);
    for (let i = 0; i < 180; i++) { g.lastFrame = performance.now() - 16.7; g.loop(); }
    assert.ok(g.running, `${mapId}: матч упал`);
    finite(g.me.pos.x, `${mapId}: me.x`);
    g.quit();
  }
});

test('матч: quit() полностью очищает сцену', () => {
  const { g } = startMatch('tdm', { limit: 999, bots: 8 });
  assert.ok(g.actors.size > 0);
  g.quit();
  assert.equal(g.running, false);
  assert.equal(g.actors.size, 0, 'актёры не очищены');
  assert.equal(g.vehicles.length, 0, 'техника не очищена');
  assert.equal(g.drones.length, 0, 'дроны не очищены');
  assert.equal(g.grenades.length, 0, 'гранаты не очищены');
});

/* ---------- отчёт ---------- */
await runAll();
console.log('');
console.log('  ════════════════════════════════════════════════════════════');
for (const [st, name, err] of results) {
  console.log(`  ${st === 'PASS' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  if (err) console.log(`      \x1b[31m${err.split('\n').join('\n      ')}\x1b[0m`);
}
console.log('  ════════════════════════════════════════════════════════════');
console.log(`  ${pass} пройдено, ${fail} провалено`);
console.log('');
process.exit(fail ? 1 : 0);
