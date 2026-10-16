// Yüklenen şarkıyı çözümler: tempo (BPM), ilk vuruşun yeri, ölçü başı, her 16'lıktaki
// vuruş gücü ve enerjiye göre bölümler (intro / groove / build-up / drop / break).

const SR = 11025;
const HOP = 256;
const WIN = 512;

async function render(buffer, len, withLowpass) {
  const off = new OfflineAudioContext(1, len, SR);
  const src = off.createBufferSource();
  src.buffer = buffer;
  let node = src;
  if (withLowpass) {
    const f = off.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 150;
    src.connect(f);
    node = f;
  }
  node.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

function envelope(x, n) {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const a = i * HOP;
    const b = Math.min(x.length, a + WIN);
    for (let k = a; k < b; k++) sum += x[k] * x[k];
    e[i] = Math.log1p(100 * Math.sqrt(sum / WIN));
  }
  return e;
}

function onsetCurve(e) {
  const n = e.length;
  const o = new Float32Array(n);
  for (let i = 1; i < n; i++) o[i] = Math.max(0, e[i] - e[i - 1]);
  // yerel ortalamayı çıkar ki sürekli yüksek enerjili kısımlar baskın çıkmasın
  const out = new Float32Array(n);
  const W = 16;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += o[i];
    if (i >= W) acc -= o[i - W];
    out[i] = Math.max(0, o[i] - acc / Math.min(i + 1, W));
  }
  return out;
}

const sampleAt = (arr, x) => {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= arr.length) return 0;
  const f = x - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
};

function quantile(arr, q) {
  const s = Array.from(arr).sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] || 0;
}

