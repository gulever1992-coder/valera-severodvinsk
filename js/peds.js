// Пешеходы, банды, милиционеры, союзники — ИИ, реакции на насилие, дроп денег
import * as THREE from 'three';
import { G } from './state.js';
import { City } from './city.js';
import { GANGS, WEAPONS } from './data.js';
import { Rig, pedLook, makePedGeoms, pedMaterial } from './models.js';
import { Snd } from './audio.js';
import { FX } from './fx.js';
import {
  clamp, lerp, rand, randi, pick, chance, angNorm, angDiff, dist, dist2, damp, resolveCircle, rayObst, DynGrid, Obst, TAU,
} from './util.js';

let idc = 1;
const geoCache = new Map();
function geomsFor(type, variant, look) {
  const key = type + variant;
  let g = geoCache.get(key);
  if (!g) { g = { geoms: makePedGeoms(look), look }; geoCache.set(key, g); }
  return g;
}

const BASE = {
  civ: { hp: 60, walk: 1.35, run: 4.6 }, salt: { hp: 80, walk: 1.6, run: 4.2 }, punk: { hp: 90, walk: 1.5, run: 4.6 }, gop: { hp: 100, walk: 1.5, run: 4.8 },
  rus: { hp: 130, walk: 1.4, run: 4.4 }, cop: { hp: 110, walk: 1.5, run: 5.2 }, omon: { hp: 200, walk: 1.5, run: 4.8 }, ally: { hp: 130, walk: 1.5, run: 5.0 },
};
const GANG_WEAPONS = {
  salt: [['knife', 0.5], ['bat', 0.3], [null, 0.2]],
  punk: [['bat', 0.4], ['knife', 0.3], ['pm', 0.3]],
  gop: [[null, 0.4], ['bat', 0.3], ['knife', 0.2], ['pm', 0.1]],
  rus: [['pm', 0.4], ['obrez', 0.2], ['kedr', 0.25], ['mr153', 0.15]],
  cop: [['pm', 1]], omon: [['kedr', 0.5], ['akm', 0.5]], ally: [['pm', 0.4], ['bat', 0.4], ['obrez', 0.2]],
};
function pickWeapon(t) { const l = GANG_WEAPONS[t]; if (!l) return null; let r = Math.random(); for (const [w, p] of l) { r -= p; if (r <= 0) return w; } return null; }

