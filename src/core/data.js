/* ==========================================================
   FRONTLINE: МЕРИДИАН — игровые данные
   Всё оружие вымышленное, стороны вымышленные.
   ========================================================== */

export const FACTIONS = {
  vega: {
    id: 'vega', name: 'КОАЛИЦИЯ VEGA', short: 'VEGA', color: 0x38bdf8, css: '#38bdf8',
    motto: 'Скорость · Точность · Сеть',
    bonus: { speed: 1.06, armor: 1.00, drone: 1.12 }
  },
  argo: {
    id: 'argo', name: 'АЛЬЯНС ARGO', short: 'ARGO', color: 0xf0a93b, css: '#f0a93b',
    motto: 'Броня · Огонь · Натиск',
    bonus: { speed: 0.97, armor: 1.14, drone: 1.0 }
  }
};

/* ---------- ОРУЖИЕ ----------
   kind: primary | secondary | gadget
   dmg      — урон за пулю
   rpm      — темп
   mag      — магазин
   reserve  — запас
   reload   — сек
   spread   — базовое рассеивание (рад)
   adsSpread— рассеивание в прицеле
   recoil   — вертикальная отдача
   adsTime  — сек до полного прицела
   auto     — автоматический огонь
   range    — падение урона
   slot     — 0/1
*/
export const WEAPONS = {
  /* --- ОСНОВНЫЕ --- */
  vixen: {
    id: 'vixen', name: 'AR-77 «ВИКСЕН»', type: 'ШТУРМОВАЯ ВИНТОВКА', kind: 'primary', slot: 0,
    desc: 'Штатная винтовка коалиции VEGA. Сбалансированная отдача, высокая скорострельность, работает в любую погоду.',
    dmg: 26, rpm: 660, mag: 30, reserve: 210, reload: 2.1, spread: 0.017, adsSpread: 0.0035,
    recoil: 0.021, adsTime: 0.19, auto: true, range: 85, speed: 420, unlockLvl: 1,
    bars: { урон: .55, Темп: .72, Точность: .68, Дальность: .62, Обращение: .8 },
    color: 0x2b3a46, accent: 0x38bdf8
  },
  bulat: {
    id: 'bulat', name: 'AK-M «БУЛАТ»', type: 'ШТУРМОВАЯ ВИНТОВКА', kind: 'primary', slot: 0,
    desc: 'Тяжёлый патрон 7.62 альянса ARGO. Пробивает лёгкие укрытия, отдача злая, но урон решает.',
    dmg: 34, rpm: 580, mag: 30, reserve: 180, reload: 2.4, spread: 0.022, adsSpread: 0.0045,
    recoil: 0.031, adsTime: 0.23, auto: true, range: 95, speed: 400, unlockLvl: 2,
    bars: { Урон: .74, Темп: .62, Точность: .55, Дальность: .7, Обращение: .6 },
    color: 0x3d2f22, accent: 0xf0a93b
  },
  osa: {
    id: 'osa', name: 'MP-9 «ОСА»', type: 'ПИСТОЛЕТ-ПУЛЕМЁТ', kind: 'primary', slot: 0,
    desc: 'Компактный ПП для зачистки помещений и работы по дронам. Огромный темп, малая дальность.',
    dmg: 17, rpm: 900, mag: 36, reserve: 252, reload: 1.8, spread: 0.026, adsSpread: 0.008,
    recoil: 0.014, adsTime: 0.14, auto: true, range: 45, speed: 380, unlockLvl: 1,
    bars: { Урон: .34, Темп: .95, Точность: .5, Дальность: .3, Обращение: .96 },
    color: 0x1f2731, accent: 0x9d7bff
  },
  sokol: {
    id: 'sokol', name: 'SV-24 «СОКОЛ»', type: 'МАРКСМАНСКАЯ ВИНТОВКА', kind: 'primary', slot: 0,
    desc: 'Полуавтоматическая марксманка. Один точный выстрел в голову снимает цель без брони.',
    dmg: 62, rpm: 190, mag: 12, reserve: 72, reload: 2.8, spread: 0.03, adsSpread: 0.0006,
    recoil: 0.055, adsTime: 0.3, auto: false, range: 220, speed: 900, unlockLvl: 4,
    bars: { Урон: .92, Темп: .3, Точность: .95, Дальность: .95, Обращение: .4 },
    color: 0x33412b, accent: 0x3ddc97, scope: 2.6
  },
  groza: {
    id: 'groza', name: 'LM-8 «ГРОЗА»', type: 'РУЧНОЙ ПУЛЕМЁТ', kind: 'primary', slot: 0,
    desc: 'Лёгкий пулемёт поддержки. Длинная лента, сошки, подавление — то, что нужно на точке.',
    dmg: 24, rpm: 720, mag: 75, reserve: 300, reload: 4.4, spread: 0.028, adsSpread: 0.009,
    recoil: 0.026, adsTime: 0.34, auto: true, range: 80, speed: 400, unlockLvl: 6,
    bars: { Урон: .5, Темп: .78, Точность: .45, Дальность: .58, Обращение: .25 },
    color: 0x2a2f36, accent: 0xff8a4d
  },
  kuvalda: {
    id: 'kuvalda', name: 'SG-4 «КУВАЛДА»', type: 'ДРОБОВИК', kind: 'primary', slot: 0,
    desc: 'Помповый дробовик. До 15 метров — приговор. Дальше — лотерея.',
    dmg: 13, pellets: 9, rpm: 70, mag: 6, reserve: 42, reload: 0.55, perShell: true,
    spread: 0.075, adsSpread: 0.05, recoil: 0.09, adsTime: 0.24, auto: false, range: 26,
    speed: 300, unlockLvl: 3,
    bars: { Урон: .98, Темп: .14, Точность: .2, Дальность: .12, Обращение: .45 },
    color: 0x43331f, accent: 0xff4d57
  },
  shershen: {
    id: 'shershen', name: 'ПТРК «ШЕРШЕНЬ»', type: 'ГРАНАТОМЁТ', kind: 'primary', slot: 0,
    desc: 'Противотанковый комплекс с тандемной БЧ. Уничтожает технику одним попаданием.',
    dmg: 210, rpm: 30, mag: 1, reserve: 4, reload: 3.6, spread: 0.004, adsSpread: 0.001,
    recoil: 0.13, adsTime: 0.4, auto: false, range: 300, speed: 120, explosive: 7.5,
    unlockLvl: 8,
    bars: { Урон: 1, Темп: .06, Точность: .8, Дальность: .9, Обращение: .18 },
    color: 0x3a3d2a, accent: 0xffd24d
  },

  /* --- ВТОРЫЕ --- */
  gyurza: {
    id: 'gyurza', name: 'П-9 «ГЮРЗА»', type: 'ПИСТОЛЕТ', kind: 'secondary', slot: 1,
    desc: 'Армейский пистолет. Быстрое извлечение, надёжен как запасной ствол.',
    dmg: 24, rpm: 420, mag: 17, reserve: 102, reload: 1.6, spread: 0.02, adsSpread: 0.006,
    recoil: 0.019, adsTime: 0.12, auto: false, range: 40, speed: 360, unlockLvl: 1,
    bars: { Урон: .4, Темп: .5, Точность: .6, Дальность: .3, Обращение: .9 },
    color: 0x20262e, accent: 0x8fd3ff
  },
  revansh: {
    id: 'revansh', name: 'RH-35 «РЕВАНШ»', type: 'РЕВОЛЬВЕР', kind: 'secondary', slot: 1,
    desc: 'Крупнокалиберный револьвер. Тяжёлая пуля пробивает шлем на дистанции.',
    dmg: 68, rpm: 150, mag: 6, reserve: 30, reload: 3.0, spread: 0.024, adsSpread: 0.004,
    recoil: 0.075, adsTime: 0.2, auto: false, range: 70, speed: 430, unlockLvl: 5,
    bars: { Урон: .95, Темп: .2, Точность: .7, Дальность: .5, Обращение: .5 },
    color: 0x2c2620, accent: 0xf0a93b
  },
  vektr: {
    id: 'vektr', name: 'MP-5 «ВЕКТОР»', type: 'ПЯ / ПП-ГИБРИД', kind: 'secondary', slot: 1,
    desc: 'Скорострельный ПП-гибрид. Отличная замена основному стволу в ближнем бою.',
    dmg: 19, rpm: 850, mag: 25, reserve: 150, reload: 1.9, spread: 0.024, adsSpread: 0.007,
    recoil: 0.016, adsTime: 0.15, auto: true, range: 50, speed: 380, unlockLvl: 3,
    bars: { Урон: .36, Темп: .9, Точность: .55, Дальность: .35, Обращение: .92 },
    color: 0x252b33, accent: 0x9d7bff
  },

  /* --- СНАРЯЖЕНИЕ --- */
  frag: {
    id: 'frag', name: 'ОСКОЛОЧНАЯ РГ-6', type: 'ЛЕТАЛЬНАЯ ГРАНАТА', kind: 'gadget',
    desc: 'Осколочная граната с 4-секундным взрывателем. Чистит окопы и помещения.',
    dmg: 118, radius: 6.5, unlockLvl: 1, count: 2,
    bars: { Урон: .9, Радиус: .55, Скорость: .7 }
  },
  smoke: {
    id: 'smoke', name: 'ДЫМОВАЯ ГР-1', type: 'ДЫМОВАЯ ЗАВЕСА', kind: 'gadget',
    desc: 'Плотная завеса на 18 секунд. Переход через простреливаемое поле или эвакуация.',
    duration: 18, radius: 7, unlockLvl: 1, count: 2,
    bars: { Укрытие: .95, Длительность: .8, Радиус: .6 }
  },
  plate: {
    id: 'plate', name: 'БРОНЕПЛАСТИНА', type: 'ВОССТАНОВЛЕНИЕ БРОНИ', kind: 'gadget',
    desc: 'Мгновенно восстанавливает 50 единиц брони. Работает в движении.',
    armor: 50, unlockLvl: 1, count: 2,
    bars: { Броня: .8, Скорость: 1, Радиус: 0 }
  },
  uav: {
    id: 'uav', name: 'РАЗВЕДЧИК «ОКО»', type: 'ТАКТИЧЕСКИЙ БПЛА', kind: 'gadget',
    desc: 'Автономный разведчик: 25 секунд подсвечивает противников на миникарте.',
    duration: 25, unlockLvl: 7, count: 1,
    bars: { Разведка: 1, Длительность: .6, Радиус: .9 }
  },
  mine: {
    id: 'mine', name: 'МИНА «ЖАЛО»', type: 'ПРОТИВОПЕХОТНАЯ МИНА', kind: 'gadget',
    desc: 'Устанавливаемая мина с лучевым взрывателем. Охрана фланга и точек.',
    dmg: 95, radius: 5, unlockLvl: 5, count: 3,
    bars: { Урон: .75, Радиус: .4, Скорость: .35 }
  }
};