export async function analyzeSong(ctx, arrayBuffer, onStep = () => {}) {
  onStep('Ses çözülüyor');
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  if (buffer.duration < 8) throw new Error('Şarkı çok kısa');
  const len = Math.ceil(buffer.duration * SR);

  onStep('Frekanslar ayrıştırılıyor');
  const [full, low] = await Promise.all([render(buffer, len, false), render(buffer, len, true)]);
  const n = Math.floor(len / HOP);
  const fps = SR / HOP;
  const eFull = envelope(full, n);
  const eLow = envelope(low, n);
  const oFull = onsetCurve(eFull);
  const oLow = onsetCurve(eLow);
  const onset = new Float32Array(n);
  for (let i = 0; i < n; i++) onset[i] = oFull[i] + 1.5 * oLow[i];

  // ---- tempo: otokorelasyon + 120 BPM civarını seven bir ön kabul
  onStep('Tempo aranıyor');
  const minLag = Math.floor((fps * 60) / 180);
  const maxLag = Math.ceil((fps * 60) / 75);
  let bestLag = minLag, bestR = -1;
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let r = 0;
    for (let i = 0; i + lag < n; i++) r += onset[i] * onset[i + lag];
    ac[lag] = r;
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.8, 2));
    if (ac[lag] * w > bestR) { bestR = ac[lag] * w; bestLag = lag; }
  }
  let bpm = (60 * fps) / bestLag;
  while (bpm < 85) bpm *= 2;
  while (bpm > 175) bpm /= 2;

  // ---- tempo ve faz inceltme: tarak filtresi ile tüm şarkı boyunca en iyi oturan ızgara
  onStep('Vuruşlar hizalanıyor');
  let best = { score: -1, bpm, phase: 0 };
  for (let cand = bpm - 2; cand <= bpm + 2; cand += 0.05) {
    const P = (fps * 60) / cand;
    for (let ph = 0; ph < P; ph += 0.5) {
      let sc = 0;
      for (let x = ph; x < n; x += P) sc += sampleAt(onset, x);
      if (sc > best.score) best = { score: sc, bpm: cand, phase: ph };
    }
  }
  bpm = Math.round(best.bpm * 20) / 20;
  const P = (fps * 60) / bpm;
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;

  // ---- ölçü başı: bas enerjisinin en güçlü olduğu vuruş
  let bestB0 = 0, bestLowSum = -1;
  for (let b0 = 0; b0 < 4; b0++) {
    let sum = 0;
    for (let k = b0; best.phase + k * P < n; k += 4) sum += sampleAt(oLow, best.phase + k * P);
    if (sum > bestLowSum) { bestLowSum = sum; bestB0 = b0; }
  }
  let firstBeat = (best.phase + bestB0 * P) / fps;
  while (firstBeat - barSec >= 0) firstBeat -= barSec;
  const totalBars = Math.floor((buffer.duration - firstBeat) / barSec);
  if (totalBars < 4) throw new Error('Şarkıda yeterli ölçü bulunamadı');

  // ---- her 16'lığın vuruş gücü (dans ve oyun notaları için)
  const steps = totalBars * 16;
  const raw = new Float32Array(steps);
  for (let k = 0; k < steps; k++) {
    const x = ((firstBeat + (k * beatSec) / 4) * fps);
    raw[k] = Math.max(sampleAt(onset, x - 1), sampleAt(onset, x), sampleAt(onset, x + 1));
  }
  const norm = quantile(raw, 0.92) || 1;
  const onsetSteps = raw.map((v) => Math.min(1, v / norm));

  // ---- bölümler: ölçü enerjisinin şarkı içindeki sırası
  onStep('Drop\'lar tespit ediliyor');
  const barE = new Float32Array(totalBars);
  for (let b = 0; b < totalBars; b++) {
    const a = Math.floor((firstBeat + b * barSec) * fps);
    const z = Math.floor((firstBeat + (b + 1) * barSec) * fps);
    let s = 0;
    for (let i = a; i < z && i < n; i++) s += eFull[i];
    barE[b] = s / Math.max(1, z - a);
  }
  // Enerjiyi şarkının kendi aralığına göre 0..1'e çek; drop hem göreli olarak yüksek
  // hem de şarkının en enerjili kısmında olmalı
  const q05 = quantile(barE, 0.05);
  const q95 = quantile(barE, 0.95);
  const span = Math.max(1e-6, q95 - q05);
  const hiQ = quantile(barE, 0.55);
  let labels = Array.from(barE, (e) => {
    const r = (e - q05) / span;
    if (r > 0.72 && e >= hiQ) return 'drop';
    if (r < 0.3) return 'break';
    return 'groove';
  });
  // 3 ölçülük çoğunluk filtresi
  labels = labels.map((l, i) => {
    const w = [labels[i - 1], l, labels[i + 1]].filter(Boolean);
    const cnt = {};
    for (const x of w) cnt[x] = (cnt[x] || 0) + 1;
    return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  });
  for (let i = 0; i < labels.length && labels[i] === 'break'; i++) labels[i] = 'intro';
  if (labels[0] !== 'intro' && labels.length > 8) { labels[0] = 'intro'; labels[1] = 'intro'; }
  // drop'tan hemen önceki 2 ölçü build-up olsun
  for (let i = 2; i < labels.length; i++) {
    if (labels[i] === 'drop' && labels[i - 1] !== 'drop' && labels[i - 1] !== 'build') {
      for (let k = Math.max(0, i - 2); k < i; k++) if (labels[k] !== 'intro') labels[k] = 'build';
    }
  }
  const NAMES = { intro: 'INTRO', groove: 'GROOVE', build: 'BUILD-UP', drop: 'DROP', break: 'BREAK' };
  const sections = new Array(totalBars);
  for (let i = 0; i < totalBars;) {
    let j = i;
    while (j < totalBars && labels[j] === labels[i]) j++;
    for (let k = i; k < j; k++) sections[k] = { name: labels[i], label: NAMES[labels[i]], i: k - i, len: j - i };
    i = j;
  }

  return { buffer, bpm, firstBeat, totalBars, sections, onset: onsetSteps };
}
