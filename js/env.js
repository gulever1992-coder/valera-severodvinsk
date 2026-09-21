// Окружение: небо, солнце/луна, смена времени суток, погода (ясно, облачно, дождь, снег, туман, гроза), северное сияние
import * as THREE from 'three';
import { G, UNI } from './state.js';
import { City } from './city.js';
import { lerp, clamp, rand, pick, smooth, damp } from './util.js';

const TIME_SCALE = 30; // 1 реальная секунда = 30 игровых секунд (сутки ≈ 48 минут)
const WEATHERS = {
  clear: { name: 'Ясно', cloud: 0.15, rain: 0, snow: 0, fog: 0.0, dark: 0 },
  cloudy: { name: 'Облачно', cloud: 0.75, rain: 0, snow: 0, fog: 0.15, dark: 0.25 },
  rain: { name: 'Дождь', cloud: 0.95, rain: 1, snow: 0, fog: 0.4, dark: 0.45 },
  storm: { name: 'Гроза', cloud: 1, rain: 1.4, snow: 0, fog: 0.5, dark: 0.65 },
  snow: { name: 'Снегопад', cloud: 0.9, rain: 0, snow: 1, fog: 0.55, dark: 0.3 },
  fog: { name: 'Туман', cloud: 0.6, rain: 0, snow: 0, fog: 1, dark: 0.2 },
};