/* ---------- ДРОНЫ ---------- */
export const DRONES = {
  striker: {
    id: 'striker', name: 'ФПВ «СТРИЖ»', type: 'УДАРНЫЙ ФПВ-ДРОН',
    desc: 'Гоночный квадрокоптер с кумулятивным зарядом. Пилотирование от первого лица, прямое попадание по технике.',
    speed: 34, agility: 2.6, battery: 55, warhead: 260, radius: 9, unlockLvl: 1,
    bars: { Скорость: .85, Манёвр: .9, Батарея: .6, Боезаряд: .95 }
  },
  hornet: {
    id: 'hornet', name: 'ФПВ «ШЕРШЕНЬ-М»', type: 'ТЯЖЁЛЫЙ УДАРНЫЙ БПЛА',
    desc: 'Крупный дрон с усиленной БЧ и бронированием рамы. Медленнее, но держит попадание из ПП.',
    speed: 26, agility: 1.9, battery: 62, warhead: 400, radius: 12, unlockLvl: 5,
    bars: { Скорость: .6, Манёвр: .55, Батарея: .7, Боезаряд: 1 }
  },
  swift: {
    id: 'swift', name: 'ФПВ «ЛАСТОЧКА»', type: 'СКОРОСТНОЙ ПЕРЕХВАТЧИК',
    desc: 'Лёгкая рама, максимальная скорость. Создан для охоты на чужие дроны и расчёты ПВО.',
    speed: 46, agility: 3.4, battery: 42, warhead: 160, radius: 6.5, unlockLvl: 9,
    bars: { Скорость: 1, Манёвр: 1, Батарея: .45, Боезаряд: .6 }
  }
};

