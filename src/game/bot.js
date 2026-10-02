import * as THREE from 'three';
import { Actor, ACTOR_KIND } from './actor.js';
import { BOT_NAMES } from '../core/data.js';

/* ============================================================
   БОТ — конечный автомат: патруль → бой → смена позиции
   ============================================================ */

/* Сложность = реакция/точность/агрессия, а НЕ количество HP.
   Иначе «элита» превращается в губку и бой вязнет. */
const SKILL = {
  easy:   { react: 0.85, aim: 2.0, acc: 0.055, burst: 3, range: 70,  hp: 100, armor: 0,  aggro: 0.35, cover: 0.2 },
  normal: { react: 0.42, aim: 3.6, acc: 0.026, burst: 6, range: 105, hp: 100, armor: 25, aggro: 0.6,  cover: 0.55 },
  hard:   { react: 0.20, aim: 5.6, acc: 0.011, burst: 9, range: 150, hp: 100, armor: 50, aggro: 0.85, cover: 0.85 }
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export class Bot extends Actor {
  constructor(opts) {
    super({ ...opts, kind: ACTOR_KIND.BOT });
    this.isBotSim = true;          // бот симулируется хостом
    this.skillName = opts.skill || 'normal';
    this.sk = SKILL[this.skillName] || SKILL.normal;
    this.maxHp = this.sk.hp;
    this.hp = this.sk.hp;
    this.armor = this.sk.armor;

    this.aiState = 'patrol';
    this.target = null;
    this.moveGoal = new THREE.Vector3();
    this.repathTimer = 0;
    this.thinkTimer = Math.random() * 0.2;
    this.reactTimer = 0;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.lastSeen = new THREE.Vector3();
    this.seenTimer = 0;
    this.stuckTimer = 0;
    this.lastPos = new THREE.Vector3();
    this.engageDist = 18 + Math.random() * 26;
    this.objectiveBias = Math.random();
    this.input = { fwd: 0, right: 0, jump: false, crouch: false, sprint: false };
    this.wantsFire = false;
    this.aimYaw = this.yaw;
    this.aimPitch = this.pitch;
    this.name = opts.name || BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0];
  }

  /* ---------- выбор оружия под роль ---------- */
  assignKit(rng = Math.random) {
    const r = rng();
    let primary, secondary = 'gyurza';
    if (r < 0.44) primary = this.faction === 'argo' ? 'bulat' : 'vixen';
    else if (r < 0.62) primary = 'osa';
    else if (r < 0.78) primary = 'sokol';
    else if (r < 0.90) primary = 'groza';
    else primary = 'kuvalda';
    if (rng() < 0.14) secondary = 'vektr';
    else if (rng() < 0.1) secondary = 'revansh';
    const gadgets = [];
    if (rng() < 0.7) gadgets.push('frag');
    if (rng() < 0.4) gadgets.push('smoke');
    if (rng() < 0.35) gadgets.push('plate');
    this.setLoadout(primary, secondary, gadgets, 'striker');
  }

  /* ---------- поиск цели ---------- */
  findTarget(actors) {
    let best = null, bestScore = -Infinity;
    const eye = this.eyePos(_v1);
    const maxR = this.sk.range;
    for (const a of actors) {
      if (a === this || a.faction === this.faction || !a.alive) continue;
      if (a.state === 'drone') continue;
      const p = a.state === 'vehicle' ? a.vehicle.mesh.position : a.pos;
      const d = eye.distanceTo(p);
      if (d > maxR) continue;
      // поле зрения
      _v2.subVectors(p, eye).normalize();
      const fwd = this.lookDir(_v3);
      const dot = fwd.dot(_v2);
      // зрение ~180° на дистанции + «слух» по близким целям
      const inFov = dot > 0.0 || d < 30;
      if (!inFov) continue;
      // вплотную (в одном помещении/окопе) цель обнаруживается и без LOS
      if (d > 6 && !this._los(eye, p, a)) continue;
      const score = (maxR - d) + (a.state === 'vehicle' ? 25 : 0) + Math.random() * 12;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  _los(eye, targetPos, target) {
    const from = _v2.copy(eye);
    const to = new THREE.Vector3(targetPos.x, targetPos.y + 1.4, targetPos.z);
    if (this.map && this.map.blocksVision) { /* noop */ }
    return this.game.map.hasLineOfSight(from, to) &&
      !(this.game.effects && this.game.effects.blocksVision(from, to));
  }

  /* ---------- основной шаг ---------- */
  tick(dt, ctx) {
    this.game = ctx.game;
    this.map = ctx.game.map;

    if (!this.alive) {
      this.input.fwd = this.input.right = 0;
      this.wantsFire = false;
      return;
    }

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.16 + Math.random() * 0.1;
      this._think(ctx);
    }

    /* --- движение --- */
    this._move(dt, ctx);

    /* --- прицеливание и огонь --- */
    this._aim(dt, ctx);

    // застрял?
    if (this.thinkTimer > 0.14) {
      const moved = this.pos.distanceTo(this.lastPos);
      if (moved < 0.12 && this.input.fwd !== 0) this.stuckTimer += 0.16;
      else this.stuckTimer = Math.max(0, this.stuckTimer - 0.1);
      this.lastPos.copy(this.pos);
      if (this.stuckTimer > 1.1) {
        this.stuckTimer = 0;
        this.repathTimer = 0;
        this.moveGoal.copy(this.map.randomGroundPoint(Math.random));
        this.aiState = this.target ? 'engage' : 'patrol';
      }
    }

    this.step(dt, this.input, this.map);
  }

  _think(ctx) {
    const actors = ctx.actors;
    const wasTarget = this.target;

    // проверка текущей цели
    if (this.target) {
      if (!this.target.alive || this.target.faction === this.faction) this.target = null;
      else {
        const eye = this.eyePos(_v1);
        const tp = this.target.state === 'vehicle' ? this.target.vehicle.mesh.position : this.target.pos;
        const d = eye.distanceTo(tp);
        if (d > this.sk.range * 1.25) this.target = null;
        else {
          const to = new THREE.Vector3(tp.x, tp.y + 1.4, tp.z);
          const los = this.game.map.hasLineOfSight(eye, to) &&
            !(this.game.effects.blocksVision(eye, to));
          if (los) { this.lastSeen.copy(tp); this.seenTimer = 2.4; }
          else {
            this.seenTimer -= 0.17;
            if (this.seenTimer <= 0) this.target = null;
          }
        }
      }
    }

    if (!this.target) {
      const t = this.findTarget(actors);
      if (t) {
        this.target = t;
        this.reactTimer = this.sk.react * (0.7 + Math.random() * 0.7);
        this.burstLeft = 0;
        this.engageDist = 12 + Math.random() * 30;
      }
    }

    if (this.target) {
      this.aiState = 'engage';
      if (this.reactTimer > 0) this.reactTimer -= 0.17;
    } else if (this.aiState === 'engage') {
      this.aiState = 'search';
      this.repathTimer = 0;
    }

    // выбор точки движения
    this.repathTimer -= 0.17;
    if (this.repathTimer <= 0) {
      // без цели перестраиваем маршрут чаще — иначе бот «гуляет» и не находит бой
      this.repathTimer = this.target ? 1.6 + Math.random() * 2.0 : 0.9 + Math.random() * 1.1;
      this._chooseGoal(ctx);
    }

    // лечение
    if (this.hp < 45 && Math.random() < 0.06 * this.sk.aggro) {
      const g = this.gadgets.find(x => x.id === 'plate' && x.count > 0);
      if (g) {
        g.count--;
        this.armor = Math.min(this.maxArmor, this.armor + g.def.armor);
        this.game.onBotUseGadget && this.game.onBotUseGadget(this, 'plate');
      }
    }

    // граната
    if (this.target && this.reactTimer <= 0 && Math.random() < 0.02 * this.sk.aggro) {
      const g = this.gadgets.find(x => x.id === 'frag' && x.count > 0);
      if (g) {
        const d = this.pos.distanceTo(this.lastSeen);
        if (d > 10 && d < 34) {
          g.count--;
          this.game.throwGrenade(this, this.lastSeen);
        }
      }
    }
  }

  _chooseGoal(ctx) {
    if (this.aiState === 'engage' && this.target) {
      // манёвр: держать дистанцию, искать укрытие
      const to = this.target.state === 'vehicle' ? this.target.vehicle.mesh.position : this.target.pos;
      const d = this.pos.distanceTo(to);
      const wantCover = Math.random() < this.sk.cover;
      if (wantCover) {
        const c = this.map.findCoverNear(this.pos, to, 26);
        if (c) { this.moveGoal.copy(c); return; }
      }
      if (d > this.engageDist * 1.25) this.moveGoal.copy(to);
      else if (d < this.engageDist * 0.55) {
        _v1.subVectors(this.pos, to).normalize().multiplyScalar(this.engageDist * 0.8);
        this.moveGoal.copy(to).add(_v1);
        this.moveGoal.y = this.map.heightAt(this.moveGoal.x, this.moveGoal.z);
      } else {
        this.moveGoal.copy(to);
      }
      return;
    }

    // режим доминирования — идём на точку
    if (ctx.mode === 'dom' && ctx.objectives.length) {
      let best = null, bs = -Infinity;
      for (const o of ctx.objectives) {
        if (o.owner === this.faction) continue;
        const d = this.pos.distanceTo(o.pos);
        const s = -d + (o.owner === 'none' ? 30 : 10) + this.objectiveBias * 40;
        if (s > bs) { bs = s; best = o; }
      }
      if (best && bs > -80) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * best.radius * 0.8;
        this.moveGoal.set(best.pos.x + Math.cos(a) * r, 0, best.pos.z + Math.sin(a) * r);
        this.moveGoal.y = this.map.heightAt(this.moveGoal.x, this.moveGoal.z);
        this.aiState = 'advance';
        return;
      }
    }

    if (this.aiState === 'search') {
      this.moveGoal.copy(this.lastSeen);
      this.moveGoal.y = this.map.heightAt(this.moveGoal.x, this.moveGoal.z);
      this.aiState = 'patrol';
      return;
    }

    // «разведданные»: почти всегда идём к ближайшему живому противнику,
    // иначе на большой карте боты часами бродят без контакта и бой затухает
    let nearest = null, nd = Infinity;
    for (const a of ctx.actors || []) {
      if (!a || a === this || !a.alive || a.faction === this.faction) continue;
      if (a.state === 'drone') continue;
      const p = a.state === 'vehicle' ? a.vehicle.mesh.position : a.pos;
      const d = this.pos.distanceTo(p);
      if (d < nd) { nd = d; nearest = p; }
    }
    if (nearest && Math.random() < 0.9) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 20;
      this.moveGoal.set(nearest.x + Math.cos(a) * r, 0, nearest.z + Math.sin(a) * r);
    } else {
      // иначе — к «горячим точкам» (объекты/центр) или к базе врага
      const hotspots = [];
      for (const o of ctx.objectives || []) hotspots.push(o.pos);
      hotspots.push(new THREE.Vector3(0, 0, 0));
      if (Math.random() < 0.72 && hotspots.length) {
        const h = hotspots[(Math.random() * hotspots.length) | 0];
        const a = Math.random() * Math.PI * 2, r = Math.random() * 30;
        this.moveGoal.set(h.x + Math.cos(a) * r, 0, h.z + Math.sin(a) * r);
      } else {
        const goal = ctx.enemyBase(this.faction);
        const a = Math.random() * Math.PI * 2, r = Math.random() * 34;
        this.moveGoal.set(goal.x + Math.cos(a) * r, 0, goal.z + Math.sin(a) * r);
      }
    }
    const half = this.map.size / 2 - 8;
    this.moveGoal.x = Math.max(-half, Math.min(half, this.moveGoal.x));
    this.moveGoal.z = Math.max(-half, Math.min(half, this.moveGoal.z));
    this.moveGoal.y = this.map.heightAt(this.moveGoal.x, this.moveGoal.z);
  }

  _move(dt, ctx) {
    const to = _v1.subVectors(this.moveGoal, this.pos);
    to.y = 0;
    const dist = to.length();
    if (dist < 1.6) {
      this.input.fwd = 0; this.input.right = 0;
      this.input.sprint = false;
      return;
    }
    to.normalize();

    // расталкивание с союзниками: в куче боты перекрывают друг другу обзор
    if (dist > 0.01) {
      const sep = new THREE.Vector3();
      let n = 0;
      for (const o of ctx.actors || []) {
        if (!o || o === this || !o.alive || o.faction !== this.faction) continue;
        const dd = this.pos.distanceTo(o.pos);
        if (dd > 0.05 && dd < 6.5) {
          sep.x += (this.pos.x - o.pos.x) / dd * (6.5 - dd);
          sep.z += (this.pos.z - o.pos.z) / dd * (6.5 - dd);
          n++;
        }
      }
      if (n && sep.lengthSq() > 0.001) {
        sep.normalize();
        to.addScaledVector(sep, 1.1).normalize();
      }
    }

    const inCombat = this.aiState === 'engage' && this.reactTimer <= 0;
    let faceYaw;
    if (inCombat && this.target) {
      const tp = this.target.state === 'vehicle' ? this.target.vehicle.mesh.position : this.target.pos;
      faceYaw = Math.atan2(-(tp.x - this.pos.x), -(tp.z - this.pos.z));
      // стрейф
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeTimer = 0.7 + Math.random() * 1.3; this.strafeDir *= -1; }
      const d = this.pos.distanceTo(tp);
      this.input.right = this.strafeDir * (d < 40 ? 1 : 0);
      this.input.fwd = d > this.engageDist ? 1 : d < this.engageDist * 0.5 ? -0.6 : 0;
      this.input.sprint = false;
    } else {
      faceYaw = Math.atan2(-to.x, -to.z);
      this.input.fwd = 1;
      this.input.right = 0;
      this.input.sprint = dist > 30 && !this.crouch;
    }

    // объезд препятствий: выбираем направление с наибольшим свободным ходом,
    // штрафую за отклонение от цели (иначе бот «залипает», перебирая лучи)
    const probeLen = 5.5;
    const dirs = [0, 0.42, -0.42, 0.85, -0.85, 1.35, -1.35];
    let bestDir = 0, bestScore = -Infinity;
    const origin = { x: this.pos.x, y: this.pos.y + 1.0, z: this.pos.z };
    for (const off of dirs) {
      const a = faceYaw + off;
      const hit = this.map.colliders.raycast(origin,
        { x: -Math.sin(a), y: 0, z: -Math.cos(a) }, probeLen);
      const free = hit ? hit.dist : probeLen;
      const score = free - Math.abs(off) * 1.9;
      if (score > bestScore) { bestScore = score; bestDir = off; }
    }
    const useYaw = faceYaw + bestDir;

    // плавный поворот
    let diff = useYaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turnRate = inCombat ? 6.5 : 4.0;
    this.yaw += THREE.MathUtils.clamp(diff, -turnRate * dt, turnRate * dt);

    // присесть, если далеко и стреляют
    this.input.crouch = this.aiState === 'engage' && this.hp < 60 && Math.random() < 0.3;
    // прыжок через препятствие
    this.input.jump = bestScore < 1.6 && this.onGround && Math.random() < 0.12;
  }

  _aim(dt, ctx) {
    this.wantsFire = false;
    if (!this.target || this.reactTimer > 0 || !this.alive) {
      // возвращаем прицел к направлению движения
      let diff = this.yaw - this.aimYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.aimYaw += diff * Math.min(1, dt * 5);
      this.aimPitch += (0 - this.aimPitch) * Math.min(1, dt * 5);
      this.yaw = this.aimYaw;
      this.pitch = this.aimPitch;
      return;
    }

    const eye = this.eyePos(_v1);
    const tp = this.target.state === 'vehicle' ? this.target.vehicle.mesh.position : this.target.pos;
    // упреждение
    const lead = new THREE.Vector3(
      tp.x + this.target.vel.x * 0.11,
      tp.y + 1.35 + (this.target.state === 'vehicle' ? 0.6 : 0) + this.target.vel.y * 0.06,
      tp.z + this.target.vel.z * 0.11
    );
    const wantYaw = Math.atan2(-(lead.x - eye.x), -(lead.z - eye.z));
    const horiz = Math.hypot(lead.x - eye.x, lead.z - eye.z);
    const wantPitch = Math.atan2(lead.y - eye.y, horiz);

    const jitter = this.sk.acc * (this.target.vel.length() > 3 ? 1.8 : 1);
    let dy = wantYaw - this.aimYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const dp = wantPitch - this.aimPitch;
    const rate = this.sk.aim * dt;
    this.aimYaw += THREE.MathUtils.clamp(dy, -rate, rate) + (Math.random() - 0.5) * jitter * dt;
    this.aimPitch += THREE.MathUtils.clamp(dp, -rate, rate) + (Math.random() - 0.5) * jitter * dt;
    this.aimPitch = THREE.MathUtils.clamp(this.aimPitch, -1.2, 1.2);
    this.yaw = this.aimYaw;
    this.pitch = this.aimPitch;

    // ADS на дистанции
    const dist = eye.distanceTo(tp);
    this.ads = dist > 28;

    // выстрелы очередями
    if (this.burstPause > 0) { this.burstPause -= dt; }
    else if (this.burstLeft <= 0) {
      const aligned = Math.abs(dy) < 0.16 && Math.abs(dp) < 0.16;
      if (aligned && dist < this.sk.range) {
        this.burstLeft = Math.max(1, Math.round(this.sk.burst * (0.6 + Math.random() * 0.8)));
      }
    } else {
      // не палим сквозь стены и укрытия
      const losNow = this.game.map.hasLineOfSight(
        eye, new THREE.Vector3(tp.x, tp.y + 1.35, tp.z)) &&
        !(this.game.effects && this.game.effects.blocksVision(eye, new THREE.Vector3(tp.x, tp.y + 1.35, tp.z)));
      this.wantsFire = losNow;
    }
  }

  onFired() {
    this.burstLeft--;
    if (this.burstLeft <= 0) this.burstPause = 0.28 + Math.random() * 0.7;
  }
}
