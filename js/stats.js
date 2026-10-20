// Pure functions: e1RM, personal records, history, muscle fatigue. No DOM.

const DAY = 864e5;

// Epley; reliable up to ~10 reps, approximate beyond.
export const e1rm = (kg, reps) => (kg > 0 && reps > 0 ? (reps === 1 ? kg : kg * (1 + reps / 30)) : 0);

export const doneSets = (entry) => (entry?.sets || []).filter((s) => s.done && s.reps > 0);

// [{ date, workoutId, sets, topKg, best1rm, volume, reps }] oldest first
export function exerciseHistory(workouts, exId) {
  const out = [];
  for (const w of workouts) {
    for (const en of w.entries) {
      if (en.exId !== exId) continue;
      const sets = doneSets(en);
      if (!sets.length) continue;
      out.push({
        date: w.date,
        workoutId: w.id,
        sets,
        topKg: Math.max(...sets.map((s) => s.kg || 0)),
        best1rm: Math.max(...sets.map((s) => e1rm(s.kg || 0, s.reps))),
        volume: sets.reduce((v, s) => v + (s.kg || 0) * s.reps, 0),
        reps: Math.max(...sets.map((s) => s.reps)),
      });
    }
  }
  return out.sort((a, b) => a.date - b.date);
}

// Best values for one exercise. Each record: { value, kg, reps, date } or null.
export function records(workouts, exId) {
  const r = { maxKg: null, e1rm: null, maxReps: null, volume: null };
  for (const w of workouts) {
    for (const en of w.entries) {
      if (en.exId !== exId) continue;
      let vol = 0;
      for (const s of doneSets(en)) {
        const kg = s.kg || 0;
        vol += kg * s.reps;
        if (kg > 0 && (!r.maxKg || kg > r.maxKg.value || (kg === r.maxKg.value && s.reps > r.maxKg.reps)))
          r.maxKg = { value: kg, kg, reps: s.reps, date: w.date };
        const est = e1rm(kg, s.reps);
        if (est > 0 && (!r.e1rm || est > r.e1rm.value)) r.e1rm = { value: est, kg, reps: s.reps, date: w.date };
        if (!r.maxReps || s.reps > r.maxReps.value) r.maxReps = { value: s.reps, kg, reps: s.reps, date: w.date };
      }
      if (vol > 0 && (!r.volume || vol > r.volume.value)) r.volume = { value: vol, date: w.date };
    }
  }
  return r;
}

// Which records does `set` beat, given earlier workouts plus earlier sets of the current entry?
export function newRecords(prevWorkouts, exId, earlierSets, set) {
  if (!set.reps) return [];
  const pseudo = { date: 0, entries: [{ exId, sets: earlierSets.filter((s) => s.done) }] };
  const r = records([...prevWorkouts, pseudo], exId);
  const kg = set.kg || 0;
  const hits = [];
  if (kg > 0) {
    if (!r.maxKg || kg > r.maxKg.value) hits.push('Najvyššia váha');
    else if (r.e1rm && e1rm(kg, set.reps) > r.e1rm.value + 0.01) hits.push('Odhadované 1RM');
  } else if (!r.maxReps || set.reps > r.maxReps.value) {
    hits.push('Najviac opakovaní');
  }
  // the very first ever set is not a "record"
  return r.maxReps ? hits : [];
}

// Fatigue 0..100 per muscle from sets in the last `hours`, decaying linearly.
// Primary muscle counts 1 per set, secondary 0.5; ~6 fresh effective sets = 100 %.
export function muscleFatigue(workouts, exById, now = Date.now(), hours = 72) {
  const f = {};
  for (const w of workouts) {
    const age = (now - w.date) / 36e5;
    if (age < 0 || age > hours) continue;
    const decay = 1 - age / hours;
    for (const en of w.entries) {
      const ex = exById[en.exId];
      if (!ex) continue;
      const n = doneSets(en).length * decay;
      for (const m of ex.primary) f[m] = (f[m] || 0) + n;
      for (const m of ex.secondary || []) f[m] = (f[m] || 0) + n * 0.5;
    }
  }
  for (const m in f) f[m] = Math.min(100, Math.round((f[m] / 6) * 100));
  return f;
}

// Hard sets per muscle (primary=1, secondary=0.5) over the last 7 days.
export function weeklySets(workouts, exById, now = Date.now()) {
  const out = {};
  for (const w of workouts) {
    if (now - w.date > 7 * DAY || w.date > now) continue;
    for (const en of w.entries) {
      const ex = exById[en.exId];
      if (!ex) continue;
      const n = doneSets(en).length;
      for (const m of ex.primary) out[m] = (out[m] || 0) + n;
      for (const m of ex.secondary || []) out[m] = (out[m] || 0) + n * 0.5;
    }
  }
  return out;
}

// Greedy plates per side. Returns { plates: [kg...], rest } (rest = unreachable remainder per side).
export function plates(target, bar = 20, inventory = [25, 20, 15, 10, 5, 2.5, 1.25]) {
  let side = Math.max(0, (target - bar) / 2);
  const out = [];
  for (const p of inventory) {
    while (side >= p - 1e-9) {
      out.push(p);
      side -= p;
    }
  }
  return { plates: out, rest: Math.round(side * 100) / 100 };
}

export function streakWeeks(workouts, now = Date.now()) {
  const week = (t) => Math.floor((t - 4 * DAY) / (7 * DAY)); // weeks start Monday
  const weeks = new Set(workouts.map((w) => week(w.date)));
  let n = 0;
  let k = week(now);
  if (!weeks.has(k)) k -= 1; // current week not trained yet doesn't break the streak
  while (weeks.has(k)) {
    n++;
    k--;
  }
  return n;
}
