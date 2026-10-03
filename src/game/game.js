import * as THREE from 'three';
import { GameMap } from '../world/map.js';
import { Actor, ACTOR_KIND, Clock } from './actor.js';
import { Bot } from './bot.js';
import { Vehicle, FpvDrone } from './machines.js';
import { Effects } from './effects.js';
import { makeViewModel } from '../entities/models.js';
import { FACTIONS, MAPS, MODES, WEAPONS, DRONES, VEHICLES, BOT_NAMES } from '../core/data.js';
import { Net } from '../net/client.js';
import { Sfx } from '../core/store.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

/* ============================================================
   ГЛАВНЫЙ КЛАСС ИГРЫ
   ============================================================ */
export class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.running = false;
    this.paused = false;
    this.matchOver = false;

    this.actors = new Map();
    this.vehicles = [];
    this.drones = [];
    this.grenades = [];
    this.shells = [];
    this.mines = [];

    this.input = this._emptyInput();
    this.keys = new Set();
    this.mouseDown = [false, false, false];
    this.pointerLocked = false;
    this.netTick = 0;
    this.lastFrame = performance.now();
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 60;

    this.time = 0;
    Clock.t = 0;
    this.mode = 'tdm';
    this.scores = { vega: 0, argo: 0 };
    this.limit = 60;
    this.matchTime = 900;
    this.clock = 900;
    this.wave = 0;

    this.isHost = true;
    this.netId = null;
    this.matchPlayers = [];

    this._initRenderer();
    this._initInput();
  }

  /* ================= РЕНДЕРЕР ================= */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(82, innerWidth / innerHeight, 0.08, 1400);
    this.scene.add(this.camera);

    this.vmGroup = new THREE.Group();
    this.camera.add(this.vmGroup);
    this.vmGroup.position.set(0.22, -0.2, -0.42);

    this.viewModel = null;
    this.muzzleFlash = null;

    addEventListener('resize', () => this._resize());
  }

  _resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  applySettings(s) {
    this.sens = s.sens ?? 1;
    this.adsSensMul = s.adsSens ?? 0.75;
    this.invertY = !!s.invertY;
    this.showFps = s.showFps !== false;
    this.camera.fov = s.fov ?? 82;
    this.camera.updateProjectionMatrix();
    const q = s.quality || 'high';
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.setPixelRatio(q === 'low' ? 1 : q === 'medium' ? 1.25 : Math.min(devicePixelRatio, 1.75));
    if (this.sun) this.sun.castShadow = q !== 'low';
  }

  /* ================= СОЗДАНИЕ СЦЕНЫ ================= */
  buildMap(mapId) {
    const cfg = MAPS[mapId] || MAPS.meridian;
    this.mapCfg = cfg;
    if (this.map) {
      this.scene.remove(this.map.group);
      this.map.group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose && m.dispose()); }
      });
    }
    this.map = new GameMap(cfg);
    this.scene.add(this.map.group);

    // небо
    if (this.sky) this.scene.remove(this.sky);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(cfg.sky).multiplyScalar(0.55) },
          bot: { value: new THREE.Color(cfg.sky).lerp(new THREE.Color(0xffe6bd), 0.42) },
          sunDir: { value: new THREE.Vector3(0.4, 0.55, 0.3).normalize() }
        },
        vertexShader: `varying vec3 vW; void main(){ vW = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}`,
        fragmentShader: `uniform vec3 top; uniform vec3 bot; uniform vec3 sunDir; varying vec3 vW;
          void main(){ float h = clamp(vW.y*0.5+0.5, 0.0, 1.0);
            vec3 c = mix(bot, top, pow(h, 0.85));
            float s = pow(max(dot(normalize(vW), normalize(sunDir)),0.0), 220.0);
            c += vec3(1.0,0.92,0.75) * s * 2.2;
            float g = pow(max(dot(normalize(vW), normalize(sunDir)),0.0), 8.0);
            c += vec3(0.35,0.30,0.22) * g * 0.28;
            gl_FragColor = vec4(c,1.0);}`
      })
    );
    this.scene.add(this.sky);

    // свет
    if (this.sun) this.scene.remove(this.sun);
    if (this.hemi) this.scene.remove(this.hemi);
    this.hemi = new THREE.HemisphereLight(cfg.sky, cfg.palette.ground, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(cfg.sun, 1.35);
    this.sun.position.set(90, 130, 60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -70; this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70; this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 380;
    this.sun.shadow.bias = -0.0009;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.fog = new THREE.Fog(cfg.palette.fog, 90, 460);
    this.scene.background = new THREE.Color(cfg.sky).multiplyScalar(0.8);

    if (!this.effects) this.effects = new Effects(this.scene, this.map);
    else { this.effects.map = this.map; this.effects.clear(); }
  }

  /* ================= СТАРТ МАТЧА ================= */
  startMatch(cfg) {
    this.mode = cfg.mode || 'tdm';
    this.limit = cfg.limit ?? MODES[this.mode].limit;
    this.matchTime = MODES[this.mode].time;
    this.clock = this.matchTime;
    this.scores = { vega: 0, argo: 0 };
    this.wave = 0;
    this.matchOver = false;
    this.isHost = !!cfg.isHost;
    this.netId = cfg.myId || Net.id;
    this.matchPlayers = cfg.players || [];
    this.skill = cfg.skill || 'normal';
    this.botCount = cfg.bots ?? 8;
    this.seed = cfg.seed || 1;

    this.buildMap(cfg.map || 'meridian');

    // очистка
    for (const v of this.vehicles) v.remove();
    this.vehicles = [];
    for (const d of this.drones) d.remove();
    this.drones = [];
    for (const a of this.actors.values()) this.scene.remove(a.mesh);
    this.actors.clear();
    this.grenades.length = 0;
    this.shells.length = 0;
    this.mines.length = 0;
    if (this.activeDrone) { this.activeDrone.remove(); this.activeDrone = null; }

    // локальный игрок
    const me = cfg.me;
    this.me = new Actor({
      id: cfg.myId || 'local',
      name: me.name, faction: me.faction, isLocal: true,
      level: me.level, rankName: me.rankName, kind: ACTOR_KIND.PLAYER
    });
    this.me.setLoadout(me.loadout.primary, me.loadout.secondary, me.loadout.gadgets, me.loadout.drone);
    this.me.game = this;
    this.scene.add(this.me.mesh);
    this.me.mesh.visible = false;
    this.me.onDeath = (k, c) => this._onLocalDeath(k, c);
    this.me.onRespawn = () => { this.ui.hud.onRespawn(); };
    this.me.onHardLand = (v) => { if (v > 18) { this.me.applyDamage((v - 18) * 3.4, null, 'body', null, true); } };
    this.me.onReload = () => { Sfx.reload(); this.ui.hud.toast('ПЕРЕЗАРЯДКА'); };

    const spawn = this.map.spawn[this.me.faction][0];
    this.me.respawn(spawn, 0);
    const enemyBase = this.map.base[this.me.faction === 'vega' ? 'argo' : 'vega'];
    this.me.yaw = Math.atan2(-(enemyBase.x - spawn.x), -(enemyBase.z - spawn.z));

    // view model
    this._setViewModel(this.me.weapon);

    // другие игроки
    for (const p of this.matchPlayers) {
      if (p.id === this.netId) continue;
      this._addRemote(p);
    }

    // техника
    for (const s of this.map.vehiclesSpots) {
      const fac = (s.pos.x + s.pos.z > 0) ? 'argo' : 'vega';
      const v = new Vehicle(s.type, s.pos, Math.random() < 0.5 ? 'vega' : 'argo', this);
      v.spawnSpot = s;
      this.vehicles.push(v);
    }

    // боты (только хост)
    if (this.isHost) {
      this._spawnBots(this.botCount);
      this._hostState = { tick: 0 };
    }

    // точки захвата
    this.objectives = this.map.objectives.map(o => ({
      id: o.id, name: o.name, pos: o.pos.clone(), radius: o.radius,
      owner: 'none', progress: 0, capturers: new Set()
    }));

    this.running = true;
    this.paused = false;
    this.clock = this.matchTime;
    this._baseFov = this.camera.fov;
    this.autoReload = this.ui ? this.ui.settings.autoReload !== false : true;
    this.resetStats();
    document.body.classList.add('in-match');
    this.ui.showHud(true);
    this.ui.hud.setMode(MODES[this.mode].name, this.mapCfg.name);
    this._waveTimer = 0;
    this._announceWave();
    /* ВАЖНО: без этого цикл не крутится в браузере — boot() вызывал loop()
       при running=false, цепочка rAF умирала, и после «начать бой» камера
       оставалась в меню-орбите, а игрок «не появлялся». */
    this._ensureLoop();
  }

  _addRemote(p) {
    const a = new Actor({
      id: p.id, name: p.name, faction: p.faction, level: p.level,
      rankName: p.rank, kind: p.isBot ? ACTOR_KIND.BOT : ACTOR_KIND.REMOTE
    });
    a.isBotSim = !!p.isBot;
    const L = p.loadout || { primary: 'vixen', secondary: 'gyurza', gadgets: ['frag'], drone: 'striker' };
    a.setLoadout(L.primary, L.secondary, L.gadgets || ['frag'], L.drone || 'striker');
    const sp = this.map.spawn[a.faction][(Math.random() * this.map.spawn[a.faction].length) | 0];
    a.respawn(sp, 0);
    a.mesh.visible = true;
    this.scene.add(a.mesh);
    this.actors.set(a.id, a);
    return a;
  }

  _spawnBots(n) {
    if (!this.isHost) return;
    const perTeam = Math.ceil(n / 2);
    for (const fac of ['vega', 'argo']) {
      for (let i = 0; i < perTeam; i++) {
        if (this.mode === 'pvp') return;
        const b = new Bot({
          id: 'bot_' + fac[0] + i,
          faction: fac, skill: this.skill,
          name: BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0]
        });
        b.assignKit();
        const sp = this.map.spawn[fac][(Math.random() * this.map.spawn[fac].length) | 0];
        b.respawn(sp, 0);
        b.game = this;
        b.mesh.visible = true;
        this.scene.add(b.mesh);
        this.actors.set(b.id, b);
      }
    }
  }

  _setViewModel(w) {
    if (this.viewModel) {
      this.vmGroup.remove(this.viewModel);
      this.viewModel.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    if (!w) { this.viewModel = null; return; }
    this.viewModel = makeViewModel(w.def);
    this.vmGroup.add(this.viewModel);
    this._vmBase = this.vmGroup.position.clone();
    this._recoilOffset = 0;
  }

  /* ================= ВВОД ================= */
  _emptyInput() {
    return { fwd: 0, right: 0, jump: false, crouch: false, sprint: false,
             throttle: 0, steer: 0, pitch: 0, roll: 0, yaw: 0 };
  }

  _initInput() {
    const cv = this.canvas;
    cv.addEventListener('click', () => {
      if (this.running && !this.paused && !this.pointerLocked) cv.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === cv;
      this.ui.setLocked(this.pointerLocked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.running || this.paused) return;
      const s = 0.0022 * (this.sens || 1) * (this.me && this.me.ads ? this.adsSensMul : 1);
      this._look(e.movementX * s, -e.movementY * s * (this.invertY ? -1 : 1));
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked || !this.running) return;
      this.mouseDown[e.button] = true;
      if (e.button === 0) this._primaryDown = true;
      if (e.button === 2) { if (this.me && this.me.state === 'ground') this.me.ads = true; }
      if (e.button === 1) this._tryInteract();
    });
    document.addEventListener('mouseup', (e) => {
      this.mouseDown[e.button] = false;
      if (e.button === 0) this._primaryDown = false;
      if (e.button === 2 && this.me) this.me.ads = false;
    });
    document.addEventListener('contextmenu', (e) => { if (this.running) e.preventDefault(); });
    document.addEventListener('wheel', (e) => {
      if (!this.pointerLocked || !this.running) return;
      if (this.me && this.me.state === 'ground') {
        const cur = this.me.slot;
        this.me.switchSlot(cur === 0 ? 1 : 0);
        this._setViewModel(this.me.weapon);
      }
    }, { passive: true });

    addEventListener('keydown', (e) => {
      if (!this.running) return;
      const k = e.code;
      if (this.keys.has(k)) { if (k === 'Tab') e.preventDefault(); return; }
      this.keys.add(k);
      this._onKey(k, true, e);
      if (k === 'Tab') e.preventDefault();
      if (k.startsWith('Digit')) e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this._onKey(e.code, false, e);
    });
    addEventListener('blur', () => { this.keys.clear(); this._primaryDown = false; });
  }

  _look(dx, dy) {
    if (this.activeDrone) {
      this.activeDrone.yaw -= dx;
      this.activeDrone.pitch = THREE.MathUtils.clamp(this.activeDrone.pitch + dy, -1.35, 1.35);
      return;
    }
    if (this.me && this.me.vehicle && this.me.vehicle.driver === this.me) {
      const v = this.me.vehicle;
      v.turretYaw -= dx;
      v.turretPitch = THREE.MathUtils.clamp(v.turretPitch + dy, -0.2, 0.32);
      return;
    }
    if (!this.me) return;
    this.me.yaw -= dx;
    this.me.pitch = THREE.MathUtils.clamp(this.me.pitch + dy, -1.45, 1.45);
  }

  _onKey(code, down, e) {
    if (code === 'Tab') {
      this.ui.setScoreboard(down);
      return;
    }
    if (!down) return;
    const me = this.me;
    if (!me) return;
    switch (code) {
      case 'Digit1': if (me.state === 'ground' && me.switchSlot(0)) this._setViewModel(me.weapon); break;
      case 'Digit2': if (me.state === 'ground' && me.switchSlot(1)) this._setViewModel(me.weapon); break;
      case 'KeyR':
        if (me.state === 'ground') me.startReload(this.time);
        break;
      case 'KeyE': this._tryInteract(); break;
      case 'KeyG': this._toggleDrone(); break;
      case 'KeyQ': this._useGadget(0); break;
      case 'KeyF': this._useGadget(1); break;
      case 'KeyX': this._useGadget(2); break;
      case 'KeyV': this._useUav(); break;
      case 'Escape': this.ui.togglePause(); break;
    }
  }

  /* ================= ВЗАИМОДЕЙСТВИЕ ================= */
  _tryInteract() {
    const me = this.me;
    if (!me) return;
    if (me.state === 'vehicle') {
      const v = me.vehicle;
      v.exit(me);
      if (this.isHost) this._hostCast({ e: 'vexit', vid: v.id, aid: me.id });
      this.ui.hud.setVehicle(null);
      return;
    }
    if (me.state === 'drone') { this._endDrone(); return; }
    // поиск техники
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      if (v.mesh.position.distanceTo(me.pos) < 4.6) {
        const role = v.enter(me);
        if (role) {
          this.ui.hud.setVehicle(v);
          if (this.isHost) this._hostCast({ e: 'venter', vid: v.id, aid: me.id, role });
          this.ui.hud.toast(role === 'driver' ? 'ВЫ ЗА РУЛЕМ · ЛКМ — орудие, ПКМ — пулемёт' : 'ВЫ ДЕСАНТНИК · E — выйти');
        }
        return;
      }
    }
  }

  _nearestVehicle() {
    const me = this.me;
    let best = null, bd = 4.6;
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const d = v.mesh.position.distanceTo(me.pos);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  /* ================= ДРОН ================= */
  _toggleDrone() {
    if (this.activeDrone) { this._endDrone(); return; }
    const me = this.me;
    if (!me || !me.alive || me.state !== 'ground') return;
    const def = DRONES[me.droneType] || DRONES.striker;
    if (this.droneUsed && this.droneUsed >= 1) { this.ui.hud.toast('ДРОН УЖЕ ЗАПУЩЕН'); return; }
    const d = new FpvDrone(me, this, me.droneType);
    d.onDeathBy = null;
    this.drones.push(d);
    this.activeDrone = d;
    me.state = 'drone';
    me.mesh.visible = false;
    this.droneUsed = 1;
    Sfx.droneHum(true);
    this.ui.hud.setDrone(true);
    this._hostCast({ e: 'dspawn', id: d.id, owner: me.id, drone: def.id, fac: me.faction });
  }

  _endDrone() {
    const d = this.activeDrone;
    if (!d) return;
    this.activeDrone = null;
    if (d.alive) d.remove();
    this.drones = this.drones.filter(x => x !== d);
    this.me.state = 'ground';
    this.me.mesh.visible = false;
    this.droneUsed = 0;
    Sfx.droneHum(false);
    this.ui.hud.setDrone(false);
    this._hostCast({ e: 'ddespawn', id: d.id });
  }

  droneDetonate(drone, pos, killer, direct) {
    const def = drone.def;
    this.explode(pos, def.radius, def.warhead, killer || drone.owner, 'drone');
    if (drone.owner && drone.owner.isLocal) {
      this.me.state = 'ground';
      this.me.mesh.visible = false;
      this.droneUsed = 0;
      Sfx.droneHum(false);
      this.ui.hud.setDrone(false);
      this.activeDrone = null;
      this.drones = this.drones.filter(x => x !== drone);
    }
    this._hostCast({ e: 'ddetonate', id: drone.id, pos: [pos.x, pos.y, pos.z], r: def.radius, direct });
  }

  /* ================= СНАРЯЖЕНИЕ ================= */
  _useGadget(i) {
    const me = this.me;
    if (!me || !me.alive || me.state !== 'ground') return;
    const g = me.gadgets[i];
    if (!g || g.count <= 0) { this.ui.hud.toast('НЕТ СНАРЯЖЕНИЯ'); return; }
    g.count--;
    const eye = me.eyePos(new THREE.Vector3());
    const dir = me.lookDir(new THREE.Vector3());
    if (g.id === 'plate') {
      me.armor = Math.min(me.maxArmor, me.armor + g.def.armor);
      this.ui.hud.toast('+' + g.def.armor + ' БРОНЯ');
      Sfx.beep(true);
      this._hostCast({ e: 'gad', id: g.id, aid: me.id });
    } else {
      this.throwGrenade(me, null, g.id, eye, dir);
    }
    this.ui.hud.updateGadgets(me.gadgets);
  }

  throwGrenade(actor, targetPos, type = 'frag', from = null, dir = null) {
    const def = WEAPONS[type] || WEAPONS.frag;
    const origin = from || actor.eyePos(new THREE.Vector3());
    const d = dir || actor.lookDir(new THREE.Vector3());
    let vel;
    if (targetPos) {
      vel = new THREE.Vector3().subVectors(targetPos, origin);
      const dist = vel.length();
      vel.normalize().multiplyScalar(Math.min(26, 9 + dist * 0.42));
      vel.y += Math.min(9, dist * 0.16);
    } else {
      vel = d.clone().multiplyScalar(20);
      vel.y += 4.4;
    }
    const g = {
      id: 'g' + Math.random().toString(36).slice(2, 8),
      type, def, pos: origin.clone(), vel, t: type === 'smoke' ? 2.2 : 3.2,
      owner: actor, faction: actor.faction
    };
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 6, 5),
      new THREE.MeshLambertMaterial({ color: type === 'smoke' ? 0x9aa4ad : 0x3f4a35 })
    );
    m.position.copy(origin);
    this.scene.add(m);
    g.mesh = m;
    this.grenades.push(g);
    this._hostCast({ e: 'gnd', id: g.id, type, aid: actor.id, pos: [origin.x, origin.y, origin.z], vel: [vel.x, vel.y, vel.z] });
  }

  _useUav() {
    const me = this.me;
    if (!me || !me.alive) return;
    const g = me.gadgets.find(x => x.id === 'uav');
    if (!g || g.count <= 0) { this.ui.hud.toast('НЕТ РАЗВЕДЧИКА'); return; }
    g.count--;
    this.uavUntil = this.time + g.def.duration;
    this.ui.hud.toast('РАЗВЕДЧИК В ВОЗДУХЕ · 25с');
    Sfx.beep(true);
    this._hostCast({ e: 'gad', id: 'uav', aid: me.id });
    this.ui.hud.updateGadgets(me.gadgets);
  }

  /* ================= СТРЕЛЬБА ================= */
  _fireLocal(dt) {
    const me = this.me;
    if (!me || !me.alive) return;
    const now = this.time;

    if (me.state === 'drone' && this.activeDrone) {
      if (this._primaryDown) this.activeDrone.detonate(me, true);
      return;
    }
    if (me.state === 'vehicle') {
      const v = me.vehicle;
      if (!v || v.driver !== me) return;
      const aim = this._vehicleAimDir(v);
      if (this._primaryDown) v.fireCannon(aim);
      if (this.mouseDown[2]) v.fireMg(aim);
      return;
    }

    /* перезарядка завершается, как только время вышло; старое условие ловило
       окно в 1 мс между кадрами, и магазин «зависал» недозаряженным навсегда */
    if (me.reloadUntil > 0 && now >= me.reloadUntil) {
      me.finishReload();
      me.reloadUntil = 0;
    }
    if (!this._primaryDown) return;
    const w = me.weapon;
    if (!w) return;
    if (!me.canFire(now)) {
      if (w.mag <= 0 && this.autoReload) me.startReload(now);
      return;
    }
    this._shoot(me, now);
    if (!w.def.auto) this._primaryDown = false;
  }

  _vehicleAimDir(v) {
    const origin = v._muzzleWorld('muzzle');
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    // трассировка от камеры
    const hitDist = this._rayWorld(origin, camDir, 600, v);
    const target = origin.clone().addScaledVector(camDir, Math.min(hitDist, 400));
    return target.sub(origin).normalize();
  }

  _shoot(actor, now) {
    const w = actor.weapon;
    if (!w) return;
    const def = w.def;
    const isLocal = actor.isLocal;

    w.mag--;
    actor.nextShot = now + 60 / def.rpm;
    actor.shotsFired++;
    actor.spreadMul = Math.min(3.2, actor.spreadMul + (def.recoil > 0.05 ? 0.5 : 0.22));

    const pellets = def.pellets || 1;
    const eye = actor.eyePos(new THREE.Vector3());
    const baseDir = isLocal ? this.camera.getWorldDirection(new THREE.Vector3()) : actor.lookDir(new THREE.Vector3());
    const spread = actor.currentSpread();

    let hitSomething = false, bestPart = 'body', bestActor = null, bestDist = 1e9;

    for (let p = 0; p < pellets; p++) {
      const dir = baseDir.clone();
      dir.x += (Math.random() - 0.5) * spread * 2;
      dir.y += (Math.random() - 0.5) * spread * 2;
      dir.z += (Math.random() - 0.5) * spread * 2;
      dir.normalize();

      const maxRange = def.range * 3;
      const worldHit = this._rayWorld(eye, dir, maxRange, actor.vehicle);
      const actorHit = this._rayActors(eye, dir, maxRange, actor);

      let end;
      if (actorHit && actorHit.dist < worldHit) {
        end = eye.clone().addScaledVector(dir, actorHit.dist);
        bestActor = actorHit.actor;
        bestPart = actorHit.part;
        bestDist = actorHit.dist;
        hitSomething = true;
        if (def.explosive) {
          this.explode(end, def.explosive, def.dmg, actor, 'explosive');
        } else if (isLocal || this.isHost) {
          this._registerHit(actor, actorHit.actor, def.dmg, actorHit.part, dir, actorHit.dist);
        } else {
          Net.relay({ t: 'hit', tid: actorHit.actor.id, dmg: def.dmg, part: actorHit.part, d: actorHit.dist });
        }
      } else {
        end = eye.clone().addScaledVector(dir, worldHit);
        if (def.explosive) {
          this.explode(end, def.explosive, def.dmg, actor, 'explosive');
        }
      }

      if (isLocal) {
        const muzz = this._muzzleWorldPos();
        this.effects.tracer(muzz, end, 0xffd9a0, 0.05);
      }
      if (worldHit < maxRange && !actorHit) {
        const n = this.map.normalAt(end.x, end.z);
        this.effects.impact(end, n, def.dmg > 50);
      }
    }

    // отдача и эффекты
    if (isLocal) {
      const muzz = this._muzzleWorldPos();
      this.effects.flash(muzz, def.explosive ? 3 : 1.2);
      this._recoilOffset = 0.09;
      this.me.pitch += def.recoil * (this.me.ads ? 0.6 : 1) * (0.85 + Math.random() * 0.3);
      this.me.yaw += (Math.random() - 0.5) * def.recoil * 0.55;
      this.me.pitch = THREE.MathUtils.clamp(this.me.pitch, -1.45, 1.45);
      Sfx.shot({ heavy: def.dmg > 50 || !!def.explosive });
      this.ui.hud.shake(def.explosive ? 1.2 : 0.35);
    } else {
      Sfx.shot({ heavy: def.dmg > 50, distant: true });
    }

    this._hostCast({ e: 'shot', aid: actor.id, pos: [eye.x, eye.y, eye.z],
      dir: [baseDir.x, baseDir.y, baseDir.z], heavy: def.dmg > 50 });
  }

  _muzzleWorldPos() {
    if (this.viewModel && this.viewModel.userData.muzzle) {
      return this.viewModel.userData.muzzle.getWorldPosition(new THREE.Vector3());
    }
    return this.me ? this.me.eyePos(new THREE.Vector3()) : new THREE.Vector3();
  }

  /* трассировка по миру */
  _rayWorld(origin, dir, maxDist, ignoreVehicle) {
    const hit = this.map.colliders.raycast(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z }, maxDist);
    let best = hit ? hit.dist : maxDist;
    // рельеф
    const step = 2.5;
    for (let t = 0; t < best; t += step) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      const gy = this.map.heightAt(x, z);
      if (y < gy) { best = Math.max(0.1, t - step * 0.5); break; }
    }
    // техника
    for (const v of this.vehicles) {
      if (!v.alive || v === ignoreVehicle) continue;
      const c = v.mesh.position;
      const toC = _v1.set(c.x - origin.x, c.y + 1 - origin.y, c.z - origin.z);
      const proj = toC.dot(dir);
      if (proj < 0 || proj > best) continue;
      const perp = Math.hypot(toC.x - dir.x * proj, toC.y - dir.y * proj, toC.z - dir.z * proj);
      if (perp < v.radius + 0.4) best = Math.max(0.1, proj);
    }
    return best;
  }

  /* трассировка по актёрам */
  _rayActors(origin, dir, maxDist, shooter) {
    let best = null;
    for (const a of this.actors.values()) {
      if (!a.alive || a.faction === shooter.faction || a.state === 'drone') continue;
      const feet = a.state === 'vehicle' ? null : a.pos;
      if (!feet) continue;
      const cx = feet.x - origin.x, cz = feet.z - origin.z;
      const cy = (feet.y + 0.95) - origin.y;
      const proj = cx * dir.x + cy * dir.y + cz * dir.z;
      if (proj < 0 || proj > maxDist) continue;
      const px = cx - dir.x * proj, py = cy - dir.y * proj, pz = cz - dir.z * proj;
      const perp = Math.hypot(px, py, pz);
      if (perp > 0.52) continue;
      // часть тела
      const relY = py / proj;
      let part = 'body';
      if (py > 0.62) part = 'head';
      else if (py < -0.55) part = 'leg';
      if (!best || proj < best.dist) best = { actor: a, dist: proj, part };
    }
    // дроны
    for (const d of this.drones) {
      if (!d.alive || d.faction === shooter.faction) continue;
      const cx = d.pos.x - origin.x, cy = d.pos.y - origin.y, cz = d.pos.z - origin.z;
      const proj = cx * dir.x + cy * dir.y + cz * dir.z;
      if (proj < 0 || proj > maxDist) continue;
      const perp = Math.hypot(cx - dir.x * proj, cy - dir.y * proj, cz - dir.z * proj);
      if (perp > 0.7) continue;
      if (!best || proj < best.dist) best = { drone: d, dist: proj, part: 'drone' };
    }
    return best;
  }

  _registerHit(shooter, target, dmg, part, dir, dist) {
    if (target.drone) {
      target.drone.applyDamage(dmg, shooter);
      return;
    }
    const applied = target.applyDamage(dmg, shooter, part, dir);
    if (shooter.isLocal) {
      this.ui.hud.hitmarker(target.hp <= 0, part === 'head');
      Sfx.hit(target.hp <= 0);
      this.effects.blood(target.pos.clone().setY(target.pos.y + 1.3));
    }
    if (target.hp <= 0) this._onKill(shooter, target, part === 'head' ? 'headshot' : 'gun');
  }

  _onKill(killer, victim, cause) {
    if (!killer) return;
    killer.kills++;
    killer.killstreak++;
    const pts = cause === 'headshot' ? 130 : 100;
    killer.score += pts;
    victim.killstreak = 0;
    this.scores[killer.faction] += 1;

    const entry = {
      killer: killer.name, victim: victim.name,
      kf: killer.faction, vf: victim.faction, cause,
      meKiller: killer.isLocal, meVictim: victim.isLocal,
      hs: cause === 'headshot'
    };
    this.ui.hud.killfeed(entry);
    if (killer.isLocal) {
      this.ui.hud.hitmarker(true);
      this.ui.hud.toast(killer.killstreak >= 3 ? `СЕРИЯ ×${killer.killstreak}` : 'ФРАГ');
      this._localStats.kills++;
      if (cause === 'headshot') this._localStats.headshots++;
      this._localStats.damage += 100;
      if (killer.killstreak > this._localStats.bestStreak) this._localStats.bestStreak = killer.killstreak;
    }
    if (victim.isLocal) this._localStats.deaths++;

    this._hostCast({ e: 'kill', ...entry, kid: killer.id, vid: victim.id });
    this._checkWin();
  }

  onVehicleDestroyed(v, killer) {
    this.effects.explosion(v.mesh.position.clone().setY(v.mesh.position.y + 1), 9, true);
    Sfx.explosion(1.4);
    if (killer) {
      killer.score += 250;
      if (killer.isLocal) { this._localStats.vehicleKills++; this.ui.hud.toast('ТЕХНИКА УНИЧТОЖЕНА +250'); }
      this.ui.hud.killfeed({
        killer: killer.name, victim: VEHICLES[v.type].name, kf: killer.faction, vf: 'none',
        cause: 'vehicle', meKiller: killer.isLocal, meVictim: false
      });
      this._hostCast({ e: 'kill', killer: killer.name, victim: VEHICLES[v.type].name,
        kf: killer.faction, vf: 'none', cause: 'vehicle', meKiller: killer.isLocal, meVictim: false });
    }
    v.respawnTimer = v.spawnSpot ? v.spawnSpot.respawn : 60;
    this._hostCast({ e: 'vdestroy', vid: v.id });
  }

  onVehicleImpact(v, force) {
    this.effects.explosion(v.mesh.position.clone(), 2.5, false);
    Sfx.explosion(0.5);
    if (v.driver && v.driver.isLocal) this.ui.hud.shake(force / 20);
  }

  explode(pos, radius, dmg, source, cause = 'explosive') {
    this.effects.explosion(pos, radius, radius > 7);
    Sfx.explosion(Math.min(1.6, radius / 6));
    if (this.me) {
      const d = this.me.pos.distanceTo(pos);
      if (d < 40) this.ui.hud.shake(Math.max(0, (1 - d / 40)) * (radius / 5));
    }
    if (!this.isHost) {
      Net.relay({ t: 'explode', pos: [pos.x, pos.y, pos.z], r: radius, sid: source ? source.id : null });
      return;
    }
    // урон по актёрам
    for (const a of this.actors.values()) {
      if (!a.alive || a.state === 'drone') continue;
      const d = a.pos.distanceTo(pos);
      if (d > radius) continue;
      const eye = a.eyePos(new THREE.Vector3());
      if (!this.map.hasLineOfSight(pos, eye)) continue;
      const fall = 1 - d / radius;
      const dir = new THREE.Vector3().subVectors(a.pos, pos).normalize();
      a.applyDamage(dmg * fall, source, 'body', dir, true);
      if (a.hp <= 0) this._onKill(source, a, cause);
    }
    // локальный игрок
    if (this.me && this.me.alive) {
      const d = this.me.pos.distanceTo(pos);
      if (d < radius) {
        const fall = 1 - d / radius;
        const dir = new THREE.Vector3().subVectors(this.me.pos, pos).normalize();
        const before = this.me.hp;
        this.me.applyDamage(dmg * fall * 0.9, source, 'body', dir, true);
        if (this.me.hp < before) {
          this.ui.hud.damage(dir);
          Sfx.hurt();
        }
        if (this.me.hp <= 0) this._onKill(source, this.me, cause);
      }
    }
    // техника
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const d = v.mesh.position.distanceTo(pos);
      if (d > radius + v.radius) continue;
      const fall = 1 - d / (radius + v.radius);
      v.applyDamage(dmg * fall * 1.6, source, true);
    }
    // дроны
    for (const dr of this.drones) {
      if (!dr.alive) continue;
      if (dr.pos.distanceTo(pos) < radius) dr.applyDamage(dmg, source);
    }
    this._hostCast({ e: 'boom', pos: [pos.x, pos.y, pos.z], r: radius, big: radius > 7 });
  }

  /* ================= ОБНОВЛЕНИЕ ================= */
  /* (ре)старт цикла: вызывается из startMatch, когда матч готов */
  _ensureLoop() {
    if (this._loopActive) return;
    this._loopActive = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(() => this.loop());
  }

  loop() {
    if (!this.running) { this._loopActive = false; return; }
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.1) dt = 0.1;
    if (this.paused) { this.renderer.render(this.scene, this.camera); return; }
    this.time = (this.time || 0) + dt;
    Clock.t = this.time;

    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }

    this._updateInput();
    this._fireLocal(dt);
    this._updateLocal(dt);
    this._tickRespawn(dt);
    if (this.isHost) this._updateHost(dt);
    this._updateRemote(dt);
    this._updateGrenades(dt);
    this._updateShells(dt);
    this._updateVehicles(dt);
    this._updateDrones(dt);
    this.effects.update(dt);
    this._updateCamera(dt);
    this._updateMarkers();
    this._netTick(dt);

    if (this.showFps) this.ui.hud.setFps(this.fps);
    this.renderer.render(this.scene, this.activeDrone ? this.activeDrone.camera : this.camera);
  }

  _updateInput() {
    const k = this.keys, i = this.input;
    if (this.activeDrone) {
      i.throttle = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
      i.pitch = (k.has('KeyW') ? 0.6 : 0) - (k.has('KeyS') ? 0.6 : 0);
      i.roll = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      i.yaw = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
      return;
    }
    i.fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    i.right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    i.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    i.crouch = k.has('ControlLeft') || k.has('KeyC');
    i.jump = k.has('Space');
    if (this.me && this.me.vehicle) {
      i.throttle = i.fwd;
      i.steer = i.right;
    }
  }

  _updateLocal(dt) {
    const me = this.me;
    if (!me) return;
    this._localStats.playtime += dt;

    if (me.state === 'drone' && this.activeDrone) {
      const d = this.activeDrone;
      d.step(dt, this.input, this.map);
      // дрон мог сдетонировать прямо во время step() — тогда activeDrone уже null
      if (this.activeDrone === d && d.alive) {
        this.ui.hud.setDroneStats(d.battery / d.maxBattery, d.signal, 1, d.pos.y);
      }
      return;
    }
    if (me.state === 'vehicle' && me.vehicle) {
      if (me.vehicle.driver === me) me.vehicle.step(dt, this.input);
      me.pos.copy(me.vehicle.mesh.position);
      me.yaw = me.vehicle.turretYaw;
      this.ui.hud.setVehicleStats(me.vehicle);
      return;
    }
    if (!me.alive) return;
    me.step(dt, this.input, this.map);
  }

  _updateHost(dt) {
    // таймер
    this.clock -= dt;
    if (this.clock <= 0 && !this.matchOver) this.endMatch('time');

    // боты
    const actors = [this.me, ...this.actors.values()].filter(Boolean);
    for (const a of this.actors.values()) {
      if (!a.isBotSim) continue;
      a.tick(dt, {
        game: this, actors, mode: this.mode,
        objectives: this.objectives || [],
        enemyBase: (fac) => this.map.base[fac === 'vega' ? 'argo' : 'vega']
      });
      if (a.wantsFire) {
        const now = this.time;
        if (a.canFire(now)) { this._shoot(a, now); a.onFired(); }
        else if (a.weapon && a.weapon.mag <= 0) a.startReload(now);
      }
      if (this.time >= a.reloadUntil && a.reloadUntil > 0) {
        a.finishReload(); a.reloadUntil = 0;
      }
      // респаун ботов — ближе к линии фронта, иначе бой затухает
      if (!a.alive && this.time - a.deadSince > 6) {
        a.respawn(this._botRespawnPoint(a), 0);
      }
    }

    // точки захвата
    if (this.mode === 'dom' && this.objectives) {
      this._updateObjectives(dt);
    }

    // волны PvE
    if (this.mode === 'pve') this._updateWaves(dt);

    // респаун техники
    for (const v of this.vehicles) {
      if (!v.alive) {
        v.respawnTimer -= dt;
        if (v.respawnTimer <= 0 && v.spawnSpot) {
          v.mesh.position.copy(v.spawnSpot.pos);
          v.mesh.position.y = this.map.heightAt(v.spawnSpot.pos.x, v.spawnSpot.pos.z);
          v.hp = v.maxHp; v.alive = true; v.speed = 0;
          this._hostCast({ e: 'vrespawn', vid: v.id, pos: [v.mesh.position.x, v.mesh.position.y, v.mesh.position.z] });
        }
      }
    }
  }

  /* Точка возрождения бота: своя/нейтральная точка захвата, иначе база.
     Возрождение в углу карты на 500 м впереди убивает весь темп боя. */
  _botRespawnPoint(bot) {
    const objs = this.objectives || [];
    if (objs.length) {
      const own = objs.filter(o => o.owner === bot.faction);
      const neutral = objs.filter(o => o.owner === 'none');
      const pool = own.length ? own : (neutral.length ? neutral : objs);
      const o = pool[(Math.random() * pool.length) | 0];
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 22 + Math.random() * 30;
        const x = o.pos.x + Math.cos(a) * r, z = o.pos.z + Math.sin(a) * r;
        if (Math.abs(x) > this.map.size / 2 - 10 || Math.abs(z) > this.map.size / 2 - 10) continue;
        const y = this.map.heightAt(x, z);
        if (y < this.map.waterLevel + 0.5) continue;
        if (this.map._nearBuilding(x, z, 2)) continue;
        // не спавним прямо на враге
        let tooClose = false;
        for (const e of this.actors.values()) {
          if (!e.alive || e.faction === bot.faction) continue;
          if (Math.hypot(e.pos.x - x, e.pos.z - z) < 30) { tooClose = true; break; }
        }
        if (this.me && this.me.alive && this.me.faction !== bot.faction &&
            Math.hypot(this.me.pos.x - x, this.me.pos.z - z) < 30) tooClose = true;
        if (!tooClose) return new THREE.Vector3(x, y, z);
      }
    }
    const sp = this.map.spawn[bot.faction];
    return sp[(Math.random() * sp.length) | 0].clone();
  }

  _updateObjectives(dt) {
    for (const o of this.objectives) {
      const present = { vega: 0, argo: 0 };
      for (const a of [this.me, ...this.actors.values()]) {
        if (!a || !a.alive || a.state === 'drone') continue;
        const p = a.state === 'vehicle' ? a.vehicle.mesh.position : a.pos;
        if (Math.hypot(p.x - o.pos.x, p.z - o.pos.z) < o.radius) present[a.faction]++;
      }
      const v = present.vega, g = present.argo;
      if (v > 0 && g === 0) {
        if (o.owner !== 'vega') {
          o.progress += dt * (0.16 * Math.min(3, v));
          if (o.progress >= 1) { this._capture(o, 'vega'); }
        } else o.progress = 1;
      } else if (g > 0 && v === 0) {
        if (o.owner !== 'argo') {
          o.progress -= dt * (0.16 * Math.min(3, g));
          if (o.progress <= -1) { this._capture(o, 'argo'); }
        } else o.progress = -1;
      } else {
        o.progress += (0 - o.progress) * Math.min(1, dt * 0.5);
      }
      // очки за удержание
      if (o.owner !== 'none') {
        o.tickAcc = (o.tickAcc || 0) + dt;
        if (o.tickAcc >= 3) {
          o.tickAcc = 0;
          this.scores[o.owner] += 1;
          for (const a of [this.me, ...this.actors.values()]) {
            if (a && a.faction === o.owner && a.alive) {
              const p = a.state === 'vehicle' ? a.vehicle.mesh.position : a.pos;
              if (Math.hypot(p.x - o.pos.x, p.z - o.pos.z) < o.radius) {
                a.score += 15;
                if (a.isLocal) this._localStats.captures++;
              }
            }
          }
          this._checkWin();
        }
      }
    }
  }

  _capture(o, fac) {
    o.owner = fac;
    o.progress = fac === 'vega' ? 1 : -1;
    this.ui.hud.objective(`${fac === 'vega' ? 'VEGA' : 'ARGO'} ЗАХВАТИЛИ ${o.name}`);
    this.ui.hud.toast(`ТОЧКА ${o.name} · ${FACTIONS[fac].short}`);
    Sfx.beep(true);
    this._hostCast({ e: 'cap', oid: o.id, fac });
    for (const a of [this.me, ...this.actors.values()]) {
      if (!a || a.faction !== fac || !a.alive) continue;
      const p = a.state === 'vehicle' ? a.vehicle.mesh.position : a.pos;
      if (Math.hypot(p.x - o.pos.x, p.z - o.pos.z) < o.radius) {
        a.score += 60;
        if (a.isLocal) { this._localStats.captures++; this.ui.hud.toast('ЗАХВАТ +60'); }
      }
    }
  }

  _updateWaves(dt) {
    this._waveTimer -= dt;
    const aliveBots = [...this.actors.values()].filter(a => a.isBotSim && a.alive).length;
    if (aliveBots <= 1 || this._waveTimer <= 0) {
      this.wave++;
      this._waveTimer = 60;
      if (this.wave > this.limit) { this.endMatch('waves'); return; }
      const perTeam = 2 + Math.floor(this.wave * 1.4);
      for (const a of this.actors.values()) {
        if (!a.isBotSim) continue;
        if (a.faction === this.me.faction) continue;
        if (a.alive) continue;
        a.respawn(this.map.randomGroundPoint(Math.random, this.me.pos, 45), 0);
      }
      // добавим новых, если не хватает
      const enemyBots = [...this.actors.values()].filter(a => a.isBotSim && a.faction !== this.me.faction);
      const need = Math.min(14, perTeam) - enemyBots.length;
      for (let i = 0; i < need; i++) {
        const fac = this.me.faction === 'vega' ? 'argo' : 'vega';
        const b = new Bot({ id: 'bot_w' + this.wave + '_' + i, faction: fac, skill: this.skill,
          name: BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0] });
        b.assignKit();
        b.respawn(this.map.randomGroundPoint(Math.random, this.me.pos, 55), 0);
        b.game = this;
        b.mesh.visible = true;
        this.scene.add(b.mesh);
        this.actors.set(b.id, b);
      }
      // союзники-боты
      const allyBots = [...this.actors.values()].filter(a => a.isBotSim && a.faction === this.me.faction);
      if (allyBots.length < 4) {
        const b = new Bot({ id: 'bot_ally' + this.wave + '_' + allyBots.length, faction: this.me.faction,
          skill: this.skill, name: BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0] });
        b.assignKit();
        b.respawn(this.map.randomGroundPoint(Math.random, this.me.pos, 25), 0);
        b.game = this; b.mesh.visible = true;
        this.scene.add(b.mesh);
        this.actors.set(b.id, b);
      }
      this._announceWave();
      this._hostCast({ e: 'wave', n: this.wave });
    }
  }

  _announceWave() {
    if (this.mode !== 'pve') return;
    const alive = [...this.actors.values()].filter(a => a.isBotSim && a.faction !== this.me.faction && a.alive).length;
    this.ui.hud.wave(`ВОЛНА ${this.wave || 1}`, `${alive} ПРОТИВНИКОВ`);
  }

  _updateRemote(dt) {
    for (const a of this.actors.values()) {
      if (a.isBotSim && this.isHost) continue;
      if (!a.hasNetSnap) continue;      // ещё не было снапшота — не дёргаем
      // интерполяция
      const k = Math.min(1, dt * 11);
      a.pos.lerp(a.netPos, k);
      let dy = a.netYaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += dy * k;
      a.pitch += (a.netPitch - a.pitch) * k;
      const sp = a.netSpeed || 0;
      a._animate(dt, { fwd: sp > 0.5 ? 1 : 0, crouch: false }, this.map);
      a.mesh.visible = a.alive;
    }
  }

  _updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.t -= dt;
      g.vel.y -= 20 * dt;
      g.pos.addScaledVector(g.vel, dt);
      const gy = this.map.heightAt(g.pos.x, g.pos.z);
      if (g.pos.y < gy + 0.12) {
        g.pos.y = gy + 0.12;
        g.vel.y *= -0.36;
        g.vel.x *= 0.68; g.vel.z *= 0.68;
      }
      const boxes = this.map.colliders.query(g.pos.x, g.pos.z, 0.6);
      for (const b of boxes) {
        if (g.pos.x > b.min.x - .12 && g.pos.x < b.max.x + .12 &&
            g.pos.z > b.min.z - .12 && g.pos.z < b.max.z + .12 &&
            g.pos.y > b.min.y && g.pos.y < b.max.y) {
          g.vel.multiplyScalar(-0.4);
          g.pos.addScaledVector(g.vel, dt * 2);
        }
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += dt * 7; g.mesh.rotation.z += dt * 5;
      if (g.t <= 0) {
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
        if (g.type === 'smoke') {
          this.effects.addSmokeField(g.pos, g.def.duration, g.def.radius);
          this._hostCast({ e: 'smoke', pos: [g.pos.x, g.pos.y, g.pos.z], d: g.def.duration, r: g.def.radius });
        } else if (g.type === 'mine') {
          this.mines.push({ pos: g.pos.clone(), def: g.def, owner: g.owner, faction: g.faction });
        } else {
          this.explode(g.pos, g.def.radius, g.def.dmg, g.owner, 'frag');
        }
      }
    }
    // мины
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      for (const a of [this.me, ...this.actors.values()]) {
        if (!a || !a.alive || a.faction === m.faction) continue;
        if (a.pos.distanceTo(m.pos) < 2.6) {
          this.mines.splice(i, 1);
          this.explode(m.pos, m.def.radius, m.def.dmg, m.owner, 'mine');
          this._hostCast({ e: 'minerem', i });
          break;
        }
      }
    }
  }

  _updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t -= dt;
      s.pos.addScaledVector(s.vel, dt);
      s.vel.y -= 4 * dt;
      s.mesh.position.copy(s.pos);
      const gy = this.map.heightAt(s.pos.x, s.pos.z);
      const hitGround = s.pos.y < gy;
      const hitBox = this.map.colliders.raycast(
        { x: s.pos.x, y: s.pos.y, z: s.pos.z }, { x: 0, y: -1, z: 0 }, 0.01);
      if (hitGround || hitBox || s.t <= 0) {
        this.scene.remove(s.mesh);
        this.shells.splice(i, 1);
        this.explode(s.pos, s.radius, s.dmg, s.owner, 'shell');
      }
    }
  }

  fireVehicleShell(v, origin, dir, def) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffcc77 }));
    m.position.copy(origin);
    this.scene.add(m);
    this.shells.push({
      pos: origin.clone(), vel: dir.clone().multiplyScalar(160),
      dmg: def.dmg, radius: def.radius, owner: v.driver, t: 3, mesh: m
    });
    this.effects.flash(origin, 3);
    Sfx.shot({ heavy: true });
    if (v.driver && v.driver.isLocal) this.ui.hud.shake(1.1);
    this._hostCast({ e: 'vshot', vid: v.id, pos: [origin.x, origin.y, origin.z], dir: [dir.x, dir.y, dir.z] });
  }

  fireVehicleMG(v, origin, dir, def) {
    const maxR = 220;
    const worldHit = this._rayWorld(origin, dir, maxR);
    let end = origin.clone().addScaledVector(dir, worldHit);
    for (const a of this.actors.values()) {
      if (!a.alive || a.faction === v.faction) continue;
      const cx = a.pos.x - origin.x, cy = a.pos.y + 1 - origin.y, cz = a.pos.z - origin.z;
      const proj = cx * dir.x + cy * dir.y + cz * dir.z;
      if (proj < 0 || proj > worldHit) continue;
      const perp = Math.hypot(cx - dir.x * proj, cy - dir.y * proj, cz - dir.z * proj);
      if (perp < 0.6) {
        end = origin.clone().addScaledVector(dir, proj);
        if (this.isHost) {
          const applied = a.applyDamage(def.dmg, v.driver, 'body', dir);
          if (a.hp <= 0) this._onKill(v.driver, a, 'gun');
        } else {
          Net.relay({ t: 'hit', tid: a.id, dmg: def.dmg, part: 'body', d: proj });
        }
        this.effects.blood(end);
        break;
      }
    }
    this.effects.tracer(origin, end, 0xffe0a0, 0.05);
    this.effects.flash(origin, 0.9);
    Sfx.shot({ heavy: false });
  }

  _updateVehicles(dt) {
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const isLocalDriven = v.driver === this.me;
      if (this.isHost && !isLocalDriven && v.driver && v.driver.isBotSim) {
        // боты-водители (упрощённо — стоят)
      }
      if (!isLocalDriven) {
        // интерполяция
        const k = Math.min(1, dt * 9);
        v.mesh.position.lerp(v.netPos || v.mesh.position, k);
        let dy = (v.netYaw ?? v.yaw) - v.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        v.yaw += dy * k;
        v.mesh.rotation.y = v.yaw;
      }
      if (v.mesh.userData.band) v.mesh.userData.band.lookAt(this.camera.position);
    }
  }

  _updateDrones(dt) {
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      if (!d.alive) { this.drones.splice(i, 1); continue; }
      if (d === this.activeDrone) continue;
      // интерполяция чужих дронов
      if (d.netPos) d.mesh.position.lerp(d.netPos, Math.min(1, dt * 12));
      d.mesh.rotation.y += ((d.netYaw ?? 0) - d.mesh.rotation.y) * Math.min(1, dt * 10);
      const props = d.mesh.userData.props;
      if (props) for (const p of props) p.rotation.y += dt * 40;
    }
  }

  _updateCamera(dt) {
    const me = this.me;
    if (!me) return;

    if (this.activeDrone) return; // камера дрона рендерится напрямую

    if (me.state === 'vehicle' && me.vehicle) {
      const v = me.vehicle;
      const back = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw)).multiplyScalar(9.5);
      const target = v.mesh.position.clone().add(back).add(new THREE.Vector3(0, 4.2, 0));
      const gy = this.map.heightAt(target.x, target.z);
      if (target.y < gy + 1.6) target.y = gy + 1.6;
      this.camera.position.lerp(target, Math.min(1, dt * 7));
      const look = v.mesh.position.clone().add(new THREE.Vector3(0, 2, 0));
      this.camera.lookAt(look);
      this.camera.rotation.z += Math.sin(performance.now() / 900) * 0.002;
      this.vmGroup.visible = false;
      return;
    }
    this.vmGroup.visible = me.alive;

    // покачивание
    const speed = Math.hypot(me.vel.x, me.vel.z);
    this._bob = (this._bob || 0) + dt * (me.sprint ? 13 : 8.5) * Math.min(1.4, speed / 5);
    const bobAmp = me.onGround ? (me.sprint ? 0.045 : 0.026) * Math.min(1, speed / 5) : 0;
    const bx = Math.sin(this._bob) * bobAmp;
    const by = -Math.abs(Math.cos(this._bob)) * bobAmp * 1.5;

    // отдача вьюмодели
    this._recoilOffset = Math.max(0, (this._recoilOffset || 0) - dt * 0.9);
    if (this._vmBase) {
      const ads = me.ads ? 1 : 0;
      /* ВАЖНО: (ads - this._adsT) при undefined давал NaN с первого кадра —
         вью-модель улетала в NaN и оружие пропадало из кадра */
      this._adsT = (this._adsT || 0) + (ads - (this._adsT || 0)) * Math.min(1, dt * 14);
      const t = this._adsT;
      const targetX = THREE.MathUtils.lerp(0.22, 0.0, t);
      const targetY = THREE.MathUtils.lerp(-0.2, -0.083, t);
      const targetZ = THREE.MathUtils.lerp(-0.42, -0.3, t);
      this.vmGroup.position.set(
        targetX + bx * 0.5,
        targetY + by * 0.5,
        targetZ + this._recoilOffset
      );
      if (this.viewModel) {
        /* перезарядка: ствол клюёт вниз, магазин выпадает и возвращается */
        let arc = 0;
        const w = me.weapon;
        if (w && me.reloadUntil > this.time && me.reloadUntil > (me.reloadStart || 0)) {
          const pr = (this.time - me.reloadStart) / (me.reloadUntil - me.reloadStart);
          arc = Math.sin(THREE.MathUtils.clamp(pr, 0, 1) * Math.PI);
        }
        this.viewModel.rotation.x = this._recoilOffset * 0.9 + arc * 0.5;
        this.viewModel.position.y = -arc * 0.09;
        const sway = Math.sin(this._bob * 0.5) * 0.012 * (1 - t);
        this.viewModel.rotation.z = sway;
        const mag = this.viewModel.userData.mag;
        if (mag) {
          if (mag.userData.baseY === undefined) {
            mag.userData.baseY = mag.position.y;
            mag.userData.baseRX = mag.rotation.x;
          }
          mag.position.y = mag.userData.baseY - arc * 0.17;
          mag.rotation.x = mag.userData.baseRX + arc * 0.55;
        }
      }
      this.camera.fov += (((this._baseFov || 82) + (me.ads ? -22 : 0)) - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
    }

    const eye = me.eyePos(new THREE.Vector3());
    eye.x += Math.cos(me.yaw) * bx * 0.4;
    eye.z -= Math.sin(me.yaw) * bx * 0.4;
    this.camera.position.copy(eye);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = me.yaw;
    this.camera.rotation.x = me.pitch;
    this.camera.rotation.z = me.sprint && speed > 4 ? Math.sin(this._bob) * 0.012 : 0;
  }

  _updateMarkers() {
    for (const a of this.actors.values()) {
      if (!a.alive || !a.mesh.userData.parts) continue;
      const m = a.mesh.userData.parts.marker;
      if (m) m.lookAt(this.camera.position);
      const b = a.mesh.userData.parts.band;
      if (b) b.lookAt(this.camera.position);
    }
  }

  /* ================= СЕТЬ ================= */
  _netTick(dt) {
    this.netAcc = (this.netAcc || 0) + dt;
    if (this.netAcc < 0.05) return;
    this.netAcc = 0;
    if (!Net.connected || !Net.room) return;

    const me = this.me;
    // свой стейт
    Net.relay({
      t: 'in',
      p: [round1(me.pos.x), round1(me.pos.y), round1(me.pos.z)],
      y: round2(me.yaw), pi: round2(me.pitch),
      hp: Math.round(me.hp), ar: Math.round(me.armor),
      al: me.alive ? 1 : 0, st: me.state,
      sp: round1(Math.hypot(me.vel.x, me.vel.z)),
      cr: me.crouch ? 1 : 0, ads: me.ads ? 1 : 0,
      sl: me.slot, wg: me.weapon ? [me.weapon.mag, me.weapon.reserve] : null,
      k: me.kills, d: me.deaths, sc: me.score
    });

    if (this.isHost) {
      const actors = [];
      for (const a of this.actors.values()) {
        actors.push([a.id, round1(a.pos.x), round1(a.pos.y), round1(a.pos.z),
          round2(a.yaw), round2(a.pitch), Math.round(a.hp), Math.round(a.armor),
          a.alive ? 1 : 0, round1(Math.hypot(a.vel.x, a.vel.z)),
          a.kills, a.deaths, a.score, a.name, a.faction, a.crouch ? 1 : 0]);
      }
      const vehs = this.vehicles.map(v => [v.id, round1(v.mesh.position.x), round1(v.mesh.position.y),
        round1(v.mesh.position.z), round2(v.yaw), Math.round(v.hp), v.alive ? 1 : 0, v.type, v.faction,
        round2(v.turretYaw)]);
      const drs = this.drones.filter(d => d !== this.activeDrone).map(d =>
        [d.id, round1(d.pos.x), round1(d.pos.y), round1(d.pos.z), round2(d.mesh.rotation.y), d.faction, d.owner.id]);
      const objs = (this.objectives || []).map(o => [o.id, o.owner, round2(o.progress)]);
      Net.hostCast({
        t: 'sim', time: Math.max(0, Math.round(this.clock)),
        sc: [this.scores.vega, this.scores.argo], a: actors, v: vehs, d: drs, o: objs,
        wave: this.wave, me: me.alive ? 0 : 1
      });
    }
  }

  _hostCast(d) {
    if (!this.isHost) return;
    if (Net.connected && Net.room) Net.hostCast(d);
  }

  /* входящие сетевые сообщения (вызывается из UI) */
  handleNet(msg) {
    const me = this.me;
    if (!me) return;
    switch (msg.t) {
      case 'in': {
        let a = this.actors.get(msg.from);
        if (!a) {
          a = this._addRemote({ id: msg.from, name: msg.from, faction: msg.y ? 'argo' : 'vega', loadout: null });
        }
        a.hasNetSnap = true;
        a.netPos.set(msg.p[0], msg.p[1], msg.p[2]);
        a.netYaw = msg.y; a.netPitch = msg.pi;
        a.hp = msg.hp; a.armor = msg.ar;
        a.alive = !!msg.al;
        a.netSpeed = msg.sp;
        a.crouch = !!msg.cr;
        a.mesh.visible = a.alive;
        if (msg.k !== undefined) { a.kills = msg.k; a.deaths = msg.d; a.score = msg.sc; }
        break;
      }
      case 'hit': {
        if (!this.isHost) break;
        const target = msg.tid === me.id ? me : this.actors.get(msg.tid);
        if (!target || !target.alive) break;
        const shooter = msg.from === Net.id ? me : this.actors.get(msg.from);
        if (!shooter || !shooter.alive) break;
        if (msg.d > 400) break; // античит: слишком далеко
        const dir = new THREE.Vector3().subVectors(target.pos, shooter.pos).normalize();
        const applied = target.applyDamage(msg.dmg, shooter, msg.part, dir);
        // уведомить стрелка
        Net.relay({ t: 'hitack', dmg: Math.round(applied), dead: target.hp <= 0, part: msg.part }, msg.from);
        if (target.hp <= 0) this._onKill(shooter, target, msg.part === 'head' ? 'headshot' : 'gun');
        break;
      }
      case 'hitack': {
        if (msg.from !== this._hostId()) break;
        this.ui.hud.hitmarker(msg.dead, msg.part === 'head');
        Sfx.hit(msg.dead);
        break;
      }
      case 'explode': {
        if (this.isHost) break;
        const p = new THREE.Vector3(msg.pos[0], msg.pos[1], msg.pos[2]);
        const src = msg.sid ? (msg.sid === Net.id ? me : this.actors.get(msg.sid)) : null;
        this.explode(p, msg.r, 60, src, 'explosive');
        break;
      }
      case 'fx': break;
      case 'shot': {
        const a = this.actors.get(msg.aid);
        if (a) {
          const o = new THREE.Vector3(msg.pos[0], msg.pos[1], msg.pos[2]);
          const d = new THREE.Vector3(msg.dir[0], msg.dir[1], msg.dir[2]);
          this.effects.tracer(o, o.clone().addScaledVector(d, 60), 0xffd9a0, 0.05);
          this.effects.flash(o, 1);
          const dist = me.pos.distanceTo(o);
          Sfx.shot({ heavy: msg.heavy, distant: dist > 25 });
        }
        break;
      }
      case 'boom': {
        const p = new THREE.Vector3(msg.pos[0], msg.pos[1], msg.pos[2]);
        this.effects.explosion(p, msg.r, msg.big);
        Sfx.explosion(Math.min(1.4, msg.r / 6));
        break;
      }
      case 'gnd': {
        const a = this.actors.get(msg.aid);
        if (!a) break;
        const g = {
          id: msg.id, type: msg.type, def: WEAPONS[msg.type] || WEAPONS.frag,
          pos: new THREE.Vector3(...msg.pos), vel: new THREE.Vector3(...msg.vel),
          t: msg.type === 'smoke' ? 2.2 : 3.2, owner: a, faction: a.faction
        };
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5),
          new THREE.MeshLambertMaterial({ color: msg.type === 'smoke' ? 0x9aa4ad : 0x3f4a35 }));
        m.position.copy(g.pos);
        this.scene.add(m);
        g.mesh = m;
        this.grenades.push(g);
        break;
      }
      case 'smoke': {
        this.effects.addSmokeField(new THREE.Vector3(...msg.pos), msg.d, msg.r);
        break;
      }
      case 'dspawn': {
        if (msg.owner === Net.id) break;
        const owner = this.actors.get(msg.owner) || me;
        const d = new FpvDrone(owner, this, msg.drone);
        d.id = msg.id;
        d.faction = msg.fac;
        d.pos.set(msg.pos ? msg.pos[0] : owner.pos.x, (msg.pos ? msg.pos[1] : owner.pos.y + 1), msg.pos ? msg.pos[2] : owner.pos.z);
        this.drones.push(d);
        break;
      }
      case 'ddespawn':
      case 'ddetonate': {
        const d = this.drones.find(x => x.id === msg.id);
        if (d) {
          if (msg.e === 'ddetonate') {
            this.effects.explosion(new THREE.Vector3(...msg.pos), msg.r, msg.r > 7);
            Sfx.explosion(1);
          }
          d.remove();
          this.drones = this.drones.filter(x => x !== d);
        }
        break;
      }
      case 'venter': {
        const v = this.vehicles.find(x => x.id === msg.vid);
        const a = msg.aid === Net.id ? me : this.actors.get(msg.aid);
        if (v && a && msg.role === 'driver') { v.driver = a; a.state = 'vehicle'; a.mesh.visible = false; }
        break;
      }
      case 'vexit': {
        const v = this.vehicles.find(x => x.id === msg.vid);
        const a = msg.aid === Net.id ? me : this.actors.get(msg.aid);
        if (v && a) { if (v.driver === a) v.driver = null; a.state = 'ground'; a.mesh.visible = !a.isLocal; }
        break;
      }
      case 'vdestroy': {
        const v = this.vehicles.find(x => x.id === msg.vid);
        if (v) { v.alive = false; v.mesh.visible = false; }
        break;
      }
      case 'vrespawn': {
        const v = this.vehicles.find(x => x.id === msg.vid);
        if (v) { v.alive = true; v.mesh.visible = true; v.mesh.position.set(...msg.pos); v.hp = v.maxHp; }
        break;
      }
      case 'vshot': {
        const o = new THREE.Vector3(...msg.pos);
        this.effects.flash(o, 3);
        Sfx.shot({ heavy: true, distant: true });
        break;
      }
      case 'kill': {
        this.ui.hud.killfeed(msg);
        if (msg.meVictim || msg.vid === Net.id) {
          me.alive = false; me.state = 'dead'; me.mesh.visible = false;
          me.deadSince = Clock.t;
          this.ui.hud.onDeath(msg.killer);
        }
        break;
      }
      case 'cap': {
        const o = (this.objectives || []).find(x => x.id === msg.oid);
        if (o) { o.owner = msg.fac; o.progress = msg.fac === 'vega' ? 1 : -1; }
        this.ui.hud.objective(`${FACTIONS[msg.fac].short} ЗАХВАТИЛИ ${o ? o.name : ''}`);
        break;
      }
      case 'wave': {
        this.wave = msg.n;
        this.ui.hud.wave('ВОЛНА ' + msg.n, '');
        break;
      }
      case 'sim': {
        if (this.isHost) break;
        this.clock = msg.time;
        this.scores.vega = msg.sc[0];
        this.scores.argo = msg.sc[1];
        this.wave = msg.wave || 0;
        for (const row of msg.a) {
          const [id, x, y, z, yw, pi, hp, ar, al, sp, k, d, sc, name, fac, cr] = row;
          if (id === Net.id) {
            me.hp = hp; me.armor = ar;
            if (al && !me.alive) { me.alive = true; me.state = 'ground'; this.ui.hud.onRespawn(); }
            if (!al && me.alive) { me.alive = false; me.state = 'dead'; me.mesh.visible = false; this.ui.hud.onDeath(''); }
            me.kills = k; me.deaths = d; me.score = sc;
            continue;
          }
          let a = this.actors.get(id);
          if (!a) { a = this._addRemote({ id, name, faction: fac, loadout: null }); a.isBotSim = id.startsWith('bot_'); }
          a.hasNetSnap = true;
          a.netPos.set(x, y, z);
          a.netYaw = yw; a.netPitch = pi;
          a.hp = hp; a.armor = ar;
          a.alive = !!al; a.netSpeed = sp;
          a.kills = k; a.deaths = d; a.score = sc;
          a.crouch = !!cr;
          a.mesh.visible = a.alive;
          if (!al) a.deadSince = Clock.t;
        }
        for (const row of msg.v) {
          const [id, x, y, z, yw, hp, al, type, fac, ty] = row;
          let v = this.vehicles.find(x2 => x2.id === id);
          if (!v) {
            v = new Vehicle(type, new THREE.Vector3(x, y, z), fac, this);
            v.id = id;
            this.vehicles.push(v);
          }
          v.netPos = new THREE.Vector3(x, y, z);
          v.netYaw = yw;
          v.hp = hp;
          v.turretYaw = ty || 0;
          if (v.alive !== !!al) {
            v.alive = !!al;
            v.mesh.visible = v.alive;
            if (!al) this.effects.explosion(v.mesh.position.clone(), 7, true);
          }
        }
        for (const row of msg.d) {
          const [id, x, y, z, ry, fac, ownerId] = row;
          let d = this.drones.find(x2 => x2.id === id);
          if (!d) {
            const owner = this.actors.get(ownerId) || me;
            d = new FpvDrone(owner, this, 'striker');
            d.id = id; d.faction = fac;
            this.drones.push(d);
          }
          d.netPos = new THREE.Vector3(x, y, z);
          d.netYaw = ry;
        }
        for (const row of msg.o || []) {
          const o = (this.objectives || []).find(x => x.id === row[0]);
          if (o) { o.owner = row[1]; o.progress = row[2]; }
        }
        break;
      }
      case 'end': {
        this.endMatch(msg.reason, msg.scores, true);
        break;
      }
    }
  }

  _hostId() { return Net.room ? Net.room.hostId : null; }

  /* ================= КОНЕЦ МАТЧА ================= */
  _checkWin() {
    if (this.matchOver) return;
    if (this.mode === 'dom' || this.mode === 'tdm' || this.mode === 'pvp') {
      if (this.scores.vega >= this.limit || this.scores.argo >= this.limit) {
        this.endMatch('limit');
      }
    }
  }

  endMatch(reason = 'time', scoresOverride, isRemote = false) {
    if (this.matchOver) return;
    this.matchOver = true;
    this.running = false;
    if (scoresOverride) { this.scores.vega = scoresOverride[0]; this.scores.argo = scoresOverride[1]; }
    if (this.isHost && !isRemote && Net.connected && Net.room) {
      Net.hostCast({ t: 'end', reason, scores: [this.scores.vega, this.scores.argo] });
      Net.endMatch();
    }
    document.exitPointerLock && document.exitPointerLock();
    Sfx.droneHum(false);
    const win = this.scores.vega === this.scores.argo ? 'draw'
      : (this.scores[this.me.faction] > this.scores[this.me.faction === 'vega' ? 'argo' : 'vega'] ? 'win' : 'lose');
    this.ui.showResults(win, this.scores, this._localStats, this.me);
  }

  quit() {
    this.running = false;
    this.matchOver = true;
    Sfx.droneHum(false);
    if (this.activeDrone) this._endDrone();
    for (const v of this.vehicles) v.remove();
    this.vehicles = [];
    for (const d of this.drones) d.remove();
    this.drones = [];
    for (const a of this.actors.values()) this.scene.remove(a.mesh);
    this.actors.clear();
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades.length = 0;
    for (const s of this.shells) this.scene.remove(s.mesh);
    this.shells.length = 0;
    if (this.me) this.scene.remove(this.me.mesh);
    if (Net.room) Net.endMatch();
    document.exitPointerLock && document.exitPointerLock();
    document.body.classList.remove('in-match');
    this.ui.showHud(false);
  }

  _onLocalDeath(killer, cause) {
    this.ui.hud.onDeath(killer ? killer.name : 'НЕИЗВЕСТНО');
    this._primaryDown = false;
    if (this.activeDrone) this._endDrone();
    if (this.me.vehicle) this.me.vehicle.exit(this.me);
    this.me.mesh.visible = false;
    this._respawnTimer = 6;
  }

  /* отсчёт возрождения локального игрока (по игровому времени) */
  _tickRespawn(dt) {
    if (!this.me || this.me.alive || this._respawnTimer === undefined) return;
    this._respawnTimer -= dt;
    this.ui.hud.setRespawn(Math.max(0, Math.ceil(this._respawnTimer)));
    if (this._respawnTimer <= 0) {
      this._respawnTimer = undefined;
      const sp = this.map.spawn[this.me.faction];
      const p = sp[(Math.random() * sp.length) | 0];
      this.me.respawn(p.clone(), 0);
      this._setViewModel(this.me.weapon);
      this.ui.hud.setRespawn(0);
    }
  }

  resetStats() {
    this._localStats = {
      kills: 0, deaths: 0, damage: 0, headshots: 0, captures: 0,
      vehicleKills: 0, droneKills: 0, bestStreak: 0, playtime: 0, xp: 0
    };
  }
}

function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
