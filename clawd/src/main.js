import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { Clawd } from './clawd.js';
import { MOVES, evalMove, blendPose, mirrorPose, hash, fr, clamp, lerp, smooth } from './moves.js';
import { Music } from './music.js';
import { SECTION_ENERGY } from './song.js';
import { LedScreen } from './screen.js';
import { TRACKS, customTrack } from './tracks.js';
import { analyzeSong } from './analysis.js';
import { Lasers, Particles, FloorSmoke, FIRE_RAMP, CO2_RAMP, FIRE, CO2 } from './fx.js';
import { Crowd } from './crowd.js';
import { RhythmGame } from './game.js';
import { ClipRecorder } from './recorder.js';

const $ = (id) => document.getElementById(id);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const BG = 0x09060d;
scene.background = new THREE.Color(BG);
scene.fog = new THREE.FogExp2(BG, 0.028);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
camera.position.set(0, 3, 11.5);

const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.setPixelRatio(DPR);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const fx = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uFlash: { value: 0 },
    uAberr: { value: 0.003 }, uVig: { value: 0.45 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uFlash, uAberr, uVig; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5; float r = length(d);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + d * uAberr).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - d * uAberr).b;
      col *= 1.0 - uVig * smoothstep(0.25, 0.85, r);
      col += (hash(vUv * 1024.0 + fract(uTime) * 97.0) - 0.5) * 0.03;
      col = mix(col, vec3(1.0), uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(fx);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 1.4, 0);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 25;
controls.enabled = false;

// ---------------------------------------------------------------- materials
const darkMat = new THREE.MeshStandardMaterial({ color: 0x15121a, roughness: 0.65, metalness: 0.3, envMapIntensity: 0.2 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x2a2830, roughness: 0.35, metalness: 0.9, envMapIntensity: 0.5 });
const silhouetteMat = new THREE.MeshStandardMaterial({ color: 0x060407, roughness: 1, metalness: 0, envMapIntensity: 0.05 });

// ---------------------------------------------------------------- floor
const reflector = new Reflector(new THREE.PlaneGeometry(60, 60), {
  clipBias: 0.003,
  textureWidth: Math.floor(innerWidth * DPR * 0.5),
  textureHeight: Math.floor(innerHeight * DPR * 0.5),
  color: 0x5c5866,
});
reflector.rotation.x = -Math.PI / 2;
scene.add(reflector);
const plainFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x141018, roughness: 0.25, metalness: 0.6, envMapIntensity: 0.4 }),
);
plainFloor.rotation.x = -Math.PI / 2;
plainFloor.visible = false;
scene.add(plainFloor);

const TN = 16;
const tileGeo = new THREE.PlaneGeometry(0.93, 0.93);
tileGeo.rotateX(-Math.PI / 2);
const tileMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});
const tiles = new THREE.InstancedMesh(tileGeo, tileMat, TN * TN);
const tilePos = [];
{
  const m = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < TN; i++) {
    for (let j = 0; j < TN; j++) {
      const x = i - (TN - 1) / 2;
      const z = j - (TN - 1) / 2 - 1;
      m.makeTranslation(x, 0.006, z);
      tiles.setMatrixAt(k, m);
      tiles.setColorAt(k, new THREE.Color(0));
      tilePos.push({ i, j, x, z });
      k++;
    }
  }
}
scene.add(tiles);

const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.55 }));
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.y = 0.01;
shadowPlane.receiveShadow = true;
shadowPlane.renderOrder = 2;
scene.add(shadowPlane);

// Yansımada pist ve gölge tekrar çizilmesin
{
  const orig = reflector.onBeforeRender;
  reflector.onBeforeRender = function (...args) {
    tiles.visible = false;
    shadowPlane.visible = false;
    orig.apply(this, args);
    tiles.visible = true;
    shadowPlane.visible = true;
  };
}

// ---------------------------------------------------------------- back wall & LED screen
const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 24), darkMat);
wall.position.set(0, 10, -11);
scene.add(wall);

const led = new LedScreen();
const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(14.6, 5.9, 0.3), metalMat);
screenFrame.position.set(0, 4.4, -10.4);
scene.add(screenFrame);
const screenMat = new THREE.MeshBasicMaterial({ map: led.texture, toneMapped: false });
screenMat.color.setScalar(1.7);
const screen = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.25), screenMat);
screen.position.set(0, 4.4, -10.24);
scene.add(screen);

// ---------------------------------------------------------------- speakers
const speakers = [];
for (const side of [-1, 1]) {
  const g = new THREE.Group();
  g.position.set(side * 7.4, 0, -5);
  g.rotation.y = -side * 0.35;
  const cab = new THREE.Mesh(new RoundedBoxGeometry(1.9, 3.4, 1.3, 2, 0.05), darkMat);
  cab.position.y = 1.7;
  cab.castShadow = true;
  g.add(cab);
  const cones = [];
  for (const [y, r] of [[2.55, 0.48], [1.2, 0.68]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 12, 40), metalMat);
    ring.position.set(0, y, 0.66);
    g.add(ring);
    const cone = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 40), new THREE.MeshStandardMaterial({ color: 0x0b0a0d, roughness: 0.9 }));
    cone.position.set(0, y, 0.64);
    g.add(cone);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.28, 20, 12), metalMat);
    cap.scale.z = 0.4;
    cap.position.set(0, y, 0.66);
    g.add(cap);
    cones.push({ cap, cone, y });
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  strip.position.set(0, 0.25, 0.66);
  g.add(strip);
  scene.add(g);
  speakers.push({ g, cones, strip });
}

