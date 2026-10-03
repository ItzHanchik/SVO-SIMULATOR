import * as THREE from 'three';

/* ============================================================
   ПРОЦЕДУРНАЯ КАРТА
   рельеф + река + деревни + лес + укрытия + точки захвата
   ============================================================ */

/* ---------- шум ---------- */
/* 32-битный целочисленный хеш. ВАЖНО: только Math.imul —
   обычные умножения на большие константы уводят значение за 2^53,
   и побитовые операции теряют все младшие биты (шум вырождается). */
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, seed, oct = 5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * freq, y * freq, seed + i * 97) * amp;
    norm += amp; amp *= 0.5; freq *= 2.07;
  }
  return sum / norm;
}
export const rnd = (function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
})(20260317);

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- пространственный хеш для коллизий ---------- */
export class ColliderGrid {
  constructor(cell = 14) { this.cell = cell; this.map = new Map(); this.list = []; }
  _key(ix, iz) { return ix + ',' + iz; }
  add(box, tag) {
    const e = { box, tag };
    this.list.push(e);
    const c = this.cell;
    const x0 = Math.floor(box.min.x / c), x1 = Math.floor(box.max.x / c);
    const z0 = Math.floor(box.min.z / c), z1 = Math.floor(box.max.z / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this._key(ix, iz);
      let arr = this.map.get(k);
      if (!arr) { arr = []; this.map.set(k, arr); }
      arr.push(e);
    }
    return e;
  }
  query(x, z, r = 2) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    const seen = new Set(); const out = [];
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const arr = this.map.get(this._key(ix, iz));
      if (!arr) continue;
      for (const e of arr) if (!seen.has(e)) { seen.add(e); out.push(e.box); }
    }
    return out;
  }
  /* скольжение сферы вдоль AABB; возвращает скорректированную позицию */
  resolve(pos, radius, groundY) {
    const near = this.query(pos.x, pos.z, radius + 1.2);
    for (const b of near) {
      const cx = clamp(pos.x, b.min.x, b.max.x);
      const cz = clamp(pos.z, b.min.z, b.max.z);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      const top = b.max.y, bottom = b.min.y;
      // можно запрыгнуть на низкий объект
      if (pos.y - 0.1 < top && pos.y > bottom - 0.4) {
        if (top - pos.y < 1.15 && pos.y >= groundY) { /* step up handled by caller */ }
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (radius - d) / d;
          pos.x += dx * push; pos.z += dz * push;
        } else {
          // внутри по оси — выталкиваем по кратчайшей
          const ox = Math.min(pos.x - b.min.x, b.max.x - pos.x);
          const oz = Math.min(pos.z - b.min.z, b.max.z - pos.z);
          if (ox < oz) pos.x += (pos.x < (b.min.x + b.max.x) / 2) ? -ox : ox;
          else pos.z += (pos.z < (b.min.z + b.max.z) / 2) ? -oz : oz;
        }
      }
    }
    return pos;
  }
  /* проверка отрезка на пересечение с коллайдерами (для пуль) */
  raycast(o, dir, maxDist) {
    let best = maxDist;
    let hitBox = null;
    const step = 6;
    const steps = Math.ceil(maxDist / step);
    const checked = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = Math.min(maxDist, i * step);
      const px = o.x + dir.x * t, pz = o.z + dir.z * t;
      const arr = this.query(px, pz, 3);
      for (const b of arr) {
        if (checked.has(b)) continue;
        checked.add(b);
        const d = rayBox(o, dir, b, best);
        if (d !== null && d < best) { best = d; hitBox = b; }
      }
      if (hitBox && best <= t) break;
    }
    return hitBox ? { dist: best, box: hitBox } : null;
  }
}

