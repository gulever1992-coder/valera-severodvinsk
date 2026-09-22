// Процедурные текстуры — никаких внешних файлов, всё рисуется на canvas.
// Позже любую из них можно заменить картинкой (см. ASSET_PROMPTS.md).
import * as THREE from 'three';

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { repeat = true, srgb = true, aniso = 4, nearest = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (nearest) { t.magFilter = THREE.NearestFilter; }
  return t;
}
function noise(ctx, w, h, amt, alpha = 1) {
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(id, 0, 0);
}

function asphalt(kind) {
  const [c, x] = cv(256, 256);
  x.fillStyle = '#4b4d51'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '20,20,22' : '110,110,116'},${Math.random() * 0.25})`; x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  noise(x, 256, 256, 14);
  // трещины
  x.strokeStyle = 'rgba(15,15,18,.45)'; x.lineWidth = 1;
  for (let i = 0; i < 5; i++) { x.beginPath(); let px = Math.random() * 256, py = Math.random() * 256; x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (Math.random() - 0.5) * 40; py += (Math.random() - 0.5) * 40; x.lineTo(px, py); } x.stroke(); }
  // колея
  x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(56, 0, 28, 256); x.fillRect(172, 0, 28, 256);
  x.fillStyle = 'rgba(235,235,225,.85)';
  x.fillRect(8, 0, 4, 256); x.fillRect(244, 0, 4, 256); // кромка
  if (kind === 'street') { for (let y = 0; y < 256; y += 128) x.fillRect(126, y, 4, 64); }
  if (kind === 'major') {
    x.fillStyle = 'rgba(240,200,40,.9)'; x.fillRect(122, 0, 3, 256); x.fillRect(131, 0, 3, 256);
    x.fillStyle = 'rgba(235,235,225,.85)';
    for (let y = 0; y < 256; y += 128) { x.fillRect(62, y, 3, 64); x.fillRect(190, y, 3, 64); }
  }
  return tex(c, { aniso: 8 });
}
function sidewalk() {
  const [c, x] = cv(128, 128);
  x.fillStyle = '#9a9a96'; x.fillRect(0, 0, 128, 128);
  noise(x, 128, 128, 22);
  x.strokeStyle = 'rgba(50,50,50,.6)'; x.lineWidth = 2;
  x.strokeRect(0, 0, 64, 64); x.strokeRect(64, 64, 64, 64); x.strokeRect(0, 64, 64, 64); x.strokeRect(64, 0, 64, 64);
  return tex(c);
}
function grass() {
  const [c, x] = cv(256, 256);
  x.fillStyle = '#5f7d3d'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    const g = 90 + Math.random() * 70;
    x.fillStyle = `rgba(${g * 0.6 | 0},${g},${g * 0.35 | 0},.5)`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2 + Math.random() * 4);
  }
  for (let i = 0; i < 12; i++) { x.fillStyle = 'rgba(150,130,70,.12)'; x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 25, 0, 6.3); x.fill(); }
  noise(x, 256, 256, 18);
  return tex(c);
}
function dirt() {
  const [c, x] = cv(128, 128);
  x.fillStyle = '#7a6a4f'; x.fillRect(0, 0, 128, 128); noise(x, 128, 128, 34);
  return tex(c);
}
function water() {
  const [c, x] = cv(256, 256);
  x.fillStyle = '#23455c'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) { x.strokeStyle = `rgba(160,200,220,${Math.random() * 0.12})`; x.lineWidth = 1 + Math.random() * 2; const px = Math.random() * 256, py = Math.random() * 256; x.beginPath(); x.moveTo(px, py); x.lineTo(px + 10 + Math.random() * 30, py + (Math.random() - 0.5) * 4); x.stroke(); }
  return tex(c);
}
// плитка фасада: один пролёт × один этаж (панельный дом) + маска окон
function facade() {
  const S = 256;
  const [c, x] = cv(S, S);
  const [m, mx] = cv(S, S);
  x.fillStyle = '#efefec'; x.fillRect(0, 0, S, S);
  noise(x, S, S, 10);
  for (let i = 0; i < 26; i++) { x.fillStyle = `rgba(60,55,50,${Math.random() * 0.06})`; x.fillRect(Math.random() * S, 0, 2 + Math.random() * 5, S); }
  // швы панелей
  x.fillStyle = 'rgba(70,68,64,.55)'; x.fillRect(0, S - 4, S, 4); x.fillRect(0, 0, 3, S);
  x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(0, S - 6, S, 2);
  // окно
  const wx = 60, wy = 64, ww = 136, wh = 128;
  x.fillStyle = '#dcdcd6'; x.fillRect(wx - 8, wy - 8, ww + 16, wh + 16);      // откос
  x.fillStyle = '#f6f6f2'; x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);        // рама ПВХ
  x.fillStyle = '#1c2530'; x.fillRect(wx + 4, wy + 4, ww - 8, wh - 8);        // стекло
  x.fillStyle = '#f6f6f2'; x.fillRect(wx + ww / 2 - 3, wy, 6, wh); x.fillRect(wx, wy + wh * 0.4, ww, 5); // импосты
  x.fillStyle = '#8a8a86'; x.fillRect(wx - 12, wy + wh + 8, ww + 24, 6);     // подоконник
  x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(wx - 12, wy + wh + 14, ww + 24, 10);
  mx.fillStyle = '#000'; mx.fillRect(0, 0, S, S);
  mx.fillStyle = '#fff';
  mx.fillRect(wx + 4, wy + 4, ww / 2 - 7, wh * 0.4 - 4);
  mx.fillRect(wx + ww / 2 + 3, wy + 4, ww / 2 - 7, wh * 0.4 - 4);
  mx.fillRect(wx + 4, wy + wh * 0.4 + 5, ww / 2 - 7, wh * 0.6 - 9);
  mx.fillRect(wx + ww / 2 + 3, wy + wh * 0.4 + 5, ww / 2 - 7, wh * 0.6 - 9);
  return { color: tex(c, { aniso: 8 }), mask: tex(m, { srgb: false, aniso: 8 }) };
}
function glow() {
  const [c, x] = cv(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return tex(c, { repeat: false });
}
function cloud() {
  const [c, x] = cv(128, 64);
  for (let i = 0; i < 14; i++) {
    const px = 24 + Math.random() * 80, py = 22 + Math.random() * 20, r = 10 + Math.random() * 16;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 64);
  }
  return tex(c, { repeat: false });
}
function smoke() {
  const [c, x] = cv(64, 64);
  for (let i = 0; i < 6; i++) {
    const px = 20 + Math.random() * 24, py = 20 + Math.random() * 24, r = 10 + Math.random() * 12;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  }
  return tex(c, { repeat: false });
}

// ---------- лица персонажей ----------
export const FACE_CELLS = 4; // 4×4
export const FACE = {
  plain: 0, valera: 1, m1: 2, m2: 3, m3: 4, m4: 5, stern: 6, punk: 7, emo: 8, gop: 9, salt: 10, rus: 11, w1: 12, w2: 13, old: 14, cop: 15,
};
export const FACE_SKIN = [];
function faceAtlas() {
  const S = 128, N = FACE_CELLS;
  const [c, x] = cv(S * N, S * N);
  const faces = [
    { skin: '#f1f1f1' },
    { skin: '#f3d2bd', brow: '#a85a2a', iris: '#7d98a8', freck: 1, goatee: '#b5552a', mouth: '#c98a80', eyeW: 1, lids: 1, round: 1 },
    { skin: '#f0c8a6', brow: '#5a4030', iris: '#5a7a9a' },
    { skin: '#e2b088', brow: '#3a2a20', iris: '#4a6a4a' },
    { skin: '#c99468', brow: '#2a1a12', iris: '#3a2a20' },
    { skin: '#f4d6c0', brow: '#7a5a3a', iris: '#8a9a6a', stubble: 1 },
    { skin: '#e8b898', brow: '#2a1a12', iris: '#2a2a3a', stern: 1, stubble: 1 },
    { skin: '#f4e0d8', brow: '#111', iris: '#222', liner: 1, ring: 1 },
    { skin: '#f6ece6', brow: '#111', iris: '#222', liner: 1, fringe: 1 },
    { skin: '#efc4a0', brow: '#4a3222', iris: '#6a7a8a', stern: 1 },
    { skin: '#d8dcc0', brow: '#4a5a3a', iris: '#111', wide: 1, circles: 1, sore: 1 },
    { skin: '#e6b48e', brow: '#1a1210', iris: '#2a2a2a', stern: 1, heavy: 1 },
    { skin: '#f4d2c0', brow: '#5a3a2a', iris: '#4a7aaa', lips: '#c0505a', lash: 1 },
    { skin: '#e8c0a0', brow: '#2a1a12', iris: '#3a3a2a', lips: '#a03a4a', lash: 1 },
    { skin: '#e4c8b0', brow: '#aaa', iris: '#5a6a7a', wrinkles: 1 },
    { skin: '#ecc6a4', brow: '#3a2a1a', iris: '#4a5a6a', stern: 1 },
  ];
  faces.forEach((f, i) => {
    const ox = (i % N) * S, oy = Math.floor(i / N) * S;
    FACE_SKIN[i] = new THREE.Color(f.skin);
    x.fillStyle = f.skin; x.fillRect(ox, oy, S, S);
    if (i === 0) {
      // нейтральная «ткань»: слабый шум и мягкое затемнение к краям — даёт объём одежде и коже без лишнего цвета
      for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx += 2) {
        const n = (Math.sin(xx * 12.9898 + yy * 78.233) * 43758.5453) % 1;
        const v = 0.5 + (n - Math.floor(n) - 0.5) * 0.16;
        x.fillStyle = `rgba(255,255,255,${v > 0.5 ? (v - 0.5) * 0.5 : 0})`;
        x.fillRect(ox + xx, oy + yy, 2, 1);
        x.fillStyle = `rgba(0,0,0,${v < 0.5 ? (0.5 - v) * 0.55 : 0})`;
        x.fillRect(ox + xx, oy + yy, 2, 1);
      }
      x.strokeStyle = 'rgba(0,0,0,.10)'; x.lineWidth = 1;
      for (let d = -S; d < S; d += 5) { x.beginPath(); x.moveTo(ox + d, oy); x.lineTo(ox + d + S, oy + S); x.stroke(); }
      const g = x.createRadialGradient(ox + S / 2, oy + S / 2, S * 0.15, ox + S / 2, oy + S / 2, S * 0.72);
      g.addColorStop(0, 'rgba(255,255,255,.10)'); g.addColorStop(1, 'rgba(0,0,0,.22)');
      x.fillStyle = g; x.fillRect(ox, oy, S, S);
      return;
    }
    const ex = [42, 86], ey = 60;
    // тени/румянец
    x.fillStyle = 'rgba(190,110,90,.14)'; x.beginPath(); x.arc(ox + 30, oy + 82, 14, 0, 7); x.arc(ox + 98, oy + 82, 14, 0, 7); x.fill();
    if (f.circles) { x.fillStyle = 'rgba(60,40,70,.5)'; x.beginPath(); x.ellipse(ox + ex[0], oy + ey + 8, 15, 8, 0, 0, 7); x.ellipse(ox + ex[1], oy + ey + 8, 15, 8, 0, 0, 7); x.fill(); }
    // нос
    x.fillStyle = 'rgba(150,90,70,.35)'; x.beginPath(); x.moveTo(ox + 64, oy + 62); x.lineTo(ox + 56, oy + 88); x.lineTo(ox + 72, oy + 88); x.fill();
    x.fillStyle = 'rgba(100,50,40,.5)'; x.fillRect(ox + 57, oy + 88, 4, 3); x.fillRect(ox + 68, oy + 88, 4, 3);
    // глаза
    for (let k = 0; k < 2; k++) {
      const cx = ox + ex[k], cy = oy + ey;
      x.fillStyle = '#f2f2ee'; x.beginPath(); x.ellipse(cx, cy, f.wide ? 13 : 11, f.wide ? 10 : 7, 0, 0, 7); x.fill();
      x.fillStyle = f.iris; x.beginPath(); x.arc(cx, cy, f.wide ? 6 : 5, 0, 7); x.fill();
      x.fillStyle = '#000'; x.beginPath(); x.arc(cx, cy, f.wide ? 4 : 2.5, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,255,255,.8)'; x.fillRect(cx - 2, cy - 3, 2, 2);
      if (f.lids) { x.fillStyle = f.skin; x.fillRect(cx - 12, cy - 9, 24, 8); x.fillStyle = 'rgba(120,70,50,.6)'; x.fillRect(cx - 12, cy - 2, 24, 2); }
      if (f.liner) { x.strokeStyle = '#000'; x.lineWidth = 3; x.beginPath(); x.ellipse(cx, cy, 12, 8, 0, 0, 7); x.stroke(); }
      if (f.lash) { x.strokeStyle = '#111'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx - 11, cy); x.quadraticCurveTo(cx, cy - 12, cx + 11, cy); x.stroke(); }
      // брови
      x.strokeStyle = f.brow; x.lineWidth = f.heavy ? 6 : f.wrinkles ? 3 : 4;
      x.beginPath();
      const by = cy - (f.stern ? 15 : 17);
      if (f.stern) { x.moveTo(cx - (k ? -11 : 11), by - 3 * (k ? 1 : 1)); x.lineTo(cx + (k ? 11 : -11), by + 4); }
      else { x.moveTo(cx - 12, by + 1); x.quadraticCurveTo(cx, by - 3, cx + 12, by + 1); }
      x.stroke();
    }
    if (f.fringe) { x.fillStyle = '#0c0c10'; x.beginPath(); x.moveTo(ox, oy); x.lineTo(ox + S, oy); x.lineTo(ox + S, oy + 44); x.lineTo(ox + 70, oy + 40); x.lineTo(ox + 30, oy + 78); x.lineTo(ox, oy + 60); x.fill(); }
    // веснушки
    if (f.freck) { for (let k = 0; k < 90; k++) { const px = ox + 18 + Math.random() * 92, py = oy + 55 + Math.random() * 40; if (Math.hypot(px - ox - 64, py - oy - 78) < 18 && Math.random() < 0.5) continue; x.fillStyle = `rgba(178,104,54,${0.35 + Math.random() * 0.4})`; x.fillRect(px, py, 2, 2); } }
    if (f.sore) { x.fillStyle = 'rgba(150,50,50,.6)'; x.fillRect(ox + 24, oy + 90, 4, 4); x.fillRect(ox + 96, oy + 74, 5, 5); x.fillRect(ox + 60, oy + 46, 3, 3); }
    if (f.wrinkles) { x.strokeStyle = 'rgba(90,60,50,.4)'; x.lineWidth = 1; for (let k = 0; k < 4; k++) { x.beginPath(); x.moveTo(ox + 30, oy + 30 + k * 4); x.lineTo(ox + 98, oy + 30 + k * 4); x.stroke(); } }
    // рот
    const my = oy + 104;
    if (f.goatee) {
      // рыжая бородка-эспаньолка и щетина по линии челюсти (как на фото)
      x.fillStyle = f.goatee;
      x.beginPath(); x.moveTo(ox + 44, oy + 112); x.quadraticCurveTo(ox + 64, oy + 118, ox + 84, oy + 112); x.lineTo(ox + 80, oy + 128); x.lineTo(ox + 48, oy + 128); x.fill();
      x.strokeStyle = f.goatee; x.lineWidth = 6; x.beginPath(); x.moveTo(ox + 14, oy + 84); x.quadraticCurveTo(ox + 20, oy + 122, ox + 46, oy + 127); x.moveTo(ox + 114, oy + 84); x.quadraticCurveTo(ox + 108, oy + 122, ox + 82, oy + 127); x.stroke();
      x.fillStyle = 'rgba(181,85,42,.55)'; x.fillRect(ox + 52, oy + 94, 24, 3);
    }
    if (f.stubble) { x.fillStyle = 'rgba(60,45,35,.28)'; x.beginPath(); x.moveTo(ox + 20, oy + 88); x.quadraticCurveTo(ox + 64, oy + 134, ox + 108, oy + 88); x.lineTo(ox + 108, oy + 128); x.lineTo(ox + 20, oy + 128); x.fill(); }
    x.strokeStyle = f.lips || f.mouth || '#a05a52'; x.lineWidth = f.lips ? 6 : 5;
    x.beginPath();
    if (f.stern || f.heavy) { x.moveTo(ox + 46, my); x.lineTo(ox + 82, my); }
    else if (f.sore) { x.moveTo(ox + 48, my); x.lineTo(ox + 62, my + 3); x.lineTo(ox + 80, my - 2); }
    else { x.moveTo(ox + 46, my); x.quadraticCurveTo(ox + 64, my + 5, ox + 82, my); }
    x.stroke();
    if (f.ring) { x.strokeStyle = '#ddd'; x.lineWidth = 2; x.beginPath(); x.arc(ox + 84, my + 4, 4, 0, 7); x.stroke(); }
  });
  const t = tex(c, { repeat: false, aniso: 4 });
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function makeSign(text, bg = '#c22', fg = '#fff', w = 512, h = 128) {
  const [c, x] = cv(w, h);
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, h - 10, w, 10);
  x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 6; x.strokeRect(6, 6, w - 12, h - 12);
  x.fillStyle = fg; x.font = `bold ${text.length > 12 ? 52 : 70}px Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 4, w - 40);
  return tex(c, { repeat: false });
}