// ---------------------------------------------------------------- truss + moving heads
const TRUSS_Y = 7.8;
{
  const bar = new THREE.Mesh(new THREE.BoxGeometry(19, 0.25, 0.25), metalMat);
  bar.position.set(0, TRUSS_Y + 0.35, -1.5);
  scene.add(bar);
  for (const x of [-9.5, 9.5]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, TRUSS_Y + 0.5, 0.25), metalMat);
    pole.position.set(x, (TRUSS_Y + 0.5) / 2, -1.5);
    scene.add(pole);
  }
}

const BEAM_LEN = 14;
const beamGeo = new THREE.ConeGeometry(1.7, BEAM_LEN, 48, 1, true);
beamGeo.translate(0, -BEAM_LEN / 2, 0);
beamGeo.rotateX(-Math.PI / 2);

function makeBeamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0.2 }, uLen: { value: BEAM_LEN } },
    vertexShader: /* glsl */ `
      varying float vT; varying vec3 vN; varying vec3 vV; varying float vD;
      void main() {
        vT = position.z;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        vD = length(mv.xyz);
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; uniform float uLen;
      varying float vT; varying vec3 vN; varying vec3 vV; varying float vD;
      void main() {
        float t = clamp(vT / uLen, 0.0, 1.0);
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = uOpacity * edge * pow(1.0 - t, 1.4) * smoothstep(0.0, 0.04, t) * smoothstep(1.5, 6.0, vD);
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const heads = [-6, -2, 2, 6].map((x, k) => {
  const pivot = new THREE.Object3D();
  pivot.position.set(x, TRUSS_Y, -1.5);
  scene.add(pivot);
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.6, 20), metalMat);
  housing.rotation.x = Math.PI / 2;
  housing.position.z = -0.1;
  pivot.add(housing);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.27, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  lens.position.z = 0.21;
  pivot.add(lens);
  const beam = new THREE.Mesh(beamGeo, makeBeamMaterial());
  pivot.add(beam);
  const light = new THREE.SpotLight(0xffffff, 120, 0, 0.32, 0.55, 2);
  light.position.copy(pivot.position);
  scene.add(light, light.target);
  return { pivot, lens, beam, light, k, target: new THREE.Vector3(), color: new THREE.Color() };
});

// ---------------------------------------------------------------- lights
scene.add(new THREE.HemisphereLight(0x6a4cff, 0x140808, 0.45));
const key = new THREE.SpotLight(0xffe6d0, 110, 0, 0.42, 0.7, 2);
key.position.set(2.5, 9.5, 7.5);
key.target.position.set(0, 1, -0.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.camera.near = 4;
key.shadow.camera.far = 24;
scene.add(key, key.target);
const rims = [-1, 1].map((s) => {
  const l = new THREE.PointLight(0xff00aa, 40, 0, 2);
  l.position.set(s * 3, 3.2, -3);
  scene.add(l);
  return l;
});

// ---------------------------------------------------------------- disco ball
const ballY = 6.6;
const ball = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.75, 3),
  new THREE.MeshStandardMaterial({ color: 0xd8d8e0, metalness: 1, roughness: 0.12, flatShading: true, envMapIntensity: 2.2 }),
);
ball.position.set(0, ballY, 1);
scene.add(ball);
{
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, TRUSS_Y + 2 - ballY), metalMat);
  rod.position.set(0, (TRUSS_Y + 2 + ballY) / 2, 1);
  scene.add(rod);
}
const sparkleGeo = new THREE.BufferGeometry();
{
  const n = 420;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection();
    v.y = -Math.abs(v.y) * 0.9 + 0.1;
    v.normalize().multiplyScalar(rand(5, 11));
    arr.set([v.x, v.y, v.z], i * 3);
  }
  sparkleGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
}
const sparkleMat = new THREE.PointsMaterial({
  color: 0xffffff, size: 0.09, transparent: true, opacity: 0.5,
  blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});
const sparkles = new THREE.Points(sparkleGeo, sparkleMat);
sparkles.position.copy(ball.position);
scene.add(sparkles);

// Havadaki toz: ışık huzmelerinde parıldar
const dustGeo = new THREE.BufferGeometry();
{
  const n = 900;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([rand(-11, 11), rand(0, 9), rand(-9, 9)], i * 3);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
}
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color: 0xffffff, size: 0.035, transparent: true, opacity: 0.35,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
scene.add(dust);

// ---------------------------------------------------------------- dancers
const star = new Clawd();
scene.add(star.root);
const backups = [-1, 1].map((side) => {
  const c = new Clawd({ scale: 0.62, color: 0xc7684a });
  c.side = side;
  c.home.set(side * 3.6, 0, -1.8);
  c.vis = 0;
  scene.add(c.root);
  return c;
});

// ---------------------------------------------------------------- crowd & show fx
const crowd = new Crowd(scene);
const lasers = new Lasers(scene);
const pyro = new Particles(scene, { count: 1800, ramp: FIRE_RAMP, sizeGrow: 0.8 });
const co2 = new Particles(scene, { count: 500, ramp: CO2_RAMP, sizeGrow: 1.4 });
const smoke = new FloorSmoke(scene);
const NOZZLES = [[-6.8, -2.5], [-6.8, 2.5], [6.8, -2.5], [6.8, 2.5]].map(([x, z]) => {
  const m = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.5, 2, 0.05), metalMat);
  m.position.set(x, 0.15, z);
  scene.add(m);
  return new THREE.Vector3(x, 0.32, z);
});
const pyroLights = [-1, 1].map((side) => {
  const l = new THREE.PointLight(0xff7a2a, 0, 0, 2);
  l.position.set(side * 6.8, 2.2, 0);
  scene.add(l);
  return l;
});
function firePyro(duration = 0.7, which = [0, 1, 2, 3]) {
  for (const i of which) pyro.jet(NOZZLES[i], duration, 170, FIRE);
}
function fireCO2(duration = 0.9) {
  for (const n of NOZZLES) co2.jet(n, duration, 55, CO2);
}

// ---------------------------------------------------------------- confetti
const CN = 600;
const confetti = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.07, 0.13),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
  CN,
);
const conf = [];
{
  const palette = [0xff5fa2, 0x5fd4ff, 0xffd25f, 0xd97757, 0x9b7bff, 0x7bffb0, 0xffffff];
  const c = new THREE.Color();
  for (let i = 0; i < CN; i++) {
    c.set(palette[i % palette.length]).multiplyScalar(1.3);
    confetti.setColorAt(i, c);
    conf.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 });
  }
}
confetti.frustumCulled = false;
scene.add(confetti);
function burstConfetti(n = CN) {
  let spawned = 0;
  for (const q of conf) {
    if (spawned >= n) break;
    if (q.life > 0.5) continue;
    q.p.set(rand(-8, 8), rand(8.5, 11), rand(-5, 5));
    q.v.set(rand(-1, 1), rand(-1.5, 0), rand(-1, 1));
    q.r.set(rand(0, 6), rand(0, 6), rand(0, 6));
    q.w.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
    q.life = rand(7, 10);
    spawned++;
  }
}

// ---------------------------------------------------------------- music & clock
const music = new Music();
const clock = { bpm: music.bpm, base: 0, anchor: performance.now() / 1000 };
const track = () => music.track;
function currentBeat() {
  if (music.playing) return music.beat;
  return clock.base + ((performance.now() / 1000 - clock.anchor) * clock.bpm) / 60;
}
function resetSilentClock(beat) {
  clock.base = beat;
  clock.anchor = performance.now() / 1000;
}
function setBpm(bpm) {
  resetSilentClock(currentBeat());
  clock.bpm = bpm;
  music.setBpm(bpm);
  $('tempo').value = String(Math.round(bpm));
  $('tempoVal').textContent = Math.round(bpm);
  $('bpmLabel').textContent = `${Math.round(bpm)} BPM`;
}
async function toggleMusic(force) {
  const want = force ?? !music.playing;
  if (want && !music.playing) {
    try {
      await music.play(Math.max(0, currentBeat()));
    } catch {
      notice('Ses başlatılamadı', 2500);
    }
  } else if (!want && music.playing) {
    if (game.active) stopGame();
    const b = music.beat;
    music.pause();
    resetSilentClock(b);
  }
  $('btnMusic').setAttribute('aria-pressed', String(music.playing));
}

// ---------------------------------------------------------------- state
const state = {
  manual: null,
  cam: 'auto',
  move: { id: 'idle', since: 0, prev: null },
  lastSec: null,
  lastBar: -1,
  shot: { key: '', name: 'wide', start: 0 },
  flash: 0,
  energy: 0.25,
  hue: 0.05,
  fever: false,
  quality: 'high',
  fl: { armL: 0, armR: 0, stomp: 0, jump: 0, stumble: 0, dir: 1 },
};

// ---------------------------------------------------------------- camera director
const SHOTS = {
  wide: (s) => ({ p: [Math.sin(s * 0.05) * 2.2, 3.1, 11.8 - s * 0.06], t: [0, 1.8, 0], fov: 42 }),
  orbit: (s) => { const a = 0.7 + s * 0.09; return { p: [Math.sin(a) * 7.6, 2.5, Math.cos(a) * 7.6], t: [0, 1.4, 0], fov: 44 }; },
  low: (s) => ({ p: [2.8 - s * 0.12, 0.5, 5.4], t: [0, 2.0, 0], fov: 48 }),
  close: (s) => ({ p: [-0.9 + s * 0.08, 2.1, 6.2 - s * 0.05], t: [0, 1.3, 0], fov: 36 }),
  top: (s) => ({ p: [Math.sin(s * 0.08) * 1.5, 12.5, 4.2], t: [0, 0, 0.3], fov: 55 }),
  side: (s) => ({ p: [-8.2, 2.6, 2.4 + s * 0.1], t: [0, 1.3, 0], fov: 40 }),
  crowd: (s) => ({ p: [1.4 - s * 0.05, 1.7, 10.4], t: [0, 1.9, 0], fov: 30 }),
};
function shotFor(bar, sec) {
  const k = Math.floor(bar / 2);
  switch (sec.name) {
    case 'intro': return bar < 4 ? 'wide' : 'orbit';
    case 'groove': return ['orbit', 'close', 'side', 'low', 'crowd', 'top'][hash(k) % 6];
    case 'build': return sec.i < 2 ? 'close' : sec.i < 3 ? 'low' : 'top';
    case 'drop': return sec.i < 2 ? 'wide' : ['orbit', 'low', 'close', 'side', 'crowd', 'top', 'wide'][hash(k + 7) % 7];
    case 'break': return 'orbit';
  }
  return 'wide';
}
const tmpV = new THREE.Vector3();
function updateCamera(beat, bar, sec, pulse, dt) {
  if (state.cam === 'free') {
    controls.update();
    return;
  }
  const name = shotFor(bar, sec);
  const keyId = `${name}:${sec.name}:${Math.floor(bar / 2)}`;
  if (keyId !== state.shot.key) {
    if (name !== state.shot.name || sec.name !== state.lastShotSec) state.shot.start = beat;
    state.shot.key = keyId;
    state.shot.name = name;
    state.lastShotSec = sec.name;
  }
  const s = beat - state.shot.start;
  const sh = SHOTS[name](s);
  const portrait = camera.aspect < 1 ? 1.45 : 1;
  camera.position.set(...sh.p);
  const shake = pulse * state.energy * (sec.name === 'drop' ? 0.05 : 0.015);
  camera.position.x += Math.sin(beat * 40) * shake;
  camera.position.y += Math.cos(beat * 37) * shake;
  camera.lookAt(tmpV.set(...sh.t));
  camera.fov = sh.fov * portrait - pulse * (sec.name === 'drop' ? 1.4 : 0.4);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- per-frame helpers
const tileColor = new THREE.Color();
function updateFloor(beat, sec, prog, pulse, dancerX) {
  const ph = fr(beat);
  for (let k = 0; k < tilePos.length; k++) {
    const { i, j, x, z } = tilePos[k];
    const dist = Math.hypot(x - dancerX, z);
    let h = state.hue, v = 0;
    switch (sec.name) {
      case 'intro':
        v = 0.06 + 0.06 * Math.sin(dist * 0.8 - beat * 1.5);
        h = 0.05;
        break;
      case 'groove': {
        const on = (i + j + Math.floor(beat)) % 2 === 0;
        v = on ? 0.18 + 0.4 * pulse : 0.03;
        h = Math.floor(beat / 4) % 2 ? 0.52 : 0.88;
        if (dist < 1.6) v += 0.15 * (1 - dist / 1.6);
        break;
      }
      case 'build': {
        const rate = sec.i < 2 ? 1 : sec.i < 3 ? 2 : 4;
        const row = Math.floor(fr(beat * rate / 4) * TN);
        v = (TN - 1 - j) === row ? 0.75 : 0.02 + 0.08 * prog;
        if (sec.i === 3 && (hash(k + Math.floor(beat * 8) * 997) % 7 === 0)) v = 0.9;
        h = 0.08 + prog * 0.08;
        break;
      }
      case 'drop': {
        const w = ph * 11;
        v = Math.exp(-Math.pow(dist - w, 2) * 1.2) * 0.85 + 0.05 + 0.15 * pulse;
        h = fr(dist * 0.06 - beat * 0.12);
        break;
      }
      case 'break':
        v = hash(k * 31 + Math.floor(beat * 2) * 7919) % 9 === 0 ? 0.45 : 0.02;
        h = 0.64 + 0.06 * Math.sin(k);
        break;
    }
    tileColor.setHSL(h, 1, clamp(v, 0, 1) * 0.5).multiplyScalar(2.4);
    tiles.setColorAt(k, tileColor);
  }
  tiles.instanceColor.needsUpdate = true;
}

const headColor = new THREE.Color();
function updateHeads(beat, sec, prog, pulse, energy) {
  for (const hd of heads) {
    const k = hd.k;
    const side = k < 2 ? -1 : 1;
    let tx = 0, tz = 0, hue = state.hue, op = 0.12, inten = 80;
    switch (sec.name) {
      case 'intro':
        tx = Math.sin(beat * 0.25 + k) * 4; tz = Math.cos(beat * 0.2 + k * 1.3) * 2;
        hue = 0.06 + k * 0.02; op = 0.08; inten = 50;
        break;
      case 'groove':
        tx = Math.sin(beat * 0.5 + k * 1.7) * 5; tz = Math.sin(beat * 0.25 + k) * 3;
        hue = k % 2 ? 0.88 : 0.52; op = 0.13 + 0.07 * pulse; inten = 90 + 60 * pulse;
        break;
      case 'build': {
        const r = 4 * (1 - prog) + 0.3;
        const a = beat * (1 + prog * 4) + (k * Math.PI) / 2;
        tx = Math.cos(a) * r; tz = Math.sin(a) * r * 0.6;
        hue = 0.08; op = 0.08 + 0.18 * prog; inten = 60 + 160 * prog;
        break;
      }
      case 'drop': {
        const swap = Math.floor(beat) % 2 ? 1 : -1;
        tx = side * swap * (2 + 2.5 * Math.sin(beat * 0.5 + k)); tz = Math.cos(beat * 0.7 + k) * 3;
        hue = fr(state.hue + k * 0.25); op = 0.16 + 0.14 * pulse; inten = 120 + 140 * pulse;
        break;
      }
      case 'break':
        tx = Math.sin(beat * 0.15 + k * 2) * 6; tz = Math.cos(beat * 0.12 + k) * 4;
        hue = 0.66; op = 0.06; inten = 35;
        break;
    }
    hd.target.lerp(tmpV.set(tx, 0, tz), 0.12);
    hd.pivot.lookAt(hd.target);
    hd.light.target.position.copy(hd.target);
    headColor.setHSL(hue, 1, 0.55);
    hd.color.lerp(headColor, 0.15);
    hd.light.color.copy(hd.color);
    hd.light.intensity = inten * (0.5 + 0.5 * energy) * 0.45;
    hd.beam.material.uniforms.uColor.value.copy(hd.color);
    hd.beam.material.uniforms.uOpacity.value = op * 1.3;
    hd.lens.material.color.copy(hd.color).multiplyScalar(3);
  }
}

const dummy = new THREE.Object3D();
function updateConfetti(dt, time) {
  for (let i = 0; i < CN; i++) {
    const q = conf[i];
    if (q.life <= 0) {
      dummy.scale.setScalar(0.0001);
      dummy.position.set(0, -10, 0);
    } else {
      q.life -= dt;
      if (q.p.y > 0.02) {
        q.v.y -= 1.4 * dt;
        q.v.multiplyScalar(1 - 1.2 * dt);
        q.p.addScaledVector(q.v, dt);
        q.p.x += Math.sin(time * 3 + i) * 0.4 * dt;
        q.r.x += q.w.x * dt; q.r.y += q.w.y * dt; q.r.z += q.w.z * dt;
      } else {
        q.p.y = 0.02;
        q.r.x = -Math.PI / 2;
      }
      dummy.position.copy(q.p);
      dummy.rotation.copy(q.r);
      dummy.scale.setScalar(Math.min(1, q.life));
    }
    dummy.updateMatrix();
    confetti.setMatrixAt(i, dummy.matrix);
  }
  confetti.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- game
const game = new RhythmGame($('game'), {
  clock: () => ({ beat: currentBeat(), spb: 60 / (music.playing ? music.bpm : clock.bpm) }),
  onHit(lane, kind) {
    const f = state.fl;
    const k = kind === 'perfect' ? 1 : kind === 'great' ? 0.8 : 0.6;
    if (lane === 0) f.armL = k;
    else if (lane === 3) f.armR = k;
    else if (lane === 1) f.stomp = k;
    else f.jump = k;
  },
  onMiss() {
    state.fl.stumble = 1;
    state.fl.dir = Math.random() < 0.5 ? -1 : 1;
  },
  onMilestone(n) {
    toast(`${n} KOMBO!`);
    firePyro(0.6);
    burstConfetti(n >= 100 ? 400 : 180);
  },
  onFever(on) {
    state.fever = on;
    if (on) {
      toast('FEVER!');
      firePyro(1.2);
      fireCO2(0.8);
      state.flash = 0.6;
    }
  },
});

async function startGame() {
  selectMove('auto');
  if (state.cam === 'free') setCam('auto');
  document.body.classList.add('game');
  $('btnGame').setAttribute('aria-pressed', 'true');
  if (music.playing) music.pause(true);
  resetSilentClock(0);
  state.move = { id: 'idle', since: 0, prev: null };
  await toggleMusic(true);
  game.start(track());
  notice('← ↓ ↑ → ya da D F J K · telefonda şeritlere dokun', 3500);
}
function stopGame() {
  if (!game.active) return;
  const r = `Skor ${game.score.toLocaleString('tr-TR')} · En iyi kombo ${game.maxCombo} · İsabet %${game.accuracy.toFixed(1)}`;
  game.stop();
  state.fever = false;
  document.body.classList.remove('game');
  $('btnGame').setAttribute('aria-pressed', 'false');
  if (game.judged) notice(r, 5000);
}

// ---------------------------------------------------------------- recorder
const recorder = new ClipRecorder(canvas);
async function toggleRecord() {
  if (!recorder.supported) return notice('Bu tarayıcı video kaydını desteklemiyor', 3000);
  if (recorder.recording) {
    const blob = await recorder.stop();
    document.body.classList.remove('rec');
    $('btnRec').setAttribute('aria-pressed', 'false');
    if (!blob || !blob.size) return notice('Kayıt boş çıktı, biraz daha uzun kaydetmeyi dene', 3000);
    const url = URL.createObjectURL(blob);
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const a = $('clipLink');
    a.href = url;
    a.download = `clawd-club-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    $('clipSize').textContent = `${(blob.size / 1048576).toFixed(1)} MB`;
    $('clip').classList.add('show');
    return;
  }
  if (!music.playing) await toggleMusic(true);
  recorder.start(music.recDest?.stream);
  document.body.classList.add('rec');
  $('btnRec').setAttribute('aria-pressed', 'true');
}
$('clipClose').addEventListener('click', () => $('clip').classList.remove('show'));

