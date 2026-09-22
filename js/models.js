// Процедурные 3D-модели: персонажи (скелет из блоков), оружие, машины, автобус, велосипед.
// Все меши собираются из склеенных геометрий с цветами вершин — мало draw-call'ов, быстро работает на слабых ПК.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './state.js';
import { FACE, FACE_CELLS, FACE_SKIN } from './assets.js';
import { rand, pick, chance, lerp, clamp, damp } from './util.js';

const N = FACE_CELLS;
const C = (c) => new THREE.Color(c);

function boxG(w, h, d, x, y, z, color, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const cell = o.cell || 0;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v, u0 = uv.getX(i), v0 = uv.getY(i);
      if (f === 4 && o.front != null) {
        const col = o.front % N, row = Math.floor(o.front / N);
        uv.setXY(i, (col + u0) / N, 1 - (row + (1 - v0)) / N);
      } else {
        const col = cell % N, row = Math.floor(cell / N);
        uv.setXY(i, (col + 0.1 + 0.05 * u0) / N, 1 - (row + 0.1 + 0.05 * (1 - v0)) / N);
      }
    }
  }
  const c = C(color), cf = o.frontColor ? C(o.frontColor) : c;
  const arr = new Float32Array(24 * 3);
  for (let i = 0; i < 24; i++) { const cc = i >= 16 && i < 20 ? cf : c; arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  g.translate(x, y, z);
  return g.toNonIndexed();
}
const merge = (list) => mergeGeometries(list, false);

let pedMat = null;
export function pedMaterial() {
  if (!pedMat) pedMat = new THREE.MeshLambertMaterial({ map: G.tex.faces, vertexColors: true });
  return pedMat;
}

// ---------- внешность ----------
const SHIRTS = ['#3a4a6a', '#6a3a3a', '#2a2a2a', '#4a5a3a', '#8a7a5a', '#5a5a6a', '#7a4a2a', '#2a4a4a', '#9a9a9a', '#5a2a4a'];
const PANTS = ['#1a2030', '#2a2a2e', '#3a3a3a', '#26303f', '#4a3a2a'];
const HAIRS = ['#1a1410', '#3a2a1a', '#6a4a2a', '#a07a4a', '#c8a060', '#555555', '#7a3a1a'];

export function pedLook(type) {
  const L = { face: FACE.m1, skin: null, shirt: pick(SHIRTS), pants: pick(PANTS), shoes: '#1a1a1a', hair: pick(HAIRS), hairStyle: pick(['short', 'short', 'bald', 'long']), hat: null, scale: 1, w: 1, gang: null };
  switch (type) {
    case 'valera':
      return { face: FACE.valera, shirt: '#f0640a', shirt2: '#111111', pants: '#1c2436', shoes: '#e8e8e8', hair: '#a08050', hairStyle: 'valera', goatee: '#b5552a', hoodie: true, w: 1.1, scale: 1, gang: 'valera' };
    case 'salt':
      return { face: FACE.salt, shirt: '#6a7a5a', pants: '#4a5a4a', shoes: '#2a2a2a', hair: '#2a2a20', hairStyle: 'hood', hoodie: true, hoodColor: '#6a7a5a', w: 0.9, scale: 0.98, gang: 'salt', hunch: 1 };
    case 'punk':
      return { face: chance(0.5) ? FACE.punk : FACE.emo, shirt: pick(['#141414', '#241414']), shirt2: '#c0c0c0', pants: chance(0.5) ? '#7a1a1a' : '#111', shoes: '#0a0a0a', hair: pick(['#e0308a', '#30d060', '#3080e0', '#e0e030']), hairStyle: 'mohawk', studs: true, w: 0.92, gang: 'punk' };
    case 'emo':
      return { face: FACE.emo, shirt: '#151518', shirt2: '#d0308a', pants: '#101014', shoes: '#e8e8e8', hair: '#0c0c10', hairStyle: 'emo', w: 0.88, scale: 1.0, gang: 'punk' };
    case 'gop':
      return { face: FACE.gop, shirt: '#1c2f6a', pants: '#1c2f6a', shoes: '#e8e8e8', hair: '#3a2a1a', hairStyle: 'short', hat: 'kepka', hatColor: '#3a3a3a', stripes: '#ffffff', w: 1, gang: 'gop', squat: true };
    case 'rus':
      return { face: FACE.rus, shirt: '#a01030', shirt2: '#f0f0f0', pants: '#111111', shoes: '#111111', hair: '#111', hairStyle: 'bald', chain: true, w: 1.18, scale: 1.02, gang: 'rus' };
    case 'cop':
      return { face: FACE.cop, shirt: '#59677a', pants: '#3a4658', shoes: '#111', hair: '#3a2a1a', hairStyle: 'short', hat: 'furazhka', hatColor: '#3a4658', w: 1.02, gang: 'cop', vest: false };
    case 'omon':
      return { face: FACE.stern, shirt: '#2f3a2a', pants: '#2a3326', shoes: '#111', hair: '#111', hairStyle: 'bald', hat: 'helmet', hatColor: '#2a3326', vest: true, w: 1.2, scale: 1.03, gang: 'cop' };
    case 'ally':
      return { face: pick([FACE.m2, FACE.m3, FACE.m1]), shirt: '#2a6ac0', pants: '#1a2030', shoes: '#eee', hair: pick(HAIRS), hairStyle: 'short', hat: 'kepka', hatColor: '#1a3a6a', w: 1.02, gang: 'valera' };
    case 'woman': {
      const t = chance(0.5);
      return { face: t ? FACE.w1 : FACE.w2, shirt: pick(['#a04a6a', '#4a6a9a', '#7a2a2a', '#5a7a5a', '#8a8a8a', '#2a2a3a']), pants: pick(['#222a44', '#2a2a2a', '#5a3a4a']), shoes: '#222', hair: pick(HAIRS), hairStyle: 'long', w: 0.84, scale: 0.94 };
    }
    case 'old':
      return { face: FACE.old, shirt: pick(['#6a5a4a', '#4a4a5a', '#7a6a6a']), pants: '#3a3a3a', shoes: '#333', hair: '#bbb', hairStyle: pick(['short', 'bald']), hat: chance(0.5) ? 'ushanka' : null, hatColor: '#5a4a3a', w: 0.98, scale: 0.96, hunch: 0.5 };
    default: {
      L.face = pick([FACE.m1, FACE.m2, FACE.m3, FACE.m4, FACE.stern]);
      L.hat = chance(0.22) ? pick(['ushanka', 'kepka', 'kepka']) : null;
      L.hatColor = pick(['#3a3a3a', '#4a3a2a', '#2a3a4a', '#5a5a5a']);
      L.w = rand(0.92, 1.12); L.scale = rand(0.95, 1.05);
      return L;
    }
  }
}

