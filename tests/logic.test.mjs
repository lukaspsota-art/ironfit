// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { e1rm, records, newRecords, muscleFatigue, plates, streakWeeks, weeklySets } from '../js/stats.js';
import { generatePlan, suggest, nextDayIndex, swapItem, isDeload, SPLITS } from '../js/planner.js';
import { EXERCISES, MUSCLES, PATTERNS, EQUIP } from '../js/data/exercises.js';
import { solve, poseAt } from '../js/anim.js';

const exById = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));
const DAY = 864e5;
const W = (date, exId, sets, extra = {}) => ({ id: 'w' + date, date, entries: [{ exId, sets: sets.map(([kg, reps]) => ({ kg, reps, done: true })) }], ...extra });

test('e1rm (Epley)', () => {
  assert.equal(e1rm(100, 1), 100);
  assert.ok(Math.abs(e1rm(100, 10) - 133.33) < 0.01);
  assert.equal(e1rm(0, 10), 0);
});

test('records + newRecords', () => {
  const ws = [W(1, 'bench-press', [[60, 8], [60, 7]]), W(2, 'bench-press', [[62.5, 5]])];
  const r = records(ws, 'bench-press');
  assert.equal(r.maxKg.value, 62.5);
  assert.equal(r.maxReps.value, 8);
  assert.deepEqual(newRecords(ws, 'bench-press', [], { kg: 65, reps: 3 }), ['Najvyššia váha']);
  assert.deepEqual(newRecords(ws, 'bench-press', [], { kg: 60, reps: 12 }), ['Odhadované 1RM']);
  assert.deepEqual(newRecords(ws, 'bench-press', [], { kg: 50, reps: 5 }), []);
  // first ever set is not a record
  assert.deepEqual(newRecords([], 'bench-press', [], { kg: 40, reps: 10 }), []);
  // earlier sets in same workout count
  assert.deepEqual(newRecords(ws, 'bench-press', [{ kg: 70, reps: 1, done: true }], { kg: 67.5, reps: 1 }), []);
  // bodyweight
  const pw = [W(1, 'push-up', [[0, 15]])];
  assert.deepEqual(newRecords(pw, 'push-up', [], { kg: 0, reps: 16 }), ['Najviac opakovaní']);
});

test('plates', () => {
  assert.deepEqual(plates(100, 20).plates, [25, 15]);
  assert.deepEqual(plates(20, 20).plates, []);
  assert.deepEqual(plates(61, 20), { plates: [20], rest: 0.5 });
});

test('muscle fatigue decays and caps', () => {
  const now = 10 * DAY;
  const f = muscleFatigue([W(now - 3600e3, 'leg-press', Array(10).fill([100, 10]))], exById, now);
  assert.equal(f.quads, 100);
  const old = muscleFatigue([W(now - 4 * DAY, 'leg-press', [[100, 10]])], exById, now);
  assert.equal(old.quads, undefined);
});

test('weeklySets counts primary 1, secondary 0.5', () => {
  const now = 10 * DAY;
  const ws = weeklySets([W(now - DAY, 'chest-press', [[50, 10], [50, 10]])], exById, now);
  assert.equal(ws.chest, 2);
  assert.equal(ws.triceps, 1);
});

test('streak', () => {
  const now = Date.UTC(2026, 9, 21); // Wednesday
  assert.equal(streakWeeks([{ date: now - 7 * DAY }, { date: now - 14 * DAY }], now), 2);
  assert.equal(streakWeeks([], now), 0);
});

test('every split generates valid plans for all goals/levels/durations', () => {
  for (const days of Object.keys(SPLITS)) {
    for (const goal of ['sila', 'hypertrofia', 'kondicia']) {
      for (const level of ['zaciatocnik', 'mierne', 'pokrocily']) {
        for (const minutes of [45, 60, 90]) {
          const p = generatePlan({ days: +days, goal, level, minutes }, EXERCISES, 12345);
          assert.equal(p.days.length, +days);
          for (const d of p.days) {
            assert.ok(d.items.length >= 3, `${days}/${goal}/${level}/${minutes} ${d.name} has ${d.items.length}`);
            const ids = d.items.map((i) => i.exId);
            assert.equal(new Set(ids).size, ids.length, 'no duplicate exercise in a day');
            for (const it of d.items) {
              assert.ok(exById[it.exId], it.exId);
              assert.ok(it.sets >= 1 && it.repsMin <= it.repsMax);
            }
          }
        }
      }
    }
  }
});

