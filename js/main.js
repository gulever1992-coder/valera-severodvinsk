// Точка входа: загрузка, ввод, игровой цикл, сохранения, меню
import * as THREE from 'three';
import { G } from './state.js';
import { createTextures, loadOverrides } from './assets.js';
import { buildCity, City } from './city.js';
import { createEnv } from './env.js';
import { Snd, Radio } from './audio.js';
import { FX } from './fx.js';
import { Veh } from './vehicles.js';
import { Peds } from './peds.js';
import { Combat } from './combat.js';
import { Police } from './police.js';
import { Gangs } from './gangs.js';
import { Events } from './events.js';
import { Story } from './story.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { Post } from './post.js';
import { WEAPONS } from './data.js';
import { clamp, dist2, dist } from './util.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'valera_save_v1', SET_KEY = 'valera_settings_v1';
G.THREE = THREE;
G.timeScale = 1;
G.settings = { quality: 'high', fov: 70, sens: 1, vol: 0.8, density: 1, fps: false };
G.cam = { x: 0, z: 0 }; G.camFwd = { x: 0, z: 1 };
G.input.pressedBtn = {}; G.input.lastMouseT = -99;

function showErr(msg) { const b = $('errbox'); b.classList.remove('hidden'); b.textContent += msg + '\n'; }
window.addEventListener('error', (e) => showErr('Ошибка: ' + e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => showErr('Promise: ' + (e.reason && e.reason.stack || e.reason)));

let renderer, scene, camera;
const progress = (p, txt) => { $('tloading').querySelector('i').style.width = p + '%'; if (txt) $('tloading').querySelector('span').textContent = txt; };
const tick = () => new Promise((r) => setTimeout(r, 16));

// ---------- настройки ----------
function loadSettings() { try { Object.assign(G.settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) { /* */ } }
function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(G.settings)); } catch (e) { /* */ } }
function applySettings() {
  const s = G.settings;
  G.quality = s.quality;
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(s.quality === 'low' ? Math.min(dpr, 0.85) : s.quality === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = s.quality !== 'low';
  if (G.env) {
    const size = s.quality === 'high' ? 2048 : 1024;
    const sh = G.env.sun.shadow;
    if (sh.mapSize.x !== size) { sh.mapSize.set(size, size); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    G.env.sun.castShadow = s.quality !== 'low';
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
  Snd.setVolume(s.vol);
  Veh.wantTraffic = Math.round(30 * s.density); Veh.wantParked = Math.round(26 * s.density); Peds.wantCivs = Math.round(26 * s.density);
  $('fps').style.display = s.fps ? 'block' : 'none';
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  Post.setQuality(s.quality); Post.resize(window.innerWidth, window.innerHeight);
}
function bindSettings() {
  const s = G.settings;
  $('set-quality').value = s.quality; $('set-fov').value = s.fov; $('set-sens').value = s.sens * 100; $('set-vol').value = s.vol * 100; $('set-density').value = s.density * 100; $('set-fps').checked = s.fps;
  const upd = () => { s.quality = $('set-quality').value; s.fov = +$('set-fov').value; s.sens = +$('set-sens').value / 100; s.vol = +$('set-vol').value / 100; s.density = +$('set-density').value / 100; s.fps = $('set-fps').checked; saveSettings(); applySettings(); };
  ['set-quality', 'set-fov', 'set-sens', 'set-vol', 'set-density', 'set-fps'].forEach((id) => $(id).addEventListener('input', upd));
}

// ---------- ввод ----------
function bindInput() {
  const I = G.input;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) { if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    Snd.init();
    I.keys[e.code] = true; I.pressed[e.code] = true;
    if (!G.started) return;
    if (e.code === 'Tab') { if (!UI.shopOpen && !UI.mapOpen && !G.paused) UI.openWheel(); }
    if (e.code === 'KeyM' && !G.paused && !UI.shopOpen && !G.freeze) UI.toggleMap();
    if (e.code === 'Escape') { if (UI.shopOpen) UI.closeShop(); else if (UI.mapOpen) UI.toggleMap(); else if (G.paused) resumeGame(); else if (!G.freeze) pauseGame(); }
    if ((e.code === 'KeyE') && UI.shopOpen) UI.closeShop();
    if (e.code === 'KeyE' && UI.shopOpen === false && false) return;
  });
  window.addEventListener('keyup', (e) => { I.keys[e.code] = false; if (e.code === 'Tab') UI.closeWheel(); });
  window.addEventListener('blur', () => { for (const k in I.keys) I.keys[k] = false; });
  window.addEventListener('mousemove', (e) => { I.mouseDX += e.movementX || 0; I.mouseDY += e.movementY || 0; I.lastMouseT = G.time; });
  window.addEventListener('mousedown', (e) => {
    Snd.init();
    I.buttons[e.button] = true; I.pressedBtn[e.button] = true;
    if (G.started && !G.paused && !document.pointerLockElement && !UI.shopOpen && !UI.mapOpen && e.target === $('game')) G.requestLock();
  });
  window.addEventListener('mouseup', (e) => { I.buttons[e.button] = false; });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => { if (G.started && !G.paused && !UI.shopOpen && !UI.mapOpen) I.wheel += Math.sign(e.deltaY); }, { passive: true });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && G.started && !UI.shopOpen && !UI.mapOpen && !G.paused && !G.freeze && !G.dead) pauseGame();
  });
  window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight, false); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); Post.resize(window.innerWidth, window.innerHeight); });
}
G.requestLock = () => { const c = $('game'); try { const p = c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* */ } };

