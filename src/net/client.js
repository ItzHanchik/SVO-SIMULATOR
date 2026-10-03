/* ============================================================
   СЕТЕВОЙ КЛИЕНТ
   подключение к /ws, автопереподключение, RTT
   ============================================================ */

export class NetClient {
  constructor() {
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.isHost = false;
    this.room = null;
    this.rtt = 0;
    this.handlers = new Map();
    this.onStatus = () => {};
    this._queue = [];
    this._reconnectTimer = null;
    this._attempts = 0;
    this._closedByUser = false;
    this._pingTimer = null;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this._closedByUser = false;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url;
    try { url = `${proto}//${location.host}/ws`; } catch (e) { url = null; }
    if (!url) return this._setStatus(false, 'нет соединения');

    try { this.ws = new WebSocket(url); } catch (e) { this._setStatus(false, 'нет соединения'); return; }

    const t0 = performance.now();
    this.ws.onopen = () => {
      this.connected = true;
      this._attempts = 0;
      this._setStatus(true, 'узел подключён');
      this.send({ t: 'ping', ts: Date.now() });
      this._flushQueue();
      clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => {
        if (this.connected) {
          this._t0 = Date.now();
          this.send({ t: 'ping', ts: this._t0 });
        }
      }, 3000);
    };
    this.ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') { this.id = m.id; }
      if (m.t === 'pong') {
        this.rtt = Math.max(1, Math.round(Date.now() - m.ts));
        this.send({ t: 'reportPing', ping: this.rtt });
      }
      const hs = this.handlers.get(m.t);
      if (hs) for (const h of hs) { try { h(m); } catch (e) { console.error('[net]', m.t, e); } }
      const any = this.handlers.get('*');
      if (any) for (const h of any) { try { h(m); } catch (e) {} }
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      clearInterval(this._pingTimer);
      if (!this._closedByUser) {
        this._attempts++;
        /* На статическом хостинге (GitHub Pages) сервера /ws нет вовсе —
           не спамим переподключениями, а честно переходим в офлайн-режим. */
        if (this._attempts > 5) {
          this._setStatus(false, 'офлайн · одиночная игра');
          return;
        }
        const delay = Math.min(8000, 700 * this._attempts);
        this._setStatus(false, `переподключение ${this._attempts}…`);
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => this.connect(), delay);
      } else {
        this._setStatus(false, 'офлайн');
      }
    };
    this.ws.onerror = () => { try { this.ws && this.ws.close(); } catch (e) {} };
  }

  disconnect() {
    this._closedByUser = true;
    clearTimeout(this._reconnectTimer);
    clearInterval(this._pingTimer);
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
    this.ws = null;
    this.connected = false;
  }

  _setStatus(ok, text) { this.onStatus(ok, text); }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }
  off(type, fn) {
    const a = this.handlers.get(type);
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }

  send(m) {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(m)); return true; } catch (e) { return false; }
    }
    if (this._queue.length < 40) this._queue.push(m);
    return false;
  }
  _flushQueue() {
    const q = this._queue; this._queue = [];
    for (const m of q) this.send(m);
  }

  /* --- высокоуровневые --- */
  setProfile(p) { this.send({ t: 'setProfile', ...p }); }
  listRooms() { this.send({ t: 'listRooms' }); }
  createRoom(settings) { this.send({ t: 'createRoom', settings }); }
  joinRoom(code, team) { this.send({ t: 'joinRoom', code, team }); }
  quickMatch(mode, faction) { this.send({ t: 'quickMatch', mode, faction }); }
  leaveRoom() { this.send({ t: 'leaveRoom' }); }
  setTeam(team) { this.send({ t: 'setTeam', team }); }
  setReady(v) { this.send({ t: 'setReady', value: v }); }
  setSettings(s) { this.send({ t: 'setSettings', settings: s }); }
  startMatch() { this.send({ t: 'startMatch' }); }
  endMatch() { this.send({ t: 'endMatch' }); }
  chat(msg) { this.send({ t: 'chat', msg }); }
  relay(d, to) { this.send({ t: 'relay', d, to }); }
  hostCast(d) { this.send({ t: 'hostCast', d }); }
}

export const Net = new NetClient();
