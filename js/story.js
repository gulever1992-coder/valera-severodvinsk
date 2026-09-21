// Сюжет: миссии, цели, диалоги и кат-сцены. Всё описано данными — легко добавлять новые миссии и заставки.
import * as THREE from 'three';
import { G } from './state.js';
import { City } from './city.js';
import { Snd } from './audio.js';
import { P } from './mapdata.js';
import { dist, dist2, lerp, smooth } from './util.js';

// ---------- КАТ-СЦЕНЫ ----------
// shot: { from:[x,y,z], to:[x,y,z], look:[x,y,z], look2:[x,y,z], fov, dur, who, text, fade }
// координаты можно задавать функцией () => [x,y,z] (например, за игроком)
const at = (px, py, h = 0) => { const [x, z] = P(px, py); return [x, h, z]; };
const CUTSCENES = {
  intro: {
    title: 'СЕВЕРОДВИНСК · 2003',
    setup: () => { if (G.env) { G.env.hour = 7.4; G.env.setWeather('cloudy', true); } },
    shots: [
      { from: at(150, 300, 90), to: at(420, 470, 45), look: at(700, 470, 0), look2: at(900, 500, 0), fov: 60, dur: 6, who: '', text: 'Северодвинск. Город кораблей, тумана и панельных пятиэтажек. Тут строят подводные лодки — и ломают судьбы.' },
      { from: at(1300, 700, 80), to: at(1500, 500, 60), look: at(1520, 500, 10), look2: at(1520, 500, 10), fov: 55, dur: 5, who: 'Валера', text: 'Меня зовут Валера. Жил не тужил, пока не остался на мели: ни работы, ни денег, ни машины.' },
      { from: () => { const p = G.player; return [p.x + 6, 2.2, p.z + 6]; }, to: () => { const p = G.player; return [p.x + 3, 1.7, p.z + 3.5]; }, look: () => { const p = G.player; return [p.x, 1.5, p.z]; }, look2: () => { const p = G.player; return [p.x, 1.6, p.z]; }, fov: 50, dur: 5, who: 'Валера', text: 'Но в этом городе есть район, где всё решают пацаны и кулаки. Пора забирать своё. Начну с утренней прогулки до «Магнита».' },
    ],
  },
  meetSenya: {
    setup: () => { Story.spawnNpc('Сеня', 'ally'); },
    shots: [
      { from: () => { const n = Story.npc; return n ? [n.x + 3.5, 2.0, n.z + 3.5] : [0, 5, 0]; }, to: () => { const n = Story.npc; return n ? [n.x + 2.5, 1.7, n.z + 3.0] : [0, 5, 0]; }, look: () => { const n = Story.npc; return n ? [n.x, 1.5, n.z] : [0, 0, 0]; }, look2: () => { const n = Story.npc; return n ? [n.x, 1.6, n.z] : [0, 0, 0]; }, fov: 50, dur: 4.5, who: 'Сеня', text: 'Валера! Ну наконец-то. Слышал, ты на мели?' },
      { from: () => { const n = Story.npc; return n ? [n.x - 3, 1.8, n.z + 3] : [0, 5, 0]; }, to: () => { const n = Story.npc; return n ? [n.x - 2, 1.7, n.z + 2.5] : [0, 5, 0]; }, look: () => { const p = G.player; return [p.x, 1.5, p.z]; }, look2: () => { const p = G.player; return [p.x, 1.6, p.z]; }, fov: 50, dur: 4, who: 'Валера', text: 'Есть такое. Что предлагаешь?' },
      { from: () => { const n = Story.npc; return n ? [n.x + 3.5, 2.0, n.z - 2] : [0, 5, 0]; }, to: () => { const n = Story.npc; return n ? [n.x + 2.5, 1.7, n.z - 1] : [0, 5, 0]; }, look: () => { const n = Story.npc; return n ? [n.x, 1.5, n.z] : [0, 0, 0]; }, look2: () => { const n = Story.npc; return n ? [n.x, 1.6, n.z] : [0, 0, 0]; }, fov: 50, dur: 6, who: 'Сеня', text: 'Солевые оборзели совсем — весь парк под себя подмяли. Выгони их оттуда, и район твой. Будут деньги, будут свои пацаны. Только с голыми руками не лезь — купи биту в ЦУМе.' },
    ],
  },
  ending: {
    setup: () => { if (G.env) G.env.setWeather('clear', true); },
    shots: [
      { from: at(1500, 300, 60), to: at(1520, 450, 25), look: at(1520, 510, 8), look2: at(1520, 510, 8), fov: 55, dur: 6, who: 'Валера', text: 'Площадь Кораблестроителей. Когда-то я боялся выйти во двор без денег на автобус.' },
      { from: at(1200, 200, 120), to: at(900, 400, 150), look: at(1000, 400, 0), look2: at(800, 600, 0), fov: 65, dur: 7, who: 'Валера', text: 'Теперь весь город знает, чей он. Северодвинск — мой. Но это, конечно, только начало…' },
    ],
  },
};

