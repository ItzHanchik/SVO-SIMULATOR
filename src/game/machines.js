import * as THREE from 'three';
import { makeVehicle, makeDrone } from '../entities/models.js';
import { VEHICLES, DRONES } from '../core/data.js';

/* ============================================================
   ТЕХНИКА
   ============================================================ */
let vehSeq = 1;

export class Vehicle {
  constructor(type, position, faction, game) {
    this.id = 'v' + (vehSeq++);
    this.type = type;
    this.def = VEHICLES[type];
    this.faction = faction;
    this.game = game;
    this.mesh = makeVehicle(type, faction === 'vega' ? 0x38bdf8 : 0xf0a93b);
    this.mesh.position.copy(position);
    this.mesh.position.y = game.map.heightAt(position.x, position.z);
    this.mesh.traverse(o => { o.userData.vehicleId = this.id; });
    game.scene.add(this.mesh);

    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.alive = true;
    /* Случайный курс на спавне приводил к тому, что танк появлялся «носом в лес»
       и намертво вставал. Разворачиваем технику к центру карты. */
    {
      const dx = -this.mesh.position.x, dz = -this.mesh.position.z;
      const L = Math.hypot(dx, dz);
      this.yaw = L > 1 ? Math.atan2(-dx / L, -dz / L) : 0;
    }
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.driver = null;
    this.passengers = [];
    this.cannonCd = 0;
    this.mgCd = 0;
    this.turretYaw = 0;
    this.turretPitch = 0;
    this.wreckTimer = 0;
    this.respawnTimer = 0;
    this.netPos = this.mesh.position.clone();
    this.netYaw = this.yaw;
    this.engineNode = null;
    this.radius = type === 'rys' ? 1.5 : 2.4;
    this._collideCooldown = 0;
  }

  get occupied() { return !!this.driver; }

  enter(actor) {
    if (!this.alive) return false;
    if (!this.driver) {
      this.driver = actor;
      actor.vehicle = this;
      actor.state = 'vehicle';
      actor.mesh.visible = false;
      return 'driver';
    }
    const seats = this.def.seats || 0;
    if (this.passengers.length < seats) {
      this.passengers.push(actor);
      actor.vehicle = this;
      actor.state = 'vehicle';
      actor.mesh.visible = false;
      return 'passenger';
    }
    return false;
  }

  exit(actor) {
    if (this.driver === actor) this.driver = null;
    else this.passengers = this.passengers.filter(p => p !== actor);
    actor.vehicle = null;
    actor.state = 'ground';
    actor.mesh.visible = !actor.isLocal;
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(this.radius + 1.2);
    const np = this.mesh.position.clone().add(side);
    np.y = this.game.map.heightAt(np.x, np.z);
    actor.pos.copy(np);
    actor.vel.set(0, 0, 0);
    return true;
  }

