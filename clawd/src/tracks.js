// Parçalar. Her parça kendi tempo, bölüm yapısı, vuruş haritası ve koreografisini taşır;
// sentezlenen parçalar ayrıca her 16'lık adımda hangi enstrümanın çalacağını belirler.
import { sectionAt, kickAt, clapAt, hatAt, PROG, BASS, STABS, ARP } from './song.js';
import { autoMove, pick } from './moves.js';

// ------------------------------------------------------------------ Clawd House
export const house = {
  id: 'house',
  name: 'Clawd House',
  bpm: 124,
  tempo: true,
  sectionAt,
  kickAt,
  choreo: autoMove,
  schedule(m, n, t) {
    const bar = Math.floor(n / 16);
    const s = n % 16;
    const sec = sectionAt(bar);
    const ch = PROG[bar % 4];
    const sd = m.stepDur;

    if (kickAt(bar, s)) m.kick(t);
    const clap = clapAt(bar, s);
    if (clap) m.clap(t, clap);
    const hat = hatAt(bar, s);
    if (hat.c) m.hat(t, hat.c, false);
    if (hat.o) m.hat(t, hat.o, true);

    if ((sec.name === 'groove' || sec.name === 'drop') && BASS[s] !== undefined) m.bass(t, ch.root + BASS[s], sd * 0.95);
    if (sec.name === 'drop' && STABS.includes(s)) m.stab(t, ch.chord, sd * 1.6);

    if (s === 0) {
      if (sec.name === 'intro' || sec.name === 'break') m.pad(t, ch.chord, sd * 16, 900, 900);
      else if (sec.name === 'groove' && sec.i >= 4) m.pad(t, ch.chord, sd * 16, 700, 1400);
      else if (sec.name === 'build') {
        const p = sec.i / 4;
        m.pad(t, ch.chord, sd * 16, 400 + 3000 * p, 400 + 3000 * (p + 0.25));
      }
      if (sec.name === 'build' && sec.i === 0) m.riser(t, sd * 64);
      if ((sec.name === 'drop' && sec.i % 8 === 0) || (sec.name === 'groove' && sec.i === 0)) m.crash(t);
      if (sec.name === 'drop' && sec.i === 0) m.boom(t);
    }

    if ((sec.name === 'drop' && sec.i >= 8) || sec.name === 'break') {
      if (sec.name === 'drop' || s % 2 === 0) {
        m.arp(t, ch.chord[ARP[s % 8]] + 12 + (s >= 8 ? 12 : 0), sec.name === 'drop' ? 0.06 : 0.04);
      }
    }
  },
};

// ------------------------------------------------------------------ Halay Gecesi
// Hicaz makamında (La üzerinde) iki ölçülük zurna cümleleri: [adım, midi, uzunluk]
const MEL_A = [[0, 76, 2], [2, 77, 2], [4, 76, 2], [6, 74, 2], [8, 73, 2], [10, 74, 2], [12, 76, 4],
  [16, 74, 2], [18, 73, 2], [20, 70, 2], [22, 73, 2], [24, 69, 8]];
const MEL_B = [[0, 81, 2], [2, 79, 2], [4, 77, 2], [6, 76, 2], [8, 77, 2], [10, 76, 2], [12, 74, 2], [14, 73, 2],
  [16, 74, 2], [18, 73, 2], [20, 70, 2], [22, 73, 2], [24, 69, 6], [30, 73, 1], [31, 74, 1]];
const MEL_C = [[0, 69, 1], [1, 70, 1], [2, 73, 2], [4, 74, 1], [5, 76, 1], [6, 77, 2], [8, 76, 1], [9, 77, 1], [10, 79, 2],
  [12, 81, 4], [16, 79, 2], [18, 77, 2], [20, 76, 2], [22, 74, 2], [24, 73, 2], [26, 70, 2], [28, 69, 4]];

function melodyAt(bar, sec) {
  const k = Math.floor(bar / 2) % 4;
  const phrase = sec.name === 'drop' && k % 2 === 1 ? MEL_C : k < 2 ? MEL_A : MEL_B;
  const off = (bar % 2) * 16;
  return phrase.filter(([s]) => s >= off && s < off + 16).map(([s, m, l]) => [s - off, m, l]);
}

