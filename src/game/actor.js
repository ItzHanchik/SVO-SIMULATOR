import * as THREE from 'three';
import { makeSoldier } from '../entities/models.js';
import { WEAPONS } from '../core/data.js';

/* ============================================================
   АКТЁР — общая сущность для локального игрока,
   удалённых игроков и ботов
   ============================================================ */

/* Единые игровые часы (секунды симуляции). Обновляются Game.loop().
   Вся логика кулдаунов опирается на них, а не на performance.now() —
   иначе после сворачивания вкладки кулдауны «протухают» мгновенно. */
export const Clock = { t: 0 };

const GRAVITY = 23;
const EYE_STAND = 1.66;
const EYE_CROUCH = 1.05;
const RADIUS = 0.42;

export const ACTOR_KIND = { PLAYER: 'player', BOT: 'bot', REMOTE: 'remote' };

let actorSeq = 1;

export class Actor {
  constructor(opts) {
    this.id = opts.id || ('a' + (actorSeq++));
    this.name = opts.name || 'БОЕЦ';
    this.faction = opts.faction === 'argo' ? 'argo' : 'vega';
    this.kind = opts.kind || ACTOR_KIND.BOT;
    this.isLocal = !!opts.isLocal;
    this.level = opts.level || 1;
    this.rankName = opts.rankName || '';
    this.color = this.faction === 'vega' ? 0x38bdf8 : 0xf0a93b;
    this.enemyOf = (f) => f !== this.faction;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.crouch = false;
    this.sprint = false;
    this.ads = false;
    this.eyeHeight = EYE_STAND;

    this.maxHp = 100;
    this.hp = 100;
    this.maxArmor = 100;
    this.armor = 0;
    this.alive = true;
    this.respawnAt = 0;
    this.lastDamageFrom = null;
    this.lastDamageDir = new THREE.Vector3();
    this.regenDelay = 0;
    this.deaths = 0;
    this.kills = 0;
    this.assists = 0;
    this.score = 0;
    this.killstreak = 0;
    this.damageDone = 0;
    this.headshots = 0;

    /* оружие */
    this.slots = [null, null];
    this.slot = 0;
    this.gadgets = [];
    this.droneType = 'striker';
    this.reloadUntil = 0;
    this.nextShot = 0;
    this.recoil = 0;
    this.recoilSide = 0;
    this.spreadMul = 1;
    this.shotsFired = 0;

    /* состояние */
    this.state = 'ground';        // ground | vehicle | drone | dead
    this.vehicle = null;
    this.drone = null;
    this.deadSince = 0;
    this.deathReason = '';
    this.spawnProtection = 0;

    /* модель */
    this.mesh = makeSoldier(this.color, this.faction === 'argo');
    this.mesh.visible = !this.isLocal;
    this.mesh.userData.actorId = this.id;
    this.mesh.traverse(o => { o.userData.actorId = this.id; if (o.isMesh) o.castShadow = true; });
    this._animPhase = 0;
    this._targetLean = 0;

    /* для интерполяции удалённых */
    this.netPos = new THREE.Vector3();
    this.netYaw = 0;
    this.netPitch = 0;
    this.netAnim = 0;
    this.snapBuffer = [];
    this.lastSnap = 0;
    this.hasNetSnap = false;
  }

  setLoadout(primaryId, secondaryId, gadgets, droneId) {
    const mk = (id) => {
      const w = WEAPONS[id];
      if (!w) return null;
      return { id, def: w, mag: w.mag, reserve: w.reserve };
    };
    this.slots[0] = mk(primaryId);
    this.slots[1] = mk(secondaryId);
    this.slot = 0;
    this.gadgets = (gadgets || []).map(id => ({
      id, def: WEAPONS[id], count: WEAPONS[id]?.count ?? 1
    })).filter(g => g.def);
    this.droneType = droneId || 'striker';
  }

  get weapon() { return this.slots[this.slot]; }