export const Peds = {
  list: G.peds,
  grid: new DynGrid(16),
  pickups: [],
  wantCivs: 26,
  spawn(type, x, z, opts = {}) {
    let variant = opts.variant;
    let look;
    if (type === 'civ') {
      const kind = opts.kind || (chance(0.08) ? 'old' : chance(0.42) ? 'woman' : 'default');
      variant = kind + ((Math.random() * 10) | 0);
      let cg = geoCache.get('civ' + variant);
      if (!cg) { look = pedLook(kind); cg = geomsFor('civ', variant, look); }
      look = cg.look;
    } else {
      variant = type + ((Math.random() * 3) | 0);
      let cg = geoCache.get(type + variant);
      if (!cg) { look = pedLook(type === 'civ' ? 'default' : type); cg = geomsFor(type, variant, look); }
      look = cg.look;
    }
    const g = geoCache.get((type === 'civ' ? 'civ' : type) + variant);
    const rig = new Rig(look, { geoms: g.geoms });
    const b = BASE[type] || BASE.civ;
    const p = {
      id: idc++, type, look, rig, x, z, heading: rand(0, TAU), vx: 0, vz: 0, hp: b.hp, maxHp: b.hp, dead: false, deadT: 0, down: 0, downT: 0,
      state: 'walk', speed: 0, walk: b.walk * rand(0.85, 1.15), run: b.run * rand(0.9, 1.1), think: rand(0, 0.3), fear: 0, fearSrc: null,
      gang: look.gang || null, weapon: opts.weapon !== undefined ? opts.weapon : (type === 'civ' ? null : pickWeapon(type)), tgt: null, atkT: rand(0.3, 1), nav: null,
      crouch: 0, aim: 0, punchT: 0, hostile: false, alert: 0, bubble: null, bubbleT: 0, sayT: rand(4, 12), stuck: 0, cash: type === 'civ' ? randi(20, 250) : randi(50, 600),
      home: opts.home || null, veh: null, warTgt: null, lastHitBy: null, hangSite: null, squatT: 0, phone: 0, sp: 0, group: opts.group || null,
      voice: rand(0.8, 1.3), ammo: 999, reloadT: 0, burst: 0, fov: 0,
    };
    p.rig.root.position.set(x, 0, z);
    p.rig.setWeapon(p.weapon);
    G.scene.add(p.rig.root);
    if (opts.state) p.state = opts.state;
    if (type === 'civ' && chance(0.06)) p.phone = 1;
    Peds.list.push(p);
    return p;
  },
  remove(p) {
    const i = Peds.list.indexOf(p);
    if (i >= 0) Peds.list.splice(i, 1);
    G.scene.remove(p.rig.root);
    if (p.hangSite) p.hangSite.members = p.hangSite.members.filter((m) => m !== p);
    if (G.gangs) G.gangs.onRemove && G.gangs.onRemove(p);
  },
  hostileTo(p, q) { return false; },

  // ---------- урон ----------
  hurt(p, dmg, src, dir, head) {
    if (p.dead) return;
    if (head) dmg *= 2.2;
    p.hp -= dmg;
    p.lastHitBy = src;
    FX.blood(p.x, 1.2 + (head ? 0.4 : 0), p.z, 5 + Math.min(10, dmg / 6 | 0), dir ? dir.x * 0.4 : 0, dir ? dir.z * 0.4 : 0);
    Snd.grunt(p.x, p.z, p.voice);
    p.alert = 6;
    if (src === 'player' || (src && src.kind === 'player')) Peds.provoke(p);
    if (p.hp <= 0) Peds.kill(p, src, head);
    else if (p.type === 'civ') { p.fear = 10; p.fearSrc = G.player; if (chance(0.5)) Snd.scream(p.x, p.z, p.voice); }
    if (dir && p.hp > 0 && dmg > 20) { p.vx += dir.x * 2; p.vz += dir.z * 2; }
  },
  kill(p, src, head) {
    p.dead = true; p.deadT = 0; p.hp = 0; p.state = 'dead';
    Snd.death(p.x, p.z, p.voice);
    if (p.weapon) Peds.drop('weapon', p.x, p.z, p.weapon);
    if (chance(p.type === 'civ' ? 0.55 : 0.8)) Peds.drop('cash', p.x + rand(-0.4, 0.4), p.z + rand(-0.4, 0.4), p.cash);
    const byPlayer = src === 'player' || (src && src.kind === 'player');
    if (byPlayer) {
      G.stats.kills++;
      if (G.police) G.police.report(p.type === 'cop' || p.type === 'omon' ? 'copkill' : p.type === 'civ' ? 'murder' : 'kill', p.x, p.z, p.type === 'cop' || p.type === 'omon' ? 3 : p.type === 'civ' ? 2 : 1);
      if (G.gangs) G.gangs.onKill(p);
      if (G.story) G.story.onKill && G.story.onKill(p);
      if (G.player && G.player.addExp) G.player.addExp(p.type === 'civ' ? 2 : 6);
    }
    if (G.gangs && !byPlayer) G.gangs.onKill(p, true);
    Peds.noise(p.x, p.z, 25, 'death', p);
    if (p.veh) { p.veh = null; }
    p.rig.setWeapon(null);
  },
  provoke(p) {
    if (p.gang && p.gang !== 'valera' && p.gang !== 'cop') { if (G.gangs) G.gangs.provoke(p.gang, 1); }
    if (p.type === 'civ') { p.fear = 12; p.fearSrc = G.player; }
    if (p.type === 'cop' || p.type === 'omon') { if (G.police) G.police.report('assault', p.x, p.z, 2, true); }
  },
  drop(kind, x, z, val) {
    const geo = kind === 'cash' ? new THREE.BoxGeometry(0.28, 0.04, 0.16) : new THREE.BoxGeometry(0.4, 0.08, 0.15);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: kind === 'cash' ? 0x66dd66 : kind === 'health' ? 0xff4466 : 0xdddd66 }));
    m.position.set(x, 0.3, z); G.scene.add(m);
    Peds.pickups.push({ kind, x, z, val, mesh: m, t: 0 });
  },
  // шум: реакция ближайших
  noise(x, z, r, type, src) {
    Peds.grid.near(x, z, r, (p) => {
      if (p.dead || p === src) return;
      const d = dist(p.x, p.z, x, z);
      if (d > r) return;
      if (p.type === 'civ') { if (type === 'shot' || type === 'boom' || type === 'death' || type === 'fight') { p.fear = Math.max(p.fear, type === 'fight' ? 5 : 10); p.fearSrc = { x, z }; if (chance(0.3)) Snd.scream(p.x, p.z, p.voice); if (chance(0.25) && G.police) G.police.witnessCall && G.police.witnessCall(p); } }
      else if (p.gang && type === 'shot' && p.gang !== 'valera') p.alert = Math.max(p.alert, 3);
    });
  },
  // ---------- спавн ----------
  spawnCivil(near, minR, maxR) {
    const pt = City.randomRoadPoint(near, minR, maxR, 0);
    if (!pt) return null;
    const e = pt.e;
    if (e.road.ring) return null;
    const side = chance(0.5) ? 1 : -1;
    const off = side * (e.w / 2 + 1.7 + rand(0, 1.2));
    const x = e.a.x + e.dx * pt.s + -e.dz * off, z = e.a.z + e.dz * pt.s + e.dx * off;
    if (City.isWater(x, z)) return null;
    const r = resolveCircle(x, z, 0.5, { x: 0, z: 0 });
    if (r.hit) return null;
    if (G.camFwd) { const dx = x - G.cam.x, dz = z - G.cam.z, d = Math.hypot(dx, dz); if (d < 90 && d > 1 && (dx * G.camFwd.x + dz * G.camFwd.z) / d > 0.35) return null; }
    const p = Peds.spawn('civ', x, z);
    p.nav = { e, s: pt.s, side, off };
    p.heading = Math.atan2(e.dx, e.dz);
    return p;
  },
  pickNavNext(p) {
    const n = p.nav; const e = n.e;
    const node = e.b;
    const cands = node.out.filter((o) => o !== e.rev || node.out.length === 1);
    let ne = cands.length ? pick(cands) : e.rev;
    if (!ne) return false;
    // иногда переходим на другую сторону улицы
    if (chance(0.3)) n.side = -n.side;
    // ходим против направления ребра для рёбер, конец которых — конец города
    n.e = ne; n.s = 0; n.off = n.side * (ne.w / 2 + 1.7);
    return true;
  },

  // ---------- ИИ ----------
  isHostileToPlayer(p) {
    if (p.type === 'cop' || p.type === 'omon') return G.police && G.police.level > 0;
    if (p.type === 'ally') return false;
    if (!p.gang) return false;
    return G.gangs ? G.gangs.hostile(p) : false;
  },
  nearestEnemy(p, r) {
    // цели для союзников и для войн банд
    let best = null, bd = r * r;
    Peds.grid.near(p.x, p.z, r, (q) => {
      if (q === p || q.dead) return;
      let foe = false;
      if (p.type === 'ally') foe = q.gang && q.gang !== 'valera' && q.hostile;
      else if (p.warTgt) foe = q.gang && q.gang !== p.gang && q.type !== 'civ' && q.type !== 'cop';
      if (!foe) return;
      const d = dist2(p.x, p.z, q.x, q.z);
      if (d < bd) { bd = d; best = q; }
    });
    return best;
  },
  losClear(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 0.5) return true;
    return !rayObst(ax, az, dx / d, dz / d, d, 2.2);
  },
  think(p, dt) {
    const pl = G.player;
    const dp = pl ? dist(p.x, p.z, pl.x, pl.z) : 999;
    p.hostile = Peds.isHostileToPlayer(p) && pl && !pl.dead;
    if (p.fear > 0) p.fear -= 0.25;
    // союзники
    if (p.type === 'ally') {
      if (!p.tgt || p.tgt.dead) p.tgt = Peds.nearestEnemy(p, 30);
      if (p.tgt) { p.state = 'attack'; return; }
      p.state = dp > 5 ? 'follow' : 'idle';
      return;
    }
    if (p.type === 'cop' || p.type === 'omon') {
      if (G.police && G.police.level > 0 && pl && !pl.dead) { p.tgt = pl; p.state = 'attack'; return; }
      if (p.state === 'attack') { p.state = 'walk'; p.tgt = null; }
      if (p.state !== 'walk' && p.state !== 'idle') p.state = 'walk';
      if (!p.nav) Peds.attachNav(p);
      return;
    }
    if (p.type === 'civ') {
      if (p.fear > 0) { p.state = p.fearSrc && p.fear > 6 && chance(0.15) ? 'cower' : (p.state === 'cower' && p.fear > 1 ? 'cower' : 'flee'); if (p.state === 'cower' && p.fear < 3) p.state = 'flee'; }
      else if (p.state === 'flee' || p.state === 'cower') { p.state = 'walk'; if (!p.nav) Peds.attachNav(p); }
      return;
    }
    // банды
    if (p.hostile && dp < 60) { p.tgt = pl; p.state = 'attack'; return; }
    if (p.warTgt) {
      if (!p.tgt || p.tgt.dead) p.tgt = Peds.nearestEnemy(p, 40);
      if (p.tgt) { p.state = 'attack'; return; }
    }
    if (p.state === 'attack') { p.state = p.hangSite ? 'hang' : 'walk'; p.tgt = null; }
    if (p.alert > 0) { p.alert -= 0.25; }
    if (p.state === 'walk' && !p.nav) Peds.attachNav(p);
  },
  attachNav(p) {
    const ne = G.Veh.nearestEdge(p.x, p.z);
    if (!ne) return;
    const e = ne.e;
    const side = ((p.x - e.a.x) * -e.dz + (p.z - e.a.z) * e.dx) >= 0 ? 1 : -1;
    p.nav = { e, s: ne.s, side, off: side * (e.w / 2 + 1.7) };
  },
  move(p, dt, dirx, dirz, spd) {
    // ускорение к желаемой скорости
    const tvx = dirx * spd, tvz = dirz * spd;
    const k = 1 - Math.exp(-10 * dt);
    p.vx += (tvx - p.vx) * k; p.vz += (tvz - p.vz) * k;
  },
  faceTo(p, ang, dt, rate = 10) { p.heading += angDiff(p.heading, ang) * (1 - Math.exp(-rate * dt)); },
  update(dt) {
    const g = Peds.grid; g.clear();
    for (const p of Peds.list) g.add(p, p.x, p.z);
    G.pedGrid = g;
    const pl = G.player, cam = G.cam;
    for (let i = Peds.list.length - 1; i >= 0; i--) {
      const p = Peds.list[i];
      const dc = cam ? dist2(p.x, p.z, cam.x, cam.z) : 0;
      if (p.dead) {
        p.deadT += dt;
        p.rig.update(dt, { dead: Math.min(1, p.deadT * 3), speed: 0 });
        p.rig.root.position.set(p.x, p.deadT > 40 ? -(p.deadT - 40) * 0.1 : 0, p.z);
        p.rig.root.rotation.y = p.heading;
        if (p.deadT > 55 || (pl && dist2(p.x, p.z, pl.x, pl.z) > 300 * 300)) Peds.remove(p);
        continue;
      }
      if (p.veh) continue;
      // далеко — удаляем
      if (pl && dist2(p.x, p.z, pl.x, pl.z) > 240 * 240 && !p.keep) { Peds.remove(p); continue; }
      Peds.tick(p, dt, dc);
    }
    // подбираемые предметы
    for (let i = Peds.pickups.length - 1; i >= 0; i--) {
      const it = Peds.pickups[i];
      it.t += dt; it.mesh.rotation.y += dt * 2; it.mesh.position.y = 0.35 + Math.sin(it.t * 3) * 0.06;
      if (pl && !pl.dead && !pl.veh && dist2(pl.x, pl.z, it.x, it.z) < 1.6 * 1.6) {
        if (it.kind === 'cash') { G.money += it.val; Snd.pickup(); G.ui && G.ui.floatText(`+${it.val} ₽`); }
        else if (it.kind === 'weapon') { pl.giveWeapon(it.val, true); Snd.pickup(); G.ui && G.ui.floatText(`Подобрано: ${WEAPONS[it.val].name}`); }
        else if (it.kind === 'health') { pl.heal(it.val); Snd.pickup(); }
        G.scene.remove(it.mesh); Peds.pickups.splice(i, 1);
      } else if (it.t > 120 || (cam && dist2(it.x, it.z, cam.x, cam.z) > 300 * 300)) { G.scene.remove(it.mesh); Peds.pickups.splice(i, 1); }
    }
  },
  tick(p, dt, dc) {
    const pl = G.player;
    if (p.down > 0) {
      p.down -= dt;
      p.rig.update(dt, { dead: Math.min(1, (2 - Math.max(0, p.down)) * 3, p.down * 3 + 0.2), speed: 0 });
      p.vx *= 0.9; p.vz *= 0.9;
      Peds.integrate(p, dt);
      p.rig.root.position.set(p.x, 0, p.z); p.rig.root.rotation.y = p.heading;
      return;
    }
    p.think -= dt;
    if (p.think <= 0) { p.think = rand(0.18, 0.35); Peds.think(p, dt); }
    let spd = 0, dirx = 0, dirz = 0;
    let moving = false;
    const st = p.state;
    p.aim = damp(p.aim, 0, 6, dt);
    p.crouch = damp(p.crouch, 0, 6, dt);
    p.squatT = damp(p.squatT, 0, 4, dt);
    p.atkT -= dt;
    if (p.punchT > 0) p.punchT = Math.max(0, p.punchT - dt * 2.8);
    if (st === 'walk' && p.nav) {
      const n = p.nav, e = n.e;
      const s = n.s;
      const ts = Math.min(e.len, s + 2.5);
      const tx = e.a.x + e.dx * ts + -e.dz * n.off, tz = e.a.z + e.dz * ts + e.dx * n.off;
      let dx = tx - p.x, dz = tz - p.z; const d = Math.hypot(dx, dz) || 1;
      dirx = dx / d; dirz = dz / d; spd = p.walk; moving = true;
      // прогресс по ребру
      const prog = (p.x - e.a.x) * e.dx + (p.z - e.a.z) * e.dz;
      n.s = clamp(prog, 0, e.len);
      if (n.s > e.len - 1.5) { if (!Peds.pickNavNext(p)) p.state = 'idle'; }
      // остановка возле игрока с оружием — реакция
      if (pl && !pl.dead && pl.aiming && p.type === 'civ' && dist2(p.x, p.z, pl.x, pl.z) < 12 * 12 && p.look.face !== undefined) { p.fear = Math.max(p.fear, 4); p.fearSrc = pl; }
      // болтовня
      p.sayT -= dt;
      if (p.sayT < 0) { p.sayT = rand(8, 24); if (p.type === 'civ' && chance(0.3) && dc < 25 * 25) Snd.voice(p.x, p.z, p.voice); }
    } else if (st === 'flee' || st === 'cower') {
      const src = p.fearSrc || pl;
      if (st === 'cower') { p.crouch = 1; spd = 0; p.aim = 0; }
      else if (src) {
        let dx = p.x - src.x, dz = p.z - src.z; const d = Math.hypot(dx, dz) || 1;
        dirx = dx / d; dirz = dz / d; spd = p.run; moving = true;
        // избегаем стен: слегка поворачиваем
        const hit = rayObst(p.x, p.z, dirx, dirz, 3, 1.5);
        if (hit) { const a = Math.atan2(dirx, dirz) + (p.id % 2 ? 1.2 : -1.2); dirx = Math.sin(a); dirz = Math.cos(a); }
      }
    } else if (st === 'attack' && p.tgt) {
      const t = p.tgt;
      const tx = t.x, tz = t.z;
      const dx = tx - p.x, dz = tz - p.z; const d = Math.hypot(dx, dz) || 1;
      const ranged = p.weapon && WEAPONS[p.weapon] && !WEAPONS[p.weapon].melee && !WEAPONS[p.weapon].thrown;
      const isCop = p.type === 'cop';
      const arrest = isCop && G.police && G.police.level <= 1 && !ranged;
      const want = ranged && !(isCop && G.police.level <= 1) ? (p.type === 'omon' ? 12 : 9) : 1.15;
      const wp = p.weapon ? WEAPONS[p.weapon] : null;
      if (ranged && !(isCop && G.police && G.police.level <= 1)) {
        // держим дистанцию, стреляем
        if (d > want + 3) { dirx = dx / d; dirz = dz / d; spd = p.run; moving = true; }
        else if (d < want - 3) { dirx = -dx / d; dirz = -dz / d; spd = p.walk * 1.2; moving = true; }
        else { const a = Math.atan2(dx, dz) + Math.PI / 2 * (p.id % 2 ? 1 : -1); dirx = Math.sin(a) * 0.6; dirz = Math.cos(a) * 0.6; spd = p.walk * 0.7; moving = true; }
        Peds.faceTo(p, Math.atan2(dx, dz), dt, 14);
        p.aim = damp(p.aim, 1, 10, dt);
        if (d < wp.range && p.atkT <= 0 && Math.abs(angDiff(p.heading, Math.atan2(dx, dz))) < 0.35 && Peds.losClear(p.x, p.z, tx, tz)) {
          p.atkT = wp.rate * rand(1.4, 2.6) + (wp.auto ? 0.5 : 0);
          if (wp.auto) { p.burst = randi(2, 5); }
          G.combat.npcFire(p, t);
        }
        if (p.burst > 0 && p.atkT < wp.rate * 1.3) { p.burst--; p.atkT = wp.rate; G.combat.npcFire(p, t); }
      } else {
        // ближний бой или арест
        if (d > want) { dirx = dx / d; dirz = dz / d; spd = p.run * (arrest ? 0.95 : 1); moving = true; }
        Peds.faceTo(p, Math.atan2(dx, dz), dt, 14);
        if (d < want + 0.35 && p.atkT <= 0) {
          p.atkT = p.weapon ? (WEAPONS[p.weapon].rate || 0.8) * 1.4 : 0.9;
          p.punchT = 0.01 + 0.99; p.melee = !!p.weapon && !!WEAPONS[p.weapon] && WEAPONS[p.weapon].melee;
          G.combat.npcMelee(p, t, arrest);
        }
      }
      // союзник не должен упасть при большой дистанции
      if (p.type === 'ally' && d > 40) { p.tgt = null; }
    } else if (st === 'follow' && pl) {
      const dx = pl.x - p.x, dz = pl.z - p.z; const d = Math.hypot(dx, dz) || 1;
      dirx = dx / d; dirz = dz / d; spd = d > 14 ? p.run : p.walk; moving = true;
      if (d > 70 && (!G.camFwd || dist2(p.x, p.z, G.cam.x, G.cam.z) > 60 * 60)) { p.x = pl.x + rand(-4, 4); p.z = pl.z + rand(-4, 4); }
    } else if (st === 'hang') {
      // ждёт на месте; гопники присаживаются на корточки
      p.squatT = damp(p.squatT, p.look.squat ? 1 : 0, 3, dt);
      p.sayT -= dt;
      if (p.hangSite) Peds.faceTo(p, p.hangSite.face + (p.id % 3 - 1) * 0.6, dt, 2);
      if (p.sayT < 0 && pl && dist2(p.x, p.z, pl.x, pl.z) < 14 * 14) { p.sayT = rand(6, 14); const G_ = GANGS[p.gang]; if (G_ && G_.shout && G.ui) G.ui.say(p, pick(G_.shout)); Snd.voice(p.x, p.z, p.voice); }
      if (p.alert > 0 && pl && dist2(p.x, p.z, pl.x, pl.z) < 10 * 10) Peds.faceTo(p, Math.atan2(pl.x - p.x, pl.z - p.z), dt, 4);
      // если игрок близко и агрессивен (целится) — реагируем
      if (pl && pl.aiming && dist2(p.x, p.z, pl.x, pl.z) < 15 * 15 && p.gang !== 'valera') { p.alert = 5; if (G.gangs) G.gangs.provoke(p.gang, 0.05); }
    } else if (st === 'idle') { /* стоит */ }
    // движение
    if (moving) {
      Peds.move(p, dt, dirx, dirz, spd);
      if (st !== 'attack' || !(p.aim > 0.5)) Peds.faceTo(p, Math.atan2(dirx, dirz), dt, 9);
    } else { p.vx *= Math.exp(-8 * dt); p.vz *= Math.exp(-8 * dt); }
    Peds.integrate(p, dt);
    // сбитые машиной
    if (dc < 120 * 120) Peds.vehicleHit(p);
    // визуал
    const vis = dc < 140 * 140;
    p.rig.root.visible = vis;
    if (vis) {
      p.rig.setShadow(dc < 40 * 40 && G.quality !== 'low');
      const sp = Math.hypot(p.vx, p.vz);
      p.sp = damp(p.sp, sp, 8, dt);
      p.rig.update(dt, { speed: p.sp, crouch: p.crouch, aim: p.aim, punch: p.punchT, twohand: !!(p.weapon && ['mr153', 'akm', 'kedr', 'obrez'].includes(p.weapon)), melee: !!p.melee, dead: 0, squat: p.squatT, sit: 0 });
      p.rig.root.position.set(p.x, 0, p.z); p.rig.root.rotation.y = p.heading;
      if (p.phone && p.state === 'walk') { p.rig.armR.rotation.x = -2.2; p.rig.armR.rotation.z = 0.3; }
    }
  },
  integrate(p, dt) {
    let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
    const r = resolveCircle(nx, nz, 0.33, { x: 0, z: 0 }, 0.8);
    nx = r.x; nz = r.z;
    if (City.isWater(nx, nz)) { if (p.state === 'flee') { p.vx = -p.vx; p.vz = -p.vz; } nx = p.x; nz = p.z; }
    if (r.hit && (p.state === 'walk') && p.nav) { p.stuck += dt; if (p.stuck > 1.0) { p.stuck = 0; p.nav.side = -p.nav.side; p.nav.off = p.nav.side * (p.nav.e.w / 2 + 1.7); } }
    else p.stuck = 0;
    // отталкивание от других
    Peds.grid.near(nx, nz, 1, (q) => {
      if (q === p || q.dead) return;
      const dx = nx - q.x, dz = nz - q.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.36 && d2 > 0.0001) { const d = Math.sqrt(d2); nx += (dx / d) * (0.6 - d) * 0.3; nz += (dz / d) * (0.6 - d) * 0.3; }
    });
    p.x = nx; p.z = nz;
  },
  vehicleHit(p) {
    const V = G.Veh;
    V.grid.near(p.x, p.z, 6, (v) => {
      if (v.parkedLock && Math.abs(v.speed) < 0.5) return;
      const sp = Math.hypot(v.vx, v.vz);
      if (sp < 2.2) return;
      if (V.hitTest(v, p.x, p.z, 0.35)) {
        const dmg = sp * (v.isBike ? 2 : 6);
        const dir = { x: v.vx / sp, z: v.vz / sp };
        const byPlayer = v.playerDriven;
        Peds.hurt(p, dmg, byPlayer ? 'player' : 'env', dir);
        p.vx = dir.x * sp * 0.6; p.vz = dir.z * sp * 0.6;
        if (!p.dead) { p.down = 2.5; }
        if (byPlayer && G.police) G.police.report('runover', p.x, p.z, p.dead ? 2 : 1);
        if (sp > 6) { Snd.crash(0.25, p.x, p.z); Snd.punch(p.x, p.z); }
        if (v.ai && !byPlayer) v.ai.panic = 2;
      }
    });
  },
  // ---------- менеджер спавна ----------
  manage(dt) {
    const pl = G.player, cam = G.cam;
    if (!pl) return;
    Peds._t = (Peds._t || 0) - dt;
    if (Peds._t > 0) return;
    Peds._t = 0.35;
    const q = G.quality === 'low' ? 0.5 : G.quality === 'medium' ? 0.75 : 1;
    let n = 0; for (const p of Peds.list) if (p.type === 'civ' && !p.dead) n++;
    const night = G.env ? G.env.night : 0;
    const want = Math.round(Peds.wantCivs * q * (1 - night * 0.6) * (G.env && (G.env.rain > 0.5) ? 0.6 : 1));
    if (n < want) Peds.spawnCivil({ x: pl.x, z: pl.z }, 40, 130);
  },
};
G.Peds = Peds;
void THREE; void lerp; void pedMaterial; void Obst;
