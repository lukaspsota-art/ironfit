import { EXERCISES, MUSCLES, PATTERNS, EQUIP } from './data/exercises.js';
import * as store from './store.js';
import { createFigure, mountPlayer } from './anim.js';
import { records, exerciseHistory, newRecords, muscleFatigue, weeklySets, plates, streakWeeks, doneSets, e1rm } from './stats.js';
import { GOALS, LEVELS, SPLIT_NAMES, generatePlan, swapItem, suggest, nextDayIndex, planWeek, isDeload } from './planner.js';

const exById = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const S = () => store.get();

// ---------- tiny safe templating ----------
class Raw { constructor(s) { this.s = s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const out = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(out).join('') : v == null || v === false ? '' : esc(v));
const html = (strs, ...vals) => new Raw(strs.reduce((o, s, i) => o + s + (i < vals.length ? out(vals[i]) : ''), ''));

// ---------- formatting ----------
const fmtKg = (n) => (Math.round(n * 10) / 10).toLocaleString('sk-SK');
const fmtDate = (t, opts = { day: 'numeric', month: 'numeric', year: 'numeric' }) => new Date(t).toLocaleDateString('sk-SK', opts);
const fmtDur = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
const mm = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const muscles = (list) => list.map((m) => MUSCLES[m]).join(', ');
const repRange = (it) => (it.pattern === 'cardio' ? `${it.repsMin} min` : it.repsMin === it.repsMax ? `${it.repsMin}` : `${it.repsMin}–${it.repsMax}`);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- UI feedback ----------
let toastTimer;
function toast(msg) {
  $('.toast')?.remove();
  const t = Object.assign(document.createElement('div'), { className: 'toast', role: 'status', textContent: msg });
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

function confirmDialog(message, okLabel = 'Áno', danger = false) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'card';
    d.innerHTML = html`<form method="dialog"><p>${message}</p><div class="row" style="justify-content:flex-end">
      <button class="btn" value="no">Zrušiť</button><button class="btn ${danger ? 'danger' : 'primary'}" value="yes">${okLabel}</button></div></form>`.s;
    document.body.appendChild(d);
    d.addEventListener('close', () => { resolve(d.returnValue === 'yes'); d.remove(); });
    d.showModal();
  });
}

let audioCtx;
function beep() {
  if (!S().settings.sound) return;
  try {
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.5);
  } catch { /* audio unavailable */ }
}
const buzz = (p) => navigator.vibrate?.(p);

// ---------- charts ----------
function lineChart(points, unit = 'kg') {
  if (points.length < 2) return html`<p class="muted">Graf sa zobrazí po 2 a viac tréningoch.</p>`;
  const W = 320, H = 160, P = 28;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const X = (x) => P + ((x - x0) / (x1 - x0 || 1)) * (W - P - 8);
  const Y = (y) => H - 20 - ((y - y0) / (y1 - y0)) * (H - 36);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${d}L${X(x1).toFixed(1)},${H - 20}L${X(x0).toFixed(1)},${H - 20}Z`;
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Graf vývoja od ${fmtKg(ys[0])} do ${fmtKg(ys.at(-1))} ${unit}">
    <line class="gl" x1="${P}" x2="${W}" y1="${Y(y1)}" y2="${Y(y1)}"/><line class="gl" x1="${P}" x2="${W}" y1="${Y(y0)}" y2="${Y(y0)}"/>
    <text class="ax" x="0" y="${Y(y1) + 3}">${fmtKg(y1)}</text><text class="ax" x="0" y="${Y(y0) + 3}">${fmtKg(y0)}</text>
    <path class="ar" d="${area}"/><path class="ln" d="${d}"/>
    ${points.map((p) => html`<circle class="dt" cx="${X(p.x)}" cy="${Y(p.y)}" r="3"/>`)}
    <text class="ax" x="${P}" y="${H - 4}">${fmtDate(x0, { day: 'numeric', month: 'numeric' })}</text>
    <text class="ax" x="${W}" y="${H - 4}" text-anchor="end">${fmtDate(x1, { day: 'numeric', month: 'numeric' })}</text></svg>`;
}

function hydrateThumbs(root) {
  for (const svg of $$('svg[data-thumb]', root)) {
    const ex = exById[svg.dataset.thumb];
    if (ex) createFigure(svg, ex.anim).set(0.6);
    svg.setAttribute('aria-hidden', 'true');
  }
}
const thumb = (id, cls = 'thumb') => html`<svg class="${cls}" data-thumb="${id}"></svg>`;

// ---------- plan helpers ----------
const plan = () => S().plan;
function fatigueOfDay(day, fatigue) {
  const ms = new Set(day.items.flatMap((it) => exById[it.exId]?.primary || []));
  ms.delete('cardio');
  if (!ms.size) return 0;
  return [...ms].reduce((s, m) => s + (fatigue[m] || 0), 0) / ms.size;
}

function startWorkout(dayIdx) {
  const p = plan();
  const deload = p && isDeload(p);
  let entries = [];
  let name = 'Voľný tréning';
  if (p && dayIdx != null) {
    const day = p.days[dayIdx];
    name = day.name;
    entries = day.items.filter((it) => exById[it.exId]).map((it) => newEntry(it.exId, it, deload));
  }
  store.update((s) => {
    s.active = { id: uid(), started: Date.now(), planId: p?.id ?? null, dayIdx: dayIdx ?? null, name, deload: !!deload, entries };
  });
  requestWakeLock();
  go('#/trening');
}

// navigate, re-rendering even when already on that route
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function newEntry(exId, item, deload = false) {
  const ex = exById[exId];
  const target = item || { pattern: ex.pattern, sets: 3, repsMin: ex.pattern === 'cardio' ? 15 : 8, repsMax: ex.pattern === 'cardio' ? 15 : 12, rest: 90 };
  const sug = suggest(target, ex, S().workouts, { deload });
  const sets = Array.from({ length: sug.sets }, () => ({ kg: sug.kg ?? '', reps: '', done: false }));
  return { exId, target, sug, sets };
}

