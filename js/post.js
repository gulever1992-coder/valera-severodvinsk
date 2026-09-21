// Постобработка: MSAA, свечение (bloom), «киношная» цветокоррекция начала 2000-х, виньетка, вспышка урона
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G } from './state.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.14 }, contrast: { value: 1.1 }, tint: { value: new THREE.Vector3(1.05, 1.0, 0.93) }, vig: { value: 0.32 }, hurt: { value: 0 }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float sat, contrast, vig, hurt, time; uniform vec3 tint; varying vec2 vUv;
    void main(){
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 c = t.rgb;
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(l), c, sat);
      c = (c - 0.18) * contrast + 0.18;
      c *= tint;
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d) * (1.0 + vig));
      c *= mix(1.0 - vig, 1.0, v);
      c = mix(c, c * vec3(1.6, 0.35, 0.35), hurt);
      float g = fract(sin(dot(vUv * 800.0 + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c += g * 0.012;
      gl_FragColor = vec4(max(c, 0.0), t.a);
    }`,
};

export const Post = {
  on: false, quality: 'high',
  init(renderer, scene, camera) {
    Post.renderer = renderer; Post.scene = scene; Post.camera = camera;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const c = new EffectComposer(renderer, rt);
    c.addPass(new RenderPass(scene, camera));
    Post.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 0.92);
    c.addPass(Post.bloom);
    Post.grade = new ShaderPass(GradeShader);
    c.addPass(Post.grade);
    c.addPass(new OutputPass());
    Post.composer = c;
    G.post = Post;
  },
  setQuality(q) {
    Post.quality = q;
    Post.on = q !== 'low';
    if (Post.bloom) Post.bloom.enabled = q === 'high';
  },
  resize(w, h) { if (Post.composer) { Post.composer.setPixelRatio(Post.renderer.getPixelRatio()); Post.composer.setSize(w, h); } },
  render(dt) {
    if (!Post.on) { Post.renderer.render(Post.scene, Post.camera); return; }
    const u = Post.grade.uniforms;
    u.time.value = (u.time.value + dt) % 100;
    u.hurt.value = G.player ? Math.min(0.5, G.player.hitFlash * 0.6) : 0;
    Post.composer.render(dt);
  },
};