test('beginner plans prefer machines when available', () => {
  const p = generatePlan({ days: 3, goal: 'hypertrofia', level: 'zaciatocnik', minutes: 60 }, EXERCISES, 1);
  for (const d of p.days) for (const it of d.items) assert.equal(exById[it.exId].level, 1, it.exId);
});

test('exclude is respected', () => {
  const p = generatePlan({ days: 3, goal: 'sila', level: 'pokrocily', minutes: 90, exclude: ['back-squat', 'leg-press'] }, EXERCISES, 7);
  assert.ok(!p.days.some((d) => d.items.some((i) => ['back-squat', 'leg-press'].includes(i.exId))));
});

test('double progression', () => {
  const item = { exId: 'chest-press', pattern: 'hpush', sets: 3, repsMin: 8, repsMax: 12 };
  const ex = exById['chest-press'];
  assert.equal(suggest(item, ex, []).trend, 'new');
  const hit = suggest(item, ex, [W(1, 'chest-press', [[50, 12], [50, 12], [50, 12]])]);
  assert.equal(hit.kg, 52.5);
  assert.equal(hit.trend, 'up');
  const same = suggest(item, ex, [W(1, 'chest-press', [[50, 12], [50, 10], [50, 9]])]);
  assert.equal(same.kg, 50);
  const stall = suggest(item, ex, [W(1, 'chest-press', [[50, 7], [50, 6]]), W(2, 'chest-press', [[50, 7], [50, 6]])]);
  assert.equal(stall.kg, 45);
  assert.equal(stall.trend, 'down');
  const del = suggest(item, ex, [W(1, 'chest-press', [[50, 10]])], { deload: true });
  assert.equal(del.sets, 2);
  assert.equal(del.kg, 45);
});

test('next day rotates and swap works', () => {
  const p = generatePlan({ days: 4, goal: 'hypertrofia', level: 'pokrocily', minutes: 60 }, EXERCISES, 3);
  assert.equal(nextDayIndex(p, []), 0);
  assert.equal(nextDayIndex(p, [{ planId: p.id, dayIdx: 3, entries: [] }]), 0);
  assert.equal(nextDayIndex(p, [{ planId: p.id, dayIdx: 1, entries: [] }]), 2);
  const before = p.days[0].items[0].exId;
  assert.equal(swapItem(p, 0, 0, EXERCISES, exById), true);
  assert.notEqual(p.days[0].items[0].exId, before);
  assert.equal(isDeload({ created: Date.now() - 5 * 7 * DAY - 1000 }), true);
  assert.equal(isDeload({ created: Date.now() }), false);
});

test('exercise data integrity', () => {
  const ids = new Set();
  for (const e of EXERCISES) {
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    assert.match(e.id, /^[a-z0-9-]+$/);
    for (const k of ['name', 'machine', 'summary']) assert.ok(typeof e[k] === 'string' && e[k].length > 2, `${e.id}.${k}`);
    for (const k of ['setup', 'steps', 'mistakes']) assert.ok(Array.isArray(e[k]) && e[k].length, `${e.id}.${k}`);
    assert.ok(PATTERNS[e.pattern], `${e.id} pattern ${e.pattern}`);
    assert.ok(EQUIP[e.equip], `${e.id} equip ${e.equip}`);
    assert.ok([1, 2, 3].includes(e.level), `${e.id} level`);
    assert.equal(typeof e.compound, 'boolean', `${e.id} compound`);
    for (const m of [...e.primary, ...e.secondary]) assert.ok(MUSCLES[m], `${e.id} muscle ${m}`);
    assert.ok(e.anim.poses.length >= 2, `${e.id} poses`);
    for (const p of [0, 0.5, 1]) {
      const j = solve(e.anim, poseAt(e.anim.poses, p));
      for (const [k, v] of Object.entries(j)) assert.ok(v.every(Number.isFinite), `${e.id} ${k} NaN`);
    }
  }
  for (const p of Object.keys(PATTERNS)) assert.ok(EXERCISES.some((e) => e.pattern === p), `no exercise for pattern ${p}`);
});