export const halay = {
  id: 'halay',
  name: 'Halay Gecesi',
  bpm: 118,
  tempo: true,
  sectionAt,
  kickAt(bar, s) {
    const sec = sectionAt(bar);
    if (sec.name === 'intro') return bar >= 4 && (s === 0 || s === 8);
    if (sec.name === 'break') return s === 0 || (sec.i === 3 && s >= 8 && s % 2 === 0);
    if (sec.name === 'build') return sec.i < 3 && (s === 0 || s === 8);
    return s === 0 || s === 8;
  },
  choreo(bar, sec) {
    const chunk = Math.floor(bar / 4);
    switch (sec.name) {
      case 'intro': return sec.i < 4 ? 'idle' : 'omuz';
      case 'groove': return pick(['halay', 'omuz', 'bounce', 'moonwalk', 'wave'], chunk, 3);
      case 'build': return 'charge';
      case 'drop': return sec.i < 4 ? 'halay' : pick(['omuz', 'star', 'halay', 'spin', 'shuffle', 'crab'], chunk, 4);
      case 'break': return 'wave';
    }
    return 'idle';
  },
  schedule(m, n, t) {
    const bar = Math.floor(n / 16);
    const s = n % 16;
    const sec = sectionAt(bar);
    const sd = m.stepDur;

    // Davul: "düm ... tek ... düm . düm ... tek . tek"
    const groove = sec.name === 'groove' || sec.name === 'drop' || (sec.name === 'intro' && bar >= 4);
    if (groove) {
      if (s === 0 || s === 8) m.dum(t, 0.95);
      if (s === 6) m.dum(t, 0.55);
      if (s === 4 || s === 12) m.tek(t, 0.65);
      if (s === 14) m.tek(t, 0.42);
      if (sec.name === 'drop') {
        if (s % 2 === 1) m.darbuka(t, s % 4 === 3 ? 0.4 : 0.22);
        if (s === 4 || s === 12) m.clap(t, 0.45);
        if (s % 4 === 2) m.hat(t, 0.3, false);
      }
    } else if (sec.name === 'build') {
      const rate = sec.i === 0 ? 4 : sec.i === 1 ? 2 : 1;
      if (!(sec.i === 3 && s >= 12)) {
        if (s % rate === 0) m.tek(t, 0.3 + 0.5 * ((sec.i * 16 + s) / 64));
        if (s % 8 === 0 && sec.i < 3) m.dum(t, 0.85);
      }
      if (sec.i === 0 && s === 0) m.riser(t, sd * 64);
    } else if (sec.name === 'break') {
      if (s === 0) m.dum(t, 0.5);
      if (sec.i === 3 && s >= 8 && s % 2 === 0) m.dum(t, 0.75);
    }

    // Zurna
    if (sec.name === 'build') {
      if (sec.i >= 2) {
        if (!(sec.i === 3 && s >= 12)) m.zurna(t, s % 2 ? 77 : 76, sd * 0.95, 0.06 + 0.04 * (sec.i - 2));
      } else if (s === 0) m.zurna(t, 76, sd * 15.5, 0.05);
    } else {
      for (const [st, mi, l] of melodyAt(bar, sec)) {
        if (st !== s) continue;
        const v = sec.name === 'drop' ? 0.08 : sec.name === 'groove' ? 0.066 : 0.058;
        m.zurna(t, mi, sd * l * 0.97, v, 0);
        if (sec.name === 'drop') m.zurna(t, mi - 12, sd * l * 0.97, v * 0.55, 1);
      }
    }

    if (s === 0) {
      if (sec.name !== 'drop' && sec.name !== 'build') m.drone(t, 57, sd * 16);
      if (sec.name === 'drop' && sec.i % 8 === 0) m.crash(t);
      if (sec.name === 'drop' && sec.i === 0) m.boom(t);
      if (sec.name === 'groove' && sec.i === 0) m.crash(t);
    }
  },
};

// ------------------------------------------------------------------ Yüklenen şarkı
export function customTrack(a, name) {
  const mod = (b) => ((b % a.totalBars) + a.totalBars) % a.totalBars;
  return {
    id: 'custom',
    name,
    bpm: a.bpm,
    tempo: false,
    buffer: a.buffer,
    firstBeat: a.firstBeat,
    totalBars: a.totalBars,
    sectionAt: (bar) => a.sections[mod(bar)],
    kickAt: (bar, s) => s % 4 === 0 && a.onset[mod(bar) * 16 + s] > 0.35,
    noteGate: (bar, s) => a.onset[mod(bar) * 16 + s],
    choreo: autoMove,
    schedule() {},
  };
}

export const TRACKS = { house, halay };
