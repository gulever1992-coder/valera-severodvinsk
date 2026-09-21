// Общие утилиты: математика, пространственные хэши, столкновения 2D (окружности и повёрнутые прямоугольники)
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
export const angNorm = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
export const angDiff = (a, b) => angNorm(b - a);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));
export const smooth = (t) => t * t * (3 - 2 * t);

export function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

export function fmtMoney(n) {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ---------- статичная сетка (препятствия, дорожные сегменты) ----------
export class Grid {
  constructor(cs = 24) { this.cs = cs; this.m = new Map(); this.stamp = 0; }
  _k(ix, iz) { return (ix + 2048) * 4096 + (iz + 2048); }
  add(o, minx, minz, maxx, maxz) {
    const cs = this.cs;
    for (let ix = Math.floor(minx / cs); ix <= Math.floor(maxx / cs); ix++)
      for (let iz = Math.floor(minz / cs); iz <= Math.floor(maxz / cs); iz++) {
        const k = this._k(ix, iz);
        let l = this.m.get(k);
        if (!l) this.m.set(k, (l = []));
        l.push(o);
      }
  }
  query(minx, minz, maxx, maxz, cb) {
    const cs = this.cs;
    const st = ++this.stamp;
    for (let ix = Math.floor(minx / cs); ix <= Math.floor(maxx / cs); ix++)
      for (let iz = Math.floor(minz / cs); iz <= Math.floor(maxz / cs); iz++) {
        const l = this.m.get(this._k(ix, iz));
        if (!l) continue;
        for (let i = 0; i < l.length; i++) {
          const o = l[i];
          if (o._s === st) continue;
          o._s = st;
          if (cb(o) === false) return;
        }
      }
  }
}

// ---------- препятствия ----------
export const Obst = { grid: new Grid(24), list: [] };

export function addObb(cx, cz, hx, hz, rot, h, kind = 'building', extra) {
  const o = { t: 0, cx, cz, hx, hz, rot, c: Math.cos(rot), s: Math.sin(rot), h, kind, ...extra };
  const r = Math.hypot(hx, hz);
  Obst.grid.add(o, cx - r, cz - r, cx + r, cz + r);
  Obst.list.push(o);
  return o;
}
export function addCircle(x, z, r, h, kind = 'prop', extra) {
  const o = { t: 1, x, z, r, h, kind, ...extra };
  Obst.grid.add(o, x - r, z - r, x + r, z + r);
  Obst.list.push(o);
  return o;
}

const _n = { x: 0, z: 0, hit: false, obj: null };
// выталкивает окружность из препятствий. возвращает {x,z,hit,obj}
export function resolveCircle(x, z, r, out = _n, minH = 0) {
  out.hit = false; out.obj = null;
  Obst.grid.query(x - r, z - r, x + r, z + r, (o) => {
    if (o.h < minH || o.off) return;
    if (o.t === 1) {
      const dx = x - o.x, dz = z - o.z;
      const rr = r + o.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.0001;
        const pen = rr - d;
        x += (dx / d) * pen; z += (dz / d) * pen;
        out.hit = true; out.obj = o; out.nx = dx / d; out.nz = dz / d;
      }
    } else {
      const dx = x - o.cx, dz = z - o.cz;
      const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
      const qx = clamp(lx, -o.hx, o.hx), qz = clamp(lz, -o.hz, o.hz);
      const ex = lx - qx, ez = lz - qz;
      const d2 = ex * ex + ez * ez;
      if (d2 >= r * r) return;
      let nx, nz, pen;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2); nx = ex / d; nz = ez / d; pen = r - d;
      } else {
        const px = o.hx - Math.abs(lx), pz = o.hz - Math.abs(lz);
        if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; pen = px + r; }
        else { nx = 0; nz = Math.sign(lz) || 1; pen = pz + r; }
      }
      const wx = nx * o.c - nz * o.s, wz = nx * o.s + nz * o.c;
      x += wx * pen; z += wz * pen;
      out.hit = true; out.obj = o; out.nx = wx; out.nz = wz;
    }
  });
  out.x = x; out.z = z;
  return out;
}

