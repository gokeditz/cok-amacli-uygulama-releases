// Ritim oyunu: notalar şarkının yapısından üretilir, ok tuşları / D F J K ya da
// dokunarak vurulur. Zamanlama, ses motorunun gecikme telafili vuruş saatinden okunur.
import { hash } from './moves.js';

export const LANE_COLORS = ['#ff5fa2', '#5fd4ff', '#7bffb0', '#ffb35f'];
const KEYS = { arrowleft: 0, arrowdown: 1, arrowup: 2, arrowright: 3, d: 0, f: 1, j: 2, k: 3 };
const ROT = [-Math.PI / 2, Math.PI, 0, Math.PI / 2];
const WIN = { perfect: 0.045, great: 0.09, good: 0.135 };
const JUDGE = {
  perfect: { label: 'PERFECT', score: 300, acc: 1, color: '#7bffb0' },
  great: { label: 'GREAT', score: 200, acc: 0.7, color: '#5fd4ff' },
  good: { label: 'GOOD', score: 100, acc: 0.4, color: '#ffd25f' },
  miss: { label: 'MISS', score: 0, acc: 0, color: '#ff5f6d' },
};
const LEAD = 1.5; // notanın ekranda göründüğü süre (sn)
const FONT = '"Silkscreen", ui-monospace, monospace';

function loadBest(id) {
  try { return JSON.parse(localStorage.getItem(`clawd-best-${id}`)) || { score: 0, combo: 0 }; } catch { return { score: 0, combo: 0 }; }
}
function saveBest(id, b) {
  try { localStorage.setItem(`clawd-best-${id}`, JSON.stringify(b)); } catch { /* gizli sekme vs. */ }
}