  switchSlot(i) {
    if (i === this.slot || !this.slots[i]) return false;
    this.slot = i;
    this.reloadUntil = 0;
    this.recoil = 0;
    this.spreadMul = 1.6;
    return true;
  }

  eyePos(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  applyDamage(amount, fromActor, part = 'body', dirVec = null, ignoreArmor = false) {
    if (!this.alive) return 0;
    if (this.spawnProtection > 0 && !ignoreArmor) return 0;
    let dmg = amount;
    if (part === 'head') dmg *= 2.1;
    else if (part === 'leg') dmg *= 0.8;

    if (!ignoreArmor && this.armor > 0) {
      const soak = Math.min(this.armor, dmg * 0.45);
      this.armor -= soak;
      dmg -= soak;
    }
    dmg = Math.max(1, dmg);
    this.hp -= dmg;
    this.regenDelay = 5.5;
    this.lastDamageFrom = fromActor ? fromActor.id : null;
    if (dirVec) this.lastDamageDir.copy(dirVec);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(fromActor, part === 'head' ? 'headshot' : 'gun');
    }
    return dmg;
  }

  die(killer, cause = 'gun') {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    this.deaths++;
    this.killstreak = 0;
    this.deadSince = Clock.t;
    this.deathReason = cause;
    this.mesh.visible = false;
    this.onDeath && this.onDeath(killer, cause);
  }

  respawn(point, time) {
    this.pos.copy(point);
    this.netPos.copy(point);
    this.netYaw = this.yaw;
    this.netPitch = this.pitch;
    this.netSpeed = 0;
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp;
    this.armor = this.faction === 'argo' ? 40 : 25;
    this.alive = true;
    this.state = this.vehicle ? 'vehicle' : (this.drone ? 'drone' : 'ground');
    if (this.state === 'ground') this.mesh.visible = !this.isLocal;
    this.spawnProtection = 3.0;
    for (const s of this.slots) if (s) { s.mag = s.def.mag; s.reserve = s.def.reserve; }
    for (const g of this.gadgets) g.count = g.def.count ?? 1;
    this.recoil = 0;
    this.spreadMul = 1;
    this.onRespawn && this.onRespawn();
  }

  /* ---------- ФИЗИКА ПЕХОТЫ ---------- */
  step(dt, input, map, opts = {}) {
    if (!this.alive) return;

    // регенерация
    if (this.regenDelay > 0) this.regenDelay -= dt;
    else if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 13 * dt);
    if (this.spawnProtection > 0) this.spawnProtection -= dt;