test('deload sessions do not reset progression; stalls always get lighter', async () => {
  const item = { exId: 'chest-press', pattern: 'hpush', sets: 3, repsMin: 8, repsMax: 12 };
  const ex = exById['chest-press'];
  const ws = [W(1, 'chest-press', [[100, 10], [100, 10], [100, 10]]), W(2, 'chest-press', [[90, 10], [90, 10]], { deload: true })];
  assert.equal(suggest(item, ex, ws).kg, 100);
  const light = suggest(item, { increment: 2.5 }, [W(1, 'chest-press', [[10, 5]]), W(2, 'chest-press', [[10, 5]])]);
  assert.equal(light.kg, 7.5);
  assert.equal(suggest(item, { increment: 2.5 }, [W(1, 'chest-press', [[10, 10]])], { deload: true }).kg, 7.5);
});

test('workoutRecords: computed from final sets, skips first session', async () => {
  const { workoutRecords } = await import('../js/stats.js');
  const prev = [W(1, 'bench-press', [[60, 8]])];
  assert.deepEqual(workoutRecords(prev, [{ exId: 'bench-press', sets: [{ kg: 65, reps: 3, done: true }] }]), [{ exId: 'bench-press', label: 'Najvyššia váha', kg: 65, reps: 3 }]);
  assert.deepEqual(workoutRecords(prev, [{ exId: 'bench-press', sets: [{ kg: 60, reps: 8, done: true }] }]), []);
  assert.deepEqual(workoutRecords([], [{ exId: 'bench-press', sets: [{ kg: 60, reps: 8, done: true }] }]), []);
});

test('normalize survives hostile / old backups', async () => {
  const { normalize } = await import('../js/store.js');
  assert.throws(() => normalize(null));
  assert.throws(() => normalize([]));
  const s = normalize({
    settings: { goal: 'x', days: 9, minutes: '60', bar: -5, exclude: 'abc', theme: '<b>' },
    plan: { days: [{ items: 'nope' }], settings: { goal: 'zzz' } },
    active: { started: 5, entries: [{ exId: 'nope', sets: 'x' }, null] },
    workouts: [
      { id: 'a/b', date: 2, entries: [{ exId: 'bench-press', sets: [{ kg: '-3', reps: 'x', done: 1 }] }], prs: 'zz' },
      { id: 'dup', date: 3, entries: [] }, { id: 'dup', date: 4, entries: [] }, { date: 'x', entries: [] },
    ],
  });
  assert.equal(s.settings.goal, 'hypertrofia');
  assert.equal(s.settings.days, 3);
  assert.equal(s.settings.minutes, 60);
  assert.equal(s.settings.bar, 20);
  assert.deepEqual(s.settings.exclude, []);
  assert.equal(s.settings.theme, 'auto');
  assert.equal(s.plan, null);
  assert.deepEqual(s.active.entries[0].sets, []);
  assert.equal(s.workouts.length, 3);
  assert.match(s.workouts[0].id, /^[\w-]+$/);
  assert.deepEqual(s.workouts[0].prs, []);
  assert.deepEqual(s.workouts[0].entries[0].sets[0], { kg: 0, reps: 0, done: true });
  assert.notEqual(s.workouts[1].id, s.workouts[2].id);
});