// ---------- скелетные персонажи (скруглённые формы, один SkinnedMesh на человека) ----------
const BONE = { hips: 0, spine: 1, head: 2, shL: 3, elL: 4, shR: 5, elR: 6, thL: 7, knL: 8, thR: 9, knR: 10 };
function plainUV(g) {
  // разворачиваем в маленький (но не точечный) кусочек нейтральной «тканевой» ячейки 0 —
  // так у капсул/сфер появляется лёгкий объём и зерно вместо абсолютно плоского цвета
  const src = g.attributes.uv;
  const n = g.attributes.position.count, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const u = src ? src.getX(i) : 0.5, v = src ? src.getY(i) : 0.5;
    uv[i * 2] = (0.06 + 0.2 * u) / N; uv[i * 2 + 1] = 1 - (0.06 + 0.2 * (1 - v)) / N;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function paint(g, color) {
  const c = C(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
// prim: геометрия → масштаб → поворот → сдвиг → цвет
function prim(geo, color, x, y, z, o = {}) {
  let g = geo;
  if (o.sx || o.sy || o.sz) g.scale(o.sx || 1, o.sy || 1, o.sz || 1);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  g.translate(x, y, z);
  g = g.index ? g.toNonIndexed() : g;
  plainUV(g); paint(g, color);
  return g;
}
const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);
const sph = (r) => new THREE.SphereGeometry(r, 14, 10);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function headGeo(rx, ry, rz, cy, cell, skinCol) {
  const g = new THREE.SphereGeometry(1, 20, 16).toNonIndexed();
  const pos = g.attributes.position, n = pos.count;
  const uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  const sc = C(skinCol), wc = C('#ffffff');
  const cx = cell % N, cyy = Math.floor(cell / N);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (z > 0.05) {
      const u = Math.min(0.98, Math.max(0.02, 0.5 + x * 0.56)), v = Math.min(0.98, Math.max(0.02, 0.5 + y * 0.56));
      uv[i * 2] = (cx + u) / N; uv[i * 2 + 1] = 1 - (cyy + 1 - v) / N;
      col[i * 3] = wc.r; col[i * 3 + 1] = wc.g; col[i * 3 + 2] = wc.b;
    } else {
      uv[i * 2] = 0.1 / N; uv[i * 2 + 1] = 1 - 0.1 / N;
      col[i * 3] = sc.r; col[i * 3 + 1] = sc.g; col[i * 3 + 2] = sc.b;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.scale(rx, ry, rz); g.translate(0, cy, 0);
  return g;
}

export function makePedGeoms(look) {
  const w = look.w || 1;
  const skin = FACE_SKIN[look.face] || C('#e8c0a0');
  const sc = '#' + skin.getHexString();
  const TW = 0.46 * w, TD = 0.27 * Math.min(1.12, w);
  const sx = TW / 2 + 0.07;
  const parts = [];
  const add = (g, b) => parts.push({ g, b });
  const rT = 0.15;
  const sleeve = look.shirt;
  add(prim(sph(0.16), look.pants, 0, 0.93, 0, { sx: (TW / 2 + 0.02) / 0.16, sy: 0.8, sz: (TD / 2 / 0.16) * 1.05 }), BONE.hips);
  add(prim(cap(rT, 0.3), look.shirt, 0, 1.2, 0, { sx: TW / 2 / rT, sz: TD / 2 / rT }), BONE.spine);
  add(prim(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), sc, 0, 1.55, 0), BONE.spine);
  if (look.hoodie) {
    add(prim(sph(0.13), look.hoodColor || look.shirt, 0, 1.55, -0.1, { sx: (TW / 2 / 0.13) * 0.85, sy: 0.7, sz: 0.9 }), BONE.spine);
    add(prim(sph(0.11), look.hoodColor ? '#3a4a30' : '#0e0e0e', 0, 1.56, -0.08, { sx: 1.1, sy: 0.6, sz: 0.8 }), BONE.spine);
    add(prim(box(0.03, 0.44, 0.012), '#151515', 0, 1.2, (TD / 2) * 0.98 + 0.008), BONE.spine);
    if (look.shirt2) add(prim(box(TW * 0.34, 0.2, 0.012), look.shirt2, 0, 1.36, (TD / 2) * 0.95 + 0.01), BONE.spine);
    add(prim(cap(0.012, 0.14), '#111', -0.07, 1.34, (TD / 2) * 0.95 + 0.02), BONE.spine);
    add(prim(cap(0.012, 0.14), '#111', 0.07, 1.34, (TD / 2) * 0.95 + 0.02), BONE.spine);
  } else if (look.shirt2 && look.gang !== 'rus') add(prim(box(TW * 0.36, 0.14, 0.012), look.shirt2, 0, 1.4, (TD / 2) * 0.95 + 0.01), BONE.spine);
  if (look.gang === 'rus') {
    add(prim(box(0.1, 0.38, 0.012), look.shirt2, 0, 1.24, (TD / 2) * 0.98 + 0.008), BONE.spine);
    add(prim(box(TW * 0.2, 0.32, 0.014), '#7a0a20', -TW * 0.26, 1.3, (TD / 2) * 0.92 + 0.01, { rz: 0.35 }), BONE.spine);
    add(prim(box(TW * 0.2, 0.32, 0.014), '#7a0a20', TW * 0.26, 1.3, (TD / 2) * 0.92 + 0.01, { rz: -0.35 }), BONE.spine);
  }
  if (look.chain) add(prim(new THREE.TorusGeometry(0.075, 0.014, 6, 14), '#e0b020', 0, 1.5, 0.05, { rx: Math.PI / 2 - 0.5 }), BONE.spine);
  if (look.stripes) {
    add(prim(box(0.02, 0.62, 0.012), look.stripes, (TW / 2) * 0.62, 1.2, (TD / 2) * 0.95), BONE.spine);
    add(prim(box(0.02, 0.62, 0.012), look.stripes, (-TW / 2) * 0.62, 1.2, (TD / 2) * 0.95), BONE.spine);
  }
  if (look.studs) {
    add(prim(box(TW * 1.03, 0.035, TD * 1.05), '#a0a0a0', 0, 1.4, 0), BONE.spine);
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) add(prim(new THREE.ConeGeometry(0.02, 0.07, 5), '#b8b8b8', s * (sx - 0.02), 1.54, -0.03 + k * 0.05, { rz: -s * 0.3 }), BONE.spine);
  }
  if (look.vest) add(prim(cap(rT * 1.12, 0.26), '#1a1e18', 0, 1.2, 0.005, { sx: (TW / 2 / rT) * 1.06, sz: (TD / 2 / rT) * 1.2 }), BONE.spine);
  if (look.gang === 'cop' && !look.vest) {
    add(prim(box(0.03, 0.44, 0.012), '#222', 0, 1.2, (TD / 2) * 0.98 + 0.008), BONE.spine);
    add(prim(box(0.1, 0.04, 0.012), '#d0c040', 0.1, 1.4, (TD / 2) * 0.95 + 0.01), BONE.spine);
    add(prim(box(TW * 1.02, 0.04, TD * 1.05), '#1a1a1a', 0, 0.98, 0), BONE.spine);
  }
  // голова
  const hw = look.face === FACE.valera ? 0.14 : 0.125;
  const hcy = 1.52 + 0.14;
  add(headGeo(hw, 0.148, hw * 1.03, hcy, look.face, sc), BONE.head);
  add(prim(sph(0.02), sc, -hw * 0.98, hcy - 0.01, 0, { sy: 1.4, sz: 0.6 }), BONE.head);
  add(prim(sph(0.02), sc, hw * 0.98, hcy - 0.01, 0, { sy: 1.4, sz: 0.6 }), BONE.head);
  const hs = look.hairStyle, hc = look.hair;
  const hairCap = (r, tl, dz = -0.01, colr = hc, sy = 1.1) => prim(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, tl), colr, 0, hcy, dz, { sx: (hw / r) * 1.05, sy: (0.148 / r) * sy, sz: (hw * 1.03 / r) * 1.06 });
  if (hs === 'valera') {
    add(hairCap(1, Math.PI * 0.58, -0.012), BONE.head);
    add(prim(box(hw * 2.02, 0.2, 0.07), hc, 0, hcy - 0.04, -hw * 0.9), BONE.head);
    add(prim(box(0.035, 0.16, 0.17), hc, hw * 0.98, hcy + 0.02, -0.02), BONE.head);
    add(prim(box(0.035, 0.16, 0.17), hc, -hw * 0.98, hcy + 0.02, -0.02), BONE.head);
  } else if (hs === 'short') add(hairCap(1, Math.PI * 0.5, -0.02), BONE.head);
  else if (hs === 'long') {
    add(hairCap(1, Math.PI * 0.55), BONE.head);
    add(prim(box(hw * 2.1, 0.36, 0.06), hc, 0, hcy - 0.1, -hw * 0.9), BONE.head);
    add(prim(box(0.03, 0.3, 0.16), hc, hw * 0.98, hcy - 0.06, -0.02), BONE.head);
    add(prim(box(0.03, 0.3, 0.16), hc, -hw * 0.98, hcy - 0.06, -0.02), BONE.head);
  } else if (hs === 'mohawk') { for (let k = 0; k < 6; k++) add(prim(new THREE.ConeGeometry(0.025, 0.15 - Math.abs(k - 2.5) * 0.015, 5), hc, 0, hcy + 0.15, -0.11 + k * 0.045), BONE.head); }
  else if (hs === 'emo') {
    add(hairCap(1, Math.PI * 0.58), BONE.head);
    add(prim(box(hw * 2.1, 0.22, 0.06), hc, 0, hcy - 0.03, -hw * 0.9), BONE.head);
    add(prim(box(hw * 1.5, 0.09, 0.05), hc, -0.03, hcy + 0.085, hw * 0.85, { rz: 0.35 }), BONE.head);
    add(prim(box(0.035, 0.18, 0.15), hc, -hw * 0.98, hcy - 0.02, 0.02), BONE.head);
    add(prim(box(0.09, 0.02, 0.02), '#d0308a', 0.03, hcy + 0.1, hw * 0.98), BONE.head);
  } else if (hs === 'hood') add(prim(new THREE.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.72), look.hoodColor || look.shirt, 0, hcy - 0.005, -0.015, { sx: hw * 1.2, sy: 0.17, sz: hw * 1.32 }), BONE.head);
  if (look.hat === 'kepka') { add(hairCap(1.05, Math.PI * 0.45, 0, look.hatColor, 1.18), BONE.head); add(prim(box(hw * 1.8, 0.015, 0.11), look.hatColor, 0, hcy + 0.075, hw * 1.05, { rx: 0.15 }), BONE.head); }
  if (look.hat === 'ushanka') { add(hairCap(1.14, Math.PI * 0.5, 0, look.hatColor, 1.25), BONE.head); add(prim(box(0.045, 0.14, 0.15), look.hatColor, hw * 1.05, hcy - 0.03, 0), BONE.head); add(prim(box(0.045, 0.14, 0.15), look.hatColor, -hw * 1.05, hcy - 0.03, 0), BONE.head); }
  if (look.hat === 'furazhka') {
    add(prim(new THREE.CylinderGeometry(hw * 1.32, hw * 1.15, 0.07, 14), look.hatColor, 0, hcy + 0.13, 0), BONE.head);
    add(prim(new THREE.CylinderGeometry(hw * 1.1, hw * 1.1, 0.06, 14), '#c02020', 0, hcy + 0.085, 0), BONE.head);
    add(prim(box(hw * 1.5, 0.012, 0.09), '#111', 0, hcy + 0.075, hw * 1.05), BONE.head);
  }
  if (look.hat === 'helmet') add(hairCap(1.15, Math.PI * 0.6, 0, look.hatColor, 1.2), BONE.head);
  // руки
  const mkArm = (s, bs, be) => {
    add(prim(sph(0.068), sleeve, s * sx, 1.46, 0), bs);
    add(prim(cap(0.055, 0.17), sleeve, s * sx, 1.3, 0), bs);
    add(prim(cap(0.047, 0.16), sleeve, s * sx, 1.0, 0), be);
    add(prim(sph(0.05), sc, s * sx, 0.83, 0.01), be);
    if (look.stripes) add(prim(box(0.012, 0.42, 0.04), look.stripes, s * (sx + 0.055), 1.26, 0), bs);
  };
  mkArm(-1, BONE.shL, BONE.elL);
  mkArm(1, BONE.shR, BONE.elR);
  // ноги
  const mkLeg = (s, bt, bk) => {
    add(prim(cap(0.085, 0.27), look.pants, s * 0.1, 0.68, 0), bt);
    add(prim(cap(0.064, 0.26), look.pants, s * 0.1, 0.25, 0), bk);
    add(prim(sph(0.075), look.shoes, s * 0.1, 0.055, 0.05, { sx: 1, sy: 0.7, sz: 1.9 }), bk);
    if (look.stripes) add(prim(box(0.012, 0.7, 0.05), look.stripes, s * 0.19, 0.5, 0), bt);
  };
  mkLeg(-1, BONE.thL, BONE.knL);
  mkLeg(1, BONE.thR, BONE.knR);
  const bustList = [], skinList = [];
  for (const { g, b } of parts) {
    if (b === BONE.spine || b === BONE.head) bustList.push(g.clone());
    const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = b; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    skinList.push(g);
  }
  const bust = merge(bustList);
  bust.translate(0, -0.9, 0);
  return { skin: merge(skinList), bust, tw: TW, sx };
}

