// Генерация города: дороги, граф движения, здания, деревья, фонари, вывески, районы
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, UNI } from './state.js';
import { ROADS, ROAD_W, RING, WATER, DISTRICTS, POIS, MONUMENTS, FOREST, TOWER_ZONE, WORLD, PX, P } from './mapdata.js';
import { makeSign } from './assets.js';
import {
  Grid, addObb, addCircle, Obst, segIntersect, closestOnSeg, pointInPoly, obbOverlap, rand, pick, chance, clamp, dist, dist2, TAU,
} from './util.js';

export const City = {
  roads: [], graph: null, buildings: [], pois: [], trees: [], lamps: [], districts: DISTRICTS, water: WATER, forest: FOREST,
  segGrid: new Grid(30), bGrid: new Grid(30), busStops: [],
};

// ---------- вода ----------
const WG = { cs: 2, w: 0, h: 0, data: null };
function bakeWater() {
  WG.w = Math.ceil((WORLD.maxX + 300) / WG.cs); WG.h = Math.ceil((WORLD.maxZ + 300) / WG.cs);
  WG.data = new Uint8Array(WG.w * WG.h);
  for (let iz = 0; iz < WG.h; iz++) for (let ix = 0; ix < WG.w; ix++) {
    const x = ix * WG.cs, z = iz * WG.cs;
    for (const poly of WATER) if (pointInPoly(x, z, poly)) { WG.data[iz * WG.w + ix] = 1; break; }
  }
}
City.isWater = (x, z) => {
  if (x < 0 || z < 0) { for (const poly of WATER) if (pointInPoly(x, z, poly)) return true; return false; }
  const ix = (x / WG.cs) | 0, iz = (z / WG.cs) | 0;
  if (ix >= WG.w || iz >= WG.h) return false;
  return WG.data[iz * WG.w + ix] === 1;
};
City.inBounds = (x, z) => x > WORLD.minX && x < WORLD.maxX && z > WORLD.minZ && z < WORLD.maxZ;

// ---------- дороги и граф ----------
function prepareRoads() {
  const roads = ROADS.map((r) => ({ ...r, w: ROAD_W[r.type], pts: r.pts.map((p) => [p[0], p[1]]) }));
  // кольцо
  const ring = { name: 'кольцо', type: 'street', w: RING.width, pts: [], oneway: true, ring: true, limit: 8 };
  const n = 32;
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; ring.pts.push([RING.cx + Math.cos(a) * RING.r, RING.cz - Math.sin(a) * RING.r]); }
  roads.push(ring);
  // прилипание концов дорог к другим дорогам
  for (const r of roads) {
    if (r.ring) continue;
    for (const ei of [0, r.pts.length - 1]) {
      const p = r.pts[ei];
      let best = null, bd = 9;
      for (const o of roads) {
        if (o === r) continue;
        for (let i = 0; i < o.pts.length - 1; i++) {
          const c = closestOnSeg(p[0], p[1], o.pts[i][0], o.pts[i][1], o.pts[i + 1][0], o.pts[i + 1][1]);
          const d = dist(p[0], p[1], c.x, c.z);
          if (d < bd) { bd = d; best = c; }
        }
      }
      if (best && bd > 0.01) { r.pts[ei] = [best.x, best.z]; }
    }
  }
  roads.forEach((r, i) => { r.id = i; r.lvl = r.type === 'major' ? 3 : r.type === 'street' ? 2 : 1; r.limit = r.limit || (r.type === 'major' ? 15 : r.type === 'street' ? 11 : 8); });
  City.roads = roads;
  G.roads = roads;
  // сегментная сетка
  for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i], b = r.pts[i + 1];
    const s = { a, b, road: r, i };
    City.segGrid.add(s, Math.min(a[0], b[0]) - 2, Math.min(a[1], b[1]) - 2, Math.max(a[0], b[0]) + 2, Math.max(a[1], b[1]) + 2);
  }
}

