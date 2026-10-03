import * as THREE from 'three';

/* ============================================================
   ПРОЦЕДУРНЫЕ МОДЕЛИ (без внешних ассетов)
   ============================================================ */

const M = {
  skin: 0xc99a76,
  cloth: 0x4a5540,
  cloth2: 0x3a4432,
  metal: 0x3d444b,
  metalDark: 0x25292e,
  rubber: 0x1b1d20,
  glass: 0x9fd7e8,
  wood: 0x5c4526
};

export function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

/* ---------- СОЛДАТ (вид от 3-го лица / боты / другие игроки) ---------- */
export function makeSoldier(factionColor, isEnemy = false) {
  const g = new THREE.Group();
  const uni = isEnemy ? 0x55503c : 0x414c39;
  const bodyMat = mat(uni);
  const limbMat = mat(0x37402f);
  const bootMat = mat(0x22262a);
  const gearMat = mat(0x2c3128);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.34), bodyMat);
  torso.position.y = 1.16; torso.castShadow = true;
  g.add(torso);

  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.46, 0.42), gearMat);
  vest.position.y = 1.24; vest.castShadow = true;
  g.add(vest);

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.32), limbMat);
  hips.position.y = 0.74; g.add(hips);

  // голова + шлем
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.12, 6), mat(M.skin));
  neck.position.y = 1.58; g.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), mat(M.skin));
  head.position.y = 1.76; head.castShadow = true; head.name = 'head';
  g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62), gearMat);
  helmet.position.y = 1.83; helmet.castShadow = true; helmet.name = 'head';
  g.add(helmet);
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.06), mat(0x111417));
  goggles.position.set(0, 1.79, 0.15); goggles.name = 'head';
  g.add(goggles);

  // конечности
  const mkLimb = (w, h, d, x, y) => {
    const p = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), limbMat);
    m.position.y = -h / 2; m.castShadow = true;
    p.add(m);
    p.position.set(x, y, 0);
    return p;
  };
  const armL = mkLimb(0.16, 0.62, 0.16, -0.36, 1.44);
  const armR = mkLimb(0.16, 0.62, 0.16, 0.36, 1.44);
  const legL = mkLimb(0.19, 0.74, 0.2, -0.15, 0.72);
  const legR = mkLimb(0.19, 0.74, 0.2, 0.15, 0.72);
  g.add(armL, armR, legL, legR);

  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.3), bootMat);
  bootL.position.set(0, -0.74, 0.05); legL.add(bootL);
  const bootR = bootL.clone(); legR.add(bootR);

  // оружие в руках
  const gun = new THREE.Group();
  const gb = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), mat(M.metal));
  gun.add(gb);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.4, 6), mat(M.metalDark));
  barrel.rotation.x = Math.PI / 2; barrel.position.z = -0.44;
  gun.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.11), mat(M.metalDark));
  mag.position.set(0, -0.17, -0.04); mag.rotation.x = -0.2;
  gun.add(mag);
  gun.position.set(0.24, 1.16, -0.32);
  gun.rotation.set(0, 0.05, 0);
  g.add(gun);

  // рюкзак
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.2), gearMat);
  pack.position.set(0, 1.2, 0.26); pack.castShadow = true;
  g.add(pack);

  // маркер команды (полоска на плече)
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.07, 0.36),
    new THREE.MeshBasicMaterial({ color: factionColor })
  );
  band.position.y = 1.48;
  g.add(band);

  // подсветка имени/команды над головой
  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.06),
    new THREE.MeshBasicMaterial({ color: factionColor, transparent: true, opacity: 0.85, depthTest: false })
  );
  marker.position.y = 2.28;
  marker.renderOrder = 999;
  g.add(marker);

  g.userData.parts = { armL, armR, legL, legR, head, gun, torso, marker, band };
  g.userData.height = 1.95;
  return g;
}