// ---------------------------------------------------------------- tracks
const trackSel = $('trackSel');
let customLoaded = null;
async function switchTrack(tr) {
  const wasPlaying = music.playing || game.active;
  if (game.active) stopGame();
  music.setTrack(tr);
  clock.bpm = tr.bpm;
  resetSilentClock(0);
  setBpm(tr.bpm);
  $('tempo').disabled = !tr.tempo;
  state.move = { id: 'idle', since: 0, prev: null };
  state.lastSec = null;
  $('btnMusic').setAttribute('aria-pressed', 'false');
  if (wasPlaying) await toggleMusic(true);
  toast(tr.name);
}
trackSel.addEventListener('change', () => {
  const v = trackSel.value;
  if (v === 'upload') {
    trackSel.value = customLoaded ? 'custom' : music.track.id;
    $('fileIn').click();
  } else if (v === 'custom' && customLoaded) switchTrack(customLoaded);
  else if (TRACKS[v]) switchTrack(TRACKS[v]);
});
$('fileIn').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  music.init();
  try {
    notice('Şarkı yükleniyor…', 0, true);
    const data = await file.arrayBuffer();
    const res = await analyzeSong(music.ctx, data, (step) => notice(`${step}…`, 0, true));
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40);
    customLoaded = customTrack(res, name);
    window.clawdClub.analysis = res;
    let opt = trackSel.querySelector('option[value="custom"]');
    if (!opt) {
      opt = document.createElement('option');
      opt.value = 'custom';
      trackSel.insertBefore(opt, trackSel.querySelector('option[value="upload"]'));
    }
    opt.textContent = `♫ ${name}`;
    trackSel.value = 'custom';
    notice(`${res.bpm.toFixed(1)} BPM bulundu · ${res.totalBars} ölçü · ${res.sections.filter((x) => x.name === 'drop' && x.i === 0).length} drop`, 4000);
    await switchTrack(customLoaded);
    if (!music.playing) await toggleMusic(true);
  } catch (err) {
    console.error(err);
    notice(`Şarkı çözülemedi: ${err.message || 'bilinmeyen hata'}`, 4000);
  }
});

