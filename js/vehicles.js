// Транспорт: физика (аркадная, с заносами), повреждения и взрывы, трафик по дорожному графу, припаркованные машины и велосипеды
import * as THREE from 'three';
import { G } from './state.js';
import { City, laneOffset, edgePoint } from './city.js';
import { VEHICLES, TRAFFIC_MIX } from './data.js';
import { buildVehicle, Rig, pedLook, makePedGeoms, pedMaterial } from './models.js';
import { Snd } from './audio.js';
import { FX } from './fx.js';
import {
  clamp, lerp, rand, pick, chance, angNorm, angDiff, dist, dist2, damp, resolveCircle, rayObst, DynGrid, closestOnSeg, TAU,
} from './util.js';

const pool = new Map();
let idc = 1;

function acquireMesh(specId, color) {
  const key = specId + '|' + color;
  const l = pool.get(key);
  if (l && l.length) { const m = l.pop(); m.group.visible = true; return m; }
  const m = buildVehicle(specId, VEHICLES[specId], color);
  m.key = key; m.origMat = m.bodyMesh.material;
  G.scene.add(m.group);
  return m;
}
function releaseMesh(m) {
  m.group.visible = false;
  let l = pool.get(m.key);
  if (!l) pool.set(m.key, (l = []));
  l.push(m);
}

