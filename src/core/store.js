import { RANKS, rankByXp, WEAPONS, DRONES } from './data.js';

const KEY = 'frontline_meridian_profile_v1';

const DEFAULTS = {
  name: '',
  xp: 0,
  credits: 1200,
  faction: 'vega',
  loadout: { primary: 'vixen', secondary: 'gyurza', gadgets: ['frag', 'smoke', 'plate'], drone: 'striker' },
  stats: {
    matches: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0,
    headshots: 0, vehicleKills: 0, droneKills: 0, droneHits: 0, captures: 0,
    playtime: 0, bestKillstreak: 0, damage: 0
  },
  settings: {
    sens: 1.0, adsSens: 0.75, fov: 82, invertY: false,
    quality: 'high', volume: 0.7, showFps: true, autoReload: true, toggleSprint: false,
    minimapScale: 1.0
  },
  seenRanks: 0
};

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) &&
        base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], over[k]);
    } else if (over[k] !== undefined) {
      out[k] = over[k];
    }
  }
  return out;
}

export const Profile = {
  data: null,
  _listeners: new Set(),

  load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    this.data = deepMerge(structuredClone(DEFAULTS), raw || {});
    // защита от невалидного комплекта
    const L = this.data.loadout;
    if (!WEAPONS[L.primary]) L.primary = 'vixen';
    if (!WEAPONS[L.secondary]) L.secondary = 'gyurza';
    if (!DRONES[L.drone]) L.drone = 'striker';
    L.gadgets = (L.gadgets || []).filter(g => WEAPONS[g]);
    if (!L.gadgets.length) L.gadgets = ['frag'];
    this.save();
    return this.data;
  },

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* quota */ }
    this._listeners.forEach(f => { try { f(this.data); } catch (e) {} });
  },

  onChange(fn) { this._listeners.add(fn); },

  get rankInfo() { return rankByXp(this.data.xp); },
  get level() { return this.rankInfo.cur.lvl; },
  get rankName() { return this.rankInfo.cur.n; },

  unlocked(id) {
    const item = WEAPONS[id] || DRONES[id];
    if (!item) return false;
    return this.level >= (item.unlockLvl ?? 1);
  },

  addXp(amount, reason) {
    const before = this.rankInfo;
    this.data.xp = Math.max(0, this.data.xp + Math.round(amount));
    const after = this.rankInfo;
    this.save();
    return { before, after, promoted: after.idx > before.idx, gained: Math.round(amount), reason };
  },

  bumpStat(k, v = 1) {
    this.data.stats[k] = (this.data.stats[k] || 0) + v;
  },

  addCredits(v) { this.data.credits = Math.max(0, this.data.credits + Math.round(v)); },

  equip(slot, id) {
    const item = WEAPONS[id];
    if (!item || !this.unlocked(id)) return false;
    if (slot === 'primary' || slot === 'secondary') this.data.loadout[slot] = id;
    else if (slot === 'drone') this.data.loadout.drone = id;
    this.save();
    return true;
  },

  toggleGadget(id) {
    const list = this.data.loadout.gadgets;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else {
      if (list.length >= 3) list.shift();
      list.push(id);
    }
    this.save();
    return list;
  },

  kd() {
    const s = this.data.stats;
    return s.deaths ? (s.kills / s.deaths) : s.kills;
  },

  winrate() {
    const s = this.data.stats;
    return s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
  },

  allRanks() { return RANKS; }
};

/* ---------- ЗВУК (процедурный WebAudio, без ассетов) ---------- */
export const Sfx = {
  ctx: null,
  master: null,
  muted: false,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
  },
  setVolume(v) { if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v)); },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

  _noise(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    return s;
  },

  shot({ heavy = false, distant = false, suppressed = false } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(heavy ? 2600 : 5200, t);
    filt.frequency.exponentialRampToValueAtTime(distant ? 300 : 700, t + 0.14);
    const vol = (distant ? 0.09 : suppressed ? 0.16 : heavy ? 0.42 : 0.3) * (this.muted ? 0 : 1);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (heavy ? 0.3 : 0.13));
    const src = this._noise(heavy ? 0.32 : 0.15);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.34);
    // корпус
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(heavy ? 90 : 170, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.09);
    og.gain.setValueAtTime(vol * 0.6, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.1);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.12);
  },

  click(freq = 900, dur = 0.035, type = 'square', vol = 0.06) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.01);
  },

  hit(kill = false) {
    if (!this.ctx) return;
    this.click(kill ? 1500 : 1150, kill ? 0.09 : 0.05, 'sine', kill ? 0.14 : 0.09);
    if (kill) setTimeout(() => this.click(2100, 0.07, 'sine', 0.1), 55);
  },

  explosion(power = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this._noise(0.9);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1800 * power, t);
    filt.frequency.exponentialRampToValueAtTime(120, t + 0.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55 * power, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.9);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.95);
    const o = this.ctx.createOscillator(); const og = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.55);
    og.gain.setValueAtTime(0.5 * power, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.6);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.65);
  },

  reload() { this.click(420, 0.05, 'square', 0.07); setTimeout(() => this.click(620, 0.05, 'square', 0.07), 130); },
  hurt() { this.click(220, 0.12, 'sawtooth', 0.1); },
  engine(v) { /* вызывается из игры напрямую */ },
  beep(ok = true) { this.click(ok ? 780 : 320, 0.07, 'sine', 0.08); },
  levelUp() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.click(f, 0.16, 'triangle', 0.11), i * 95));
  },
  droneHum(on) {
    if (!this.ctx) return;
    if (on && !this._hum) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = 118;
      lfo.type = 'sine'; lfo.frequency.value = 27; lg.gain.value = 26;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.value = 0.045;
      o.connect(g); g.connect(this.master);
      o.start(); lfo.start();
      this._hum = { o, g, lfo };
    } else if (!on && this._hum) {
      const { o, g, lfo } = this._hum;
      try { g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); } catch (e) {}
      setTimeout(() => { try { o.stop(); lfo.stop(); } catch (e) {} }, 200);
      this._hum = null;
    }
  }
};