// ---------- rest timer ----------
let timerIv;
function startRest(sec) {
  if (!S().settings.autoRest || !sec) return;
  store.update((s) => { if (s.active) s.active.restEnd = Date.now() + sec * 1000; });
  renderTimer();
}
function renderTimer() {
  clearInterval(timerIv);
  $('.timer')?.remove();
  const end = S().active?.restEnd;
  if (!end || end < Date.now()) return;
  const el = document.createElement('div');
  el.className = 'timer';
  el.setAttribute('role', 'timer');
  el.innerHTML = html`<span>Pauza</span><b aria-live="off"></b><span class="grow"></span>
    <button class="btn small" data-t="-15" aria-label="Uber 15 sekúnd">−15</button>
    <button class="btn small" data-t="15" aria-label="Pridaj 15 sekúnd">+15</button>
    <button class="btn small" data-t="0">Preskočiť</button>`.s;
  document.body.appendChild(el);
  const tick = () => {
    const left = (S().active?.restEnd ?? 0) - Date.now();
    if (left <= 0) {
      clearInterval(timerIv);
      el.remove();
      if (S().active?.restEnd) {
        store.update((s) => { if (s.active) delete s.active.restEnd; });
        beep();
        buzz([200, 100, 200]);
        toast('Pauza skončila — ďalšia séria!');
      }
      return;
    }
    $('b', el).textContent = mm(Math.ceil(left / 1000));
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const d = +b.dataset.t;
    store.update((s) => { if (s.active) s.active.restEnd = d ? s.active.restEnd + d * 1000 : 0; });
    tick();
  });
  tick();
  timerIv = setInterval(tick, 250);
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    if (S().active && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && requestWakeLock());

// ================= VIEWS =================

function viewToday() {
  const s = S();
  const p = s.plan;
  const fatigue = muscleFatigue(s.workouts, exById);
  const weekCount = s.workouts.filter((w) => Date.now() - w.date < 7 * 864e5).length;
  const recentPRs = s.workouts.slice(-10).reverse().flatMap((w) => (w.prs || []).map((r) => ({ ...r, date: w.date }))).slice(0, 5);
  const statsCard = html`<div class="grid2" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
      <div class="stat"><b>${weekCount}</b><span>tréningy za 7 dní</span></div>
      <div class="stat"><b>${streakWeeks(s.workouts)}</b><span>týždne v rade</span></div>
      <div class="stat"><b>${s.workouts.length}</b><span>spolu</span></div></div>`;

  let main;
  if (s.active) {
    main = html`<section class="card hero"><h2>Tréning prebieha</h2><p>${s.active.name} · začatý ${new Date(s.active.started).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}</p>
      <a class="btn primary block" href="#/trening">Pokračovať v tréningu</a></section>`;
  } else if (!p) {
    main = html`<section class="card hero"><h1>Ahoj! 💪</h1>
      <p>Odpovedz na 4 otázky a aplikácia ti zostaví tréningový plán podľa strojov v našom fitku. Váhy ti bude sama navyšovať podľa toho, čo zapíšeš.</p>
      <a class="btn primary block" href="#/plan">Vytvoriť môj plán</a>
      <p style="margin:10px 0 0"><a href="#/cviky">alebo si najprv pozri stroje a cviky →</a></p></section>`;
  } else {
    const idx = nextDayIndex(p, s.workouts);
    const day = p.days[idx];
    const deload = isDeload(p);
    const fNext = fatigueOfDay(day, fatigue);
    let alt = null;
    p.days.forEach((d, i) => {
      const f = fatigueOfDay(d, fatigue);
      if (i !== idx && f < fNext - 25 && (!alt || f < alt.f)) alt = { i, f, d };
    });
    main = html`<section class="card hero">
      <div class="row between"><small>Týždeň ${planWeek(p)} · ${SPLIT_NAMES[p.settings.days]}</small>${deload ? html`<span class="chip warn">Deload týždeň</span>` : ''}</div>
      <h1>${day.name}</h1>
      <ul class="list">${day.items.map((it) => {
        const ex = exById[it.exId];
        if (!ex) return '';
        const sg = suggest(it, ex, s.workouts, { deload });
        return html`<li><a class="item" href="#/cvik/${ex.id}">${thumb(ex.id)}<span class="t"><b>${ex.name}</b>
          <small>${sg.sets} × ${repRange(it)}${sg.kg ? html` · <span style="color:var(--accent)">${fmtKg(sg.kg)} kg</span>` : ''}${sg.trend === 'up' ? ' ↑' : sg.trend === 'down' ? ' ↓' : ''}</small></span></a></li>`;
      })}</ul>
      ${fNext >= 50 ? html`<p class="hint down">Svaly na tento deň sú ešte unavené (${Math.round(fNext)} %).${alt ? html` Odporúčame dnes radšej <b>${alt.d.name}</b>.` : ' Zvoľ ľahší deň alebo kardio.'}</p>` : ''}
      <button class="btn primary block" data-start="${idx}">Začať tréning</button>
      ${alt ? html`<button class="btn block" style="margin-top:8px" data-start="${alt.i}">Začať ${alt.d.name}</button>` : ''}
      <details style="margin-top:10px"><summary>Iný deň plánu</summary><div class="row wrap" style="margin-top:8px">
        ${p.days.map((d, i) => (i === idx ? '' : html`<button class="btn small" data-start="${i}">${d.name}</button>`))}
        <button class="btn small" data-start="free">Voľný tréning</button></div></details>
    </section>`;
  }

  const fm = Object.entries(fatigue).filter(([m]) => m !== 'cardio').sort((a, b) => b[1] - a[1]);
  return html`${main}${statsCard}
    <section class="card"><h2>Regenerácia svalov</h2>
      ${fm.length ? html`<p class="muted">Odhad únavy z tréningov za posledné 3 dni. Zelená = oddýchnuté.</p>
        ${fm.map(([m, v]) => html`<div class="mrow"><span>${MUSCLES[m]}</span><div class="bar"><i class="${v >= 60 ? 'hi' : v >= 30 ? 'mid' : ''}" style="width:${100 - v}%"></i></div><span>${100 - v} %</span></div>`)}`
      : html`<p class="muted">Všetky svaly sú oddýchnuté. Po tréningu tu uvidíš, čo potrebuje pauzu.</p>`}
    </section>
    ${recentPRs.length ? html`<section class="card"><h2>Posledné rekordy 🏆</h2><ul class="list">${recentPRs.map((r) => html`<li class="item"><span class="t"><b>${exById[r.exId]?.name ?? r.exId}</b><small>${r.label} · ${fmtDate(r.date)}</small></span><b>${r.kg ? `${fmtKg(r.kg)} kg × ${r.reps}` : `${r.reps} opak.`}</b></li>`)}</ul></section>` : ''}`;
}