// ---------------------------------------------------------------- quality
function applyQuality(q) {
  state.quality = q;
  const high = q === 'high';
  const pr = high ? DPR : 1;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  reflector.visible = high;
  plainFloor.visible = !high;
  key.castShadow = high;
  shadowPlane.visible = high;
  dust.visible = high;
  resize();
  $('btnQuality').querySelector('b').textContent = high ? 'Yüksek' : 'Düşük';
}
const perf = { frames: 0, time: 0, checked: false };

// ---------------------------------------------------------------- UI
const MOVE_ORDER = ['bounce', 'crab', 'robot', 'shuffle', 'headbang', 'spin', 'wave', 'disco', 'halay', 'omuz', 'moonwalk', 'star', 'idle'];
const movesEl = $('moves');
function chip(label, id, keyHint) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.dataset.move = id;
  b.innerHTML = `<span>${label}</span>${keyHint ? `<kbd>${keyHint}</kbd>` : ''}`;
  b.addEventListener('click', () => selectMove(id));
  movesEl.appendChild(b);
}
chip('Otomatik', 'auto', '0');
MOVE_ORDER.forEach((id, i) => chip(MOVES[id].name, id, i < 9 ? String(i + 1) : ''));
function selectMove(id) {
  if (game.active && id !== 'auto') return;
  state.manual = id === 'auto' ? null : id;
  refreshChips();
}
function refreshChips() {
  for (const b of movesEl.children) {
    const id = b.dataset.move;
    b.classList.toggle('active', state.manual ? id === state.manual : id === 'auto');
    b.classList.toggle('playing', !state.manual && id === state.move.id);
  }
}

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}
let noticeTimer = 0;
function notice(text, ms = 2500, busy = false) {
  const el = $('notice');
  el.textContent = text;
  el.classList.toggle('busy', busy);
  el.classList.add('show');
  clearTimeout(noticeTimer);
  if (ms) noticeTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function setCam(mode) {
  state.cam = mode;
  controls.enabled = mode === 'free';
  if (mode === 'free') controls.target.set(0, 1.4, 0);
  $('btnCam').querySelector('b').textContent = mode === 'free' ? 'Serbest' : 'Yönetmen';
  $('btnCam').setAttribute('aria-pressed', String(mode === 'free'));
  if (mode === 'free') notice('Sürükle, döndür, yakınlaş', 2000);
}

function toggleHud(force) {
  const hidden = force ?? !document.body.classList.contains('hud-hidden');
  document.body.classList.toggle('hud-hidden', hidden);
}

async function start(mode) {
  $('intro').classList.add('gone');
  perf.frames = 0; perf.time = 0;
  if (mode === 'game') return startGame();
  resetSilentClock(0);
  state.move = { id: 'idle', since: 0, prev: null };
  if (mode === 'music') await toggleMusic(true);
}

$('startMusic').addEventListener('click', () => start('music'));
$('startGame').addEventListener('click', () => start('game'));
$('startSilent').addEventListener('click', () => start('silent'));
$('btnMusic').addEventListener('click', () => toggleMusic());
$('btnGame').addEventListener('click', () => (game.active ? stopGame() : startGame()));
$('btnRec').addEventListener('click', () => toggleRecord());
$('btnCam').addEventListener('click', () => setCam(state.cam === 'free' ? 'auto' : 'free'));
$('btnQuality').addEventListener('click', () => applyQuality(state.quality === 'high' ? 'low' : 'high'));
$('btnHide').addEventListener('click', () => toggleHud(true));
$('btnFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});
$('tempo').addEventListener('input', (e) => setBpm(Number(e.target.value)));
canvas.addEventListener('dblclick', () => toggleHud(false));

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type !== 'range')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (game.active && game.key(e)) { e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    if (!$('intro').classList.contains('gone')) start('music');
    else toggleMusic();
    return;
  }
  if (k === 'escape' && game.active) return stopGame();
  if (k === '0') return selectMove('auto');
  if (/^[1-9]$/.test(k)) return selectMove(MOVE_ORDER[Number(k) - 1]);
  if (k === 'c') return setCam(state.cam === 'free' ? 'auto' : 'free');
  if (k === 'g') { if (!$('intro').classList.contains('gone')) return start('game'); return game.active ? stopGame() : startGame(); }
  if (k === 'r') return toggleRecord();
  if (k === 'q') return $('btnQuality').click();
  if (k === 'h') return toggleHud();
  if (k === 'f') return $('btnFull').click();
  if (k === '[' || k === ']') {
    game.offsetMs += k === ']' ? 10 : -10;
    return notice(`Gecikme ayarı: ${game.offsetMs > 0 ? '+' : ''}${game.offsetMs} ms`, 1500);
  }
  if ((k === 'arrowup' || k === 'arrowdown') && track().tempo) {
    e.preventDefault();
    const el = $('tempo');
    el.value = String(clamp(Number(el.value) + (k === 'arrowup' ? 2 : -2), Number(el.min), Number(el.max)));
    setBpm(Number(el.value));
  }
});

