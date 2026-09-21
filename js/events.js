// Случайные события в городе: аварии, драки, ограбления, погони, свадьба, скорая, разборки банд
import { G } from './state.js';
import { City, edgePoint, laneOffset } from './city.js';
import { Snd } from './audio.js';
import { GANGS, GANG_IDS } from './data.js';
import { rand, pick, chance, dist, dist2 } from './util.js';

export const Events = {
  t: 45, active: [],
  init() {
    if (G.env) {
      G.env.onAurora = () => { G.ui && G.ui.notify('Северное сияние над Северодвинском!', 'good'); };
      G.env.onThunder = () => Snd.thunder();
    }
  },
  update(dt) {
    const pl = G.player;
    if (!pl || pl.dead) return;
    Events.t -= dt;
    if (Events.t <= 0) { Events.t = rand(55, 120); Events.trigger(); }
    // уборка
    for (let i = Events.active.length - 1; i >= 0; i--) {
      const e = Events.active[i]; e.t -= dt;
      if (e.tick) e.tick(dt, e);
      if (e.t <= 0) { e.end && e.end(e); Events.active.splice(i, 1); }
    }
  },
  spot(minR = 60, maxR = 140) {
    const pl = G.player;
    return City.randomRoadPoint({ x: pl.x, z: pl.z }, minR, maxR, 0);
  },
  trigger(kind) {
    const pool = ['crash', 'fight', 'robbery', 'chase', 'gangfight', 'wedding', 'ambulance', 'crash', 'fight'];
    kind = kind || pick(pool);
    const pt = Events.spot();
    if (!pt) return;
    const e = pt.e;
    const ex = e.a.x + e.dx * pt.s, ez = e.a.z + e.dz * pt.s;
    const H = G.Veh, P = G.Peds;
    const near = { x: ex, z: ez };
    switch (kind) {
      case 'crash': {
        const h = Math.atan2(e.dx, e.dz);
        const a = H.spawn(pick(['vaz2107', 'volga', 'vaz2109']), ex + e.dz * 2, ez - e.dx * 2, h + 0.5, { driver: true });
        const b = H.spawn(pick(['moskvich', 'uaz', 'vaz2109']), ex - e.dz * 2 - e.dx * 3, ez + e.dx * 2 - e.dz * 3, h - 2.4, { driver: true });
        a.hp = a.maxHp * 0.3; b.hp = b.maxHp * 0.25; a.smoking = b.smoking = true; a.mode = b.mode = 'parked'; a.ai = b.ai = null; a.hb = b.hb = true;
        for (const v of [a, b]) { H.removeDriver(v); v.engineOff = true; }
        const p1 = P.spawn('civ', ex + 3, ez + 1, { kind: 'default' }), p2 = P.spawn('civ', ex + 4, ez - 1, { kind: 'default' });
        p1.state = p2.state = 'idle'; p1.keep = p2.keep = false;
        setTimeout(() => { if (G.ui && p1 && !p1.dead) G.ui.say(p1, 'Ты куда смотрел, дурак?!'); }, 500);
        setTimeout(() => { if (G.ui && p2 && !p2.dead) G.ui.say(p2, 'Сам подрезал, слепой!'); }, 2200);
        if (chance(0.5)) { p1.warTgt = false; p1.state = 'attack'; p1.tgt = p2; p1.weapon = null; p2.state = 'attack'; p2.tgt = p1; }
        Events.active.push({ t: 90 });
        Snd.crash(1, ex, ez);
        break;
      }
      case 'fight': {
        const a = P.spawn('gop', ex, ez, { state: 'attack' }), b = P.spawn('punk', ex + 1.4, ez, { state: 'attack' });
        a.tgt = b; b.tgt = a; a.warTgt = b.warTgt = true; a.weapon = b.weapon = null; a.rig.setWeapon(null); b.rig.setWeapon(null);
        a.hp = b.hp = 60;
        setTimeout(() => { G.ui && G.ui.say(a, 'Ща я тебя, эмо!'); Snd.voice(a.x, a.z, a.voice); }, 300);
        Events.active.push({ t: 60 });
        break;
      }
      case 'robbery': {
        const v = P.spawn('civ', ex, ez, { kind: 'woman' }), r = P.spawn('gop', ex - 4, ez - 4, { state: 'attack' });
        r.tgt = v; r.weapon = 'knife'; r.rig.setWeapon('knife'); v.state = 'flee'; v.fear = 20; v.fearSrc = r;
        Snd.scream(v.x, v.z, v.voice);
        setTimeout(() => G.ui && G.ui.say(v, 'Помогите! Грабят!'), 400);
        G.ui && G.ui.notify('Слышны крики о помощи неподалёку…');
        Events.active.push({ t: 50, tick: (dt, ev) => { if (r.dead && !ev.rew) { ev.rew = true; G.ui.say(v, 'Спасибо, молодой человек!'); } } });
        break;
      }
      case 'chase': {
        const h = Math.atan2(e.dx, e.dz);
        const lane = 0, off = laneOffset(e, lane);
        const sus = H.spawn('bmw', ...edgePoint(e, Math.min(e.len - 5, pt.s + 30), off), h, { driver: true, ai: 'traffic' });
        H.assignEdge(sus, e, Math.min(e.len - 5, pt.s + 30)); sus.ai.speedF = 1.8; sus.ai.panic = 60;
        for (let i = 0; i < 2; i++) {
          const c = H.spawn('militsia', ...edgePoint(e, pt.s + i * 9, off), h, { driver: true, ai: 'traffic' });
          H.assignEdge(c, e, pt.s + i * 9); c.ai.speedF = 1.9; c.ai.chaseOnly = true; c.siren = true; c.ai.panic = 60;
        }
        G.ui && G.ui.notify('Мимо пронеслась погоня…');
        Events.active.push({ t: 70 });
        break;
      }
      case 'gangfight': {
        const g1 = pick(GANG_IDS); let g2 = pick(GANG_IDS); while (g2 === g1) g2 = pick(GANG_IDS);
        const A = [], B = [];
        for (let i = 0; i < 3; i++) {
          const a = P.spawn(g1, ex + rand(-3, 3), ez + rand(-3, 3), { state: 'attack' }), b = P.spawn(g2, ex + 12 + rand(-3, 3), ez + rand(-3, 3), { state: 'attack' });
          a.warTgt = b.warTgt = true; A.push(a); B.push(b);
        }
        G.ui && G.ui.notify(`Разборка: ${GANGS[g1].name} против ${GANGS[g2].name}`);
        Events.active.push({ t: 80, tick: (dt, ev) => { for (const p of A.concat(B)) if (!p.dead && (!p.tgt || p.tgt.dead)) p.tgt = G.Peds.nearestEnemy(p, 40); } });
        break;
      }
      case 'wedding': {
        const h = Math.atan2(e.dx, e.dz);
        for (let i = 0; i < 3; i++) {
          const c = H.spawn(i === 0 ? 'mers' : 'volga', ...edgePoint(e, Math.max(2, pt.s - i * 9), laneOffset(e, 0)), h, { driver: true, ai: 'traffic', color: '#f0f0f0' });
          H.assignEdge(c, e, Math.max(2, pt.s - i * 9)); c.ai.speedF = 0.7; c.wedding = true;
        }
        G.ui && G.ui.notify('Свадебный кортеж! Сигналят вовсю.');
        Events.active.push({ t: 80, tick: (dt, ev) => { ev.h = (ev.h || 0) - dt; if (ev.h < 0) { ev.h = rand(1.5, 3); for (const v of G.vehicles) if (v.wedding && dist2(v.x, v.z, G.player.x, G.player.z) < 120 * 120) H.honk(v, 0.25); } } });
        break;
      }
      case 'ambulance': {
        const h = Math.atan2(e.dx, e.dz);
        const a = H.spawn('ambulance', ...edgePoint(e, pt.s, laneOffset(e, 0)), h, { driver: true, ai: 'traffic' });
        H.assignEdge(a, e, pt.s); a.ai.speedF = 1.7; a.siren = true; a.ai.panic = 60;
        Events.active.push({ t: 60 });
        break;
      }
      default: break;
    }
    void near;
  },
};
G.events = Events;
void GANG_IDS; void dist;