// ---------- оружие в руке ----------
const wcache = {};
export function weaponMesh(id) {
  if (wcache[id]) return wcache[id].clone();
  const b = (w, h, d, x, y, z, c, o) => boxG(w, h, d, x, y, z, c, o);
  let l = [];
  switch (id) {
    case 'pm': l = [b(0.04, 0.06, 0.2, 0, 0.02, 0.1, '#2a2a2e'), b(0.035, 0.1, 0.045, 0, -0.05, 0.02, '#3a2a1a', { rx: -0.2 })]; break;
    case 'obrez': l = [b(0.06, 0.04, 0.34, 0, 0.02, 0.17, '#1a1a1a'), b(0.04, 0.09, 0.1, 0, -0.03, 0.02, '#5a3a1a', { rx: -0.3 })]; break;
    case 'mr153': l = [b(0.045, 0.045, 0.6, 0, 0.03, 0.3, '#1a1a1a'), b(0.05, 0.05, 0.22, 0, -0.01, 0.28, '#5a3a1a'), b(0.05, 0.11, 0.28, 0, 0.0, -0.14, '#6a4520')]; break;
    case 'kedr': l = [b(0.05, 0.09, 0.3, 0, 0.02, 0.14, '#1a1a1a'), b(0.03, 0.14, 0.04, 0, -0.08, 0.15, '#2a2a2a'), b(0.03, 0.03, 0.14, 0, 0.02, 0.35, '#111')]; break;
    case 'akm': l = [b(0.045, 0.06, 0.3, 0, 0.03, 0.2, '#1a1a1a'), b(0.04, 0.03, 0.4, 0, 0.04, 0.5, '#222'), b(0.05, 0.05, 0.22, 0, 0.0, 0.32, '#7a4a20'), b(0.035, 0.16, 0.06, 0, -0.08, 0.2, '#222', { rx: 0.25 }), b(0.05, 0.11, 0.26, 0, 0.0, -0.13, '#7a4a20')]; break;
    case 'bat': l = [b(0.05, 0.05, 0.85, 0, 0, 0.32, '#c08a50'), b(0.08, 0.08, 0.32, 0, 0, 0.62, '#b07a40')]; break;
    case 'knife': l = [b(0.03, 0.02, 0.2, 0, 0, 0.14, '#b8b8c0'), b(0.04, 0.04, 0.09, 0, 0, 0.02, '#222')]; break;
    case 'grenade': l = [b(0.08, 0.11, 0.08, 0, 0, 0.04, '#3a4a2a')]; break;
    case 'molotov': l = [b(0.07, 0.2, 0.07, 0, 0, 0.06, '#3a6a3a'), b(0.03, 0.08, 0.03, 0, 0.14, 0.06, '#e0e0d0')]; break;
    default: return null;
  }
  const m = new THREE.Mesh(merge(l), pedMaterial());
  wcache[id] = m;
  return m.clone();
}