/* ---------- ТЕХНИКА ---------- */
export const VEHICLES = {
  bulat_mb: {
    id: 'bulat_mb', name: 'Т-9 «БУЛАТ»', type: 'ОСНОВНОЙ ТАНК',
    desc: '125-мм гладкоствольная пушка, спаренный пулемёт. Медленный, но держит прямое попадание ПТРК.',
    hp: 900, speed: 15, turn: 0.9, cannon: { dmg: 380, rpm: 8, radius: 8, reload: 7.5 },
    mg: { dmg: 20, rpm: 520 }, unlockLvl: 1
  },
  kolchuga: {
    id: 'kolchuga', name: 'БТР-8 «КОЛЬЧУГА»', type: 'БРОНЕТРАНСПОРТЁР',
    desc: 'Колёсный БТР с 30-мм автопушкой. Возит четверых десантников, быстро разгоняется.',
    hp: 520, speed: 24, turn: 1.5, cannon: { dmg: 95, rpm: 150, radius: 4.5, reload: 0.4 },
    mg: null, seats: 4, unlockLvl: 1
  },
  rys: {
    id: 'rys', name: 'БАГГИ «РЫСЬ»', type: 'РАЗВЕДЫВАТЕЛЬНАЯ МАШИНА',
    desc: 'Открытая рама, огромный ход, ноль брони. Идеальна для рейдов и эвакуации.',
    hp: 200, speed: 34, turn: 2.3, cannon: null, mg: null, seats: 2, unlockLvl: 1
  },
  zmey: {
    id: 'zmey', name: 'БМП-4 «ЗМЕЙ»', type: 'БОЕВАЯ МАШИНА ПЕХОТЫ',
    desc: 'Гусеничная БМП с ПТУР на борту. Баланс между огнём, бронёй и мобильностью.',
    hp: 680, speed: 19, turn: 1.2, cannon: { dmg: 150, rpm: 60, radius: 6, reload: 1.0 },
    mg: { dmg: 18, rpm: 480 }, seats: 3, unlockLvl: 4
  }
};