  applyDamage(amount, fromActor, explosive = false) {
    if (!this.alive) return 0;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroy(fromActor);
      return amount;
    }
    return amount;
  }

  destroy(killer) {
    if (!this.alive) return;
    this.alive = false;
    this.wreckTimer = 30;
    this.game.onVehicleDestroyed(this, killer);
    for (const p of [...this.passengers]) {
      this.exit(p);
      p.applyDamage(999, killer, 'body', null, true);
    }
    if (this.driver) {
      const d = this.driver;
      this.exit(d);
      d.applyDamage(999, killer, 'body', null, true);
    }
  }

  step(dt, input) {
    if (!this.alive) {
      this.wreckTimer -= dt;
      return;
    }
    const map = this.game.map;
    const def = this.def;

    /* --- движение --- */
    const throttle = input.throttle || 0;
    const steer = input.steer || 0;
    const maxSpd = def.speed * (throttle > 0 ? 1 : 0.55);
    const accel = 9.5;
    this.speed += THREE.MathUtils.clamp(throttle * maxSpd - this.speed, -accel * dt, accel * dt);
    if (Math.abs(throttle) < 0.05) this.speed *= (1 - 1.6 * dt);

    const turnRate = def.turn * THREE.MathUtils.clamp(Math.abs(this.speed) / 8, 0, 1) * Math.sign(this.speed || 1);
    this.yaw -= steer * turnRate * dt;

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const next = this.mesh.position.clone().addScaledVector(fwd, this.speed * dt);

    // коллизии
    this._collideCooldown -= dt;
    const boxes = map.colliders.query(next.x, next.z, this.radius + 1);
    let blocked = false;
    for (const b of boxes) {
      const cx = THREE.MathUtils.clamp(next.x, b.min.x, b.max.x);
      const cz = THREE.MathUtils.clamp(next.z, b.min.z, b.max.z);
      if (Math.hypot(next.x - cx, next.z - cz) < this.radius) { blocked = true; break; }
    }
    if (blocked) {
      const impact = Math.abs(this.speed);
      if (impact > 11 && this._collideCooldown <= 0) {
        this.applyDamage(impact * 2.2, this.driver);
        this._collideCooldown = 0.6;
        this.game.onVehicleImpact && this.game.onVehicleImpact(this, impact);
      }
      this.speed *= -0.22;
    } else {
      this.mesh.position.x = THREE.MathUtils.clamp(next.x, -map.size / 2 + 3, map.size / 2 - 3);
      this.mesh.position.z = THREE.MathUtils.clamp(next.z, -map.size / 2 + 3, map.size / 2 - 3);
    }

    // рельеф
    const gy = map.heightAt(this.mesh.position.x, this.mesh.position.z);
    const targetY = gy;
    this.mesh.position.y += (targetY - this.mesh.position.y) * Math.min(1, dt * 9);
    if (this.mesh.position.y < map.waterLevel) {
      this.applyDamage(35 * dt, null);
      this.speed *= (1 - 2 * dt);
    }

    // наклон по рельефу
    const n = map.normalAt(this.mesh.position.x, this.mesh.position.z);
    const targetPitch = Math.asin(THREE.MathUtils.clamp(
      -(-Math.sin(this.yaw) * n.x + -Math.cos(this.yaw) * n.z), -0.5, 0.5));
    const targetRoll = Math.asin(THREE.MathUtils.clamp(
      (Math.cos(this.yaw) * n.x + -Math.sin(this.yaw) * n.z), -0.5, 0.5));
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 7);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 7);

    this.mesh.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.x = this.pitch;
    this.mesh.rotation.z = this.roll;

    /* --- башня --- */
    if (this.mesh.userData.turret) {
      let ty = this.turretYaw - this.yaw;
      while (ty > Math.PI) ty -= Math.PI * 2;
      while (ty < -Math.PI) ty += Math.PI * 2;
      const t = this.mesh.userData.turret;
      t.rotation.y += (ty - t.rotation.y) * Math.min(1, dt * 5.5);
      t.rotation.x = THREE.MathUtils.clamp(this.turretPitch, -0.22, 0.35);
    }

    this.cannonCd = Math.max(0, this.cannonCd - dt);
    this.mgCd = Math.max(0, this.mgCd - dt);

    // дым при низком HP
    if (this.hp < this.maxHp * 0.35 && Math.random() < dt * 14) {
      const p = this.mesh.position.clone();
      p.y += 1.6;
      this.game.effects.puff(p, 1.6, 1.6);
    }
  }

  fireCannon(aimDir) {
    if (!this.alive || this.cannonCd > 0 || !this.def.cannon) return false;
    this.cannonCd = this.def.cannon.reload;
    const origin = this._muzzleWorld('muzzle');
    this.game.fireVehicleShell(this, origin, aimDir, this.def.cannon);
    return true;
  }

  fireMg(aimDir) {
    if (!this.alive || this.mgCd > 0 || !this.def.mg) return false;
    this.mgCd = 60 / this.def.mg.rpm;
    const origin = this._muzzleWorld('mgMuzzle') || this._muzzleWorld('muzzle');
    this.game.fireVehicleMG(this, origin, aimDir, this.def.mg);
    return true;
  }

  _muzzleWorld(key) {
    const m = this.mesh.userData[key];
    if (!m) return this.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    return m.getWorldPosition(new THREE.Vector3());
  }

  remove() {
    this.game.scene.remove(this.mesh);
  }
}

/* ============================================================
   ФПВ-ДРОН
   ============================================================ */
let droneSeq = 1;

