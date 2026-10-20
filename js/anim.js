// 2D side-view figure animation (forward kinematics) + simple machine drawing.
// Angles are absolute, in degrees: 0 = up, 90 = forward (right), 180 = down, 270/-90 = back.
// A pose: { hip:[x,y], torso, thigh, shin, foot?, uarm, farm, thigh2?, shin2?, foot2?, uarm2?, farm2?, head?, s? }
// "2" limbs are the far side (drawn faded); they default to the near-side angles.

const SEG = { torso: 46, neck: 8, head: 9, thigh: 42, shin: 40, foot: 12, uarm: 29, farm: 27 };
const NS = 'http://www.w3.org/2000/svg';
const rad = (d) => (d * Math.PI) / 180;
const go = (p, a, l) => [p[0] + l * Math.sin(rad(a)), p[1] - l * Math.cos(rad(a))];
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// anim.fix = ['ankle', x, y] pins that joint (poses may then omit hip).
export function solve(anim, pose) {
  const j = skeleton(pose);
  if (!anim.fix) return j;
  const [name, x, y] = anim.fix;
  const dx = x - j[name][0];
  const dy = y - j[name][1];
  for (const k in j) j[k] = [j[k][0] + dx, j[k][1] + dy];
  return j;
}

export function skeleton(pose) {
  const hip = pose.hip || [0, 0];
  const torso = pose.torso ?? 0;
  const neck = go(hip, torso, SEG.torso);
  const shoulder = go(hip, torso, SEG.torso - 5);
  const head = go(neck, pose.head ?? torso, SEG.neck + SEG.head * 0.7);
  const leg = (th, sh, ft) => {
    const knee = go(hip, th, SEG.thigh);
    const ankle = go(knee, sh, SEG.shin);
    return [knee, ankle, go(ankle, ft ?? sh - 90, SEG.foot)];
  };
  const arm = (ua, fa) => {
    const elbow = go(shoulder, ua, SEG.uarm);
    return [elbow, go(elbow, fa, SEG.farm)];
  };
  const [knee, ankle, toe] = leg(pose.thigh, pose.shin, pose.foot);
  const [knee2, ankle2, toe2] = leg(pose.thigh2 ?? pose.thigh, pose.shin2 ?? pose.shin, pose.foot2 ?? pose.foot);
  const [elbow, wrist] = arm(pose.uarm, pose.farm);
  const [elbow2, wrist2] = arm(pose.uarm2 ?? pose.uarm, pose.farm2 ?? pose.farm);
  return { hip, neck, shoulder, head, knee, ankle, toe, knee2, ankle2, toe2, elbow, wrist, elbow2, wrist2 };
}

function lerpPose(a, b, t) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? b[k];
    const y = b[k] ?? a[k];
    out[k] = Array.isArray(x) ? x.map((v, i) => v + (y[i] - v) * t) : x + (y - x) * t;
  }
  return out;
}