// луч в 2D. возвращает {t,obj} либо null
export function rayObst(ox, oz, dx, dz, maxD, minH = 2) {
  let best = null, bt = maxD;
  const ex = ox + dx * maxD, ez = oz + dz * maxD;
  Obst.grid.query(Math.min(ox, ex) - 1, Math.min(oz, ez) - 1, Math.max(ox, ex) + 1, Math.max(oz, ez) + 1, (o) => {
    if (o.h < minH || o.off) return;
    let t;
    if (o.t === 1) {
      const fx = ox - o.x, fz = oz - o.z;
      const b = fx * dx + fz * dz;
      const c = fx * fx + fz * fz - o.r * o.r;
      const disc = b * b - c;
      if (disc < 0) return;
      t = -b - Math.sqrt(disc);
      if (t < 0) { if (c < 0) t = 0; else return; }
    } else {
      const px = ox - o.cx, pz = oz - o.cz;
      const lx = px * o.c + pz * o.s, lz = -px * o.s + pz * o.c;
      const ldx = dx * o.c + dz * o.s, ldz = -dx * o.s + dz * o.c;
      let t0 = 0, t1 = maxD;
      for (let a = 0; a < 2; a++) {
        const p = a ? lz : lx, d = a ? ldz : ldx, h = a ? o.hz : o.hx;
        if (Math.abs(d) < 1e-8) { if (Math.abs(p) > h) return; }
        else {
          let ta = (-h - p) / d, tb = (h - p) / d;
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) return;
        }
      }
      t = t0;
    }
    if (t >= 0 && t < bt) { bt = t; best = o; }
  });
  return best ? { t: bt, obj: best } : null;
}

export function pointBlocked(x, z, r = 0.3) {
  let b = false;
  Obst.grid.query(x - r, z - r, x + r, z + r, (o) => {
    if (o.off) return;
    if (o.t === 1) { if (dist2(x, z, o.x, o.z) < (o.r + r) * (o.r + r)) { b = true; return false; } }
    else {
      const dx = x - o.cx, dz = z - o.cz;
      const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
      if (Math.abs(lx) < o.hx + r && Math.abs(lz) < o.hz + r) { b = true; return false; }
    }
  });
  return b;
}

// ---------- динамическая сетка точек (сущности) ----------
export class DynGrid {
  constructor(cs = 20) { this.cs = cs; this.m = new Map(); }
  clear() { this.m.clear(); }
  add(o, x, z) {
    const k = (Math.floor(x / this.cs) + 2048) * 4096 + (Math.floor(z / this.cs) + 2048);
    let l = this.m.get(k);
    if (!l) this.m.set(k, (l = []));
    l.push(o);
  }
  near(x, z, r, cb) {
    const cs = this.cs;
    for (let ix = Math.floor((x - r) / cs); ix <= Math.floor((x + r) / cs); ix++)
      for (let iz = Math.floor((z - r) / cs); iz <= Math.floor((z + r) / cs); iz++) {
        const l = this.m.get((ix + 2048) * 4096 + (iz + 2048));
        if (!l) continue;
        for (let i = 0; i < l.length; i++) if (cb(l[i]) === false) return;
      }
  }
}

// ---------- геометрия ----------
export function segIntersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const qp = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { t, u, x: a[0] + r[0] * t, z: a[1] + r[1] * t };
}
export function closestOnSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  return { t, x: ax + dx * t, z: az + dz * t };
}
export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// SAT для двух повёрнутых прямоугольников
export function obbOverlap(a, b, margin = 0) {
  const axes = [[a.c, a.s], [-a.s, a.c], [b.c, b.s], [-b.s, b.c]];
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (const [ax, az] of axes) {
    const ra = (a.hx + margin) * Math.abs(a.c * ax + a.s * az) + (a.hz + margin) * Math.abs(-a.s * ax + a.c * az);
    const rb = b.hx * Math.abs(b.c * ax + b.s * az) + b.hz * Math.abs(-b.s * ax + b.c * az);
    if (Math.abs(dx * ax + dz * az) > ra + rb) return false;
  }
  return true;
}
