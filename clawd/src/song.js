// Şarkının yapısı ve davul kalıpları. Hem ses motoru hem de görseller
// aynı fonksiyonları kullanır, böylece ışıklar ve dans vuruşa tam oturur.

// İlk 8 ölçü intro, sonra 32 ölçülük döngü: groove 8, build 4, drop 16, break 4.
export function sectionAt(bar) {
  if (bar < 8) return { name: 'intro', label: 'INTRO', i: bar, len: 8 };
  const b = (bar - 8) % 32;
  if (b < 8) return { name: 'groove', label: 'GROOVE', i: b, len: 8 };
  if (b < 12) return { name: 'build', label: 'BUILD-UP', i: b - 8, len: 4 };
  if (b < 28) return { name: 'drop', label: 'DROP', i: b - 12, len: 16 };
  return { name: 'break', label: 'BREAK', i: b - 28, len: 4 };
}

// Am – F – C – G
export const PROG = [
  { root: 33, chord: [57, 60, 64] },
  { root: 29, chord: [53, 57, 60] },
  { root: 36, chord: [52, 55, 60] },
  { root: 31, chord: [55, 59, 62] },
];

// 16'lık adım -> kök notaya eklenecek yarım ses
export const BASS = { 2: 0, 3: 12, 6: 0, 10: 0, 11: 12, 14: 0 };
export const STABS = [3, 6, 11];
export const ARP = [0, 1, 2, 1, 2, 0, 1, 2];

export function kickAt(bar, s) {
  const sec = sectionAt(bar);
  if (sec.name === 'break') return sec.i === 3 && s >= 8 && s % 2 === 0;
  if (s % 4 !== 0) return false;
  switch (sec.name) {
    case 'intro': return bar >= 4;
    case 'groove':
    case 'drop': return true;
    case 'build': return sec.i < 3;
  }
  return false;
}

export function clapAt(bar, s) {
  const sec = sectionAt(bar);
  switch (sec.name) {
    case 'groove':
    case 'drop':
      return s === 4 || s === 12 ? 0.8 : 0;
    case 'build': {
      if (sec.i === 3 && s >= 12) return 0; // drop öncesi nefes
      const rate = sec.i === 0 ? 4 : sec.i === 1 ? 2 : 1;
      return s % rate === 0 ? 0.25 + 0.55 * ((sec.i * 16 + s) / 64) : 0;
    }
    case 'intro':
      return bar === 7 && s >= 8 && s % 2 === 0 ? 0.4 : 0;
    case 'break':
      return sec.i >= 2 && s === 12 ? 0.5 : 0;
  }
  return 0;
}

export function hatAt(bar, s) {
  const sec = sectionAt(bar);
  let c = 0, o = 0;
  switch (sec.name) {
    case 'intro':
      if (bar >= 2 && s % 4 === 2) o = 0.35;
      if (bar >= 6 && s % 2 === 0 && s % 4 !== 2) c = 0.25;
      break;
    case 'groove':
    case 'drop':
      if (s % 4 === 2) o = 0.45;
      else c = s % 2 === 1 ? 0.32 : 0.18;
      break;
    case 'build':
      if (s % 2 === 0) c = 0.2 + 0.25 * (sec.i / 3);
      break;
    case 'break':
      if (s % 4 === 2) o = 0.2;
      break;
  }
  return { c, o };
}

// Görsellerin ne kadar coşacağı
export const SECTION_ENERGY = { intro: 0.25, groove: 0.6, build: 0.55, drop: 1, break: 0.3 };