function pauseGame() { G.paused = true; $('pause').classList.remove('hidden'); UI.pauseOpen = true; if (document.exitPointerLock) document.exitPointerLock(); if (Snd.ready) Snd.setVolume(0.15); }
function resumeGame() { G.paused = false; UI.pauseOpen = false; $('pause').classList.add('hidden'); $('settings').classList.add('hidden'); $('controls').classList.add('hidden'); Snd.setVolume(G.settings.vol); G.requestLock(); }

// ---------- сохранение ----------
G.saveGame = () => {
  try {
    const o = { v: 1, player: Player.serialize(), money: G.money, env: { hour: G.env.hour, day: G.env.day, weather: G.env.target }, gangs: Gangs.save(), story: Story.save(), stats: G.stats };
    localStorage.setItem(SAVE_KEY, JSON.stringify(o));
    UI.notify('Игра сохранена', 'good'); Snd.confirm();
  } catch (e) { UI.notify('Не удалось сохранить'); }
};
function readSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; } }

// ---------- запуск игры ----------
function homeSpawn() {
  const home = City.pois.find((p) => p.kind === 'home') || City.pois[0];
  const dx = home.x - home.bx, dz = home.z - home.bz, d = Math.hypot(dx, dz) || 1;
  return { x: home.x + (dx / d) * 1.5, z: home.z + (dz / d) * 1.5, yaw: Math.atan2(dx, dz) };
}
function warmup() {
  const f = { x: Player.x, z: Player.z };
  const q = G.quality === 'low' ? 0.5 : G.quality === 'medium' ? 0.75 : 1;
  for (let i = 0, n = 0; i < 200 && n < Veh.wantTraffic * q; i++) if (Veh.spawnTraffic(f, 30, 200, true)) n++;
  for (let i = 0, n = 0; i < 200 && n < Veh.wantParked * q; i++) if (Veh.spawnParked(f, 15, 160)) n++;
  for (let i = 0, n = 0; i < 60 && n < Veh.wantBikes; i++) if (Veh.spawnBike(f, 10, 120)) n++;
  for (let i = 0, n = 0; i < 200 && n < Peds.wantCivs * q; i++) if (Peds.spawnCivil(f, 20, 120)) n++;
}
function startGame(load) {
  Snd.init();
  $('title').classList.add('hide'); $('hud').classList.remove('hidden');
  G.camOverride = null; G.freeze = false;
  const sp = homeSpawn();
  Player.setPos(sp.x, sp.z, sp.yaw);
  Player.rig.root.visible = true;
  G.money = 1500; G.stats = { kills: 0, cars: 0, districts: 0, days: 0 };
  Player.health = 100; Player.armor = 0; Player.weapons = { fist: true }; Player.mag = {}; Player.ammo = { pistol: 0, shell: 0, smg: 0, rifle: 0 }; Player.thrown = { grenade: 0, molotov: 0 }; Player.cur = 'fist';
  G.env.hour = 8; G.env.day = 0; G.env.setWeather('clear', true);
  let sv = null;
  if (load) sv = readSave();
  if (sv) {
    Player.load(sv.player); G.money = sv.money; G.stats = sv.stats || G.stats;
    G.env.hour = sv.env.hour; G.env.day = sv.env.day; G.env.setWeather(sv.env.weather, true);
    Gangs.load(sv.gangs); Story.load(sv.story);
  }
  // сброс мира
  for (const v of Veh.list.slice()) Veh.remove(v);
  for (const p of Peds.list.slice()) Peds.remove(p);
  G.started = true; G.paused = false;
  warmup();
  G.requestLock();
  if (sv && Story.mi >= 0) { Story.introSeen = true; const idx = Story.mi; const oi = Story.oi; Story.start(idx); Story.oi = oi; Story.beginObjective(); }
  else if (sv && Story.done) Story.finishAll();
  else if (sv) Story.start(Math.max(0, Story.pending !== undefined ? Story.pending : 0));
  else { Story.start(0); }
  if (sv && Story.mi < 0 && !Story.done) Story.start(0);
  Gangs.init2 && Gangs.init2();
}
function toTitle() {
  G.started = false; G.paused = false; UI.pauseOpen = false;
  $('pause').classList.add('hidden'); $('hud').classList.add('hidden'); $('title').classList.remove('hide');
  if (document.exitPointerLock) document.exitPointerLock();
  $('btn-continue').classList.toggle('hidden', !readSave());
  G.freeze = true;
}

