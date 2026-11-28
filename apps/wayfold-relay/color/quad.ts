/** Convex quadrilateral from an unordered point set. Used to find the frame corners. */

export interface Pt {
  x: number;
  y: number;
}

export interface Line {
  nx: number;
  ny: number;
  c: number;
}

export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Four sharp turns of a convex hull, in hull order. */
export function quadCorners(hull: Pt[]): Pt[] | null {
  const n = hull.length;
  if (n < 4) return null;
  if (n === 4) return hull.slice();
  const score = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const prev = hull[(i + n - 1) % n]!;
    const next = hull[(i + 1) % n]!;
    const p = hull[i]!;
    const v1x = p.x - prev.x;
    const v1y = p.y - prev.y;
    const v2x = next.x - p.x;
    const v2y = next.y - p.y;
    const l1 = Math.hypot(v1x, v1y) || 1;
    const l2 = Math.hypot(v2x, v2y) || 1;
    score[i] = Math.atan2((v1x / l1) * (v2y / l2) - (v1y / l1) * (v2x / l2), (v1x / l1) * (v2x / l2) + (v1y / l1) * (v2y / l2));
  }
  const ranked = score.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const minSep = Math.max(1, Math.floor(n / 10));
  const chosen: number[] = [];
  for (const item of ranked) {
    if (chosen.every((c) => circularDist(c, item.i, n) >= minSep)) chosen.push(item.i);
    if (chosen.length === 4) break;
  }
  if (chosen.length < 4) return null;
  chosen.sort((a, b) => a - b);
  return chosen.map((i) => hull[i]!);
}

function circularDist(a: number, b: number, n: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, n - d);
}

export function fitLine(pts: Pt[]): Line | null {
  if (pts.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const tr = xx + yy;
  const det = xx * yy - xy * xy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  let tx = xy;
  let ty = l1 - xx;
  if (Math.abs(tx) + Math.abs(ty) < 1e-6) {
    tx = l1 - yy;
    ty = xy;
  }
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const nx = -ty;
  const ny = tx;
  return { nx, ny, c: nx * mx + ny * my };
}

export function intersectLines(p: Line, q: Line): Pt | null {
  const d = p.nx * q.ny - p.ny * q.nx;
  if (Math.abs(d) < 1e-8) return null;
  return { x: (p.c * q.ny - p.ny * q.c) / d, y: (p.nx * q.c - p.c * q.nx) / d };
}

/** Replace the four rough corners with the intersections of the fitted sides. */
export function refineQuad(hull: Pt[], corners: Pt[]): Pt[] | null {
  const sides: Pt[][] = [[], [], [], []];
  for (const p of hull) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < 4; i++) {
      const d = segmentDistance(p, corners[i]!, corners[(i + 1) % 4]!);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const a = corners[best]!;
    const b = corners[(best + 1) % 4]!;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2;
    if (t > 0.15 && t < 0.85) sides[best]!.push(p);
  }
  const lines: Line[] = [];
  for (let i = 0; i < 4; i++) {
    const pts = sides[i]!.length >= 2 ? sides[i]! : [corners[i]!, corners[(i + 1) % 4]!];
    const line = fitLine(pts);
    if (!line) return null;
    lines.push(line);
  }
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const hit = intersectLines(lines[(i + 3) % 4]!, lines[i]!);
    if (!hit || !Number.isFinite(hit.x) || !Number.isFinite(hit.y)) return null;
    out.push(hit);
  }
  return out;
}

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby || 1;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + abx * t;
  const y = a.y + aby * t;
  return Math.hypot(p.x - x, p.y - y);
}
