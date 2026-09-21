// Интерфейс в стиле GTA 5: миникарта, полоски здоровья, деньги, розыск, оружие, колесо оружия, магазины, карта, меню
import * as THREE from 'three';
import { G } from './state.js';
import { City } from './city.js';
import { SHOPS, WEAPONS, GANGS } from './data.js';
import { WORLD, RING } from './mapdata.js';
import { Snd, Radio } from './audio.js';
import { clamp, fmtMoney, dist2, dist } from './util.js';

const $ = (id) => document.getElementById(id);
const MAPW = 1300, MAPH = 720, OFF = 40;
const OWNER_COL = { valera: [58, 160, 255], salt: [116, 216, 74], punk: [210, 75, 224], gop: [242, 162, 49], rus: [226, 58, 58] };
const POI_COL = { shop: '#66ff88', pharm: '#66d0ff', food: '#ffcc44', weapon: '#ff5544', black: '#aa55ff', repair: '#4488ff', gym: '#44ffaa', home: '#ffffff', hospital: '#ff6688', police: '#4466ff', landmark: '#bbbbbb' };
const POI_ICON = { shop: '🛒', pharm: '+', food: '🍴', weapon: '🔫', black: '$', repair: '🔧', gym: '💪', home: '⌂', hospital: '✚', police: '★' };

