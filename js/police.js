// Милиция: уровень розыска, преследование, задержание, штраф
import { G } from './state.js';
import { City } from './city.js';
import { Snd } from './audio.js';
import { WEAPONS } from './data.js';
import { clamp, rand, chance, dist, dist2, pick } from './util.js';
import { pedLook } from './models.js';

export const Police = {
  level: 0, heat: 0, lostT: 0, seen: false, searching: false, arrestProg: 0, contactT: 0, gunT: 0, radioT: 8, lastStar: 0, patrolT: 0, crimeCool: 0,
  report(kind, x, z, sev = 1, silent = false, gunshot = false) {
    if (!G.player || G.player.dead) return;
    // свидетели
    let seen = silent;
    if (!seen) {
      for (const p of G.peds) {
        if (p.dead || p.veh) continue;
        const isCop = p.type === 'cop' || p.type === 'omon';
        const d = dist(p.x, p.z, x, z);
        const range = isCop ? 90 : gunshot ? 45 : 28;
        if (d < range) { if (isCop ? true : (gunshot ? chance(0.25) : true)) { seen = true; break; } }
      }
      if (!seen) for (const v of G.vehicles) { if (v.spec.police && dist(v.x, v.z, x, z) < 70) { seen = true; break; } }
    }
    if (!seen) return;
    if (gunshot) { if (Police.gunT > 0) return; Police.gunT = 6; }
    else if (Police.crimeCool > 0 && sev <= 1) return;
    if (!gunshot) Police.crimeCool = 1.2;
    Police.heat += sev * (gunshot ? 0.5 : 1.0);
    const target = clamp(Math.floor(Police.heat / 2.0) + 1, 1, 5);
    Police.setLevel(Math.max(Police.level, target));
    Police.lostT = 0;
  },
  setLevel(n) {
    if (n === Police.level) return;
    const up = n > Police.level;
    Police.level = n;
    if (up) { Snd.star(); G.ui && G.ui.notify(`Розыск: ${'★'.repeat(n)}`, 'wanted'); }
    if (n === 0) { Police.heat = 0; Snd.wantedLost(); G.ui && G.ui.notify('Розыск снят', 'good'); Police.releaseCops(); }
    Police.searching = false;
  },
  clear() { Police.setLevel(0); Police.heat = 0; Police.arrestProg = 0; },
  witnessCall() {},
  onGunfire(x, z, src) {
    // стрельба банд привлекает милицию (тихо: нет розыска, но патрули подтягиваются)
  },
  tryArrest(p) { Police.contactT = 0.7; },
  dismount(v) {
    if (v.dismounted) return;
    v.dismounted = true;
    const n = v.spec.police && v.specId === 'militsia2' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const type = Police.level >= 4 || v.specId === 'militsia2' ? (i === 0 ? 'cop' : 'omon') : 'cop';
      const pos = G.Veh.doorPos(v, i % 2 ? 1 : -1);
      const p = G.Peds.spawn(type, pos.x + rand(-0.5, 0.5), pos.z + rand(-0.5, 0.5), { state: 'attack' });
      p.tgt = G.player; p.keep = false;
      if (Police.level >= 4 && type === 'cop') { p.weapon = 'kedr'; p.rig.setWeapon('kedr'); }
      if (Police.level >= 5 && type === 'omon') { p.weapon = 'akm'; p.rig.setWeapon('akm'); }
      v.crew = (v.crew || []); v.crew.push(p);
    }
  },
  releaseCops() {
    for (const v of G.vehicles) if (v.spec.police && v.ai && v.ai.mode === 'police') { v.ai.mode = 'traffic'; v.siren = false; v.ai.edge = null; }
  },
  update(dt) {
    const pl = G.player;
    if (!pl) return;
    Police.gunT = Math.max(0, Police.gunT - dt); Police.crimeCool = Math.max(0, Police.crimeCool - dt);
    if (pl.dead) return;
    // видимость игрока милицией
    let seen = false;
    if (Police.level > 0) {
      for (const p of G.peds) {
        if ((p.type === 'cop' || p.type === 'omon') && !p.dead && dist2(p.x, p.z, pl.x, pl.z) < 70 * 70 && G.Peds.losClear(p.x, p.z, pl.x, pl.z)) { seen = true; break; }
      }
      if (!seen) for (const v of G.vehicles) if (v.spec.police && !v.wreck && dist2(v.x, v.z, pl.x, pl.z) < 60 * 60) { seen = true; break; }
      // свидетели-гражданские в пределах 20 м тоже «удерживают» розыск
      if (!seen) for (const p of G.peds) { if (p.type === 'civ' && !p.dead && dist2(p.x, p.z, pl.x, pl.z) < 12 * 12 && p.fear > 0) { seen = true; break; } }
    }
    Police.seen = seen;
    if (Police.level > 0) {
      if (seen) { Police.lostT = 0; Police.searching = false; }
      else {
        Police.lostT += dt; Police.searching = true;
        const need = 10 + Police.level * 4;
        if (Police.lostT > need) { Police.heat -= 2; Police.lostT = need * 0.4; if (Police.heat <= 0.01) Police.setLevel(0); else { const nl = clamp(Math.floor(Police.heat / 2) + 1, 1, 5); if (nl < Police.level) Police.level = nl; } }
      }
      // радио
      Police.radioT -= dt; if (Police.radioT < 0) { Police.radioT = rand(6, 12); Snd.radioChatter(); }
      // подкрепление
      Police.spawnTimer = (Police.spawnTimer || 0) - dt;
      if (Police.spawnTimer <= 0) {
        Police.spawnTimer = 1.5;
        const want = Math.min(8, Police.level * 2);
        let n = 0; for (const v of G.vehicles) if (v.spec.police && v.ai && v.ai.mode === 'police' && !v.wreck) n++;
        if (n < want) Police.spawnCar();
      }
      // задержание
      let near = 0;
      if (pl.veh) { if (Math.abs(pl.veh.speed) < 2.5) near = 0; }
      for (const p of G.peds) { if (p.type === 'cop' && !p.dead && Police.level <= 2 && dist2(p.x, p.z, pl.x, pl.z) < 1.9 * 1.9 && !pl.veh) near++; }
      if (pl.veh && Math.abs(pl.veh.speed) < 3 && Police.level <= 2) for (const p of G.peds) { if (p.type === 'cop' && !p.dead && dist2(p.x, p.z, pl.x, pl.z) < 3.2 * 3.2) near++; }
      if (near > 0 && !pl.dead) Police.arrestProg += dt * 0.45 * Math.min(near, 2); else Police.arrestProg = Math.max(0, Police.arrestProg - dt * 0.6);
      if (Police.arrestProg >= 1) Police.busted();
    } else {
      Police.arrestProg = 0;
      // патрули при нулевом розыске
      Police.patrolT -= dt;
      if (Police.patrolT <= 0) {
        Police.patrolT = 2;
        let n = 0; for (const p of G.peds) if (p.type === 'cop' && !p.dead) n++;
        const want = G.quality === 'low' ? 1 : 3;
        if (n < want && (!G.env || G.env.night < 0.9)) Police.spawnPatrol();
        let cars = 0; for (const v of G.vehicles) if (v.spec.police && v.ai && v.ai.mode === 'traffic') cars++;
        if (cars < 2) Police.spawnPatrolCar();
      }
    }
  },
  spawnPatrol() {
    const pl = G.player;
    const p = G.Peds.spawnCivil({ x: pl.x, z: pl.z }, 70, 150);
    if (!p) return;
    // превращаем в милиционера: удаляем и создаём заново
    const { x, z, nav } = p;
    G.Peds.remove(p);
    const c = G.Peds.spawn('cop', x, z);
    c.nav = nav; c.state = 'walk';
  },
  spawnPatrolCar() {
    const pl = G.player;
    const v = G.Veh.spawnTraffic({ x: pl.x, z: pl.z }, 100, 230);
    if (!v) return;
    G.Veh.remove(v);
    const c = G.Veh.spawn(pick(['militsia', 'militsia', 'militsia2']), v.x, v.z, v.heading, { driver: true, ai: 'traffic' });
    G.Veh.assignEdge(c, v.ai.edge, v.ai.s);
    c.driverLook = pedLook('cop');
  },
  spawnCar() {
    const pl = G.player;
    const id = Police.level >= 4 && chance(0.6) ? 'militsia2' : pick(['militsia', 'militsia', 'militsia2']);
    const pt = City.randomRoadPoint({ x: pl.x, z: pl.z }, 110, 220);
    if (!pt) return;
    let busy = false;
    G.Veh.grid.near(pt.x, pt.z, 10, (o) => { if (dist2(o.x, o.z, pt.x, pt.z) < 80) { busy = true; return false; } });
    if (busy) return;
    const h = Math.atan2(pt.e.dx, pt.e.dz);
    const v = G.Veh.spawn(id, pt.x, pt.z, h, { driver: true, ai: 'police' });
    v.siren = true; v.speed = 12; v.vx = Math.sin(h) * 12; v.vz = Math.cos(h) * 12;
    Snd.radioChatter();
  },
  busted() {
    if (G.player.dead || G.player.busted_) return;
    G.player.onBusted();
  },
};
G.police = Police;
void WEAPONS;