/* ---------- ВЬЮМОДЕЛЬ ОРУЖИЯ (от 1-го лица) ---------- */
export function makeViewModel(weapon) {
  const g = new THREE.Group();
  const bodyCol = weapon.color ?? 0x2b3a46;
  const accCol = weapon.accent ?? 0x38bdf8;
  const bMat = mat(bodyCol);
  const dMat = mat(0x1d2126);
  const aMat = new THREE.MeshLambertMaterial({ color: accCol, emissive: accCol, emissiveIntensity: 0.25 });

  const id = weapon.id;
  const isPistol = weapon.kind === 'secondary' && id !== 'vektr';

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, isPistol ? 0.2 : 0.5), bMat);
  body.position.z = isPistol ? -0.06 : -0.2;
  g.add(body);

  const barrelLen = id === 'sokol' ? 0.52 : id === 'groza' ? 0.4 : id === 'kuvalda' ? 0.34 : id === 'shershen' ? 0.62 : isPistol ? 0.1 : 0.3;
  const barrelR = id === 'kuvalda' ? 0.028 : id === 'shershen' ? 0.05 : 0.019;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(barrelR, barrelR, barrelLen, 8), dMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -(isPistol ? 0.18 : 0.42 + barrelLen / 2 - 0.2));
  g.add(barrel);
  g.userData.muzzle = new THREE.Object3D();
  g.userData.muzzle.position.copy(barrel.position);
  g.userData.muzzle.position.z -= barrelLen / 2 + 0.03;
  g.add(g.userData.muzzle);

  if (!isPistol) {
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.075, barrelLen * 0.85), bMat);
    handguard.position.set(0, 0.004, barrel.position.z + barrelLen * 0.05);
    g.add(handguard);
    for (let i = 0; i < 5; i++) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.008, 0.03), dMat);
      rail.position.set(0, 0.045, -0.3 - i * 0.055);
      g.add(rail);
    }
  }

  // рукоять
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, isPistol ? 0.16 : 0.13, 0.06), dMat);
  grip.position.set(0, isPistol ? -0.12 : -0.1, isPistol ? 0.02 : -0.06);
  grip.rotation.x = isPistol ? 0.12 : 0.28;
  g.add(grip);

  if (!isPistol) {
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, id === 'groza' ? 0.2 : 0.17, 0.09),
      dMat
    );
    mag.position.set(0, -0.13, -0.16);
    mag.rotation.x = -0.22;
    g.add(mag);
    g.userData.mag = mag;

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.085, id === 'sokol' ? 0.28 : 0.2), bMat);
    stock.position.set(0, -0.015, 0.1);
    g.add(stock);
  }

  // прицел
  if (weapon.scope || id === 'sokol') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.22, 10), dMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.075, -0.16);
    g.add(scope);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.029, 12), new THREE.MeshBasicMaterial({ color: 0x66ddff }));
    lens.position.set(0, 0.075, -0.05);
    lens.rotation.y = Math.PI;
    g.add(lens);
  } else {
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.032, 0.02), aMat);
    sight.position.set(0, 0.068, -0.3);
    g.add(sight);
    const rear = sight.clone();
    rear.position.z = -0.02;
    g.add(rear);
  }

  if (id === 'shershen') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.9, 10), mat(0x3a3d2a));
    tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.02, -0.25);
    g.add(tube);
    const war = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 8), mat(0x6a5a2a));
    war.rotation.x = -Math.PI / 2; war.position.set(0, 0.02, -0.78);
    g.add(war);
  }
  if (id === 'kuvalda') {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.14), mat(M.wood));
    pump.position.set(0, -0.03, -0.32);
    g.add(pump);
  }

  // руки
  const skinMat = mat(0xc69a78);
  const gloveMat = mat(0x2a2e26);
  const mkHand = (x, z) => {
    const h = new THREE.Group();
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.22), mat(0x3d4635));
    fore.position.z = 0.1;
    h.add(fore);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.1), gloveMat);
    h.add(hand);
    h.position.set(x, -0.09, z);
    return h;
  };
  const handR = mkHand(0.055, -0.02);
  const handL = mkHand(-0.05, isPistol ? -0.1 : -0.3);
  g.add(handR, handL);
  g.userData.hands = { handR, handL };

  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  g.userData.baseScale = 1;
  return g;
}

