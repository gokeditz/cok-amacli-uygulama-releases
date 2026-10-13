// Voxel Clawd: gövde, iki göz, iki kol ve dört bacaktan oluşan basit bir iskelet.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const DIM = { W: 2.4, H: 1.5, D: 1.15, LEG: 0.62 };
const LEG_X = [-0.84, -0.44, 0.44, 0.84];

export class Clawd {
  constructor({ color = 0xd97757, scale = 1 } = {}) {
    const { W, H, D, LEG } = DIM;
    this.baseScale = scale;
    this.home = new THREE.Vector3();
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);

    const mat = new THREE.MeshPhysicalMaterial({
      color, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.3,
    });
    const legMat = mat.clone();
    legMat.color = new THREE.Color(color).multiplyScalar(0.8);
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0x0d0907, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.35,
    });

    this.hips = new THREE.Group();
    this.root.add(this.hips);
    this.torso = new THREE.Group();
    this.hips.add(this.torso);

    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.09), mat);
    body.position.y = H / 2;
    this.torso.add(body);

    this.eyes = new THREE.Group();
    this.eyeY = H / 2 + 0.12;
    this.eyes.position.set(0, this.eyeY, D / 2 - 0.02);
    this.torso.add(this.eyes);
    const eyeGeo = new RoundedBoxGeometry(0.2, 0.44, 0.08, 2, 0.03);
    this.eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeL.position.x = -0.42;
    this.eyeR.position.x = 0.42;
    this.eyes.add(this.eyeL, this.eyeR);

    const armGeo = new RoundedBoxGeometry(0.56, 0.42, 0.62, 3, 0.08);
    const makeArm = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * (W / 2 - 0.06), H * 0.48, 0);
      const m = new THREE.Mesh(armGeo, mat);
      m.position.x = side * 0.27;
      pivot.add(m);
      this.torso.add(pivot);
      return pivot;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);

    const legGeo = new RoundedBoxGeometry(0.22, LEG + 0.08, 0.34, 2, 0.05);
    this.legs = LEG_X.map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.04, 0);
      const m = new THREE.Mesh(legGeo, legMat);
      m.position.y = -(LEG + 0.08) / 2 + 0.04;
      pivot.add(m);
      this.hips.add(pivot);
      return pivot;
    });

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

    this.blinkIn = 1 + Math.random() * 3;
    this.blinkT = -1;
  }

  setVisibility(v) {
    const s = this.baseScale * Math.max(0.0001, v);
    this.root.scale.setScalar(s);
    this.root.visible = v > 0.01;
  }

  apply(p, dt) {
    const { LEG } = DIM;
    this.root.position.set(this.home.x + p.x, this.home.y, this.home.z + p.z);
    this.root.rotation.y = p.ry;

    const c = Math.min(0.6, Math.max(0, p.crouch));
    this.hips.position.y = LEG * (1 - c) + Math.max(0, p.lift);
    this.hips.rotation.set(p.tiltX, p.twist, p.tiltZ);
    this.torso.scale.set(p.sqX, p.sqY, p.sqX);

    for (let i = 0; i < 4; i++) {
      const l = this.legs[i];
      l.scale.y = 1 - c;
      l.rotation.set(p[`l${i}x`], 0, p[`l${i}z`]);
    }

    this.armL.rotation.set(0, p.aLs, -p.aLr);
    this.armL.scale.x = p.aLe;
    this.armR.rotation.set(0, -p.aRs, p.aRr);
    this.armR.scale.x = p.aRe;

    // Göz kırpma kendi kafasına göre
    this.blinkIn -= dt;
    if (this.blinkIn < 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.blinkIn = 1.5 + Math.random() * 3.5;
    }
    let blink = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const k = this.blinkT / 0.14;
      blink = k < 1 ? Math.abs(1 - 2 * k) * 0.9 + 0.1 : 1;
      if (k >= 1) this.blinkT = -1;
    }
    this.eyes.position.x = p.lookX * 0.13;
    this.eyes.position.y = this.eyeY + p.lookY * 0.09;
    const sy = Math.max(0.08, p.eyeS * blink);
    this.eyeL.scale.y = sy;
    this.eyeR.scale.y = sy;
  }
}
