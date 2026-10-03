/* ============================================================
   HUD — боевой интерфейс
   ============================================================ */
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      root: $('hud'),
      hp: $('hpFill'), hpNum: $('hpNum'), ar: $('arFill'), arNum: $('arNum'),
      ammoMag: $('ammoMag'), ammoRes: $('ammoRes'), wpnName: $('wpnName'), wpnMode: $('wpnMode'),
      slots: $('wpnSlots'), gadgets: $('mlGadgets'),
      minimap: $('minimap'), compass: $('compassCanvas'),
      killfeed: $('killfeed'), hitmarker: $('hitmarker'), crosshair: $('crosshair'),
      dmgDir: $('dmgDir'), interact: $('interactPrompt'),
      objText: $('objText'), clock: $('matchClock'),
      scoreVega: $('scoreVega'), scoreArgo: $('scoreArgo'), scoreStrip: $('scoreStrip'), ssMode: $('ssMode'),
      stance: $('stanceTag'),
      droneHud: $('droneHud'), drBat: $('drBat'), drSig: $('drSig'), drAmmo: $('drAmmo'), drAlt: $('drAlt'),
      vehicleHud: $('vehicleHud'), vhSpeed: $('vhSpeed'), vhHp: $('vhHp'), vhName: $('vhName'),
      wave: $('waveBanner'), toast: $('hintToast'),
      scoreboard: $('scoreboard'), sbVega: $('sbVega'), sbArgo: $('sbArgo'),
      sbMode: $('sbMode'), sbMap: $('sbMap'), sbClock: $('sbClock'),
      mapLabel: $('mapLabel'), fps: null
    };
    this.mctx = this.el.minimap.getContext('2d');
    this.cctx = this.el.compass.getContext('2d');
    this._shake = 0;
    this._shakeT = 0;
    this._gap = 7;
    this._lastClock = '';
    this._kfTimers = [];
    this.mapScale = 1;
    this.game = null;
  }

  bind(game) { this.game = game; }

  setMode(modeName, mapName) {
    this.el.ssMode.textContent = modeName;
    this.el.sbMode.textContent = modeName;
    this.el.sbMap.textContent = mapName;
    this.el.mapLabel.textContent = mapName;
    this.el.scoreStrip.classList.add('on');
  }

  /* ---------- витальные ---------- */
  updateVitals(hp, armor) {
    this.el.hp.style.width = Math.max(0, hp) + '%';
    this.el.hpNum.textContent = Math.max(0, Math.round(hp));
    this.el.ar.style.width = Math.max(0, armor) + '%';
    this.el.arNum.textContent = Math.max(0, Math.round(armor));
  }

  updateAmmo(weapon) {
    if (!weapon) {
      this.el.wpnName.textContent = '—';
      this.el.ammoMag.textContent = '0';
      this.el.ammoRes.textContent = '0';
      return;
    }
    this.el.wpnName.textContent = weapon.def.name;
    this.el.ammoMag.textContent = weapon.mag;
    this.el.ammoRes.textContent = weapon.reserve;
    this.el.wpnMode.textContent = weapon.def.auto ? 'AUTO' : 'SEMI';
    const low = weapon.mag === 0;
    this.el.ammoMag.style.color = low ? '#ff4d57' : '#fff';
  }

  updateSlots(actor) {
    const el = this.el.slots;
    if (!actor) { el.innerHTML = ''; return; }
    let html = '';
    actor.slots.forEach((s, i) => {
      if (!s) return;
      html += `<div class="wslot ${i === actor.slot ? 'on' : ''}">${i + 1} ${s.def.name.split('«')[1]?.replace('»', '') || s.def.name}</div>`;
    });
    el.innerHTML = html;
  }

  updateGadgets(list) {
    const el = this.el.gadgets;
    if (!el) return;
    el.innerHTML = (list || []).map((g, i) =>
      `<span class="chip">${['Q', 'F', 'X'][i] || '·'} ${g.def.name.split('«')[1]?.replace('»', '') || g.def.name} ×${g.count}</span>`
    ).join('');
  }

  setStance(s) { this.el.stance.textContent = s; }

  /* ---------- прицел ---------- */
  setCrosshairGap(px, ads) {
    this._gap = px;
    this.el.crosshair.style.setProperty('--gap', px + 'px');
    this.el.crosshair.classList.toggle('ads', !!ads);
  }

  hitmarker(kill = false, head = false) {
    const el = this.el.hitmarker;
    el.classList.remove('show', 'kill');
    void el.offsetWidth;
    el.classList.add('show');
    if (kill || head) el.classList.add('kill');
  }

  shake(amount) {
    this._shake = Math.min(2.4, this._shake + amount);
  }
  getShake() {
    const v = this._shake;
    this._shake *= 0.86;
    if (this._shake < 0.01) this._shake = 0;
    return v;
  }

  /* ---------- урон по направлениям ---------- */
  damage(dirVec) {
    const el = this.el.dmgDir;
    const d = document.createElement('div');
    d.className = 'dd';
    const ang = Math.atan2(dirVec.x, dirVec.z) * 180 / Math.PI + 180;
    d.style.setProperty('--a', ang + 'deg');
    el.appendChild(d);
    requestAnimationFrame(() => d.classList.add('on'));
    setTimeout(() => d.remove(), 1000);
    const flash = $('dmgflash');
    if (flash) { flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 90); }
  }

  /* ---------- киллфид ---------- */
  killfeed(e) {
    const el = this.el.killfeed;
    const div = document.createElement('div');
    div.className = 'kf ' + (e.kf || 'vega');
    const icons = { headshot: '✦', gun: '»', explosive: '✸', frag: '✸', vehicle: '⬢',
      drone: '✈', mine: '✸', shell: '✸', fall: '▼', unknown: '•' };
    div.innerHTML = `<span class="k-killer ${e.meKiller ? 'me' : ''}">${esc(e.killer)}</span>` +
      `<span class="k-ico">${icons[e.cause] || '»'}</span>` +
      `<span class="k-vic ${e.meVictim ? 'me' : ''}">${esc(e.victim)}</span>`;
    el.appendChild(div);
    while (el.children.length > 6) el.removeChild(el.firstChild);
    setTimeout(() => {
      div.classList.add('out');
      setTimeout(() => div.remove(), 420);
    }, 6000);
  }

  /* ---------- уведомления ---------- */
  toast(text, ms = 1800) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('on'), ms);
  }

  objective(text) {
    this.el.objText.textContent = text;
    this.el.objText.parentElement.style.animation = 'none';
    void this.el.objText.offsetWidth;
    this.el.objText.parentElement.style.animation = 'scrIn .35s';
  }

  wave(big, small) {
    const el = this.el.wave;
    el.innerHTML = `<b>${esc(big)}</b><span>${esc(small || '')}</span>`;
    el.classList.add('on');
    clearTimeout(this._waveT);
    this._waveT = setTimeout(() => el.classList.remove('on'), 2600);
  }

  interact(text) {
    const el = this.el.interact;
    if (!text) { el.classList.remove('on'); return; }
    el.innerHTML = `<kbd>E</kbd> ${esc(text)}`;
    el.classList.add('on');
  }

  setFps(v) {
    if (!this.el.fps) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:50%;top:2px;transform:translateX(-50%);font-family:var(--f-mono);font-size:10px;letter-spacing:.14em;color:#54636f';
      this.el.root.appendChild(d);
      this.el.fps = d;
    }
    this.el.fps.textContent = v + ' FPS';
  }

  /* ---------- транспорт / дрон ---------- */
  setVehicle(v) {
    this.el.vehicleHud.classList.toggle('on', !!v);
    if (v) this.el.vhName.textContent = (v.def?.name) || '';
  }
  setVehicleStats(v) {
    if (!v) return;
    this.el.vhSpeed.textContent = Math.round(Math.abs(v.speed) * 3.6);
    this.el.vhHp.style.width = Math.max(0, (v.hp / v.maxHp) * 100) + '%';
  }
  setDrone(on) { this.el.droneHud.classList.toggle('on', !!on); }
  setDroneStats(bat, sig, ammo, alt) {
    this.el.drBat.textContent = Math.max(0, Math.round(bat * 100)) + '%';
    this.el.drSig.textContent = Math.round(sig * 100) + '%';
    this.el.drAmmo.textContent = ammo;
    this.el.drAlt.textContent = Math.round(alt) + 'м';
  }

  onDeath(killerName) {
    this.wave('ВЫ УНИЧТОЖЕНЫ', killerName ? 'ЛИКВИДАТОР: ' + killerName : '');
  }
  onRespawn() { this.toast('ВОЗРОЖДЕНИЕ'); }
  setRespawn(n) {
    if (n > 0) this.el.wave.innerHTML = `<b>${n}</b><span>ВОЗРОЖДЕНИЕ</span>`, this.el.wave.classList.add('on');
    else this.el.wave.classList.remove('on');
  }

  /* ---------- табло ---------- */
  showScoreboard(rows, clock) {
    const el = this.el.scoreboard;
    el.classList.remove('hidden');
    this.el.sbClock.textContent = clock;
    const render = (list, ulId) => {
      const ul = $(ulId);
      ul.innerHTML = list.map(r => `
        <li class="${r.me ? 'me' : ''} ${r.alive ? '' : 'dead'}">
          <span class="sb-n"><i class="${r.alive ? 'alive' : ''}"></i><span>${esc(r.name)}</span>${r.bot ? '<em>BOT</em>' : ''}</span>
          <span>${r.kd}</span>
          <span class="f">${r.kills}</span>
          <span>${r.score}</span>
          <span>${r.ping ?? '—'}</span>
        </li>`).join('') || '<li><span class="sb-n">—</span></li>';
    };
    render(rows.vega, 'sbVega');
    render(rows.argo, 'sbArgo');
  }
  hideScoreboard() { this.el.scoreboard.classList.add('hidden'); }

  /* ---------- часы/счёт ---------- */
  setClock(sec) {
    const s = Math.max(0, Math.round(sec));
    const t = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    if (t !== this._lastClock) {
      this._lastClock = t;
      this.el.clock.textContent = t;
      this.el.sbClock.textContent = t;
    }
  }
  setScores(v, a) {
    this.el.scoreVega.textContent = v;
    this.el.scoreArgo.textContent = a;
  }

  /* ---------- миникарта ---------- */
  drawMinimap(game) {
    const c = this.mctx, W = this.el.minimap.width, H = this.el.minimap.height;
    c.clearRect(0, 0, W, H);
    const me = game.me;
    if (!me) return;
    const map = game.map;
    const scale = 0.42 * (this.mapScale || 1);
    const range = W / 2 / scale;

    c.save();
    c.translate(W / 2, H / 2);
    c.rotate(-me.yaw);

    // фон-террейн
    if (map.terrainCanvas) {
      const s = map.size;
      const srcX = (me.pos.x / s + 0.5) * map.terrainCanvas.width;
      const srcY = (me.pos.z / s + 0.5) * map.terrainCanvas.height;
      const srcR = range / s * map.terrainCanvas.width;
      c.drawImage(map.terrainCanvas, srcX - srcR, srcY - srcR, srcR * 2, srcR * 2,
        -range * scale, -range * scale, range * scale * 2, range * scale * 2);
    } else {
      c.fillStyle = '#1b2119';
      c.fillRect(-W, -H, W * 2, H * 2);
    }

    const toLocal = (wx, wz) => {
      const dx = wx - me.pos.x, dz = wz - me.pos.z;
      const cs = Math.cos(-me.yaw), sn = Math.sin(-me.yaw);
      return [dx * cs - dz * sn, dx * sn + dz * cs];
    };
    const inRange = (x, y) => Math.abs(x) < W / 2 + 8 && Math.abs(y) < H / 2 + 8;

    // постройки
    c.fillStyle = 'rgba(20,24,28,.72)';
    for (const b of map.buildings || []) {
      const [x, y] = toLocal(b.x, b.z);
      if (!inRange(x, y)) continue;
      c.fillRect(x * scale - b.w * scale / 2, y * scale - b.d * scale / 2, b.w * scale, b.d * scale);
    }

    // техника
    for (const v of game.vehicles) {
      if (!v.alive) continue;
      const [x, y] = toLocal(v.mesh.position.x, v.mesh.position.z);
      if (!inRange(x, y)) continue;
      c.save();
      c.translate(x * scale, y * scale);
      c.rotate(v.yaw - me.yaw);
      c.fillStyle = v.faction === me.faction ? '#3ddc97' : '#ffb03b';
      c.fillRect(-3, -4, 6, 8);
      c.fillStyle = '#0b0f14';
      c.fillRect(-1.2, -6, 2.4, 4);
      c.restore();
    }

    // точки захвата
    for (const o of game.objectives || []) {
      const [x, y] = toLocal(o.pos.x, o.pos.z);
      if (!inRange(x, y)) continue;
      c.strokeStyle = o.owner === 'vega' ? '#38bdf8' : o.owner === 'argo' ? '#f0a93b' : '#cbd5e1';
      c.lineWidth = 1.6;
      c.beginPath(); c.arc(x * scale, y * scale, 6, 0, Math.PI * 2); c.stroke();
      c.fillStyle = c.strokeStyle;
      c.font = '700 8px monospace';
      c.textAlign = 'center';
      c.fillText(o.name[0], x * scale, y * scale + 3);
    }

    // союзники
    const uav = game.uavUntil && (game.time || 0) < game.uavUntil;
    for (const a of game.actors.values()) {
      if (!a.alive) continue;
      const enemy = a.faction !== me.faction;
      if (enemy && !uav) continue;
      const p = a.state === 'vehicle' && a.vehicle ? a.vehicle.mesh.position : a.pos;
      const [x, y] = toLocal(p.x, p.z);
      if (!inRange(x, y)) continue;
      c.save();
      c.translate(x * scale, y * scale);
      c.rotate(a.yaw - me.yaw);
      c.fillStyle = enemy ? '#ff4d57' : '#3ddc97';
      c.beginPath();
      c.moveTo(0, -4.4); c.lineTo(3.2, 3.4); c.lineTo(-3.2, 3.4); c.closePath();
      c.fill();
      c.restore();
    }

    // дроны
    for (const d of game.drones) {
      if (!d.alive) continue;
      const [x, y] = toLocal(d.pos.x, d.pos.z);
      if (!inRange(x, y)) continue;
      c.fillStyle = d.faction === me.faction ? '#7fd3ff' : '#ff6b7a';
      c.beginPath(); c.arc(x * scale, y * scale, 2.4, 0, Math.PI * 2); c.fill();
    }

    c.restore();

    // рамка-угол + игрок
    c.save();
    c.translate(W / 2, H / 2);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath();
    c.fill();
    c.restore();

    c.strokeStyle = 'rgba(140,170,195,.35)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
  }

  /* ---------- компас ---------- */
  drawCompass(yaw) {
    const c = this.cctx, W = this.el.compass.width, H = this.el.compass.height;
    c.clearRect(0, 0, W, H);
    const deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const pxPerDeg = W / 130;
    c.font = '600 11px "JetBrains Mono", monospace';
    c.textAlign = 'center';
    for (let d = -70; d <= 70; d += 5) {
      const ang = Math.round(deg / 5) * 5 + d;
      const x = W / 2 + (d - (deg - Math.round(deg / 5) * 5)) * pxPerDeg;
      if (x < -10 || x > W + 10) continue;
      const norm = ((ang % 360) + 360) % 360;
      const major = norm % 45 === 0;
      c.strokeStyle = major ? 'rgba(240,169,59,.85)' : 'rgba(219,230,240,.28)';
      c.lineWidth = major ? 1.6 : 1;
      c.beginPath();
      c.moveTo(x, major ? 4 : 9);
      c.lineTo(x, major ? 14 : 14);
      c.stroke();
      if (major) {
        const names = { 0: 'С', 45: 'СВ', 90: 'В', 135: 'ЮВ', 180: 'Ю', 225: 'ЮЗ', 270: 'З', 315: 'СЗ' };
        c.fillStyle = norm === 0 ? '#f0a93b' : 'rgba(219,230,240,.7)';
        c.fillText(names[norm] || norm, x, 27);
      }
    }
    c.fillStyle = '#f0a93b';
    c.beginPath();
    c.moveTo(W / 2 - 4, 0); c.lineTo(W / 2 + 4, 0); c.lineTo(W / 2, 6); c.closePath();
    c.fill();
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
