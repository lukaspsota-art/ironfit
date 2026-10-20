// Reusable machine shapes for exercise animations (viewBox 200×200, floor y=182).
// Each returns [tag, attrs] (or an array of them for multi-part pieces — spread those).

export const seat = (x, y, w = 34) => ['rect', { x: x - w / 2, y, width: w, height: 7, rx: 3 }];
export const post = (x, y1, y2 = 182) => ['line', { x1: x, y1, x2: x, y2 }];
export const beam = (x1, y1, x2, y2) => ['line', { x1, y1, x2, y2 }];
// thick padded line (backrest, bench top)
export const pad = (x1, y1, x2, y2) => ['line', { x1, y1, x2, y2, class: 'fx-pad-line' }];
// dashed outline of a weight-stack housing; pair with prop { type:'stack', x: x-8, y: y+18, w:16, h:28 }
export const stack = (x, y = 128) => [['rect', { x: x - 11, y: y - 4, width: 22, height: 58, rx: 2, class: 'fx-frame' }]];
// flat bench at height y (top surface), from x1 to x2, with two legs
export const bench = (x1, x2, y = 140) => [pad(x1, y, x2, y), post(x1 + 8, y + 4), post(x2 - 8, y + 4)];
// a pulley wheel
export const pulley = (x, y) => ['circle', { cx: x, cy: y, r: 4 }];
