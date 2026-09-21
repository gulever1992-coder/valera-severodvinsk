// Эффекты: частицы (дым, искры, кровь, огонь), трассеры пуль, вспышки, ударные волны
import * as THREE from 'three';
import { G } from './state.js';
import { rand, clamp, lerp } from './util.js';

class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.size0 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: G.tex.smoke }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size*scale/max(1.0,-mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a*t.a*1.6); if(gl_FragColor.a<0.01) discard; }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pts = new THREE.Points(g, m); this.pts.frustumCulled = false; this.pts.renderOrder = 6;
    scene.add(this.pts);
    for (let k = 0; k < max; k++) { this.life[k] = 0; this.pos[k * 3 + 1] = -999; }
    this.geo = g;
  }
  emit(x, y, z, vx, vy, vz, r, g, b, a, size, life, grow = 0, grav = 0, drag = 0) {
    const k = this.i; this.i = (this.i + 1) % this.max;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.c0[k * 3] = r; this.c0[k * 3 + 1] = g; this.c0[k * 3 + 2] = b; this.col[k * 4 + 3] = a;
    this.size0[k] = size; this.size[k] = size; this.life[k] = this.maxLife[k] = life; this.grow[k] = grow; this.grav[k] = grav; this.drag[k] = drag;
    this.alpha0 = a; this.col[k * 4] = r; this.col[k * 4 + 1] = g; this.col[k * 4 + 2] = b;
    this.a0 = this.a0 || new Float32Array(this.max); this.a0[k] = a;
  }
  update(dt) {
    const p = this.pos, v = this.vel, a0 = this.a0;
    if (!a0) return;
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { p[k * 3 + 1] = -999; this.size[k] = 0; continue; }
      const t = this.life[k] / this.maxLife[k];
      const d = Math.exp(-this.drag[k] * dt);
      v[k * 3] *= d; v[k * 3 + 1] = v[k * 3 + 1] * d - this.grav[k] * dt; v[k * 3 + 2] *= d;
      p[k * 3] += v[k * 3] * dt; p[k * 3 + 1] += v[k * 3 + 1] * dt; p[k * 3 + 2] += v[k * 3 + 2] * dt;
      if (p[k * 3 + 1] < 0.03 && this.grav[k] > 0) { p[k * 3 + 1] = 0.03; v[k * 3 + 1] = 0; v[k * 3] *= 0.5; v[k * 3 + 2] *= 0.5; }
      this.size[k] = this.size0[k] + this.grow[k] * (1 - t);
      this.col[k * 4 + 3] = a0[k] * (t < 0.5 ? t * 2 : 1);
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.geo.attributes.size.needsUpdate = true;
  }
}