export class RhythmGame {
  constructor(canvas, hooks) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.hooks = hooks;
    this.active = false;
    this.offsetMs = 0;
    this.pressed = [0, 0, 0, 0];
    this.reset();
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      e.preventDefault();
      const lane = this.laneAt(e.clientX);
      if (lane >= 0) this.press(lane);
    });
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.judged = 0;
    this.accSum = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.fever = false;
    this.notes = [];
    this.genBar = null;
    this.pops = [];
    this.sparks = [];
    this.judgment = null;
    this.newBest = false;
  }

  start(track) {
    this.track = track;
    this.reset();
    this.best = loadBest(track.id);
    this.active = true;
    this.c.classList.add('on');
  }

  stop() {
    this.active = false;
    this.c.classList.remove('on');
    this.g.clearRect(0, 0, this.c.width, this.c.height);
    if (this.fever) this.hooks.onFever(false);
    this.fever = false;
  }

  get accuracy() { return this.judged ? (this.accSum / this.judged) * 100 : 100; }
  get mult() { return Math.min(2, 1 + Math.floor(this.combo / 10) * 0.1) * (this.fever ? 2 : 1); }

  // ---- nota haritası
  chartBar(bar) {
    const tr = this.track;
    const sec = tr.sectionAt(bar);
    let steps = [];
    switch (sec.name) {
      case 'intro': steps = sec.i >= 4 || sec.len < 6 ? [0, 8] : []; break;
      case 'groove': steps = [0, 4, 8, 12]; if (sec.i % 2 === 1) steps.push(14); break;
      case 'build':
        steps = sec.i === 0 ? [0, 4, 8, 12] : sec.i === sec.len - 1 ? [0, 2, 4, 6, 8, 9, 10, 11] : [0, 2, 4, 6, 8, 10, 12, 14];
        break;
      case 'drop': {
        steps = [0, 4, 8, 12];
        const extra = [2, 6, 10, 14, 3, 11, 7];
        const k = 2 + (hash(bar * 13) % 3);
        for (let i = 0; i < k; i++) steps.push(extra[(hash(bar * 7 + i) + i) % extra.length]);
        break;
      }
      case 'break': steps = [0, 8]; break;
    }
    steps = [...new Set(steps)].sort((a, b) => a - b);
    if (tr.noteGate) {
      // Yüklenen şarkıda yalnızca gerçekten vuruş olan yerlere nota koy
      steps = steps.filter((s) => tr.noteGate(bar, s) > (s % 4 === 0 ? 0.12 : 0.4));
    }
    const out = [];
    let prev = this.lastLane ?? 0;
    let prevS = -9;
    for (const s of steps) {
      let lane = hash(bar * 31 + s * 7 + 5) % 4;
      if (lane === prev && s - prevS <= 2) lane = (lane + 1 + (hash(s) % 3)) % 4;
      out.push({ beat: bar * 4 + s / 4, lane, done: false });
      if (sec.name === 'drop' && s === 0 && bar % 2 === 0) out.push({ beat: bar * 4, lane: (lane + 2) % 4, done: false });
      prev = lane;
      prevS = s;
    }
    this.lastLane = prev;
    return out;
  }

  ensureChart(beat) {
    const bar = Math.floor(beat / 4);
    if (this.genBar === null) this.genBar = bar - 1;
    while (this.genBar < bar + 3) {
      this.genBar++;
      for (const n of this.chartBar(this.genBar)) if (n.beat > beat + 0.75) this.notes.push(n);
    }
  }

  // ---- giriş
  key(e) {
    const lane = KEYS[e.key.toLowerCase()];
    if (lane === undefined) return false;
    if (!e.repeat) this.press(lane);
    return true;
  }

  // Tuşa basıldığı anın vuruşu: kare saatinden değil, ses saatinden taze okunur
  freshNow() {
    const t = this.hooks.clock?.();
    if (!t) return this.now;
    return { beat: t.beat + this.offsetMs / 1000 / t.spb, spb: t.spb };
  }

  press(lane) {
    this.pressed[lane] = 1;
    const now = this.active ? this.freshNow() : undefined;
    if (now === undefined) return;
    let best = null, bestD = Infinity;
    for (const n of this.notes) {
      if (n.done || n.lane !== lane) continue;
      const d = (n.beat - now.beat) * now.spb;
      if (Math.abs(d) < Math.abs(bestD)) { best = n; bestD = d; }
      if (d > WIN.good) break;
    }
    if (!best || Math.abs(bestD) > WIN.good) return;
    const ad = Math.abs(bestD);
    const kind = ad <= WIN.perfect ? 'perfect' : ad <= WIN.great ? 'great' : 'good';
    best.done = true;
    this.register(kind, lane, bestD);
  }

  register(kind, lane, delta = 0) {
    const J = JUDGE[kind];
    this.judged++;
    this.accSum += J.acc;
    this.counts[kind]++;
    if (kind === 'miss') {
      if (this.fever) this.hooks.onFever(false);
      this.fever = false;
      this.combo = 0;
      this.hooks.onMiss(lane);
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += Math.round(J.score * this.mult);
      if (this.combo === 50 && !this.fever) { this.fever = true; this.hooks.onFever(true); }
      if ([25, 50, 100, 150, 200, 300, 500].includes(this.combo)) this.hooks.onMilestone(this.combo);
      this.hooks.onHit(lane, kind);
      this.burst(lane, J.color, kind === 'perfect' ? 16 : 9);
    }
    if (this.score > this.best.score) { this.best.score = this.score; this.newBest = true; }
    if (this.maxCombo > this.best.combo) this.best.combo = this.maxCombo;
    if (this.judged % 8 === 0) saveBest(this.track.id, this.best);
    this.judgment = { ...J, t: 0, early: kind !== 'perfect' && kind !== 'miss' ? (delta > 0 ? 'ERKEN' : 'GEÇ') : '' };
  }

  // ---- düzen
  layout() {
    const w = this.c.clientWidth;
    const h = this.c.clientHeight;
    const laneW = Math.min(86, (w - 40) / 4);
    const x0 = (w - laneW * 4) / 2;
    const recY = h - (w < 560 ? 210 : 175);
    return { w, h, laneW, x0, recY, topY: 96 };
  }

  laneAt(x) {
    const L = this.layout();
    if (L.w < 560) return Math.min(3, Math.max(0, Math.floor((x / L.w) * 4)));
    const i = Math.floor((x - L.x0) / L.laneW);
    return i >= 0 && i < 4 ? i : -1;
  }

  burst(lane, color, k) {
    const L = this.layout();
    const x = L.x0 + L.laneW * (lane + 0.5);
    this.pops.push({ x, y: L.recY, t: 0, color });
    for (let i = 0; i < k; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 120 + Math.random() * 260;
      this.sparks.push({ x, y: L.recY, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, t: 0, life: 0.35 + Math.random() * 0.3, color });
    }
  }

  update(beat, bpm, dt) {
    if (!this.active) return;
    const spb = 60 / bpm;
    this.now = { beat: beat + (this.offsetMs / 1000) / spb, spb };
    this.ensureChart(beat);
    for (const n of this.notes) {
      if (!n.done && (this.now.beat - n.beat) * spb > WIN.good) {
        n.done = true;
        this.register('miss', n.lane);
      }
    }
    this.notes = this.notes.filter((n) => !n.done || (this.now.beat - n.beat) * spb < 0.3);
    for (let i = 0; i < 4; i++) this.pressed[i] = Math.max(0, this.pressed[i] - dt * 6);
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < 0.4);
    for (const s of this.sparks) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 600 * dt; }
    this.sparks = this.sparks.filter((s) => s.t < s.life);
    if (this.judgment) this.judgment.t += dt;
  }

  arrow(x, y, size, lane, fill, stroke, glow) {
    const g = this.g;
    g.save();
    g.translate(x, y);
    g.rotate(ROT[lane]);
    const s = size;
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.92, -s * 0.06);
    g.lineTo(s * 0.4, -s * 0.06);
    g.lineTo(s * 0.4, s * 0.86);
    g.lineTo(-s * 0.4, s * 0.86);
    g.lineTo(-s * 0.4, -s * 0.06);
    g.lineTo(-s * 0.92, -s * 0.06);
    g.closePath();
    g.lineJoin = 'round';
    if (glow) { g.shadowColor = glow; g.shadowBlur = 18; }
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.lineWidth = 3; g.strokeStyle = stroke; g.stroke(); }
    g.restore();
  }

  draw(beat, pulse, dpr) {
    const c = this.c;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!this.active || !this.now) return;
    const L = this.layout();
    const { laneW, x0, recY, topY } = L;
    const speed = (recY - topY) / LEAD;
    const size = laneW * 0.36;

    // şerit zemini
    const grd = g.createLinearGradient(0, topY, 0, recY + 60);
    grd.addColorStop(0, 'rgba(10,6,14,0)');
    grd.addColorStop(0.5, 'rgba(10,6,14,0.35)');
    grd.addColorStop(1, 'rgba(10,6,14,0.6)');
    g.fillStyle = grd;
    g.fillRect(x0 - 6, topY, laneW * 4 + 12, recY - topY + 70);
    for (let i = 1; i < 4; i++) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x0 + laneW * i - 0.5, topY, 1, recY - topY + 60);
    }
    // vuruş çizgisi
    g.fillStyle = this.fever ? `hsla(${(beat * 90) % 360},100%,65%,0.8)` : 'rgba(255,255,255,0.25)';
    g.fillRect(x0 - 6, recY - 1, laneW * 4 + 12, 2);

    // alıcılar
    for (let i = 0; i < 4; i++) {
      const x = x0 + laneW * (i + 0.5);
      const p = this.pressed[i];
      const s = size * (1 + 0.08 * pulse + 0.12 * p);
      this.arrow(x, recY, s, i, p > 0.05 ? LANE_COLORS[i] + Math.round(p * 140).toString(16).padStart(2, '0') : 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.55)', null);
    }

    // notalar
    for (const n of this.notes) {
      if (n.done) continue;
      const dt = (n.beat - this.now.beat) * this.now.spb;
      if (dt > LEAD + 0.1) continue;
      const y = recY - dt * speed;
      const x = x0 + laneW * (n.lane + 0.5);
      const fade = Math.min(1, (LEAD + 0.1 - dt) * 4);
      g.globalAlpha = fade;
      this.arrow(x, y, size, n.lane, LANE_COLORS[n.lane], 'rgba(255,255,255,0.9)', LANE_COLORS[n.lane]);
      g.globalAlpha = 1;
    }

    // vuruş efektleri
    for (const p of this.pops) {
      const k = p.t / 0.4;
      g.beginPath();
      g.arc(p.x, p.y, size * (0.9 + k * 1.3), 0, Math.PI * 2);
      g.strokeStyle = p.color;
      g.globalAlpha = 1 - k;
      g.lineWidth = 4 * (1 - k) + 1;
      g.stroke();
    }
    for (const s of this.sparks) {
      g.globalAlpha = 1 - s.t / s.life;
      g.fillStyle = s.color;
      g.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    g.globalAlpha = 1;

    // karar ve kombo
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const cx = w / 2;
    if (this.judgment && this.judgment.t < 0.7) {
      const j = this.judgment;
      const pop = 1 + 0.35 * Math.exp(-j.t * 14);
      g.globalAlpha = Math.min(1, (0.7 - j.t) * 4);
      g.font = `700 ${Math.round(30 * pop)}px ${FONT}`;
      g.shadowColor = j.color;
      g.shadowBlur = 20;
      g.fillStyle = j.color;
      g.fillText(j.label, cx, recY - 170);
      g.shadowBlur = 0;
      if (j.early) {
        g.font = `400 12px ${FONT}`;
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fillText(j.early, cx, recY - 145);
      }
      g.globalAlpha = 1;
    }
    if (this.combo >= 5) {
      g.font = `700 ${w < 560 ? 40 : 54}px ${FONT}`;
      g.fillStyle = this.fever ? `hsl(${(beat * 90) % 360},100%,70%)` : '#fff';
      g.shadowColor = 'rgba(255,140,100,0.8)';
      g.shadowBlur = 18;
      g.fillText(String(this.combo), cx, recY - 235);
      g.shadowBlur = 0;
      g.font = `400 12px ${FONT}`;
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(this.fever ? 'FEVER KOMBO x2' : 'KOMBO', cx, recY - 202);
    }

    // skor tablosu
    const top = w < 560 ? 64 : 70;
    g.font = `700 ${w < 560 ? 22 : 28}px ${FONT}`;
    g.fillStyle = '#fff';
    g.fillText(this.score.toLocaleString('tr-TR'), cx, top);
    g.font = `400 11px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.7)';
    const best = this.newBest ? 'YENİ REKOR!' : `REKOR ${this.best.score.toLocaleString('tr-TR')}`;
    g.fillText(`%${this.accuracy.toFixed(1)}  ·  x${this.mult.toFixed(1)}  ·  ${best}`, cx, top + 22);
  }
}