function buildGraph() {
  const segs = [];
  City.roads.forEach((r) => { for (let i = 0; i < r.pts.length - 1; i++) segs.push({ a: r.pts[i], b: r.pts[i + 1], road: r, splits: [0, 1] }); });
  const g = new Grid(40);
  segs.forEach((s) => g.add(s, Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1])));
  for (const s of segs) {
    g.query(Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1]), (o) => {
      if (o === s || o.road === s.road) return;
      const h = segIntersect(s.a, s.b, o.a, o.b);
      if (h) s.splits.push(clamp(h.t, 0, 1));
    });
  }
  const nodes = [], nmap = new Map(), edges = [];
  const node = (x, z) => {
    const k = Math.round(x / 1.5) + ',' + Math.round(z / 1.5);
    let n = nmap.get(k);
    if (!n) { n = { id: nodes.length, x, z, out: [], in: [] }; nodes.push(n); nmap.set(k, n); }
    return n;
  };
  const eGrid = new Grid(40);
  for (const s of segs) {
    const ts = [...new Set(s.splits.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
    for (let i = 0; i < ts.length - 1; i++) {
      const p = [s.a[0] + (s.b[0] - s.a[0]) * ts[i], s.a[1] + (s.b[1] - s.a[1]) * ts[i]];
      const q = [s.a[0] + (s.b[0] - s.a[0]) * ts[i + 1], s.a[1] + (s.b[1] - s.a[1]) * ts[i + 1]];
      const len = dist(p[0], p[1], q[0], q[1]);
      if (len < 1.0) continue;
      const A = node(p[0], p[1]), B = node(q[0], q[1]);
      if (A === B) continue;
      const mk = (a, b, dx, dz) => {
        const e = { a, b, len, dx, dz, road: s.road, w: s.road.w, limit: s.road.limit, id: edges.length, idx: 0 };
        edges.push(e); a.out.push(e); b.in.push(e); return e;
      };
      const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
      const e1 = mk(A, B, dx, dz);
      const e2 = s.road.oneway ? null : mk(B, A, -dx, -dz);
      if (e2) { e1.rev = e2; e2.rev = e1; }
      eGrid.add(e1, Math.min(A.x, B.x) - 2, Math.min(A.z, B.z) - 2, Math.max(A.x, B.x) + 2, Math.max(A.z, B.z) + 2);
    }
  }
  nodes.forEach((n) => { n.junction = new Set([...n.out, ...n.in].map((e) => e.road.id)).size > 1 || n.out.length + n.in.length > 2; });
  City.graph = { nodes, edges, eGrid };
  G.graph = City.graph;
}

// смещение полосы вправо для правостороннего движения
export function laneOffset(e, lane) {
  const f = e.road.type === 'major' ? (lane ? 0.125 : 0.375) : e.road.ring ? 0.2 : 0.25;
  return e.w * f;
}
export function edgePoint(e, s, off) {
  const t = clamp(s / e.len, 0, 1);
  const x = e.a.x + (e.b.x - e.a.x) * t, z = e.a.z + (e.b.z - e.a.z) * t;
  return [x + -e.dz * off, z + e.dx * off];
}

City.nearestRoad = (x, z, R = 40) => {
  let best = null, bd = R;
  City.segGrid.query(x - R, z - R, x + R, z + R, (s) => {
    const c = closestOnSeg(x, z, s.a[0], s.a[1], s.b[0], s.b[1]);
    const d = dist(x, z, c.x, c.z);
    if (d < bd) { bd = d; best = { dist: d, x: c.x, z: c.z, seg: s, road: s.road }; }
  });
  return best;
};
City.onRoad = (x, z) => { const n = City.nearestRoad(x, z, 12); return n && n.dist < n.road.w / 2 ? n : null; };
City.districtAt = (x, z) => {
  let best = null, bd = 1e12;
  for (const d of City.districts) { const dd = dist2(x, z, d.pos[0], d.pos[1]); if (dd < bd) { bd = dd; best = d; } }
  return best;
};
City.streetAt = (x, z) => {
  const n = City.nearestRoad(x, z, 30);
  return n && !n.road.ring ? n.road.name : n ? 'пл. Кораблестроителей' : '';
};
City.randomRoadPoint = (near, rmin, rmax, off = 0) => {
  // случайная точка на дорожном ребре в кольце [rmin,rmax] вокруг near
  const edges = City.graph.edges;
  for (let k = 0; k < 40; k++) {
    const e = edges[(Math.random() * edges.length) | 0];
    const s = Math.random() * e.len;
    const [x, z] = edgePoint(e, s, off || laneOffset(e, Math.random() < 0.5 ? 0 : 1));
    const d = dist(x, z, near.x, near.z);
    if (d >= rmin && d <= rmax) return { x, z, e, s };
  }
  return null;
};

// ---------- материалы ----------
function facadeMaterial() {
  const t = G.tex;
  const mat = new THREE.MeshLambertMaterial({ map: t.facade, vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tMask = { value: t.facadeMask };
    sh.uniforms.uNight = UNI.night;
    sh.fragmentShader = 'uniform sampler2D tMask;\nuniform float uNight;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        diffuseColor *= sampledDiffuseColor;
        float wmk = texture2D( tMask, vMapUv ).r;
        float wr = fract(sin(dot(floor(vMapUv), vec2(12.9898,78.233)))*43758.5453);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 glass = mix(vec3(0.07,0.09,0.13), vec3(0.34,0.44,0.56)*(0.55+0.6*wr), 1.0-uNight);
        float litw = step(0.56, wr) * uNight;
        glass = mix(glass, vec3(1.0,0.8,0.5)*(0.8+0.4*wr), litw);
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, wmk);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0,0.78,0.45)*wmk*litw*1.15;`);
  };
  return mat;
}

const PAL = {
  khrush: ['#e8d9a0', '#d9c27a', '#a9c2d4', '#d9a7a0', '#b6cba8', '#cfcfc8', '#e6e2d4', '#c9a27a'],
  panel9: ['#dcdcdc', '#c8d4e0', '#e0c8c8', '#d0d8c0', '#bcc8d8', '#e8e0c0', '#d8c0a0'],
  stalin: ['#e8c26a', '#d8b060', '#e0d0a8', '#c8a878', '#e8dcc0'],
  brick: ['#b0684a', '#a05a40', '#b87a58', '#96604a'],
  shop: ['#c8c8c8', '#a0b0c0', '#d8c8a0', '#b0b8a0', '#c0a898'],
  garage: ['#8a8a86', '#7a6a5a', '#9a5a3a', '#6a7a7a'],
  tower: ['#f0f0f0', '#d8e4f0', '#f0d8c0', '#c8d8e8'],
};
const TYPES = [
  { n: 'khrush', L: [32, 62], W: [11, 12], fl: [5, 5], pal: 'khrush', w: 6 },
  { n: 'panel9', L: [36, 74], W: [12, 13], fl: [9, 9], pal: 'panel9', w: 4 },
  { n: 'stalin', L: [42, 86], W: [13, 15], fl: [4, 5], pal: 'stalin', w: 2 },
  { n: 'brick', L: [24, 48], W: [11, 12], fl: [3, 4], pal: 'brick', w: 1.5 },
  { n: 'shop', L: [14, 28], W: [10, 15], fl: [1, 2], pal: 'shop', w: 2.2, floorH: 4 },
  { n: 'garage', L: [24, 44], W: [6, 7], fl: [1, 1], pal: 'garage', w: 0.8, floorH: 2.8 },
];

function boxBuilding(o) {
  // o: cx,cz,L,W,fl,floorH,rot,color,roof
  const H = o.fl * (o.floorH || 3);
  const g = new THREE.BoxGeometry(o.L, H, o.W);
  const uv = g.attributes.uv;
  const bays = Math.max(1, Math.round(o.L / 3.3)), baysW = Math.max(1, Math.round(o.W / 3.3));
  const off = Math.floor(Math.random() * 40) + 1;
  const rows = o.floorH === 4 || o.floorH === 2.8 ? o.fl : o.fl;
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v, u = uv.getX(i), w = uv.getY(i);
    if (f === 2 || f === 3) { uv.setXY(i, 0.5, 0.06); continue; }
    const rep = f < 2 ? baysW : bays;
    uv.setXY(i, u * rep + off, w * rows);
  }
  const c = new THREE.Color(o.color), rc = new THREE.Color(o.roof || '#5a5a5a');
  const arr = new Float32Array(24 * 3);
  for (let i = 0; i < 24; i++) { const cc = i >= 8 && i < 12 ? rc : c; arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.translate(0, H / 2, 0);
  g.rotateY(-o.rot);
  g.translate(o.cx, 0, o.cz);
  return g.toNonIndexed();
}
function jitterColor(hex, a = 0.06) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h + rand(-a, a) * 0.3, clamp(hsl.s + rand(-a, a), 0, 1), clamp(hsl.l + rand(-a, a), 0.05, 0.95));
  return '#' + c.getHexString();
}

function clearOfRoads(cx, cz, hx, hz, rot, margin) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const R = Math.hypot(hx, hz) + margin + 10;
  let ok = true;
  City.segGrid.query(cx - R, cz - R, cx + R, cz + R, (sg) => {
    const half = sg.road.w / 2 + margin + 3.2;
    const len = dist(sg.a[0], sg.a[1], sg.b[0], sg.b[1]);
    const n = Math.max(1, Math.ceil(len / 3));
    for (let k = 0; k <= n; k++) {
      const px = sg.a[0] + ((sg.b[0] - sg.a[0]) * k) / n, pz = sg.a[1] + ((sg.b[1] - sg.a[1]) * k) / n;
      const dx = px - cx, dz = pz - cz;
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      // расстояние до прямоугольника
      const ex = Math.max(Math.abs(lx) - hx, 0), ez = Math.max(Math.abs(lz) - hz, 0);
      if (ex * ex + ez * ez < half * half) { ok = false; return false; }
    }
  });
  return ok;
}
function waterNear(cx, cz, r) {
  for (let a = 0; a < 8; a++) if (City.isWater(cx + Math.cos(a * 0.785) * r, cz + Math.sin(a * 0.785) * r)) return true;
  return City.isWater(cx, cz);
}
function inForest(x, z) { for (const p of FOREST) if (pointInPoly(x, z, p)) return true; return false; }
function overlapsBuilding(o, margin) {
  let hit = false;
  const R = Math.hypot(o.hx, o.hz) + margin + 1;
  City.bGrid.query(o.cx - R, o.cz - R, o.cx + R, o.cz + R, (b) => { if (obbOverlap(o, b, margin)) { hit = true; return false; } });
  return hit;
}
function registerBuilding(cx, cz, hx, hz, rot, h, extra = {}) {
  const b = { cx, cz, hx, hz, rot, c: Math.cos(rot), s: Math.sin(rot), h, ...extra };
  City.buildings.push(b);
  City.bGrid.add(b, cx - Math.hypot(hx, hz), cz - Math.hypot(hx, hz), cx + Math.hypot(hx, hz), cz + Math.hypot(hx, hz));
  addObb(cx, cz, hx, hz, rot, h, 'building', { b });
  return b;
}

// ---------- построение мешей ----------
function stripGeometry(pts, w0, w1, y, uvFn, closed = false) {
  // полоса вдоль ломаной между смещениями w0..w1 (вправо/влево от осевой)
  const pos = [], uv = [], idx = [];
  let acc = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    let tx, tz;
    const pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(n - 1, i + 1)];
    if (closed) { const pa2 = pts[(i - 1 + n) % n], pb2 = pts[(i + 1) % n]; tx = pb2[0] - pa2[0]; tz = pb2[1] - pa2[1]; }
    else { tx = pb[0] - pa[0]; tz = pb[1] - pa[1]; }
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz, nz = tx;
    if (i > 0) acc += dist(p[0], p[1], pts[i - 1][0], pts[i - 1][1]);
    // мitre
    let m = 1;
    if (i > 0 && i < n - 1) {
      const ax = p[0] - pts[i - 1][0], az = p[1] - pts[i - 1][1], bx = pts[i + 1][0] - p[0], bz = pts[i + 1][1] - p[1];
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
      const cos = (ax * bx + az * bz) / (la * lb);
      m = clamp(1 / Math.sqrt((1 + cos) / 2 + 1e-4), 1, 1.6);
    }
    const a = [p[0] + nx * w0 * m, p[1] + nz * w0 * m], b = [p[0] + nx * w1 * m, p[1] + nz * w1 * m];
    pos.push(a[0], y, a[1], b[0], y, b[1]);
    const u = uvFn(a, b, acc);
    uv.push(...u);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildRoadMeshes(root) {
  const t = G.tex;
  const matFor = { 1: t.roadLane, 2: t.roadStreet, 3: t.roadMajor };
  const mats = {};
  for (const k of [1, 2, 3]) mats[k] = new THREE.MeshLambertMaterial({ map: matFor[k], side: THREE.DoubleSide });
  const swMat = new THREE.MeshLambertMaterial({ map: t.sidewalk, side: THREE.DoubleSide });
  const swGeos = [];
  City.roads.forEach((r, idx) => {
    const y = 0.06 + r.lvl * 0.03 + (idx % 5) * 0.004;
    const closed = false;
    const g = stripGeometry(r.pts, -r.w / 2, r.w / 2, y, (a, b, acc) => [0, acc / 12, 1, acc / 12], closed);
    const m = new THREE.Mesh(g, mats[r.lvl]);
    m.receiveShadow = true;
    root.add(m);
    if (r.ring) return;
    // тротуары
    for (const side of [1, -1]) {
      const w0 = side * (r.w / 2), w1 = side * (r.w / 2 + 3.4);
      swGeos.push(stripGeometry(r.pts, w0, w1, 0.05, (a, b) => [a[0] / 3.2, a[1] / 3.2, b[0] / 3.2, b[1] / 3.2]));
    }
  });
  // тротуарное кольцо и внутренний остров
  const ringPts = City.roads.find((r) => r.ring).pts;
  swGeos.push(stripGeometry(ringPts, RING.width / 2, RING.width / 2 + 3, 0.05, (a, b) => [a[0] / 3.2, a[1] / 3.2, b[0] / 3.2, b[1] / 3.2]));
  const sw = new THREE.Mesh(mergeGeometries(swGeos.map((g) => g.toNonIndexed())), swMat);
  sw.receiveShadow = true; root.add(sw);
  // остров
  const isl = new THREE.Mesh(new THREE.CylinderGeometry(RING.islandR, RING.islandR, 0.3, 24), new THREE.MeshLambertMaterial({ map: t.grass }));
  isl.position.set(RING.cx, 0.15, RING.cz); isl.receiveShadow = true; root.add(isl);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(RING.islandR, 0.25, 4, 32), new THREE.MeshLambertMaterial({ color: 0x9a9a92 }));
  edge.rotation.x = Math.PI / 2; edge.position.set(RING.cx, 0.3, RING.cz); root.add(edge);
  addCircle(RING.cx, RING.cz, RING.islandR + 0.2, 4, 'monument');
  // монумент «Мир и труд»
  const mon = [];
  const mb = (w, h, d, x, y, z, c) => { const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(); const cc = new THREE.Color(c); const arr = []; for (let i = 0; i < g.attributes.position.count; i++) arr.push(cc.r, cc.g, cc.b); g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; };
  mon.push(mb(9, 1.2, 9, 0, 0.9, 0, '#8a8a86'), mb(6, 2.2, 6, 0, 2.6, 0, '#a0a09a'));
  mon.push(mb(1.3, 4.4, 1.0, -1.2, 6.0, 0, '#c8c8d0'), mb(1.3, 4.4, 1.0, 1.4, 6.0, 0, '#c8c8d0'));
  mon.push(mb(0.8, 1.0, 0.8, -1.2, 8.7, 0, '#d8d0c0'), mb(0.8, 1.0, 0.8, 1.4, 8.7, 0, '#d8d0c0'));
  mon.push(mb(0.3, 3.4, 0.3, 0.1, 9.4, 0, '#c02020'), mb(1.8, 1.0, 0.1, 1.0, 10.6, 0, '#c02020'));
  mon.push(mb(3.2, 0.8, 0.9, 0, 4.0, 0, '#c8a040'));
  const mm = new THREE.Mesh(mergeGeometries(mon), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mm.position.set(RING.cx, 0.3, RING.cz); mm.castShadow = true; root.add(mm);
}

function buildGround(root) {
  const t = G.tex;
  const gt = t.grass; gt.repeat.set(1400 / 16, 900 / 16);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 900).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: gt }));
  ground.position.set(600, 0, 310); ground.receiveShadow = true; root.add(ground);
  G.ground = ground;
  // вода
  const shapes = WATER.map((poly) => { const s = new THREE.Shape(); poly.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); return s; });
  const wg = new THREE.ShapeGeometry(shapes);
  wg.rotateX(-Math.PI / 2);
  const uv = wg.attributes.uv, pos = wg.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 24, pos.getZ(i) / 24);
  t.water.repeat.set(1, 1);
  const wm = new THREE.MeshLambertMaterial({ map: t.water, color: 0xffffff, side: THREE.DoubleSide });
  const water = new THREE.Mesh(wg, wm); water.position.y = 0.04; water.receiveShadow = true; root.add(water);
  G.waterMesh = water;
  // берег: тёмная полоса песка
}

function buildBuildings(root) {
  const mat = facadeMaterial();
  const geos = [];
  const signList = [];
  const roads = City.roads;
  // 1) здания POI
  for (const poi of POIS) {
    const [px, pz] = P(...poi.p);
    const near = City.nearestRoad(px, pz, 80);
    if (!near) continue;
    const road = near.road;
    const seg = near.seg;
    const ang = Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0]);
    const big = poi.big;
    const L = big ? 34 : poi.kind === 'home' ? 14 : rand(14, 22), W = big ? 20 : poi.kind === 'home' ? 8 : rand(10, 13);
    const fl = big ? 4 : poi.kind === 'home' ? 1 : pick([1, 2, 2, 3]);
    const floorH = poi.kind === 'home' ? 3 : fl <= 2 ? 4 : 3;
    // сторона: где находится POI относительно оси дороги
    const nx = -Math.sin(ang), nz = Math.cos(ang);
    const side = ((px - near.x) * nx + (pz - near.z) * nz) >= 0 ? 1 : -1;
    const base = road.w / 2 + 3.4 + 4 + W / 2;
    let placed = false;
    for (let att = 0; att < 30 && !placed; att++) {
      const along = (att % 2 ? 1 : -1) * Math.ceil(att / 2) * (L * 0.6);
      const dd = base + rand(0, 3) + (att > 14 ? 8 : 0);
      const cx = near.x + nx * side * dd + Math.cos(ang) * along, cz = near.z + nz * side * dd + Math.sin(ang) * along;
      const o = { cx, cz, hx: L / 2, hz: W / 2, c: Math.cos(ang), s: Math.sin(ang) };
      if (waterNear(cx, cz, 10) || overlapsBuilding(o, 3) || !clearOfRoads(cx, cz, L / 2, W / 2, ang, 1.5)) continue;
      const color = jitterColor(pick(PAL.shop));
      geos.push(boxBuilding({ cx, cz, L, W, fl, floorH, rot: ang, color, roof: '#4a4a4a' }));
      const b = registerBuilding(cx, cz, L / 2, W / 2, ang, fl * floorH, { poi });
      // вход: точка на тротуаре перед зданием
      const dirx = -nx * side, dirz = -nz * side; // от здания к дороге
      const ex = cx + dirx * (W / 2 + 2.2), ez = cz + dirz * (W / 2 + 2.2);
      const entry = { x: ex, z: ez };
      // вывеска
      const st = makeSign(poi.sign || poi.name, poi.color || '#444');
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(L * 0.85, 8), 1.6), new THREE.MeshBasicMaterial({ map: st }));
      sg.position.set(cx + dirx * (W / 2 + 0.08), Math.min(fl * floorH - 0.8, 4.4), cz + dirz * (W / 2 + 0.08));
      sg.rotation.y = Math.atan2(dirx, dirz);
      signList.push(sg);
      // вторая сторона окна-витрины (светлая полоса)
      const p = { ...poi, x: entry.x, z: entry.z, bx: cx, bz: cz, building: b, fl, ang };
      City.pois.push(p);
      placed = true;
    }
    if (!placed) { const p = { ...poi, x: near.x + nx * side * (road.w / 2 + 2), z: near.z + nz * side * (road.w / 2 + 2), fl: 1, bx: px, bz: pz }; City.pois.push(p); }
  }
  // 2) случайные дома вдоль дорог
  const totalLen = [];
  let sum = 0;
  City.segGrid.m.forEach((l) => l.forEach((s) => { if (!s._c) { s._c = 1; totalLen.push(s); } }));
  const segs = totalLen.filter((s) => !s.road.ring);
  const lens = segs.map((s) => dist(s.a[0], s.a[1], s.b[0], s.b[1]));
  lens.forEach((l) => (sum += l));
  const pickSeg = () => { let r = Math.random() * sum; for (let i = 0; i < segs.length; i++) { r -= lens[i]; if (r <= 0) return segs[i]; } return segs[0]; };
  const inTower = (x, z) => TOWER_ZONE.some(([a, b, c, d]) => x > a && x < c && z > b && z < d);
  const garageSeed = DISTRICTS.find((d) => d.id === 'garage').pos;
  for (let att = 0; att < 26000; att++) {
    const s = pickSeg();
    const len = dist(s.a[0], s.a[1], s.b[0], s.b[1]);
    const t = Math.random();
    const ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
    const px = s.a[0] + (s.b[0] - s.a[0]) * t, pz = s.a[1] + (s.b[1] - s.a[1]) * t;
    const nx = -Math.sin(ang), nz = Math.cos(ang);
    const side = Math.random() < 0.5 ? 1 : -1;
    // тип
    let type;
    const inTw = inTower(px, pz);
    const nearGarage = dist(px, pz, garageSeed[0], garageSeed[1]) < 130;
    if (inTw && chance(0.6)) type = { n: 'tower', L: [22, 34], W: [16, 22], fl: [14, 18], pal: 'tower' };
    else if (nearGarage && chance(0.5)) type = TYPES[5];
    else { let r = Math.random() * TYPES.reduce((a, b) => a + b.w, 0); type = TYPES[0]; for (const T of TYPES) { r -= T.w; if (r <= 0) { type = T; break; } } }
    const L = rand(type.L[0], type.L[1]), W = rand(type.W[0], type.W[1]);
    const row = chance(0.55) ? 0 : 1;
    const gap = row === 0 ? rand(4, 9) : rand(22, 60);
    const d = s.road.w / 2 + 3.4 + gap + W / 2;
    const cx = px + nx * side * d, cz = pz + nz * side * d;
    if (!City.inBounds(cx, cz) && !chance(0.1)) continue;
    let rot = ang;
    if (chance(0.16)) rot = ang + Math.PI / 2;
    const dw = type.n === 'garage' ? 0 : 0;
    const hx = L / 2, hz = W / 2 + dw;
    if (waterNear(cx, cz, Math.max(hx, hz) + 4)) continue;
    if (inForest(cx, cz) && chance(0.93)) continue;
    const o = { cx, cz, hx, hz, c: Math.cos(rot), s: Math.sin(rot) };
    if (overlapsBuilding(o, type.n === 'garage' ? 2.5 : 5)) continue;
    if (!clearOfRoads(cx, cz, hx, hz, rot, 1.5)) continue;
    if (dist(cx, cz, RING.cx, RING.cz) < 60) continue;
    const fl = Math.round(rand(type.fl[0], type.fl[1]));
    const floorH = type.floorH || 3;
    const color = jitterColor(pick(PAL[type.pal]));
    const roof = pick(['#4a4a4a', '#5a4a3a', '#6a6a66', '#3a4a5a']);
    geos.push(boxBuilding({ cx, cz, L, W, fl, floorH, rot, color, roof }));
    const H = fl * floorH;
    registerBuilding(cx, cz, hx, hz, rot, H, { type: type.n });
    // крышные надстройки
    if (H > 10 && chance(0.7)) {
      const bx = new THREE.BoxGeometry(3, 2.2, 3); bx.translate(rand(-hx * 0.5, hx * 0.5), H + 1.1, 0); bx.rotateY(-rot); bx.translate(cx, 0, cz);
      const g2 = bx.toNonIndexed(); const cc = new THREE.Color('#77736c'); const arr = []; for (let i = 0; i < g2.attributes.position.count; i++) arr.push(cc.r, cc.g, cc.b);
      g2.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3)); g2.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g2.attributes.position.count * 2).fill(0.5), 2));
      geos.push(g2);
    }
  }
  const merged = mergeGeometries(geos, false);
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  root.add(mesh);
  signList.forEach((s) => root.add(s));
}

function buildTrees(root) {
  const spots = [];
  const tgrid = new Grid(6);
  const okTree = (x, z, minRoad = 4.5) => {
    if (City.isWater(x, z) || City.isWater(x + 6, z) || City.isWater(x - 6, z)) return false;
    const nr = City.nearestRoad(x, z, 25);
    if (nr && nr.dist < nr.road.w / 2 + minRoad) return false;
    let bl = false;
    Obst.grid.query(x - 2, z - 2, x + 2, z + 2, (o) => { if (o.kind === 'building' && ((o.t === 0 && Math.abs((x - o.cx) * o.c + (z - o.cz) * o.s) < o.hx + 2 && Math.abs(-(x - o.cx) * o.s + (z - o.cz) * o.c) < o.hz + 2) )) { bl = true; return false; } });
    if (bl) return false;
    let near = false;
    tgrid.query(x - 2.5, z - 2.5, x + 2.5, z + 2.5, (t) => { if (dist2(x, z, t.x, t.z) < 6) { near = true; return false; } });
    return !near;
  };
  const add = (x, z, kind) => { const t = { x, z, kind, s: rand(0.8, 1.35) }; spots.push(t); tgrid.add(t, x - 1, z - 1, x + 1, z + 1); };
  // леса
  for (const poly of FOREST) {
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    poly.forEach(([x, z]) => { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); });
    const area = (maxx - minx) * (maxz - minz);
    const n = Math.min(900, area / 55);
    for (let i = 0; i < n; i++) {
      const x = rand(minx, maxx), z = rand(minz, maxz);
      if (!pointInPoly(x, z, poly) || !okTree(x, z, 3)) continue;
      add(x, z, chance(0.55) ? 'spruce' : 'birch');
    }
  }
  // дворы
  for (let i = 0; i < 2600; i++) {
    const x = rand(WORLD.minX, WORLD.maxX), z = rand(WORLD.minZ, WORLD.maxZ);
    if (!okTree(x, z)) continue;
    add(x, z, chance(0.5) ? 'birch' : 'spruce');
  }
  // задний план за пределами карты
  const outer = [];
  for (let i = 0; i < 900; i++) {
    const a = rand(0, TAU), r = rand(0, 1);
    const x = rand(-260, WORLD.maxX + 260), z = rand(-260, WORLD.maxZ + 260);
    if (x > WORLD.minX - 10 && x < WORLD.maxX + 10 && z > WORLD.minZ - 10 && z < WORLD.maxZ + 10) continue;
    if (City.isWater(x, z)) continue;
    outer.push({ x, z, kind: chance(0.6) ? 'spruce' : 'birch', s: rand(1, 1.6) }); void a; void r;
  }
  const all = spots.concat(outer);
  City.trees = spots;
  const birch = all.filter((t) => t.kind === 'birch'), spruce = all.filter((t) => t.kind === 'spruce');
  const dummy = new THREE.Object3D();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mkInst = (geo, mat, list, fn) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((t, i) => { fn(t, dummy); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.castShadow = true; im.frustumCulled = false; im.instanceMatrix.needsUpdate = true; root.add(im); return im;
  };
  // берёзы: ствол + крона
  const trunkG = new THREE.CylinderGeometry(0.13, 0.2, 6.0, 5).translate(0, 3, 0);
  const bt = mkInst(trunkG, new THREE.MeshLambertMaterial({ color: 0xe6e2d6 }), birch, (t, d) => { d.position.set(t.x, 0, t.z); d.scale.set(t.s, t.s, t.s); d.rotation.set(0, 0, 0); });
  void bt;
  const crownG = new THREE.IcosahedronGeometry(1, 0).scale(2, 2.8, 2).translate(0, 6.6, 0);
  const cm = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const bc = mkInst(crownG, cm, birch, (t, d) => { d.position.set(t.x, 0, t.z); d.scale.set(t.s, t.s, t.s); d.rotation.set(0, t.x * 3.7, 0); });
  birch.forEach((t, i) => bc.setColorAt(i, new THREE.Color().setHSL(rand(0.2, 0.26), rand(0.45, 0.6), rand(0.3, 0.42))));
  // ели
  const sTrunk = new THREE.CylinderGeometry(0.15, 0.22, 2, 5).translate(0, 1, 0);
  mkInst(sTrunk, new THREE.MeshLambertMaterial({ color: 0x4a3222 }), spruce, (t, d) => { d.position.set(t.x, 0, t.z); d.scale.set(t.s, t.s, t.s); d.rotation.set(0, 0, 0); });
  const coneG = mergeGeometries([new THREE.ConeGeometry(2.0, 4.2, 7).translate(0, 3.2, 0), new THREE.ConeGeometry(1.5, 3.6, 7).translate(0, 5.6, 0), new THREE.ConeGeometry(0.95, 3.0, 7).translate(0, 7.6, 0)].map((g) => g.toNonIndexed()));
  const sc = mkInst(coneG, cm, spruce, (t, d) => { d.position.set(t.x, 0, t.z); d.scale.set(t.s, t.s * rand(0.9, 1.2), t.s); d.rotation.set(0, t.z * 1.7, 0); });
  spruce.forEach((t, i) => sc.setColorAt(i, new THREE.Color().setHSL(rand(0.36, 0.42), rand(0.4, 0.55), rand(0.13, 0.22))));
  // коллизии стволов
  for (const t of spots) addCircle(t.x, t.z, 0.4, 8, 'tree');
}

function buildLamps(root) {
  const poles = [];
  const heads = [];
  const glow = [];
  const step = 46;
  for (const r of City.roads) {
    if (r.ring || r.lvl < 2) continue;
    let acc = 0;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const len = dist(a[0], a[1], b[0], b[1]);
      const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      let s = step - (acc % step);
      for (; s < len; s += step) {
        const side = ((r.id + Math.round(s / step)) % 2) ? 1 : -1;
        const off = r.w / 2 + 1.0;
        const x = a[0] + dx * s + -dz * off * side, z = a[1] + dz * s + dx * off * side;
        if (City.isWater(x, z)) continue;
        let inB = false;
        Obst.grid.query(x - 1, z - 1, x + 1, z + 1, (o) => { if (o.t === 0 && Math.abs((x - o.cx) * o.c + (z - o.cz) * o.s) < o.hx + 0.6 && Math.abs(-(x - o.cx) * o.s + (z - o.cz) * o.c) < o.hz + 0.6) { inB = true; return false; } });
        if (inB) continue;
        poles.push([x, z, -dz * side, dx * side]);
      }
      acc += len;
    }
  }
  const dummy = new THREE.Object3D();
  const poleG = mergeGeometries([new THREE.CylinderGeometry(0.08, 0.12, 7.5, 5).translate(0, 3.75, 0).toNonIndexed(), new THREE.BoxGeometry(0.1, 0.1, 1.8).translate(0, 7.4, -0.8).toNonIndexed()]);
  const pm = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: 0x555a60 }), Math.max(1, poles.length));
  const headG = new THREE.BoxGeometry(0.4, 0.15, 0.7).translate(0, 7.3, -1.6);
  City.lampHeadMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
  const hm = new THREE.InstancedMesh(headG, City.lampHeadMat, Math.max(1, poles.length));
  const gpos = [];
  poles.forEach((p, i) => {
    dummy.position.set(p[0], 0, p[1]);
    dummy.rotation.set(0, Math.atan2(p[2], p[3]) + Math.PI, 0);
    dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix); hm.setMatrixAt(i, dummy.matrix);
    // мировая позиция головки
    const hx = p[0] + Math.sin(dummy.rotation.y) * -1.6, hz = p[1] + Math.cos(dummy.rotation.y) * -1.6;
    gpos.push(hx, 7.2, hz);
    addCircle(p[0], p[1], 0.2, 7, 'pole');
    City.lamps.push({ x: hx, z: hz });
  });
  pm.frustumCulled = false; hm.frustumCulled = false; pm.castShadow = true;
  root.add(pm, hm);
  // ореолы ночью
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
  const gm = new THREE.PointsMaterial({ map: G.tex.glow, size: 14, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffcc77, opacity: 0 });
  const gp = new THREE.Points(gg, gm); gp.frustumCulled = false; root.add(gp);
  City.lampGlow = gp;
  // световые пятна на земле
  const spotG = new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2);
  const sm = new THREE.MeshBasicMaterial({ map: G.tex.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb060, opacity: 0 });
  const sp = new THREE.InstancedMesh(spotG, sm, Math.max(1, poles.length));
  poles.forEach((p, i) => { dummy.position.set(gpos[i * 3], 0.16, gpos[i * 3 + 2]); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); sp.setMatrixAt(i, dummy.matrix); });
  sp.frustumCulled = false; sp.renderOrder = 4; root.add(sp);
  City.lampSpots = sp;
}

function buildMonuments(root) {
  const mb = (w, h, d, x, y, z, c) => { const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(); const cc = new THREE.Color(c); const arr = []; for (let i = 0; i < g.attributes.position.count; i++) arr.push(cc.r, cc.g, cc.b); g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; };
  const list = [];
  for (const m of MONUMENTS) {
    if (m.kind === 'ring') continue;
    const [x, z] = P(...m.p);
    if (m.kind === 'alley') {
      for (let i = 0; i < 9; i++) {
        const px = x + i * 4 - 16, pz = z + Math.sin(i) * 2;
        list.push(mb(0.5, 2.0, 1.4, px, 1, pz, '#9a9a94'), mb(0.4, 0.3, 1.0, px, 2.15, pz, '#c02020'));
        addCircle(px, pz, 0.9, 2, 'prop');
      }
    } else {
      list.push(mb(0.4, 1.8, 1.6, x, 0.9, z, '#6a6a70'), mb(0.1, 1.0, 1.2, x, 1.1, z + 0.22, '#c8b060'));
      addCircle(x, z, 1.0, 2, 'prop');
    }
    City.monuments = City.monuments || []; City.monuments.push({ ...m, x, z });
  }
  if (list.length) { const mm = new THREE.Mesh(mergeGeometries(list), new THREE.MeshLambertMaterial({ vertexColors: true })); mm.castShadow = true; root.add(mm); }
}

function buildMarkers(root) {
  // столбы-маркеры возле интерактивных точек
  const cols = { shop: 0x66ff88, pharm: 0x66d0ff, food: 0xffcc44, weapon: 0xff5544, black: 0xaa55ff, repair: 0x4488ff, gym: 0x44ffaa, home: 0xffffff, hospital: 0xff6688, police: 0x4466ff };
  const ringG = new THREE.RingGeometry(1.0, 1.4, 24).rotateX(-Math.PI / 2);
  const beamG = new THREE.CylinderGeometry(0.9, 0.9, 6, 12, 1, true).translate(0, 3, 0);
  for (const p of City.pois) {
    const c = cols[p.kind];
    if (!c) continue;
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(ringG, mat); ring.position.y = 0.2;
    const beam = new THREE.Mesh(beamG, mat.clone()); beam.material.opacity = 0.09;
    grp.add(ring, beam);
    grp.position.set(p.x, 0, p.z);
    root.add(grp);
    p.marker = grp; p.color = c;
  }
}

// ---------- запуск ----------
export function buildCity(scene) {
  const root = new THREE.Group();
  scene.add(root);
  City.root = root;
  bakeWater();
  prepareRoads();
  buildGraph();
  buildGround(root);
  buildRoadMeshes(root);
  buildBuildings(root);
  buildMonuments(root);
  buildTrees(root);
  buildLamps(root);
  buildMarkers(root);
  // остановки автобусов на крупных дорогах
  for (const r of City.roads) {
    if (r.lvl < 2 || r.ring) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const len = dist(a[0], a[1], b[0], b[1]);
      if (len < 90) continue;
      const t = 0.5, dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      const off = r.w / 2 + 2.2;
      const sx = x + -dz * off, sz = z + dx * off;
      if (City.isWater(sx, sz) || pointInB(sx, sz)) continue;
      City.busStops.push({ x: sx, z: sz, road: r, rx: x, rz: z });
      const g = new THREE.Group();
      const m = new THREE.MeshLambertMaterial({ color: 0x3a6ab0 });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.15, 1.6), m); roof.position.y = 2.6; g.add(roof);
      for (const sx2 of [-2, 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), new THREE.MeshLambertMaterial({ color: 0x444444 })); p.position.set(sx2, 1.3, -0.6); g.add(p); }
      const back = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 0.05), new THREE.MeshLambertMaterial({ color: 0x9fc8e0, transparent: true, opacity: 0.5 })); back.position.set(0, 1.4, -0.7); g.add(back);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.05), new THREE.MeshBasicMaterial({ map: makeSign('А', '#2a5ab0') })); sign.position.set(2.4, 2.9, 0); g.add(sign);
      g.position.set(sx, 0, sz); g.rotation.y = Math.atan2(dx, dz) + Math.PI / 2 * 0; g.rotation.y = Math.atan2(-dz * -1, dx) * 0 + Math.atan2(dx, dz) - Math.PI / 2;
      root.add(g);
      break;
    }
  }
  return root;
}
function pointInB(x, z) { let b = false; Obst.grid.query(x - 2, z - 2, x + 2, z + 2, (o) => { if (o.t === 0 && Math.abs((x - o.cx) * o.c + (z - o.cz) * o.s) < o.hx + 2 && Math.abs(-(x - o.cx) * o.s + (z - o.cz) * o.c) < o.hz + 2) { b = true; return false; } }); return b; }
void PX; void UNI;
