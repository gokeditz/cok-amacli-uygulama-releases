// Seyirci: pistin önünde zıplayan mini Clawd'lar. Break'te telefon ışıklarını yakıyorlar.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const rand = (a, b) => a + Math.random() * (b - a);
const fr = (x) => x - Math.floor(x);

export class Crowd {
  constructor(scene) {
    this.members = [];
    for (let row = 0; row < 3; row++) {
      const count = 11 + row;
      for (let k = 0; k < count; k++) {
        this.members.push({
          x: -7.5 + (k * 15) / (count - 1) + rand(-0.3, 0.3),
          z: 6.2 + row * 1.3 + rand(-0.2, 0.2),
          ph: rand(-0.1, 0.1), s: rand(0.42, 0.55), ry: Math.PI + rand(-0.35, 0.35),
          arms: Math.random() < 0.6, phone: Math.random() < 0.45, lag: rand(0, 0.3),
        });
      }
    }
    const n = this.members.length;
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, envMapIntensity: 0.15 });
    this.bodies = new THREE.InstancedMesh(new RoundedBoxGeometry(2.4, 1.5, 1.15, 2, 0.12), bodyMat, n);
    this.arms = new THREE.InstancedMesh(new RoundedBoxGeometry(0.56, 0.42, 0.62, 1, 0.08), bodyMat, n * 2);
    this.legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.62, 0.34), bodyMat, n * 4);
    this.eyes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.44, 0.06), new THREE.MeshBasicMaterial({ color: 0x0b0806 }), n * 2);
    const c = new THREE.Color();
    this.members.forEach((m, i) => {
      c.setHSL(0.04 + rand(-0.015, 0.02), rand(0.45, 0.65), rand(0.22, 0.34));
      this.bodies.setColorAt(i, c);
      this.arms.setColorAt(i * 2, c);
      this.arms.setColorAt(i * 2 + 1, c);
      for (let l = 0; l < 4; l++) this.legs.setColorAt(i * 4 + l, c.clone().multiplyScalar(0.8));
    });
    scene.add(this.bodies, this.arms, this.legs, this.eyes);

    const pg = new THREE.BufferGeometry();
    this.phonePos = new Float32Array(n * 3);
    pg.setAttribute('position', new THREE.BufferAttribute(this.phonePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.phoneMat = new THREE.PointsMaterial({
      color: 0xdfeaff, size: 0.16, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.phones = new THREE.Points(pg, this.phoneMat);
    this.phones.frustumCulled = false;
    scene.add(this.phones);
    this.dummy = new THREE.Object3D();
    this.local = new THREE.Object3D();
    this.phoneLevel = 0;
    this.tip = new THREE.Vector3();
  }

  set(mesh, idx, parent, x, y, z, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const d = this.local;
    d.position.set(x, y, z);
    d.rotation.set(rx, 0, rz);
    d.scale.set(sx, sy, sz);
    d.updateMatrix();
    d.matrix.premultiply(parent.matrix);
    mesh.setMatrixAt(idx, d.matrix);
  }

  update(beat, mode, prog, dt) {
    const amp = { intro: 0.05, groove: 0.35, build: 0.15 + prog * 0.6, drop: 0.8, break: 0.05, fever: 1 }[mode] ?? 0.3;
    const armsUp = mode === 'drop' || mode === 'fever' || (mode === 'build' && prog > 0.5);
    const phones = mode === 'break' || mode === 'intro';
    this.phoneLevel += ((phones ? 1 : 0) - this.phoneLevel) * Math.min(1, dt * 1.5);
    this.phoneMat.opacity = this.phoneLevel;
    const D = this.dummy;
    this.members.forEach((m, i) => {
      const ph = fr(beat + m.ph);
      const jump = amp * Math.sin(Math.PI * ph);
      D.position.set(m.x, jump * m.s, m.z);
      D.rotation.set(0, m.ry + 0.1 * Math.sin(beat * 0.5 + i), 0);
      D.scale.setScalar(m.s);
      D.updateMatrix();
      const by = 0.62 + 0.75;
      const sq = 1 - 0.08 * Math.exp(-ph * 8) * (amp > 0.2 ? 1 : 0);
      this.set(this.bodies, i, D, 0, by, 0, 0, 0, 1, sq, 1);
      for (let e = 0; e < 2; e++) this.set(this.eyes, i * 2 + e, D, e ? 0.42 : -0.42, by + 0.12, 0.56);
      for (let l = 0; l < 4; l++) this.set(this.legs, i * 4 + l, D, [-0.84, -0.44, 0.44, 0.84][l], 0.31, 0);
      const holdPhone = phones && m.phone;
      for (let a = 0; a < 2; a++) {
        const side = a ? 1 : -1;
        let raise = 0.15;
        if (armsUp && m.arms) raise = 1.9 + 0.25 * Math.sin(beat * Math.PI + i + a);
        if (holdPhone && a === 1) raise = 1.6 + 0.15 * Math.sin(beat * 0.8 + i);
        const cx = Math.cos(raise), cy = Math.sin(raise);
        const px = side * 1.18, py = by + 0.05;
        this.set(this.arms, i * 2 + a, D, px + side * cx * 0.28, py + cy * 0.28, 0, 0, side * raise);
        if (holdPhone && a === 1) {
          // telefon: kaldırılan kolun ucunda
          this.tip.set(px + side * cx * 0.62, py + cy * 0.62 + 0.1, 0).applyMatrix4(D.matrix);
          this.phonePos.set([this.tip.x, this.tip.y, this.tip.z], i * 3);
        }
      }
      if (!holdPhone) this.phonePos.set([0, -50, 0], i * 3);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.arms.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
    this.eyes.instanceMatrix.needsUpdate = true;
    this.phones.geometry.attributes.position.needsUpdate = true;
  }
}