// ---------- МИССИИ ----------
const poi = (name) => () => { const q = City.pois.find((x) => x.name === name); return q ? { x: q.x, z: q.z } : null; };
const alley = () => { const [x, z] = P(418, 538); return { x: x + 4, z: z + 12 }; };
const MISSIONS = [
  {
    id: 'm1', title: 'Первый день', reward: 2000, intro: 'intro',
    objectives: [
      { type: 'goto', text: 'Дойди до магазина «Магнит»', pos: poi('Магнит'), r: 6 },
      { type: 'buy', text: 'Купи еды в «Магните» (нажми E у маркера)' },
      { type: 'vehicle', text: 'Угони велосипед или машину (подойди и нажми F)' },
      { type: 'goto', text: 'Доберись до Приморского парка (Аллея «Дети войны»)', pos: alley, r: 14, cutscene: 'meetSenya' },
      { type: 'capture', text: 'Захвати «Приморский парк» — убивай Солевых в их районе', district: 'park' },
    ],
    onEnd: () => { Story.crewEnabled = true; G.ui.notify('Теперь у вас есть свои пацаны. Они будут ходить за вами.', 'good'); },
  },
  {
    id: 'm2', title: 'Гаражная арифметика', reward: 3000,
    objectives: [
      { type: 'goto', text: 'Найди «Чёрный рынок» (Гаражи №13)', pos: poi('Чёрный рынок «Гаражи»'), r: 6 },
      { type: 'buyWeapon', text: 'Купи любое огнестрельное оружие' },
      { type: 'capture', text: 'Захвати «Гаражи на Ломоносова»', district: 'garage' },
    ],
  },
  {
    id: 'm3', title: 'Панки, хой!', reward: 4000,
    objectives: [
      { type: 'capture', text: 'Захвати район «Трухинова» у Панков и эмо', district: 'truh' },
      { type: 'capture', text: 'Захвати район «Карла Маркса»', district: 'marx' },
    ],
  },
  {
    id: 'm4', title: 'Гоп-стоп', reward: 6000,
    objectives: [
      { type: 'capture', text: 'Захвати «Арктическую» у Гопников', district: 'arct' },
      { type: 'capture', text: 'Захвати «Юг — Пятёрочка»', district: 'south' },
      { type: 'capture', text: 'Захвати «Энергетиков»', district: 'energ' },
    ],
  },
  {
    id: 'm5', title: 'Малиновые пиджаки', reward: 12000,
    objectives: [
      { type: 'capture', text: 'Захвати «Nord Arena» у Новых русских', district: 'north' },
      { type: 'capture', text: 'Захвати «ЦУМ»', district: 'cum' },
      { type: 'capture', text: 'Захвати площадь Кораблестроителей — центр города', district: 'center' },
    ],
    outro: 'ending',
  },
];