/* ---------- КАРТЫ ---------- */
export const MAPS = {
  meridian: {
    id: 'meridian', name: 'ДОЛИНА МЕРИДИАНА', size: 460, hills: 1.0, urban: 0.55, forest: 0.6,
    desc: 'Широкая речная долина: мост, радиовышка, агрокомплекс и лесополосы.',
    palette: { ground: 0x4a5a33, ground2: 0x6b6440, rock: 0x5c574d, fog: 0x9fb4c4 },
    sky: 0x8fb2c9, sun: 0xfff1d6
  },
  ridge: {
    id: 'ridge', name: 'ХРЕБЕТ КРОН', size: 400, hills: 2.1, urban: 0.25, forest: 0.45,
    desc: 'Горный серпантин, перевал и брошенная обсерватория. Дальнобойные дуэли.',
    palette: { ground: 0x575449, ground2: 0x7a7566, rock: 0x6e6a5e, fog: 0xa8b0b8 },
    sky: 0xbcc7ce, sun: 0xfff6e2
  },
  urban: {
    id: 'urban', name: 'КВАРТАЛ СЕВЕРНЫЙ', size: 330, hills: 0.35, urban: 1.5, forest: 0.18,
    desc: 'Плотная застройка, дворы-колодцы, подземный переход. Ближний бой.',
    palette: { ground: 0x4d4d4a, ground2: 0x5f5d58, rock: 0x6a6660, fog: 0x8f969c },
    sky: 0x97a3ab, sun: 0xffe9c9
  }
};