function bindToday(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-start]');
    if (b) startWorkout(b.dataset.start === 'free' ? null : +b.dataset.start);
  });
}

// ---------- plan ----------
function seg(name, options, current) {
  return html`<div class="seg">${Object.entries(options).map(([v, l]) => html`<input type="radio" id="${name}-${v}" name="${name}" value="${v}" ${String(current) === v ? 'checked' : ''}><label for="${name}-${v}">${l}</label>`)}</div>`;
}

function viewPlan() {
  const { settings: st, plan: p } = S();
  const days = Object.fromEntries([2, 3, 4, 5, 6].map((d) => [d, `${d}×`]));
  return html`<h1>Tréningový plán</h1>
  <form class="card" id="plan-form">
    <fieldset><legend>Cieľ</legend>${seg('goal', Object.fromEntries(Object.entries(GOALS).map(([k, g]) => [k, g.label])), st.goal)}</fieldset>
    <fieldset><legend>Koľkokrát týždenne cvičíš?</legend>${seg('days', days, st.days)}</fieldset>
    <fieldset><legend>Skúsenosti</legend>${seg('level', Object.fromEntries(Object.entries(LEVELS).map(([k, l]) => [k, l.label])), st.level)}</fieldset>
    <fieldset><legend>Dĺžka tréningu</legend>${seg('minutes', { 45: '45 min', 60: '60 min', 75: '75 min', 90: '90 min' }, st.minutes)}</fieldset>
    <p class="muted" id="split-info"></p>
    <button class="btn primary block">${p ? 'Vygenerovať nový plán' : 'Vytvoriť plán'}</button>
  </form>
  ${p ? html`<h2>Tvoj plán · ${SPLIT_NAMES[p.settings.days]}</h2>
    <p class="muted">${GOALS[p.settings.goal].label} · ${LEVELS[p.settings.level].label} · týždeň ${planWeek(p)}${isDeload(p) ? ' (deload)' : ''}. Cvik vymeníš tlačidlom ⇄.</p>
    ${p.days.map((d, di) => html`<section class="card"><div class="row between"><h3>${d.name}</h3><button class="btn small primary" data-start="${di}">Začať</button></div>
      <ul class="list">${d.items.map((it, ii) => {
        const ex = exById[it.exId];
        if (!ex) return '';
        return html`<li class="item">${thumb(ex.id)}<a class="t" href="#/cvik/${ex.id}" style="color:inherit;text-decoration:none"><b>${ex.name}</b>
          <small>${it.sets} × ${repRange(it)}${it.rest ? ` · pauza ${it.rest} s` : ''} · ${PATTERNS[it.pattern]}</small></a>
          <button class="btn icon small" data-swap="${di}:${ii}" aria-label="Vymeniť ${ex.name} za iný cvik">⇄</button></li>`;
      })}</ul></section>`)}` : ''}
  <details class="card"><summary>Ako funguje automatický plán a progres</summary>
    <ul class="good" style="margin-top:8px">
      <li><b>Rozdelenie:</b> 2–3 dni = celé telo, 4 = horná/spodná, 5 = horná/spodná + push/pull/nohy, 6 = push/pull/nohy 2×. Každý sval tak trénuješ ~2× týždenne.</li>
      <li><b>Objem:</b> cieľ je cca 10–20 ťažkých sérií na sval za týždeň (Schoenfeld a kol., 2017). Prehľad nájdeš v Pokroku.</li>
      <li><b>Dvojitá progresia:</b> keď vo všetkých sériách dáš horný počet opakovaní, nabudúce ti appka pridá váhu (2,5 kg, pri nohách 5 kg).</li>
      <li><b>Stagnácia:</b> ak 2 tréningy po sebe nedáš ani spodnú hranicu, váha sa zníži o 10 % a staviaš znova (ako StrongLifts).</li>
      <li><b>Deload:</b> každý 6. týždeň menej sérií a ~90 % váhy na regeneráciu.</li>
      <li><b>Regenerácia:</b> podľa únavy svalov ti appka navrhne vhodnejší deň (inšpirované Fitbodom).</li>
      <li><b>Začiatočník</b> dostane hlavne stroje, ktoré vedú pohyb. Technické cviky s veľkou činkou prídu neskôr.</li>
    </ul></details>`;
}

function bindPlan(root) {
  const form = $('#plan-form', root);
  const info = $('#split-info', root);
  const showInfo = () => {
    const d = new FormData(form).get('days');
    info.textContent = `Rozdelenie: ${SPLIT_NAMES[d]}.`;
  };
  form.addEventListener('change', showInfo);
  showInfo();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (S().plan && !(await confirmDialog('Nahradiť aktuálny plán novým? História tréningov ostane.', 'Nahradiť'))) return;
    const f = new FormData(form);
    const st = { goal: f.get('goal'), days: +f.get('days'), level: f.get('level'), minutes: +f.get('minutes') };
    store.update((s) => {
      Object.assign(s.settings, st);
      s.plan = generatePlan({ ...s.settings }, EXERCISES);
    });
    toast('Plán je pripravený ✔');
    render();
  });
  root.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-swap]');
    if (sw) {
      const [di, ii] = sw.dataset.swap.split(':').map(Number);
      let ok = false;
      store.update((s) => { ok = swapItem(s.plan, di, ii, EXERCISES.filter((x) => !s.settings.exclude.includes(x.id)), exById); });
      if (!ok) toast('Pre tento cvik nie je ďalšia alternatíva.');
      render();
    }
    const st = e.target.closest('[data-start]');
    if (st) startWorkout(+st.dataset.start);
  });
}

