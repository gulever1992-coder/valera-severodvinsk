// Бой: попадания пуль (hitscan), ближний бой, гранаты и коктейли Молотова, взрывы и огонь
import * as THREE from 'three';
import { G } from './state.js';
import { WEAPONS } from './data.js';
import { Snd } from './audio.js';
import { FX } from './fx.js';
import { City } from './city.js';
import { clamp, rand, chance, dist, dist2, angDiff, rayObst, resolveCircle, TAU } from './util.js';

const fires = [];
const projs = [];

// луч против вертикального ориентированного бокса машины: возвращает t (по горизонтали) или null
function rayVeh(v, ox, oz, dx, dz, maxT) {
  const s = Math.sin(v.heading), c = Math.cos(v.heading);
  const px = ox - v.x, pz = oz - v.z;
  const lx = px * c - pz * s, lz = px * s + pz * c;
  const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
  const hx = v.W / 2, hz = v.L / 2;
  let t0 = 0, t1 = maxT;
  for (let a = 0; a < 2; a++) {
    const p = a ? lz : lx, d = a ? ldz : ldx, h = a ? hz : hx;
    if (Math.abs(d) < 1e-8) { if (Math.abs(p) > h) return null; }
    else {
      let ta = (-h - p) / d, tb = (h - p) / d;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
  }
  return t0;
}

export const Combat = {
  // shooter: {kind:'player'|'ped', obj}
  fire(shooter, wId, ox, oy, oz, dx, dy, dz, o = {}) {
    const w = WEAPONS[wId];
    const pellets = w.pellets || 1;
    const R = w.range || 80;
    const fromPlayer = shooter.kind === 'player';
    Snd.shot(w.snd || 'pistol', ox, oz);
    if (fromPlayer || dist2(ox, oz, G.cam.x, G.cam.z) < 60 * 60) FX.muzzle(ox + dx * 0.5, oy + dy * 0.5, oz + dz * 0.5);
    Snd.pump && wId === 'mr153' && setTimeout(() => Snd.pump(ox, oz), 300);
    const pl = G.player;
    for (let k = 0; k < pellets; k++) {
      const sp = (w.spread || 0.02) * (o.spreadMul || 1);
      let ax = dx + rand(-sp, sp), ay = dy + rand(-sp, sp), az = dz + rand(-sp, sp);
      const l = Math.hypot(ax, ay, az); ax /= l; ay /= l; az /= l;
      const hl = Math.hypot(ax, az) || 1e-6;
      const hx = ax / hl, hz = az / hl;
      // статика
      let tHit = R, kind = 'none', obj = null, headshot = false;
      const st = rayObst(ox, oz, hx, hz, R, 2.0);
      if (st) { tHit = st.t; kind = 'wall'; obj = st.obj; }
      // ходячие
      for (const p of G.peds) {
        if (p.dead || p.veh || (shooter.obj === p)) continue;
        const rx = p.x - ox, rz = p.z - oz;
        const t = rx * hx + rz * hz;
        if (t < 0.2 || t > tHit) continue;
        const perp = Math.abs(rx * hz - rz * hx);
        if (perp > 0.42) continue;
        const y = oy + (ay / hl) * t;
        const top = p.crouch > 0.5 ? 1.25 : 1.85;
        if (y < -0.05 || y > top) continue;
        // укрытие: пуля, пущенная мимо низкой преграды
        tHit = t; kind = 'ped'; obj = p; headshot = y > top - 0.3;
      }
      // машины
      for (const v of G.vehicles) {
        if (v.playerDriven && fromPlayer) continue;
        if (dist2(v.x, v.z, ox, oz) > (tHit + 8) * (tHit + 8)) continue;
        const t = rayVeh(v, ox, oz, hx, hz, tHit);
        if (t !== null && t < tHit && t > 0.1) {
          const y = oy + (ay / hl) * t;
          if (y > -0.1 && y < (v.isBike ? 1.6 : v.spec.top + 0.1)) { tHit = t; kind = 'veh'; obj = v; }
        }
      }
      // игрок как цель
      if (!fromPlayer && pl && !pl.dead && !pl.veh) {
        const rx = pl.x - ox, rz = pl.z - oz;
        const t = rx * hx + rz * hz;
        if (t > 0.2 && t < tHit) {
          const perp = Math.abs(rx * hz - rz * hx);
          const y = oy + (ay / hl) * t;
          const top = pl.crouching ? 1.25 : pl.cover && pl.coverLow && !pl.aiming ? 0.9 : 1.85;
          if (perp < 0.42 && y > -0.05 && y < top) { tHit = t; kind = 'player'; obj = pl; headshot = y > top - 0.3; }
        }
      }
      const ex = ox + hx * tHit, ez = oz + hz * tHit, ey = oy + (ay / hl) * tHit;
      // визуальный трассер (не для каждой дробины)
      if (k < 3) FX.tracer(ox + hx * 0.8, oy + (ay / hl) * 0.8, oz + hz * 0.8, ex, Math.max(0.05, ey), ez);
      // пролетевшая рядом пуля пугает игрока
      if (!fromPlayer && pl && kind !== 'player') { const rx = pl.x - ox, rz = pl.z - oz, t = rx * hx + rz * hz; if (t > 1 && t < tHit + 3 && Math.abs(rx * hz - rz * hx) < 2.2) { if (chance(0.35)) Snd.whiz(pl.x, pl.z); } }
      const fall = 1 - 0.45 * (tHit / R);
      const dmg = w.dmg * fall * (o.dmgMul || 1);
      if (kind === 'ped') {
        const p = obj;
        const dir = { x: hx, z: hz };
        G.Peds.hurt(p, dmg, fromPlayer ? 'player' : shooter, dir, headshot);
        if (fromPlayer && G.ui) G.ui.hitMarker(p.dead, headshot);
        if (p.dead) p.vx = hx * 3, p.vz = hz * 3;
        Snd.impact(ex, ez);
      } else if (kind === 'veh') {
        const v = obj;
        FX.spark(ex, Math.max(0.3, ey), ez, 4, -hx, -hz); Snd.impact(ex, ez);
        v.lastAttacker = fromPlayer ? 'player' : 'env';
        G.Veh.damage(v, dmg * 1.6, fromPlayer ? 'player' : 'env');
        if (v.driver && v.ai) { G.Veh.panic(v); if (fromPlayer && chance(0.12) && !v.dead) Combat.driverFlees(v); }
        if (v.playerDriven && pl) pl.hurt(dmg * 0.4, shooter);
        if (fromPlayer && G.police) G.police.report('shoot', ox, oz, 1);
      } else if (kind === 'player') {
        pl.hurt(dmg, shooter);
        FX.blood(ex, ey, ez, 3, hx * 0.3, hz * 0.3);
      } else if (kind === 'wall') {
        FX.spark(ex, Math.max(0.2, ey), ez, 3, -hx, -hz); FX.dust(ex, ez, 1, 0.6); Snd.impact(ex, ez);
      }
    }
    if (fromPlayer && G.police) G.police.report('shoot', ox, oz, 1, false, true);
    G.Peds.noise(ox, oz, w.snd === 'rifle' || w.snd === 'shotgun' ? 70 : 45, 'shot', shooter.obj);
    if (shooter.kind === 'ped' && G.police) G.police.onGunfire && G.police.onGunfire(ox, oz, shooter.obj);
    // прицельный «кик» камеры
    if (fromPlayer) G.recoil = (G.recoil || 0) + (w.rate < 0.15 ? 0.006 : 0.02);
  },
  driverFlees(v) {
    // водитель выскакивает и убегает
    if (!v.driver) return;
    const pos = G.Veh.freeExit(v);
    const p = G.Peds.spawn('civ', pos.x, pos.z, { kind: 'default' });
    p.fear = 12; p.fearSrc = G.player; p.state = 'flee';
    G.Veh.removeDriver(v); v.engineOff = true; v.ai = null; v.mode = 'parked';
  },
  npcFire(p, target) {
    const w = WEAPONS[p.weapon];
    if (!w) return;
    const y0 = 1.35;
    const tx = target.x, tz = target.z;
    const ty = target === G.player && G.player.veh ? 0.9 : 1.15;
    let dx = tx - p.x, dz = tz - p.z, dy = ty - y0;
    const d = Math.hypot(dx, dz);
    if (target.vx !== undefined) { dx += (target.vx || 0) * d * 0.02; dz += (target.vz || 0) * d * 0.02; }
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const fwdx = Math.sin(p.heading), fwdz = Math.cos(p.heading);
    const acc = p.type === 'omon' ? 0.7 : p.type === 'cop' ? 0.9 : 1.6;
    p.punchT = 0;
    Combat.fire({ kind: 'ped', obj: p }, p.weapon, p.x + fwdx * 0.6, y0, p.z + fwdz * 0.6, dx, dy, dz, { spreadMul: acc, dmgMul: p.type === 'cop' || p.type === 'omon' ? 0.8 : 0.9 });
  },
  npcMelee(p, target, arrest) {
    const wep = p.weapon ? WEAPONS[p.weapon] : null;
    const dmg = wep && wep.melee ? wep.dmg * 0.5 : 6;
    if (target === G.player) {
      if (arrest && G.police) { G.police.tryArrest(p); Snd.swing(); return; }
      if (G.player.veh || G.player.dead) return;
      if (dist(p.x, p.z, target.x, target.z) > 2.2) return;
      Snd.swing(); setTimeout(() => (wep && wep.melee ? (p.weapon === 'knife' ? Snd.stab(target.x, target.z) : Snd.bat(target.x, target.z)) : Snd.punch(target.x, target.z)), 120);
      G.player.hurt(dmg, { kind: 'ped', obj: p });
    } else if (target && !target.dead) {
      Snd.swing(); Snd.punch(target.x, target.z);
      G.Peds.hurt(target, dmg * 1.3, { kind: 'ped', obj: p }, { x: Math.sin(p.heading), z: Math.cos(p.heading) });
    }
  },
  // ближний бой игрока. возвращает true если попал
  playerMelee(pl, wId) {
    const w = WEAPONS[wId];
    const fx = Math.sin(pl.yawBody), fz = Math.cos(pl.yawBody);
    let hit = false;
    const dmgMul = 1 + (pl.strength || 0) * 0.05;
    const list = G.peds.filter((p) => !p.dead && !p.veh);
    for (const p of list) {
      const dx = p.x - pl.x, dz = p.z - pl.z, d = Math.hypot(dx, dz);
      if (d > w.range + 0.3) continue;
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (dot < 0.4) continue;
      const dir = { x: fx, z: fz };
      const head = false;
      G.Peds.hurt(p, w.dmg * dmgMul * rand(0.85, 1.15), 'player', dir, head);
      if (!p.dead && (wId === 'bat' || pl.combo >= 2)) { p.down = 1.6; p.vx = fx * 4; p.vz = fz * 4; }
      else p.vx += fx * 2, p.vz += fz * 2;
      if (wId === 'knife') Snd.stab(p.x, p.z); else if (wId === 'bat') Snd.bat(p.x, p.z); else Snd.punch(p.x, p.z);
      if (G.ui) G.ui.hitMarker(p.dead, false);
      hit = true;
      if (G.police && p.type !== 'civ' || (G.police && p.type === 'civ')) G.police.report(p.type === 'cop' || p.type === 'omon' ? 'copassault' : 'assault', p.x, p.z, p.type === 'cop' || p.type === 'omon' ? 3 : 1);
      G.Peds.noise(p.x, p.z, 18, 'fight', p);
      break;
    }
    // велосипед / машины: бита разбивает стёкла (просто звук/искры)
    if (!hit && wId === 'bat') {
      for (const v of G.vehicles) {
        if (v.playerDriven || v.isBike) continue;
        const dx = v.x - pl.x, dz = v.z - pl.z;
        if (Math.hypot(dx, dz) < v.L / 2 + 1.6 && G.Veh.hitTest(v, pl.x + fx * 1.4, pl.z + fz * 1.4, 0.4)) { G.Veh.damage(v, 25, 'player'); Snd.scrape(v.x, v.z); FX.spark(pl.x + fx * 1.4, 1, pl.z + fz * 1.4, 4); hit = true; break; }
      }
    }
    return hit;
  },
  // ---------- метательное ----------
  throwProj(kind, x, y, z, vx, vy, vz, owner) {
    const geo = kind === 'grenade' ? new THREE.SphereGeometry(0.09, 6, 4) : new THREE.CylinderGeometry(0.04, 0.05, 0.22, 6);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: kind === 'grenade' ? 0x3a4a2a : 0x3a7a3a }));
    mesh.position.set(x, y, z); G.scene.add(mesh);
    projs.push({ kind, x, y, z, vx, vy, vz, mesh, t: 0, owner, fuse: 2.6 });
    Snd.throwSound();
  },
  explosionAt(x, z, r, dmg, src, srcObj) {
    FX.explosion(x, 1, z, r);
    Snd.explosion(x, z);
    const byPlayer = src === 'player';
    for (const p of G.peds.slice()) {
      if (p.dead && p.deadT > 0.3) continue;
      const d = dist(p.x, p.z, x, z);
      if (d > r * 1.3) continue;
      const k = 1 - d / (r * 1.3);
      const dir = { x: (p.x - x) / (d || 1), z: (p.z - z) / (d || 1) };
      G.Peds.hurt(p, dmg * k, byPlayer ? 'player' : src, dir);
      p.vx += dir.x * 9 * k; p.vz += dir.z * 9 * k;
      if (!p.dead) p.down = 2.5;
    }
    for (const v of G.vehicles) {
      if (v === srcObj) continue;
      const d = dist(v.x, v.z, x, z);
      if (d > r * 1.6) continue;
      const k = 1 - d / (r * 1.6);
      v.lastAttacker = byPlayer ? 'player' : 'env';
      G.Veh.damage(v, dmg * 2 * k, byPlayer ? 'player' : 'env');
      v.vx += ((v.x - x) / (d || 1)) * 7 * k; v.vz += ((v.z - z) / (d || 1)) * 7 * k; v.pop = 2 * k;
    }
    const pl = G.player;
    if (pl && !pl.dead) {
      const d = dist(pl.x, pl.z, x, z);
      if (d < r * 1.3) { pl.hurt(dmg * (1 - d / (r * 1.3)) * 0.6, 'boom'); pl.vx += ((pl.x - x) / (d || 1)) * 6; pl.vz += ((pl.z - z) / (d || 1)) * 6; }
    }
    G.Peds.noise(x, z, 90, 'boom');
    if (byPlayer && G.police) G.police.report('explosion', x, z, 3);
  },
  addFire(x, z, r = 3.5, t = 9) {
    fires.push({ x, z, r, t, dmgT: 0 });
    Snd.fire(x, z);
  },
  update(dt) {
    for (let i = projs.length - 1; i >= 0; i--) {
      const p = projs[i];
      p.t += dt; p.vy -= 16 * dt;
      const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt, ny = p.y + p.vy * dt;
      const hit = resolveCircle(nx, nz, 0.15, { x: 0, z: 0 }, 1.0);
      if (hit.hit) { p.vx = (hit.x - p.x) * 8; p.vz = (hit.z - p.z) * 8; if (p.kind === 'molotov') p.y = 0; }
      else { p.x = nx; p.z = nz; }
      p.y = ny;
      // сталкиваемся с людьми/машинами для молотова
      if (p.kind === 'molotov') {
        let boom = p.y <= 0.1 || hit.hit;
        for (const v of G.vehicles) if (!boom && G.Veh.hitTest(v, p.x, p.z, 0.2) && p.y < 1.8) boom = true;
        for (const q of G.peds) if (!boom && !q.dead && dist2(q.x, q.z, p.x, p.z) < 0.5 && p.y < 1.8) boom = true;
        if (boom) {
          Snd.glass(p.x, p.z); Combat.addFire(p.x, p.z, 4, 10);
          if (p.owner === 'player' && G.police) G.police.report('explosion', p.x, p.z, 2);
          G.scene.remove(p.mesh); projs.splice(i, 1); continue;
        }
      } else {
        if (p.y < 0.1) { p.y = 0.1; p.vy = Math.abs(p.vy) * 0.35; p.vx *= 0.6; p.vz *= 0.6; if (Math.abs(p.vy) > 1) Snd.tone({ type: 'triangle', f0: 900, dur: 0.05, gain: 0.1, x: p.x, z: p.z }); }
        p.fuse -= dt;
        if (p.fuse <= 0) { Combat.explosionAt(p.x, p.z, 9, 240, p.owner, null); G.scene.remove(p.mesh); projs.splice(i, 1); continue; }
      }
      p.mesh.position.set(p.x, p.y, p.z); p.mesh.rotation.x += dt * 12; p.mesh.rotation.z += dt * 8;
    }
    // огонь
    for (let i = fires.length - 1; i >= 0; i--) {
      const f = fires[i];
      f.t -= dt; f.dmgT -= dt;
      const n = 2;
      for (let k = 0; k < n; k++) FX.fire(f.x + rand(-f.r, f.r) * 0.8, 0.1, f.z + rand(-f.r, f.r) * 0.8, rand(1, 1.8));
      if (chance(dt * 4)) FX.smoke(f.x + rand(-1, 1), 1.2, f.z + rand(-1, 1), 1.6, 2.5, 0.12, 2);
      if (f.dmgT <= 0) {
        f.dmgT = 0.4;
        for (const p of G.peds) { if (!p.dead && dist2(p.x, p.z, f.x, f.z) < f.r * f.r) { G.Peds.hurt(p, 14, 'player'); if (p.type === 'civ') p.fear = 10; } }
        for (const v of G.vehicles) { if (dist2(v.x, v.z, f.x, f.z) < (f.r + 1.5) * (f.r + 1.5)) G.Veh.damage(v, 30, 'env'); }
        const pl = G.player; if (pl && !pl.dead && !pl.veh && dist2(pl.x, pl.z, f.x, f.z) < f.r * f.r) pl.hurt(9, 'fire');
      }
      if (f.t <= 0) fires.splice(i, 1);
    }
  },
};
Combat.rayVeh = rayVeh;
G.combat = Combat;
G.explosionAt = Combat.explosionAt;
void TAU; void clamp; void angDiff; void City;