export const Story = {
  missions: MISSIONS, mi: -1, oi: 0, target: null, npc: null, crewEnabled: false, bought: false, boughtWeapon: false, cs: null, done: false, kills: 0,
  init() { G.story = Story; },
  start(idx = 0) {
    Story.mi = idx; Story.oi = 0;
    const m = MISSIONS[idx];
    if (!m) return Story.finishAll();
    if (m.intro && !Story.introSeen) { Story.introSeen = true; Story.play(m.intro, () => Story.beginMission(m)); }
    else Story.beginMission(m);
  },
  beginMission(m) {
    G.ui.banner(m.title.toUpperCase(), 'Миссия ' + (Story.mi + 1) + ' из ' + MISSIONS.length, true);
    Story.beginObjective();
  },
  beginObjective() {
    const m = MISSIONS[Story.mi]; if (!m) return;
    const o = m.objectives[Story.oi];
    if (!o) return;
    Story.bought = false; Story.boughtWeapon = false;
    G.ui.setObjective(o.text);
    if (o.type === 'capture') { const d = City.districts.find((x) => x.id === o.district); Story.target = d ? { x: d.pos[0], z: d.pos[1], area: true } : null; }
    else if (o.pos) Story.target = o.pos();
    else Story.target = null;
    if (o.type === 'buy' || o.type === 'buyWeapon') { const q = City.pois.find((x) => x.name === (o.type === 'buy' ? 'Магнит' : 'Чёрный рынок «Гаражи»')); if (q) Story.target = { x: q.x, z: q.z }; }
    Story.updateMarker();
  },
  advance() {
    const m = MISSIONS[Story.mi];
    Story.oi++;
    Snd.notify();
    if (Story.oi >= m.objectives.length) {
      G.money += m.reward; Snd.missionPassed();
      G.ui.banner('МИССИЯ ВЫПОЛНЕНА', `${m.title} · +${m.reward} ₽`);
      if (m.onEnd) m.onEnd();
      G.ui.setObjective('');
      Story.target = null; Story.updateMarker();
      const next = Story.mi + 1;
      const go = () => { if (m.outro) Story.play(m.outro, () => { Story.finishAll(); }); else Story.start(next); };
      setTimeout(go, 4500);
      Story.mi = -2; // пауза между миссиями
      Story.pending = next;
    } else Story.beginObjective();
  },
  finishAll() {
    Story.done = true; Story.mi = -3; Story.target = null; Story.updateMarker();
    G.ui.setObjective('Свободная игра: город твой. Держи районы и отбивай нападения.');
    G.ui.banner('ВЫ ПРОШЛИ СЮЖЕТ', 'Продолжайте играть в свободном режиме');
  },
  onKill() {},
  onCapture() {},
  onBuy(item) { Story.bought = true; if (item.weapon) Story.boughtWeapon = true; },
  spawnNpc(name, type) {
    if (Story.npc && !Story.npc.dead) return;
    const a = alley();
    const p = G.Peds.spawn(type, a.x + 2, a.z - 2, { state: 'idle' });
    p.keep = true; p.name = name; p.hostile = false; p.weapon = null; p.rig.setWeapon(null);
    Story.npc = p;
    p.heading = Math.atan2(G.player.x - p.x, G.player.z - p.z);
  },
  update(dt) {
    if (Story.cs) { Story.updateCutscene(dt); return; }
    const pl = G.player;
    if (!pl || pl.dead) return;
    if (Story.mi < 0) { Story.updateMarker(dt); return; }
    const m = MISSIONS[Story.mi]; if (!m) return;
    const o = m.objectives[Story.oi];
    if (!o) return;
    let ok = false;
    if (o.type === 'goto') { const t = o.pos(); if (t && dist(pl.x, pl.z, t.x, t.z) < o.r) { ok = true; if (o.cutscene) { Story.play(o.cutscene, () => Story.advance()); return; } } }
    else if (o.type === 'buy') ok = Story.bought;
    else if (o.type === 'buyWeapon') ok = Story.boughtWeapon;
    else if (o.type === 'vehicle') ok = !!pl.veh;
    else if (o.type === 'capture') { const d = City.districts.find((x) => x.id === o.district); ok = !!d && d.owner === 'valera'; }
    if (ok) Story.advance();
    Story.updateMarker(dt);
    // подсказка о районе
    if (o.type === 'capture' && Story.target) Story.target = { x: City.districts.find((x) => x.id === o.district).pos[0], z: City.districts.find((x) => x.id === o.district).pos[1], area: true };
  },
  updateMarker(dt) {
    const mk = Story.marker;
    if (!mk) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xffdd33, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 60, 16, 1, true).translate(0, 30, 0), mat);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.0, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffdd33, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.position.y = 0.25; g.add(beam, ring); g.visible = false; G.scene.add(g); Story.marker = g;
    }
    const t = Story.target;
    Story.marker.visible = !!t && !t.area;
    if (t) { Story.marker.position.set(t.x, 0, t.z); Story.marker.rotation.y += (dt || 0) * 1.2; }
  },

  // ---------- кат-сцены ----------
  play(id, done) {
    const cs = CUTSCENES[id];
    if (!cs) { done && done(); return; }
    cs.setup && cs.setup();
    Story.cs = { def: cs, i: 0, t: 0, done };
    G.freeze = true; G.ui.cutsceneOn(cs.title);
    Story.showShot();
  },
  showShot() {
    const c = Story.cs; const s = c.def.shots[c.i];
    if (s.who !== undefined && s.text) G.ui.subtitle(s.who, s.text, s.dur);
  },
  resolve(v) { return typeof v === 'function' ? v() : v; },
  updateCutscene(dt) {
    const c = Story.cs;
    G.input.pressed.Space && Story.skip();
    if (!Story.cs) return;
    c.t += dt;
    const s = c.def.shots[c.i];
    const k = smooth(Math.min(1, c.t / s.dur));
    const a = Story.resolve(s.from), b = Story.resolve(s.to), l0 = Story.resolve(s.look), l1 = Story.resolve(s.look2 || s.look);
    G.camOverride = { px: lerp(a[0], b[0], k), py: lerp(a[1], b[1], k), pz: lerp(a[2], b[2], k), lx: lerp(l0[0], l1[0], k), ly: lerp(l0[1], l1[1], k), lz: lerp(l0[2], l1[2], k), fov: s.fov || 60 };
    if (c.t >= s.dur) {
      c.i++; c.t = 0;
      if (c.i >= c.def.shots.length) Story.endCutscene(); else Story.showShot();
    }
  },
  skip() { if (Story.cs) Story.endCutscene(); },
  endCutscene() {
    const c = Story.cs; Story.cs = null;
    G.camOverride = null; G.freeze = false; G.ui.cutsceneOff();
    c.done && c.done();
  },
  save() { return { mi: Story.mi < 0 ? (Story.pending !== undefined ? Story.pending : Story.mi) : Story.mi, oi: Story.mi < 0 ? 0 : Story.oi, crew: Story.crewEnabled, seen: Story.introSeen, done: Story.done }; },
  load(o) { if (!o) return; Story.crewEnabled = !!o.crew; Story.introSeen = !!o.seen; Story.done = !!o.done; Story.mi = o.mi; Story.oi = o.oi; },
};
G.story = Story;
void dist2;