// ---------- workout ----------
function entryCard(en, ei) {
  const ex = exById[en.exId];
  const it = en.target;
  const cardio = ex.pattern === 'cardio';
  const prev = exerciseHistory(S().workouts, ex.id).at(-1);
  const sug = en.sug;
  return html`<section class="card" data-entry="${ei}">
    <div class="row between"><a href="#/cvik/${ex.id}" class="row" style="color:inherit;text-decoration:none;min-width:0">${thumb(ex.id)}<span style="min-width:0"><h3 style="margin:0">${ex.name}</h3>
      <small>${it.sets ? `${repRange(it)} ${cardio ? '' : 'opak.'}` : ''}${it.rest ? ` · pauza ${it.rest} s` : ''}</small></span></a>
      <button class="btn icon small" data-remove="${ei}" aria-label="Odstrániť ${ex.name} z tréningu">✕</button></div>
    ${sug?.note ? html`<p class="hint ${sug.trend}">${sug.note}</p>` : ''}
    ${prev && !cardio ? html`<small class="muted">Minule: ${prev.sets.map((s) => `${s.kg ? fmtKg(s.kg) + '×' : ''}${s.reps}`).join(', ')}</small>` : ''}
    <div class="set-row head" style="margin-top:8px"><span>#</span><span>${cardio ? '' : 'kg'}</span><span>${cardio ? 'minút' : 'opakovania'}</span><span></span></div>
    ${en.sets.map((s, si) => html`<div class="set-row ${s.done ? 'done' : ''}" data-set="${si}">
      <span class="n">${si + 1}</span>
      ${cardio ? html`<span></span>` : html`<input type="number" inputmode="decimal" step="any" min="0" data-f="kg" value="${s.kg}" placeholder="${sug?.kg ?? 'kg'}" aria-label="Séria ${si + 1}, kilogramy">`}
      <input type="number" inputmode="numeric" step="1" min="0" data-f="reps" value="${s.reps}" placeholder="${prev?.sets[si]?.reps ?? it.repsMax ?? ''}" aria-label="Séria ${si + 1}, ${cardio ? 'minúty' : 'opakovania'}">
      <button class="check" data-check="${si}" aria-pressed="${s.done}" aria-label="Séria ${si + 1} hotová">✓</button></div>`)}
    <div class="row wrap" style="margin-top:6px"><button class="btn small" data-addset="${ei}">+ Séria</button>
      ${en.sets.length > 1 ? html`<button class="btn small" data-delset="${ei}">− Séria</button>` : ''}
      ${ex.equip === 'barbell' ? html`<button class="btn small" data-plates="${ei}">Kotúče</button>` : ''}</div>
    <p class="muted plates-out" style="margin:6px 0 0" hidden></p>
  </section>`;
}

function viewWorkout() {
  const a = S().active;
  if (!a) {
    const p = plan();
    return html`<h1>Tréning</h1><div class="card empty"><p>Práve necvičíš.</p>
      ${p ? html`<button class="btn primary block" data-start="${nextDayIndex(p, S().workouts)}">Začať: ${p.days[nextDayIndex(p, S().workouts)].name}</button>` : html`<a class="btn primary block" href="#/plan">Vytvoriť plán</a>`}
      <button class="btn block" style="margin-top:8px" data-start="free">Voľný tréning</button></div>`;
  }
  const done = a.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const total = a.entries.reduce((n, e) => n + e.sets.length, 0);
  return html`<div class="row between"><div><h1 style="margin:0">${a.name}</h1><small class="muted"><span id="elapsed"></span> · ${done}/${total} sérií${a.deload ? ' · deload' : ''}</small></div>
    <button class="btn primary" id="finish">Dokončiť</button></div>
    <div style="height:12px"></div>
    ${a.entries.map(entryCard)}
    <section class="card"><label class="field"><span>Pridať cvik</span><select id="add-ex"><option value="">Vyber cvik…</option>
      ${Object.entries(PATTERNS).map(([pk, pl]) => html`<optgroup label="${pl}">${EXERCISES.filter((e) => e.pattern === pk).map((e) => html`<option value="${e.id}">${e.name}</option>`)}</optgroup>`)}</select></label>
      <button class="btn danger block" id="discard">Zrušiť tréning</button></section>`;
}

function bindWorkout(root) {
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.start) return startWorkout(t.dataset.start === 'free' ? null : +t.dataset.start);
    const a = S().active;
    if (!a) return;
    const card = t.closest('[data-entry]');
    const ei = card ? +card.dataset.entry : -1;
    if (t.dataset.check != null) return toggleSet(ei, +t.dataset.check, card);
    if (t.dataset.addset != null) {
      store.update((s) => {
        const sets = s.active.entries[ei].sets;
        const last = sets.at(-1) || { kg: '' };
        sets.push({ kg: last.kg, reps: '', done: false });
      });
      return render();
    }
    if (t.dataset.delset != null) {
      store.update((s) => s.active.entries[ei].sets.pop());
      return render();
    }
    if (t.dataset.remove != null) {
      if (!(await confirmDialog(`Odstrániť ${exById[a.entries[ei].exId].name} z tréningu?`, 'Odstrániť', true))) return;
      store.update((s) => s.active.entries.splice(ei, 1));
      return render();
    }
    if (t.dataset.plates != null) {
      const o = $('.plates-out', card);
      const kgs = a.entries[ei].sets.map((s) => +s.kg).filter(Boolean);
      const kg = kgs.length ? Math.max(...kgs) : 0;
      const bar = S().settings.bar;
      if (!kg) o.textContent = 'Najprv zadaj váhu.';
      else if (kg < bar) o.textContent = `Váha je menšia ako samotná tyč (${bar} kg).`;
      else {
        const r = plates(kg, bar);
        o.textContent = `${fmtKg(kg)} kg = tyč ${bar} kg + na každú stranu: ${r.plates.length ? r.plates.map(fmtKg).join(' + ') : 'nič'} kg${r.rest ? ` (chýba ${fmtKg(r.rest)} kg/strana)` : ''}`;
      }
      o.hidden = false;
      return;
    }
    if (t.id === 'finish') return finishWorkout();
    if (t.id === 'discard') {
      if (!(await confirmDialog('Zrušiť tréning? Zapísané série sa neuložia.', 'Zrušiť tréning', true))) return;
      store.update((s) => { s.active = null; });
      wakeLock?.release();
      renderTimer();
      go('#/');
    }
  });
  root.addEventListener('input', (e) => {
    const inp = e.target.closest('input[data-f]');
    if (!inp) return;
    const ei = +inp.closest('[data-entry]').dataset.entry;
    const si = +inp.closest('[data-set]').dataset.set;
    store.update((s) => { s.active.entries[ei].sets[si][inp.dataset.f] = inp.value === '' ? '' : Math.max(0, +inp.value); });
  });
  $('#add-ex', root)?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    store.update((s) => s.active.entries.push(newEntry(e.target.value, null, s.active.deload)));
    render();
    $$('[data-entry]').at(-1)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  const el = $('#elapsed', root);
  if (el) {
    const tick = () => { if (S().active) el.textContent = mm((Date.now() - S().active.started) / 1000); };
    tick();
    const iv = setInterval(() => (document.contains(el) ? tick() : clearInterval(iv)), 1000);
  }
}