// ---------- игровой цикл ----------
let last = performance.now(), fpsAcc = 0, fpsN = 0, orbitT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  stepFrame(Math.min(0.05, (now - last) / 1000)); last = now;
}
function stepFrame(dt) {
  const rawDt = dt;
  if (!G.started) {
    // титульный экран: облёт города
    orbitT += dt * 0.05;
    G.camOverride = { px: RING_C.x + Math.cos(orbitT) * 230, py: 55, pz: RING_C.z + Math.sin(orbitT) * 190, lx: RING_C.x, ly: 6, lz: RING_C.z, fov: 55 };
    G.freeze = true; G.time += dt;
    if (G.env) { G.env.update(dt, camera, camera.position); }
    Player.updateCamera(dt);
    simulate(dt, true);
    Post.render(dt);
    G.input.pressed = {}; G.input.pressedBtn = {};
    return;
  }
  if (G.paused) { Post.render(dt); G.input.pressed = {}; G.input.pressedBtn = {}; return; }
  dt *= G.timeScale || 1;
  G.time += dt;
  UI.update(dt);
  Story.update(dt);
  Player.update(dt);
  simulate(dt, false);
  Post.render(dt);
  if (G.settings.fps) { fpsAcc += rawDt; fpsN++; if (fpsAcc > 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' FPS'; fpsAcc = 0; fpsN = 0; } }
  G.input.pressed = {}; G.input.pressedBtn = {};
}
const RING_C = { x: 0, z: 0 };

function simulate(dt, title) {
  Veh.manage(dt); Veh.update(dt);
  Peds.manage(dt); Peds.update(dt);
  Combat.update(dt);
  Police.update(dt); Gangs.update(dt);
  if (!title) Events.update(dt);
  if (G.env && !title) G.env.update(dt, camera, Player.veh ? new THREE.Vector3(Player.veh.x, 0, Player.veh.z) : new THREE.Vector3(Player.x, 0, Player.z));
  FX.update(dt);
  // звук
  if (Snd.ready) {
    const near = G.vehicles.filter((v) => dist2(v.x, v.z, Player.x, Player.z) < 90 * 90).sort((a, b) => dist2(a.x, a.z, Player.x, Player.z) - dist2(b.x, b.z, Player.x, Player.z)).slice(0, 8);
    Snd.updateEngines(near, Player.veh);
    Snd.updateSirens(G.vehicles.filter((v) => v.siren && !v.wreck && dist2(v.x, v.z, Player.x, Player.z) < 220 * 220).sort((a, b) => dist2(a.x, a.z, Player.x, Player.z) - dist2(b.x, b.z, Player.x, Player.z)).slice(0, 2));
    let water = 0; for (let a = 0; a < 8; a++) if (City.isWater(Player.x + Math.cos(a * 0.785) * 45, Player.z + Math.sin(a * 0.785) * 45)) water += 0.125;
    Snd.updateAmbient(dt, G.env, Player.x, Player.z, !!Player.veh, water);
    if (!Player.veh) Radio.update(0);
    else Radio.update(Player.veh.isBike ? 0 : 0.6);
  }
  // маркеры магазинов
  const t = G.time;
  for (const p of City.pois) {
    if (!p.marker) continue;
    const d2 = dist2(p.x, p.z, Player.x, Player.z);
    p.marker.visible = d2 < 180 * 180;
    if (p.marker.visible) { p.marker.children[1].visible = d2 > 12 * 12; p.marker.rotation.y = t * 1.5; p.marker.position.y = Math.sin(t * 2 + p.x) * 0.08; }
  }
  if (City.lampGlow && G.env) City.lampGlow.material.size = 14;
}

