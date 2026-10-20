// localStorage persistence with versioned state and JSON backup.
const KEY = 'fitapp.v1';

export const DEFAULT_SETTINGS = {
  goal: 'hypertrofia',
  days: 3,
  level: 'zaciatocnik',
  minutes: 60,
  exclude: [],
  bar: 20,
  autoRest: true,
  sound: true,
  theme: 'auto',
};

const fresh = () => ({ version: 1, settings: { ...DEFAULT_SETTINGS }, plan: null, workouts: [], active: null });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    return normalize(JSON.parse(raw));
  } catch {
    return fresh();
  }
}

// Accept unknown/partial input (imports, old versions) and coerce it into a valid state.
export function normalize(s) {
  if (!s || typeof s !== 'object') throw new Error('Neplatný súbor');
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const workouts = Array.isArray(s.workouts) ? s.workouts : [];
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    plan: s.plan && Array.isArray(s.plan.days) ? s.plan : null,
    active: s.active && Array.isArray(s.active.entries) ? s.active : null,
    workouts: workouts
      .filter((w) => w && Array.isArray(w.entries) && Number.isFinite(+w.date))
      .map((w) => ({
        ...w,
        id: String(w.id || 'w' + w.date),
        date: +w.date,
        entries: w.entries
          .filter((e) => e && typeof e.exId === 'string')
          .map((e) => ({ exId: e.exId, sets: (Array.isArray(e.sets) ? e.sets : []).map((x) => ({ kg: num(x.kg), reps: num(x.reps), done: !!x.done })) })),
      }))
      .sort((a, b) => a.date - b.date),
  };
}

let state = load();
const subs = new Set();
let saveError = null;

export const get = () => state;
export const lastSaveError = () => saveError;
export const subscribe = (fn) => (subs.add(fn), () => subs.delete(fn));

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveError = null;
  } catch (e) {
    saveError = e;
  }
  subs.forEach((fn) => fn(state));
}

export function update(fn) {
  fn(state);
  save();
}

export const exportJSON = () => JSON.stringify({ ...state, exportedAt: new Date().toISOString(), app: 'FitApp' }, null, 1);

export function importJSON(text) {
  state = normalize(JSON.parse(text));
  save();
}

export function reset() {
  state = fresh();
  save();
}

// Ask the browser not to evict our data (best effort).
export const persist = () => navigator.storage?.persist?.().catch(() => false);

// other tabs
addEventListener('storage', (e) => {
  if (e.key === KEY) {
    state = load();
    subs.forEach((fn) => fn(state));
  }
});