function toggleSet(ei, si, card) {
  const a = S().active;
  const en = a.entries[ei];
  const set = en.sets[si];
  const row = $(`[data-set="${si}"]`, card);
  if (set.done) {
    store.update(() => { set.done = false; });
    row.classList.remove('done');
    $('.check', row).setAttribute('aria-pressed', 'false');
    return;
  }
  // empty fields take their placeholder (previous / suggested values), like Strong/Hevy
  const kgIn = $('[data-f="kg"]', row);
  const repIn = $('[data-f="reps"]', row);
  const kg = kgIn ? (kgIn.value !== '' ? +kgIn.value : +kgIn.placeholder || 0) : 0;
  const reps = repIn.value !== '' ? +repIn.value : +repIn.placeholder || 0;
  if (!reps) {
    toast('Zadaj počet opakovaní.');
    repIn.focus();
    return;
  }
  const prs = exById[en.exId].pattern === 'cardio' ? [] : newRecords(S().workouts, en.exId, en.sets.filter((s, i) => i !== si), { kg, reps });
  store.update((s) => {
    Object.assign(set, { kg, reps, done: true });
    // carry weight forward to the next empty set
    const next = en.sets[si + 1];
    if (next && next.kg === '' && kg) next.kg = kg;
    if (prs.length) {
      s.active.prs = (s.active.prs || []).filter((r) => r.exId !== en.exId);
      s.active.prs.push({ exId: en.exId, label: prs[0], kg, reps });
    }
  });
  if (prs.length) {
    toast(`🏆 Nový rekord: ${prs[0]} — ${kg ? `${fmtKg(kg)} kg × ` : ''}${reps}`);
    buzz([60, 40, 60, 40, 120]);
  }
  render();
  startRest(en.target?.rest);
}

async function finishWorkout() {
  const a = S().active;
  const done = a.entries.reduce((n, e) => n + doneSets(e).length, 0);
  if (!done) {
    if (await confirmDialog('Nemáš odškrtnutú žiadnu sériu. Zrušiť tréning bez uloženia?', 'Zrušiť tréning', true)) {
      store.update((s) => { s.active = null; });
      go('#/');
    }
    return;
  }
  const open = a.entries.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
  if (open && !(await confirmDialog(`${open} sérií nie je odškrtnutých. Uložiť tréning len s hotovými sériami?`, 'Uložiť'))) return;
  const w = {
    id: a.id,
    date: a.started,
    duration: Math.round((Date.now() - a.started) / 1000),
    name: a.name,
    planId: a.planId,
    dayIdx: a.dayIdx,
    prs: a.prs || [],
    entries: a.entries
      .map((e) => ({ exId: e.exId, sets: e.sets.filter((s) => s.done).map((s) => ({ kg: +s.kg || 0, reps: +s.reps, done: true })) }))
      .filter((e) => e.sets.length),
  };
  store.update((s) => {
    s.workouts.push(w);
    s.active = null;
  });
  wakeLock?.release();
  renderTimer();
  toast(w.prs.length ? `Tréning uložený · ${w.prs.length}× nový rekord 🏆` : 'Tréning uložený 💪');
  go(`#/historia/${w.id}`);
}

// ---------- library ----------
let libFilter = { q: '', muscle: '', equip: '' };
function viewLibrary() {
  return html`<h1>Stroje a cviky</h1>
  <div class="searchbar"><div class="grid2">
    <label class="field" style="grid-column:1/-1;margin:0"><span class="sr">Hľadať</span><input type="search" id="q" placeholder="Hľadať stroj alebo cvik…" value="${libFilter.q}"></label>
    <label class="field" style="margin:0"><span class="sr">Sval</span><select id="fm"><option value="">Všetky svaly</option>${Object.entries(MUSCLES).map(([k, v]) => html`<option value="${k}" ${libFilter.muscle === k ? 'selected' : ''}>${v}</option>`)}</select></label>
    <label class="field" style="margin:0"><span class="sr">Vybavenie</span><select id="fe"><option value="">Všetko vybavenie</option>${Object.entries(EQUIP).map(([k, v]) => html`<option value="${k}" ${libFilter.equip === k ? 'selected' : ''}>${v}</option>`)}</select></label>
  </div></div>
  <p class="muted" id="count" aria-live="polite"></p>
  <div class="ex-grid" id="lib">${EXERCISES.map((ex) => html`<a class="ex-card" href="#/cvik/${ex.id}" data-id="${ex.id}">${thumb(ex.id, '')}<div><b>${ex.name}</b><small class="muted">${ex.machine}</small></div></a>`)}</div>`;
}

