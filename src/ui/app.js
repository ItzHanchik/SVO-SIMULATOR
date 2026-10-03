import { Profile, Sfx } from '../core/store.js';
import { WEAPONS, DRONES, VEHICLES, RANKS, RANK_TIER, rankByXp, rankSvg, MODES, MAPS, FACTIONS } from '../core/data.js';
import { Net } from '../net/client.js';
import { Hud } from './hud.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const XP_MATCH = { win: 420, lose: 180, draw: 260 };

/* ============================================================
   ПРИЛОЖЕНИЕ: экраны, лобби, арсенал, карьера, настройки
   ============================================================ */
export class App {
  constructor(game) {
    this.game = game;
    this.hud = new Hud();
    this.hud.bind(game);
    this.screen = 'boot';
    this.settings = Profile.data.settings;
    this.inMatch = false;
    this.lobbyHost = false;
    this.ready = false;
    this.roomPlayers = [];
    this.lobbySettings = { mode: 'tdm', map: 'meridian', bots: 8, skill: 'normal', limit: 60 };
    this.rooms = [];
    this._hudAcc = 0;
    this._bindNav();
    this._bindNet();
    this._renderSettings();
    this._renderCareer();
    this._renderArsenal();
    this.refreshProfileChip();
    this.hudLoop();
  }