test('plan quality: strength uses main barbell lifts, volume capped, adductors not in glute slot', async () => {
  const { planVolume } = await import('../js/planner.js');
  const s = generatePlan({ days: 3, goal: 'sila', level: 'pokrocily', minutes: 60 }, EXERCISES, 1);
  const ids = s.days.flatMap((d) => d.items.map((i) => i.exId));
  for (const id of ['back-squat', 'bench-press', 'deadlift']) assert.ok(ids.includes(id), id);
  for (const d of s.days) for (const it of d.items) {
    const ex = exById[it.exId];
    if (it.repsMax <= 6) assert.ok(['barbell', 'machine', 'dumbbell'].includes(ex.equip) && ex.pattern !== 'lunge', `${it.exId} heavy`);
  }
  for (const days of [4, 5, 6]) {
    const p = generatePlan({ days, goal: 'hypertrofia', level: 'pokrocily', minutes: 90 }, EXERCISES, 1);
    const v = planVolume(p.days, exById);
    for (const m of ['chest', 'back', 'quads', 'hamstrings', 'glutes', 'biceps', 'triceps']) {
      assert.ok(v[m] <= 20, `${days}d ${m}=${v[m]}`);
      assert.ok(v[m] >= 8, `${days}d ${m}=${v[m]}`);
    }
    assert.ok(!p.days.some((d) => d.items.some((i) => i.exId === 'hip-adduction')));
  }
});

test('progression ignores warm-ups but needs every working set at the top', () => {
  const item = { exId: 'chest-press', pattern: 'hpush', sets: 3, repsMin: 8, repsMax: 12 };
  const ex = exById['chest-press'];
  // warm-up at 30 kg doesn't block, all 3 working sets hit 12
  assert.equal(suggest(item, ex, [W(1, 'chest-press', [[30, 8], [50, 12], [50, 12], [50, 12]])]).trend, 'up');
  // one heavy top set + failed back-offs is not a pass
  assert.equal(suggest(item, ex, [W(1, 'chest-press', [[50, 12], [45, 7], [45, 6]])]).trend, 'same');
});

test('normalize rebuilds active workout targets', async () => {
  const { normalize } = await import('../js/store.js');
  const s = normalize({ active: { started: 1, entries: [{ exId: 'chest-press', sets: [{ kg: 10, reps: 5 }] }] } });
  const e = s.active.entries[0];
  assert.ok(e.target.sets >= 1 && e.target.repsMin <= e.target.repsMax);
  assert.equal(e.sug.trend, 'new');
});

test('advanced plans avoid unloadable bodyweight moves when loadable options exist', () => {
  const p = generatePlan({ days: 6, goal: 'hypertrofia', level: 'pokrocily', minutes: 90 }, EXERCISES, 1);
  assert.ok(!p.days.some((d) => d.items.some((i) => i.exId === 'push-up')));
});

test('warm-up sets never trigger a stall deload', () => {
  const item = { exId: 'bench-press', pattern: 'hpush', sets: 3, repsMin: 6, repsMax: 10 };
  const s = [[40, 5], [80, 8], [80, 8], [80, 7]];
  const r = suggest(item, exById['bench-press'], [W(1, 'bench-press', s), W(2, 'bench-press', s)]);
  assert.equal(r.trend, 'same');
  assert.equal(r.kg, 80);
  assert.match(suggest(item, exById['bench-press'], [W(1, 'bench-press', [[62.5, 10], [62.5, 10], [62.5, 10]])]).note, /65 kg|2,5 kg/);
});

test('every generated day fits the chosen session length', async () => {
  const { dayTime } = await import('../js/planner.js');
  for (const days of [2, 3, 4, 5, 6]) for (const goal of ['sila', 'hypertrofia', 'kondicia'])
    for (const level of ['zaciatocnik', 'mierne', 'pokrocily']) for (const minutes of [45, 60, 75, 90]) {
      const p = generatePlan({ days, goal, level, minutes }, EXERCISES, 1);
      for (const d of p.days) assert.ok(dayTime(d) <= minutes * 60, `${days}/${goal}/${level}/${minutes} ${d.name} ${Math.round(dayTime(d) / 60)} min`);
    }
});

test('bad dayIdx / restEnd in imports are neutralised', async () => {
  const { normalize } = await import('../js/store.js');
  const s = normalize({ workouts: [{ date: 1, dayIdx: -5, entries: [] }], active: { started: 1, restEnd: 'abc', entries: [] } });
  assert.equal(s.workouts[0].dayIdx, null);
  assert.equal(s.active.restEnd, undefined);
  assert.equal(nextDayIndex({ id: 'p', days: [{}, {}, {}] }, [{ planId: 'p', dayIdx: -5 }]), 0);
});