function bindLibrary(root) {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const apply = () => {
    libFilter = { q: $('#q', root).value, muscle: $('#fm', root).value, equip: $('#fe', root).value };
    const q = norm(libFilter.q.trim());
    let n = 0;
    for (const card of $$('.ex-card', root)) {
      const ex = exById[card.dataset.id];
      const ok = (!q || norm(`${ex.name} ${ex.machine} ${muscles(ex.primary)}`).includes(q))
        && (!libFilter.muscle || ex.primary.includes(libFilter.muscle) || ex.secondary.includes(libFilter.muscle))
        && (!libFilter.equip || ex.equip === libFilter.equip);
      card.hidden = !ok;
      n += ok;
    }
    $('#count', root).textContent = `${n} ${n === 1 ? 'cvik' : n >= 2 && n <= 4 ? 'cviky' : 'cvikov'}`;
  };
  root.addEventListener('input', apply);
  apply();
}

let player;
function viewExercise(id) {
  const ex = exById[id];
  if (!ex) return html`<div class="card empty"><p>Cvik sa nenašiel.</p><a class="btn" href="#/cviky">Späť na cviky</a></div>`;
  const ws = S().workouts;
  const r = records(ws, id);
  const hist = exerciseHistory(ws, id);
  const cardio = ex.pattern === 'cardio';
  const inWorkout = S().active;
  return html`<a href="#/cviky" class="muted">← Všetky cviky</a>
  <h1 style="margin-top:6px">${ex.name}</h1>
  <div class="chips"><span class="chip">${ex.machine}</span><span class="chip">${EQUIP[ex.equip]}</span><span class="chip">${'●'.repeat(ex.level)}${'○'.repeat(3 - ex.level)} náročnosť</span></div>
  <div class="player" id="player"></div>
  <p>${ex.summary}</p>
  <div class="chips">${ex.primary.map((m) => html`<span class="chip p">${MUSCLES[m]}</span>`)}${ex.secondary.map((m) => html`<span class="chip">${MUSCLES[m]}</span>`)}</div>
  <p class="muted" style="font-size:.8rem">Zvýraznené = hlavné svaly, ostatné = pomocné.</p>
  ${inWorkout ? html`<button class="btn primary block" id="add-to" style="margin-bottom:14px">+ Pridať do tréningu</button>` : ''}
  <section class="card"><h2>Nastavenie stroja</h2><ol class="steps">${ex.setup.map((s) => html`<li>${s}</li>`)}</ol></section>
  <section class="card"><h2>Postup</h2><ol class="steps">${ex.steps.map((s) => html`<li>${s}</li>`)}</ol></section>
  <section class="card"><h2>Časté chyby</h2><ul class="bad">${ex.mistakes.map((s) => html`<li>${s}</li>`)}</ul></section>
  ${ex.tips?.length ? html`<section class="card"><h2>Tipy</h2><ul class="good">${ex.tips.map((s) => html`<li>${s}</li>`)}</ul></section>` : ''}
  <section class="card"><h2>Tvoje rekordy</h2>
    ${hist.length ? html`<div class="grid2">
      ${cardio ? html`<div class="stat"><b>${r.maxReps?.value ?? '–'}</b><span>najdlhšie (min)</span></div>` : html`
      <div class="stat"><b>${r.maxKg ? fmtKg(r.maxKg.value) : '–'}</b><span>max kg${r.maxKg ? ` (× ${r.maxKg.reps})` : ''}</span></div>
      <div class="stat"><b>${r.e1rm ? fmtKg(r.e1rm.value) : '–'}</b><span>odhad 1RM (kg)</span></div>
      <div class="stat"><b>${r.maxReps?.value ?? '–'}</b><span>najviac opakovaní</span></div>
      <div class="stat"><b>${r.volume ? fmtKg(r.volume.value) : '–'}</b><span>max objem v tréningu (kg)</span></div>`}</div>
      <h3 style="margin-top:14px">${cardio ? 'Minúty' : 'Odhad 1RM'} v čase</h3>
      ${lineChart(hist.map((h) => ({ x: h.date, y: cardio ? h.reps : h.best1rm || h.reps })), cardio ? 'min' : 'kg')}
      <table class="t"><thead><tr><th>Dátum</th><th>Série</th><th class="num">${cardio ? 'min' : '1RM'}</th></tr></thead><tbody>
      ${hist.slice(-8).reverse().map((h) => html`<tr><td>${fmtDate(h.date)}</td><td>${h.sets.map((s) => `${s.kg ? fmtKg(s.kg) + '×' : ''}${s.reps}`).join(', ')}</td><td class="num">${cardio ? h.reps : fmtKg(h.best1rm)}</td></tr>`)}</tbody></table>`
    : html`<p class="muted">Zatiaľ žiadne záznamy. Po prvom tréningu tu uvidíš svoje maximá a graf.</p>`}
  </section>`;
}

function bindExercise(root, id) {
  const ex = exById[id];
  if (!ex) return;
  player = mountPlayer($('#player', root), ex.anim, { label: `Animácia: ${ex.name}` });
  $('#add-to', root)?.addEventListener('click', () => {
    store.update((s) => s.active.entries.push(newEntry(id, null, s.active.deload)));
    toast('Pridané do tréningu');
    go('#/trening');
  });
}