export class FpvDrone {
  constructor(ownerActor, game, droneId = 'striker') {
    this.id = 'd' + (droneSeq++);
    this.def = DRONES[droneId] || DRONES.striker;
    this.owner = ownerActor;
    this.game = game;
    this.faction = ownerActor.faction;
    this.mesh = makeDrone(this.faction === 'vega' ? 0x38bdf8 : 0xf0a93b, this.def.id === 'hornet');
    this.mesh.scale.setScalar(this.def.id === 'hornet' ? 2.6 : 2.0);
    game.scene.add(this.mesh);

    this.pos = ownerActor.eyePos(new THREE.Vector3());
    this.pos.y += 0.6;
    this.vel = new THREE.Vector3();
    this.yaw = ownerActor.yaw;
    this.pitch = 0.05;
    this.roll = 0;
    this.battery = this.def.battery;
    this.maxBattery = this.def.battery;
    this.armed = true;
    this.alive = true;
    this.hp = this.def.id === 'hornet' ? 90 : 40;
    this.radius = 0.55;
    this.crashed = false;
    this.detached = false;

    this.camera = new THREE.PerspectiveCamera(105, 16 / 9, 0.06, 900);
    this.camera.position.set(0, 0.12, -0.2);
    this.mesh.add(this.camera);

    this._spin = 0;
    this.signal = 1;
  }

  applyDamage(dmg, fromActor) {
    if (!this.alive) return;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.detonate(fromActor, false);
    }
  }

  detonate(killer, direct = true) {
    if (!this.alive) return;
    this.alive = false;
    const p = this.pos.clone();
    this.game.droneDetonate(this, p, killer, direct);
    this.remove();
  }

  remove() {
    this.mesh.remove(this.camera);
    this.game.scene.remove(this.mesh);
  }

  step(dt, input, map) {
    if (!this.alive) return;
    const def = this.def;

    this.battery -= dt;
    if (this.battery <= 0) { this.detonate(null, false); return; }

    /* --- управление --- */
    const throttle = input.throttle || 0;   // -1..1
    const pitchIn = input.pitch || 0;       // -1..1
    const rollIn = input.roll || 0;
    const yawIn = input.yaw || 0;

    const agi = def.agility;
    this.pitch += (pitchIn * 0.85 - this.pitch) * Math.min(1, dt * agi * 2.6);
    this.roll += (-rollIn * 0.85 - this.roll) * Math.min(1, dt * agi * 2.6);
    this.yaw -= yawIn * agi * 1.5 * dt;

    // тяга
    const fwd = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    const thrust = def.speed * Math.max(0, 0.45 + throttle * 0.75);
    this.vel.addScaledVector(fwd, thrust * dt * 2.6);
    // гравитация + сопротивление
    this.vel.y -= 9.2 * dt;
    this.vel.multiplyScalar(1 - 1.9 * dt);

    const maxV = def.speed * 1.35;
    if (this.vel.length() > maxV) this.vel.setLength(maxV);

    this.pos.addScaledVector(this.vel, dt);

    // столкновения
    const gy = map.heightAt(this.pos.x, this.pos.z);
    const hit = map.colliders.raycast(
      { x: this.pos.x - this.vel.x * dt, y: this.pos.y - this.vel.y * dt, z: this.pos.z - this.vel.z * dt },
      this.vel.lengthSq() > 0.01 ? this.vel.clone().normalize() : new THREE.Vector3(0, 1, 0),
      Math.max(0.4, this.vel.length() * dt + this.radius)
    );
    if (hit && this.vel.length() > 4) { this.detonate(null, true); return; }
    if (this.pos.y < gy + 0.25) {
      this.pos.y = gy + 0.25;
      if (this.vel.y < -4) { this.detonate(null, true); return; }
      this.vel.y = Math.max(0, this.vel.y);
      this.vel.x *= 0.6; this.vel.z *= 0.6;
    }
    const half = map.size / 2 - 2;
    if (Math.abs(this.pos.x) > half || Math.abs(this.pos.z) > half || this.pos.y > 160) {
      this.detonate(null, false);
      return;
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.pitch * 0.7, this.yaw, this.roll * 0.7, 'YXZ');

    // пропеллеры
    this._spin += dt * (18 + Math.abs(throttle) * 40);
    const props = this.mesh.userData.props;
    if (props) for (let i = 0; i < props.length; i++) props[i].rotation.y = this._spin * (i % 2 ? -1 : 1);

    // сигнал
    const dist = this.pos.distanceTo(this.owner.pos);
    this.signal = THREE.MathUtils.clamp(1 - dist / 420, 0.25, 1);

    this.camera.updateProjectionMatrix();
  }

  aimDir(out = new THREE.Vector3()) {
    return out.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }
}
