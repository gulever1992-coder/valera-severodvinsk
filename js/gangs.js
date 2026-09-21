// Банды и районы: владение территорией, войны за районы, точки сбора банд, союзники игрока
import { G } from './state.js';
import { City } from './city.js';
import { GANGS, GANG_IDS } from './data.js';
import { Snd } from './audio.js';
import { clamp, rand, randi, pick, chance, dist, dist2 } from './util.js';

export const Gangs = {
  heat: { salt: 0, punk: 0, gop: 0, rus: 0 },
  sites: [],
  district: null,
  allyT: 5, rivalT: 100, incomeT: 60, warSpawnT: 3,
  init() {
    for (const d of City.districts) { d.strength = 100; d.war = false; d.lastKill = -999; d.def = null; }
    G.districts = City.districts;
    // точки сбора
    for (const d of City.districts) {
      let tries = 0, made = 0;
      while (made < 3 && tries++ < 200) {
        const e = City.graph.edges[(Math.random() * City.graph.edges.length) | 0];
        if (e.road.ring) continue;
        const s = rand(0, e.len), side = chance(0.5) ? 1 : -1, off = side * (e.w / 2 + 2.6);
        const x = e.a.x + e.dx * s + -e.dz * off, z = e.a.z + e.dz * s + e.dx * off;
        if (City.isWater(x, z) || City.districtAt(x, z) !== d) continue;
        if (G.combat && false) continue;
        Gangs.sites.push({ x, z, d, members: [], size: randi(2, 3), face: Math.atan2(-e.dz * -side, e.dx * -side), cool: 0 });
        made++;
      }
    }
  },
  ownerName(d) { return d.owner === 'valera' ? 'Пацаны Валеры' : GANGS[d.owner].name; },
  hostile(p) {
    const g = p.gang;
    if (!g || g === 'valera' || g === 'cop') return false;
    const d = City.districtAt(p.x, p.z);
    if (d.war && d.owner === g) return true;
    return Gangs.heat[g] > 1.0;
  },
  provoke(g, amt) {
    if (!(g in Gangs.heat)) return;
    Gangs.heat[g] = clamp(Gangs.heat[g] + amt, 0, 4);
    // тревожим ближайших
    if (amt >= 0.5) for (const p of G.peds) if (p.gang === g && !p.dead) p.alert = 6;
  },
  onKill(p, notByPlayer) {
    const g = p.gang;
    if (!g || g === 'cop' || g === 'valera') return;
    if (notByPlayer) return;
    Gangs.provoke(g, 0.6);
    const d = City.districtAt(p.x, p.z);
    if (d.owner === g) {
      if (!d.war) { d.war = true; d.warStart = G.time; G.ui && G.ui.notify(`Война за район «${d.name}»! ${GANGS[g].name} зовут своих`, 'war'); Snd.star(); }
      d.strength -= 100 / (5 + d.level * 1.5);
      d.lastKill = G.time;
      G.ui && G.ui.floatText(`Район «${d.name}»: ${Math.max(0, Math.round(d.strength))}%`);
      if (d.strength <= 0) Gangs.capture(d, 'valera');
    }
  },
  capture(d, newOwner, silent) {
    const old = d.owner;
    d.owner = newOwner; d.strength = 100; d.war = false;
    // распускаем старую банду в районе
    for (const s of Gangs.sites) if (s.d === d) { for (const m of s.members.slice()) { m.hangSite = null; m.state = 'walk'; } s.members = []; s.cool = 20; }
    if (newOwner === 'valera') {
      G.stats.districts++;
      Snd.captured();
      G.ui && G.ui.banner('РАЙОН ЗАХВАЧЕН', d.name);
      G.money += 300 * d.level; G.ui && G.ui.floatText(`+${300 * d.level} ₽`);
      if (G.story) G.story.onCapture && G.story.onCapture(d);
    } else if (!silent) {
      G.ui && G.ui.notify(`${GANGS[newOwner].name} захватили район «${d.name}» (было: ${old === 'valera' ? 'ваш' : GANGS[old].name})`, 'war');
    }
  },
  ownedCount() { return City.districts.filter((d) => d.owner === 'valera').length; },
  update(dt) {
    const pl = G.player;
    if (!pl) return;
    G.time; // нужен для меток
    for (const g of GANG_IDS) Gangs.heat[g] = Math.max(0, Gangs.heat[g] - dt * 0.012);
    Gangs.district = City.districtAt(pl.x, pl.z);
    // война: затухание
    for (const d of City.districts) {
      if (d.war) {
        if (G.time - d.lastKill > 90 && dist(pl.x, pl.z, d.pos[0], d.pos[1]) > 150) { d.war = false; d.strength = Math.min(100, d.strength + 30); }
        // подкрепления
        if (Gangs.district === d) {
          Gangs.warSpawnT -= dt;
          if (Gangs.warSpawnT <= 0) {
            Gangs.warSpawnT = rand(3.5, 6);
            let alive = 0; for (const p of G.peds) if (p.gang === d.owner && !p.dead && p.hostile) alive++;
            if (alive < 3 + d.level) Gangs.spawnDefender(d);
          }
        }
      }
    }
    // точки сбора
    const q = G.quality === 'low' ? 0.6 : 1;
    for (const s of Gangs.sites) {
      s.cool -= dt;
      const dd = dist2(pl.x, pl.z, s.x, s.z);
      if (dd > 150 * 150 || dd < 28 * 28) continue;
      s.members = s.members.filter((m) => !m.dead);
      if (s.members.length < Math.round(s.size * q) && s.cool <= 0) {
        s.cool = rand(6, 14);
        if (G.camFwd) { const dx = s.x - G.cam.x, dz = s.z - G.cam.z, d = Math.hypot(dx, dz); if (d < 70 && (dx * G.camFwd.x + dz * G.camFwd.z) / d > 0.3) continue; }
        const type = s.d.owner === 'valera' ? 'ally' : s.d.owner;
        const p = G.Peds.spawn(type, s.x + rand(-1.8, 1.8), s.z + rand(-1.8, 1.8), { state: 'hang' });
        p.hangSite = s; s.members.push(p);
        if (type === 'ally') p.state = 'hang';
      }
    }
    // союзники
    Gangs.allyT -= dt;
    if (Gangs.allyT <= 0) {
      Gangs.allyT = 6;
      const want = Math.min(3, Gangs.ownedCount() - 1);
      let n = 0; for (const p of G.peds) if (p.type === 'ally' && !p.dead && p.state !== 'hang') n++;
      if (n < want && G.story && G.story.crewEnabled) {
        const p = G.Peds.spawn('ally', pl.x + rand(-6, 6), pl.z + rand(-6, 6), { state: 'follow' }); p.keep = true;
      }
    }
    // доход
    Gangs.incomeT -= dt;
    if (Gangs.incomeT <= 0) {
      Gangs.incomeT = 90;
      const inc = City.districts.filter((d) => d.owner === 'valera' && d.id !== 'home').reduce((a, d) => a + d.level * 120, 0);
      if (inc > 0) { G.money += inc; G.ui && G.ui.notify(`Дань с районов: +${inc} ₽`, 'good'); Snd.cash(); }
    }
    // борьба банд за районы
    Gangs.rivalT -= dt;
    if (Gangs.rivalT <= 0) { Gangs.rivalT = rand(110, 200); Gangs.rivalMove(); }
    // защита своего района
    if (Gangs.defense) Gangs.updateDefense(dt);
  },
  spawnDefender(d) {
    const pl = G.player;
    const ang = rand(0, 6.28), r = rand(28, 45);
    const x = pl.x + Math.cos(ang) * r, z = pl.z + Math.sin(ang) * r;
    if (City.isWater(x, z) || City.districtAt(x, z) !== d) return;
    const near = City.nearestRoad(x, z, 30);
    if (!near) return;
    const p = G.Peds.spawn(d.owner, x, z, { state: 'attack' });
    p.tgt = pl; p.hostile = true; p.warTgt = false;
    Snd.voice(x, z, p.voice);
  },
  rivalMove() {
    // случайная банда пытается отобрать район у соседа
    const ds = City.districts.filter((d) => d.id !== 'home');
    const target = pick(ds);
    const nb = City.districts.slice().sort((a, b) => dist2(a.pos[0], a.pos[1], target.pos[0], target.pos[1]) - dist2(b.pos[0], b.pos[1], target.pos[0], target.pos[1]))[1];
    if (!nb || nb.owner === target.owner || nb.owner === 'valera') return;
    if (target.owner === 'valera') { Gangs.startDefense(target, nb.owner); return; }
    if (chance(0.5)) Gangs.capture(target, nb.owner);
  },
  startDefense(d, gang) {
    if (Gangs.defense) return;
    Gangs.defense = { d, gang, t: 150, spawned: false };
    G.ui && G.ui.notify(`${GANGS[gang].name} атакуют ваш район «${d.name}»! Отбейте нападение!`, 'war');
    Snd.star();
  },
  updateDefense(dt) {
    const df = Gangs.defense, pl = G.player;
    df.t -= dt;
    const near = dist(pl.x, pl.z, df.d.pos[0], df.d.pos[1]) < 120;
    if (near && !df.spawned) {
      df.spawned = true;
      for (let i = 0; i < 5; i++) {
        const ang = rand(0, 6.28), r = rand(20, 40);
        const x = df.d.pos[0] + Math.cos(ang) * r, z = df.d.pos[1] + Math.sin(ang) * r;
        if (City.isWater(x, z)) continue;
        const p = G.Peds.spawn(df.gang, x, z, { state: 'attack' }); p.tgt = pl; p.hostile = true; p.keep = true; p.defenseFor = df;
      }
    }
    let alive = 0; for (const p of G.peds) if (p.defenseFor === df && !p.dead) alive++;
    if (df.spawned && alive === 0) { G.ui && G.ui.banner('РАЙОН ЗАЩИЩЁН', df.d.name); Snd.captured(); G.money += 400; Gangs.defense = null; return; }
    if (df.t <= 0) {
      Gangs.defense = null;
      if (!df.spawned || alive > 0) { Gangs.capture(df.d, df.gang); G.ui && G.ui.notify(`Вы потеряли район «${df.d.name}»`, 'war'); }
    }
  },
  save() { return { heat: Gangs.heat, owners: City.districts.map((d) => [d.id, d.owner]) }; },
  load(o) { if (!o) return; Object.assign(Gangs.heat, o.heat || {}); (o.owners || []).forEach(([id, ow]) => { const d = City.districts.find((x) => x.id === id); if (d) d.owner = ow; }); },
};
G.gangs = Gangs;
