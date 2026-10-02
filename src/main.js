import { Profile, Sfx } from './core/store.js';
import { Game } from './game/game.js';
import { App } from './ui/app.js';

/* ============================================================
   ТОЧКА ВХОДА
   ============================================================ */

const bootFill = document.getElementById('bootFill');
const bootLog = document.getElementById('bootLog');

const STEPS = [
  ['загрузка ядра рендера…', 12],
  ['инициализация профиля…', 26],
  ['калибровка систем ввода…', 40],
  ['подключение к боевому узлу…', 58],
  ['построение интерфейса…', 76],
  ['генерация полигона…', 92],
  ['готово', 100]
];

async function boot() {
  for (let i = 0; i < STEPS.length; i++) {
    const [text, pct] = STEPS[i];
    bootLog.textContent = text;
    bootFill.style.width = pct + '%';
    await new Promise(r => setTimeout(r, i === 0 ? 120 : 90));
  }

  // 1) профиль
  Profile.load();
  if (!Profile.data.name) {
    Profile.data.name = randomCallsign();
    Profile.save();
  }

  // 2) игра
  const canvas = document.getElementById('gl');
  const game = new Game(canvas, null);

  // 3) UI
  const app = new App(game);
  game.ui = app;
  window.__game = game;
  window.__app = app;

  // 4) звук по первому взаимодействию
  const unlock = () => {
    Sfx.init();
    Sfx.resume();
    Sfx.setVolume(Profile.data.settings.volume);
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);

  // 5) сеть
  const { Net } = await import('./net/client.js');
  Net.connect();

  // 6) предпросмотр карты в меню (лёгкая сцена)
  buildMenuScene(game);

  app.goto('menu');
  app.refreshProfileChip();

  await new Promise(r => setTimeout(r, 220));
  document.getElementById('boot').classList.add('gone');
  document.getElementById('screen-menu').classList.add('active');

  // автооткрытие позывного при первом входе
  if (!localStorage.getItem('frontline_seen')) {
    localStorage.setItem('frontline_seen', '1');
    setTimeout(() => document.getElementById('modalName').classList.add('open'), 700);
  }

  game.loop();
}

function randomCallsign() {
  const a = ['КРЕЧЕТ', 'ГРАНИТ', 'ШТОРМ', 'СОКОЛ', 'БАРОН', 'ФЕНИКС', 'САПСАН', 'БУРАН',
    'ЗИМИН', 'СКАЛА', 'ЗЕНИТ', 'КАСКАД', 'ГИЛЬЗА', 'КЕДР', 'ПРИЗМА', 'ШКВАЛ'];
  return a[(Math.random() * a.length) | 0] + '-' + (10 + ((Math.random() * 89) | 0));
}

/* лёгкая вращающаяся сцена позади меню */
function buildMenuScene(game) {
  const THREE = game.THREE || null;
  game.buildMap('meridian');
  const cam = game.camera;
  game.menuCam = true;
  const center = game.map.objectives[0].pos;
  let t = 0;
  const tick = () => {
    requestAnimationFrame(tick);
    if (game.running) return;
    t += 0.0016;
    const r = 130;
    cam.position.set(center.x + Math.cos(t) * r, game.map.heightAt(center.x, center.z) + 42,
      center.z + Math.sin(t) * r);
    cam.lookAt(center.x, center.y + 8, center.z);
    game.renderer.render(game.scene, cam);
  };
  tick();
}

boot().catch(err => {
  console.error(err);
  bootLog.textContent = 'ОШИБКА ИНИЦИАЛИЗАЦИИ: ' + (err && err.message ? err.message : err);
  bootFill.style.background = '#ff4d57';
});
