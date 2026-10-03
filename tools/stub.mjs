function make2D() {
  const grad = { addColorStop() {} };
  const noop = () => {};
  return new Proxy({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop, getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    measureText: () => ({ width: 10 }),
    drawImage: noop
  }, {
    get(t, k) { return k in t ? t[k] : noop; },
    set() { return true; }
  });
}
const fakeCanvas = () => ({
  width: 1024, height: 1024, style: {},
  getContext: (t) => (t === '2d' ? make2D() : null),
  addEventListener() {}, removeEventListener() {},
  requestPointerLock() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
});
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? fakeCanvas() : { style: {}, appendChild() {}, addEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
  pointerLockElement: null, exitPointerLock: null, getElementById: () => null,
  body: { classList: { add() {}, remove() {}, toggle() {} } }
};
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  AudioContext: null, requestAnimationFrame: (cb) => globalThis.requestAnimationFrame(cb)
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
/* rAF с очередью: тесты могут «прокачивать» кадры как браузер */
const _rafQ = [];
globalThis.requestAnimationFrame = (cb) => { _rafQ.push(cb); return _rafQ.length; };
globalThis.__pumpRaf = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const cbs = _rafQ.splice(0, _rafQ.length);
    for (const cb of cbs) cb(performance.now());
  }
};
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k)
};
globalThis.WebSocket = class { constructor() { throw new Error('no ws in test'); } };
