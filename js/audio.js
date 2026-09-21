// Звук: полностью синтезируется в WebAudio (внешних файлов нет).
// Шаги, удары, выстрелы разных стволов, взрывы, двигатели, клаксон, сирены, визг шин, столкновения,
// дождь, ветер, чайки, гудки заводов, радио с тремя станциями, интерфейс.
import { G } from './state.js';
import { clamp, rand, pick, lerp, dist } from './util.js';

let ctx = null, master, sfxBus, ambBus, musBus, engBus, uiBus, noiseBuf, comp;
let active = 0;
const L = { x: 0, z: 0, yaw: 0 };

export const Snd = {
  ready: false, muted: false,
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.8;
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    const bus = (v) => { const g = ctx.createGain(); g.gain.value = v; g.connect(master); return g; };
    sfxBus = bus(1); ambBus = bus(0.7); musBus = bus(0.5); engBus = bus(0.55); uiBus = bus(0.8);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    Snd.ready = true;
    Snd.startAmbient();
  },
  setVolume(v) { if (master) master.gain.value = v; },
  setListener(x, z, yaw) { L.x = x; L.z = z; L.yaw = yaw; },
  now() { return ctx ? ctx.currentTime : 0; },

  // ---------- базовые кирпичики ----------
  spat(x, z, ref = 60) {
    if (x === undefined) return { g: 1, p: 0 };
    const dx = x - L.x, dz = z - L.z;
    const d = Math.hypot(dx, dz);
    const g = clamp(1 / (1 + (d / ref) * (d / ref) * 0.9), 0, 1);
    // угол относительно направления взгляда: yaw — направление камеры (вперёд = (sin yaw, cos yaw)), право = (cos yaw, -sin yaw)
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const p = d > 0.1 ? clamp((dx * rx + dz * rz) / d, -1, 1) * 0.8 : 0;
    return { g, p, d };
  },
  noise({ dur = 0.2, gain = 0.5, type = 'lowpass', f0 = 1000, f1 = null, q = 1, attack = 0.002, delay = 0, x, z, ref = 60, bus = sfxBus, curve = 2 } = {}) {
    if (!ctx || active > 46) return;
    const sp = Snd.spat(x, z, ref);
    if (sp.g < 0.01) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    s.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * sp.g, t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack, dur / (curve + 2));
    const pn = ctx.createStereoPanner(); pn.pan.value = sp.p;
    s.connect(f); f.connect(g); g.connect(pn); pn.connect(bus || sfxBus);
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
    active++; s.onended = () => active--;
  },
  tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.2, gain = 0.3, attack = 0.005, delay = 0, x, z, ref = 60, bus = sfxBus, vib = 0, curve = 2 } = {}) {
    if (!ctx || active > 46) return;
    const sp = Snd.spat(x, z, ref);
    if (sp.g < 0.01) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 6; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.1); }
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * sp.g, t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack, dur / (curve + 2));
    const pn = ctx.createStereoPanner(); pn.pan.value = sp.p;
    o.connect(g); g.connect(pn); pn.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.15);
    active++; o.onended = () => active--;
  },

  // ---------- оружие ----------
  shot(kind, x, z) {
    const R = kind === 'rifle' ? 160 : kind === 'shotgun' ? 130 : 100;
    switch (kind) {
      case 'pistol': Snd.noise({ dur: 0.16, gain: 0.9, type: 'bandpass', f0: 2600, f1: 500, q: 0.7, x, z, ref: R }); Snd.tone({ type: 'sine', f0: 190, f1: 60, dur: 0.16, gain: 0.8, x, z, ref: R }); break;
      case 'shotgun': Snd.noise({ dur: 0.5, gain: 1.2, type: 'lowpass', f0: 5000, f1: 300, x, z, ref: R }); Snd.tone({ type: 'sine', f0: 130, f1: 38, dur: 0.4, gain: 1.1, x, z, ref: R }); Snd.noise({ dur: 0.35, gain: 0.5, type: 'highpass', f0: 1800, delay: 0.02, x, z, ref: R }); break;
      case 'smg': Snd.noise({ dur: 0.1, gain: 0.7, type: 'bandpass', f0: 3200, f1: 900, q: 0.8, x, z, ref: R }); Snd.tone({ type: 'sine', f0: 230, f1: 90, dur: 0.09, gain: 0.55, x, z, ref: R }); break;
      case 'rifle': Snd.noise({ dur: 0.3, gain: 1.05, type: 'bandpass', f0: 3800, f1: 400, q: 0.6, x, z, ref: R }); Snd.tone({ type: 'sine', f0: 150, f1: 45, dur: 0.24, gain: 0.95, x, z, ref: R }); Snd.noise({ dur: 0.5, gain: 0.35, type: 'lowpass', f0: 900, f1: 200, delay: 0.05, x, z, ref: R * 1.5 }); break;
      default: Snd.noise({ dur: 0.15, gain: 0.5, x, z });
    }
  },
  dry() { Snd.tone({ type: 'square', f0: 900, f1: 500, dur: 0.05, gain: 0.15, bus: uiBus }); },
  reload() {
    Snd.noise({ dur: 0.06, gain: 0.5, type: 'bandpass', f0: 1800, q: 4, bus: sfxBus });
    Snd.tone({ type: 'square', f0: 300, f1: 160, dur: 0.06, gain: 0.2, delay: 0.5 });
    Snd.noise({ dur: 0.08, gain: 0.55, type: 'bandpass', f0: 2500, q: 5, delay: 0.75 });
  },
  pump(x, z) { Snd.noise({ dur: 0.07, gain: 0.5, type: 'bandpass', f0: 1200, q: 3, x, z }); Snd.noise({ dur: 0.08, gain: 0.5, type: 'bandpass', f0: 1800, q: 3, delay: 0.14, x, z }); },
  swing() { Snd.noise({ dur: 0.18, gain: 0.25, type: 'bandpass', f0: 500, f1: 1800, q: 1.2, attack: 0.08 }); },
  punch(x, z) { Snd.tone({ type: 'sine', f0: 140, f1: 55, dur: 0.12, gain: 0.7, x, z }); Snd.noise({ dur: 0.07, gain: 0.45, type: 'lowpass', f0: 1800, x, z }); },
  bat(x, z) { Snd.tone({ type: 'triangle', f0: 260, f1: 110, dur: 0.16, gain: 0.8, x, z }); Snd.noise({ dur: 0.1, gain: 0.5, type: 'bandpass', f0: 1500, x, z }); },
  stab(x, z) { Snd.noise({ dur: 0.12, gain: 0.5, type: 'bandpass', f0: 1200, f1: 400, q: 2, x, z }); Snd.tone({ type: 'sine', f0: 90, f1: 50, dur: 0.1, gain: 0.3, x, z }); },
  impact(x, z) { Snd.tone({ type: 'triangle', f0: rand(1400, 2400), f1: rand(700, 1000), dur: 0.08, gain: 0.25, x, z, ref: 40 }); Snd.noise({ dur: 0.05, gain: 0.3, type: 'highpass', f0: 3000, x, z, ref: 40 }); },
  whiz(x, z) { Snd.noise({ dur: 0.1, gain: 0.25, type: 'bandpass', f0: 3500, f1: 1800, q: 3, x, z, ref: 30 }); },
  explosion(x, z) {
    Snd.noise({ dur: 1.6, gain: 1.6, type: 'lowpass', f0: 3500, f1: 80, x, z, ref: 220, curve: 1 });
    Snd.tone({ type: 'sine', f0: 90, f1: 26, dur: 1.4, gain: 1.6, x, z, ref: 260, curve: 1 });
    Snd.noise({ dur: 0.6, gain: 0.7, type: 'highpass', f0: 2500, x, z, ref: 200, delay: 0.03 });
    Snd.noise({ dur: 1.2, gain: 0.4, type: 'lowpass', f0: 500, f1: 90, x, z, ref: 350, delay: 0.25 });
  },
  fire(x, z) { Snd.noise({ dur: 0.5, gain: 0.25, type: 'bandpass', f0: 1200, q: 0.8, x, z, ref: 30 }); },
  glass(x, z) { for (let i = 0; i < 5; i++) Snd.tone({ type: 'triangle', f0: rand(2200, 5000), f1: rand(1500, 3000), dur: 0.12, gain: 0.18, delay: i * 0.03 + rand(0, 0.03), x, z, ref: 60 }); },
  throwSound() { Snd.swing(); },
  pin() { Snd.tone({ type: 'triangle', f0: 3000, f1: 1800, dur: 0.05, gain: 0.25 }); },

  // ---------- персонаж ----------
  step(surface = 'asphalt', run = false, x, z) {
    const v = run ? 1 : 0.6;
    if (surface === 'grass') Snd.noise({ dur: 0.07, gain: 0.22 * v, type: 'bandpass', f0: 1400, q: 0.6, x, z, ref: 25 });
    else if (surface === 'snow') { Snd.noise({ dur: 0.1, gain: 0.3 * v, type: 'bandpass', f0: 3800, q: 1.6, x, z, ref: 25 }); Snd.noise({ dur: 0.08, gain: 0.15, type: 'lowpass', f0: 400, x, z, ref: 25 }); }
    else if (surface === 'water') Snd.noise({ dur: 0.18, gain: 0.35 * v, type: 'bandpass', f0: 900, f1: 2400, q: 1, x, z, ref: 25 });
    else { Snd.noise({ dur: 0.05, gain: 0.3 * v, type: 'lowpass', f0: 1100 + rand(-150, 150), x, z, ref: 25 }); Snd.tone({ type: 'sine', f0: 110, f1: 70, dur: 0.05, gain: 0.2 * v, x, z, ref: 25 }); }
  },
  land(x, z) { Snd.noise({ dur: 0.12, gain: 0.4, type: 'lowpass', f0: 700, x, z, ref: 25 }); },
  jump() { Snd.noise({ dur: 0.08, gain: 0.12, type: 'lowpass', f0: 800 }); },
  grunt(x, z, pitch = 1) { Snd.tone({ type: 'sawtooth', f0: 170 * pitch, f1: 110 * pitch, dur: 0.22, gain: 0.35, x, z, ref: 40, vib: 4 }); Snd.noise({ dur: 0.15, gain: 0.12, type: 'bandpass', f0: 700, x, z, ref: 40 }); },
  scream(x, z, pitch = 1) { Snd.tone({ type: 'sawtooth', f0: 500 * pitch, f1: 900 * pitch, dur: 0.9, gain: 0.32, x, z, ref: 70, vib: 25, attack: 0.05 }); Snd.tone({ type: 'square', f0: 1000 * pitch, f1: 1500 * pitch, dur: 0.8, gain: 0.08, x, z, ref: 70, delay: 0.05 }); },
  death(x, z, pitch = 1) { Snd.tone({ type: 'sawtooth', f0: 220 * pitch, f1: 60, dur: 0.7, gain: 0.4, x, z, ref: 50, vib: 5 }); Snd.noise({ dur: 0.35, gain: 0.3, type: 'lowpass', f0: 500, x, z, delay: 0.3, ref: 30 }); },
  voice(x, z, pitch = 1) { // «бормотание» NPC
    const n = 3 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) Snd.tone({ type: 'sawtooth', f0: rand(120, 210) * pitch, f1: rand(100, 220) * pitch, dur: 0.11, gain: 0.16, delay: i * 0.13, x, z, ref: 30 });
  },
  heartbeat() { Snd.tone({ type: 'sine', f0: 65, f1: 40, dur: 0.14, gain: 0.7, bus: uiBus }); Snd.tone({ type: 'sine', f0: 60, f1: 38, dur: 0.14, gain: 0.5, delay: 0.2, bus: uiBus }); },
  cough(x, z) { Snd.noise({ dur: 0.12, gain: 0.3, type: 'bandpass', f0: 600, x, z }); Snd.noise({ dur: 0.1, gain: 0.3, type: 'bandpass', f0: 700, delay: 0.15, x, z }); },
  eat() { for (let i = 0; i < 4; i++) Snd.noise({ dur: 0.05, gain: 0.25, type: 'bandpass', f0: 1800, q: 2, delay: i * 0.1, bus: uiBus }); },
  drink() { for (let i = 0; i < 3; i++) Snd.tone({ type: 'sine', f0: 200 + i * 40, f1: 300, dur: 0.12, gain: 0.15, delay: i * 0.16, bus: uiBus }); },
  door(x, z) { Snd.tone({ type: 'sine', f0: 140, f1: 70, dur: 0.09, gain: 0.5, x, z, ref: 30 }); Snd.noise({ dur: 0.08, gain: 0.3, type: 'lowpass', f0: 1500, x, z, ref: 30 }); Snd.noise({ dur: 0.04, gain: 0.25, type: 'bandpass', f0: 3000, delay: 0.03, x, z, ref: 30 }); },
  splash(x, z) { Snd.noise({ dur: 0.5, gain: 0.5, type: 'bandpass', f0: 700, f1: 2500, q: 0.8, x, z, ref: 40 }); },
  bell() { Snd.tone({ type: 'sine', f0: 2600, dur: 0.6, gain: 0.25, curve: 4 }); Snd.tone({ type: 'sine', f0: 3900, dur: 0.5, gain: 0.12, curve: 4, delay: 0.005 }); },
  chain(x, z) { Snd.noise({ dur: 0.03, gain: 0.08, type: 'bandpass', f0: 4000, q: 3, x, z, ref: 20 }); },

  // ---------- транспорт ----------
  crash(power = 1, x, z) {
    Snd.noise({ dur: 0.3 + power * 0.3, gain: 0.7 * power, type: 'lowpass', f0: 2500, f1: 200, x, z, ref: 90 });
    Snd.tone({ type: 'sine', f0: 100, f1: 40, dur: 0.3, gain: 0.7 * power, x, z, ref: 90 });
    for (let i = 0; i < 3; i++) Snd.tone({ type: 'triangle', f0: rand(500, 1500), f1: rand(300, 800), dur: 0.15, gain: 0.15 * power, delay: rand(0, 0.15), x, z, ref: 70 });
  },
  scrape(x, z) { Snd.noise({ dur: 0.25, gain: 0.3, type: 'bandpass', f0: 2000, f1: 900, q: 1.4, x, z, ref: 50 }); },
  horn(v) { Snd.hornOn(v, true); },
  hornOn(v, on) {
    if (!ctx) return;
    if (!v._horn && on) {
      const g = ctx.createGain(); g.gain.value = 0; const p = ctx.createStereoPanner();
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = o2.type = 'square';
      const f = 380 + (v.spec.kind === 'bus' ? -120 : Math.random() * 60);
      o1.frequency.value = f; o2.frequency.value = f * 1.26;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(p); p.connect(sfxBus);
      o1.start(); o2.start();
      v._horn = { g, o1, o2, p };
    }
    if (v._horn) {
      const sp = Snd.spat(v.x, v.z, 90);
      v._horn.g.gain.setTargetAtTime(on ? 0.16 * sp.g : 0, ctx.currentTime, 0.01);
      v._horn.p.pan.value = sp.p;
      if (!on) { const h = v._horn; v._horn = null; setTimeout(() => { try { h.o1.stop(); h.o2.stop(); } catch (e) { /* */ } }, 200); }
    }
  },
  skid(vol, x, z) { // непрерывный визг — обновляется каждый кадр
    if (!ctx) return;
    if (!Snd._skid) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0; const p = ctx.createStereoPanner();
      s.connect(f); f.connect(g); g.connect(p); p.connect(sfxBus); s.start();
      Snd._skid = { g, f, p };
    }
    const sp = Snd.spat(x, z, 60);
    Snd._skid.g.gain.setTargetAtTime(vol * 0.35 * sp.g, ctx.currentTime, 0.05);
    Snd._skid.f.frequency.setTargetAtTime(1100 + vol * 900, ctx.currentTime, 0.1);
    Snd._skid.p.pan.value = sp.p;
  },
  ignition() { Snd.tone({ type: 'sawtooth', f0: 40, f1: 90, dur: 0.5, gain: 0.35, bus: engBus }); Snd.noise({ dur: 0.4, gain: 0.2, type: 'lowpass', f0: 400, bus: engBus }); },

  // двигатели: пул голосов
  _eng: [],
  _engVoice() {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), n = ctx.createBufferSource();
    o1.type = 'sawtooth'; o2.type = 'square'; n.buffer = noiseBuf; n.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    const ws = ctx.createWaveShaper(); const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; c[i] = Math.tanh(x * 2.2); } ws.curve = c;
    const g = ctx.createGain(); g.gain.value = 0; const p = ctx.createStereoPanner();
    const ng = ctx.createGain(); ng.gain.value = 0.0;
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 600;
    o1.connect(f); o2.connect(f); f.connect(ws); ws.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g); g.connect(p); p.connect(engBus);
    o1.start(); o2.start(); n.start();
    return { o1, o2, f, g, p, ng, veh: null };
  },
  updateEngines(list, player) {
    if (!ctx) return;
    // list: ближайшие машины (уже отсортированы), player — активная машина игрока
    const want = [];
    if (player) want.push(player);
    for (const v of list) { if (want.length >= 5) break; if (v !== player && !v.dead) want.push(v); }
    while (Snd._eng.length < 5) Snd._eng.push(Snd._engVoice());
    Snd._eng.forEach((e, i) => {
      const v = want[i];
      if (!v || v.spec.kind === 'bike' || (!v.driver && !v.playerDriven && !v.ai) || v.wreck) { e.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); return; }
      const sp = v.playerDriven ? { g: 1, p: 0 } : Snd.spat(v.x, v.z, 55);
      const spd = Math.abs(v.speed);
      const gear = Math.min(5, 1 + Math.floor(spd / (v.spec.max / 5.5)));
      const gmax = v.spec.max / 5.5;
      const inGear = (spd % gmax) / gmax;
      const rpm = v.engineOff ? 0 : clamp(0.18 + (spd < 0.5 ? (v.throttle || 0) * 0.5 : inGear * 0.62 + 0.15) + (v.throttle > 0.1 ? 0.1 : 0), 0.15, 1);
      v.rpm = rpm;
      const bus = v.spec.kind === 'bus' || v.spec.kind === 'van';
      const base = (bus ? 22 : 30) + rpm * (bus ? 62 : 84);
      const t = ctx.currentTime;
      e.o1.frequency.setTargetAtTime(base, t, 0.04); e.o2.frequency.setTargetAtTime(base * 0.5, t, 0.04);
      e.f.frequency.setTargetAtTime(220 + rpm * 900 + (v.throttle > 0.1 ? 350 : 0), t, 0.06);
      const vol = (v.engineOff ? 0 : 0.11 + rpm * 0.1 + Math.max(0, v.throttle || 0) * 0.07) * sp.g * (v.playerDriven ? 1.1 : 1);
      e.g.gain.setTargetAtTime(vol, t, 0.05);
      e.ng.gain.setTargetAtTime(0.25 * rpm, t, 0.1);
      e.p.pan.value = sp.p;
      e.veh = v; void gear;
    });
  },
  // сирена
  _sir: [],
  updateSirens(list) {
    if (!ctx) return;
    while (Snd._sir.length < 2) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.value = 0; const p = ctx.createStereoPanner(); o.connect(f); f.connect(g); g.connect(p); p.connect(sfxBus); o.start();
      Snd._sir.push({ o, g, p, ph: 0 });
    }
    const t = ctx.currentTime;
    Snd._sir.forEach((s, i) => {
      const v = list[i];
      if (!v) { s.g.gain.setTargetAtTime(0, t, 0.1); return; }
      const sp = Snd.spat(v.x, v.z, 100);
      const wail = 0.5 + 0.5 * Math.sin(t * (v.spec.ambulance ? 5 : 3.2) + i);
      s.o.frequency.setTargetAtTime(v.spec.ambulance ? 700 + (Math.floor(t * 2.5) % 2) * 320 : 650 + wail * 700, t, 0.03);
      s.g.gain.setTargetAtTime(0.11 * sp.g, t, 0.06); s.p.pan.value = sp.p;
    });
  },

  // ---------- интерфейс ----------
  click() { Snd.tone({ type: 'square', f0: 1200, f1: 900, dur: 0.04, gain: 0.12, bus: uiBus }); },
  hover() { Snd.tone({ type: 'sine', f0: 900, dur: 0.03, gain: 0.05, bus: uiBus }); },
  confirm() { Snd.tone({ type: 'sine', f0: 660, dur: 0.1, gain: 0.2, bus: uiBus }); Snd.tone({ type: 'sine', f0: 990, dur: 0.16, gain: 0.2, delay: 0.08, bus: uiBus }); },
  error() { Snd.tone({ type: 'square', f0: 200, f1: 150, dur: 0.18, gain: 0.18, bus: uiBus }); },
  cash() { Snd.tone({ type: 'triangle', f0: 1800, dur: 0.25, gain: 0.25, bus: uiBus, curve: 4 }); Snd.tone({ type: 'triangle', f0: 2700, dur: 0.35, gain: 0.2, delay: 0.09, bus: uiBus, curve: 4 }); Snd.noise({ dur: 0.05, gain: 0.2, type: 'highpass', f0: 5000, bus: uiBus }); },
  pickup() { Snd.tone({ type: 'sine', f0: 800, f1: 1400, dur: 0.12, gain: 0.2, bus: uiBus }); },
  weaponSwitch() { Snd.noise({ dur: 0.05, gain: 0.25, type: 'bandpass', f0: 2000, q: 3, bus: sfxBus }); Snd.tone({ type: 'square', f0: 400, f1: 250, dur: 0.05, gain: 0.1, bus: sfxBus }); },
  star() { Snd.tone({ type: 'sine', f0: 880, dur: 0.35, gain: 0.25, bus: uiBus, curve: 3 }); Snd.tone({ type: 'sine', f0: 1320, dur: 0.4, gain: 0.2, delay: 0.1, bus: uiBus, curve: 3 }); },
  wantedLost() { [523, 659, 784].forEach((f, i) => Snd.tone({ type: 'sine', f0: f, dur: 0.3, gain: 0.2, delay: i * 0.12, bus: uiBus })); },
  notify() { Snd.tone({ type: 'sine', f0: 1100, dur: 0.12, gain: 0.15, bus: uiBus }); Snd.tone({ type: 'sine', f0: 1500, dur: 0.15, gain: 0.15, delay: 0.09, bus: uiBus }); },
  missionPassed() { [392, 494, 587, 784, 988].forEach((f, i) => { Snd.tone({ type: 'triangle', f0: f, dur: 0.6, gain: 0.25, delay: i * 0.15, bus: uiBus, curve: 3 }); Snd.tone({ type: 'sine', f0: f / 2, dur: 0.6, gain: 0.2, delay: i * 0.15, bus: uiBus, curve: 3 }); }); },
  captured() { [261, 329, 392, 523].forEach((f, i) => { Snd.tone({ type: 'sawtooth', f0: f, dur: 0.5, gain: 0.12, delay: i * 0.12, bus: uiBus, curve: 3 }); }); Snd.tone({ type: 'sine', f0: 130, dur: 1, gain: 0.3, bus: uiBus }); },
  wasted() { Snd.tone({ type: 'sawtooth', f0: 220, f1: 40, dur: 2, gain: 0.35, bus: uiBus, curve: 1 }); Snd.noise({ dur: 2, gain: 0.3, type: 'lowpass', f0: 800, f1: 60, bus: uiBus, curve: 1 }); Snd.tone({ type: 'sine', f0: 70, f1: 30, dur: 2.2, gain: 0.5, bus: uiBus, curve: 1 }); },
  busted() { for (let i = 0; i < 6; i++) Snd.tone({ type: 'square', f0: 700, dur: 0.14, gain: 0.15, delay: i * 0.25, bus: uiBus }); Snd.tone({ type: 'sawtooth', f0: 300, f1: 100, dur: 1.4, gain: 0.25, delay: 0.3, bus: uiBus }); },
  radioChatter() { const n = 3 + ((Math.random() * 4) | 0); Snd.noise({ dur: 0.05, gain: 0.15, type: 'highpass', f0: 3000, bus: uiBus }); for (let i = 0; i < n; i++) Snd.tone({ type: 'square', f0: rand(300, 900), dur: 0.05, gain: 0.05, delay: 0.1 + i * 0.07, bus: uiBus }); Snd.noise({ dur: 0.1, gain: 0.15, type: 'bandpass', f0: 2000, delay: 0.1 + n * 0.07, bus: uiBus }); },
  phone() { for (let i = 0; i < 4; i++) { Snd.tone({ type: 'sine', f0: 1400, dur: 0.1, gain: 0.15, delay: i * 0.2, bus: uiBus }); } },
  thunder() { Snd.noise({ dur: 4, gain: 0.9, type: 'lowpass', f0: 500, f1: 60, attack: 0.3, bus: ambBus, curve: 1 }); Snd.tone({ type: 'sine', f0: 50, f1: 28, dur: 3.5, gain: 0.7, bus: ambBus, curve: 1 }); },

  // ---------- амбиент ----------
  startAmbient() {
    if (!ctx || Snd._amb) return;
    const mk = (type, f, q, vol) => {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = vol; s.connect(fl); fl.connect(g); g.connect(ambBus); s.start();
      return { g, f: fl };
    };
    Snd._amb = { wind: mk('lowpass', 500, 0.5, 0.05), city: mk('lowpass', 180, 0.7, 0.09), rain: mk('highpass', 2500, 0.4, 0), rain2: mk('bandpass', 900, 0.5, 0), sea: mk('bandpass', 350, 0.9, 0), snow: null };
    Snd._nextBird = 3; Snd._nextGull = 8; Snd._nextDog = 30; Snd._nextShip = 60; Snd._nextCity = 20;
  },
  updateAmbient(dt, env, playerX, playerZ, inVeh, nearWater) {
    if (!ctx || !Snd._amb) return;
    const t = ctx.currentTime, a = Snd._amb;
    const wind = 0.04 + env.cloud * 0.03 + env.rain * 0.03 + env.snow * 0.02 + (nearWater ? 0.03 : 0);
    a.wind.g.gain.setTargetAtTime(wind * (inVeh ? 0.4 : 1), t, 0.6);
    a.wind.f.frequency.setTargetAtTime(350 + Math.sin(env.time * 0.3) * 150 + env.snow * 200, t, 0.5);
    a.rain.g.gain.setTargetAtTime(clamp(env.rain, 0, 1.4) * 0.09 * (inVeh ? 0.5 : 1), t, 0.6);
    a.rain2.g.gain.setTargetAtTime(clamp(env.rain, 0, 1.4) * 0.07 * (inVeh ? 0.7 : 1), t, 0.6);
    a.sea.g.gain.setTargetAtTime(nearWater * 0.07, t, 0.5);
    a.sea.f.frequency.setTargetAtTime(300 + Math.sin(env.time * 0.4) * 120, t, 0.5);
    a.city.g.gain.setTargetAtTime((0.05 + env.day01 * 0.05) * (inVeh ? 0.7 : 1), t, 1);
    // случайные события
    const day = env.day01 > 0.5 && env.rain < 0.3;
    if ((Snd._nextBird -= dt) < 0 && day && env.snowGround < 0.3) {
      Snd._nextBird = rand(2, 7); const f = rand(2500, 4200), n = 2 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) Snd.tone({ type: 'sine', f0: f * rand(0.95, 1.1), f1: f * rand(1.2, 1.5), dur: 0.08, gain: 0.05, delay: i * 0.11, bus: ambBus });
    }
    if ((Snd._nextGull -= dt) < 0) {
      Snd._nextGull = rand(6, 16);
      if (nearWater > 0.1 || Math.random() < 0.3) { for (let i = 0; i < 3; i++) Snd.tone({ type: 'sawtooth', f0: 1400, f1: 700, dur: 0.35, gain: 0.05 + nearWater * 0.06, delay: i * 0.4, bus: ambBus, vib: 40 }); }
    }
    if ((Snd._nextDog -= dt) < 0) { Snd._nextDog = rand(25, 70); for (let i = 0; i < 3; i++) { Snd.tone({ type: 'sawtooth', f0: 320, f1: 190, dur: 0.14, gain: 0.07, delay: i * 0.3, bus: ambBus }); Snd.noise({ dur: 0.1, gain: 0.05, type: 'bandpass', f0: 900, delay: i * 0.3, bus: ambBus }); } }
    if ((Snd._nextShip -= dt) < 0) { Snd._nextShip = rand(70, 160); Snd.tone({ type: 'sawtooth', f0: 95, dur: 3, gain: 0.09, attack: 0.5, bus: ambBus, curve: 1 }); Snd.tone({ type: 'square', f0: 96.5, dur: 3, gain: 0.05, attack: 0.5, bus: ambBus, curve: 1 }); }
    if (env.night > 0.6 && env.rain < 0.2 && env.snow < 0.2 && (Snd._nextCr = (Snd._nextCr || 0) - dt) < 0) { Snd._nextCr = rand(0.4, 0.8); Snd.tone({ type: 'sine', f0: 4200, dur: 0.05, gain: 0.015, bus: ambBus }); }
  },
};
Snd.onThunder = () => Snd.thunder();