export const UI = {
  cache: {}, bubbles: [], notes: [], wheelOpen: false, shopOpen: false, mapOpen: false, pauseOpen: false, wheelVec: { x: 0, y: 0 }, wheelSel: null, terrKey: '',
  init() {
    UI.mm = $('minimap').getContext('2d');
    G.ui = UI;
    UI.buildBase();
    UI.buildTerr();
  },
  set(id, prop, val) { const c = UI.cache; const k = id + prop; if (c[k] === val) return; c[k] = val; const e = $(id); if (e) { if (prop === 'text') e.textContent = val; else if (prop === 'html') e.innerHTML = val; else if (prop === 'w') e.style.width = val; else e.style[prop] = val; } },

  // ---------- карта ----------
  buildBase() {
    const c = document.createElement('canvas'); c.width = MAPW; c.height = MAPH;
    const x = c.getContext('2d');
    x.fillStyle = '#5d7c47'; x.fillRect(0, 0, MAPW, MAPH);
    const poly = (p, fill) => { x.beginPath(); p.forEach(([px, pz], i) => (i ? x.lineTo(px + OFF, pz + OFF) : x.moveTo(px + OFF, pz + OFF))); x.closePath(); x.fillStyle = fill; x.fill(); };
    City.forest.forEach((p) => poly(p, '#43663b'));
    City.water.forEach((p) => poly(p, '#3d7aa8'));
    // здания
    x.fillStyle = '#9b9b95';
    for (const b of City.buildings) { x.save(); x.translate(b.cx + OFF, b.cz + OFF); x.rotate(b.rot); x.fillRect(-b.hx, -b.hz, b.hx * 2, b.hz * 2); x.restore(); }
    // дороги
    x.lineCap = 'round'; x.lineJoin = 'round';
    for (const pass of [0, 1]) for (const r of City.roads) {
      x.beginPath(); r.pts.forEach(([px, pz], i) => (i ? x.lineTo(px + OFF, pz + OFF) : x.moveTo(px + OFF, pz + OFF)));
      x.lineWidth = r.w * 1.05 + (pass ? 0 : 3); x.strokeStyle = pass ? (r.type === 'major' ? '#f2ead0' : '#e8e8e2') : '#555'; x.stroke();
    }
    // остров кольца
    x.beginPath(); x.arc(RING.cx + OFF, RING.cz + OFF, RING.islandR, 0, 6.3); x.fillStyle = '#6a8a4c'; x.fill();
    UI.base = c;
  },
  buildTerr() {
    const w = Math.ceil(MAPW / 4), h = Math.ceil(MAPH / 4);
    UI.terrW = w; UI.terrH = h;
    UI.terr = document.createElement('canvas'); UI.terr.width = w; UI.terr.height = h;
    UI.terrIdx = new Uint8Array(w * h);
    const ds = City.districts;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = i * 4 - OFF, z = j * 4 - OFF;
      let b = 0, bd = 1e12;
      for (let k = 0; k < ds.length; k++) { const d = dist2(x, z, ds[k].pos[0], ds[k].pos[1]); if (d < bd) { bd = d; b = k; } }
      UI.terrIdx[j * w + i] = b;
    }
    UI.recolor();
  },
  recolor() {
    const ds = City.districts, w = UI.terrW, h = UI.terrH;
    const ctx = UI.terr.getContext('2d');
    const id = ctx.createImageData(w, h);
    for (let n = 0; n < w * h; n++) {
      const k = UI.terrIdx[n], col = OWNER_COL[ds[k].owner];
      id.data[n * 4] = col[0]; id.data[n * 4 + 1] = col[1]; id.data[n * 4 + 2] = col[2]; id.data[n * 4 + 3] = ds[k].war ? 130 : 78;
      // границы районов
      const i = n % w, j = (n / w) | 0;
      if (i < w - 1 && UI.terrIdx[n + 1] !== k || j < h - 1 && UI.terrIdx[n + w] !== k) { id.data[n * 4 + 3] = 210; }
    }
    ctx.putImageData(id, 0, 0);
  },
  drawMinimap(dt) {
    const pl = G.player; if (!pl) return;
    const x = UI.mm, S = 260;
    const key = City.districts.map((d) => d.owner + (d.war ? 'w' : '')).join('');
    if (key !== UI.terrKey) { UI.terrKey = key; UI.recolor(); }
    const veh = pl.veh;
    const sp = veh ? Math.abs(veh.speed) : 0;
    UI.mzoom = (UI.mzoom || 1.3) + ((veh ? 0.85 - Math.min(0.25, sp * 0.008) : 1.3) - (UI.mzoom || 1.3)) * Math.min(1, dt * 3);
    const s = UI.mzoom;
    const yaw = pl.dead ? 0 : (veh ? veh.heading : G.player.yaw);
    const th = yaw - Math.PI;
    x.clearRect(0, 0, S, S);
    x.save();
    x.translate(S / 2, S / 2); x.rotate(th); x.scale(s, s); x.translate(-(pl.x + OFF), -(pl.z + OFF));
    x.fillStyle = '#2e4a63'; x.fillRect(-2000, -2000, 6000, 6000);
    x.drawImage(UI.base, 0, 0);
    x.globalAlpha = 0.9; x.imageSmoothingEnabled = true; x.drawImage(UI.terr, 0, 0, MAPW, MAPH); x.globalAlpha = 1;
    const blip = (wx, wz, col, r = 5, shape = 'c') => {
      x.save(); x.translate(wx + OFF, wz + OFF); x.rotate(-th); x.scale(1 / s, 1 / s);
      x.fillStyle = col; x.strokeStyle = '#000'; x.lineWidth = 1.5;
      x.beginPath();
      if (shape === 'c') x.arc(0, 0, r, 0, 6.3); else if (shape === 's') x.rect(-r, -r, r * 2, r * 2); else { x.moveTo(0, -r); x.lineTo(r, r); x.lineTo(-r, r); x.closePath(); }
      x.fill(); x.stroke(); x.restore();
    };
    // POI
    for (const p of City.pois) { if (!p.marker) continue; if (dist2(p.x, p.z, pl.x, pl.z) > 260 * 260) continue; blip(p.x, p.z, POI_COL[p.kind] || '#fff', 5, 's'); }
    // враги/милиция
    const flash = Math.floor(G.time * 4) % 2;
    for (const p of G.peds) {
      if (p.dead) continue;
      const d2 = dist2(p.x, p.z, pl.x, pl.z); if (d2 > 200 * 200) continue;
      if (p.type === 'cop' || p.type === 'omon') blip(p.x, p.z, G.police.level > 0 ? (flash ? '#ff3030' : '#3060ff') : '#4a70ff', 4);
      else if (p.type === 'ally') blip(p.x, p.z, '#3aa0ff', 4);
      else if (p.hostile && p.gang) blip(p.x, p.z, '#ff7a30', 4);
    }
    if (G.police.level > 0) for (const v of G.vehicles) if (v.spec.police && !v.wreck) blip(v.x, v.z, flash ? '#ff3030' : '#3060ff', 5, 's');
    // цель миссии
    const t = G.story && G.story.target;
    if (t && !t.area) {
      // если далеко — на край карты
      const dx = t.x - pl.x, dz = t.z - pl.z;
      const dd = Math.hypot(dx, dz), lim = (S / 2 - 14) / s;
      if (dd > lim) blip(pl.x + (dx / dd) * lim, pl.z + (dz / dd) * lim, '#ffdd33', 7, 't'); else blip(t.x, t.z, '#ffdd33', 7, 'c');
    } else if (t && t.area) {
      const dx = t.x - pl.x, dz = t.z - pl.z, dd = Math.hypot(dx, dz), lim = (S / 2 - 14) / s;
      if (dd > lim) blip(pl.x + (dx / dd) * lim, pl.z + (dz / dd) * lim, '#ffdd33', 7, 't'); else blip(t.x, t.z, '#ffdd33', 9, 'c');
    }
    x.restore();
    // игрок (стрелка по центру)
    x.save(); x.translate(S / 2, S / 2); x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, -9); x.lineTo(7, 8); x.lineTo(0, 4); x.lineTo(-7, 8); x.closePath(); x.fill(); x.stroke(); x.restore();
    // «север»
    const nx = Math.sin(th) * -1, ny = -Math.cos(th) * -1;
    void nx; void ny;
    $('compass').style.transform = `translateX(-50%)`;
  },
  drawFullMap() {
    const c = $('bigmap');
    const W = Math.min(window.innerWidth * 0.94, 1300), H = W * (MAPH / MAPW);
    c.width = W; c.height = H;
    const x = c.getContext('2d'), k = W / MAPW;
    x.drawImage(UI.base, 0, 0, W, H);
    x.globalAlpha = 0.95; x.drawImage(UI.terr, 0, 0, W, H); x.globalAlpha = 1;
    x.font = 'bold 12px Segoe UI, Arial'; x.textAlign = 'center';
    for (const d of City.districts) {
      x.fillStyle = 'rgba(0,0,0,.65)'; const tx = (d.pos[0] + OFF) * k, ty = (d.pos[1] + OFF) * k;
      const label = d.name + (d.owner === 'valera' ? ' ★' : '');
      const tw = x.measureText(label).width + 10; x.fillRect(tx - tw / 2, ty - 9, tw, 18);
      x.fillStyle = '#fff'; x.fillText(label, tx, ty + 4);
    }
    for (const p of City.pois) {
      if (!p.marker) continue;
      const tx = (p.x + OFF) * k, ty = (p.z + OFF) * k;
      x.fillStyle = POI_COL[p.kind]; x.strokeStyle = '#000'; x.lineWidth = 2; x.beginPath(); x.rect(tx - 5, ty - 5, 10, 10); x.fill(); x.stroke();
    }
    const t = G.story && G.story.target;
    if (t) { x.fillStyle = '#ffdd33'; x.beginPath(); x.arc((t.x + OFF) * k, (t.z + OFF) * k, 8, 0, 6.3); x.fill(); x.stroke(); }
    const pl = G.player;
    x.save(); x.translate((pl.x + OFF) * k, (pl.z + OFF) * k); x.rotate(-(pl.veh ? pl.veh.heading : pl.yaw) + Math.PI);
    x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, -12); x.lineTo(9, 10); x.lineTo(0, 5); x.lineTo(-9, 10); x.closePath(); x.fill(); x.stroke(); x.restore();
    $('maplegend').innerHTML = ['valera', 'salt', 'punk', 'gop', 'rus'].map((g) => `<span><i style="background:${GANGS[g].color}"></i>${GANGS[g].name}</span>`).join('') + '<span><i style="background:#ffdd33"></i>Цель</span>';
  },
  toggleMap() {
    UI.mapOpen = !UI.mapOpen;
    $('fullmap').classList.toggle('hidden', !UI.mapOpen);
    if (UI.mapOpen) UI.drawFullMap();
    Snd.click();
  },

  // ---------- сообщения ----------
  notify(text, cls = '') {
    const d = document.createElement('div'); d.className = 'note ' + cls; d.textContent = text;
    const box = $('notifications'); box.appendChild(d);
    while (box.children.length > 5) box.removeChild(box.firstChild);
    Snd.notify();
    setTimeout(() => d.classList.add('fade'), 5000); setTimeout(() => d.remove(), 6200);
  },
  floatText(t) { const e = $('floatmsg'); e.textContent = t; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); },
  banner(big, sub = '', quiet) {
    const b = $('banner'); b.querySelector('.big').textContent = big; b.querySelector('.sub').textContent = sub; b.classList.add('show');
    clearTimeout(UI._bt); UI._bt = setTimeout(() => b.classList.remove('show'), 4200);
  },
  setObjective(t) { $('objtext').textContent = t; },
  subtitle(who, text, dur = 4) {
    const e = $('subtitle'); e.innerHTML = who ? `<b>${who}:</b> ${text}` : text;
    clearTimeout(UI._st); UI._st = setTimeout(() => (e.innerHTML = ''), dur * 1000);
  },
  say(ped, text, dur = 3) {
    if (!ped) return;
    const old = UI.bubbles.find((b) => b.ped === ped); if (old) { old.el.remove(); UI.bubbles.splice(UI.bubbles.indexOf(old), 1); }
    if (UI.bubbles.length > 4) { const b = UI.bubbles.shift(); b.el.remove(); }
    const el = document.createElement('div'); el.className = 'bubble'; el.textContent = text; $('bubbles').appendChild(el);
    UI.bubbles.push({ ped, el, t: dur });
  },
  setPrompt(p) {
    const e = $('prompt');
    if (!p || G.freeze) { e.classList.add('hidden'); return; }
    e.classList.remove('hidden'); e.querySelector('b').textContent = p.key; e.querySelector('span').textContent = p.text;
  },
  hitMarker(kill, head) { const h = $('hitmarker'); h.className = 'show' + (kill ? ' kill' : ''); clearTimeout(UI._hm); UI._hm = setTimeout(() => (h.className = ''), 120); Snd.tone({ type: 'triangle', f0: kill ? 500 : 900, dur: 0.05, gain: 0.12, bus: undefined }); },
  vehicleName(n) { const e = $('vehname'); e.textContent = n; e.classList.add('show'); clearTimeout(UI._vn); UI._vn = setTimeout(() => e.classList.remove('show'), 3000); },
  radioName(n) { const e = $('radioname'); e.textContent = '♫ ' + n; e.classList.add('show'); clearTimeout(UI._rn); UI._rn = setTimeout(() => e.classList.remove('show'), 2600); },
  weaponChanged() { UI.cache.wname = null; },
  showWasted(text, busted) { const w = $('wasted'); w.classList.remove('hidden'); w.classList.toggle('busted', !!busted); w.querySelector('.big').textContent = text; w.querySelector('.sub').textContent = ''; $('game').classList.add('gray'); },
  hideWasted(msg) {
    const f = $('fade'); f.classList.add('on');
    setTimeout(() => { $('wasted').classList.add('hidden'); $('game').classList.remove('gray'); f.classList.remove('on'); if (msg) UI.notify(msg); }, 700);
  },
  cutsceneOn(title) { $('letterbox').classList.remove('hidden'); $('cstitle').textContent = title || ''; $('hud').classList.add('cs'); if (title) setTimeout(() => ($('cstitle').textContent = ''), 4500); },
  cutsceneOff() { $('letterbox').classList.add('hidden'); $('hud').classList.remove('cs'); $('subtitle').innerHTML = ''; },
  blocking() { return UI.shopOpen || UI.wheelOpen || UI.mapOpen || UI.pauseOpen; },

  // ---------- магазин ----------
  openShop(poi) {
    const def = SHOPS[poi.kind];
    if (!def) return;
    UI.shopOpen = true; UI.shopPoi = poi;
    document.exitPointerLock && document.exitPointerLock();
    $('shop').classList.remove('hidden');
    $('shoptitle').textContent = poi.kind === 'home' ? def.title : poi.name + ' — ' + def.title;
    UI.renderShop();
    Snd.click();
  },
  renderShop() {
    const def = SHOPS[UI.shopPoi.kind];
    $('shopmoney').textContent = '₽ ' + fmtMoney(G.money);
    const box = $('shopitems'); box.innerHTML = '';
    const pl = G.player;
    for (const it of def.items) {
      const d = document.createElement('div');
      let price = it.price;
      const owned = it.weapon && pl.weapons[it.weapon] && !WEAPONS[it.weapon].thrown;
      d.className = 'item' + (G.money < price ? ' no' : '');
      d.innerHTML = `<div>${it.name}${owned ? ' <small>(есть — купить патроны)</small>' : ''}<small>${it.desc || ''}</small></div><div class="p">${price ? '₽ ' + fmtMoney(price) : 'бесплатно'}</div>`;
      d.onclick = () => UI.buy(it);
      d.onmouseenter = () => Snd.hover();
      box.appendChild(d);
    }
  },
  buy(it) {
    const pl = G.player;
    if (G.money < it.price) { Snd.error(); UI.floatText('Не хватает денег'); return; }
    let ok = true;
    if (it.heal) { if (pl.health >= pl.maxHealth && !it.stamina) { UI.floatText('Здоровье полное'); return; } pl.heal(it.heal); Snd.eat(); }
    if (it.stamina) { pl.stamina = 100; pl.staminaLock = false; Snd.drink(); }
    if (it.weapon) pl.giveWeapon(it.weapon);
    if (it.ammo) { const w = WEAPONS[it.ammo]; if (!pl.weapons[it.ammo]) { UI.floatText('Сначала нужно оружие'); return; } pl.addAmmo(w.ammoType, w.ammoPack); UI.floatText(`+${w.ammoPack} патронов`); }
    if (it.armor) { if (pl.armor >= 100) { UI.floatText('Бронежилет уже надет'); return; } pl.addArmor(it.armor); UI.floatText('Бронежилет надет'); }
    if (it.repair) { if (!pl.veh) { UI.floatText('Нужна машина рядом: сядь в неё'); return; } pl.veh.hp = pl.veh.maxHp; pl.veh.smoking = false; UI.floatText('Машина починена'); }
    if (it.wanted) { if (!pl.veh) { UI.floatText('Заезжай на машине'); return; } G.police.clear(); UI.floatText('Машина перекрашена, розыск снят'); }
    if (it.maxhp) { if (pl.maxHealth >= 150) { UI.floatText('Уже максимум'); return; } pl.maxHealth += it.maxhp; pl.health = pl.maxHealth; }
    if (it.save) { G.saveGame(); ok = true; }
    if (it.sleep) { G.env.setHour(8); pl.health = pl.maxHealth; UI.floatText('Утро. 08:00'); }
    if (it.junk) UI.floatText('Дымит красиво…');
    if (ok && it.price) { G.money -= it.price; Snd.cash(); }
    if (G.story) G.story.onBuy(it);
    UI.renderShop();
  },
  closeShop() { UI.shopOpen = false; $('shop').classList.add('hidden'); if (G.requestLock) G.requestLock(); },

  // ---------- колесо оружия ----------
  openWheel() {
    if (UI.wheelOpen || G.freeze) return;
    UI.wheelOpen = true; UI.wheelVec = { x: 0, y: 0 };
    const w = $('wheel'); w.classList.remove('hidden');
    const ids = Object.keys(WEAPONS).filter((id) => G.player.weapons[id]);
    UI.wheelIds = ids;
    w.querySelectorAll('.it').forEach((e) => e.remove());
    ids.forEach((id, i) => {
      const a = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
      const e = document.createElement('div'); e.className = 'it'; e.dataset.id = id;
      const pl = G.player, wd = WEAPONS[id];
      const ammo = wd.melee ? '' : wd.thrown ? `× ${pl.getThrown(id)}` : `${pl.mag[id] || 0} / ${pl.ammo[wd.ammoType] || 0}`;
      e.innerHTML = `${wd.name}<small>${ammo}</small>`;
      e.style.left = 200 + Math.cos(a) * 150 + 'px'; e.style.top = 200 + Math.sin(a) * 150 + 'px';
      w.appendChild(e);
    });
    UI.wheelSel = G.player.cur;
    UI.markWheel();
    G.timeScale = 0.15;
  },
  markWheel() { $('wheel').querySelectorAll('.it').forEach((e) => e.classList.toggle('sel', e.dataset.id === UI.wheelSel)); $('wheelname').textContent = UI.wheelSel ? WEAPONS[UI.wheelSel].name : ''; },
  closeWheel() {
    if (!UI.wheelOpen) return;
    UI.wheelOpen = false; $('wheel').classList.add('hidden'); G.timeScale = 1;
    if (UI.wheelSel) G.player.select(UI.wheelSel);
  },

  // ---------- покадровое обновление ----------
  update(dt) {
    const pl = G.player, env = G.env;
    if (!pl) return;
    // колесо: копим движение мыши
    if (UI.wheelOpen) {
      UI.wheelVec.x += G.input.mouseDX * 0.6; UI.wheelVec.y += G.input.mouseDY * 0.6;
      const l = Math.hypot(UI.wheelVec.x, UI.wheelVec.y);
      if (l > 130) { UI.wheelVec.x *= 130 / l; UI.wheelVec.y *= 130 / l; }
      if (l > 30) {
        const a = Math.atan2(UI.wheelVec.y, UI.wheelVec.x) + Math.PI / 2;
        const n = UI.wheelIds.length; const i = ((Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * n)) % n + n) % n;
        UI.wheelSel = UI.wheelIds[i]; UI.markWheel();
      }
      G.input.mouseDX = G.input.mouseDY = 0;
    }
    UI.set('money', 'text', '₽ ' + fmtMoney(G.money));
    UI.set('time', 'text', env.timeString());
    UI.set('date', 'text', env.dateString());
    UI.set('weather', 'text', env.weatherName());
    UI.set('hp', 'w', '100%'); $('hp').firstElementChild.style.width = clamp(pl.health / pl.maxHealth * 100, 0, 100) + '%';
    $('ar').firstElementChild.style.width = clamp(pl.armor, 0, 100) + '%';
    $('stam').firstElementChild.style.width = clamp(pl.stamina, 0, 100) + '%';
    // звёзды
    const lv = G.police.level, sk = lv + (G.police.searching ? 'f' : '');
    if (UI.cache.stars !== sk) { UI.cache.stars = sk; let h = ''; for (let i = 0; i < 5; i++) h += `<span class="${i < lv ? 'on' : 'off'}">★</span>`; $('stars').innerHTML = h; $('stars').classList.toggle('flash', G.police.searching); }
    // оружие
    const w = WEAPONS[pl.cur], wk = pl.cur + (pl.mag[pl.cur] || 0) + (pl.ammo[w.ammoType] || 0) + (pl.getThrown(pl.cur));
    if (UI.cache.wk !== wk) {
      UI.cache.wk = wk; $('wname').textContent = w.name;
      $('wammo').textContent = w.melee ? '' : w.thrown ? `× ${pl.getThrown(pl.cur)}` : `${pl.mag[pl.cur] || 0} / ${pl.ammo[w.ammoType] || 0}`;
    }
    // район / улица
    const d = G.gangs ? G.gangs.district : null;
    UI.set('street', 'text', City.streetAt(pl.x, pl.z) || '');
    if (d) {
      const own = d.owner === 'valera' ? 'территория: Пацаны Валеры' : `территория: ${GANGS[d.owner].name}`;
      UI.set('district', 'text', `${d.name} · ${own}${d.war ? ' · ВОЙНА ' + Math.max(0, Math.round(d.strength)) + '%' : ''}`);
      $('district').style.color = GANGS[d.owner] ? GANGS[d.owner].color : '#fff';
    }
    // спидометр
    if (pl.veh) {
      $('speedo').classList.remove('hidden');
      UI.set('spd', 'text', Math.round(Math.abs(pl.veh.speed) * 3.6));
      $('carhp').firstElementChild.style.width = clamp(pl.veh.hp / pl.veh.maxHp * 100, 0, 100) + '%';
    } else $('speedo').classList.add('hidden');
    // прицел
    const w2 = WEAPONS[pl.cur];
    const ranged = w2 && !w2.melee;
    const ch = $('crosshair');
    const show = ranged && !pl.veh && !pl.dead && !G.freeze && !UI.blocking() && (pl.aiming || G.time - pl.lastFire < 1);
    ch.classList.toggle('hidden', !show);
    if (show) { ch.classList.toggle('red', !!pl.aimHit); ch.classList.toggle('dot', !pl.aiming); }
    // задержание
    const ap = G.police.arrestProg;
    $('arrest').classList.toggle('hidden', ap <= 0.02); $('arrest').firstElementChild.style.width = clamp(ap * 100, 0, 100) + '%';
    // виньетка
    const low = pl.health < 30 ? (1 - pl.health / 30) : 0;
    const vv = Math.max(low * 0.6, pl.hitFlash * 0.7);
    $('vignette').style.background = `radial-gradient(ellipse at center, transparent ${55 - vv * 30}%, rgba(170,0,0,${vv}) 100%)`;
    // облачка
    for (let i = UI.bubbles.length - 1; i >= 0; i--) {
      const b = UI.bubbles[i]; b.t -= dt;
      const p = b.ped;
      const v = new THREE.Vector3(p.x, 2.05, p.z).project(G.camera);
      const d2 = dist2(p.x, p.z, G.cam.x, G.cam.z);
      if (b.t <= 0 || p.dead || v.z > 1 || d2 > 40 * 40) { b.el.remove(); UI.bubbles.splice(i, 1); continue; }
      b.el.style.left = (v.x * 0.5 + 0.5) * window.innerWidth + 'px'; b.el.style.top = (-v.y * 0.5 + 0.5) * window.innerHeight + 'px';
    }
    UI.drawMinimap(dt);
    if (UI.mapOpen && (UI._mt = (UI._mt || 0) + dt) > 0.5) { UI._mt = 0; UI.drawFullMap(); }
  },
};
void WORLD; void dist; void Radio;
