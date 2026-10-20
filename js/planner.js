// Plan generation + load progression. Pure functions, no DOM.
import { doneSets } from './stats.js';

const DAY = 864e5;

export const GOALS = {
  sila: { label: 'Sila', compound: { sets: 4, min: 4, max: 6, rest: 180 }, iso: { sets: 3, min: 8, max: 12, rest: 90 } },
  hypertrofia: { label: 'Svaly (objem)', compound: { sets: 3, min: 6, max: 10, rest: 120 }, iso: { sets: 3, min: 10, max: 15, rest: 75 } },
  kondicia: { label: 'Kondícia a chudnutie', compound: { sets: 3, min: 12, max: 15, rest: 60 }, iso: { sets: 2, min: 15, max: 20, rest: 45 }, cardio: 15 },
};

export const LEVELS = {
  zaciatocnik: { label: 'Začiatočník', maxLevel: 1, setDelta: 0 },
  mierne: { label: 'Mierne pokročilý', maxLevel: 2, setDelta: 0 },
  pokrocily: { label: 'Pokročilý', maxLevel: 3, setDelta: 1 },
};

// Movement-pattern slots per day, most important first (trimmed by session length).
const T = {
  fullA: ['Celé telo A', ['squat', 'hpush', 'vpull', 'hinge', 'lateral', 'core', 'biceps']],
  fullB: ['Celé telo B', ['hinge', 'vpush', 'hpull', 'lunge', 'chestIso', 'triceps', 'calf']],
  fullC: ['Celé telo C', ['squat', 'hpush', 'hpull', 'kneeFlex', 'rearDelt', 'core', 'kneeExt']],
  upper1: ['Horná časť A', ['hpush', 'vpull', 'vpush', 'hpull', 'lateral', 'triceps', 'biceps']],
  upper2: ['Horná časť B', ['hpull', 'hpush', 'vpull', 'chestIso', 'rearDelt', 'biceps', 'triceps']],
  lower1: ['Spodná časť A', ['squat', 'hinge', 'kneeExt', 'kneeFlex', 'calf', 'core', 'glute']],
  lower2: ['Spodná časť B', ['hinge', 'lunge', 'glute', 'kneeFlex', 'kneeExt', 'calf', 'core']],
  push: ['Push (tlaky)', ['hpush', 'vpush', 'chestIso', 'lateral', 'triceps', 'hpush', 'triceps']],
  pull: ['Pull (ťahy)', ['vpull', 'hpull', 'rearDelt', 'biceps', 'hpull', 'biceps', 'core']],
  legs: ['Nohy', ['squat', 'hinge', 'kneeExt', 'kneeFlex', 'calf', 'glute', 'core']],
};

export const SPLITS = {
  2: ['fullA', 'fullB'],
  3: ['fullA', 'fullB', 'fullC'],
  4: ['upper1', 'lower1', 'upper2', 'lower2'],
  5: ['upper1', 'lower1', 'push', 'pull', 'legs'],
  6: ['push', 'pull', 'legs', 'push', 'pull', 'legs'],
};

export const SPLIT_NAMES = { 2: 'Celé telo 2×', 3: 'Celé telo 3×', 4: 'Horná / spodná', 5: 'Horná/spodná + PPL', 6: 'Push / Pull / Nohy 2×' };

const slotsFor = (minutes) => (minutes <= 45 ? 4 : minutes <= 60 ? 5 : minutes <= 75 ? 6 : 7);

function scheme(ex, goal, level) {
  const g = GOALS[goal];
  const s = { ...(ex.compound ? g.compound : g.iso) };
  if (ex.compound) s.sets = Math.max(2, s.sets + LEVELS[level].setDelta);
  return { sets: s.sets, repsMin: s.min, repsMax: s.max, rest: s.rest };
}

export function candidates(pattern, exercises, { level = 'pokrocily', exclude = [] } = {}) {
  const ok = exercises.filter((e) => e.pattern === pattern && !exclude.includes(e.id));
  const easy = ok.filter((e) => e.level <= LEVELS[level].maxLevel);
  return (easy.length ? easy : ok).sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
}