// ---------- скелет персонажа (кости, колени и локти) ----------
function makeBones(sx) {
  const mk = (x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); return b; };
  const hips = mk(0, 0.9, 0), spine = mk(0, 0, 0), head = mk(0, 0.62, 0);
  const shL = mk(-sx, 0.56, 0), elL = mk(0, -0.3, 0), shR = mk(sx, 0.56, 0), elR = mk(0, -0.3, 0);
  const thL = mk(-0.1, 0, 0), knL = mk(0, -0.44, 0), thR = mk(0.1, 0, 0), knR = mk(0, -0.44, 0);
  hips.add(spine, thL, thR); spine.add(head, shL, shR); shL.add(elL); shR.add(elR); thL.add(knL); thR.add(knR);
  return [hips, spine, head, shL, elL, shR, elR, thL, knL, thR, knR];
}
export class Rig {
  constructor(look, opts = {}) {
    this.look = look;
    const geo = opts.geoms || makePedGeoms(look);
    this.root = new THREE.Group();
    this.bones = makeBones(geo.sx);
    this.body = new THREE.SkinnedMesh(geo.skin, pedMaterial());
    this.body.add(this.bones[0]);
    this.body.updateMatrixWorld(true);
    this.body.bind(new THREE.Skeleton(this.bones));
    this.body.frustumCulled = false;
    this.root.add(this.body);
    const b = this.bones;
    this.hips = b[0]; this.upper = b[1]; this.headB = b[2]; this.armL = b[3]; this.elL = b[4]; this.armR = b[5]; this.elR = b[6];
    this.legL = b[7]; this.knL = b[8]; this.legR = b[9]; this.knR = b[10];
    this.hand = new THREE.Group(); this.hand.position.set(0, -0.3, 0.02); this.hand.rotation.x = Math.PI / 2; this.elR.add(this.hand);
    this.weaponId = null; this.weapon = null;
    this.phase = Math.random() * 6; this.swing = 0;
    this.st = { speed: 0, crouch: 0, aim: 0, punch: 0, dead: 0, sit: 0, bike: 0, twohand: false, melee: false, hunch: look.hunch || 0, squat: 0 };
    this.root.scale.setScalar(look.scale || 1);
    this.setShadow(!!opts.shadow);
  }
  setShadow(v) { this.body.castShadow = v; }
  setWeapon(id) {
    if (this.weaponId === id) return;
    if (this.weapon) { this.hand.remove(this.weapon); this.weapon = null; }
    this.weaponId = id;
    const m = id && id !== 'fist' ? weaponMesh(id) : null;
    if (m) { this.hand.add(m); this.weapon = m; }
  }
  update(dt, st) {
    const s = this.st; Object.assign(s, st);
    const sp = s.speed;
    this.phase += dt * (2 + sp * 1.5) * (s.bike ? 0.5 : 1);
    const amp = clamp(sp / 3.5, 0, 1) * (sp > 5 ? 1.15 : 0.8);
    const ph = this.phase * 2.2;
    const sw = Math.sin(ph) * amp;
    const kb = 0.35 + amp * 0.9;
    let thL = sw, thR = -sw;
    let knL = amp * kb * Math.max(0, -Math.cos(ph)) + 0.05, knR = amp * kb * Math.max(0, Math.cos(ph)) + 0.05;
    const crouch = s.crouch, sit = s.sit, squat = s.squat;
    let drop = crouch * 0.36;
    if (crouch > 0) { thL = lerp(thL, -1.0, crouch); thR = lerp(thR, -1.0, crouch); knL = lerp(knL, 1.7, crouch); knR = lerp(knR, 1.7, crouch); }
    if (sit > 0) { thL = lerp(thL, -1.5, sit); thR = lerp(thR, -1.5, sit); knL = lerp(knL, 1.5, sit); knR = lerp(knR, 1.5, sit); drop = Math.max(drop, sit * 0.36); }
    if (squat > 0) { thL = lerp(thL, -1.9, squat); thR = lerp(thR, -1.9, squat); knL = lerp(knL, 2.4, squat); knR = lerp(knR, 2.4, squat); drop = Math.max(drop, squat * 0.5); }
    if (s.bike) { const p = Math.sin(this.phase * 3) * 0.6; thL = -1.0 + p; thR = -1.0 - p; knL = 1.2 - p; knR = 1.2 + p; drop = 0.08; }
    this.legL.rotation.x = thL; this.legR.rotation.x = thR; this.knL.rotation.x = knL; this.knR.rotation.x = knR;
    this.hips.position.y = 0.9 - drop;
    // корпус
    const lean = clamp(sp * 0.03, 0, 0.22) + crouch * 0.2 + (s.bike ? 0.4 : 0) + s.hunch * 0.22 + squat * 0.25;
    this.upper.rotation.x = lean;
    this.upper.rotation.y = -sw * 0.18 * (s.aim > 0.3 ? 0 : 1);
    // руки
    let al = -sw * 0.9, ar = sw * 0.9;
    let ell = -0.25 - amp * 0.45, elr = -0.25 - amp * 0.45;
    if (s.bike || sit > 0) { const k = Math.max(s.bike ? 1 : 0, sit); al = lerp(al, -1.0, k); ar = lerp(ar, -1.0, k); ell = lerp(ell, -0.35, k); elr = lerp(elr, -0.35, k); }
    let arZ = 0, alY = 0;
    if (s.aim > 0) {
      ar = lerp(ar, -1.5, s.aim); elr = lerp(elr, -0.05, s.aim);
      if (s.twohand) { al = lerp(al, -1.3, s.aim); alY = lerp(0, 0.55, s.aim); ell = lerp(ell, -0.55, s.aim); }
      this.upper.rotation.y = lerp(this.upper.rotation.y, -0.3, s.aim);
    }
    if (s.punch > 0) {
      const p = Math.sin(clamp(s.punch, 0, 1) * Math.PI);
      if (s.melee) { ar = lerp(ar, -2.3 + s.punch * 2.6, Math.min(1, p * 1.4)); arZ = p * 0.5; this.upper.rotation.y += p * 0.6; elr = -0.3; }
      else { ar = lerp(ar, -1.5, p); elr = lerp(elr, -0.1, p); this.upper.rotation.y += p * 0.5; al = lerp(al, -0.6, p); ell = lerp(ell, -1.6, p); }
    }
    if (s.dead > 0) { ar = lerp(ar, -1.2, s.dead); al = lerp(al, 0.6, s.dead); }
    this.armL.rotation.set(al, alY, 0); this.armR.rotation.set(ar, 0, arZ);
    this.elL.rotation.x = ell; this.elR.rotation.x = elr;
    const d = s.dead;
    this.root.rotation.x = -d * 1.52;
    this.root.position.y = d * 0.14;
  }
}