    const crouchTarget = input.crouch;
    if (crouchTarget !== this.crouch) this.crouch = crouchTarget;
    const targetEye = this.crouch ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 12);

    const speedBase = (this.crouch ? 2.7 : this.sprint && !this.ads ? 8.3 : this.ads ? 3.1 : 5.4)
      * (this.faction === 'vega' ? 1.04 : 0.985);
    this.sprint = !!input.sprint && !this.ads && !this.crouch;

    const fwd = this.forward();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3()
      .addScaledVector(fwd, input.fwd || 0)
      .addScaledVector(right, input.right || 0);
    if (wish.lengthSq() > 1) wish.normalize();

    const accel = this.onGround ? 62 : 12;
    const target = wish.multiplyScalar(speedBase);
    this.vel.x += (target.x - this.vel.x) * Math.min(1, accel * dt / speedBase * 2.4);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, accel * dt / speedBase * 2.4);

    // вода тормозит
    const gy = map.heightAt(this.pos.x, this.pos.z);
    const inWater = gy < map.waterLevel + 0.25 && this.pos.y < map.waterLevel + 1.0;
    if (inWater) { this.vel.x *= (1 - 2.4 * dt); this.vel.z *= (1 - 2.4 * dt); }

    // гравитация
    this.vel.y -= GRAVITY * dt;
    if (input.jump && this.onGround) { this.vel.y = 8.0; this.onGround = false; }

    // интегрирование
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // коллизии по горизонтали
    map.colliders.resolve(this.pos, RADIUS, gy);

    // земля
    const ground = map.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= ground + 0.001) {
      this.pos.y = ground;
      if (this.vel.y < -14) this.onHardLand && this.onHardLand(-this.vel.y);
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y - ground > 0.02) {
      this.onGround = false;
    } else {
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    }

    // границы карты
    const half = map.size / 2 - 2;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -half, half);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -half, half);

    // отдача затухает
    this.recoil = Math.max(0, this.recoil - dt * 2.6);
    this.recoilSide *= Math.max(0, 1 - dt * 5);
    this.spreadMul += (1 - this.spreadMul) * Math.min(1, dt * 3.2);

    this._animate(dt, input, map);
  }

  _animate(dt, input, map) {
    if (!this.mesh.visible) return;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = speed > 0.6;
    this._animPhase += dt * (this.sprint ? 13 : this.crouch ? 6 : 9) * Math.min(1.6, speed / 5);
    const p = this._animPhase;
    const parts = this.mesh.userData.parts;
    const amp = moving ? Math.min(1, speed / 6) : 0;

    if (parts) {
      parts.legL.rotation.x = Math.sin(p) * 0.85 * amp;
      parts.legR.rotation.x = -Math.sin(p) * 0.85 * amp;
      parts.armL.rotation.x = -Math.sin(p) * 0.42 * amp;
      parts.armR.rotation.x = Math.sin(p) * 0.3 * amp - (this.ads ? 0.9 : 0.35);
      parts.armR.rotation.z = this.ads ? 0.06 : 0;
      // наклон при беге
      this._targetLean = this.sprint && moving ? 0.17 : 0;
      this.mesh.rotation.x += (this._targetLean - this.mesh.rotation.x) * Math.min(1, dt * 8);
      // поворот торса/головы по питчу
      const pitch = THREE.MathUtils.clamp(-this.pitch, -0.7, 0.7);
      if (parts.head) parts.head.rotation.x = pitch * 0.75;
      if (parts.torso) parts.torso.rotation.x = pitch * 0.22;
      if (parts.gun) {
        parts.gun.rotation.x = pitch * 0.6;
        parts.gun.position.z = -0.32 + (this.ads ? -0.04 : 0);
      }
      // приседание
      const crouchOffset = this.crouch ? -0.42 : 0;
      this.mesh.position.y += crouchOffset;
      if (parts.marker) parts.marker.lookAt && parts.marker.lookAt(
        this.mesh.position.x, this.mesh.position.y + 2.4, this.mesh.position.z + 100
      );
    }
    // маркер всегда к камере (делается в Game)
  }

  /* точность выстрела */
  currentSpread() {
    const w = this.weapon;
    if (!w) return 0.05;
    const base = this.ads ? w.def.adsSpread : w.def.spread;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    let mul = 1;
    if (!this.onGround) mul *= 2.6;
    mul += speed * 0.09;
    if (this.crouch) mul *= 0.72;
    if (this.sprint) mul *= 1.8;
    mul *= this.spreadMul;
    return base * mul;
  }

  canFire(now) {
    const w = this.weapon;
    if (!w || !this.alive) return false;
    if (now < this.nextShot) return false;
    if (now < this.reloadUntil) return false;
    if (w.mag <= 0) return false;
    if (this.state !== 'ground') return false;
    return true;
  }

  startReload(now) {
    const w = this.weapon;
    if (!w || w.mag >= w.def.mag || w.reserve <= 0) return false;
    if (now < this.reloadUntil) return false;
    this.reloadUntil = now + w.def.reload;
    this.reloadStart = now;
    this.onReload && this.onReload(w);
    return true;
  }

  finishReload() {
    const w = this.weapon;
    if (!w) return;
    const need = w.def.mag - w.mag;
    const take = Math.min(need, w.reserve);
    w.mag += take;
    w.reserve -= take;
  }
}
