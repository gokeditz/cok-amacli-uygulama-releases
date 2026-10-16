// Sahnenin arkasındaki LED ekran: ekolayzer, yazılar ve minik piksel Clawd'lar.
import * as THREE from 'three';
import { fr } from './moves.js';

const W = 192;
const H = 72;

export class LedScreen {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.bars = new Float32Array(32);
  }

  pixelClawd(x, y, u, arms) {
    const g = this.ctx;
    g.fillStyle = '#e07a57';
    g.fillRect(x, y, 8 * u, 4 * u);
    const ay = arms ? y - u : y + u;
    g.fillRect(x - u, ay, u, u * 2);
    g.fillRect(x + 8 * u, ay, u, u * 2);
    for (const c of [1, 2, 5, 6]) g.fillRect(x + c * u, y + 4 * u, u, u * 2);
    g.fillStyle = '#140d0a';
    g.fillRect(x + 2 * u, y + u, u, u * 2);
    g.fillRect(x + 5 * u, y + u, u, u * 2);
  }

  draw({ beat, pulse, spectrum, live, sec, moveName, hue }) {
    const g = this.ctx;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);

    // Ekolayzer: canlı müzikte analizörden, sessizde vuruştan türetilmiş
    const n = this.bars.length;
    for (let i = 0; i < n; i++) {
      let v;
      if (live) {
        const bin = Math.floor(Math.pow(i / n, 1.6) * 90) + 1;
        v = spectrum[bin] / 255;
      } else {
        v = (0.25 + 0.6 * pulse) * (0.55 + 0.45 * Math.sin(i * 0.7 + beat * 3.1)) * (1 - i / n * 0.6);
      }
      this.bars[i] = Math.max(v, this.bars[i] - 0.04);
      const h = Math.floor(this.bars[i] * 13) * 3;
      g.fillStyle = `hsl(${(hue * 360 + i * 7) % 360},100%,58%)`;
      for (let y = 0; y < h; y += 3) g.fillRect(i * 6 + 1, H - 2 - y, 4, 2);
    }

    // Yazı
    let title = 'CLAWD';
    if (sec.name === 'drop' && sec.i < 2) title = fr(beat * 2) < 0.5 ? 'DROP!' : '';
    else if (sec.name === 'build') title = sec.i === sec.len - 1 ? String(4 - Math.floor(fr(beat / 4) * 4)) : 'GET READY';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.font = `bold ${title.length > 6 ? 16 : 24}px monospace`;
    g.fillText(title, W / 2, 20);
    g.font = 'bold 9px monospace';
    g.fillStyle = `hsl(${(hue * 360 + 180) % 360},100%,70%)`;
    g.fillText(moveName.toLocaleUpperCase('tr'), W / 2, 37);

    // Köşelerde zıplayan piksel Clawd'lar
    const jump = Math.floor(Math.sin(Math.PI * fr(beat)) * 4);
    const arms = Math.floor(beat) % 2 === 0;
    this.pixelClawd(10, 12 - jump, 2, arms);
    this.pixelClawd(W - 26, 12 - jump, 2, !arms);

    this.texture.needsUpdate = true;
  }
}