/* ---------- РАНГИ ---------- */
/* 24 ранга, 5 дивизионов по цветам, xp = суммарный порог входа в ранг */
export const RANKS = [
  { n: 'НОВОБРАНЕЦ',        lvl: 1,  xp: 0,      t: 'bronze' },
  { n: 'РЯДОВОЙ',           lvl: 2,  xp: 300,    t: 'bronze' },
  { n: 'ЕФРЕЙТОР',          lvl: 3,  xp: 800,    t: 'bronze' },
  { n: 'МЛАДШИЙ СЕРЖАНТ',   lvl: 4,  xp: 1600,   t: 'bronze' },
  { n: 'СЕРЖАНТ',           lvl: 5,  xp: 2700,   t: 'bronze' },
  { n: 'СТАРШИНА',          lvl: 6,  xp: 4200,   t: 'bronze' },

  { n: 'МЛАДШИЙ ЛЕЙТЕНАНТ', lvl: 7,  xp: 6200,   t: 'steel' },
  { n: 'ЛЕЙТЕНАНТ',         lvl: 8,  xp: 8600,   t: 'steel' },
  { n: 'СТАРЛЕЙ',           lvl: 9,  xp: 11500,  t: 'steel' },
  { n: 'КАПИТАН',           lvl: 10, xp: 15000,  t: 'steel' },
  { n: 'МАЙОР',             lvl: 11, xp: 19200,  t: 'steel' },
  { n: 'ПОДПОЛКОВНИК',      lvl: 12, xp: 24200,  t: 'steel' },

  { n: 'ПОЛКОВНИК',         lvl: 13, xp: 30000,  t: 'gold' },
  { n: 'ШТУРМАН',           lvl: 14, xp: 36500,  t: 'gold' },
  { n: 'ОПЕРАТОР БПЛА',     lvl: 15, xp: 43800,  t: 'gold' },
  { n: 'ТАНКИСТ-АС',        lvl: 16, xp: 52000,  t: 'gold' },
  { n: 'ГЕНЕРАЛ-МАЙОР',     lvl: 17, xp: 61000,  t: 'gold' },
  { n: 'ГЕНЕРАЛ-ЛЕЙТЕНАНТ', lvl: 18, xp: 71500,  t: 'gold' },

  { n: 'ГЕНЕРАЛ АРМИИ',     lvl: 19, xp: 84000,  t: 'obsidian' },
  { n: 'МАРШАЛ',            lvl: 20, xp: 98000,  t: 'obsidian' },
  { n: 'ЛЕГЕНДА МЕРИДИАНА', lvl: 21, xp: 115000, t: 'obsidian' },

  { n: 'ПРЕТОРИАНЕЦ',       lvl: 22, xp: 136000, t: 'mythic' },
  { n: 'ВОЕННЫЙ ГЕНИЙ',     lvl: 23, xp: 162000, t: 'mythic' },
  { n: 'МЕРИДИАН · АБСОЛЮТ',lvl: 24, xp: 195000, t: 'mythic' }
];