// ---------- транспорт ----------
function shapeFromPts(pts) { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; }
function extrudeProfile(pts, width, color, len) {
  const dep = Math.max(0.1, width - 0.1);
  const g = new THREE.ExtrudeGeometry(shapeFromPts(pts), { depth: dep, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelOffset: -0.02, bevelSegments: 2, steps: 1, curveSegments: 1 });
  g.translate(0, 0, -dep / 2);
  g.rotateY(-Math.PI / 2); // длина по +Z
  g.translate(0, 0, -len / 2);
  return colorize(g.toNonIndexed(), color);
}
function colorize(g, color) {
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const c = C(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.index) g = g.toNonIndexed();
  return g;
}
function vbox(w, h, d, x, y, z, color) { return colorize(new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(), color); }
function cylX(r, len, x, y, z, color, seg = 14) { return colorize(new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, y, z).toNonIndexed(), color); }

let vMat = null;
function vehMat() { return vMat || (G.vehMat = vMat = new THREE.MeshStandardMaterial({ map: G.tex.carPaint, vertexColors: true, roughness: 0.38, metalness: 0.45, envMap: G.envMap || null, envMapIntensity: 0.9 })); }

function lightMats() {
  return {
    headOff: new THREE.MeshBasicMaterial({ color: 0xe8e0c0 }),
    tailOff: new THREE.MeshBasicMaterial({ color: 0x6a1010 }),
  };
}