export function generatePlan(settings, exercises, seed = Date.now()) {
  const { days, goal, level, minutes, exclude = [] } = settings;
  const used = {}; // pattern -> times used in plan, so repeated slots rotate variants
  const slots = slotsFor(minutes);
  const planDays = SPLITS[days].map((key) => {
    const [name, patterns] = T[key];
    const items = [];
    for (const pattern of patterns) {
      if (items.length >= slots) break;
      const pool = candidates(pattern, exercises, { level, exclude }).filter((e) => !items.some((i) => i.exId === e.id));
      if (!pool.length) continue;
      const k = used[pattern] = (used[pattern] ?? seed % 7) + 1;
      const ex = pool[k % pool.length];
      items.push({ exId: ex.id, pattern, ...scheme(ex, goal, level) });
    }
    if (GOALS[goal].cardio) {
      const c = candidates('cardio', exercises, { level, exclude });
      if (c.length) items.push({ exId: c[(used.cardio = (used.cardio ?? seed % 5) + 1) % c.length].id, pattern: 'cardio', sets: 1, repsMin: GOALS[goal].cardio, repsMax: GOALS[goal].cardio, rest: 0 });
    }
    return { name, items };
  });
  return { id: 'p' + seed.toString(36), created: Date.now(), settings: { ...settings }, days: planDays };
}

// Replace one item with the next alternative of the same pattern.
export function swapItem(plan, dayIdx, itemIdx, exercises, exById) {
  const day = plan.days[dayIdx];
  const it = day.items[itemIdx];
  const pool = candidates(it.pattern, exercises, plan.settings);
  if (pool.length < 2) return false;
  const inDay = new Set(day.items.map((i) => i.exId));
  const start = pool.findIndex((e) => e.id === it.exId);
  for (let n = 1; n < pool.length; n++) {
    const ex = pool[(start + n) % pool.length];
    if (!inDay.has(ex.id)) {
      day.items[itemIdx] = it.pattern === 'cardio' ? { ...it, exId: ex.id } : { exId: ex.id, pattern: it.pattern, ...scheme(exById[ex.id], plan.settings.goal, plan.settings.level) };
      return true;
    }
  }
  return false;
}

export const planWeek = (plan, now = Date.now()) => Math.floor((now - plan.created) / (7 * DAY)) + 1;
// Every 6th week is a deload: ~60 % sets, ~90 % load.
export const isDeload = (plan, now = Date.now()) => planWeek(plan, now) % 6 === 0;

export function nextDayIndex(plan, workouts) {
  for (let i = workouts.length - 1; i >= 0; i--) {
    const w = workouts[i];
    if (w.planId === plan.id && w.dayIdx != null) return (w.dayIdx + 1) % plan.days.length;
  }
  return 0;
}

const roundTo = (x, step) => Math.round(x / step) * step;

// Double progression. Returns { kg|null, sets, note, trend: 'up'|'same'|'down'|'new' }.
export function suggest(item, ex, workouts, { deload = false } = {}) {
  const sessions = [];
  for (let i = workouts.length - 1; i >= 0 && sessions.length < 2; i--) {
    const en = workouts[i].entries.find((e) => e.exId === item.exId);
    const sets = doneSets(en);
    if (sets.length) sessions.push(sets);
  }
  const sets = deload ? Math.max(1, Math.round(item.sets * 0.6)) : item.sets;
  if (item.pattern === 'cardio') return { kg: null, sets, note: `${item.repsMin} min v miernom tempe`, trend: 'new' };
  const step = ex.increment || 2.5;
  if (!sessions.length)
    return { kg: null, sets, note: `Prvýkrát: zvoľ váhu, s ktorou dáš ${item.repsMax} opakovaní a 2 by ešte išli.`, trend: 'new' };
  const last = sessions[0];
  const kg = Math.max(...last.map((s) => s.kg || 0));
  const top = last.filter((s) => (s.kg || 0) === kg);
  if (kg === 0) {
    const best = Math.max(...last.map((s) => s.reps));
    return { kg: 0, sets, note: `Vlastná váha — minule max ${best} opak., skús o 1 viac.`, trend: 'same' };
  }
  if (deload) return { kg: roundTo(kg * 0.9, step), sets, note: 'Deload týždeň: menej sérií, ľahšia váha, regenerácia.', trend: 'down' };
  const allHit = last.length >= item.sets && top.every((s) => s.reps >= item.repsMax);
  if (allHit) return { kg: kg + step, sets, note: `Minule ${kg} kg × ${item.repsMax}+ vo všetkých sériách → pridaj ${step} kg.`, trend: 'up' };
  const missed = (ss) => ss.some((s) => s.reps < item.repsMin);
  if (sessions.length === 2 && missed(sessions[0]) && missed(sessions[1]) && Math.max(...sessions[1].map((s) => s.kg || 0)) === kg) {
    return { kg: roundTo(kg * 0.9, step), sets, note: `2× pod ${item.repsMin} opak. pri ${kg} kg → uber 10 % a buduj znova.`, trend: 'down' };
  }
  return { kg, sets, note: `Zostaň na ${kg} kg a skús pridať opakovanie (cieľ ${item.repsMax}).`, trend: 'same' };
}