// ---------- радио ----------
const STATIONS = [
  { name: 'Радио Шансон', tempo: 96 },
  { name: 'Europa Plus 2003', tempo: 138 },
  { name: 'Панк-FM', tempo: 178 },
];
export const Radio = {
  stations: STATIONS, cur: -1, step: 0, next: 0, on: false,
  set(i) {
    Radio.cur = i;
    if (!ctx) return;
    Radio.step = 0; Radio.next = ctx.currentTime + 0.1;
  },
  cycle() { Radio.set(Radio.cur >= STATIONS.length - 1 ? -1 : Radio.cur + 1); Snd.click(); return Radio.cur < 0 ? 'Радио выключено' : STATIONS[Radio.cur].name; },
  update(vol) {
    if (!ctx) return;
    musBus.gain.setTargetAtTime(vol, ctx.currentTime, 0.2);
    if (Radio.cur < 0 || vol < 0.01) return;
    const st = STATIONS[Radio.cur];
    const sd = 60 / st.tempo / 4;
    while (Radio.next < ctx.currentTime + 0.25) { Radio.play(Radio.cur, Radio.step, Radio.next, sd); Radio.step++; Radio.next += sd; }
  },
  n(type, f, t, dur, g, filt) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const gg = ctx.createGain(); gg.gain.setValueAtTime(0.0001, t); gg.gain.linearRampToValueAtTime(g, t + 0.005); gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o;
    if (filt) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = filt; o.connect(fl); out = fl; }
    out.connect(gg); gg.connect(musBus); o.start(t); o.stop(t + dur + 0.05);
  },
  nz(t, dur, g, f, type = 'highpass') {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
    const gg = ctx.createGain(); gg.gain.setValueAtTime(g, t); gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(gg); gg.connect(musBus); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  },
  kick(t, g = 0.7) { const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); const gg = ctx.createGain(); gg.gain.setValueAtTime(g, t); gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(gg); gg.connect(musBus); o.start(t); o.stop(t + 0.25); },
  play(si, step, t, sd) {
    const s16 = step % 16, bar = Math.floor(step / 16) % 8;
    const mf = (n) => 440 * Math.pow(2, (n - 69) / 12);
    if (si === 0) { // шансон: гитарный перебор Am-Dm-E-Am
      const chords = [[57, 60, 64], [62, 65, 69], [59, 64, 68], [57, 60, 64]];
      const ch = chords[bar % 4];
      const pat = [0, 2, 1, 2, 0, 2, 1, 2];
      if (s16 % 2 === 0) { const nn = ch[pat[(s16 / 2) % 8] % 3] + (s16 % 4 === 0 ? 0 : 12); Radio.n('sawtooth', mf(nn), t, 0.5, 0.15, 1800); }
      if (s16 % 8 === 0) Radio.n('triangle', mf(ch[0] - 24), t, 0.9, 0.3);
      if (s16 % 8 === 4) Radio.nz(t, 0.06, 0.06, 5000);
      if (s16 % 8 === 0) Radio.kick(t, 0.25);
    } else if (si === 1) { // евродэнс
      const roots = [45, 41, 43, 40];
      const r = roots[bar % 4];
      if (s16 % 4 === 0) Radio.kick(t, 0.6);
      if (s16 % 4 === 2) Radio.nz(t, 0.05, 0.15, 7000);
      if (s16 % 8 === 4) Radio.nz(t, 0.14, 0.25, 1800, 'bandpass');
      Radio.n('sawtooth', mf(r + (s16 % 4 === 0 ? 0 : 0)), t, sd * 0.9, s16 % 4 === 0 ? 0.0 : 0.22, 500);
      const arp = [0, 7, 12, 7, 15, 12, 7, 12];
      if (s16 % 2 === 0) { Radio.n('sawtooth', mf(r + 24 + arp[(s16 / 2) % 8]), t, sd * 1.6, 0.06, 3000); Radio.n('square', mf(r + 24.1 + arp[(s16 / 2) % 8]), t, sd * 1.6, 0.04, 3000); }
    } else { // панк
      const roots = [40, 40, 45, 43];
      const r = roots[bar % 4];
      if (s16 % 4 === 0) Radio.kick(t, 0.55);
      if (s16 % 8 === 4) Radio.nz(t, 0.12, 0.35, 1500, 'bandpass');
      if (s16 % 2 === 0) Radio.nz(t, 0.03, 0.09, 8000);
      if (s16 % 2 === 0) { Radio.n('sawtooth', mf(r + 12), t, sd * 1.8, 0.16, 1400); Radio.n('sawtooth', mf(r + 19), t, sd * 1.8, 0.12, 1400); }
    }
  },
};