// возвращает { group, parts }
export function buildVehicle(id, spec, colorHex) {
  if (spec.kind === 'bike') return buildBike(spec, colorHex);
  const L = spec.len, W = spec.wid, wr = spec.wr;
  const y0 = wr * 0.6;
  const XP = (pts, w, c) => extrudeProfile(pts, w, c, L);
  const body = [];
  const glassC = '#1b2733';
  const dark = '#1a1a1a';
  const H = spec.top;
  let lightsY = 0.7;
  if (spec.kind === 'bus') {
    body.push(vbox(W, 1.15, L, 0, y0 + 0.5, 0, colorHex));
    body.push(vbox(W * 0.98, 1.35, L * 0.985, 0, 1.15 + 0.68 + y0 * 0.1 + 0.05, 0, glassC));
    body.push(vbox(W, 0.14, L, 0, 2.85, 0, colorHex));
    // стойки окон
    for (let z = -L / 2 + 0.8; z < L / 2 - 0.5; z += 1.6) body.push(vbox(W * 1.01, 1.4, 0.1, 0, 1.95, z, colorHex));
    body.push(vbox(W * 1.005, 0.32, L * 1.001, 0, 0.95, 0, '#2a5aa8'));
    body.push(vbox(W * 0.8, 0.02, 0.15, 0, 2.94, 0.3, '#333'));
    body.push(vbox(W * 0.9, 0.5, 0.06, 0, 2.5, L / 2 + 0.01, '#101820')); // лобовое (тёмная панель)
    body.push(vbox(W * 0.6, 0.18, 0.06, 0, 3.0, L / 2 - 0.05, '#101010')); // табло маршрута
    lightsY = 0.7;
  } else if (spec.kind === 'van') {
    const top = H;
    body.push(XP([[0, y0], [0, top], [L * 0.7, top], [L * 0.88, top - 0.6], [L, top - 0.8], [L, y0 + 0.15], [L * 0.96, y0]], W, colorHex));
    // окна кабины
    body.push(vbox(W * 1.01, 0.55, L * 0.2, 0, top - 0.75, L * 0.5 - L * 0.05, glassC));
    if (!spec.ambulance) body.push(vbox(W * 1.01, 0.5, L * 0.45, 0, top - 0.7, -L * 0.2, glassC));
    body.push(vbox(W * 0.9, 0.5, 0.06, 0, top - 0.7, L * 0.7 + 0.28, glassC)); // лобовое (наклон грубо)
    if (spec.ambulance) { body.push(vbox(W * 1.005, 0.2, L * 0.99, 0, 1.0, 0, '#d02020')); body.push(vbox(W * 1.01, 0.4, 0.15, 0, 1.4, -0.3, '#d02020')); body.push(vbox(W * 1.01, 0.15, 0.4, 0, 1.4, -0.3, '#d02020')); }
    lightsY = 0.8;
  } else {
    const bodyTop = H - spec.cabH;
    body.push(XP([[0.02 * L, y0], [0, y0 + 0.18], [0, bodyTop - 0.05], [0.08 * L, bodyTop], [spec.c1 * L + 0.12 * L, bodyTop], [L * 0.96, bodyTop - spec.hood * 0.0 - 0.1], [L, bodyTop - 0.2], [L, y0 + 0.12], [0.97 * L, y0]], W, colorHex));
    // кабина: стекло + крыша
    const g0 = spec.c0 * L, g1 = spec.c1 * L, t0 = spec.t0 * L, t1 = spec.t1 * L;
    body.push(XP([[g0, bodyTop - 0.02], [t0, H - 0.08], [t1, H - 0.08], [g1, bodyTop - 0.02]], W * 0.92, glassC));
    body.push(XP([[t0 - 0.03, H - 0.09], [t0 + 0.02, H], [t1 - 0.02, H], [t1 + 0.03, H - 0.09]], W * 0.94, colorHex));
    // стойки
    body.push(vbox(W * 0.94, 0.04, 0.06, 0, H - 0.05, (t0 + t1) / 2 - L / 2 * 0 - L / 2 + 0.0, colorHex));
    lightsY = bodyTop - 0.18;
  }
  // бамперы, решётка, зеркала
  body.push(vbox(W * 1.02, 0.16, 0.12, 0, y0 + 0.14, L / 2, dark), vbox(W * 1.02, 0.16, 0.12, 0, y0 + 0.14, -L / 2, dark));
  if (spec.kind !== 'bus') body.push(vbox(0.16, 0.06, 0.08, -W / 2 - 0.05, lightsY + 0.35, L * 0.2, dark), vbox(0.16, 0.06, 0.08, W / 2 + 0.05, lightsY + 0.35, L * 0.2, dark));
  // особые раскраски
  if (spec.police) {
    body.push(vbox(W * 1.005, 0.28, L * 0.6, 0, 0.9, -0.1, '#1e56c0'));
    if (id !== 'militsia2') body.push(vbox(W * 1.007, 0.16, L * 0.6, 0, 0.75, -0.1, '#1e56c0'));
  }
  if (spec.taxi) {
    for (let i = 0; i < 14; i++) body.push(vbox(W * 1.006, 0.09, L * 0.6 / 14, 0, 0.98, -L * 0.3 + i * L * 0.6 / 14 + 0.15, i % 2 ? '#111' : '#f4f4f4'));
  }
  // номер
  const parts = {};
  const group = new THREE.Group();
  const bodyMesh = new THREE.Mesh(merge(body), vehMat());
  bodyMesh.castShadow = true;
  group.add(bodyMesh);
  // фары/стоп-сигналы
  const lm = lightMats();
  const heads = merge([vbox(0.28, 0.14, 0.05, -W * 0.32, lightsY, L / 2 + 0.03, '#ffffff'), vbox(0.28, 0.14, 0.05, W * 0.32, lightsY, L / 2 + 0.03, '#ffffff')]);
  const tails = merge([vbox(0.26, 0.13, 0.05, -W * 0.34, lightsY, -L / 2 - 0.03, '#ffffff'), vbox(0.26, 0.13, 0.05, W * 0.34, lightsY, -L / 2 - 0.03, '#ffffff')]);
  parts.head = new THREE.Mesh(heads, lm.headOff); parts.tail = new THREE.Mesh(tails, lm.tailOff);
  group.add(parts.head, parts.tail);
  // колёса
  const zF = spec.kind === 'bus' ? L * 0.3 : L * 0.31, zR = spec.kind === 'bus' ? -L * 0.28 : -L * 0.3;
  const wheelPair = (z) => merge([
    cylX(wr, 0.24, -(W / 2 - 0.12), wr, 0, '#151515'), cylX(wr, 0.24, W / 2 - 0.12, wr, 0, '#151515'),
    cylX(wr * 0.55, 0.26, -(W / 2 - 0.12), wr, 0, '#9a9a9a', 8), cylX(wr * 0.55, 0.26, W / 2 - 0.12, wr, 0, '#9a9a9a', 8),
  ]);
  const mkAxle = (z) => { const gr = new THREE.Group(); gr.position.set(0, 0, z); const m = new THREE.Mesh(wheelPair(z), vehMat()); m.position.y = wr; m.geometry.translate(0, -wr, 0); gr.add(m); gr.userData.spin = m; m.position.y = wr; m.geometry.translate(0, wr - 0, 0); return gr; };
  // проще: ось вращения проходит через центр колеса (y = wr)
  const mkAxle2 = (z) => {
    const g = wheelPair(z); g.translate(0, -wr, 0);
    const m = new THREE.Mesh(g, vehMat()); m.position.y = wr; m.castShadow = false;
    const gr = new THREE.Group(); gr.position.set(0, 0, z); gr.add(m); gr.userData.spin = m; return gr;
  };
  void mkAxle;
  parts.fAxle = mkAxle2(zF); parts.rAxle = mkAxle2(zR);
  group.add(parts.fAxle, parts.rAxle);
  // мигалки
  if (spec.police || spec.ambulance) {
    const y = spec.top + 0.06;
    parts.siren = [new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.25), new THREE.MeshBasicMaterial({ color: 0x2244ff })), new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.25), new THREE.MeshBasicMaterial({ color: 0xff2222 }))];
    parts.siren[0].position.set(-0.22, y, spec.kind === 'van' ? 0.4 : -0.1); parts.siren[1].position.set(0.22, y, spec.kind === 'van' ? 0.4 : -0.1);
    group.add(parts.siren[0], parts.siren[1]);
    if (spec.police) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.3), new THREE.MeshLambertMaterial({ color: 0x222222 })); bar.position.set(0, y - 0.08, spec.kind === 'van' ? 0.4 : -0.1); group.add(bar); }
  }
  if (spec.taxi) { const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.2), new THREE.MeshBasicMaterial({ color: 0xffee88 })); sign.position.set(0, spec.top + 0.09, -0.1); group.add(sign); }
  // конус фар (ночью)
  const beamG = new THREE.PlaneGeometry(4.2, 13).rotateX(-Math.PI / 2).translate(0, 0.08, L / 2 + 6);
  parts.beam = new THREE.Mesh(beamG, beamMat());
  parts.beam.visible = false; parts.beam.renderOrder = 5;
  group.add(parts.beam);
  group.userData.parts = parts;
  return { group, parts, bodyMesh };
}

