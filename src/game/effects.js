import * as THREE from 'three';
import { makeSmokeParticleTexture, makeSparkTexture } from '../entities/models.js';

/* ============================================================
   ЭФФЕКТЫ: пули, попадания, взрывы, дым, декали
   всё через пулы объектов — без мусора в рантайме
   ============================================================ */

const UP = new THREE.Vector3(0, 1, 0);

export class Effects {
  constructor(scene, gameMap) {
    this.scene = scene;
    this.map = gameMap;

    this.smokeTex = makeSmokeParticleTexture();
    this.sparkTex = makeSparkTexture();

    /* --- трассеры --- */
    this.tracers = [];
    const tg = new THREE.BufferGeometry();
    this.tracerMax = 260;
    const tpos = new Float32Array(this.tracerMax * 2 * 3);
    tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    this.tracerGeo = tg;
    this.tracerMat = new THREE.LineBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.85, depthWrite: false
    });
    this.tracerLines = new THREE.LineSegments(tg, this.tracerMat);
    this.tracerLines.frustumCulled = false;
    scene.add(this.tracerLines);

    /* --- частицы (искры, дым, обломки) --- */
    this.pMax = 1400;
    this.pGeo = new THREE.BufferGeometry();
    const pp = new Float32Array(this.pMax * 3);
    const pc = new Float32Array(this.pMax * 3);
    const ps = new Float32Array(this.pMax);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    this.pGeo.setAttribute('size', new THREE.BufferAttribute(ps, 1));
    this.pGeo.setDrawRange(0, 0);
    this.pMat = new THREE.PointsMaterial({
      size: 0.5, map: this.sparkTex, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    });
    this.points = new THREE.Points(this.pGeo, this.pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.particles = [];

    /* --- дым (спрайты) --- */
    this.smokes = [];
    this.smokeMat = new THREE.SpriteMaterial({
      map: this.smokeTex, transparent: true, opacity: 0.55, depthWrite: false, color: 0xbfc4c8
    });

    /* --- вспышки выстрелов --- */
    this.flashes = [];
    this.flashMat = new THREE.SpriteMaterial({
      map: this.sparkTex, transparent: true, opacity: 1, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffd07a
    });

    /* --- декали (следы попаданий) --- */
    this.decalMax = 260;
    const decalGeo = new THREE.PlaneGeometry(0.28, 0.28);
    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0x0d0f11, transparent: true, opacity: 0.82, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3
    });
    this.decals = new THREE.InstancedMesh(decalGeo, this.decalMat, this.decalMax);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    scene.add(this.decals);
    this.decalList = [];
    this._dm = new THREE.Object3D();

    /* --- дымовые гранаты --- */
    this.smokeFields = [];
  }

  /* ---------- трассер ---------- */
  tracer(from, to, color = 0xffd9a0, life = 0.055) {
    if (this.tracers.length > 90) return;
    this.tracers.push({
      a: from.clone(), b: to.clone(), t: life, max: life, color
    });
  }

  /* ---------- попадание в поверхность ---------- */
  impact(pos, normal, heavy = false) {
    this.decal(pos, normal);
    const n = heavy ? 16 : 7;
    const dir = normal ? normal.clone() : new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const v = dir.clone()
        .add(new THREE.Vector3((Math.random() - .5) * 1.6, Math.random() * 0.7, (Math.random() - .5) * 1.6))
        .normalize()
        .multiplyScalar(2 + Math.random() * (heavy ? 9 : 5));
      this.spark(pos, v, heavy ? 0.5 : 0.3);
    }
    // пыли
    for (let i = 0; i < (heavy ? 8 : 3); i++) {
      this.puff(pos, 0.5 + Math.random() * 0.8, 0.5);
    }
  }

  decal(pos, normal) {
    if (this.decalList.length >= this.decalMax) this.decalList.shift();
    const n = normal || UP;
    this.decalList.push({ p: pos.clone().addScaledVector(n, 0.02), n: n.clone() });
    this._rebuildDecals();
  }

  _rebuildDecals() {
    const d = this._dm;
    const list = this.decalList;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      d.position.copy(e.p);
      d.lookAt(e.p.clone().add(e.n));
      d.rotateZ(Math.random() * 6.28);
      d.updateMatrix();
      this.decals.setMatrixAt(i, d.matrix);
    }
    this.decals.count = list.length;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /* ---------- кровь / попадание по цели ---------- */
  blood(pos) {
    for (let i = 0; i < 9; i++) {
      const v = new THREE.Vector3((Math.random() - .5) * 3.4, Math.random() * 2.6, (Math.random() - .5) * 3.4);
      this.addParticle(pos, v, new THREE.Color(0x8c1a1f), 0.5, 0.28, -7);
    }
  }

  spark(pos, vel, life = 0.35) {
    this.addParticle(pos, vel, new THREE.Color(0xffd08a), life, 0.34, -11);
  }

  puff(pos, life = 1.2, scale = 1) {
    this.addParticle(pos,
      new THREE.Vector3((Math.random() - .5) * 1.1, 0.5 + Math.random() * 0.8, (Math.random() - .5) * 1.1),
      new THREE.Color(0x8b8577), life, 0.9 * scale, -1.5, true);
  }

  addParticle(pos, vel, color, life, size, gravity, soft = false) {
    if (this.particles.length >= this.pMax) this.particles.shift();
    this.particles.push({
      p: pos.clone(), v: vel.clone(), c: color.clone(),
      life, max: life, size, g: gravity, soft
    });
  }

  /* ---------- вспышка ---------- */
  flash(pos, scale = 1) {
    const s = new THREE.Sprite(this.flashMat.clone());
    s.position.copy(pos);
    s.scale.setScalar(0.9 * scale);
    this.scene.add(s);
    this.flashes.push({ s, t: 0.06 });
  }

  /* ---------- взрыв ---------- */
  explosion(pos, radius = 6, big = false) {
    const count = big ? 46 : 26;
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(
        (Math.random() - .5), Math.random() * 0.85, (Math.random() - .5)
      ).normalize().multiplyScalar((big ? 15 : 9) * (0.4 + Math.random() * 0.9));
      const c = new THREE.Color().setHSL(0.06 + Math.random() * 0.05, 0.95, 0.55 + Math.random() * 0.25);
      this.addParticle(pos, v, c, 0.35 + Math.random() * 0.5, big ? 1.5 : 0.9, -14);
    }
    for (let i = 0; i < (big ? 20 : 11); i++) {
      const v = new THREE.Vector3(
        (Math.random() - .5), Math.random() * 0.5, (Math.random() - .5)
      ).normalize().multiplyScalar((big ? 7 : 4) * (0.4 + Math.random()));
      this.addParticle(pos, v, new THREE.Color(0x55504a), 1.4 + Math.random() * 1.4,
        big ? 3.4 : 2.0, -0.8, true);
    }
    const f = new THREE.Sprite(this.flashMat.clone());
    f.position.copy(pos);
    f.scale.setScalar(big ? 16 : 8);
    this.scene.add(f);
    this.flashes.push({ s: f, t: 0.18, fade: true });
  }

  /* ---------- дымовое поле ---------- */
  addSmokeField(pos, duration = 18, radius = 7) {
    const puffs = [];
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius * 0.9;
      const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
      const y = (this.map ? this.map.heightAt(x, z) : pos.y) + 0.6 + Math.random() * 3.4;
      const s = new THREE.Sprite(this.smokeMat.clone());
      s.position.set(x, y, z);
      const sc = 5 + Math.random() * 5;
      s.scale.setScalar(sc);
      s.material.opacity = 0;
      this.scene.add(s);
      puffs.push({ s, base: y, ph: Math.random() * 6.28, sc });
    }
    this.smokeFields.push({ puffs, t: 0, duration, pos: pos.clone(), radius });
  }

  blocksVision(from, to) {
    for (const f of this.smokeFields) {
      if (f.t > f.duration) continue;
      // расстояние от отрезка до центра поля
      const ab = new THREE.Vector3().subVectors(to, from);
      const L = ab.length();
      if (L < 0.01) continue;
      ab.divideScalar(L);
      const ap = new THREE.Vector3().subVectors(f.pos, from);
      const t = THREE.MathUtils.clamp(ap.dot(ab), 0, L);
      const closest = from.clone().addScaledVector(ab, t);
      if (closest.distanceTo(f.pos) < f.radius * 0.95) return true;
    }
    return false;
  }

  /* ---------- обновление ---------- */
  update(dt) {
    /* трассеры */
    const arr = this.tracerGeo.attributes.position.array;
    let ti = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      if (t.t <= 0) { this.tracers.splice(i, 1); continue; }
      if (ti < this.tracerMax) {
        const k = ti * 6;
        arr[k] = t.a.x; arr[k + 1] = t.a.y; arr[k + 2] = t.a.z;
        arr[k + 3] = t.b.x; arr[k + 4] = t.b.y; arr[k + 5] = t.b.z;
        ti++;
      }
    }
    this.tracerGeo.setDrawRange(0, ti * 2);
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerMat.opacity = 0.85;

    /* частицы */
    const pp = this.pGeo.attributes.position.array;
    const pc = this.pGeo.attributes.color.array;
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.v.y += p.g * dt;
      p.v.multiplyScalar(1 - (p.soft ? 1.6 : 0.9) * dt);
      p.p.addScaledVector(p.v, dt);
      if (this.map) {
        const gy = this.map.heightAt(p.p.x, p.p.z);
        if (p.p.y < gy + 0.05) {
          p.p.y = gy + 0.05;
          p.v.y *= -0.28;
          p.v.x *= 0.6; p.v.z *= 0.6;
          if (Math.abs(p.v.y) < 0.35) p.v.y = 0;
        }
      }
      const f = p.life / p.max;
      const k = n * 3;
      pp[k] = p.p.x; pp[k + 1] = p.p.y; pp[k + 2] = p.p.z;
      const c = p.c;
      const bright = p.soft ? f * 0.75 : f;
      pc[k] = c.r * bright; pc[k + 1] = c.g * bright; pc[k + 2] = c.b * bright;
      n++;
    }
    this.pGeo.setDrawRange(0, n);
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;

    /* вспышки */
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      if (f.t <= 0) {
        this.scene.remove(f.s);
        f.s.material.dispose();
        this.flashes.splice(i, 1);
      } else {
        f.s.material.opacity = Math.max(0, f.t / (f.fade ? 0.18 : 0.06));
      }
    }

    /* дымовые поля */
    for (let i = this.smokeFields.length - 1; i >= 0; i--) {
      const f = this.smokeFields[i];
      f.t += dt;
      const fadeIn = Math.min(1, f.t / 1.4);
      const fadeOut = Math.min(1, Math.max(0, (f.duration - f.t) / 2.5));
      for (const p of f.puffs) {
        p.s.position.y = p.base + Math.sin(f.t * 0.5 + p.ph) * 0.5;
        p.s.material.opacity = 0.6 * fadeIn * fadeOut;
        p.s.scale.setScalar(p.sc * (0.85 + fadeIn * 0.35));
      }
      if (f.t > f.duration) {
        for (const p of f.puffs) { this.scene.remove(p.s); p.s.material.dispose(); }
        this.smokeFields.splice(i, 1);
      }
    }
  }

  clear() {
    for (const f of this.smokeFields) for (const p of f.puffs) this.scene.remove(p.s);
    this.smokeFields.length = 0;
    this.particles.length = 0;
    this.tracers.length = 0;
    for (const f of this.flashes) this.scene.remove(f.s);
    this.flashes.length = 0;
    this.decalList.length = 0;
    this.decals.count = 0;
  }
}
