// Sahne şovu: lazerler, pyro alevleri, CO2 patlamaları ve yerde süzülen sis.
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ lazerler
export class Lasers {
  constructor(scene, { y = 7.6, z = -1.6, perSide = 7 } = {}) {
    const geo = new THREE.CylinderGeometry(0.014, 0.014, 40, 6, 1, true);
    geo.translate(0, 20, 0);
    geo.rotateX(Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x39ff6a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.beams = [];
    this.level = 0;
    this.color = new THREE.Color();
    for (const side of [-1, 1]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.4), new THREE.MeshStandardMaterial({ color: 0x1a1a1f, metalness: 0.8, roughness: 0.4 }));
      box.position.set(side * 4.5, y + 0.05, z);
      scene.add(box);
      for (let i = 0; i < perSide; i++) {
        const m = new THREE.Mesh(geo, this.mat);
        m.position.set(side * 4.5, y - 0.1, z);
        m.rotation.order = 'YXZ';
        m.frustumCulled = false;
        m.userData = { side, u: perSide > 1 ? i / (perSide - 1) - 0.5 : 0, i };
        scene.add(m);
        this.beams.push(m);
      }
    }
  }

  update(beat, active, hue, pulse, dt) {
    this.level += ((active ? 1 : 0) - this.level) * Math.min(1, dt * 6);
    const vis = this.level > 0.01;
    for (const b of this.beams) b.visible = vis;
    if (!vis) return;
    const pattern = Math.floor(beat / 8) % 3;
    const PI = Math.PI;
    for (const b of this.beams) {
      const { side, u, i } = b.userData;
      let yaw = 0, pitch = 0.3;
      if (pattern === 0) {
        yaw = u * 1.2 + 0.45 * Math.sin((beat * PI) / 4) * side;
        pitch = 0.24 + 0.1 * Math.sin((beat * PI) / 2 + i * 0.3);
      } else if (pattern === 1) {
        yaw = side * 0.6 * Math.sin((beat * PI) / 2) + u * 0.35;
        pitch = 0.32;
      } else {
        yaw = u * 1.5 - side * 0.2;
        pitch = 0.1 + i * 0.035 + 0.1 * Math.sin(beat * PI);
      }
      b.rotation.set(pitch, yaw, 0);
    }
    const h = Math.floor(beat / 8) % 3;
    this.color.setHSL([0.36, 0.0, 0.6][h] + hue * 0.0, 1, 0.5).multiplyScalar(3.2 * this.level * (0.7 + 0.5 * pulse));
    this.mat.color.copy(this.color);
  }
}

// ------------------------------------------------------------------ parçacıklar
const PVERT = /* glsl */ `
  attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vColor.a *= smoothstep(1.5, 5.0, -mv.z); // kameranın dibindeki parçacıklar ekranı kaplamasın
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const PFRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, r);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a * a);
  }`;

export class Particles {
  constructor(scene, { count = 1500, ramp, sizeGrow = 1 }) {
    this.n = count;
    this.ramp = ramp;
    this.sizeGrow = sizeGrow;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.col = new Float32Array(count * 4);
    this.size = new Float32Array(count);
    this.size0 = new Float32Array(count);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count).fill(1);
    this.grav = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.cursor = 0;
    this.jets = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 600 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: PVERT, fragmentShader: PFRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(o, k, p) {
    for (let j = 0; j < k; j++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      const a = rand(0, Math.PI * 2);
      const r = rand(0, p.spread);
      const sp = rand(p.speed[0], p.speed[1]);
      this.pos.set([o.x + rand(-0.08, 0.08), o.y, o.z + rand(-0.08, 0.08)], i * 3);
      this.vel.set([Math.cos(a) * r * sp, sp, Math.sin(a) * r * sp], i * 3);
      this.life[i] = this.max[i] = rand(p.life[0], p.life[1]);
      this.size0[i] = rand(p.size[0], p.size[1]);
      this.grav[i] = p.gravity;
      this.drag[i] = p.drag;
    }
  }

  jet(origin, duration, rate, params) {
    this.jets.push({ origin, until: duration, rate, params, acc: 0 });
  }

  get activity() {
    return this.jets.length ? 1 : 0;
  }

  update(dt) {
    for (const j of this.jets) {
      j.until -= dt;
      j.acc += j.rate * dt;
      const k = Math.floor(j.acc);
      j.acc -= k;
      this.emit(j.origin, k, j.params);
    }
    this.jets = this.jets.filter((j) => j.until > 0);
    const R = this.ramp;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const i3 = i * 3;
      this.vel[i3 + 1] += this.grav[i] * dt;
      const d = 1 - this.drag[i] * dt;
      this.vel[i3] *= d; this.vel[i3 + 1] *= d; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      let k = 0;
      while (k < R.length - 2 && t > R[k + 1][0]) k++;
      const [ta, ...ca] = R[k];
      const [tb, ...cb] = R[k + 1];
      const f = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
      for (let c = 0; c < 4; c++) this.col[i * 4 + c] = ca[c] + (cb[c] - ca[c]) * f;
      this.size[i] = this.size0[i] * (1 + this.sizeGrow * t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}

export const FIRE_RAMP = [
  [0, 2.2, 2.0, 1.4, 0.8],
  [0.18, 2.2, 1.1, 0.25, 0.75],
  [0.5, 1.5, 0.3, 0.05, 0.45],
  [1, 0.25, 0.04, 0.02, 0],
];
export const CO2_RAMP = [
  [0, 1.0, 1.0, 1.1, 0.13],
  [0.35, 0.8, 0.8, 0.9, 0.07],
  [1, 0.5, 0.5, 0.6, 0],
];
export const FIRE = { speed: [8, 11], spread: 0.06, life: [0.6, 1.0], size: [0.28, 0.5], gravity: -4, drag: 0.6 };
export const CO2 = { speed: [9, 12], spread: 0.1, life: [1.0, 1.5], size: [0.5, 0.9], gravity: -3, drag: 1.4 };

// ------------------------------------------------------------------ yer sisi
function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FloorSmoke {
  constructor(scene, count = 28) {
    const tex = smokeTexture();
    this.items = [];
    this.opacity = 0.15;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.15 });
      const s = new THREE.Sprite(mat);
      const sc = rand(4, 7);
      s.scale.set(sc * 1.6, sc * 0.6, 1);
      s.position.set(rand(-10, 10), rand(0.3, 1.0), rand(-7, 5));
      s.userData = { v: rand(0.15, 0.4) * (Math.random() < 0.5 ? -1 : 1), base: rand(0.6, 1) };
      scene.add(s);
      this.items.push(s);
    }
  }

  update(dt, target, color, camPos) {
    this.opacity += (target - this.opacity) * Math.min(1, dt * 1.5);
    for (const s of this.items) {
      // kameraya çok yaklaşan sis bulutu ekranı kaplamasın
      const near = camPos ? Math.min(1, Math.max(0, (s.position.distanceTo(camPos) - 2) / 4)) : 1;
      s.position.x += s.userData.v * dt;
      if (s.position.x > 11) s.position.x = -11;
      if (s.position.x < -11) s.position.x = 11;
      s.material.opacity = this.opacity * s.userData.base * near;
      s.material.color.copy(color);
    }
  }
}