export const Veh = {
  list: G.vehicles,
  grid: new DynGrid(20),
  wantTraffic: 30,
  wantParked: 26,
  wantBikes: 6,
  spawn(specId, x, z, heading, opts = {}) {
    const spec = VEHICLES[specId];
    const color = opts.color || pick(spec.colors);
    const m = acquireMesh(specId, color);
    const v = {
      id: idc++, specId, spec, x, z, heading, vx: 0, vz: 0, speed: 0, steer: 0, steerAng: 0, throttle: 0, brake: 0, hb: false,
      hp: spec.hp, maxHp: spec.hp, m, group: m.group, parts: m.parts, mode: opts.mode || 'traffic', color, ai: null, driver: null,
      playerDriven: false, dead: false, burning: 0, wreck: false, engineOff: !opts.driver, pitch: 0, roll: 0, siren: false, lastVX: 0, lastVZ: 0,
      W: spec.wid, L: spec.len, R: spec.wid * 0.5, yawRate: 0, hornT: 0, stuck: 0, slip: 0, age: 0, isBike: spec.kind === 'bike', owner: opts.owner || null,
      stolen: false, wheelSpin: 0, lightsOn: false, brakeLit: false, life: 0,
    };
    const n = spec.kind === 'bike' ? 1 : Math.max(2, Math.ceil(spec.len / 2.3));
    v.circles = [];
    for (let i = 0; i < n; i++) v.circles.push(n === 1 ? 0 : -spec.len / 2 + spec.wid * 0.5 + (i * (spec.len - spec.wid)) / (n - 1));
    v.cr = spec.kind === 'bike' ? 0.4 : spec.wid * 0.52;
    if (opts.driver) Veh.addDriver(v, opts.driverLook);
    if (opts.ai) v.ai = { edge: null, next: null, s: 0, lane: chance(0.6) ? 0 : 1, speedF: rand(0.8, 1.05), stuckT: 0, revT: 0, mode: opts.ai, wait: 0 };
    v.group.position.set(x, 0, z);
    v.group.rotation.set(0, heading, 0);
    v.group.userData.veh = v;
    Veh.list.push(v);
    return v;
  },
  addDriver(v, look) {
    if (v.driverMesh) { v.driverMesh.visible = true; }
    if (!v.driverMesh) {
      const lk = look || pedLook(v.spec.police ? 'cop' : v.spec.taxi || v.spec.kind === 'bus' ? 'default' : chance(0.2) ? 'woman' : 'default');
      const g = makePedGeoms(lk);
      const mesh = new THREE.Mesh(g.body, pedMaterial());
      const seatY = v.spec.kind === 'bus' ? 1.0 : 0.42;
      mesh.position.set(v.spec.kind === 'bus' ? 0.5 : v.W * 0.22, seatY, v.spec.kind === 'bus' ? v.L * 0.42 : v.L * 0.04);
      mesh.scale.setScalar(0.9);
      v.group.add(mesh);
      v.driverMesh = mesh; v.driverLook = lk;
    }
    v.driver = { hp: 60 };
    v.engineOff = false;
  },
  removeDriver(v) { v.driver = null; if (v.driverMesh) { v.group.remove(v.driverMesh); v.driverMesh = null; } },
  remove(v) {
    const i = Veh.list.indexOf(v);
    if (i >= 0) Veh.list.splice(i, 1);
    if (v.driverMesh) { v.group.remove(v.driverMesh); v.driverMesh = null; }
    if (v.m.parts.beam) v.m.parts.beam.visible = false;
    if (v.wreckTinted) { v.m.bodyMesh.material.dispose(); v.m.bodyMesh.material = v.m.origMat; v.wreckTinted = false; }
    v.m.group.rotation.set(0, 0, 0);
    releaseMesh(v.m);
  },
  damage(v, amt, src) {
    if (v.dead || v.isBike) { if (v.isBike && amt > 40) v.hp -= amt; return; }
    v.hp -= amt;
    if (v.hp < v.maxHp * 0.35 && !v.smoking) v.smoking = true;
    if (v.hp <= 0) Veh.kill(v, src);
  },
  kill(v, src) {
    if (v.dead) return;
    v.dead = true; v.burning = 1; v.fuse = rand(3, 5.5); v.mode = v.mode === 'player' ? 'player' : 'wreck';
    v.throttle = 0; v.brake = 0;
    if (v.ai) v.ai = null;
    if (src === 'player') G.stats.wrecks = (G.stats.wrecks || 0) + 1;
    if (G.police) G.police.report && v.driver && src === 'player' && G.police.report('vehicle', v.x, v.z, 1);
  },
  explode(v) {
    FX.explosion(v.x, 1, v.z, 7);
    Snd.explosion(v.x, v.z);
    v.wreck = true; v.burning = 0.9; v.engineOff = true; v.hp = 0;
    v.speed *= 0.2; v.vx *= 0.2; v.vz *= 0.2;
    v.group.traverse((o) => { if (o.isMesh && o.material && o.material.color && !o.material.vertexColors && !o.material.map) { /* фары/сирены */ } });
    G.explosionAt && G.explosionAt(v.x, v.z, 8, 220, v.lastAttacker || 'env', v);
    if (v.playerDriven && G.player) G.player.forceExit && G.player.forceExit(true);
    // подпрыгнуть
    v.pop = 4;
    Veh.removeDriver(v);
  },
  nearest(x, z, r, filter) {
    let best = null, bd = r * r;
    for (const v of Veh.list) {
      if (filter && !filter(v)) continue;
      const d = dist2(x, z, v.x, v.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  },
  // точка на кузове (для проверки попаданий): локальные координаты
  local(v, x, z) {
    const dx = x - v.x, dz = z - v.z, s = Math.sin(v.heading), c = Math.cos(v.heading);
    return { lx: -(dx * c - dz * s), lz: dx * s + dz * c }; // lx — вправо?, lz — вперёд
  },
  hitTest(v, x, z, pad = 0) {
    const dx = x - v.x, dz = z - v.z, s = Math.sin(v.heading), c = Math.cos(v.heading);
    const lz = dx * s + dz * c, lx = dx * c - dz * s;
    return Math.abs(lx) < v.W / 2 + pad && Math.abs(lz) < v.L / 2 + pad;
  },
  doorPos(v, side = 1) { // позиция у водительской двери (слева)
    const s = Math.sin(v.heading), c = Math.cos(v.heading);
    const lx = side * (v.W / 2 + 0.9); // +x — влево от водителя
    return { x: v.x + lx * c, z: v.z - lx * s };
  },
  freeExit(v) {
    for (const side of [1, -1]) {
      for (const back of [0, 1, -1]) {
        const s = Math.sin(v.heading), c = Math.cos(v.heading);
        const lx = side * (v.W / 2 + 0.75), lz = back * 1.0;
        const x = v.x + lx * c + lz * s, z = v.z - lx * s + lz * c;
        const r = resolveCircle(x, z, 0.45, { x: 0, z: 0 });
        if (!r.hit && !City.isWater(x, z)) return { x, z };
      }
    }
    return { x: v.x, z: v.z + 2 };
  },

  // ---------- физика ----------
  step(v, dt) {
    if (v.wreck && v.pop === undefined) { v.throttle = 0; }
    const sp = v.spec;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const rx = -fz, rz = fx; // «вправо» по ходу... (−cos h, sin h)
    let vf = v.vx * fx + v.vz * fz, vl = v.vx * rx + v.vz * rz;
    const isBike = v.isBike;
    let th = v.engineOff || v.wreck ? 0 : v.throttle;
    const maxS = sp.max * (v.boost || 1);
    let acc = 0;
    if (th > 0) { acc = th * sp.acc * clamp(1 - Math.max(0, vf) / maxS, 0, 1); if (vf < -0.5) acc += th * 14; }
    else if (th < 0) { if (vf > 0.5) acc = th * 20; else acc = th * sp.acc * 0.6 * clamp(1 - Math.abs(vf) / 9, 0, 1); }
    vf += acc * dt;
    // тормоз
    if (v.brake > 0) { const b = v.brake * (isBike ? 8 : 22) * dt; vf = Math.abs(vf) < b ? 0 : vf - Math.sign(vf) * b; }
    // сопротивление
    vf -= vf * (isBike ? 0.25 : 0.06) * dt + Math.sign(vf) * (isBike ? 0.5 : 0.7) * dt * (Math.abs(vf) > 0.2 ? 1 : 0);
    if (Math.abs(vf) < 0.05 && th === 0) vf = 0;
    // боковое сцепление
    const grip = v.hb ? 1.3 : 7.5;
    if (v.hb) vf *= Math.exp(-0.5 * dt);
    vl *= Math.exp(-grip * dt);
    // руление
    const lim = isBike ? 0.95 / (1 + Math.abs(vf) * 0.14) : 0.62 / (1 + Math.abs(vf) * 0.055);
    const target = v.steer * lim;
    v.steerAng = damp(v.steerAng, target, isBike ? 10 : 7, dt);
    const wb = isBike ? 1.1 : sp.len * 0.6;
    let yaw = -(vf / wb) * Math.tan(v.steerAng);
    if (v.hb && Math.abs(vf) > 6) yaw *= 1.7;
    if (Math.abs(vf) < 0.3) yaw *= Math.abs(vf) / 0.3;
    v.heading += yaw * dt;
    v.yawRate = yaw;
    v.slip = Math.abs(vl) + (v.hb && Math.abs(vf) > 5 ? 3 : 0);
    const nfx = Math.sin(v.heading), nfz = Math.cos(v.heading);
    const nrx = -nfz, nrz = nfx;
    v.vx = nfx * vf + nrx * vl; v.vz = nfz * vf + nrz * vl;
    v.speed = vf;
    if (v.pop !== undefined) { v.pop -= dt * 8; if (v.pop < 0) v.pop = undefined; }
    const ox = v.x, oz = v.z;
    v.x += v.vx * dt; v.z += v.vz * dt;
    // столкновения со статикой
    let px = 0, pz = 0, hits = 0, worst = 0, hitObj = null;
    const out = { x: 0, z: 0 };
    for (const off of v.circles) {
      const cx = v.x + nfx * off, cz = v.z + nfz * off;
      const r = resolveCircle(cx, cz, v.cr, out, isBike ? 1.0 : 0.5);
      if (r.hit) {
        px += r.x - cx; pz += r.z - cz; hits++;
        const vn = v.vx * r.nx + v.vz * r.nz;
        if (vn < 0) { worst = Math.max(worst, -vn); hitObj = r.obj; v.vx -= r.nx * vn * 1.15; v.vz -= r.nz * vn * 1.15; }
      }
    }
    if (hits) {
      v.x += px / hits * 1.0; v.z += pz / hits * 1.0;
      v.speed = v.vx * nfx + v.vz * nfz;
      v.vx *= 0.94; v.vz *= 0.94;
      if (worst > 3) Veh.impact(v, worst, hitObj);
      else if (worst > 0.5 && Math.abs(v.speed) > 2) { v.scrapeT = (v.scrapeT || 0) - dt; if (v.scrapeT < 0) { v.scrapeT = 0.4; Snd.scrape(v.x, v.z); FX.spark(v.x, 0.6, v.z, 3); } }
    }
    // вода
    if (City.isWater(v.x, v.z)) {
      v.x = ox; v.z = oz; v.vx *= -0.3; v.vz *= -0.3; v.speed *= -0.2;
      if (!v.isBike) Veh.damage(v, 30 * dt * 10, 'env');
    }
    if (!City.inBounds(v.x, v.z)) { v.x = clamp(v.x, -38, 1243); v.z = clamp(v.z, -38, 658); v.vx *= 0.5; v.vz *= 0.5; }
    // ускорения для крена
    const ax = (v.vx - v.lastVX) / Math.max(dt, 0.001), az = (v.vz - v.lastVZ) / Math.max(dt, 0.001);
    v.lastVX = v.vx; v.lastVZ = v.vz;
    const accF = ax * nfx + az * nfz, accL = ax * nrx + az * nrz;
    v.pitch = damp(v.pitch, clamp(-accF * 0.0035, -0.06, 0.06), 6, dt);
    v.roll = damp(v.roll, clamp(accL * 0.004 + v.steerAng * vf * 0.004, -0.09, 0.09), 6, dt);
  },
  impact(v, s, obj) {
    const dmg = s * s * 1.6;
    if (s > 4) { Snd.crash(clamp(s / 14, 0.3, 1.4), v.x, v.z); FX.spark(v.x + Math.sin(v.heading) * v.L * 0.4, 0.6, v.z + Math.cos(v.heading) * v.L * 0.4, 6); FX.dust(v.x, v.z, 3); }
    if (obj && (obj.kind === 'pole') && s > 6) { obj.off = false; }
    if (v.playerDriven && G.player) { G.player.hurt(Math.max(0, (s - 9) * 4), 'crash'); G.shake = Math.min(1, G.shake + s * 0.04); }
    Veh.damage(v, dmg, v.lastAttacker === 'player' ? 'player' : 'env');
    if (v.mode === 'traffic' && s > 5 && v.driver) { Veh.panic(v); }
  },
  panic(v) { if (v.ai) { v.ai.panic = 4; v.ai.speedF = 1.4; } },

  collideVehicles(dt) {
    const g = Veh.grid; g.clear();
    for (const v of Veh.list) g.add(v, v.x, v.z);
    for (const a of Veh.list) {
      g.near(a.x, a.z, 9, (b) => {
        if (b.id <= a.id) return;
        const rr = (a.L + b.L) / 2 + 0.5;
        if (dist2(a.x, a.z, b.x, b.z) > rr * rr) return;
        const afx = Math.sin(a.heading), afz = Math.cos(a.heading), bfx = Math.sin(b.heading), bfz = Math.cos(b.heading);
        for (const oa of a.circles) for (const ob of b.circles) {
          const ax = a.x + afx * oa, az = a.z + afz * oa, bx = b.x + bfx * ob, bz = b.z + bfz * ob;
          const dx = bx - ax, dz = bz - az, rs = a.cr + b.cr;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rs * rs) continue;
          const d = Math.sqrt(d2) || 0.01, nx = dx / d, nz = dz / d, pen = rs - d;
          const ma = a.isBike ? 0.1 : a.spec.hp, mb = b.isBike ? 0.1 : b.spec.hp;
          const wa = mb / (ma + mb), wb = ma / (ma + mb);
          if (!a.parkedLock) { a.x -= nx * pen * wa; a.z -= nz * pen * wa; }
          if (!b.parkedLock) { b.x += nx * pen * wb; b.z += nz * pen * wb; }
          const rvn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
          if (rvn < 0) {
            const j = -rvn * 1.25;
            a.vx -= nx * j * wa; a.vz -= nz * j * wa; b.vx += nx * j * wb; b.vz += nz * j * wb;
            if (-rvn > 3) {
              Snd.crash(clamp(-rvn / 12, 0.3, 1.2), ax, az); FX.spark((ax + bx) / 2, 0.6, (az + bz) / 2, 5);
              const da = -rvn * -rvn * 1.4 * wa, db = -rvn * -rvn * 1.4 * wb;
              a.lastAttacker = b.playerDriven ? 'player' : a.lastAttacker; b.lastAttacker = a.playerDriven ? 'player' : b.lastAttacker;
              Veh.damage(a, da * (a.isBike ? 30 : 1), b.playerDriven ? 'player' : 'env'); Veh.damage(b, db * (b.isBike ? 30 : 1), a.playerDriven ? 'player' : 'env');
              if (a.playerDriven && G.player) G.player.hurt(Math.max(0, (-rvn - 8) * 3), 'crash');
              if (b.playerDriven && G.player) G.player.hurt(Math.max(0, (-rvn - 8) * 3), 'crash');
              if (a.ai) Veh.panic(a); if (b.ai) Veh.panic(b);
              if (a.playerDriven || b.playerDriven) { G.shake = Math.min(1, G.shake + 0.3); if (G.police) G.police.report('crash', ax, az, 0.5, true); }
              if (a.isBike && a.rider) G.player.forceExit && G.player.forceExit(false);
              if (b.isBike && b.rider) G.player.forceExit && G.player.forceExit(false);
            }
          }
        }
      });
    }
  },

  // ---------- ИИ ----------
  assignEdge(v, e, s) {
    v.ai.edge = e; v.ai.s = s || 0;
    v.ai.next = Veh.pickNext(v, e);
  },
  pickNext(v, e) {
    const outs = e.b.out;
    if (!outs.length) return e.rev || null;
    let c = outs.filter((o) => o !== e.rev && !(v.spec.kind === 'bus' && o.road.lvl < 2));
    if (!c.length) c = outs.filter((o) => o !== e.rev);
    if (!c.length) return e.rev || outs[0];
    // предпочитаем прямо
    const w = c.map((o) => (o.road === e.road ? 2.2 : 1) * (0.6 + 0.4 * Math.max(0, o.dx * e.dx + o.dz * e.dz + 1)));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < c.length; i++) { r -= w[i]; if (r <= 0) return c[i]; }
    return c[0];
  },
  nearestEdge(x, z) {
    let best = null, bd = 1e9, bs = 0;
    City.graph.eGrid.query(x - 30, z - 30, x + 30, z + 30, (e) => {
      const c = closestOnSeg(x, z, e.a.x, e.a.z, e.b.x, e.b.z);
      const d = dist(x, z, c.x, c.z);
      if (d < bd) { bd = d; best = e; bs = c.t * e.len; }
    });
    return best ? { e: best, s: bs, d: bd } : null;
  },
  obstacleAhead(v, range) {
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let dmin = range;
    const cx = v.x + fx * (v.L / 2), cz = v.z + fz * (v.L / 2);
    Veh.grid.near(cx + fx * range * 0.5, cz + fz * range * 0.5, range * 0.6 + 4, (o) => {
      if (o === v) return;
      const dx = o.x - cx, dz = o.z - cz;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < dmin + o.L / 2 && lat < v.W / 2 + o.W / 2 + 0.6 + along * 0.08) dmin = Math.min(dmin, along - o.L / 2);
    });
    if (G.pedGrid) G.pedGrid.near(cx + fx * range * 0.5, cz + fz * range * 0.5, range * 0.6 + 4, (p) => {
      if (p.dead || p.veh) return;
      const dx = p.x - cx, dz = p.z - cz;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < dmin && lat < v.W / 2 + 0.9) dmin = Math.min(dmin, along - 0.2);
    });
    const pl = G.player;
    if (pl && !pl.veh && !pl.dead) {
      const dx = pl.x - cx, dz = pl.z - cz; const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < dmin && lat < v.W / 2 + 0.9) dmin = Math.min(dmin, along - 0.2);
    }
    return dmin;
  },
  trafficAI(v, dt) {
    const ai = v.ai;
    if (!ai.edge) {
      const ne = Veh.nearestEdge(v.x, v.z);
      if (!ne) { v.throttle = 0; v.brake = 1; return; }
      Veh.assignEdge(v, ne.e, ne.s);
    }
    let e = ai.edge;
    const off = laneOffset(e, ai.lane);
    const ox = -e.dz * off, oz = e.dx * off;
    let s = (v.x - (e.a.x + ox)) * e.dx + (v.z - (e.a.z + oz)) * e.dz;
    s = clamp(s, 0, e.len);
    ai.s = s;
    const speedAbs = Math.abs(v.speed);
    const Ld = clamp(4 + speedAbs * 0.55, 5, 15);
    let ts = s + Ld, te = e;
    let tx, tz;
    if (ts > e.len) {
      const nx = ai.next;
      if (nx) {
        const off2 = laneOffset(nx, ai.lane);
        const rem = Math.min(ts - e.len, nx.len);
        const p = edgePoint(nx, rem, off2);
        tx = p[0]; tz = p[1];
        // на выходе за конец ребра — переключаемся
        if (s > e.len - 1.5) { ai.edge = nx; ai.next = Veh.pickNext(v, nx); if (Math.random() < 0.25) ai.lane = chance(0.6) ? 0 : 1; }
      } else { const p = edgePoint(e, e.len, off); tx = p[0]; tz = p[1]; }
    } else { const p = edgePoint(e, ts, off); tx = p[0]; tz = p[1]; }
    void te;
    const ang = Math.atan2(tx - v.x, tz - v.z);
    const err = angDiff(v.heading, ang);
    // возвращение с большого отклонения
    v.steer = clamp(-err * 1.6, -1, 1);
    // скорость
    let want = e.limit * ai.speedF * (v.spec.kind === 'bus' ? 0.8 : 1);
    if (ai.panic > 0) { ai.panic -= dt; want = Math.max(want, 16); }
    want *= clamp(1 - Math.abs(err) * 0.85, 0.25, 1);
    // перекрёсток: замедляемся
    if (e.b.junction && e.len - s < 18) want = Math.min(want, 8.5);
    const obst = Veh.obstacleAhead(v, 6 + speedAbs * 1.1);
    if (obst < 5 + speedAbs * 0.9) {
      const allow = Math.max(0, (obst - 2.5)) * 1.0;
      want = Math.min(want, allow);
      if (obst < 2.2) { ai.blockT = (ai.blockT || 0) + dt; } else ai.blockT = 0;
    } else ai.blockT = 0;
    if (ai.blockT > 4) { want = Math.min(want, 3); } // «пробка» — прорываемся медленно
    if (v.hp < v.maxHp * 0.3) want *= 0.5;
    const dv = want - v.speed;
    if (dv > 0) { v.throttle = clamp(dv * 0.5, 0.15, 1); v.brake = 0; } else { v.throttle = 0; v.brake = clamp(-dv * 0.25, 0, 1); }
    // застревание
    if (speedAbs < 0.3 && want > 2) { ai.stuckT += dt; if (ai.stuckT > 5) { ai.revT = 1.4; ai.stuckT = 0; } } else ai.stuckT = Math.max(0, ai.stuckT - dt);
    if (ai.revT > 0) { ai.revT -= dt; v.throttle = -0.8; v.brake = 0; v.steer = -v.steer; }
    v.hornT = (v.hornT || 0) - dt;
    if (ai.blockT > 1.5 && v.hornT < 0 && chance(0.02)) { v.hornT = rand(3, 8); Veh.honk(v, rand(0.2, 0.6)); }
  },
  honk(v, dur) { Snd.hornOn(v, true); setTimeout(() => Snd.hornOn(v, false), dur * 1000); },
  policeAI(v, dt) {
    const ai = v.ai, pl = G.player;
    if (!pl) return;
    if (ai.chaseOnly) return;
    let tx = pl.x, tz = pl.z;
    if (pl.veh) { tx += pl.veh.vx * 0.6; tz += pl.veh.vz * 0.6; }
    const dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);
    let err = angDiff(v.heading, ang);
    v.steer = clamp(-err * 2, -1, 1);
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    // объезд препятствий
    const hitC = rayObst(v.x + fx * 2, v.z + fz * 2, fx, fz, 11, 2.5);
    if (hitC) {
      const l = rayObst(v.x, v.z, Math.sin(v.heading + 0.6), Math.cos(v.heading + 0.6), 14, 2.5), r = rayObst(v.x, v.z, Math.sin(v.heading - 0.6), Math.cos(v.heading - 0.6), 14, 2.5);
      const lt = l ? l.t : 20, rt = r ? r.t : 20;
      v.steer = lt > rt ? -1 : 1; // + вправо; l — слева
      v.steer = lt > rt ? -1 : 1;
      ai.avoid = 0.5;
    }
    let want = d > 40 ? v.spec.max * 0.95 : d > 14 ? 14 : d > 6 ? 6 : 0;
    if (hitC) want = Math.min(want, hitC.t * 1.2);
    const ob = Veh.obstacleAhead(v, 8 + Math.abs(v.speed));
    if (ob < 6) want = Math.min(want, Math.max(0, ob - 2) * 1.5);
    const dv = want - v.speed;
    if (dv > 0) { v.throttle = clamp(dv * 0.5, 0.2, 1); v.brake = 0; } else { v.throttle = 0; v.brake = clamp(-dv * 0.2, 0, 1); }
    if (Math.abs(err) > 1.9 && d < 25 && Math.abs(v.speed) < 8) { v.throttle = -0.7; v.brake = 0; v.steer = -v.steer; } // разворот задним
    if (Math.abs(v.speed) < 0.6 && d > 8) { ai.stuckT = (ai.stuckT || 0) + dt; if (ai.stuckT > 1.5) { ai.revT = 1.2; ai.stuckT = 0; } } else ai.stuckT = Math.max(0, (ai.stuckT || 0) - dt);
    if (ai.revT > 0) { ai.revT -= dt; v.throttle = -0.9; v.brake = 0; v.steer = -v.steer; }
    v.siren = true;
    // остановка рядом с игроком: выходят офицеры
    if (d < 13 && Math.abs(v.speed) < 3 && !ai.dismounted && !pl.veh?.spec.police) { ai.dismounted = true; if (G.police) G.police.dismount(v); }
    if (d < 13 && ai.dismounted && Math.abs(pl.veh ? pl.veh.speed : 0) > 4) ai.dismounted = false; // игрок уехал — снова гонимся
  },

  // ---------- обновление ----------
  update(dt) {
    const g = Veh.grid; g.clear();
    for (const v of Veh.list) g.add(v, v.x, v.z);
    const cam = G.cam;
    for (let i = Veh.list.length - 1; i >= 0; i--) {
      const v = Veh.list[i];
      v.life += dt;
      if (v.dead) Veh.burnUpdate(v, dt);
      if (!v.playerDriven && v.ai && !v.dead) { if (v.ai.mode === 'police') Veh.policeAI(v, dt); else if (v.ai.mode === 'traffic') Veh.trafficAI(v, dt); }
      if (v.mode === 'parked' && !v.playerDriven && !v.ai) { v.throttle = 0; v.brake = 1; v.hb = true; } else if (!v.playerDriven && !v.ai) { v.brake = Math.max(v.brake, 0.3); }
      if (v.wreck) { v.throttle = 0; v.brake = 0.4; v.steer = 0; }
      if (v.mode === 'parked' && !v.playerDriven && Math.abs(v.speed) < 0.05 && dist2(v.vx, v.vz, 0, 0) < 0.01) { v.parkedLock = true; }
      else v.parkedLock = false;
      if (!(v.parkedLock)) Veh.step(v, dt);
      Veh.updateMesh(v, dt);
      // очистка
      if (!v.playerDriven && cam) {
        const d2 = dist2(v.x, v.z, G.player.x, G.player.z);
        const far = v.mode === 'parked' ? 300 : 280;
        if ((d2 > far * far && !v.playerOwned) || (v.wreck && v.life > 400 && d2 > 60 * 60)) { Veh.remove(v); continue; }
      }
    }
    Veh.collideVehicles(dt);
  },
  burnUpdate(v, dt) {
    if (v.wreck) {
      v.burning -= dt * 0.03;
      if (v.burning > 0.05) { FX.fire(v.x + rand(-1, 1), 0.9, v.z + rand(-1.5, 1.5), 1.6); if (chance(0.3)) FX.smoke(v.x, 1.5, v.z, 2, 3, 0.1, 3); }
      return;
    }
    v.fuse -= dt;
    v.smokeT = (v.smokeT || 0) - dt;
    if (v.smokeT < 0) { v.smokeT = 0.05; FX.fire(v.x + Math.sin(v.heading) * v.L * 0.3, 0.9, v.z + Math.cos(v.heading) * v.L * 0.3, 1.1); FX.smoke(v.x, 1.4, v.z, 1.5, 2.2, 0.1, 2.5); }
    if (v.playerDriven && G.player) G.player.hurt(dt * 12, 'fire');
    if (v.fuse <= 0) Veh.explode(v);
  },
  updateMesh(v, dt) {
    const g = v.group;
    g.position.set(v.x, (v.pop || 0) * 0.25, v.z);
    g.rotation.set(v.pitch, v.heading, v.roll, 'YXZ');
    const p = v.parts;
    v.wheelSpin += (v.speed / (v.spec.wr || 0.3)) * dt;
    if (p.fAxle) { p.fAxle.rotation.y = -v.steerAng * (v.isBike ? 1.2 : 0.9); p.fAxle.userData.spin.rotation.x = v.wheelSpin; p.rAxle.userData.spin.rotation.x = v.wheelSpin; }
    if (v.isBike) { g.rotation.z = clamp(-v.steerAng * v.speed * 0.05, -0.5, 0.5) + v.roll; return; }
    // цвет обгоревшего кузова
    if (v.wreck && !v.wreckTinted) { v.wreckTinted = true; v.m.bodyMesh.material = v.m.bodyMesh.material.clone(); v.m.bodyMesh.material.color.setScalar(0.18); }
    // свет
    const night = G.env ? G.env.night > 0.45 || G.env.dark > 0.5 : false;
    const on = !v.engineOff && !v.wreck && (night || v.mode === 'player' || v.spec.police && v.siren);
    const lit = !v.engineOff && !v.wreck && night;
    if (p.head) p.head.material.color.setHex(lit ? 0xfff8d0 : 0xd8d2b0);
    if (p.tail) p.tail.material.color.setHex(v.brake > 0.3 && !v.wreck ? 0xff2a1a : lit ? 0xb01810 : 0x5a1010);
    if (p.beam) { p.beam.visible = lit && (v.playerDriven || dist2(v.x, v.z, G.cam.x, G.cam.z) < 130 * 130); }
    void on;
    // мигалки
    if (p.siren) {
      const act = v.siren && !v.wreck;
      const ph = Math.floor(G.time * 7) % 2;
      p.siren[0].visible = act ? ph === 0 : false; p.siren[1].visible = act ? ph === 1 : false;
      p.siren[0].material.color.setHex(0x3366ff); p.siren[1].material.color.setHex(0xff2222);
      if (!act) { p.siren[0].visible = true; p.siren[1].visible = true; p.siren[0].material.color.setHex(0x223366); p.siren[1].material.color.setHex(0x662222); }
    }
    // дым от повреждений
    if (v.smoking && !v.dead && chance(dt * 10)) FX.smoke(v.x + Math.sin(v.heading) * v.L * 0.4, 1.0, v.z + Math.cos(v.heading) * v.L * 0.4, 0.8, 1.4, 0.25, 1.2);
    // следы заноса
    if (v.slip > 4 && Math.abs(v.speed) > 4 && !v.isBike && chance(dt * 30)) FX.dust(v.x - Math.sin(v.heading) * v.L * 0.3, v.z - Math.cos(v.heading) * v.L * 0.3, 1, 0.75);
    // водитель виден вблизи
    if (v.driverMesh) v.driverMesh.visible = dist2(v.x, v.z, G.cam.x, G.cam.z) < 60 * 60;
    // видимость
    g.visible = dist2(v.x, v.z, G.cam.x, G.cam.z) < 320 * 320;
  },

  // ---------- трафик ----------
  spawnTraffic(near, minR, maxR, behind = false) {
    const pt = City.randomRoadPoint(near, minR, maxR);
    if (!pt) return null;
    const e = pt.e;
    if (e.road.lvl < 1) return null;
    // не в кадре
    if (!behind && G.camFwd) {
      const dx = pt.x - G.cam.x, dz = pt.z - G.cam.z, d = Math.hypot(dx, dz);
      if (d < 140 && (dx * G.camFwd.x + dz * G.camFwd.z) / d > 0.4) return null;
    }
    let busy = false;
    Veh.grid.near(pt.x, pt.z, 12, (o) => { if (dist2(o.x, o.z, pt.x, pt.z) < 100) { busy = true; return false; } });
    if (busy || City.isWater(pt.x, pt.z)) return null;
    let id = pick(TRAFFIC_MIX);
    if (id === 'bus' && e.road.lvl < 2) id = 'vaz2109';
    const lane = chance(0.6) ? 0 : 1;
    const off = laneOffset(e, lane);
    const [x, z] = edgePoint(e, pt.s, off);
    const h = Math.atan2(e.dx, e.dz);
    const v = Veh.spawn(id, x, z, h, { driver: true, ai: 'traffic' });
    v.ai.lane = lane; Veh.assignEdge(v, e, pt.s);
    v.speed = Math.min(e.limit * 0.7, v.spec.max * 0.5); v.vx = Math.sin(h) * v.speed; v.vz = Math.cos(h) * v.speed;
    if (G.env && G.env.night > 0.45) v.lightsOn = true;
    return v;
  },
  spawnParked(near, minR, maxR) {
    const pt = City.randomRoadPoint(near, minR, maxR);
    if (!pt) return null;
    const e = pt.e;
    if (e.road.ring || e.len < 20) return null;
    const side = chance(0.5) ? 1 : -1;
    const off = side * (e.w / 2 - 1.0);
    const [x, z] = edgePoint(e, pt.s, off);
    let busy = false;
    Veh.grid.near(x, z, 10, (o) => { if (dist2(o.x, o.z, x, z) < 30) { busy = true; return false; } });
    if (busy || City.isWater(x, z)) return null;
    if (G.camFwd) { const dx = x - G.cam.x, dz = z - G.cam.z, d = Math.hypot(dx, dz); if (d < 120 && d > 1 && (dx * G.camFwd.x + dz * G.camFwd.z) / d > 0.5) return null; }
    const id = pick(['vaz2107', 'vaz2107', 'vaz2109', 'volga', 'moskvich', 'uaz', 'vaz2109', 'gazel', 'bmw', 'mers', 'vaz2107']);
    const h = Math.atan2(e.dx, e.dz) + (side > 0 ? 0 : Math.PI) + rand(-0.05, 0.05);
    const v = Veh.spawn(id, x, z, h, { mode: 'parked' });
    v.hb = true; v.parkedLock = true;
    return v;
  },
  spawnBike(near, minR, maxR) {
    const pt = City.randomRoadPoint(near, minR, maxR);
    if (!pt) return null;
    const e = pt.e;
    const side = chance(0.5) ? 1 : -1;
    const off = side * (e.w / 2 + 2.0);
    const [x, z] = edgePoint(e, pt.s, off);
    if (City.isWater(x, z)) return null;
    const r = resolveCircle(x, z, 0.5, { x: 0, z: 0 });
    if (r.hit) return null;
    const h = Math.atan2(e.dx, e.dz) + rand(-0.3, 0.3) + (chance(0.5) ? Math.PI : 0);
    const v = Veh.spawn('bike', x, z, h, { mode: 'parked' });
    v.parkedLock = true; v.hb = true;
    return v;
  },
  manage(dt) {
    const pl = G.player, cam = G.cam;
    if (!pl || !cam) return;
    Veh._t = (Veh._t || 0) - dt;
    if (Veh._t > 0) return;
    Veh._t = 0.25;
    const focus = { x: pl.x, z: pl.z };
    const night = G.env ? G.env.night : 0;
    const q = G.quality === 'low' ? 0.5 : G.quality === 'medium' ? 0.75 : 1;
    const wantT = Math.round(Veh.wantTraffic * q * (1 - night * 0.45));
    let nT = 0, nP = 0, nB = 0;
    for (const v of Veh.list) { if (v.mode === 'traffic' && v.ai && v.ai.mode === 'traffic') nT++; else if (v.mode === 'parked' && !v.playerOwned) { if (v.isBike) nB++; else nP++; } }
    if (nT < wantT) Veh.spawnTraffic(focus, 80, 230);
    if (nP < Veh.wantParked * q) Veh.spawnParked(focus, 25, 180);
    if (nB < Veh.wantBikes) Veh.spawnBike(focus, 20, 140);
  },
};
G.Veh = Veh;
void TAU; void lerp; void rand; void Rig;