// ---------- progress ----------
function viewProgress(tab) {
  const ws = S().workouts;
  const tabs = html`<div class="seg" role="tablist" style="margin-bottom:14px">
    <a class="btn ${tab !== 'rekordy' ? 'primary' : ''}" style="flex:1" href="#/pokrok" role="tab" aria-selected="${tab !== 'rekordy'}">História</a>
    <a class="btn ${tab === 'rekordy' ? 'primary' : ''}" style="flex:1" href="#/pokrok/rekordy" role="tab" aria-selected="${tab === 'rekordy'}">Rekordy</a></div>`;
  if (!ws.length) return html`<h1>Pokrok</h1>${tabs}<div class="card empty"><p>Zatiaľ žiadny uložený tréning.</p><a class="btn primary" href="#/trening">Začať tréning</a></div>`;
  if (tab === 'rekordy') {
    const rows = EXERCISES.map((ex) => ({ ex, r: records(ws, ex.id) })).filter((x) => x.r.maxReps && x.ex.pattern !== 'cardio')
      .sort((a, b) => (b.r.e1rm?.value || 0) - (a.r.e1rm?.value || 0));
    return html`<h1>Pokrok</h1>${tabs}<section class="card"><h2>Osobné rekordy</h2>
      <table class="t"><thead><tr><th>Cvik</th><th class="num">Max</th><th class="num">1RM</th><th class="num">Dátum</th></tr></thead><tbody>
      ${rows.map(({ ex, r }) => html`<tr><td><a href="#/cvik/${ex.id}">${ex.name}</a></td>
        <td class="num">${r.maxKg ? `${fmtKg(r.maxKg.value)}×${r.maxKg.reps}` : `${r.maxReps.value} opak.`}</td>
        <td class="num">${r.e1rm ? fmtKg(r.e1rm.value) : '–'}</td><td class="num">${fmtDate((r.maxKg || r.maxReps).date, { day: 'numeric', month: 'numeric' })}</td></tr>`)}
      </tbody></table><p class="muted" style="margin-top:8px;font-size:.8rem">1RM = odhad maxima na 1 opakovanie (Epleyho vzorec), presný do ~10 opakovaní.</p></section>`;
  }
  // calendar: last 12 weeks, Monday first
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * 11);
  const daysOn = new Set(ws.map((w) => new Date(w.date).toDateString()));
  const cells = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) cells.push({ on: daysOn.has(d.toDateString()), today: +d === +today, label: d.toLocaleDateString('sk-SK') });
  const wk = weeklySets(ws, exById);
  const ms = Object.keys(MUSCLES).filter((m) => m !== 'cardio' && wk[m]);
  return html`<h1>Pokrok</h1>${tabs}
  <section class="card"><h2>Posledných 12 týždňov</h2><div class="cal" role="img" aria-label="Kalendár tréningov: ${daysOn.size} tréningových dní">${cells.map((c) => html`<i class="${c.on ? 'on' : ''} ${c.today ? 'today' : ''}" title="${c.label}"></i>`)}</div></section>
  <section class="card"><h2>Série na sval za 7 dní</h2><p class="muted">Odporúčanie pre rast: 10–20 ťažkých sérií týždenne.</p>
    ${ms.length ? ms.map((m) => { const v = wk[m]; return html`<div class="mrow"><span>${MUSCLES[m]}</span><div class="bar"><i class="${v > 22 ? 'hi' : v < 10 ? 'mid' : ''}" style="width:${Math.min(100, (v / 20) * 100)}%"></i></div><span>${fmtKg(v)}</span></div>`; }) : html`<p class="muted">Za posledných 7 dní nič.</p>`}
  </section>
  <section class="card"><h2>Tréningy</h2><ul class="list">${ws.slice().reverse().map((w) => {
    const sets = w.entries.reduce((n, e) => n + e.sets.length, 0);
    const vol = w.entries.reduce((v, e) => v + e.sets.reduce((x, s) => x + s.kg * s.reps, 0), 0);
    return html`<li><a class="item" href="#/historia/${w.id}"><span class="t"><b>${w.name || 'Tréning'}</b><small>${fmtDate(w.date, { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })} · ${sets} sérií · ${fmtKg(vol)} kg${w.duration ? ` · ${fmtDur(w.duration)}` : ''}</small></span>${w.prs?.length ? html`<span class="chip p">🏆 ${w.prs.length}</span>` : ''}</a></li>`;
  })}</ul></section>`;
}

function viewWorkoutDetail(id) {
  const w = S().workouts.find((x) => x.id === id);
  if (!w) return html`<div class="card empty"><p>Tréning sa nenašiel.</p><a class="btn" href="#/pokrok">Späť</a></div>`;
  const vol = w.entries.reduce((v, e) => v + e.sets.reduce((x, s) => x + s.kg * s.reps, 0), 0);
  return html`<a href="#/pokrok" class="muted">← Pokrok</a><h1 style="margin-top:6px">${w.name || 'Tréning'}</h1>
  <p class="muted">${fmtDate(w.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
  <div class="grid2" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
    <div class="stat"><b>${w.duration ? fmtDur(w.duration) : '–'}</b><span>trvanie</span></div>
    <div class="stat"><b>${fmtKg(vol)}</b><span>objem (kg)</span></div>
    <div class="stat"><b>${w.prs?.length || 0}</b><span>rekordy</span></div></div>
  ${w.prs?.length ? html`<section class="card hero"><h2>Nové rekordy 🏆</h2><ul class="good">${w.prs.map((r) => html`<li><b>${exById[r.exId]?.name ?? r.exId}</b>: ${r.label} — ${r.kg ? `${fmtKg(r.kg)} kg × ` : ''}${r.reps}</li>`)}</ul></section>` : ''}
  ${w.entries.map((e) => html`<section class="card"><h3><a href="#/cvik/${e.exId}">${exById[e.exId]?.name ?? e.exId}</a></h3>
    <table class="t"><tbody>${e.sets.map((s, i) => html`<tr><td>${i + 1}.</td><td>${s.kg ? `${fmtKg(s.kg)} kg` : ''}</td><td>${s.reps} ${exById[e.exId]?.pattern === 'cardio' ? 'min' : 'opak.'}</td><td class="num muted">${s.kg ? `1RM ~${fmtKg(e1rm(s.kg, s.reps))}` : ''}</td></tr>`)}</tbody></table></section>`)}
  <button class="btn danger block" id="del-w">Vymazať tréning</button>`;
}

function bindWorkoutDetail(root, id) {
  $('#del-w', root)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Natrvalo vymazať tento tréning?', 'Vymazať', true))) return;
    store.update((s) => { s.workouts = s.workouts.filter((w) => w.id !== id); });
    toast('Tréning vymazaný');
    go('#/pokrok');
  });
}