const SKY = {
  nightTop: [0.02, 0.03, 0.08], nightHor: [0.07, 0.09, 0.16],
  dayTop: [0.27, 0.52, 0.82], dayHor: [0.72, 0.84, 0.94],
  twCol: [1.0, 0.5, 0.25],
};
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function createEnv(scene, camera, renderer) {
  const env = {
    hour: 8.0, day: 0, weather: 'clear', target: 'clear', wTimer: 240,
    cloud: 0.15, rain: 0, snow: 0, fog: 0, dark: 0, snowGround: 0, night: 0, thunder: 0, aurora: 0, auroraOn: false,
    sunDir: new THREE.Vector3(0, 1, 0), lightning: 0, startDate: new Date(2003, 9, 3),
    paused: false,
  };
  G.env = env;

  // небо
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Vector3() }, hor: { value: new THREE.Vector3() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Vector3(1, 0.9, 0.6) },
      twCol: { value: new THREE.Vector3(...SKY.twCol) }, tw: { value: 0 }, night: { value: 0 }, moonDir: { value: new THREE.Vector3(0, -1, 0) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 top, hor, sunDir, sunCol, twCol, moonDir; uniform float tw, night;
      varying vec3 vDir;
      float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(hor, top, pow(h, 0.55));
        float sd = max(dot(d, sunDir), 0.0);
        col += sunCol * (pow(sd, 700.0) * 3.0 + pow(sd, 40.0) * 0.35 + pow(sd, 5.0) * 0.12);
        col += twCol * tw * pow(sd, 2.5) * (1.0 - h) * 0.9;
        float md = max(dot(d, moonDir), 0.0);
        col += vec3(0.85,0.9,1.0) * (smoothstep(0.9993, 0.9998, md) * 1.2 + pow(md, 60.0) * 0.12) * night;
        vec3 c = floor(d * 260.0);
        float r = h3(c);
        col += vec3(smoothstep(0.9965, 1.0, r) * night * smoothstep(0.02, 0.25, d.y) * (0.5 + 0.5 * h3(c + 3.1)));
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false, depthTest: false, side: THREE.BackSide, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);
  env.sky = sky;

  // свет
  const hemi = new THREE.HemisphereLight(0xbcd4f0, 0x5a5a48, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.0);
  sun.castShadow = true;
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 420; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  env.sun = sun; env.hemi = hemi;
  scene.fog = new THREE.FogExp2(0xb8d4ea, 0.0012);

  // облака
  const cloudTex = G.tex.cloud;
  env.clouds = [];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
    const s = new THREE.Sprite(m);
    const sc = rand(260, 480); s.scale.set(sc, sc * 0.5, 1);
    s.userData = { x: rand(-900, 900), z: rand(-900, 900), y: rand(190, 300), sp: rand(1.5, 3.5) };
    s.renderOrder = -9;
    scene.add(s); env.clouds.push(s);
  }

  // дождь
  const RN = 2600;
  const rainPos = new Float32Array(RN * 6), rainBase = new Float32Array(RN * 3);
  for (let i = 0; i < RN; i++) { rainBase[i * 3] = rand(-35, 35); rainBase[i * 3 + 1] = rand(0, 30); rainBase[i * 3 + 2] = rand(-35, 35); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  env.rain3d = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaac4d8, transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
  env.rain3d.frustumCulled = false; env.rain3d.visible = false; scene.add(env.rain3d);
  env.rainBase = rainBase;
  // снег
  const SN = 3000;
  const snowPos = new Float32Array(SN * 3), snowBase = new Float32Array(SN * 3);
  for (let i = 0; i < SN; i++) { snowBase[i * 3] = rand(-35, 35); snowBase[i * 3 + 1] = rand(0, 28); snowBase[i * 3 + 2] = rand(-35, 35); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  env.snow3d = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }));
  env.snow3d.frustumCulled = false; env.snow3d.visible = false; scene.add(env.snow3d);
  env.snowBase = snowBase;
  // снег на земле
  const snowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1400, 900).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf2f6fa, transparent: true, opacity: 0, depthWrite: false }));
  snowPlane.position.set(600, 0.018, 310); snowPlane.renderOrder = 1; scene.add(snowPlane);
  env.snowPlane = snowPlane;

  // северное сияние
  const aur = new THREE.Mesh(new THREE.PlaneGeometry(900, 260, 40, 1), new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, a: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `varying vec2 vUv; uniform float t; void main(){ vUv = uv; vec3 p = position; p.y += sin(position.x*0.012 + t*0.4)*18.0; gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float t, a; void main(){
      float rays = 0.5 + 0.5*sin(vUv.x*90.0 + t*0.7 + sin(vUv.x*17.0 + t)*2.0);
      float band = smoothstep(0.0,0.35,vUv.y) * (1.0 - smoothstep(0.35,1.0,vUv.y));
      vec3 c = mix(vec3(0.1,1.0,0.5), vec3(0.6,0.2,0.9), smoothstep(0.55,1.0,vUv.y));
      gl_FragColor = vec4(c * band * (0.35 + rays*0.65), band * 0.55 * a); }`,
  }));
  aur.position.set(600, 200, -250); aur.rotation.x = 0.35; aur.visible = false; aur.frustumCulled = false; aur.renderOrder = -8;
  scene.add(aur); env.aur = aur;

  env.setWeather = (w, instant) => {
    env.target = w;
    if (instant) { const t = WEATHERS[w]; env.weather = w; env.cloud = t.cloud; env.rain = t.rain; env.snow = t.snow; env.fog = t.fog; env.dark = t.dark; }
  };
  env.weatherName = () => WEATHERS[env.target].name;
  env.timeString = () => {
    const h = Math.floor(env.hour), m = Math.floor((env.hour - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  };
  env.dateString = () => {
    const d = new Date(env.startDate.getTime() + env.day * 86400000);
    const dn = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()];
    const mn = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][d.getMonth()];
    return `${dn}, ${d.getDate()} ${mn} ${d.getFullYear()}`;
  };
  env.setHour = (h) => { if (h < env.hour) env.day++; env.hour = h; };
  env.isNight = () => env.night > 0.5;

  const V = new THREE.Vector3();
  env.update = (dt, cam, focus) => {
    if (!env.paused) {
      env.hour += (dt * TIME_SCALE) / 3600;
      if (env.hour >= 24) { env.hour -= 24; env.day++; G.stats.days = env.day; }
      env.wTimer -= dt;
      if (env.wTimer <= 0) {
        env.wTimer = rand(200, 420);
        const m = new Date(env.startDate.getTime() + env.day * 86400000).getMonth();
        const pool = m >= 10 || m <= 2 ? ['snow', 'snow', 'cloudy', 'clear', 'fog', 'cloudy'] : ['clear', 'clear', 'cloudy', 'rain', 'fog', 'storm', 'cloudy'];
        env.setWeather(pick(pool));
      }
    }
    const tw = WEATHERS[env.target];
    const k = 1 - Math.exp(-dt * 0.25);
    env.cloud = lerp(env.cloud, tw.cloud, k); env.rain = lerp(env.rain, tw.rain, k * 1.4); env.snow = lerp(env.snow, tw.snow, k * 1.4); env.fog = lerp(env.fog, tw.fog, k); env.dark = lerp(env.dark, tw.dark, k);
    env.snowGround = clamp(env.snowGround + (env.snow > 0.3 ? dt * 0.004 : -dt * 0.0015), 0, 0.9);
    // положение солнца
    const a = ((env.hour - 6) / 24) * Math.PI * 2;
    const sinA = Math.sin(a);
    const el = Math.asin(sinA) * 0.62 + (sinA > 0 ? 0.02 : 0);
    const az = Math.cos(a) * 1.3 + 0.6;
    env.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    const day = smooth(clamp((sinA + 0.12) / 0.4, 0, 1));
    env.day01 = day; env.night = 1 - day; UNI.night.value = clamp(env.night * 1.15 - 0.1 + env.dark * 0.08, 0, 1);
    const twg = Math.exp(-Math.pow(sinA / 0.2, 2));
    const gray = env.dark;
    let top = mix3(SKY.nightTop, SKY.dayTop, day), hor = mix3(SKY.nightHor, SKY.dayHor, day);
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    const grayify = (c, t, br) => { const l = lum(c) * br; return [lerp(c[0], l, t), lerp(c[1], l, t), lerp(c[2], l, t)]; };
    top = grayify(top, clamp(env.cloud * 0.8 + env.fog * 0.3, 0, 0.92), 1 - gray * 0.5);
    hor = grayify(hor, clamp(env.cloud * 0.7 + env.fog * 0.5, 0, 0.92), 1 - gray * 0.4);
    if (env.fog > 0.3) { hor = mix3(hor, mix3([0.33, 0.35, 0.38], [0.72, 0.74, 0.76], day), env.fog * 0.8); top = mix3(top, hor, env.fog * 0.6); }
    const u = skyMat.uniforms;
    const lin = G.post && G.post.on; const K = (c) => (lin ? c.map((x) => Math.pow(x, 2.2)) : c);
    u.top.value.set(...K(top)); u.hor.value.set(...K(hor));
    u.sunDir.value.copy(env.sunDir);
    u.moonDir.value.copy(env.sunDir).multiplyScalar(-1);
    u.tw.value = twg * (1 - env.cloud * 0.6);
    u.night.value = env.night * (1 - env.cloud * 0.85);
    u.sunCol.value.set(1, lerp(0.6, 0.95, day), lerp(0.3, 0.8, day)).multiplyScalar((1 - env.cloud * 0.9) * (sinA > -0.05 ? 1 : 0));
    { const fh = K(hor); scene.fog.color.setRGB(fh[0], fh[1], fh[2], THREE.LinearSRGBColorSpace); }
    if (G.vehMat) G.vehMat.envMapIntensity = lerp(0.12, 1.0, day) * (1 - gray * 0.4);
    scene.fog.density = 0.0011 + env.fog * 0.0085 + env.rain * 0.0006 + env.snow * 0.0015;
    // свет
    const sunUp = Math.max(0, env.sunDir.y);
    const lightDir = sinA > -0.05 ? env.sunDir : V.copy(env.sunDir).multiplyScalar(-1);
    const dirI = sinA > -0.03 ? (0.4 + 2.0 * clamp(sunUp * 2.2, 0, 1)) * (1 - env.cloud * 0.65) * day + 0.0 : 0.35 * (1 - env.cloud * 0.5);
    env.sun.intensity = dirI * (1 - gray * 0.5) + env.lightning * 3;
    env.sun.color.setRGB(lerp(1.0, 0.7, 1 - day), lerp(0.85 + sunUp * 0.1, 0.78, 1 - day), lerp(0.62 + sunUp * 0.3, 1.0, 1 - day));
    env.hemi.intensity = lerp(0.45, 0.95, day) * (1 - gray * 0.35) + env.lightning * 1.0;
    env.hemi.color.setRGB(...mix3([0.35, 0.42, 0.62], [0.72, 0.84, 1.0], day));
    env.hemi.groundColor.setRGB(...mix3([0.1, 0.1, 0.12], [0.42, 0.4, 0.34], day));
    renderer.toneMappingExposure = lerp(1.15, 0.95, day);
    // позиция света и тени
    focus = focus || cam.position;
    const sn = 2;
    const fx = Math.round(focus.x / sn) * sn, fz = Math.round(focus.z / sn) * sn;
    env.sun.target.position.set(fx, 0, fz);
    env.sun.position.set(fx + lightDir.x * 200, Math.max(lightDir.y, 0.12) * 200, fz + lightDir.z * 200);
    sky.position.copy(cam.position);
    // облака
    const wind = env.time || (env.time = 0); env.time += dt;
    const vis = clamp(env.cloud * 1.2, 0, 1);
    env.clouds.forEach((s, i) => {
      const d = s.userData;
      let x = ((d.x + env.time * d.sp - cam.position.x + 900) % 1800 + 1800) % 1800 - 900;
      let z = ((d.z + env.time * d.sp * 0.4 - cam.position.z + 900) % 1800 + 1800) % 1800 - 900;
      s.position.set(cam.position.x + x, d.y, cam.position.z + z);
      s.material.opacity = clamp(vis * 1.1 - (i / env.clouds.length) * (1 - vis) * 1.2, 0, 0.95);
      const l = lerp(0.12, 1, day) * (1 - gray * 0.55);
      s.material.color.setRGB(l * (0.9 + twg * 0.2), l * (0.9 - twg * 0.05), l * (0.95 - twg * 0.15));
      s.visible = s.material.opacity > 0.02;
    });
    // осадки
    updatePrecip(dt, cam);
    // молния
    env.lightning = Math.max(0, env.lightning - dt * 3);
    if (env.target === 'storm' && Math.random() < dt * 0.09) { env.lightning = 1; env.thunder = 1 + Math.random() * 2; }
    if (env.thunder > 0) { env.thunder -= dt; if (env.thunder <= 0 && env.onThunder) env.onThunder(); }
    // лампы
    const nl = clamp(env.night * 1.2 + env.dark * 0.4 - 0.1, 0, 1);
    if (City.lampGlow) {
      City.lampGlow.material.opacity = nl * 0.9; City.lampSpots.material.opacity = nl * 0.55;
      City.lampGlow.visible = City.lampSpots.visible = nl > 0.02;
      City.lampHeadMat.color.setRGB(lerp(0.3, 1.0, nl), lerp(0.3, 0.85, nl), lerp(0.3, 0.55, nl));
    }
    env.lampLevel = nl;
    // сияние
    if (env.night > 0.85 && env.cloud < 0.5 && !env.auroraOn && Math.random() < dt * 0.004) { env.auroraOn = true; env.auroraT = 120; if (env.onAurora) env.onAurora(); }
    if (env.auroraOn) { env.auroraT -= dt; if (env.auroraT <= 0 || env.night < 0.5) env.auroraOn = false; }
    env.aurora = damp(env.aurora, env.auroraOn ? 1 : 0, 0.6, dt);
    env.aur.visible = env.aurora > 0.02; env.aur.material.uniforms.a.value = env.aurora; env.aur.material.uniforms.t.value = env.time;
    env.aur.position.set(cam.position.x, 190, cam.position.z - 300);
    // вода
    if (G.waterMesh) {
      const m = G.waterMesh.material;
      m.map.offset.x = env.time * 0.004; m.map.offset.y = env.time * 0.002;
      const wl = lerp(0.25, 1.0, day) * (1 - gray * 0.4);
      m.color.setRGB(wl * 0.9, wl, wl * 1.05);
    }
    // снег на земле
    env.snowPlane.material.opacity = env.snowGround * 0.9;
    env.snowPlane.material.color.setScalar(lerp(0.3, 1, day));
    if (G.ground) G.ground.material.color.setScalar(lerp(0.32, 1, day) * (1 - gray * 0.15));
  };

  function updatePrecip(dt, cam) {
    const r = env.rain3d, s = env.snow3d;
    r.visible = env.rain > 0.05; s.visible = env.snow > 0.05;
    if (r.visible) {
      const p = r.geometry.attributes.position.array, b = env.rainBase;
      const n = Math.floor(RN * clamp(env.rain, 0, 1));
      const fall = 32 * dt;
      for (let i = 0; i < RN; i++) {
        if (i >= n) { p[i * 6] = p[i * 6 + 1] = p[i * 6 + 2] = p[i * 6 + 3] = p[i * 6 + 4] = p[i * 6 + 5] = 0; continue; }
        b[i * 3 + 1] -= fall; if (b[i * 3 + 1] < 0) b[i * 3 + 1] += 30;
        const x = cam.position.x + ((b[i * 3] - cam.position.x % 70 + 105) % 70) - 35, z = cam.position.z + ((b[i * 3 + 2] - cam.position.z % 70 + 105) % 70) - 35, y = b[i * 3 + 1];
        p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z; p[i * 6 + 3] = x - 0.15; p[i * 6 + 4] = y + 0.9; p[i * 6 + 5] = z - 0.05;
      }
      r.geometry.attributes.position.needsUpdate = true;
    }
    if (s.visible) {
      const p = s.geometry.attributes.position.array, b = env.snowBase;
      const n = Math.floor(3000 * clamp(env.snow, 0, 1));
      for (let i = 0; i < 3000; i++) {
        if (i >= n) { p[i * 3 + 1] = -100; continue; }
        b[i * 3 + 1] -= dt * (1.6 + (i % 7) * 0.2); if (b[i * 3 + 1] < 0) b[i * 3 + 1] += 28;
        p[i * 3] = cam.position.x + ((b[i * 3] + Math.sin(env.time * 0.6 + i) * 0.6 - cam.position.x % 70 + 105) % 70) - 35;
        p[i * 3 + 1] = b[i * 3 + 1];
        p[i * 3 + 2] = cam.position.z + ((b[i * 3 + 2] - cam.position.z % 70 + 105) % 70) - 35;
      }
      s.geometry.attributes.position.needsUpdate = true;
    }
  }
  return env;
}