export const FX = {
  init(scene) {
    FX.norm = new Particles(scene, 700, false);
    FX.add = new Particles(scene, 500, true);
    // трассеры
    const TN = 48;
    FX.tn = TN; FX.tPos = new Float32Array(TN * 6); FX.tCol = new Float32Array(TN * 6); FX.tLife = new Float32Array(TN); FX.ti = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(FX.tPos, 3)); g.setAttribute('color', new THREE.BufferAttribute(FX.tCol, 3));
    FX.tracers = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    FX.tracers.frustumCulled = false; scene.add(FX.tracers);
    // вспышка
    FX.light = new THREE.PointLight(0xffaa55, 0, 60, 2); scene.add(FX.light);
    FX.flash = 0; FX.flashPos = new THREE.Vector3();
    // ударные волны
    FX.rings = [];
    const rg = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffddaa, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); m.visible = false; m.position.y = 0.3; scene.add(m); FX.rings.push({ m, t: 0 }); }
    G.shake = 0;
  },
  update(dt) {
    FX.norm.update(dt); FX.add.update(dt);
    for (let i = 0; i < FX.tn; i++) {
      if (FX.tLife[i] > 0) {
        FX.tLife[i] -= dt;
        const f = Math.max(0, FX.tLife[i] / 0.12);
        FX.tCol[i * 6] = FX.tCol[i * 6 + 3] = 1 * f; FX.tCol[i * 6 + 1] = FX.tCol[i * 6 + 4] = 0.85 * f; FX.tCol[i * 6 + 2] = FX.tCol[i * 6 + 5] = 0.4 * f;
      } else { FX.tCol[i * 6] = FX.tCol[i * 6 + 1] = FX.tCol[i * 6 + 2] = FX.tCol[i * 6 + 3] = FX.tCol[i * 6 + 4] = FX.tCol[i * 6 + 5] = 0; }
    }
    FX.tracers.geometry.attributes.color.needsUpdate = true; FX.tracers.geometry.attributes.position.needsUpdate = true;
    FX.flash = Math.max(0, FX.flash - dt * 4);
    FX.light.intensity = FX.flash * 400; FX.light.position.copy(FX.flashPos);
    for (const r of FX.rings) if (r.t > 0) { r.t -= dt; const k = 1 - r.t / 0.6; r.m.scale.setScalar(2 + k * 34); r.m.material.opacity = Math.max(0, 0.6 * (1 - k)); if (r.t <= 0) r.m.visible = false; }
    G.shake = Math.max(0, G.shake - dt * 2.5);
  },
  tracer(x0, y0, z0, x1, y1, z1) {
    const i = FX.ti; FX.ti = (FX.ti + 1) % FX.tn;
    FX.tPos.set([x0, y0, z0, x1, y1, z1], i * 6); FX.tLife[i] = 0.12;
  },
  smoke(x, y, z, size = 1.2, life = 1.6, dark = 0.3, up = 1.2) {
    FX.norm.emit(x, y, z, rand(-0.3, 0.3), up + rand(0, 0.6), rand(-0.3, 0.3), dark, dark, dark, 0.55, size, life, size * 2.2, 0, 0.3);
  },
  dust(x, z, n = 4, c = 0.55) { for (let i = 0; i < n; i++) FX.norm.emit(x + rand(-0.3, 0.3), 0.15, z + rand(-0.3, 0.3), rand(-1.5, 1.5), rand(0.3, 1.2), rand(-1.5, 1.5), c, c * 0.95, c * 0.85, 0.35, 0.6, 0.8, 1.5, 0, 2); },
  spark(x, y, z, n = 5, nx = 0, nz = 0) { for (let i = 0; i < n; i++) FX.add.emit(x, y, z, rand(-3, 3) + nx * 3, rand(0.5, 4), rand(-3, 3) + nz * 3, 1, 0.8, 0.35, 1, 0.16, 0.3, 0, 12, 0.5); },
  blood(x, y, z, n = 6, dx = 0, dz = 0) { for (let i = 0; i < n; i++) FX.norm.emit(x, y, z, rand(-1.5, 1.5) + dx * 3, rand(0.5, 3), rand(-1.5, 1.5) + dz * 3, 0.55, 0.02, 0.02, 0.9, 0.16, 0.7, 0, 12, 0.6); },
  muzzle(x, y, z) { FX.add.emit(x, y, z, 0, 0, 0, 1, 0.8, 0.3, 1, 1.1, 0.06, 0.6, 0, 0); FX.flashPos.set(x, y, z); FX.flash = Math.max(FX.flash, 0.25); },
  fire(x, y, z, size = 1.4) { FX.add.emit(x + rand(-0.3, 0.3), y, z + rand(-0.3, 0.3), rand(-0.4, 0.4), rand(1.5, 3), rand(-0.4, 0.4), 1, rand(0.35, 0.6), 0.1, 0.9, size, 0.6, size * 0.5, 0, 0.5); },
  explosion(x, y, z, r = 8) {
    for (let i = 0; i < 26; i++) FX.add.emit(x, y + 0.5, z, rand(-1, 1) * r, rand(0.5, 1.2) * r * 0.7, rand(-1, 1) * r, 1, rand(0.4, 0.75), 0.15, 1, rand(2.5, 4.5), rand(0.5, 1.0), 3, 0, 2.6);
    for (let i = 0; i < 20; i++) FX.norm.emit(x, y + 1, z, rand(-1, 1) * r * 0.5, rand(1, 3) + 2, rand(-1, 1) * r * 0.5, 0.15, 0.15, 0.15, 0.7, rand(2, 4), rand(1.5, 3), 5, 0, 0.8);
    for (let i = 0; i < 14; i++) FX.add.emit(x, y + 0.5, z, rand(-1, 1) * r * 1.3, rand(3, 9), rand(-1, 1) * r * 1.3, 1, 0.8, 0.3, 1, 0.25, 0.9, 0, 12, 0.3);
    FX.flashPos.set(x, y + 3, z); FX.flash = 1;
    const ring = FX.rings.find((q) => q.t <= 0); if (ring) { ring.t = 0.6; ring.m.visible = true; ring.m.position.set(x, 0.3, z); ring.m.scale.setScalar(2); }
    G.shake = Math.min(1.5, G.shake + Math.max(0, 1 - Math.hypot(x - G.cam.x, z - G.cam.z) / 120) * 1.3);
  },
  splash(x, z) { for (let i = 0; i < 10; i++) FX.norm.emit(x, 0.1, z, rand(-1.5, 1.5), rand(2, 4), rand(-1.5, 1.5), 0.85, 0.92, 1, 0.8, 0.3, 0.7, 0.2, 10, 0.3); },
};
void lerp; void clamp;