// p in [0,1] runs through all keyframes; stack lift "s" defaults 0 at first pose, 1 at last.
export function poseAt(poses, p) {
  const n = poses.length - 1;
  const norm = poses.map((q, i) => ({ s: i === 0 ? 0 : i === n ? 1 : 0.5, ...q }));
  const x = Math.min(Math.max(p, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  return lerpPose(norm[i], norm[i + 1], x - i);
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

const at = (j, ref) => {
  if (Array.isArray(ref)) return ref;
  const parts = ref.split('+').map((r) => j[r]);
  return [parts.reduce((s, q) => s + q[0], 0) / parts.length, parts.reduce((s, q) => s + q[1], 0) / parts.length];
};

const LIMBS = [
  ['thigh2', 'hip', 'knee2', 'ankle2', 'toe2'],
  ['arm2', 'shoulder', 'elbow2', 'wrist2'],
];
const FRONT = [
  ['thigh', 'hip', 'knee', 'ankle', 'toe'],
  ['torso', 'hip', 'neck'],
  ['arm', 'shoulder', 'elbow', 'wrist'],
];

// Draw an exercise animation into `svg`. Returns { set(p), destroy() }.
export function createFigure(svg, anim) {
  svg.setAttribute('viewBox', anim.view || '0 0 200 200');
  svg.innerHTML = '';
  const hl = new Set(anim.hl || []);
  if (anim.floor !== false) el('line', { x1: 4, y1: 182, x2: 196, y2: 182, class: 'fx-floor' }, svg);
  const gMachine = el('g', { class: 'fx-machine' }, svg);
  for (const [tag, attrs] of anim.machine || []) el(tag, attrs, gMachine);
  const gDyn = el('g', { class: 'fx-dyn' }, svg);
  const props = (anim.props || []).map((pr) => ({ pr, node: el(pr.type === 'stack' ? 'rect' : 'line', {}, gDyn) }));
  const back = el('g', { class: 'fx-back' }, svg);
  const front = el('g', { class: 'fx-body' }, svg);
  const mk = (g, [name]) => el('polyline', { class: hl.has(name.replace('2', '')) ? 'hl' : '' }, g);
  const backLines = LIMBS.map((d) => [d, mk(back, d)]);
  const frontLines = FRONT.map((d) => [d, mk(front, d)]);
  const head = el('circle', { r: SEG.head, class: 'fx-head' }, front);
  const gGear = el('g', { class: 'fx-gear' }, svg);
  const gear = (anim.gear || []).map((g) => ({ g, node: el('g', {}, gGear) }));
  for (const { g, node } of gear) drawGear(g, node);
  const gFront = el('g', { class: 'fx-machine' }, svg);
  for (const [tag, attrs] of anim.machineFront || []) el(tag, attrs, gFront);

  function set(p) {
    const pose = poseAt(anim.poses, p);
    const j = solve(anim, pose);
    for (const [[, ...pts], line] of [...backLines, ...frontLines]) {
      line.setAttribute('points', pts.map((k) => j[k].map((v) => v.toFixed(1)).join(',')).join(' '));
    }
    head.setAttribute('cx', j.head[0].toFixed(1));
    head.setAttribute('cy', j.head[1].toFixed(1));
    for (const { pr, node } of props) {
      if (pr.type === 'stack') {
        const lift = pose.s * (pr.travel ?? 18);
        Object.entries({ x: pr.x, y: pr.y - lift, width: pr.w, height: pr.h, rx: 2, class: 'fx-stack' }).forEach(([k, v]) => node.setAttribute(k, v));
      } else {
        const a = at(j, pr.from);
        const b = at(j, pr.to);
        Object.entries({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: pr.type === 'cable' ? 'fx-cable' : 'fx-lever' }).forEach(([k, v]) => node.setAttribute(k, v));
      }
    }
    for (const { g, node } of gear) {
      const [x, y] = at(j, g.at);
      const [dx, dy] = g.offset || [0, 0];
      node.setAttribute('transform', `translate(${(x + dx).toFixed(1)},${(y + dy).toFixed(1)})`);
    }
  }

  set(0);
  return { set };
}

function drawGear(g, node) {
  switch (g.kind) {
    case 'barbell':
      el('circle', { r: 15, class: 'fx-plate' }, node);
      el('circle', { r: 3, class: 'fx-hub' }, node);
      break;
    case 'dumbbell':
      el('rect', { x: -9, y: -6, width: 18, height: 12, rx: 3, class: 'fx-plate' }, node);
      break;
    case 'kettlebell':
      el('circle', { cy: 9, r: 8, class: 'fx-plate' }, node);
      break;
    case 'pad':
      el('circle', { r: g.r ?? 6, class: 'fx-pad' }, node);
      break;
    case 'platform':
      el('rect', { x: -3, y: -(g.len ?? 36) / 2, width: 6, height: g.len ?? 36, rx: 2, transform: `rotate(${g.rot || 0})`, class: 'fx-pad' }, node);
      break;
    default: // handle
      el('circle', { r: 4, class: 'fx-hub' }, node);
  }
}

// Mounts an animated figure with play/pause + scrubber. Respects prefers-reduced-motion.
export function mountPlayer(container, anim, { label = 'Animácia cviku' } = {}) {
  container.innerHTML = `
    <svg class="fx" role="img" aria-label="${label}"></svg>
    <div class="fx-ctrl">
      <button type="button" class="btn icon" data-act="toggle" aria-label="Pozastaviť animáciu">❚❚</button>
      <input type="range" min="0" max="1000" value="0" aria-label="Fáza pohybu">
      <span class="fx-phase" aria-live="off">Štart</span>
    </div>`;
  const svg = container.querySelector('svg');
  const btn = container.querySelector('button');
  const range = container.querySelector('input');
  const phase = container.querySelector('.fx-phase');
  const fig = createFigure(svg, anim);
  const D = (anim.tempo || 1) * 3600;
  // timeline: hold 0.4s, concentric 1.2s, hold 0.4s, eccentric 1.6s (scaled by tempo)
  const cycle = (ms) => {
    const t = (ms % D) / D;
    if (t < 0.11) return [0, 'Štart'];
    if (t < 0.44) return [ease((t - 0.11) / 0.33), 'Záber (výdych)'];
    if (t < 0.55) return [1, 'Kontrakcia'];
    return [1 - ease((t - 0.55) / 0.45), 'Návrat pomaly (nádych)'];
  };
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let t0 = performance.now();
  let lastLabel = '';
  const render = (p, lbl) => {
    fig.set(p);
    range.value = Math.round(p * 1000);
    if (lbl !== lastLabel) phase.textContent = lastLabel = lbl;
  };
  const tick = (now) => {
    const [p, lbl] = cycle(now - t0);
    render(p, lbl);
    raf = requestAnimationFrame(tick);
  };
  const setPlaying = (on) => {
    playing = on;
    cancelAnimationFrame(raf);
    btn.textContent = on ? '❚❚' : '▶';
    btn.setAttribute('aria-label', on ? 'Pozastaviť animáciu' : 'Spustiť animáciu');
    if (on) {
      t0 = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  btn.addEventListener('click', () => setPlaying(!playing));
  range.addEventListener('input', () => {
    setPlaying(false);
    const p = range.value / 1000;
    render(p, p < 0.05 ? 'Štart' : p > 0.95 ? 'Kontrakcia' : 'Pohyb');
  });
  // pause when off-screen
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) cancelAnimationFrame(raf);
    else if (playing) setPlaying(true);
  });
  io.observe(container);
  setPlaying(playing);
  return { destroy: () => { cancelAnimationFrame(raf); io.disconnect(); } };
}

// Static thumbnail (start→end ghost) as SVG markup string for lists.
export function thumb(svg, anim) {
  createFigure(svg, anim).set(0.65);
}