function rayBox(o, d, b, maxT) {
  let tmin = -Infinity, tmax = Infinity;
  const axes = ['x', 'y', 'z'];
  for (const a of axes) {
    if (Math.abs(d[a]) < 1e-8) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return null;
    } else {
      let t1 = (b.min[a] - o[a]) / d[a];
      let t2 = (b.max[a] - o[a]) / d[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0 || tmin < 0 || tmin > maxT) return null;
  return tmin;
}

/* ============================================================
   КЛАСС КАРТЫ
   ============================================================ */
export class GameMap {
  constructor(cfg) {
    this.cfg = cfg;
    this.size = cfg.size;
    this.seg = 180;
    this.seed = 1337 + cfg.size;
    this.rng = (function (s) { let q = s >>> 0 || 1; return () => { q ^= q << 13; q >>>= 0; q ^= q >> 17; q ^= q << 5; q >>>= 0; return q / 4294967296; }; })(this.seed);
    this.colliders = new ColliderGrid(14);
    this.group = new THREE.Group();
    this.props = [];         // визуальные объекты (для взрывов и т.п.)
    this.vehiclesSpots = [];
    this.objectives = [];
    this.coverPoints = [];   // точки для патрулирования ботов
    this.spawn = { vega: [], argo: [] };
    this.waterLevel = -1.35;
    this._layout();
    this._build();
  }

  /* ---------- планировка ---------- */
  _layout() {
    const R = this.rng, S = this.size;
    const half = S / 2;

    // река — полилиния через карту
    this.river = [];
    const rA = -half * 0.35 + R() * half * 0.3;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      this.river.push(new THREE.Vector2(
        -half + t * S,
        rA + Math.sin(t * Math.PI * 1.4 + R() * 0.4) * half * 0.42 + (R() - 0.5) * 12
      ));
    }
    this.riverWidth = 13 + R() * 5;

    // дороги
    this.roads = [];
    const roadCount = this.cfg.urban > 1 ? 3 : 2;
    for (let r = 0; r < roadCount; r++) {
      const pts = [];
      const vertical = R() > 0.5;
      const off = (R() - 0.5) * half * 0.9;
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const along = -half + t * S;
        const across = off + Math.sin(t * Math.PI * 2 + r) * half * 0.18;
        pts.push(vertical ? new THREE.Vector2(across, along) : new THREE.Vector2(along, across));
      }
      this.roads.push(pts);
    }

    // деревни / кластеры построек
    this.clusters = [];
    const cCount = Math.round(3 + this.cfg.urban * 3);
    for (let i = 0; i < cCount; i++) {
      const cx = (R() - 0.5) * S * 0.78;
      const cz = (R() - 0.5) * S * 0.78;
      const big = this.cfg.urban > 1 || R() > 0.62;
      const count = Math.round((big ? 16 : 7) * (0.7 + R() * 0.7));
      const spread = big ? 46 : 30;
      this.clusters.push({ x: cx, z: cz, count, spread, big, pads: [] });
    }

    // точки захвата — три, разнесённые
    const cands = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(-S * 0.30, S * 0.26),
      new THREE.Vector2(S * 0.30, -S * 0.24),
      new THREE.Vector2(-S * 0.24, -S * 0.30),
      new THREE.Vector2(S * 0.26, S * 0.30)
    ];
    cands.sort(() => R() - 0.5);
    this.objectives = cands.slice(0, 3).map((p, i) => ({
      id: 'A' + i, name: ['АЛЬФА', 'БРАВО', 'ЧАРЛИ'][i],
      pos: new THREE.Vector3(p.x, 0, p.y), radius: 17, owner: 'none'
    }));

    // спавны сторон — противоположные углы
    const cornerA = new THREE.Vector2(-half * 0.82, -half * 0.82);
    const cornerB = new THREE.Vector2(half * 0.82, half * 0.82);
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, d = R() * 26;
      this.spawn.vega.push(new THREE.Vector3(cornerA.x + Math.cos(a) * d, 0, cornerA.y + Math.sin(a) * d));
      const a2 = R() * Math.PI * 2, d2 = R() * 26;
      this.spawn.argo.push(new THREE.Vector3(cornerB.x + Math.cos(a2) * d2, 0, cornerB.y + Math.sin(a2) * d2));
    }
    this.base = { vega: cornerA.clone(), argo: cornerB.clone() };
  }

  /* ---------- высота ---------- */
  _distToPolyline(x, z, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const abx = b.x - a.x, abz = b.y - a.y;
      const len2 = abx * abx + abz * abz;
      let t = len2 ? ((x - a.x) * abx + (z - a.y) * abz) / len2 : 0;
      t = clamp(t, 0, 1);
      const px = a.x + abx * t, pz = a.y + abz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) best = d;
    }
    return best;
  }

  rawHeight(x, z) {
    const s = this.size;
    let h = 0;
    const hill = this.cfg.hills;
    h += (fbm(x * 0.0055, z * 0.0055, this.seed, 5) - 0.5) * 34 * hill;
    h += (fbm(x * 0.017, z * 0.017, this.seed + 31, 4) - 0.5) * 7 * hill;
    h += (fbm(x * 0.06, z * 0.06, this.seed + 77, 3) - 0.5) * 1.2;
    // крупный холм в центре
    const dc = Math.hypot(x, z);
    h += Math.max(0, 1 - dc / (s * 0.22)) * 9 * hill;
    return h;
  }

  /* базовая высота = шум + подъём суши над уровнем воды */
  baseHeight(x, z) {
    return this.rawHeight(x, z) + this.heightOffset;
  }

  /* Поднимаем рельеф так, чтобы ~85% карты было над водой,
     а под воду уходило только вырезанное русло реки. */
  _computeHeightOffset() {
    const n = 1400, arr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      arr[i] = this.rawHeight((this.rng() - 0.5) * this.size, (this.rng() - 0.5) * this.size);
    }
    arr.sort();
    const p15 = arr[Math.floor(n * 0.15)];
    this.heightOffset = (this.waterLevel + 0.9) - p15;
  }

  heightAt(x, z) {
    const H = this.heights, seg = this.seg, s = this.size;
    const fx = (x + s / 2) / s * seg, fz = (z + s / 2) / s * seg;
    if (fx < 0 || fz < 0 || fx >= seg || fz >= seg) return this.baseHeight(x, z);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const w = seg + 1;
    const h00 = H[iz * w + ix], h10 = H[iz * w + ix + 1];
    const h01 = H[(iz + 1) * w + ix], h11 = H[(iz + 1) * w + ix + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.4;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  slopeAt(x, z) {
    const n = this.normalAt(x, z);
    return 1 - n.y;
  }

  /* ---------- строительство ---------- */
  _build() {
    const S = this.size, seg = this.seg;

    /* --- рельеф --- */
    this._computeHeightOffset();

    const geo = new THREE.PlaneGeometry(S, S, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const w = seg + 1;
    this.heights = new Float32Array(w * w);

    // "плоские площадки" под постройки (уже с учётом подъёма суши)
    const pads = [];
    for (const cl of this.clusters) {
      pads.push({ x: cl.x, z: cl.z, r: cl.spread * 1.35, h: this.baseHeight(cl.x, cl.z) });
    }

    const rw = this.riverWidth;
    const riverBed = this.waterLevel - 2.1;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let h = this.baseHeight(x, z);

      // дороги — сглаживание
      for (const road of this.roads) {
        const d = this._distToPolyline(x, z, road);
        if (d < 16) {
          const t = clamp(1 - d / 16, 0, 1);
          h = lerp(h, this._roadHeight(x, z, road), smooth(t) * 0.85);
        }
      }

      // площадки под деревни
      for (const p of pads) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r) {
          const t = clamp(1 - d / p.r, 0, 1);
          h = lerp(h, p.h, smooth(t) * 0.9);
        }
      }

      // русло реки — вырезаем в самом конце, чтобы не затапливать дороги и деревни
      const dr = this._distToPolyline(x, z, this.river);
      if (dr < rw * 2.4) {
        const t = clamp(1 - dr / (rw * 2.4), 0, 1);
        h = lerp(h, riverBed, Math.pow(t, 0.72));
      }

      this.heights[i] = h;
      pos.setY(i, h);
    }
    geo.computeVertexNormals();

    // базы сторон переводим в Vector3 (x, высота, z)
    this.base = {
      vega: new THREE.Vector3(this.base.vega.x, 0, this.base.vega.y),
      argo: new THREE.Vector3(this.base.argo.x, 0, this.base.argo.y)
    };
    this.base.vega.y = this.heightAt(this.base.vega.x, this.base.vega.z);
    this.base.argo.y = this.heightAt(this.base.argo.x, this.base.argo.z);

    const tex = this._terrainTexture();
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    this.group.add(this.terrain);

    /* --- вода --- */
    const wgeo = new THREE.PlaneGeometry(S * 1.4, S * 1.4, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    const wmat = new THREE.MeshPhongMaterial({
      color: 0x2d5566, transparent: true, opacity: 0.78, shininess: 90,
      specular: 0x88bbcc
    });
    this.water = new THREE.Mesh(wgeo, wmat);
    this.water.position.y = this.waterLevel;
    this.group.add(this.water);

    this._scatter();
    this._finalizeColliders();
  }

  _roadHeight(x, z, road) {
    // высота ближайшей точки полилинии (сглаженная)
    let best = Infinity, bi = 0;
    for (let i = 0; i < road.length; i++) {
      const d = Math.hypot(x - road[i].x, z - road[i].y);
      if (d < best) { best = d; bi = i; }
    }
    const p = road[bi];
    return this.baseHeight(p.x, p.y) * 0.55 + this.baseHeight(x, z) * 0.45;
  }

  /* ---------- текстура земли ---------- */
  _terrainTexture() {
    const RES = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = RES;
    const g = cv.getContext('2d');
    const S = this.size;
    const pal = this.cfg.palette;
    const c1 = new THREE.Color(pal.ground), c2 = new THREE.Color(pal.ground2);
    const rock = new THREE.Color(pal.rock);

    const img = g.createImageData(RES, RES);
    const d = img.data;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const x = (i / RES - 0.5) * S, z = (j / RES - 0.5) * S;
        const n = fbm(x * 0.05, z * 0.05, this.seed + 500, 3);
        const n2 = fbm(x * 0.21, z * 0.21, this.seed + 900, 2);
        let t = clamp(n * 0.85 + n2 * 0.3, 0, 1);
        const slope = this.slopeAt(x, z);
        let col = c1.clone().lerp(c2, t);
        if (slope > 0.14) col.lerp(rock, clamp((slope - 0.14) * 4.5, 0, 0.85));
        const dr = this._distToPolyline(x, z, this.river);
        if (dr < this.riverWidth * 1.15) col.lerp(new THREE.Color(0x6b6142), 0.5);
        const shade = 0.86 + n2 * 0.3;
        const k = (j * RES + i) * 4;
        d[k] = clamp(col.r * 255 * shade, 0, 255);
        d[k + 1] = clamp(col.g * 255 * shade, 0, 255);
        d[k + 2] = clamp(col.b * 255 * shade, 0, 255);
        d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // дороги рисуем поверх
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const road of this.roads) {
      g.strokeStyle = 'rgba(74,70,60,0.92)'; g.lineWidth = 11;
      this._path(g, road, RES, S); g.stroke();
      g.strokeStyle = 'rgba(96,92,80,0.6)'; g.lineWidth = 7;
      this._path(g, road, RES, S); g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    this.terrainCanvas = cv;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  _path(g, pts, RES, S) {
    g.beginPath();
    pts.forEach((p, i) => {
      const X = (p.x / S + 0.5) * RES, Y = (p.y / S + 0.5) * RES;
      i ? g.lineTo(X, Y) : g.moveTo(X, Y);
    });
  }

  /* ---------- объекты мира ---------- */
  _scatter() {
    const R = this.rng, S = this.size, half = S / 2;
    const scene = this.group;

    /* ---- постройки ---- */
    const wallTex = this._buildingTexture();
    const roofTex = this._roofTexture();
    const buildings = [];
    for (const cl of this.clusters) {
      for (let i = 0; i < cl.count; i++) {
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * cl.spread;
        const bx = cl.x + Math.cos(a) * d, bz = cl.z + Math.sin(a) * d;
        const wdt = cl.big ? 9 + R() * 13 : 7 + R() * 7;
        const dpt = cl.big ? 9 + R() * 13 : 7 + R() * 7;
        const hgt = cl.big ? 6 + R() * 20 : 4.5 + R() * 5.5;
        const rot = Math.floor(R() * 4) * (Math.PI / 2) + (R() - 0.5) * 0.18;
        buildings.push({ x: bx, z: bz, w: wdt, d: dpt, h: hgt, rot });
      }
    }
    this.buildings = buildings;

    const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
    const roofMat = new THREE.MeshLambertMaterial({ map: roofTex });
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const roofGeo = new THREE.BoxGeometry(1, 1, 1);
    for (const b of buildings) {
      const gy = this.heightAt(b.x, b.z);
      const m = new THREE.Mesh(boxGeo, wallMat);
      m.scale.set(b.w, b.h, b.d);
      m.position.set(b.x, gy + b.h / 2 - 0.35, b.z);
      m.rotation.y = b.rot;
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      // крыша
      const r = new THREE.Mesh(roofGeo, roofMat);
      r.scale.set(b.w + 0.9, 0.7, b.d + 0.9);
      r.position.set(b.x, gy + b.h - 0.1, b.z);
      r.rotation.y = b.rot;
      r.castShadow = true;
      scene.add(r);
      this.props.push(m);
      // коллайдер (AABB по огибающей — с учётом поворота)
      const c = Math.abs(Math.cos(b.rot)), s = Math.abs(Math.sin(b.rot));
      const ex = (b.w * c + b.d * s) / 2, ez = (b.w * s + b.d * c) / 2;
      this.colliders.add({
        min: new THREE.Vector3(b.x - ex, gy - 1, b.z - ez),
        max: new THREE.Vector3(b.x + ex, gy + b.h, b.z + ez),
        solid: true, blocksSight: true
      }, 'building');
      this.coverPoints.push(new THREE.Vector3(b.x + (R() - 0.5) * b.w * 2, 0, b.z + (R() - 0.5) * b.d * 2));
    }

    /* ---- деревья (InstancedMesh) ---- */
    const treeCount = Math.round(520 * this.cfg.forest);
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 5);
    trunkGeo.translate(0, 1.6, 0);
    const leafGeo = new THREE.ConeGeometry(1.9, 5.4, 6);
    leafGeo.translate(0, 5.0, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3a28 });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x3d5a2c });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treeCount);
    trunks.castShadow = leaves.castShadow = true;
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < treeCount && guard++ < treeCount * 20) {
      const x = (R() - 0.5) * S * 0.96, z = (R() - 0.5) * S * 0.96;
      if (this._nearBuilding(x, z, 5)) continue;
      if (this._distToPolyline(x, z, this.river) < this.riverWidth * 1.3) continue;
      if (this._distToPolyline(x, z, this.roads[0]) < 7) continue;
      const gy = this.heightAt(x, z);
      if (gy < this.waterLevel + 0.5) continue;
      const sc = 0.7 + R() * 0.85;
      dummy.position.set(x, gy - 0.25, z);
      dummy.rotation.set(0, R() * Math.PI * 2, (R() - 0.5) * 0.09);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      leaves.setMatrixAt(placed, dummy.matrix);
      col.setHSL(0.25 + R() * 0.07, 0.32 + R() * 0.2, 0.20 + R() * 0.13);
      leaves.setColorAt(placed, col);
      this.colliders.add({
        min: new THREE.Vector3(x - 0.42, gy - 1, z - 0.42),
        max: new THREE.Vector3(x + 0.42, gy + 3.4 * sc, z + 0.42),
        solid: true, blocksSight: false
      }, 'tree');
      placed++;
    }
    trunks.count = leaves.count = placed;
    scene.add(trunks); scene.add(leaves);
    this.props.push(trunks, leaves);

    /* ---- камни ---- */
    const rockCount = Math.round(150 * (0.5 + this.cfg.hills * 0.5));
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: this.cfg.palette.rock, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    rocks.castShadow = rocks.receiveShadow = true;
    let rp = 0; guard = 0;
    while (rp < rockCount && guard++ < rockCount * 20) {
      const x = (R() - 0.5) * S * 0.95, z = (R() - 0.5) * S * 0.95;
      if (this._nearBuilding(x, z, 4)) continue;
      const gy = this.heightAt(x, z);
      if (gy < this.waterLevel) continue;
      const sc = 0.7 + R() * 2.4;
      dummy.position.set(x, gy + sc * 0.28, z);
      dummy.rotation.set(R() * 6, R() * 6, R() * 6);
      dummy.scale.set(sc * (0.8 + R() * 0.6), sc * (0.55 + R() * 0.4), sc * (0.8 + R() * 0.6));
      dummy.updateMatrix();
      rocks.setMatrixAt(rp, dummy.matrix);
      this.colliders.add({
        min: new THREE.Vector3(x - sc, gy - 0.5, z - sc),
        max: new THREE.Vector3(x + sc, gy + sc * 0.8, z + sc),
        solid: true, blocksSight: sc > 1.6
      }, 'rock');
      rp++;
    }
    rocks.count = rp;
    scene.add(rocks);
    this.props.push(rocks);

    /* ---- ящики / бочки / мешки (укрытия) ---- */
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x6b5637 });
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x4d5a3a });
    const sandMat = new THREE.MeshLambertMaterial({ color: 0x7d6b4a });
    const crateGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.2, 10);
    const sandGeo = new THREE.BoxGeometry(2.6, 0.85, 0.9);
    const crateInst = new THREE.InstancedMesh(crateGeo, crateMat, 130);
    const barrelInst = new THREE.InstancedMesh(barrelGeo, barrelMat, 110);
    const sandInst = new THREE.InstancedMesh(sandGeo, sandMat, 170);
    crateInst.castShadow = barrelInst.castShadow = sandInst.castShadow = true;
    crateInst.receiveShadow = barrelInst.receiveShadow = sandInst.receiveShadow = true;
    const add = (inst, idx, x, z, h, rotY, sx = 1, sy = 1, sz = 1) => {
      const gy = this.heightAt(x, z);
      dummy.position.set(x, gy + h * sy / 2, z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      inst.setMatrixAt(idx, dummy.matrix);
      this.colliders.add({
        min: new THREE.Vector3(x - sx * 0.8, gy - 0.3, z - sz * 0.8),
        max: new THREE.Vector3(x + sx * 0.8, gy + h * sy + 0.2, z + sz * 0.8),
        solid: true, blocksSight: h * sy > 1.4
      }, 'prop');
      this.coverPoints.push(new THREE.Vector3(x + (R() - 0.5) * 6, 0, z + (R() - 0.5) * 6));
    };
    let ci = 0, bi = 0, si = 0;
    for (let i = 0; i < 420 && (ci < 130 || bi < 110 || si < 170); i++) {
      const x = (R() - 0.5) * S * 0.92, z = (R() - 0.5) * S * 0.92;
      if (this._distToPolyline(x, z, this.river) < this.riverWidth) continue;
      const gy = this.heightAt(x, z);
      if (gy < this.waterLevel + 0.4) continue;
      const near = this._nearBuilding(x, z, 30);
      const roll = R();
      const rotY = R() * Math.PI * 2;
      if (roll < 0.33 && ci < 130) {
        const st = R() > 0.6 ? 2 : 1;
        add(crateInst, ci++, x, z, 1.5, rotY, 1, st, 1);
        if (st === 2) add(crateInst, ci < 130 ? ci++ : ci, x + 0.2, z + 0.15, 1.5, rotY, 1, 1, 1);
      } else if (roll < 0.58 && bi < 110) {
        add(barrelInst, bi++, x, z, 1.2, rotY);
      } else if (si < 170 && (near || R() > 0.55)) {
        add(sandInst, si++, x, z, 0.85, rotY);
      }
    }
    crateInst.count = ci; barrelInst.count = bi; sandInst.count = si;
    scene.add(crateInst, barrelInst, sandInst);
    this.props.push(crateInst, barrelInst, sandInst);

    /* ---- радиовышка на центральной точке ---- */
    this._buildTower(this.objectives[0].pos);

    /* ---- мост через реку ---- */
    this._buildBridge();

    /* ---- места спавна техники ---- */
    const vSpots = ['bulat_mb', 'kolchuga', 'rys', 'zmey'];
    const spotCoords = [
      [-S * 0.34, S * 0.06], [S * 0.32, -S * 0.08], [-S * 0.05, -S * 0.33],
      [S * 0.06, S * 0.34], [-S * 0.22, -S * 0.18], [S * 0.22, S * 0.2]
    ];
    spotCoords.forEach((c, i) => {
      const gy = this.heightAt(c[0], c[1]);
      this.vehiclesSpots.push({
        type: vSpots[i % vSpots.length],
        pos: new THREE.Vector3(c[0], gy, c[1]),
        respawn: 45
      });
    });

    // переносим точки/спавны/технику на сушу
    this._fixWetSpots();

    // база-лагерь
    this._buildCamp('vega');
    this._buildCamp('argo');

    // техника и спавны не должны оказываться в деревьях/камнях/ящиках
    this._clearSpots();
  }

  /*
    Ищем свободную площадку: без коллайдеров, вне зданий, с малым уклоном.
    Без этого танк/БТР появляется в лесу и намертво встаёт.
  */
  _clearSpots() {
    const lim = this.size / 2 - 14;
    const ok = (x, z, r) => {
      if (this.heightAt(x, z) < this.waterLevel + 0.8) return false;
      if (this.slopeAt(x, z) > 0.34) return false;
      if (this._nearBuilding(x, z, 5)) return false;
      const hits = this.colliders.query(x, z, r);
      return !hits || hits.length === 0;
    };
    const find = (x, z, maxR) => {
      if (ok(x, z, 7)) return { x, z };
      for (let r = 6; r <= maxR; r += 5) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
          if (Math.abs(nx) > lim || Math.abs(nz) > lim) continue;
          if (ok(nx, nz, 7)) return { x: nx, z: nz };
        }
      }
      return { x, z };
    };
    for (const s of this.vehiclesSpots) {
      const d = find(s.pos.x, s.pos.z, 80);
      s.pos.set(d.x, this.heightAt(d.x, d.z), d.z);
    }
    for (const f of ['vega', 'argo']) {
      for (const p of this.spawn[f]) {
        const d = find(p.x, p.z, 45);
        p.set(d.x, this.heightAt(d.x, d.z), d.z);
      }
    }
  }

  /* ищем сухую ровную площадку рядом с точкой */
  _findDrySpot(x, z, maxR = 70, clearance = 1.2) {
    const lim = this.size / 2 - 12;
    if (this.heightAt(x, z) > this.waterLevel + clearance) return { x, z };
    for (let r = 6; r <= maxR; r += 5) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
        const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
        if (Math.abs(nx) > lim || Math.abs(nz) > lim) continue;
        if (this.heightAt(nx, nz) > this.waterLevel + clearance) return { x: nx, z: nz };
      }
    }
    return { x, z };
  }

  /* переносим всё важное (точки, спавны, технику) на сушу */
  _fixWetSpots() {
    for (const o of this.objectives) {
      const d = this._findDrySpot(o.pos.x, o.pos.z, 80);
      o.pos.set(d.x, this.heightAt(d.x, d.z), d.z);
    }
    for (const f of ['vega', 'argo']) {
      for (const p of this.spawn[f]) {
        // ВАЖНО: p.y после _layout() равен 0, поэтому высоту берём по факту
        const y = this.heightAt(p.x, p.z);
        if (y < this.waterLevel + 0.6) {
          const d = this._findDrySpot(p.x, p.z, 45, 0.8);
          p.set(d.x, this.heightAt(d.x, d.z), d.z);
        } else {
          p.y = y;
        }
      }
      const b = this._findDrySpot(this.base[f].x, this.base[f].z, 90);
      this.base[f].set(b.x, this.heightAt(b.x, b.z), b.z);
    }
    for (const s of this.vehiclesSpots) {
      const d = this._findDrySpot(s.pos.x, s.pos.z, 60);
      s.pos.set(d.x, this.heightAt(d.x, d.z), d.z);
    }
  }

  _nearBuilding(x, z, pad) {
    for (const b of this.buildings || []) {
      if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return true;
    }
    return false;
  }

  _buildTower(p) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x8a8f94 });
    const red = new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0x661111 });
    const h = 30;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, h, 5), mat);
      leg.position.set(Math.cos(a) * 2.4, h / 2, Math.sin(a) * 2.4);
      leg.castShadow = true;
      g.add(leg);
    }
    for (let i = 0; i < 6; i++) {
      const y = 3 + i * 4.6;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.12, 4, 4), mat);
      ring.rotation.x = Math.PI / 2; ring.rotation.z = Math.PI / 4;
      ring.position.y = y;
      g.add(ring);
    }
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.7, 6, 6), mat);
    top.position.y = h + 3; g.add(top);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), red);
    beacon.position.y = h + 6.4; g.add(beacon);
    this.beacon = beacon;
    g.position.set(p.x, this.heightAt(p.x, p.z), p.z);
    this.group.add(g);
    this.colliders.add({
      min: new THREE.Vector3(p.x - 2.6, p.y - 1, p.z - 2.6),
      max: new THREE.Vector3(p.x + 2.6, p.y + h, p.z + 2.6),
      solid: true, blocksSight: true
    }, 'tower');
    this.coverPoints.push(new THREE.Vector3(p.x + 12, 0, p.z + 12));
  }

  _buildBridge() {
    // ищем пересечение дороги и реки
    const road = this.roads[0];
    let best = null, bd = 1e9;
    for (let i = 0; i < road.length - 1; i++) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = lerp(road[i].x, road[i + 1].x, t);
        const z = lerp(road[i].y, road[i + 1].y, t);
        const d = this._distToPolyline(x, z, this.river);
        if (d < bd) { bd = d; best = { x, z }; }
      }
    }
    if (!best || bd > 12) return;
    const len = this.riverWidth * 2.6;
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(9, 0.6, len),
      new THREE.MeshLambertMaterial({ color: 0x5b5a55 })
    );
    const y = this.waterLevel + 1.5;
    deck.position.set(best.x, y, best.z);
    deck.receiveShadow = deck.castShadow = true;
    this.group.add(deck);
    this.props.push(deck);
    const railMat = new THREE.MeshLambertMaterial({ color: 0x3f464c });
    for (const sx of [-4.3, 4.3]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, len), railMat);
      rail.position.set(best.x + sx, y + 0.8, best.z);
      rail.castShadow = true;
      this.group.add(rail);
    }
    this.bridge = new THREE.Vector3(best.x, y + 0.3, best.z);
    this.coverPoints.push(new THREE.Vector3(best.x, 0, best.z));
  }

  _buildCamp(fac) {
    const p = this.base[fac];
    const color = fac === 'vega' ? 0x1c4a63 : 0x5c4321;
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const tx = p.x + Math.cos(a) * 12, tz = p.z + Math.sin(a) * 12;
      const tent = new THREE.Mesh(
        new THREE.ConeGeometry(3.6, 3.2, 4),
        new THREE.MeshLambertMaterial({ color })
      );
      tent.position.set(tx, this.heightAt(tx, tz) + 1.6, tz);
      tent.rotation.y = Math.PI / 4;
      tent.castShadow = true;
      g.add(tent);
    }
    const flag = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 9, 6),
      new THREE.MeshLambertMaterial({ color: 0x9aa0a6 })
    );
    flag.position.set(p.x, p.y + 4.5, p.z);
    g.add(flag);
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 2.4),
      new THREE.MeshBasicMaterial({ color: fac === 'vega' ? 0x38bdf8 : 0xf0a93b, side: THREE.DoubleSide })
    );
    cloth.position.set(p.x + 2, p.y + 7.6, p.z);
    g.add(cloth);
    this.group.add(g);
  }

  _buildingTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#8d8577'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${60 + Math.random() * 90 | 0},${56 + Math.random() * 80 | 0},${48 + Math.random() * 70 | 0},${Math.random() * 0.35})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 2 + Math.random() * 5);
    }
    // окна
    for (let y = 26; y < 240; y += 56) {
      for (let x = 20; x < 230; x += 46) {
        const lit = Math.random() > 0.72;
        g.fillStyle = lit ? '#ffd88a' : '#22262b';
        g.fillRect(x, y, 24, 30);
        g.strokeStyle = '#4a4438'; g.lineWidth = 2.5;
        g.strokeRect(x, y, 24, 30);
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  _roofTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#4b4238'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 14) {
      g.fillStyle = `rgba(0,0,0,${0.16 + Math.random() * 0.12})`;
      g.fillRect(0, y, 128, 7);
    }
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(${Math.random() * 60 | 0},${Math.random() * 50 | 0},${Math.random() * 40 | 0},${Math.random() * 0.4})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _finalizeColliders() {
    // границы карты
    const S = this.size / 2 + 6, h = 200;
    const B = (min, max) => this.colliders.add({
      min: new THREE.Vector3(...min), max: new THREE.Vector3(...max), solid: true, blocksSight: false
    }, 'bound');
    B([-S - 40, -5, -S - 40], [-S, h, S + 40]);
    B([S, -5, -S - 40], [S + 40, h, S + 40]);
    B([-S - 40, -5, -S - 40], [S + 40, h, -S]);
    B([-S - 40, -5, S], [S + 40, h, S + 40]);
  }

  /* есть ли прямая видимость (для ботов и трассеров) */
  hasLineOfSight(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const dist = d.length();
    if (dist < 0.01) return true;
    d.divideScalar(dist);
    const hit = this.colliders.raycast(a, d, dist);
    if (!hit) return true;
    // дерево не блокирует видимость
    return hit.dist >= dist - 0.5;
  }

  /* случайная наземная точка */
  randomGroundPoint(rng = Math.random, awayFrom = null, minDist = 0) {
    for (let i = 0; i < 40; i++) {
      const x = (rng() - 0.5) * this.size * 0.9;
      const z = (rng() - 0.5) * this.size * 0.9;
      if (awayFrom && minDist && Math.hypot(x - awayFrom.x, z - awayFrom.z) < minDist) continue;
      const y = this.heightAt(x, z);
      if (y < this.waterLevel + 0.6) continue;
      if (this._nearBuilding(x, z, 2.5)) continue;
      return new THREE.Vector3(x, y, z);
    }
    return new THREE.Vector3((rng() - 0.5) * 20, this.heightAt(0, 0), (rng() - 0.5) * 20);
  }

  /* поиск укрытия рядом с точкой, с видом на цель */
  findCoverNear(origin, target, radius = 26) {
    let best = null, bestScore = -Infinity;
    for (const cp of this.coverPoints) {
      const d = cp.distanceTo(origin);
      if (d > radius) continue;
      const p = new THREE.Vector3(cp.x, this.heightAt(cp.x, cp.z), cp.z);
      const toT = p.distanceTo(target);
      if (toT < 6) continue;
      const los = this.hasLineOfSight(
        new THREE.Vector3(p.x, p.y + 1.5, p.z),
        new THREE.Vector3(target.x, target.y + 1.5, target.z)
      );
      const score = (los ? 40 : 0) + (radius - d) * 0.6 + (60 - Math.min(toT, 60)) * 0.3 + Math.random() * 10;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best || this.randomGroundPoint(Math.random, origin, 4);
  }
}