// карта окружения для отражений на кузовах машин
function buildEnvMap() {
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 p; void main(){ vec3 d = normalize(p); float h = d.y; vec3 sky = mix(vec3(0.75,0.85,0.95), vec3(0.3,0.5,0.85), clamp(h,0.0,1.0)); vec3 gr = vec3(0.26,0.25,0.22); vec3 c = h > 0.0 ? sky : gr; c += vec3(1.4,1.2,0.9) * pow(max(dot(d, normalize(vec3(0.4,0.6,0.3))), 0.0), 40.0); gl_FragColor = vec4(c, 1.0); }' });
  es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
  G.envMap = pm.fromScene(es, 0.02).texture; pm.dispose();
}

// ---------- загрузка ----------
async function boot() {
  try {
    progress(5, 'Подготовка…');
    loadSettings();
    renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.LinearToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.4, 900);
    G.scene = scene; G.camera = camera; G.renderer = renderer;
    scene.add(camera);
    await tick();
    progress(12, 'Рисуем текстуры…');
    G.tex = createTextures();
    loadOverrides(G.tex);
    await tick();
    progress(25, 'Строим Северодвинск…');
    buildCity(scene);
    RING_C.x = 1520 * 0.6; RING_C.z = 510 * 0.6;
    await tick();
    progress(60, 'Небо и погода…');
    createEnv(scene, camera, renderer);
    buildEnvMap(); Post.init(renderer, scene, camera);
    FX.init(scene);
    await tick();
    progress(75, 'Люди, машины, банды…');
    Player.init();
    Gangs.init();
    Story.init();
    Events.init();
    UI.init();
    bindInput(); bindSettings(); bindMenus();
    applySettings();
    // стартовая позиция для облёта на титуле
    const sp = homeSpawn(); Player.setPos(sp.x, sp.z, sp.yaw); Player.rig.root.visible = false;
    Veh.wantTraffic = Math.round(30 * G.settings.density);
    for (let i = 0; i < 25; i++) { Veh.spawnTraffic({ x: RING_C.x, z: RING_C.z }, 20, 200, true); Peds.spawnCivil({ x: RING_C.x, z: RING_C.z }, 20, 150); }
    G.player = Player;
    await tick();
    progress(100, 'Готово');
    $('tloading').classList.add('hidden'); $('tmenu').classList.remove('hidden');
    $('btn-continue').classList.toggle('hidden', !readSave());
    G.freeze = true;
    last = performance.now();
    requestAnimationFrame(frame);
  } catch (e) { showErr('Ошибка загрузки: ' + (e.stack || e)); console.error(e); }
}

function bindMenus() {
  $('btn-new').onclick = () => startGame(false);
  $('btn-continue').onclick = () => startGame(true);
  const open = (id) => $(id).classList.remove('hidden'), close = (id) => $(id).classList.add('hidden');
  $('btn-t-settings').onclick = () => open('settings'); $('btn-t-controls').onclick = () => open('controls');
  $('btn-settings').onclick = () => open('settings'); $('btn-controls').onclick = () => open('controls');
  $('btn-settings-back').onclick = () => close('settings'); $('btn-controls-back').onclick = () => close('controls');
  $('btn-resume').onclick = resumeGame;
  $('btn-save').onclick = () => G.saveGame();
  $('btn-quit').onclick = () => { toTitle(); };
  document.querySelectorAll('button').forEach((b) => b.addEventListener('mouseenter', () => Snd.hover()));
  document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { Snd.init(); Snd.click(); }));
}

// отладочный доступ
window.__step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) stepFrame(dt); };
window.__G = G; window.__game = { Player, Veh, Peds, Police, Gangs, Story, Events, City, UI, Combat, WEAPONS, startGame };
void clamp; void dist;
boot();