export function makePlate() {
  const [c, x] = cv(128, 32);
  x.fillStyle = '#f4f4f0'; x.fillRect(0, 0, 128, 32);
  x.fillStyle = '#111'; x.font = 'bold 22px monospace'; x.textAlign = 'left';
  const L = 'АВЕКМНОРСТУХ';
  const t = L[(Math.random() * L.length) | 0] + (100 + ((Math.random() * 899) | 0)) + L[(Math.random() * L.length) | 0] + L[(Math.random() * L.length) | 0] + ' 29';
  x.fillText(t, 8, 24);
  x.strokeStyle = '#111'; x.lineWidth = 2; x.strokeRect(1, 1, 126, 30);
  return tex(c, { repeat: false });
}

function carPaint() {
  const S = 256;
  const [c, x] = cv(S, S);
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, S, S);
  // вертикальное АО: тёмный низ (пороги/тень), светлая середина (борт), лёгкое затемнение крыши
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(0,0,0,.16)'); g.addColorStop(0.28, 'rgba(255,255,255,.10)'); g.addColorStop(0.55, 'rgba(255,255,255,.02)'); g.addColorStop(0.82, 'rgba(0,0,0,.05)'); g.addColorStop(1, 'rgba(0,0,0,.4)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  // диагональный блик (как отражение неба на лаке)
  const g2 = x.createLinearGradient(0, S, S, 0);
  g2.addColorStop(0.35, 'rgba(255,255,255,0)'); g2.addColorStop(0.48, 'rgba(255,255,255,.22)'); g2.addColorStop(0.58, 'rgba(255,255,255,0)');
  x.fillStyle = g2; x.fillRect(0, 0, S, S);
  noise(x, S, S, 8);
  return tex(c, { aniso: 4 });
}

let cache = null;
export function createTextures() {
  if (cache) return cache;
  const f = facade();
  cache = {
    roadLane: asphalt('lane'), roadStreet: asphalt('street'), roadMajor: asphalt('major'),
    sidewalk: sidewalk(), grass: grass(), dirt: dirt(), water: water(),
    facade: f.color, facadeMask: f.mask, glow: glow(), cloud: cloud(), smoke: smoke(), faces: faceAtlas(), carPaint: carPaint(),
  };
  return cache;
}

// Подмена процедурных текстур готовыми картинками (например, сгенерированными в ChatGPT).
// Положите PNG в assets/textures/ и пропишите в assets/textures/manifest.json — см. README и ASSET_PROMPTS.md
export async function loadOverrides(tex) {
  let m;
  try { const r = await fetch('assets/textures/manifest.json', { cache: 'no-cache' }); if (!r.ok) return; m = await r.json(); } catch (e) { return; }
  for (const [key, file] of Object.entries(m.textures || {})) {
    const t = tex[key];
    if (!t) continue;
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'assets/textures/' + file; });
      t.image = img; t.needsUpdate = true;
    } catch (e) { console.warn('Не удалось загрузить текстуру', file); }
  }
}
