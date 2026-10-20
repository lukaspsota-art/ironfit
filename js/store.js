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

const ALLOWED = {
  goal: ['sila', 'hypertrofia', 'kondicia'],
  level: ['zaciatocnik', 'mierne', 'pokrocily'],
  days: [2, 3, 4, 5, 6],
  minutes: [45, 60, 75, 90],
  theme: ['auto', 'dark', 'light'],
};

const fresh = () => ({ version: 1, settings: { ...DEFAULT_SETTINGS }, plan: null, workouts: [], active: null });

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    return normalize(JSON.parse(raw));
  } catch {
    // keep the unreadable data aside instead of overwriting it on the next save
    try { if (raw) localStorage.setItem(`${KEY}.corrupt-${Date.now()}`, raw); } catch { /* storage unavailable */ }
    return fresh();
  }
}

const num = (v, min = 0) => (Number.isFinite(+v) && +v >= min ? +v : min);
const str = (v) => (typeof v === 'string' ? v : '');
const ID = /^[\w-]{1,64}$/;

function cleanSettings(s = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of ['goal', 'level', 'theme']) if (ALLOWED[k].includes(s[k])) out[k] = s[k];
  for (const k of ['days', 'minutes']) if (ALLOWED[k].includes(+s[k])) out[k] = +s[k];
  if (Number.isFinite(+s.bar) && +s.bar >= 0) out.bar = +s.bar;
  for (const k of ['autoRest', 'sound']) if (typeof s[k] === 'boolean') out[k] = s[k];
  out.exclude = Array.isArray(s.exclude) ? s.exclude.filter((x) => typeof x === 'string' && ID.test(x)) : [];
  return out;
}

const cleanSets = (sets) => (Array.isArray(sets) ? sets : []).filter((x) => x && typeof x === 'object');
const cleanPrs = (prs) => (Array.isArray(prs) ? prs : [])
  .filter((r) => r && typeof r.exId === 'string')
  .map((r) => ({ exId: r.exId, label: str(r.label), kg: num(r.kg), reps: num(r.reps) }));

function cleanPlan(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.days) || !p.days.length) return null;
  const s = p.settings || {};
  if (!ALLOWED.goal.includes(s.goal) || !ALLOWED.level.includes(s.level) || !ALLOWED.days.includes(+s.days)) return null;
  const days = p.days.map((d) => ({
    name: str(d?.name) || 'Deň',
    items: (Array.isArray(d?.items) ? d.items : [])
      .filter((it) => it && typeof it.exId === 'string' && typeof it.pattern === 'string')
      .map((it) => ({ exId: it.exId, pattern: it.pattern, sets: Math.max(1, num(it.sets, 1)), repsMin: num(it.repsMin, 1), repsMax: Math.max(num(it.repsMin, 1), num(it.repsMax, 1)), rest: num(it.rest) })),
  }));
  return { id: ID.test(p.id) ? p.id : 'p' + Date.now().toString(36), created: Number.isFinite(+p.created) ? +p.created : Date.now(), settings: cleanSettings(s), days };
}

function cleanActive(a) {
  if (!a || typeof a !== 'object' || !Array.isArray(a.entries) || !Number.isFinite(+a.started)) return null;
  return {
    ...a,
    id: ID.test(a.id) ? a.id : 'w' + Date.now().toString(36),
    started: +a.started,
    name: str(a.name) || 'Tréning',
    prs: cleanPrs(a.prs),
    entries: a.entries
      .filter((e) => e && typeof e.exId === 'string')
      .map((e) => ({ ...e, sets: cleanSets(e.sets).map((x) => ({ kg: x.kg === '' ? '' : num(x.kg), reps: x.reps === '' ? '' : num(x.reps), done: !!x.done })) })),
  };
}

// Accept unknown/partial input (imports, old versions) and coerce it into a valid state.
// Unknown exercise ids are kept (history survives library changes); views skip them.
export function normalize(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Neplatný súbor');
  const seen = new Set();
  const workouts = (Array.isArray(s.workouts) ? s.workouts : [])
    .filter((w) => w && Array.isArray(w.entries) && Number.isFinite(+w.date))
    .map((w) => {
      let id = ID.test(w.id) ? w.id : 'w' + (+w.date).toString(36);
      while (seen.has(id)) id += 'x';
      seen.add(id);
      return {
        id,
        date: +w.date,
        name: str(w.name),
        duration: num(w.duration),
        planId: typeof w.planId === 'string' ? w.planId : null,
        dayIdx: Number.isInteger(w.dayIdx) ? w.dayIdx : null,
        deload: !!w.deload,
        prs: cleanPrs(w.prs),
        entries: w.entries
          .filter((e) => e && typeof e.exId === 'string')
          .map((e) => ({ exId: e.exId, sets: cleanSets(e.sets).map((x) => ({ kg: num(x.kg), reps: num(x.reps), done: !!x.done })) })),
      };
    })
    .sort((a, b) => a.date - b.date);
  return { version: 1, settings: cleanSettings(s.settings), plan: cleanPlan(s.plan), active: cleanActive(s.active), workouts };
}

let state = load();
const subs = new Set();
let saveError = null;
let timer = 0;

export const get = () => state;
export const lastSaveError = () => saveError;
// fn(state) is called when another tab changed the data
export const subscribe = (fn) => (subs.add(fn), () => subs.delete(fn));

export function save() {
  clearTimeout(timer);
  timer = 0;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveError = null;
  } catch (e) {
    if (!saveError) dispatchEvent(new CustomEvent('fitapp:saveerror'));
    saveError = e;
  }
}

export function update(fn) {
  fn(state);
  save();
}

// For high-frequency edits (typing): mutate now, write shortly after.
export function updateSoon(fn) {
  fn(state);
  clearTimeout(timer);
  timer = setTimeout(save, 400);
}
const flush = () => timer && save();
const browser = typeof window !== 'undefined';
if (browser) {
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}

export const exportJSON = () => JSON.stringify({ ...state, exportedAt: new Date().toISOString(), app: 'IronFit' }, null, 1);

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
if (browser) {
  addEventListener('storage', (e) => {
    if (e.key === KEY) {
      state = load();
      subs.forEach((fn) => fn(state));
    }
  });
}