/* ---------- ТЕХНИКА ---------- */
export function makeVehicle(type, factionColor) {
  const g = new THREE.Group();
  const hull = factionColor === 0x38bdf8 ? 0x3f4a3a : 0x4d4a35;
  const hMat = mat(hull);
  const dMat = mat(0x22262a);
  const tMat = mat(0x15171a);

  if (type === 'bulat_mb') {
    // танк
    const lower = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.7, 6.4), hMat);
    lower.position.y = 0.75; lower.castShadow = true; g.add(lower);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.55, 5.6), hMat);
    upper.position.y = 1.28; upper.castShadow = true; g.add(upper);
    for (const sx of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 6.6), tMat);
      track.position.set(sx * 1.65, 0.45, 0); track.castShadow = true;
      g.add(track);
      for (let i = 0; i < 6; i++) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.4, 10), mat(0x33383d));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx * 1.65, 0.38, -2.5 + i * 1.0);
        g.add(wheel);
      }
    }
    const turret = new THREE.Group();
    const tb = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.75, 2.9), hMat);
    tb.castShadow = true; turret.add(tb);
    const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.5), hMat);
    mantlet.position.set(0, -0.05, -1.5); turret.add(mantlet);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 4.6, 10), mat(0x2f3438));
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, -0.05, -3.8);
    turret.add(barrel);
    turret.position.y = 1.9;
    g.add(turret);
    g.userData.turret = turret;
    g.userData.muzzle = new THREE.Object3D();
    g.userData.muzzle.position.set(0, 1.85, -6.2);
    g.add(g.userData.muzzle);
    g.userData.mgMuzzle = new THREE.Object3D();
    g.userData.mgMuzzle.position.set(0.5, 2.35, -1.9);
    g.add(g.userData.mgMuzzle);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 10), mat(0x33383c));
    hatch.position.set(0.55, 2.32, 0.5); g.add(hatch);

  } else if (type === 'kolchuga' || type === 'zmey') {
    const wheeled = type === 'kolchuga';
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.3, wheeled ? 6.2 : 6.0), hMat);
    body.position.y = wheeled ? 1.25 : 1.0; body.castShadow = true;
    g.add(body);
    const slopeF = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.16, 1.5), hMat);
    slopeF.position.set(0, wheeled ? 1.05 : 0.85, -3.3);
    slopeF.rotation.x = -0.62;
    g.add(slopeF);
    if (wheeled) {
      for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.42, 12), tMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(sx * 1.35, 0.62, -2.2 + i * 1.48);
        w.castShadow = true;
        g.add(w);
      }
    } else {
      for (const sx of [-1, 1]) {
        const tr = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 6.4), tMat);
        tr.position.set(sx * 1.35, 0.42, 0); g.add(tr);
        for (let i = 0; i < 6; i++) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.34, 8), mat(0x33383d));
          w.rotation.z = Math.PI / 2;
          w.position.set(sx * 1.35, 0.34, -2.4 + i * 0.96);
          g.add(w);
        }
      }
    }
    const turret = new THREE.Group();
    const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.62, 10), hMat);
    tb.castShadow = true; turret.add(tb);
    const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 2.6, 8), mat(0x2f3438));
    cannon.rotation.x = Math.PI / 2; cannon.position.set(0.28, 0, -1.6);
    turret.add(cannon);
    const mg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 6), mat(0x2f3438));
    mg.rotation.x = Math.PI / 2; mg.position.set(-0.4, 0.18, -1.0);
    turret.add(mg);
    turret.position.y = wheeled ? 2.2 : 1.95;
    g.add(turret);
    g.userData.turret = turret;
    g.userData.muzzle = new THREE.Object3D();
    g.userData.muzzle.position.set(0.28, turret.position.y, -3.0);
    g.add(g.userData.muzzle);
    g.userData.mgMuzzle = new THREE.Object3D();
    g.userData.mgMuzzle.position.set(-0.4, turret.position.y + 0.18, -1.6);
    g.add(g.userData.mgMuzzle);

  } else {
    // багги
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.2, 3.4), mat(0x2e3129));
    floor.position.y = 0.75; floor.castShadow = true; g.add(floor);
    const cage = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.06, 4, 4), mat(0x22262a));
    cage.rotation.x = Math.PI / 2; cage.position.y = 1.6; g.add(cage);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.6, 6), mat(0x22262a));
      bar.position.set(Math.cos(a) * 0.85, 1.15, Math.sin(a) * 1.4);
      g.add(bar);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.16), mat(0x1b1d20));
    seat.position.set(0, 1.15, 0.5); g.add(seat);
    for (const sx of [-1, 1]) for (const sz of [-1.15, 1.15]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.45, 12), tMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * 1.0, 0.55, sz);
      w.castShadow = true;
      g.add(w);
    }
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.1), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    light.position.set(0, 0.95, -1.75); g.add(light);
  }

  // маркер команды
  const band = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.22),
    new THREE.MeshBasicMaterial({ color: factionColor, side: THREE.DoubleSide })
  );
  band.position.set(0, 2.9, 0);
  g.add(band);
  g.userData.band = band;
  g.userData.type = type;
  return g;
}

/* ---------- ФПВ-ДРОН ---------- */
export function makeDrone(factionColor, heavy = false) {
  const g = new THREE.Group();
  const frameCol = heavy ? 0x4a3a24 : 0x262a2e;
  const frameMat = mat(frameCol);
  const armLen = heavy ? 0.34 : 0.26;

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.24), frameMat);
  g.add(body);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), mat(0x111418));
  canopy.position.set(0, 0.035, -0.06); g.add(canopy);

  const props = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * armLen, z = Math.sin(a) * armLen;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.022, armLen * 1.5), frameMat);
    arm.position.set(x * 0.5, 0, z * 0.5);
    arm.rotation.y = -a;
    g.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.045, 8), mat(0x8a8f94));
    motor.position.set(x, 0.02, z);
    g.add(motor);
    const prop = new THREE.Mesh(
      new THREE.BoxGeometry(heavy ? 0.26 : 0.2, 0.004, 0.018),
      new THREE.MeshBasicMaterial({ color: 0xbfc7cc, transparent: true, opacity: 0.42 })
    );
    prop.position.set(x, 0.05, z);
    g.add(prop);
    props.push(prop);
  }
  // БЧ
  const warhead = new THREE.Mesh(
    new THREE.ConeGeometry(heavy ? 0.09 : 0.06, heavy ? 0.3 : 0.22, 8),
    mat(0x8a6a2a)
  );
  warhead.rotation.x = Math.PI / 2;
  warhead.position.set(0, -0.09, -0.16);
  g.add(warhead);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5),
    new THREE.MeshBasicMaterial({ color: factionColor }));
  led.position.set(0, -0.03, 0.12);
  g.add(led);

  g.userData.props = props;
  g.userData.warhead = warhead;
  return g;
}

/* ---------- ЭФФЕКТЫ: дым, взрыв ---------- */
export function makeSmokeParticleTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  return t;
}

export function makeSparkTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.3, 'rgba(255,200,110,0.85)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(cv);
}