let _beamMat = null;
function beamMat() {
  if (_beamMat) return _beamMat;
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,240,190,.55)'); g.addColorStop(1, 'rgba(255,240,190,0)');
  x.fillStyle = g; x.beginPath(); x.moveTo(24, 128); x.lineTo(40, 128); x.lineTo(64, 0); x.lineTo(0, 0); x.fill();
  const t = new THREE.CanvasTexture(c);
  _beamMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  return _beamMat;
}

function cylBetween(a, b, r, color) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Matrix4().lookAt(A, B, new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  g.applyQuaternion(q);
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return colorize(g.toNonIndexed(), color);
}

function buildBike(spec, colorHex) {
  const group = new THREE.Group(); const parts = {};
  const r = spec.wr;
  const fr = [
    cylBetween([0, r, -0.6], [0, 0.55, -0.55], 0.02, colorHex), cylBetween([0, 0.55, -0.55], [0, 0.86, -0.42], 0.02, colorHex),
    cylBetween([0, 0.5, -0.05], [0, 0.86, -0.42], 0.02, colorHex), cylBetween([0, r, -0.6], [0, 0.32, -0.05], 0.02, colorHex),
    cylBetween([0, 0.5, -0.05], [0, r + 0.05, 0.55], 0.022, colorHex), cylBetween([0, 0.32, -0.05], [0, 0.5, -0.05], 0.02, colorHex),
    cylBetween([0, r, 0.6], [0, 1.0, 0.5], 0.02, '#333'), cylBetween([-0.28, 1.02, 0.5], [0.28, 1.02, 0.5], 0.015, '#222'),
    vbox(0.1, 0.05, 0.24, 0, 0.92, -0.45, '#222'),
    cylBetween([-0.12, 0.32, -0.05], [0.12, 0.32, -0.05], 0.015, '#666'),
  ];
  const fm = new THREE.Mesh(merge(fr), vehMat()); fm.castShadow = true; group.add(fm);
  const wheelG = () => merge([colorize(new THREE.TorusGeometry(r, 0.03, 6, 16).rotateY(Math.PI / 2).toNonIndexed(), '#161616'), cylBetween([0, 0, -r], [0, 0, r], 0.008, '#aaa'), cylBetween([0, -r, 0], [0, r, 0], 0.008, '#aaa')]);
  const mkW = (z) => { const m = new THREE.Mesh(wheelG(), vehMat()); m.position.y = r; const g = new THREE.Group(); g.position.z = z; g.add(m); g.userData.spin = m; return g; };
  parts.fAxle = mkW(0.6); parts.rAxle = mkW(-0.6);
  group.add(parts.fAxle, parts.rAxle);
  parts.bike = true;
  return { group, parts, bodyMesh: fm };
}
