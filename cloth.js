// The kain window: the active batik as a piece of cloth hanging from a rod, moving in the breeze.
//
// One plane, displaced in a vertex shader. The top edge is pinned to the rod, so the waves grow
// towards the hem. Tapping the cloth sends a ripple through it. The fragment shader lights the
// folds, adds fine woven threads and a soft sheen. A new batik crossfades onto the cloth.
//
// Loaded on demand the first time the window opens.

import * as THREE from './vendor/three/three.module.js';

const RIPPLES = 4;

const VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uSize;               // the cloth's width and height
uniform vec4 uRipples[${RIPPLES}]; // xy = where (uv), z = when (s), w = strength

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
varying float vFold;

float lift(vec2 uv, float t) {
  float hang = pow(1.0 - uv.y, 1.15); // 0 at the rod, 1 at the hem
  float breeze = sin(uv.x * 6.0 + t * 1.7) * 0.035
               + sin(uv.y * 9.0 - t * 2.3 + uv.x * 3.0) * 0.022
               + sin((uv.x + uv.y) * 15.0 + t * 3.1) * 0.007;
  float ripple = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    float age = t - uRipples[i].z;
    if (age < 0.0 || age > 4.0) continue;
    float d = distance(uv, uRipples[i].xy);
    ripple += sin(d * 36.0 - age * 10.0) * exp(-d * 4.5) * exp(-age * 1.2) * 0.055 * uRipples[i].w;
  }
  return breeze * hang + ripple * (0.3 + 0.7 * hang);
}

void main() {
  vUv = uv;
  float e = 0.004;
  float h = lift(uv, uTime);
  float hx = lift(uv + vec2(e, 0.0), uTime);
  float hy = lift(uv + vec2(0.0, e), uTime);
  vec3 p = position;
  p.z += h;
  p.x += sin(uTime * 0.9 + uv.y * 2.0) * 0.012 * pow(1.0 - uv.y, 1.5); // a little sway at the hem
  vNormal = normalize(normalMatrix * normalize(cross(vec3(e * uSize.x, 0.0, hx - h), vec3(0.0, e * uSize.y, hy - h))));
  vFold = h;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMapA;
uniform sampler2D uMapB;
uniform float uMix;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
varying float vFold;

void main() {
  vec3 base = mix(texture2D(uMapA, vUv).rgb, texture2D(uMapB, vUv).rgb, uMix);
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) { n = -n; base *= 0.55; } // the back of the cloth: dye shows through, darker
  vec3 L = normalize(vec3(-0.45, 0.55, 0.9));
  vec3 V = normalize(vView);
  float diffuse = 0.5 + 0.62 * max(dot(n, L), 0.0);
  float sheen = pow(max(dot(reflect(-L, n), V), 0.0), 18.0) * 0.16;
  // woven threads: warp and weft, too fine to see except as texture
  float weave = 0.93 + 0.07 * (0.5 + 0.5 * sin(vUv.x * 1500.0)) * (0.5 + 0.5 * sin(vUv.y * 1800.0));
  float shade = 1.0 - clamp(-vFold * 2.5, 0.0, 0.18); // deeper folds fall into shadow
  gl_FragColor = vec4(base * diffuse * weave * shade + sheen, 1.0);
}`;

export class Cloth {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // textures are passed straight through
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, -0.02, 3.05);

    const W = 1, H = 1.25;
    const blank = new THREE.DataTexture(new Uint8Array([40, 30, 24, 255]), 1, 1);
    blank.needsUpdate = true;
    this.uniforms = {
      uTime: { value: 0 },
      uSize: { value: new THREE.Vector2(W, H) },
      uRipples: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0)) },
      uMapA: { value: blank },
      uMapB: { value: blank },
      uMix: { value: 1 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H, 70, 88),
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.DoubleSide }),
    );
    // cloth and rod turn together, a little towards you
    const hanging = new THREE.Group();
    hanging.rotation.y = -0.22;
    hanging.add(this.mesh);
    this.scene.add(hanging);

    // the bamboo rod it hangs from
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, W * 1.22, 20),
      new THREE.MeshBasicMaterial({ color: 0xc9a46a }),
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.y = H / 2 + 0.01;
    hanging.add(rod);

    this.ripple = 0;
    this.fadeFrom = 0;
    this.raf = 0;
    this.t0 = performance.now();
    this.raycaster = new THREE.Raycaster();
    this.resize();
  }

  // Put a new batik on the cloth; it crossfades from the one before.
  setTexture(source) {
    const tex = new THREE.CanvasTexture(source);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const u = this.uniforms;
    const gone = u.uMapA.value;
    u.uMapA.value = u.uMapB.value; // fade from whatever was showing last
    if (gone !== u.uMapA.value) gone.dispose();
    u.uMapB.value = tex;
    u.uMix.value = 0;
    this.fadeFrom = performance.now();
  }

  // Tap or drag on the cloth to ripple it.
  poke(clientX, clientY, strength = 1) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh)[0];
    if (!hit) return;
    const slot = this.uniforms.uRipples.value[this.ripple++ % RIPPLES];
    slot.set(hit.uv.x, hit.uv.y, this.time(), strength);
  }

  time() { return (performance.now() - this.t0) / 1000; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Back the camera off far enough that the whole cloth (and rod) fits, tall screen or wide.
    const half = Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.position.z = Math.max(3.05, 1.4 / (2 * half * this.camera.aspect));
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.raf) return;
    const tick = () => {
      this.uniforms.uTime.value = this.time();
      this.uniforms.uMix.value = Math.min(1, (performance.now() - this.fadeFrom) / 650);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