export const RANK_TIER = {
  bronze:   { css: '#c98b52', name: 'БРОНЗА' },
  steel:    { css: '#9fb2c4', name: 'СТАЛЬ' },
  gold:     { css: '#f0c95b', name: 'ЗОЛОТО' },
  obsidian: { css: '#9d7bff', name: 'ОБСИДИАН' },
  mythic:   { css: '#ff5f8f', name: 'МИФ' }
};

export function rankByXp(xp) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) idx = i;
  const cur = RANKS[idx];
  const next = RANKS[idx + 1] || null;
  const span = next ? next.xp - cur.xp : 1;
  const prog = next ? Math.min(1, (xp - cur.xp) / span) : 1;
  return { idx, cur, next, prog, xpInto: xp - cur.xp, xpSpan: span };
}

/* SVG-иконка ранга (процедурная) */
export function rankSvg(idx, size = 40) {
  const r = RANKS[idx] || RANKS[0];
  const c = RANK_TIER[r.t].css;
  const chevrons = Math.min(4, Math.floor(idx / 3) + 1);
  const star = idx >= 12;
  const crown = idx >= 18;
  const halo = idx >= 21;
  let inner = '';
  for (let i = 0; i < chevrons; i++) {
    const y = 40 - i * 9;
    inner += `<path d="M22 ${y} L32 ${y - 7} L42 ${y}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="square"/>`;
  }
  if (star) inner += `<path d="M32 8 L34.6 14 L41 14.6 L36.2 18.8 L37.6 25 L32 21.8 L26.4 25 L27.8 18.8 L23 14.6 L29.4 14 Z" fill="${c}" opacity=".92"/>`;
  if (crown) inner += `<path d="M14 52 L50 52 L46 60 L18 60 Z" fill="${c}" opacity=".8"/>`;
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}">
    <polygon points="32,3 59,19 59,45 32,61 5,45 5,19" fill="none" stroke="${c}" stroke-width="${halo ? 3.2 : 2}" opacity="${halo ? 1 : .7}"/>
    ${halo ? `<polygon points="32,8 55,21 55,43 32,56 9,43 9,21" fill="${c}" opacity=".12"/>` : ''}
    ${inner}
  </svg>`;
}

export const MODES = {
  tdm: { id: 'tdm', name: 'КОМАНДНЫЙ БОЙ', icon: '⚔', limit: 60, time: 900,
    desc: 'Две команды, игроки и боты. Побеждает команда, первой набравшая лимит фрагов.' },
  dom: { id: 'dom', name: 'ДОМИНИРОВАНИЕ', icon: '⚑', limit: 250, time: 900,
    desc: 'Три контрольные точки. Каждая удержанная точка даёт очко каждые 3 секунды.' },
  pve: { id: 'pve', name: 'ЗАЧИСТКА (PvE)', icon: '☠', limit: 15, time: 1200,
    desc: 'Команда игроков против волн ботов. Продержитесь 15 волн.' },
  pvp: { id: 'pvp', name: 'ДУЭЛЬ (PvP)', icon: '◎', limit: 40, time: 600,
    desc: 'Только живые игроки. Никаких ботов — чистое мастерство.' }
};

export const BOT_NAMES = [
  'КРЕЧЕТ','ГРАНИТ','ШТОРМ','ВЕТКА','СОКОЛ','БАРОН','ТИТАН','РОСА','ЯСТРЕБ','КЛИН',
  'ОМЕГА','ФЕНИКС','САПСАН','БУРАН','КОБРА','ЗИМИН','СКАЛА','ВОЛК','РЕЙД','КАСКАД',
  'ЗЕНИТ','МОРЕНА','ТАЙФУН','ОПУХ','РИФ','ХВОЩ','ДРОЗД','ЛУНА','СЕВЕР','ИЗЛОМ',
  'ГИЛЬЗА','КЕДР','ОБЛОМ','ПРИЗМА','СКАТ','ТОРНАДО','УРАГАН','ХВОСТ','ЧАЙКА','ШКВАЛ'
];