function resize() {
  const w = innerWidth, h = innerHeight;
  const pr = renderer.getPixelRatio();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  reflector.getRenderTarget().setSize(Math.floor(w * pr * 0.5), Math.floor(h * pr * 0.5));
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- main loop
let last = performance.now();
const ctxObj = { prog: 0 };
const SPARKLE_SEC = { intro: 0.15, groove: 0.45, build: 0.3, drop: 0.9, break: 0.25 };
const SMOKE_SEC = { intro: 0.2, groove: 0.1, build: 0.16, drop: 0.07, break: 0.24 };
const smokeColor = new THREE.Color();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  const rawDt = (now - last) / 1000;
  const realDt = Math.min(0.25, rawDt); // zamana bağlı söndürmeler düşük FPS'te de doğru kalsın
  last = now;
  const time = now / 1000;
  const tr = track();
  const bpm = music.playing ? music.bpm : clock.bpm;

  const beat = Math.max(0, currentBeat());
  const bar = Math.floor(beat / 4);
  const sec = tr.sectionAt(bar);
  const inBar = beat - bar * 4;
  const prog = (sec.i + inBar / 4) / sec.len;
  const kick = tr.kickAt(bar, Math.floor(inBar) * 4);
  const pulse = kick ? Math.exp(-fr(beat) * 7) : 0;
  // Fever'da sahne her bölümde drop gibi davranır
  const vis = state.fever && sec.name !== 'drop' ? { ...sec, name: 'drop', i: 4 } : sec;

  state.energy = lerp(state.energy, state.fever ? 1 : SECTION_ENERGY[sec.name], Math.min(1, dt * 2));
  state.hue = state.fever ? fr(beat / 4) : vis.name === 'drop' ? fr(beat / 16) : sec.name === 'groove' ? (tr.id === 'halay' ? 0.98 : 0.88) : sec.name === 'break' ? 0.66 : 0.06;

  // Bölüm geçişleri
  if (sec.name !== state.lastSec) {
    if (sec.name === 'drop') { burstConfetti(); state.flash = 0.9; firePyro(0.9); fireCO2(0.7); }
    if (sec.name === 'groove' && state.lastSec) state.flash = 0.35;
    state.lastSec = sec.name;
  }
  if (bar !== state.lastBar) {
    if (sec.name === 'drop' && sec.i > 0 && sec.i % 8 === 0) { burstConfetti(250); firePyro(0.6); }
    if (sec.name === 'drop' && sec.i % 4 === 2) firePyro(0.35, [hash(bar) % 2 ? 0 : 2, hash(bar) % 2 ? 3 : 1]);
    state.lastBar = bar;
  }
  if (sec.name === 'build' && sec.i === sec.len - 1 && inBar >= 3 && co2.jets.length === 0 && !state.co2Fired) {
    fireCO2(0.6);
    state.co2Fired = true;
  }
  if (sec.name !== 'build') state.co2Fired = false;
  let strobe = 0;
  if (sec.name === 'build' && sec.i === sec.len - 1 && inBar < 3) strobe = fr(beat * 4) < 0.35 ? 0.22 : 0;
  state.flash = Math.max(0, state.flash - realDt * 1.6);

  // Koreografi
  ctxObj.prog = sec.name === 'build' ? prog : 0.5;
  const want = state.manual ?? tr.choreo(bar, sec);
  const mv = state.move;
  if (want !== mv.id) {
    mv.prev = mv.id;
    mv.id = want;
    mv.since = beat;
    if (!game.active) toast(MOVES[want].name);
    refreshChips();
  }
  let pose = evalMove(mv.id, beat, ctxObj);
  if (mv.prev) {
    const k = smooth((beat - mv.since) / 0.6);
    if (k >= 1) mv.prev = null;
    else pose = blendPose(evalMove(mv.prev, beat, ctxObj), pose, k);
  }
  const crewPose = pose;
  pose = { ...pose };
  // Oyundaki vuruşların Clawd'a yansıması
  const f = state.fl;
  pose.aLr += f.armL * 1.7; pose.aLe += f.armL * 0.6;
  pose.aRr += f.armR * 1.7; pose.aRe += f.armR * 0.6;
  pose.crouch += f.stomp * 0.3; pose.sqY -= f.stomp * 0.1; pose.sqX += f.stomp * 0.06;
  pose.lift += f.jump * 0.55; pose.sqY += f.jump * 0.08;
  pose.tiltZ += f.stumble * 0.35 * f.dir; pose.eyeS *= 1 - 0.75 * f.stumble; pose.lookY -= f.stumble * 0.5;
  const decay = Math.exp(-dt * 8);
  f.armL *= decay; f.armR *= decay; f.stomp *= decay; f.jump *= decay; f.stumble *= Math.exp(-dt * 3);
  star.apply(pose, dt);

  const lineUp = mv.id === 'halay' || mv.id === 'omuz';
  const showBackups = bar >= 8 || state.manual || game.active || tr.id === 'custom';
  for (const b of backups) {
    b.vis = lerp(b.vis, showBackups ? 1 : 0, Math.min(1, dt * 4));
    const pop = b.vis < 0.999 ? Math.max(0, 1 + 2.7 * Math.pow(b.vis - 1, 3) + 1.7 * Math.pow(b.vis - 1, 2)) : 1;
    b.setVisibility(pop);
    b.home.x = lerp(b.home.x, b.side * (lineUp ? 3.0 : 3.6), Math.min(1, dt * 3));
    b.home.z = lerp(b.home.z, lineUp ? 0.2 : -1.8, Math.min(1, dt * 3));
    b.apply(lineUp || b.side > 0 ? crewPose : mirrorPose(crewPose), dt);
  }

  // Sahne
  updateFloor(beat, vis, prog, pulse, star.root.position.x);
  updateHeads(beat, vis, prog, pulse, state.energy);
  crowd.update(beat, state.fever ? 'fever' : sec.name, prog, dt);
  updateConfetti(dt, time);
  lasers.update(beat, vis.name === 'drop' || (sec.name === 'build' && sec.i === sec.len - 1), state.hue, pulse, dt);
  const pScale = (renderer.domElement.height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  pyro.uniforms.uScale.value = pScale;
  co2.uniforms.uScale.value = pScale;
  pyro.update(Math.min(0.1, rawDt));
  co2.update(Math.min(0.1, rawDt));
  const fireLevel = pyro.activity;
  pyroLights.forEach((l) => { l.intensity = lerp(l.intensity, fireLevel * (45 + 25 * Math.random()), Math.min(1, dt * 12)); });
  smokeColor.setHSL(state.hue, 0.6, 0.6).lerp(new THREE.Color(0xffffff), 0.45);
  smoke.update(dt, SMOKE_SEC[vis.name] * (state.quality === 'high' ? 1 : 0.6), smokeColor, camera.position);

  ball.rotation.y += dt * 0.6;
  sparkles.rotation.y = ball.rotation.y;
  sparkleMat.opacity = SPARKLE_SEC[vis.name] * (0.6 + 0.4 * pulse);
  dust.rotation.y += dt * 0.01;

  const rimHue = vis.name === 'drop' ? fr(state.hue + 0.5) : state.hue;
  rims.forEach((l, i) => {
    l.color.setHSL(fr(rimHue + i * 0.15), 1, 0.55);
    l.intensity = 14 + 26 * state.energy + 20 * pulse;
  });
  key.intensity = 95 + 45 * pulse * state.energy;

  for (const sp of speakers) {
    for (const c of sp.cones) c.cap.position.z = 0.66 + pulse * 0.08 * (0.4 + state.energy);
    sp.strip.material.color.setHSL(state.hue, 1, 0.5).multiplyScalar(1 + 2 * pulse);
  }

  const spectrum = music.readSpectrum();
  const screenName = game.active ? `KOMBO ${game.combo}` : MOVES[mv.id].name;
  led.draw({ beat, pulse, spectrum, live: music.playing, sec: vis, moveName: screenName, hue: state.hue });

  updateCamera(beat, bar, vis, pulse, dt);

  bloom.strength = 0.65 + 0.35 * state.energy + 0.35 * pulse * state.energy;
  fx.uniforms.uTime.value = time;
  fx.uniforms.uFlash.value = Math.max(state.flash, strobe);
  fx.uniforms.uAberr.value = 0.002 + 0.006 * pulse * state.energy;

  // Oyun
  game.update(beat, bpm, dt);
  game.draw(beat, pulse, Math.min(2, window.devicePixelRatio || 1));

  // HUD
  $('secLabel').textContent = state.fever ? 'FEVER' : sec.label;
  $('secLabel').dataset.sec = state.fever ? 'drop' : sec.name;
  $('barLabel').textContent = `BAR ${bar + 1}`;
  if (recorder.recording) {
    const t = recorder.elapsed;
    $('recTime').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    if (t > 60) toggleRecord();
  }

  // Kasıyorsa kaliteyi bir kez otomatik düşür
  perf.fps = lerp(perf.fps || 60, 1 / Math.max(1e-3, rawDt), 0.05);
  if ($('intro').classList.contains('gone') && !perf.checked) {
    perf.frames++;
    perf.time += rawDt;
    if (perf.time > 5) {
      perf.checked = true;
      if (perf.frames / perf.time < 32 && state.quality === 'high') {
        applyQuality('low');
        notice('Kasma algılandı, kalite düşürüldü (Q ile geri al)', 3500);
      }
    }
  }

  composer.render(dt);
  requestAnimationFrame(frame);
}

refreshChips();
setBpm(clock.bpm);
resetSilentClock(0);
requestAnimationFrame(frame);

// Ekran görüntüsü ve hata ayıklama için
window.clawdClub = {
  seek(beat) { if (music.playing) toggleMusic(false); resetSilentClock(beat); },
  move: selectMove,
  track: (id) => switchTrack(TRACKS[id]),
  fever: (on) => game.hooks.onFever(on),
  pyro: () => firePyro(1),
  game,
  music,
  noAutoQuality() { perf.checked = true; },
  fps: () => perf.fps,
};