// ---------- settings ----------
function viewSettings() {
  const st = S().settings;
  return html`<h1>Nastavenia</h1>
  <form class="card" id="set-form">
    <fieldset><legend>Vzhľad</legend>${seg('theme', { auto: 'Podľa systému', dark: 'Tmavý', light: 'Svetlý' }, st.theme)}</fieldset>
    <label class="field"><span>Hmotnosť olympijskej tyče (kg)</span><input type="number" name="bar" min="0" step="0.5" value="${st.bar}" inputmode="decimal"></label>
    <label class="row" style="margin-bottom:10px"><input type="checkbox" name="autoRest" ${st.autoRest ? 'checked' : ''}> Automaticky spustiť časovač pauzy po sérii</label>
    <label class="row"><input type="checkbox" name="sound" ${st.sound ? 'checked' : ''}> Zvuk na konci pauzy</label>
  </form>
  <details class="card"><summary>Vylúčené cviky (${st.exclude.length})</summary>
    <p class="muted" style="margin-top:8px">Odškrtni cviky, ktoré nechceš v pláne (zranenie, obsadený stroj…). Prejaví sa pri ďalšom generovaní plánu.</p>
    <form id="excl">${Object.entries(PATTERNS).map(([pk, pl]) => html`<fieldset><legend>${pl}</legend>${EXERCISES.filter((e) => e.pattern === pk).map((e) => html`<label class="row" style="margin-bottom:6px"><input type="checkbox" value="${e.id}" ${st.exclude.includes(e.id) ? '' : 'checked'}> ${e.name}</label>`)}</fieldset>`)}</form>
  </details>
  <section class="card"><h2>Záloha dát</h2>
    <p class="muted">Všetko sa ukladá len v tomto prehliadači (nič sa neposiela na server). Zálohu si stiahni pred zmenou telefónu alebo vymazaním prehliadača.</p>
    <div class="row wrap"><button class="btn" id="exp">Stiahnuť zálohu</button>
      <label class="btn" for="imp">Obnoviť zo zálohy</label><input type="file" id="imp" accept="application/json,.json" class="sr">
      <button class="btn danger" id="reset">Vymazať všetko</button></div>
    ${store.lastSaveError() ? html`<p class="hint down">Ukladanie zlyhalo — úložisko prehliadača je plné alebo zablokované.</p>` : ''}
  </section>
  <section class="card"><h2>O aplikácii</h2><p class="muted">Tréningový plán pre naše fitko. Funguje aj offline — na telefóne ju pridaj na plochu (Zdieľať → Pridať na plochu).
    Rady v aplikácii nenahrádzajú trénera ani lekára; pri bolesti cvik ukonči.</p></section>`;
}

function bindSettings(root) {
  $('#set-form', root).addEventListener('change', (e) => {
    const f = e.currentTarget;
    store.update((s) => {
      s.settings.theme = new FormData(f).get('theme');
      s.settings.bar = Math.max(0, +f.bar.value || 0);
      s.settings.autoRest = f.autoRest.checked;
      s.settings.sound = f.sound.checked;
    });
    applyTheme();
  });
  $('#excl', root).addEventListener('change', (e) => {
    const unchecked = $$('input:not(:checked)', e.currentTarget).map((i) => i.value);
    store.update((s) => { s.settings.exclude = unchecked; });
  });
  $('#exp', root).addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `fitapp-zaloha-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#imp', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!(await confirmDialog('Obnovenie prepíše všetky aktuálne dáta. Pokračovať?', 'Obnoviť', true))) return;
    try {
      store.importJSON(await file.text());
      toast(`Obnovené: ${S().workouts.length} tréningov`);
      applyTheme();
      render();
    } catch {
      toast('Súbor sa nepodarilo načítať — nie je to platná záloha.');
    }
  });
  $('#reset', root).addEventListener('click', async () => {
    if (!(await confirmDialog('Natrvalo vymazať plán, všetky tréningy a rekordy?', 'Vymazať všetko', true))) return;
    store.reset();
    applyTheme();
    toast('Dáta vymazané');
    go('#/');
  });
}

function applyTheme() {
  const t = S().settings.theme;
  const light = t === 'light' || (t === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  $('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f5f2' : '#0e1013');
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

// ================= ROUTER =================
const ROUTES = [
  [/^$/, 'Dnes', viewToday, bindToday, 'dnes'],
  [/^plan$/, 'Plán', viewPlan, bindPlan, 'plan'],
  [/^trening$/, 'Tréning', viewWorkout, bindWorkout, 'trening'],
  [/^cviky$/, 'Cviky', viewLibrary, bindLibrary, 'cviky'],
  [/^cvik\/([\w-]+)$/, (id) => exById[id]?.name ?? 'Cvik', viewExercise, bindExercise, 'cviky'],
  [/^pokrok(?:\/(rekordy))?$/, 'Pokrok', viewProgress, null, 'pokrok'],
  [/^historia\/([\w-]+)$/, 'Tréning', viewWorkoutDetail, bindWorkoutDetail, 'pokrok'],
  [/^nastavenia$/, 'Nastavenia', viewSettings, bindSettings, ''],
];

let lastPath = null;
function render() {
  const path = location.hash.replace(/^#\/?/, '');
  const [re, title, view, bind, nav] = ROUTES.find(([r]) => r.test(path)) || ROUTES[0];
  const arg = path.match(re)?.[1];
  player?.destroy();
  player = null;
  const main = $('#main');
  const fresh = document.createElement('div');
  fresh.innerHTML = view(arg).s;
  main.replaceChildren(fresh);
  hydrateThumbs(fresh);
  bind?.(fresh, arg);
  document.title = `${typeof title === 'function' ? title(arg) : title} · FitApp`;
  for (const a of $$('.nav a')) {
    if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    a.classList.toggle('live', a.dataset.nav === 'trening' && !!S().active);
  }
  if (path !== lastPath) {
    scrollTo(0, 0);
    if (lastPath !== null) $('h1', main)?.setAttribute('tabindex', '-1'), $('h1', main)?.focus({ preventScroll: true });
    lastPath = path;
  }
}

addEventListener('hashchange', render);
applyTheme();
render();
renderTimer();
requestWakeLock();
store.persist();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