  /* ================= НАВИГАЦИЯ ================= */
  _bindNav() {
    document.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { this.goto(nav.dataset.nav); Sfx.click(720, 0.03); return; }
      const close = e.target.closest('[data-close]');
      if (close) { close.closest('.modal').classList.remove('open'); return; }
      const fac = e.target.closest('[data-fac]');
      if (fac) { this.setFaction(fac.dataset.fac); return; }
      const mode = e.target.closest('[data-mode]');
      if (mode) { this.setMode(mode.dataset.mode); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) { this.arsTab = tab.dataset.tab; this._renderArsenal(); return; }
    });

    // главный экран
    $('profileChip').addEventListener('click', () => $('modalName').classList.add('open'));
    $('btnNameOk').addEventListener('click', () => {
      const v = $('nameInput').value.trim();
      if (v) { Profile.data.name = v; Profile.save(); this.refreshProfileChip(); }
      $('modalName').classList.remove('open');
      this._syncProfile();
    });
    $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnNameOk').click(); });

    // лобби
    $('btnCopyCode').addEventListener('click', () => {
      const c = $('codeBox').textContent;
      navigator.clipboard?.writeText(c).catch(() => {});
      this.toast('КОД СКОПИРОВАН: ' + c);
    });
    $('btnReady').addEventListener('click', () => this.toggleReady());
    $('btnStart').addEventListener('click', () => {
      if (!this.lobbyHost) return this.toast('НАЧАТЬ БОЙ МОЖЕТ ТОЛЬКО ГЛАВА ЛОББИ');
      Net.startMatch();
    });
    $('btnLeave').addEventListener('click', () => this.leaveLobby());
    $$('.team [data-team]').forEach(b => b.addEventListener('click', () => {
      Net.setTeam(b.dataset.team);
      Profile.data.faction = b.dataset.team;
      Profile.save();
    }));
    ['lsMode', 'lsMap', 'lsBots', 'lsSkill', 'lsLimit'].forEach(id => {
      $(id).addEventListener('change', () => {
        if (!this.lobbyHost) return this.toast('НАСТРОЙКИ МЕНЯЕТ ГЛАВА ЛОББИ');
        Net.setSettings({
          mode: $('lsMode').value, map: $('lsMap').value,
          bots: Number($('lsBots').value), skill: $('lsSkill').value, limit: Number($('lsLimit').value)
        });
      });
    });
    $('chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('chatInput').value.trim();
      if (!v) return;
      if (Net.room) Net.chat(v);
      else this._chatPush(Profile.data.name || 'ВЫ', v, true);
      $('chatInput').value = '';
    });

    // join modal
    $('btnJoinGo').addEventListener('click', () => {
      const code = $('joinCodeInput').value.trim().toUpperCase();
      if (code.length < 4) return this.toast('ВВЕДИТЕ КОД ЛОББИ');
      $('modalJoin').classList.remove('open');
      this.joinByCode(code);
    });
    $('joinCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoinGo').click(); });

    // пауза / результаты
    $('btnResume').addEventListener('click', () => this.togglePause());
    $('btnQuit').addEventListener('click', () => { this.quitMatch(); });
    $('btnResMenu').addEventListener('click', () => {
      $('results').classList.add('hidden');
      this.goto(Net.room ? 'lobby' : 'menu');
      if (!Net.room) this.goto('menu');
    });

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        const open = document.querySelector('.modal.open');
        if (open) open.classList.remove('open');
      }
    });
  }

  goto(name) {
    if (this.inMatch && name !== 'settings' && name !== 'menu') return;
    $$('.screen').forEach(s => s.classList.remove('active'));
    const el = $('screen-' + name);
    if (el) el.classList.add('active');
    this.screen = name;
    if (name === 'menu') { this.refreshProfileChip(); this._renderMiniLoadout(); }
    if (name === 'career') this._renderCareer();
    if (name === 'arsenal') this._renderArsenal();
    if (name === 'lobby') Net.listRooms();
    if (name === 'create') return this.createLobby();
    if (name === 'join') { $('modalJoin').classList.add('open'); this.goto('menu'); setTimeout(() => $('joinCodeInput').focus(), 60); return; }
    if (name === 'quick') return this.quickMatch();
  }

  /* ================= ПРОФИЛЬ ================= */
  setFaction(f) {
    Profile.data.faction = f;
    Profile.save();
    $$('.fac-card').forEach(c => c.classList.toggle('active', c.dataset.fac === f));
    this.refreshProfileChip();
    this._syncProfile();
    Sfx.click(880, 0.03);
  }

  setMode(m) {
    this.lobbySettings.mode = m;
    $$('.mode').forEach(x => x.classList.toggle('active', x.dataset.mode === m));
    Sfx.click(660, 0.03);
  }

  refreshProfileChip() {
    const d = Profile.data;
    const r = Profile.rankInfo;
    $('pcName').textContent = d.name || 'НОВЫЙ БОЕЦ';
    $('pcRankName').textContent = r.cur.n;
    $('pcLvl').textContent = r.cur.lvl;
    $('pcRankIcon').innerHTML = rankSvg(r.idx, 30);
    $('pcXpBar').style.width = (r.prog * 100) + '%';
    $('creditsVal').textContent = d.credits.toLocaleString('ru-RU');
    $$('.fac-card').forEach(c => c.classList.toggle('active', c.dataset.fac === d.faction));
    $$('.mode').forEach(x => x.classList.toggle('active', x.dataset.mode === this.lobbySettings.mode));
    this._renderMiniLoadout();
  }

  _renderMiniLoadout() {
    const L = Profile.data.loadout;
    const p = WEAPONS[L.primary], s = WEAPONS[L.secondary];
    $('mlPrimary').querySelector('.ml-n').textContent = p ? p.name : '—';
    $('mlPrimary').querySelector('.ml-d').textContent = p ? p.type : 'основное';
    $('mlSecondary').querySelector('.ml-n').textContent = s ? s.name : '—';
    $('mlSecondary').querySelector('.ml-d').textContent = s ? s.type : 'доп. ствол';
    $('mlGadgets').innerHTML = L.gadgets.map(g =>
      `<span class="chip">${WEAPONS[g]?.name.split('«')[1]?.replace('»', '') || g}</span>`).join('') +
      `<span class="chip">${DRONES[L.drone]?.name || ''}</span>`;
  }

  _syncProfile() {
    Net.setProfile({
      name: Profile.data.name || 'ИГРОК',
      level: Profile.level,
      rank: Profile.rankName,
      faction: Profile.data.faction,
      loadout: Profile.data.loadout
    });
  }

  /* ================= АРСЕНАЛ ================= */
  _renderArsenal() {
    const tab = this.arsTab || 'primary';
    $$('.ars-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const grid = $('arsGrid');
    const L = Profile.data.loadout;
    let items = [];
    if (tab === 'primary') items = Object.values(WEAPONS).filter(w => w.kind === 'primary');
    else if (tab === 'secondary') items = Object.values(WEAPONS).filter(w => w.kind === 'secondary');
    else if (tab === 'gadget') items = Object.values(WEAPONS).filter(w => w.kind === 'gadget');
    else if (tab === 'vehicle') items = Object.values(VEHICLES);
    else items = Object.values(DRONES);

    grid.innerHTML = items.map(it => {
      const unlocked = Profile.unlocked(it.id);
      const equipped = (tab === 'primary' && L.primary === it.id) ||
        (tab === 'secondary' && L.secondary === it.id) ||
        (tab === 'drone' && L.drone === it.id) ||
        (tab === 'gadget' && L.gadgets.includes(it.id));
      const bars = it.bars ? Object.entries(it.bars).map(([k, v]) =>
        `<div><span>${k}</span><i style="--v:${v}"><b></b></i></div>`).join('') : '';
      return `<button class="wcard ${equipped ? 'equipped' : ''}" data-id="${it.id}" data-tab="${tab}">
        <div class="wc-top">
          <div><div class="wc-name">${it.name}</div><div class="wc-type">${it.type}</div></div>
          <div class="wc-lvl">УР.${it.unlockLvl ?? 1}</div>
        </div>
        <div class="wc-bars">${bars}</div>
        <div class="${unlocked ? 'wc-unlocked' : 'wc-lock'}">${unlocked ? '✓ ДОСТУПНО' : '✕ НУЖЕН ' + (it.unlockLvl ?? 1) + ' УРОВЕНЬ'}</div>
      </button>`;
    }).join('');

    grid.querySelectorAll('.wcard').forEach(card => {
      card.addEventListener('click', () => this._selectArsenal(card.dataset.id, card.dataset.tab));
      card.addEventListener('mouseenter', () => this._arsenalDetail(card.dataset.id, card.dataset.tab));
    });
    if (items.length) this._arsenalDetail(items[0].id, tab);
  }

  _arsenalDetail(id, tab) {
    const it = WEAPONS[id] || DRONES[id] || VEHICLES[id];
    if (!it) return;
    const unlocked = Profile.unlocked(id);
    const specs = [];
    if (it.dmg) specs.push(['УРОН', it.dmg + (it.pellets ? '×' + it.pellets : '')]);
    if (it.rpm) specs.push(['ТЕМП', it.rpm + '/м']);
    if (it.mag) specs.push(['МАГАЗИН', it.mag]);
    if (it.reload) specs.push(['ПЕРЕЗАР.', it.reload + 'с']);
    if (it.range) specs.push(['ДАЛЬНОСТЬ', it.range + 'м']);
    if (it.speed) specs.push(['СКОРОСТЬ', it.speed]);
    if (it.agility) specs.push(['МАНЁВР', it.agility]);
    if (it.battery) specs.push(['БАТАРЕЯ', it.battery + 'с']);
    if (it.warhead) specs.push(['БОЕЗАРЯД', it.warhead]);
    if (it.hp) specs.push(['ПРОЧНОСТЬ', it.hp]);
    if (it.cannon) specs.push(['ОРУДИЕ', it.cannon.dmg]);
    if (it.radius) specs.push(['РАДИУС', it.radius + 'м']);
    if (it.count) specs.push(['В КОМПЛЕКТЕ', it.count]);
    if (it.duration) specs.push(['ДЛИТЕЛЬНОСТЬ', it.duration + 'с']);
    if (it.armor) specs.push(['БРОНЯ', '+' + it.armor]);
    if (it.seats) specs.push(['МЕСТА', it.seats + 1]);

    $('arsDetail').innerHTML = `
      <div class="ad-preview"><canvas id="adCv" width="300" height="150"></canvas></div>
      <div class="ad-name">${it.name}</div>
      <div class="ad-desc">${it.desc || ''}</div>
      <div class="ad-specs">${specs.map(([k, v]) =>
        `<div class="ad-spec"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <button class="btn ${unlocked ? 'btn-primary' : 'btn-ghost'} btn-wide" id="adBtn" ${unlocked ? '' : 'disabled'}>
        ${unlocked ? (tab === 'gadget' ? 'ВЗЯТЬ В КОМПЛЕКТ' : 'ЭКИПИРОВАТЬ') : 'ЗАБЛОКИРОВАНО · УР.' + (it.unlockLvl ?? 1)}
      </button>`;
    this._drawSchematic($('adCv'), it, tab);
    const btn = $('adBtn');
    if (btn && unlocked) btn.addEventListener('click', () => {
      if (tab === 'gadget') Profile.toggleGadget(id);
      else Profile.equip(tab, id);
      this.refreshProfileChip();
      this._renderArsenal();
      this._syncProfile();
      Sfx.beep(true);
    });
  }

  _drawSchematic(cv, it, tab) {
    if (!cv) return;
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const acc = (it.accent ? '#' + it.accent.toString(16).padStart(6, '0') : '#38bdf8');
    g.strokeStyle = acc; g.lineWidth = 1.2;
    g.fillStyle = 'rgba(255,255,255,.06)';
    // сетка
    g.globalAlpha = 0.12;
    for (let x = 0; x < W; x += 15) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += 15) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.globalAlpha = 1;

    g.translate(W / 2, H / 2);
    g.strokeStyle = acc;
    g.lineWidth = 2;
    const box = (x, y, w, h, f = false) => {
      g.beginPath(); g.rect(x, y, w, h);
      if (f) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fill(); }
      g.stroke();
    };
    if (tab === 'vehicle') {
      box(-60, -14, 120, 26, true);
      box(-30, -30, 60, 18, true);
      g.beginPath(); g.moveTo(30, -22); g.lineTo(88, -22); g.stroke();
      box(-62, 10, 22, 16, true); box(40, 10, 22, 16, true);
      box(-16, 10, 22, 16, true);
    } else if (tab === 'drone') {
      box(-12, -8, 24, 16, true);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.beginPath(); g.moveTo(0, 0); g.lineTo(sx * 42, sy * 26); g.stroke();
        g.beginPath(); g.arc(sx * 42, sy * 26, 16, 0, Math.PI * 2); g.stroke();
      }
      g.beginPath(); g.moveTo(0, 8); g.lineTo(0, 26); g.stroke();
      g.beginPath(); g.moveTo(-6, 26); g.lineTo(6, 26); g.lineTo(0, 38); g.closePath(); g.stroke();
    } else if (tab === 'gadget') {
      g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        g.beginPath(); g.moveTo(Math.cos(a) * 24, Math.sin(a) * 24);
        g.lineTo(Math.cos(a) * 34, Math.sin(a) * 34); g.stroke();
      }
    } else {
      const pistol = it.kind === 'secondary' && it.id !== 'vektr';
      const len = pistol ? 46 : 120;
      box(-len / 2, -8, len, 16, true);
      g.beginPath(); g.moveTo(len / 2, -2); g.lineTo(len / 2 + (pistol ? 12 : 40), -2); g.stroke();
      box(-len / 2 + 6, 8, 12, pistol ? 22 : 16, true);
      if (!pistol) {
        box(-14, 8, 14, 26, true);
        box(-len / 2 - 16, -6, 18, 12, true);
        box(-len / 2 + 30, -14, 26, 6, true);
      }
      box(len / 2 - 20, -14, 16, 6, true);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = acc;
    g.font = '600 9px "JetBrains Mono", monospace';
    g.fillText((it.type || '').toUpperCase(), 10, H - 10);
  }

  /* ================= КАРЬЕРА ================= */
  _renderCareer() {
    const d = Profile.data, r = Profile.rankInfo, s = d.stats;
    $('ccRankIcon').innerHTML = rankSvg(r.idx, 70);
    $('ccRankName').textContent = r.cur.n;
    $('ccLvl').textContent = r.cur.lvl;
    $('ccXpTxt').textContent = `${Math.round(r.xpInto).toLocaleString('ru-RU')} / ${r.xpSpan.toLocaleString('ru-RU')} XP`;
    $('ccXpBar').style.width = (r.prog * 100) + '%';
    $('ccXpPct').textContent = Math.round(r.prog * 100) + '%';
    $('ccNext').textContent = r.next
      ? `Следующий ранг: ${r.next.n} (ур. ${r.next.lvl}) — ${(r.next.xp - d.xp).toLocaleString('ru-RU')} XP`
      : 'МАКСИМАЛЬНЫЙ РАНГ ДОСТИГНУТ';
    $('careerMatches').textContent = s.matches;

    const kd = Profile.kd();
    const stats = [
      ['БОЁВ', s.matches, ''], ['ПОБЕД', s.wins, 'ok'], ['ПОРАЖЕНИЙ', s.losses, ''],
      ['ФРАГОВ', s.kills, 'acc'], ['СМЕРТЕЙ', s.deaths, ''], ['K/D', kd.toFixed(2), 'vega'],
      ['В ГОЛОВУ', s.headshots, 'acc'], ['ТЕХНИКА', s.vehicleKills, ''],
      ['ДРОНЫ', s.droneHits, 'vega'], ['ЗАХВАТОВ', s.captures, 'ok'],
      ['ЛУЧШАЯ СЕРИЯ', s.bestKillstreak, 'acc'],
      ['УРОН', Math.round(s.damage).toLocaleString('ru-RU'), ''],
      ['WINRATE', Profile.winrate() + '%', 'ok'],
      ['ВРЕМЯ В БОЮ', Math.floor(s.playtime / 60) + ' мин', '']
    ];
    $('careerStats').innerHTML = stats.map(([k, v, c]) =>
      `<div class="cstat ${c}"><span>${k}</span><b>${v}</b></div>`).join('');

    $('rankTrack').innerHTML = RANKS.map((rk, i) => {
      const st = i < r.idx ? 'done' : i === r.idx ? 'cur' : '';
      return `<div class="rk ${st}">${rankSvg(i, 36)}
        <div><div class="rk-n">${rk.n}</div><div class="rk-l">УР. ${rk.lvl} · ${rk.xp.toLocaleString('ru-RU')} XP</div></div></div>`;
    }).join('');
  }

  /* ================= НАСТРОЙКИ ================= */
  _renderSettings() {
    const s = Profile.data.settings;
    const rows = [
      { sec: 'УПРАВЛЕНИЕ' },
      { k: 'sens', l: 'Чувствительность мыши', type: 'range', min: 0.1, max: 4, step: 0.05, fmt: v => v.toFixed(2) },
      { k: 'adsSens', l: 'Чувствительность в прицеле', type: 'range', min: 0.2, max: 1.5, step: 0.05, fmt: v => v.toFixed(2) },
      { k: 'invertY', l: 'Инверсия оси Y', type: 'bool' },
      { sec: 'ИЗОБРАЖЕНИЕ' },
      { k: 'fov', l: 'Поле зрения (FOV)', type: 'range', min: 65, max: 110, step: 1, fmt: v => v + '°' },
      { k: 'quality', l: 'Качество графики', type: 'select', opts: [['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое']] },
      { k: 'showFps', l: 'Показывать FPS', type: 'bool' },
      { sec: 'ИГРА' },
      { k: 'autoReload', l: 'Автоперезарядка', type: 'bool' },
      { k: 'volume', l: 'Громкость', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
      { k: 'minimapScale', l: 'Масштаб миникарты', type: 'range', min: 0.5, max: 2.5, step: 0.1, fmt: v => v.toFixed(1) + '×' }
    ];
    $('settingsBody').innerHTML = rows.map(r => {
      if (r.sec) return `<div class="set-section">${r.sec}</div>`;
      const v = s[r.k];
      if (r.type === 'range') return `<div class="set-row"><label>${r.l}</label>
        <input type="range" data-k="${r.k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}">
        <span class="set-val" data-v="${r.k}">${r.fmt(v)}</span></div>`;
      if (r.type === 'select') return `<div class="set-row"><label>${r.l}</label>
        <select data-k="${r.k}">${r.opts.map(([val, lab]) =>
          `<option value="${val}" ${val === v ? 'selected' : ''}>${lab}</option>`).join('')}</select></div>`;
      return `<div class="set-row"><label>${r.l}</label>
        <select data-k="${r.k}"><option value="1" ${v ? 'selected' : ''}>ВКЛ</option>
        <option value="0" ${!v ? 'selected' : ''}>ВЫКЛ</option></select></div>`;
    }).join('');

    $('settingsBody').querySelectorAll('[data-k]').forEach(el => {
      el.addEventListener('input', () => {
        const k = el.dataset.k;
        let v;
        if (el.type === 'range') v = Number(el.value);
        else if (el.tagName === 'SELECT') {
          const raw = el.value;
          v = raw === '1' ? true : raw === '0' ? false : raw;
        } else v = el.value;
        Profile.data.settings[k] = v;
        Profile.save();
        const fmt = rows.find(r => r.k === k)?.fmt;
        const lab = document.querySelector(`[data-v="${k}"]`);
        if (lab && fmt) lab.textContent = fmt(v);
        this.game.applySettings(Profile.data.settings);
        this.hud.mapScale = Profile.data.settings.minimapScale;
        Sfx.setVolume(Profile.data.settings.volume);
      });
    });
    this.game.applySettings(s);
    this.hud.mapScale = s.minimapScale;
  }

  /* ================= СЕТЬ / ЛОББИ ================= */
  _bindNet() {
    Net.onStatus = (ok, text) => {
      const p = $('netPill');
      p.classList.toggle('ok', ok);
      p.classList.toggle('bad', !ok);
      $('netTxt').textContent = ok ? `узел · ${Net.rtt}мс` : text;
      if (ok) this._syncProfile();
    };
    Net.on('welcome', () => { this._syncProfile(); });
    Net.on('rooms', (m) => { this.rooms = m.rooms; this._renderRooms(); });
    Net.on('joined', (m) => {
      this.roomPlayers = m.room.players;
      this.lobbyHost = m.room.hostId === Net.id;
      $('lobbyCode').textContent = 'КОД: ' + m.room.code;
      $('codeBox').textContent = m.room.code;
      this._applyRoomSettings(m.room.settings);
      this._renderLobby(m.room);
      this.goto('lobby');
      this.toast('ВЫ В ЛОББИ ' + m.room.code);
    });
    Net.on('roomUpdate', (m) => {
      this._renderLobby(m.room);
      this._applyRoomSettings(m.room.settings);
    });
    Net.on('youAreHost', () => { this.lobbyHost = true; this._renderLobbyControls(); });
    Net.on('hostChanged', (m) => {
      this.lobbyHost = m.hostId === Net.id;
      this.toast('ГЛАВА ЛОББИ: ' + m.hostName);
      this._renderLobbyControls();
    });
    Net.on('chat', (m) => this._chatPush(m.from, m.msg, m.id === Net.id));
    Net.on('sys', (m) => this._chatPush(null, m.msg));
    Net.on('error', (m) => this.toast(m.msg));
    Net.on('left', () => { this.lobbyHost = false; this.roomPlayers = []; });
    Net.on('matchStart', (m) => this._onMatchStart(m));
    Net.on('net', (m) => {
      if (this.game.running && m.d) this.game.handleNet(m.d);
    });
  }

  _applyRoomSettings(s) {
    if (!s) return;
    this.lobbySettings = { ...this.lobbySettings, ...s };
    $('lsMode').value = s.mode || 'tdm';
    $('lsMap').value = s.map || 'meridian';
    $('lsBots').value = String(s.bots ?? 8);
    $('lsSkill').value = s.skill || 'normal';
    $('lsLimit').value = String(s.limit ?? 60);
  }

  _renderLobby(room) {
    if (!room) return;
    $('lobbyTitle').textContent = room.name || 'ЛОББИ ' + room.code;
    $('codeBox').textContent = room.code;
    this.lobbyHost = room.hostId === Net.id;
    const vega = room.players.filter(p => p.faction === 'vega');
    const argo = room.players.filter(p => p.faction === 'argo');
    $('teamVegaCount').textContent = `${vega.length}/8`;
    $('teamArgoCount').textContent = `${argo.length}/8`;
    const li = (p) => `<li class="${p.id === Net.id ? 'me' : ''} ${p.isBot ? 'bot' : ''}">
        <span class="tl-ready ${p.ready || p.id === Net.id ? 'on' : ''}"></span>
        <span class="tl-name">${esc(p.name)}</span>
        <span class="tl-rank">УР.${p.level || 1}</span>
        ${p.id === room.hostId ? '<span class="tl-rank">★</span>' : ''}
      </li>`;
    $('listVega').innerHTML = vega.map(li).join('') || '<li class="empty">пусто</li>';
    $('listArgo').innerHTML = argo.map(li).join('') || '<li class="empty">пусто</li>';
    this._renderLobbyControls();
  }

  _renderLobbyControls() {
    $('btnStart').classList.toggle('off', !this.lobbyHost);
    $$('#lobbySettings select').forEach(s => { s.disabled = !this.lobbyHost; s.style.opacity = this.lobbyHost ? 1 : 0.5; });
    $('lobbyTitle').textContent = (Net.room?.name || 'ЛОББИ') + (this.lobbyHost ? ' · ВЫ ГЛАВА' : '');
  }

  _renderRooms() {
    const el = $('roomList');
    if (!this.rooms.length) { el.innerHTML = '<div class="empty">свободных лобби нет — создайте своё</div>'; return; }
    el.innerHTML = this.rooms.map(r => `<button class="room-item" data-code="${r.code}">
      <span class="ri-n">${esc(r.name)}</span>
      <span class="ri-p">${MODES[r.mode]?.name || r.mode} · ${r.players}/${r.max}</span>
    </button>`).join('');
    el.querySelectorAll('.room-item').forEach(b =>
      b.addEventListener('click', () => this.joinByCode(b.dataset.code)));
  }

  _chatPush(from, msg, me = false) {
    const el = $('chatLog');
    const d = document.createElement('div');
    if (!from) d.className = 'sys';
    d.innerHTML = from ? `<b style="color:${me ? '#f0a93b' : '#38bdf8'}">${esc(from)}:</b> ${esc(msg)}` : esc(msg);
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 80) el.removeChild(el.firstChild);
  }

  toggleReady() {
    this.ready = !this.ready;
    Net.setReady(this.ready);
    $('btnReady').textContent = this.ready ? 'НЕ ГОТОВ' : 'ГОТОВ';
    $('btnReady').classList.toggle('btn-primary', !this.ready);
    Sfx.beep(this.ready);
  }

  createLobby() {
    if (!Net.connected) {
      this.toast('СЕРВЕР НЕДОСТУПЕН — ЗАПУСКАЮ ОФЛАЙН-БОЙ');
      return this.startSolo();
    }
    Net.createRoom({
      name: `ЛОББИ ${Profile.data.name || 'БОЙЦА'}`,
      mode: this.lobbySettings.mode,
      map: 'meridian',
      bots: this.lobbySettings.bots,
      skill: this.lobbySettings.skill,
      limit: MODES[this.lobbySettings.mode].limit
    });
    this.goto('menu');
  }

  joinByCode(code) {
    if (!Net.connected) return this.toast('НЕТ СВЯЗИ С УЗЛОМ');
    Net.joinRoom(code, Profile.data.faction);
  }

  quickMatch() {
    if (!Net.connected) {
      this.toast('ОФЛАЙН-РЕЖИМ · БОЙ С БОТАМИ');
      return this.startSolo();
    }
    Net.quickMatch(this.lobbySettings.mode, Profile.data.faction);
    this.goto('menu');
  }

  leaveLobby() {
    Net.leaveRoom();
    this.lobbyHost = false;
    this.ready = false;
    $('btnReady').textContent = 'ГОТОВ';
    this.goto('menu');
  }

  startSolo() {
    this._onMatchStart({
      youAreHost: true, myId: 'local',
      players: [{ id: 'local', name: Profile.data.name || 'ВЫ', faction: Profile.data.faction,
        level: Profile.level, rank: Profile.rankName, loadout: Profile.data.loadout }],
      room: { settings: { mode: this.lobbySettings.mode, map: this.lobbySettings.map,
        bots: this.lobbySettings.bots, skill: this.lobbySettings.skill,
        limit: MODES[this.lobbySettings.mode].limit } },
      seed: (Math.random() * 1e9) | 0
    });
  }

  _onMatchStart(m) {
    const s = m.room?.settings || this.lobbySettings;
    const myId = m.myId || Net.id || 'local';
    const players = (m.players || []).map(p => ({ ...p }));
    let me = players.find(p => p.id === myId);
    if (!me) {
      me = { id: myId, name: Profile.data.name || 'ВЫ', faction: Profile.data.faction,
        level: Profile.level, rank: Profile.rankName, loadout: Profile.data.loadout };
      players.push(me);
    }
    if (!me.loadout) me.loadout = Profile.data.loadout;

    const cfg = {
      mode: s.mode || 'tdm', map: s.map || 'meridian',
      bots: this.lobbyHost || m.youAreHost ? (s.bots ?? 8) : 0,
      skill: s.skill || 'normal',
      limit: s.limit ?? MODES[s.mode || 'tdm'].limit,
      seed: m.seed || 1,
      isHost: !!m.youAreHost || !Net.room,
      myId,
      players,
      me: {
        name: Profile.data.name || 'ВЫ',
        faction: Profile.data.faction,
        level: Profile.level,
        rankName: Profile.rankName,
        loadout: Profile.data.loadout
      }
    };
    this.game.resetStats();
    this.inMatch = true;
    $$('.screen').forEach(x => x.classList.remove('active'));
    this.game.startMatch(cfg);
    setTimeout(() => { try { this.game.canvas.requestPointerLock(); } catch (e) {} }, 250);
  }

  /* ================= ПАУЗА / ВЫХОД ================= */
  togglePause() {
    if (!this.inMatch || !this.game.running) return;
    this.game.paused = !this.game.paused;
    $('pause').classList.toggle('hidden', !this.game.paused);
    if (this.game.paused) {
      document.exitPointerLock && document.exitPointerLock();
      const st = this.game._localStats;
      $('pauseStats').innerHTML = `
        <div><span>ФРАГИ</span><b>${st.kills}</b></div>
        <div><span>СМЕРТИ</span><b>${st.deaths}</b></div>
        <div><span>ОЧКИ</span><b>${this.game.me.score}</b></div>`;
    } else {
      try { this.game.canvas.requestPointerLock(); } catch (e) {}
    }
  }

  quitMatch() {
    this.game.quit();
    this.inMatch = false;
    $('pause').classList.add('hidden');
    this._awardXp(true);
    /* раньше после выхода не включался ни один экран — игрок оставался
       на чёрной сцене без меню */
    this.goto(Net.room ? 'lobby' : 'menu');
  }

  setScoreboard(on) {
    if (!this.game.running) return;
    if (!on) return this.hud.hideScoreboard();
    const g = this.game;
    const rows = { vega: [], argo: [] };
    const push = (a, me) => {
      const r = {
        name: a.name, kills: a.kills, deaths: a.deaths, score: a.score,
        kd: (a.deaths ? (a.kills / a.deaths) : a.kills).toFixed(1),
        alive: a.alive, me, bot: a.isBotSim || (a.id || '').startsWith('bot_'),
        ping: me ? Net.rtt : (a.netPing ?? null)
      };
      rows[a.faction].push(r);
    };
    if (g.me) push(g.me, true);
    for (const a of g.actors.values()) push(a, false);
    for (const k of ['vega', 'argo']) rows[k].sort((a, b) => b.score - a.score);
    this.hud.showScoreboard(rows, this.hud._lastClock);
  }

  setLocked(on) {
    if (on) { $('pause').classList.add('hidden'); this.game.paused = false; }
  }

  showHud(on) {
    $('hud').classList.toggle('hidden', !on);
    $('vignette').style.display = on ? 'block' : 'none';
    if (on) {
      this.hud.updateSlots(this.game.me);
      this.hud.updateGadgets(this.game.me.gadgets);
      this.hud.updateAmmo(this.game.me.weapon);
      this.hud.setScores(0, 0);
      this.hud.objective(MODES[this.game.mode].name + ' · ' + this.game.mapCfg.name);
    }
  }

  showResults(verdict, scores, stats, me) {
    this.inMatch = false;
    const v = $('resVerdict');
    v.textContent = verdict === 'win' ? 'ПОБЕДА' : verdict === 'lose' ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ';
    v.className = 'res-verdict ' + verdict;
    $('resSub').textContent = `VEGA ${scores.vega} : ${scores.argo} ARGO · ${MODES[this.game.mode].name}`;
    $('resStats').innerHTML = [
      ['ФРАГИ', stats.kills], ['СМЕРТИ', stats.deaths],
      ['В ГОЛОВУ', stats.headshots], ['УРОН', Math.round(stats.damage)],
      ['ЗАХВАТЫ', stats.captures], ['ТЕХНИКА', stats.vehicleKills],
      ['СЕРИЯ', stats.bestStreak], ['ОЧКИ', Math.round(me?.score || 0)]
    ].map(([k, val]) => `<div><span>${k}</span><b>${val}</b></div>`).join('');
    $('results').classList.remove('hidden');
    this._awardXp(false, verdict, stats);
  }

  _awardXp(quit = false, verdict = 'draw', stats = null) {
    const s = stats || this.game._localStats || { kills: 0, deaths: 0, captures: 0, damage: 0, playtime: 0 };
    let xp = s.kills * 22 + s.headshots * 8 + s.captures * 30 +
      s.vehicleKills * 45 + Math.round(s.damage / 12) + Math.round(s.playtime / 4);
    xp += XP_MATCH[verdict] ?? 120;
    if (quit) xp = Math.round(xp * 0.35);
    xp = Math.max(25, xp);

    const before = Profile.data.stats;
    Profile.data.stats.matches += quit ? 0 : 1;
    if (!quit) {
      if (verdict === 'win') Profile.data.stats.wins++;
      else if (verdict === 'lose') Profile.data.stats.losses++;
    }
    Profile.data.stats.kills += s.kills;
    Profile.data.stats.deaths += s.deaths;
    Profile.data.stats.headshots += s.headshots;
    Profile.data.stats.captures += s.captures;
    Profile.data.stats.vehicleKills += s.vehicleKills;
    Profile.data.stats.damage += s.damage;
    Profile.data.stats.playtime += s.playtime;
    if (s.bestStreak > Profile.data.stats.bestKillstreak) Profile.data.stats.bestKillstreak = s.bestStreak;

    const res = Profile.addXp(xp);
    Profile.addCredits(Math.round(xp * 0.8) + s.kills * 12);
    Profile.save();

    $('rxGained').textContent = '+' + xp;
    $('rxBar').style.width = '0%';
    $('rxRank').innerHTML = `<b>${res.after.cur.n}</b> · ур. ${res.after.cur.lvl} · ` +
      `${Math.round(res.after.xpInto)} / ${res.after.xpSpan} XP`;
    requestAnimationFrame(() => { $('rxBar').style.width = (res.after.prog * 100) + '%'; });

    if (res.promoted) {
      Sfx.levelUp();
      this.toast('НОВЫЙ РАНГ: ' + res.after.cur.n, 3200);
      $('rxRank').innerHTML += ` · <b style="color:#3ddc97">ПОВЫШЕНИЕ!</b>`;
    }
    this.refreshProfileChip();
    this._renderCareer();
  }

  toast(text, ms = 2200) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('on'), ms);
  }

  /* ================= ЦИКЛ HUD ================= */
  hudLoop() {
    requestAnimationFrame(() => this.hudLoop());
    const g = this.game;
    if (!g.running || !g.me) return;
    if (g.paused) return;
    const me = g.me;

    this.hud.updateVitals(me.hp, me.armor);
    this.hud.updateAmmo(me.weapon);
    this.hud.setClock(g.clock);
    this.hud.setScores(g.scores.vega, g.scores.argo);
    this.hud.setStance(me.crouch ? 'СИДЯ' : (me.sprint ? 'БЕГ' : me.onGround ? 'СТОЯ' : 'В ВОЗДУХЕ'));

    // прицел
    const spread = me.currentSpread ? me.currentSpread() : 0.02;
    const ads = me.ads && me.state === 'ground';
    this.hud.setCrosshairGap(ads ? 2 : Math.round(7 + spread * 900), ads);

    // индикатор взаимодействия
    if (me.state === 'ground' && me.alive) {
      const v = g._nearestVehicle();
      this.hud.interact(v ? (v.driver ? 'ПАССАЖИР · ' + v.def.name : 'СЕСТИ ЗА РУЛЬ · ' + v.def.name) : null);
    } else if (me.state === 'vehicle') {
      this.hud.interact('ВЫЙТИ ИЗ ТЕХНИКИ');
    } else if (me.state === 'drone') {
      this.hud.interact('ПРЕРВАТЬ ПОЛЁТ');
    } else this.hud.interact(null);

    this.hud.updateSlots(me);
    this.hud.drawMinimap(g);
    this.hud.drawCompass(me.yaw);

    // цель захвата
    if (g.mode === 'dom' && g.objectives) {
      const neutral = g.objectives.filter(o => o.owner !== me.faction);
      if (neutral.length) {
        let best = neutral[0], bd = Infinity;
        for (const o of neutral) {
          const d = Math.hypot(me.pos.x - o.pos.x, me.pos.z - o.pos.z);
          if (d < bd) { bd = d; best = o; }
        }
        const ownerTxt = best.owner === 'none' ? 'НЕЙТРАЛЬНА' : FACTIONS[best.owner].short;
        this.hud.objective(`ТОЧКА ${best.name} · ${ownerTxt} · ${Math.round(bd)}м`);
      } else this.hud.objective('ВСЕ ТОЧКИ НАШИ · УДЕРЖИВАЙТЕ');
    }
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
