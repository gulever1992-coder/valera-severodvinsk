// Игрок (Валера): управление пешком, стрельба, драка, укрытия, транспорт, камера, смерть и задержание
import * as THREE from 'three';
import { G } from './state.js';
import { City } from './city.js';
import { WEAPONS, AMMO_TYPES } from './data.js';
import { Rig, pedLook, makePedGeoms } from './models.js';
import { Snd, Radio } from './audio.js';
import { FX } from './fx.js';
import { Combat } from './combat.js';
import { Veh } from './vehicles.js';
import {
  clamp, lerp, rand, chance, damp, angDiff, angNorm, dist, dist2, resolveCircle, rayObst, TAU, pick,
} from './util.js';

const K = () => G.input.keys;
const PR = () => G.input.pressed;

export const Player = {
  x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0.25, yawBody: 0, camYaw: 0,
  health: 100, maxHealth: 100, armor: 0, stamina: 100, staminaLock: false, exp: 0, strength: 0,
  dead: false, deadT: 0, veh: null, cur: 'fist', weapons: { fist: true }, mag: {}, ammo: { pistol: 0, shell: 0, smg: 0, rifle: 0 }, grenades: 0,
  aiming: false, crouching: false, cover: null, coverLow: false, sprinting: false, fireT: 0, reloadT: 0, punchT: 0, meleeHitT: -1, combo: 0, comboT: 0, lastFire: -9, lastHurt: -9,
  nearPoi: null, nearVeh: null, nearMug: null, hitFlash: 0, stepD: 0, bikeTick: 0, aimHit: null, aimPoint: new THREE.Vector3(), enterCd: 0,
  busted_: false, respawnT: 0, gunHeld: false, stat: {},
  init() {
    const look = pedLook('valera');
    Player.rig = new Rig(look, { geoms: makePedGeoms(look), shadow: true });
    G.scene.add(Player.rig.root);
    Player.cam = G.camera;
    Player.camPos = new THREE.Vector3(); Player.camTarget = new THREE.Vector3();
    G.player = Player;
    Player.giveWeapon('fist', true);
  },
  setPos(x, z, yaw) { Player.x = x; Player.z = z; Player.y = 0; Player.vx = Player.vz = 0; if (yaw !== undefined) { Player.yaw = yaw; Player.yawBody = yaw; Player.camYaw = yaw; } },

  // ---------- инвентарь ----------
  giveWeapon(id, silent) {
    const w = WEAPONS[id];
    if (!w) return;
    if (!Player.weapons[id]) { Player.weapons[id] = true; if (w.mag) Player.mag[id] = w.mag; }
    if (w.ammoType && w.ammoPack && id !== 'grenade' && id !== 'molotov') Player.ammo[w.ammoType] += w.ammoPack;
    if (id === 'grenade' || id === 'molotov') { Player.thrown = Player.thrown || { grenade: 0, molotov: 0 }; Player.thrown[id] += 1; }
    if (!silent) { Snd.pickup(); Player.select(id); }
  },
  addAmmo(type, n) { Player.ammo[type] = (Player.ammo[type] || 0) + n; },
  getThrown(id) { return (Player.thrown && Player.thrown[id]) || 0; },
  select(id) {
    if (!Player.weapons[id] || Player.cur === id) return;
    Player.cur = id; Player.reloadT = 0; Player.fireT = 0.2;
    Snd.weaponSwitch();
    Player.rig.setWeapon(id);
    if (G.ui) G.ui.weaponChanged();
  },
  cycleSlot(slot) {
    const ids = Object.keys(WEAPONS).filter((id) => WEAPONS[id].slot === slot && Player.weapons[id]);
    if (!ids.length) return;
    const i = ids.indexOf(Player.cur);
    Player.select(ids[(i + 1) % ids.length]);
  },
  cycleWheel(dir) {
    const ids = Object.keys(WEAPONS).filter((id) => Player.weapons[id]);
    const i = ids.indexOf(Player.cur);
    Player.select(ids[(i + dir + ids.length) % ids.length]);
  },
  heal(n) { Player.health = Math.min(Player.maxHealth, Player.health + n); },
  addArmor(n) { Player.armor = Math.min(100, Player.armor + n); },
  addExp(n) { Player.exp += n; const lvl = Math.floor(Player.exp / 120); if (lvl > Player.strength) { Player.strength = lvl; G.ui && G.ui.notify(`Сила выросла: ${lvl}`, 'good'); } },

  // ---------- урон ----------
  hurt(dmg, src) {
    if (Player.dead || dmg <= 0 || Player.busted_ || G.godMode) return;
    Player.lastHurt = G.time;
    if (Player.armor > 0) { const a = Math.min(Player.armor, dmg * 0.8); Player.armor -= a; dmg -= a; }
    Player.health -= dmg;
    Player.hitFlash = Math.min(1, Player.hitFlash + dmg / 40);
    G.shake = Math.min(1, G.shake + dmg * 0.01);
    if (dmg > 5) Snd.grunt(Player.x, Player.z, 0.9);
    if (Player.health <= 0) Player.die(src);
  },
  die(src) {
    if (Player.dead) return;
    Player.dead = true; Player.deadT = 0; Player.health = 0;
    if (Player.veh) Player.forceExit(true);
    Snd.death(Player.x, Player.z, 0.9); Snd.wasted();
    Player.aiming = false; Player.cover = null;
    G.ui && G.ui.showWasted('ПОГИБ');
  },
  onBusted() {
    Player.busted_ = true; Player.deadT = 0;
    if (Player.veh) Player.forceExit(false);
    Snd.busted();
    G.ui && G.ui.showWasted('ЗАДЕРЖАН', true);
    const fine = Math.min(3000, Math.floor(G.money * 0.12));
    G.money -= fine;
    Player.fine = fine;
  },
  respawn() {
    const busted = Player.busted_;
    const poiKind = busted ? 'police' : 'hospital';
    const poi = City.pois.find((p) => p.kind === poiKind) || City.pois[0];
    const cost = busted ? 0 : Math.min(1500, Math.floor(G.money * 0.08));
    G.money -= cost;
    if (busted) { for (const id of Object.keys(Player.weapons)) if (id !== 'fist') delete Player.weapons[id]; Player.ammo = { pistol: 0, shell: 0, smg: 0, rifle: 0 }; Player.thrown = { grenade: 0, molotov: 0 }; Player.cur = 'fist'; Player.rig.setWeapon(null); }
    Player.setPos(poi.x, poi.z + 3, Math.PI);
    Player.dead = false; Player.busted_ = false; Player.health = Player.maxHealth; Player.armor = 0; Player.deadT = 0; Player.stamina = 100;
    G.police.clear();
    G.ui && G.ui.hideWasted(busted ? `Штраф: ${Player.fine || 0} ₽. Оружие изъято.` : `Лечение в больнице: ${cost} ₽.`);
    // ближайшие враги теряют цель
    for (const p of G.peds) if (p.tgt === Player) { p.tgt = null; }
    if (G.env) G.env.hour = (G.env.hour + 2) % 24;
    Player.rig.root.rotation.x = 0;
  },

  // ---------- транспорт ----------
  findVehicle() {
    let best = null, bd = 3.6 * 3.6;
    for (const v of G.vehicles) {
      if (v.wreck || v.burning > 0.5 && v.dead) continue;
      const dx = v.x - Player.x, dz = v.z - Player.z;
      const d = dx * dx + dz * dz - (v.L * 0.15) * (v.L * 0.15);
      // расстояние до габарита
      const near = Veh.hitTest(v, Player.x, Player.z, 1.7);
      if (!near) continue;
      if (d < bd || !best) { if (!best || d < bd) { bd = Math.min(bd, d); best = v; } }
    }
    return best;
  },
  enterVehicle(v) {
    if (Player.veh || Player.dead) return;
    const wasParked = v.mode === 'parked';
    if (v.driver && v.ai) {
      // угон с водителем
      Player.carjack(v);
    } else if (!v.isBike) {
      // угон припаркованной
      if (wasParked && G.police) {
        let copNear = false; for (const p of G.peds) if ((p.type === 'cop' || p.type === 'omon') && !p.dead && dist2(p.x, p.z, v.x, v.z) < 50 * 50) { copNear = true; break; }
        if (copNear || v.spec.police) G.police.report('theft', v.x, v.z, v.spec.police ? 2 : 1);
        else if (chance(0.3)) G.police.report('theft', v.x, v.z, 0.5);
      }
    } else { for (const p of G.peds) if ((p.type === 'cop') && !p.dead && dist2(p.x, p.z, v.x, v.z) < 40 * 40) { G.police.report('theft', v.x, v.z, 1); break; } }
    Player.veh = v; v.playerDriven = true; v.mode = 'player'; v.ai = null; v.engineOff = false; v.hb = false; v.parkedLock = false; v.playerOwned = true; v.siren = false;
    v.stolen = true; v.rider = Player;
    if (v.spec.police) { v.siren = false; }
    Player.cover = null; Player.aiming = false;
    Player.enterCd = 0.4;
    Snd.door(v.x, v.z);
    if (!v.isBike) setTimeout(() => Snd.ignition(), 150);
    G.stats.cars++;
    Player.rig.root.visible = v.isBike;
    Player.rig.setWeapon(null);
    G.ui && G.ui.vehicleName(v.spec.name);
    Radio.set(Radio.cur >= 0 ? Radio.cur : (v.isBike ? -1 : 0));
    if (Radio.cur >= 0) G.ui && G.ui.radioName(Radio.stations[Radio.cur].name);
  },
  carjack(v) {
    // вытаскиваем водителя
    const pos = Veh.doorPos(v, 1);
    const isCopCar = v.spec.police;
    const p = G.Peds.spawn(isCopCar ? 'cop' : (v.spec.taxi || v.spec.kind === 'bus') ? 'civ' : 'civ', pos.x, pos.z, { kind: 'default' });
    p.down = 1.8;
    if (isCopCar) { p.state = 'attack'; p.tgt = Player; p.weapon = 'pm'; p.rig.setWeapon('pm'); G.police.report('copcar', v.x, v.z, 3, true); }
    else { p.fear = 12; p.fearSrc = Player; G.police.report('carjack', v.x, v.z, 1.5); if (chance(0.25) && !v.spec.bus) { p.state = 'attack'; p.tgt = Player; p.fear = 0; p.hostile = true; } }
    Snd.scream(p.x, p.z, p.voice);
    Veh.removeDriver(v);
  },
  exitVehicle() {
    const v = Player.veh;
    if (!v) return;
    const pos = Veh.freeExit(v);
    Player.x = pos.x; Player.z = pos.z; Player.y = 0;
    v.playerDriven = false; v.rider = null; v.hb = true; v.throttle = 0; v.steer = 0; v.mode = 'parked'; v.brake = 0.5; v.engineOff = true; v.siren = false;
    Snd.hornOn(v, false);
    Snd.door(v.x, v.z);
    if (Math.abs(v.speed) > 8) Player.hurt(Math.abs(v.speed) * 1.2, 'jump');
    Player.vx = v.vx * 0.5; Player.vz = v.vz * 0.5;
    Player.veh = null; Player.enterCd = 0.4;
    Player.rig.root.visible = true; Player.rig.setWeapon(Player.cur === 'fist' ? null : Player.cur);
    Player.yaw = v.heading; Player.yawBody = v.heading;
    Radio.update(0);
  },
  forceExit(dead) {
    const v = Player.veh;
    if (!v) return;
    v.playerDriven = false; v.rider = null;
    const pos = Veh.freeExit(v);
    Player.x = pos.x; Player.z = pos.z; Player.veh = null; Player.enterCd = 0.6;
    Player.rig.root.visible = true; Player.rig.setWeapon(Player.cur === 'fist' ? null : Player.cur);
    Player.vx = v.vx * 0.6; Player.vz = v.vz * 0.6;
    if (!dead && v.isBike) Player.hurt(6, 'jump');
  },

  // ---------- прицел ----------
  computeAim() {
    const cam = Player.cam;
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    const hl = Math.hypot(dir.x, dir.z) || 1e-6;
    const hx = dir.x / hl, hz = dir.z / hl;
    let tH = 90 * hl;
    let hit = null;
    const st = rayObst(ox, oz, hx, hz, 90, 2.0);
    if (st) tH = Math.min(tH, st.t);
    for (const p of G.peds) {
      if (p.dead || p.veh) continue;
      const rx = p.x - ox, rz = p.z - oz, t = rx * hx + rz * hz;
      if (t < 1 || t > tH) continue;
      if (Math.abs(rx * hz - rz * hx) > 0.5) continue;
      const y = oy + (dir.y / hl) * t;
      if (y < 0 || y > 1.9) continue;
      tH = t; hit = p;
    }
    for (const v of G.vehicles) {
      if (v.playerDriven) continue;
      if (dist2(v.x, v.z, ox, oz) > (tH + 8) * (tH + 8)) continue;
      const t = Combat.rayVeh(v, ox, oz, hx, hz, tH);
      if (t !== null && t > 1 && t < tH) { const y = oy + (dir.y / hl) * t; if (y > 0 && y < 1.8) { tH = t; hit = v; } }
    }
    const t3 = tH / hl;
    Player.aimPoint.set(ox + dir.x * t3, oy + dir.y * t3, oz + dir.z * t3);
    Player.aimHit = hit;
    return Player.aimPoint;
  },
  muzzle() {
    const fx = Math.sin(Player.yawBody), fz = Math.cos(Player.yawBody);
    const rx = -fz, rz = fx;
    const h = Player.crouching ? 1.05 : 1.4;
    return new THREE.Vector3(Player.x + fx * 0.7 - rx * 0.22, Player.y + h, Player.z + fz * 0.7 - rz * 0.22);
  },

  // ---------- основной апдейт ----------
  update(dt) {
    const inp = G.input;
    Player.enterCd = Math.max(0, Player.enterCd - dt);
    Player.hitFlash = Math.max(0, Player.hitFlash - dt * 1.5);
    Player.fireT = Math.max(0, Player.fireT - dt);
    Player.comboT = Math.max(0, Player.comboT - dt);
    if (Player.comboT <= 0) Player.combo = 0;
    if (G.freeze) { Player.updateCamera(dt); Player.animate(dt); return; }
    // мышь
    const sens = (G.settings ? G.settings.sens : 1) * 0.0022 * (Player.aiming ? 0.7 : 1);
    if (document.pointerLockElement || G.debugLook) {
      Player.yaw -= inp.mouseDX * sens;
      Player.pitch = clamp(Player.pitch + inp.mouseDY * sens, -0.45, 1.05);
      Player.yaw = angNorm(Player.yaw);
    }
    inp.mouseDX = inp.mouseDY = 0;
    if (Player.dead || Player.busted_) return Player.updateDead(dt);
    // регенерация до 50%
    if (G.time - Player.lastHurt > 8 && Player.health < Player.maxHealth * 0.5) Player.health = Math.min(Player.maxHealth * 0.5, Player.health + dt * 2.5);
    if (Player.veh) Player.updateVehicle(dt); else Player.updateFoot(dt);
    Player.updateCamera(dt);
    Player.animate(dt);
    // пульс при низком здоровье
    if (Player.health < 30) { Player.hbT = (Player.hbT || 0) - dt; if (Player.hbT < 0) { Player.hbT = 0.9; Snd.heartbeat(); } }
  },
  updateDead(dt) {
    Player.deadT += dt;
    Player.vx *= 0.9; Player.vz *= 0.9;
    Player.x += Player.vx * dt; Player.z += Player.vz * dt;
    if (Player.deadT > 4.8) Player.respawn();
    Player.updateCamera(dt);
    Player.rig.update(dt, { dead: Math.min(1, Player.deadT * 3), speed: 0 });
    Player.rig.root.position.set(Player.x, 0, Player.z);
    Player.rig.root.rotation.y = Player.yawBody;
  },
  updateFoot(dt) {
    const k = K(), p = PR();
    const inp = G.input;
    // ввод
    let mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), mz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const moving = mx !== 0 || mz !== 0;
    const fx = Math.sin(Player.yaw), fz = Math.cos(Player.yaw), rx = -fz, rz = fx;
    let dx = fx * mz + rx * mx, dz = fz * mz + rz * mx;
    const dl = Math.hypot(dx, dz); if (dl > 0) { dx /= dl; dz /= dl; }
    const w = WEAPONS[Player.cur];
    const ranged = !!(w && !w.melee && !w.thrown);
    const isThrown = !!(w && w.thrown);
    // приседание
    if (p.KeyC || p.ControlLeft) Player.crouching = !Player.crouching;
    if (k.ShiftLeft && moving) Player.crouching = false;
    // прицеливание
    Player.aiming = !!(inp.buttons[2] && (ranged || isThrown)) && !Player.reloadT;
    if (ranged && !Player.aiming && G.time - Player.lastFire < 0.5) Player.aiming = false;
    // укрытие
    if (p.KeyQ) {
      if (Player.cover) Player.cover = null;
      else {
        const out = {};
        const r = resolveCircle(Player.x, Player.z, 1.0, out, 0.9);
        if (r.hit) { Player.cover = { nx: r.nx, nz: r.nz, low: r.obj.h < 1.7 }; Player.coverLow = r.obj.h < 1.7; Player.crouching = Player.coverLow; Snd.click(); }
        else G.ui && G.ui.floatText('Нет укрытия рядом');
      }
    }
    // скорость
    let speed = 3.9;
    Player.sprinting = false;
    if (Player.crouching) speed = 1.8;
    else if (k.ShiftLeft && moving && !Player.aiming && !Player.staminaLock && Player.stamina > 0 && !Player.cover) { speed = 6.6 + Player.strength * 0.1; Player.sprinting = true; }
    if (Player.aiming) speed = Math.min(speed, 2.6);
    if (Player.cover) speed = 1.9;
    // выносливость
    if (Player.sprinting) { Player.stamina -= dt * 20; if (Player.stamina <= 0) { Player.stamina = 0; Player.staminaLock = true; } }
    else { Player.stamina = Math.min(100, Player.stamina + dt * (moving ? 10 : 18)); if (Player.stamina > 25) Player.staminaLock = false; }
    // движение
    let tvx = dx * speed, tvz = dz * speed;
    if (Player.cover) {
      const c = Player.cover;
      const tx = c.nz, tz = -c.nx;
      const along = dx * tx + dz * tz;
      const away = dx * c.nx + dz * c.nz;
      const rs = Player.aiming ? 0.4 : 1;
      tvx = tx * along * speed * rs; tvz = tz * along * speed * rs;
      if (away > 0.7 && moving) { Player.coverLeave = (Player.coverLeave || 0) + dt; if (Player.coverLeave > 0.25) { Player.cover = null; Player.coverLeave = 0; } } else Player.coverLeave = 0;
    }
    const kk = 1 - Math.exp(-(Player.y > 0.05 ? 3 : 12) * dt);
    Player.vx += (tvx - Player.vx) * kk; Player.vz += (tvz - Player.vz) * kk;
    // прыжок
    if (p.Space && Player.y <= 0.02 && !Player.cover && !Player.crouching && Player.stamina > 5) { Player.vy = 5.4; Snd.jump(); Player.stamina -= 5; }
    Player.vy -= 16 * dt; Player.y += Player.vy * dt;
    if (Player.y <= 0) { if (Player.vy < -4) { Snd.land(Player.x, Player.z); if (Player.vy < -9) Player.hurt(-Player.vy * 2, 'fall'); } Player.y = 0; Player.vy = 0; }
    let nx = Player.x + Player.vx * dt, nz = Player.z + Player.vz * dt;
    const r = resolveCircle(nx, nz, 0.36, { x: 0, z: 0 }, Player.y > 0.6 ? 1.0 : 0.8);
    nx = r.x; nz = r.z;
    if (City.isWater(nx, nz)) { nx = Player.x; nz = Player.z; }
    Player.x = clamp(nx, -38, 1243); Player.z = clamp(nz, -38, 658);
    // толчок от машин/людей (мягко)
    // держим у стены в укрытии
    if (Player.cover) {
      const rr = resolveCircle(Player.x, Player.z, 0.62, { x: 0, z: 0 }, 0.9);
      Player.x = rr.x; Player.z = rr.z;
      const probe = resolveCircle(Player.x, Player.z, 0.9, { x: 0, z: 0 }, 0.9);
      if (!probe.hit) Player.cover = null; else { Player.cover.nx = probe.nx; Player.cover.nz = probe.nz; }
    }
    // поворот корпуса
    const shooting = G.time - Player.lastFire < 0.7 || Player.punchT > 0;
    if (Player.cover && !Player.aiming) Player.yawBody += angDiff(Player.yawBody, Math.atan2(Player.cover.nx, Player.cover.nz)) * (1 - Math.exp(-14 * dt));
    else if (Player.aiming || shooting || (ranged && inp.buttons[0])) Player.yawBody += angDiff(Player.yawBody, Player.yaw) * (1 - Math.exp(-18 * dt));
    else if (moving) Player.yawBody += angDiff(Player.yawBody, Math.atan2(dx, dz)) * (1 - Math.exp(-14 * dt));
    // шаги
    const sp = Math.hypot(Player.vx, Player.vz);
    if (sp > 0.5 && Player.y < 0.05) {
      Player.stepD += sp * dt;
      const stride = Player.sprinting ? 2.6 : Player.crouching ? 1.2 : 1.9;
      if (Player.stepD > stride) {
        Player.stepD = 0;
        const nr = City.nearestRoad(Player.x, Player.z, 20);
        let surf = 'asphalt';
        if (!nr || nr.dist > nr.road.w / 2 + 3.6) surf = 'grass';
        if (G.env && G.env.snowGround > 0.35 && surf === 'grass') surf = 'snow';
        Snd.step(surf, Player.sprinting, Player.x, Player.z);
      }
    }
    // взаимодействие
    Player.interact(dt);
    // оружие
    Player.weaponLogic(dt, w, ranged, isThrown);
    // выбор оружия
    for (let i = 1; i <= 8; i++) if (p['Digit' + i]) { if (i === 1) Player.select('fist'); else Player.cycleSlot(i); }
    if (inp.wheel) { Player.cycleWheel(inp.wheel > 0 ? 1 : -1); inp.wheel = 0; }
  },
  interact(dt) {
    const p = PR();
    // ближайшая точка интереса
    let poi = null, pd = 3.2 * 3.2;
    for (const q of City.pois) { if (!q.marker) continue; const d = dist2(Player.x, Player.z, q.x, q.z); if (d < pd) { pd = d; poi = q; } }
    Player.nearPoi = poi;
    // транспорт
    Player.nearVeh = Player.enterCd > 0 ? null : Player.findVehicle();
    // ограбление
    let mug = null;
    for (const q of G.peds) { if (q.dead || q.type !== 'civ' || q.state !== 'cower') continue; if (dist2(q.x, q.z, Player.x, Player.z) < 3 * 3) { mug = q; break; } }
    Player.nearMug = mug;
    G.ui && G.ui.setPrompt(Player.prompt());
    if ((p.KeyE || p.KeyF) && !G.freeze) {
      if (Player.nearVeh && (!poi || p.KeyF)) Player.enterVehicle(Player.nearVeh);
      else if (poi) G.ui.openShop(poi);
      else if (mug) { const c = mug.cash; mug.cash = 0; G.money += c; Snd.cash(); G.ui.floatText(`Ограблен: +${c} ₽`); mug.fear = 15; mug.state = 'flee'; G.police.report('assault', mug.x, mug.z, 1); }
    }
  },
  prompt() {
    if (Player.nearVeh && !Player.veh) { const v = Player.nearVeh; return { key: 'F', text: v.driver && v.ai ? `Угнать ${v.spec.name}` : v.isBike ? 'Сесть на велосипед' : `Сесть в ${v.spec.name}` }; }
    if (Player.nearPoi) { const k = Player.nearPoi.kind; const t = { shop: 'Зайти в магазин', pharm: 'Аптека', food: 'Купить еды', weapon: 'Оружейный отдел', black: 'Чёрный рынок', repair: 'Мастерская', gym: 'Тренировка', home: 'Гараж: сохранение / сон', hospital: 'Больница', police: 'Отдел милиции' }[k]; return t ? { key: 'E', text: t } : null; }
    if (Player.nearMug) return { key: 'E', text: 'Ограбить' };
    return null;
  },
  weaponLogic(dt, w, ranged, isThrown) {
    const inp = G.input;
    const lmb = inp.buttons[0], lmbP = inp.pressedBtn && inp.pressedBtn[0];
    const p = PR();
    // перезарядка
    if (Player.reloadT > 0) {
      Player.reloadT -= dt;
      if (Player.reloadT <= 0) {
        const need = w.mag - (Player.mag[Player.cur] || 0);
        const take = Math.min(need, Player.ammo[w.ammoType] || 0);
        Player.mag[Player.cur] = (Player.mag[Player.cur] || 0) + take; Player.ammo[w.ammoType] -= take;
        G.ui && G.ui.weaponChanged();
      }
    }
    if (ranged && p.KeyR && Player.reloadT <= 0 && (Player.mag[Player.cur] || 0) < w.mag && (Player.ammo[w.ammoType] || 0) > 0) { Player.reloadT = 1.3; Snd.reload(); }
    if (Player.meleeHitT >= 0) {
      Player.meleeHitT -= dt;
      if (Player.meleeHitT < 0) { const hit = Combat.playerMelee(Player, Player.cur); if (!hit) { /* мимо */ } Player.meleeHitT = -1; }
    }
    if (Player.punchT > 0) Player.punchT = Math.max(0, Player.punchT - dt * (Player.cur === 'bat' ? 2.2 : 3.2));
    if (Player.cover && !Player.aiming && ranged) return; // из укрытия без прицела не стреляем
    if (G.ui && G.ui.blocking()) return;
    if (w.melee) {
      if (lmbP && Player.fireT <= 0 && !Player.veh) {
        Player.fireT = w.rate; Player.punchT = 1; Player.meleeHitT = 0.14;
        Player.combo = Player.comboT > 0 ? Player.combo + 1 : 0; Player.comboT = 0.9;
        Snd.swing(); Player.lastFire = G.time;
        Player.yawBody = Player.yaw;
        // подшаг вперёд
        Player.vx += Math.sin(Player.yaw) * 2.2; Player.vz += Math.cos(Player.yaw) * 2.2;
      }
    } else if (isThrown) {
      if (lmbP && Player.fireT <= 0 && Player.getThrown(Player.cur) > 0) {
        Player.fireT = 0.8;
        const aim = Player.computeAim(), m = Player.muzzle();
        let dx = aim.x - m.x, dz = aim.z - m.z; const d = Math.hypot(dx, dz) || 1;
        const spd = clamp(d * 1.1 + 6, 8, 20);
        Combat.throwProj(w.thrown, m.x, 1.5, m.z, (dx / d) * spd, 4 + d * 0.12, (dz / d) * spd, 'player');
        Player.thrown[Player.cur]--; Player.lastFire = G.time; Player.punchT = 0.6;
        if (Player.thrown[Player.cur] <= 0) { Player.weapons[Player.cur] = false; Player.cur = 'fist'; Player.rig.setWeapon(null); }
        G.ui && G.ui.weaponChanged();
        G.police.report('threw', Player.x, Player.z, 2);
      }
    } else if (ranged) {
      const auto = w.auto;
      const trig = auto ? lmb : lmbP;
      if (trig && Player.fireT <= 0 && Player.reloadT <= 0 && !Player.veh) {
        if ((Player.mag[Player.cur] || 0) <= 0) {
          if ((Player.ammo[w.ammoType] || 0) > 0) { Player.reloadT = 1.3; Snd.reload(); } else { Snd.dry(); Player.fireT = 0.3; }
        } else {
          Player.mag[Player.cur]--;
          Player.fireT = w.rate; Player.lastFire = G.time;
          const aim = Player.computeAim();
          const m = Player.muzzle();
          let dx = aim.x - m.x, dy = aim.y - m.y, dz = aim.z - m.z;
          let l = Math.hypot(dx, dy, dz);
          if (l < 2) { const cd = new THREE.Vector3(); Player.cam.getWorldDirection(cd); dx = cd.x; dy = cd.y; dz = cd.z; l = 1; }
          dx /= l; dy /= l; dz /= l;
          Player.yawBody = Player.yaw;
          Combat.fire({ kind: 'player', obj: Player }, Player.cur, m.x, m.y, m.z, dx, dy, dz, { spreadMul: (Player.aiming ? 0.6 : 1.4) * (Player.crouching ? 0.8 : 1) * (Player.sprinting ? 2 : 1) });
          Player.rig.upper.rotation.x -= 0.1;
          G.ui && G.ui.weaponChanged();
          if ((Player.mag[Player.cur] || 0) <= 0 && (Player.ammo[w.ammoType] || 0) > 0) setTimeout(() => { if (Player.reloadT <= 0 && !Player.dead) { Player.reloadT = 1.3; Snd.reload(); } }, 250);
        }
      }
    }
  },
  updateVehicle(dt) {
    const v = Player.veh, k = K(), p = PR();
    if (v.dead && v.wreck) { Player.forceExit(true); return; }
    G.ui && G.ui.setPrompt(null);
    v.throttle = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    v.steer = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    v.hb = !!k.Space;
    v.brake = 0;
    if (v.isBike) { v.boost = k.ShiftLeft ? 1.55 : 1; if (v.throttle < 0 && v.speed > 0.5) { v.brake = 0.8; v.throttle = 0; } }
    // клаксон / радио / сирена
    if (k.KeyH) { Snd.hornOn(v, true); v.hornHeld = true; } else if (v.hornHeld) { Snd.hornOn(v, false); v.hornHeld = false; }
    if (v.isBike && p.KeyH) Snd.bell();
    if (p.KeyR && !v.isBike) { const n = Radio.cycle(); G.ui && G.ui.radioName(n); }
    if (p.KeyG && v.spec.police) v.siren = !v.siren;
    Player.x = v.x; Player.z = v.z;
    // стрельба из машины: запрещена (упрощение); выход
    if ((p.KeyE || p.KeyF) && Player.enterCd <= 0) Player.exitVehicle();
    // визг покрышек
    Snd.skid(!v.isBike && v.slip > 3.5 && Math.abs(v.speed) > 5 ? clamp((v.slip - 3) / 6, 0, 1) : 0, v.x, v.z);
    if (v.isBike) { Player.bikeTick -= dt * Math.abs(v.speed); if (Player.bikeTick < 0) { Player.bikeTick = 1.2; Snd.chain(v.x, v.z); } }
    // сирена и рации
    // радио звучит громче в машине
    Radio.update(v.isBike ? 0 : 0.6);
    // езда по воде запрещена в физике; пешеходы под колёсами обрабатываются в peds
    Player.y = 0;
    // ускорение видимого водителя: мигалки милицейской машины
  },
  animate(dt) {
    const rig = Player.rig;
    if (Player.dead || Player.busted_) return;
    if (Player.veh) {
      const v = Player.veh;
      if (v.isBike) {
        const s = Math.sin(v.heading), c = Math.cos(v.heading);
        rig.root.position.set(v.x - s * 0.1, 0.2, v.z - c * 0.1); rig.root.rotation.set(0, v.heading, v.group.rotation.z * 0.5);
        rig.update(dt, { speed: Math.abs(v.speed), bike: 1, sit: 0, crouch: 0, aim: 0, punch: 0, dead: 0 });
        rig.hips.position.y = 0.88 - 0.05;
      }
      return;
    }
    rig.root.rotation.set(0, Player.yawBody, 0);
    rig.root.position.set(Player.x, Player.y, Player.z);
    const w = WEAPONS[Player.cur];
    const two = ['mr153', 'akm', 'kedr', 'obrez'].includes(Player.cur);
    const armed = w && !w.melee;
    rig.update(dt, {
      speed: Math.hypot(Player.vx, Player.vz), crouch: Player.crouching ? 1 : 0, aim: Player.aiming || (armed && G.time - Player.lastFire < 0.8) ? 1 : (armed && !w.thrown ? 0.25 : 0),
      punch: Player.punchT, twohand: two, melee: !!(w && w.melee && Player.cur !== 'fist'), dead: 0, sit: 0, bike: 0, squat: 0,
    });
  },

  // ---------- камера ----------
  updateCamera(dt) {
    const cam = Player.cam;
    const P = Player;
    let tx, ty, tz, dist_, fov, shoulder = 0, pitch = P.pitch, yaw = P.yaw, height = 1.5;
    const v = P.veh;
    if (G.camOverride) {
      const o = G.camOverride;
      cam.position.set(o.px, o.py, o.pz); cam.lookAt(o.lx, o.ly, o.lz);
      if (Math.abs(cam.fov - (o.fov || 60)) > 0.01) { cam.fov = o.fov || 60; cam.updateProjectionMatrix(); }
      G.cam = { x: cam.position.x, z: cam.position.z };
      const fw = new THREE.Vector3(); cam.getWorldDirection(fw); G.camFwd = { x: fw.x, z: fw.z };
      Snd.setListener(cam.position.x, cam.position.z, Math.atan2(fw.x, fw.z));
      return;
    }
    if (P.dead || P.busted_) {
      // облёт над телом
      P.camYaw += dt * 0.25; yaw = P.camYaw; pitch = 0.9; dist_ = 5 + Math.min(4, P.deadT * 1.2); fov = 60;
      tx = P.x; ty = 0.6; tz = P.z;
    } else if (v) {
      const sp = Math.abs(v.speed);
      // камера следует за направлением машины, пока не крутят мышью
      const mouseActive = Math.abs(G.input.lastMouseT - G.time) < 1.2;
      if (!mouseActive) { P.yaw += angDiff(P.yaw, v.heading + (v.speed < -1 ? Math.PI : 0)) * (1 - Math.exp(-2.2 * dt)); }
      yaw = P.yaw; pitch = clamp(P.pitch * 0.5 + 0.12, 0, 0.6);
      dist_ = (v.isBike ? 4.2 : v.spec.kind === 'bus' ? 11.5 : v.L * 0.5 + 4.6) + sp * 0.06;
      fov = 68 + Math.min(22, sp * 0.55) + (v.boost > 1 ? 6 : 0);
      tx = v.x; tz = v.z; ty = (v.isBike ? 1.2 : v.spec.top * 0.9 + 0.2);
    } else {
      const aiming = P.aiming;
      dist_ = aiming ? 2.1 : P.cover ? 2.8 : P.crouching ? 3.3 : 3.7;
      shoulder = aiming ? 0.8 : P.cover ? (P.coverSide || 0.6) : 0.55;
      fov = aiming ? 52 : P.sprinting ? 76 : 68;
      tx = P.x; tz = P.z; ty = (P.crouching ? 1.05 : 1.55) + P.y;
      height = ty;
    }
    // FOV
    const df = damp(cam.fov, (G.settings ? G.settings.fov / 70 : 1) * fov, 6, dt);
    if (Math.abs(df - cam.fov) > 0.01) { cam.fov = df; cam.updateProjectionMatrix(); }
    // позиция
    const cp = Math.cos(pitch), sp2 = Math.sin(pitch);
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const px = tx + rx * shoulder, pz = tz + rz * shoulder;
    let camX = px - Math.sin(yaw) * cp * dist_, camY = ty + sp2 * dist_ + 0.1, camZ = pz - Math.cos(yaw) * cp * dist_;
    // столкновение камеры с препятствиями
    const dx = camX - px, dz = camZ - pz, dl = Math.hypot(dx, dz);
    if (dl > 0.05) {
      const hit = rayObst(px, pz, dx / dl, dz / dl, dl + 0.3, 2.5);
      if (hit && hit.t < dl + 0.3) { const k = Math.max(0.4, hit.t - 0.35) / dl; camX = px + dx * k; camZ = pz + dz * k; camY = ty + (camY - ty) * Math.max(0.3, k); }
    }
    camY = Math.max(camY, 0.5);
    // тряска и отдача
    const sh = G.shake || 0;
    const shx = (Math.random() - 0.5) * sh * 0.5, shy = (Math.random() - 0.5) * sh * 0.5;
    if (G.recoil) { P.pitch -= G.recoil * 0.5; G.recoil = 0; }
    // плавное следование для вида пешком
    const pos = P.camPos;
    if (!P._camInit) { pos.set(camX, camY, camZ); P._camInit = true; }
    const k = v ? 1 : 1 - Math.exp(-22 * dt);
    pos.x += (camX - pos.x) * k; pos.y += (camY - pos.y) * k; pos.z += (camZ - pos.z) * k;
    cam.position.set(pos.x + shx, pos.y + shy, pos.z);
    // цель взгляда
    const lookX = px + Math.sin(yaw) * 12, lookZ = pz + Math.cos(yaw) * 12;
    const lookY = ty - sp2 * 12 + 0.1;
    cam.lookAt(lookX, lookY, lookZ);
    G.cam = { x: cam.position.x, z: cam.position.z };
    const fw = new THREE.Vector3(); cam.getWorldDirection(fw); G.camFwd = { x: fw.x, z: fw.z };
    Snd.setListener(P.x, P.z, Math.atan2(fw.x, fw.z));
    void height;
  },
  // сохранение
  serialize() {
    return { x: Player.x, z: Player.z, yaw: Player.yaw, health: Player.health, armor: Player.armor, weapons: Player.weapons, mag: Player.mag, ammo: Player.ammo, thrown: Player.thrown, cur: Player.cur, exp: Player.exp, strength: Player.strength, maxHealth: Player.maxHealth };
  },
  load(o) {
    if (!o) return;
    Player.setPos(o.x, o.z, o.yaw);
    Object.assign(Player, { health: o.health, armor: o.armor, weapons: o.weapons || { fist: true }, mag: o.mag || {}, ammo: o.ammo || Player.ammo, thrown: o.thrown, exp: o.exp || 0, strength: o.strength || 0, maxHealth: o.maxHealth || 100 });
    Player.cur = 'fist'; Player.rig.setWeapon(null);
    if (o.cur && Player.weapons[o.cur]) Player.select(o.cur);
  },
};
void AMMO_TYPES; void lerp; void rand; void pick; void TAU; void FX; void dist;
