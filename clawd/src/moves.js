// Dans hareketleri. Her hareket vuruş cinsinden zamanı (t) alır ve bir poz döndürür.
// Pozlar düz sayı nesneleri olduğu için iki hareket arasında rahatça karıştırılabilir.

const PI = Math.PI;
const TAU = PI * 2;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const fr = (x) => x - Math.floor(x);
export const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const hit = (ph, k) => Math.exp(-ph * k); // vuruş anında 1, sonra söner
const arc = (ph) => Math.sin(PI * clamp(ph, 0, 1)); // 0 → 1 → 0
const easeOutBack = (x) => { const c = 2.2; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// Bir değer dizisi üzerinde vuruşa kilitli, hafif taşmalı geçiş (robotik kesinlik)
function seq(values, t, rate = 1, snap = 4) {
  const u = t * rate;
  const i = Math.floor(u);
  const n = values.length;
  const a = values[(((i - 1) % n) + n) % n];
  const b = values[((i % n) + n) % n];
  return lerp(a, b, easeOutBack(clamp((u - i) * snap, 0, 1)));
}

export function basePose() {
  return {
    x: 0, z: 0, ry: 0, lift: 0, crouch: 0.04,
    tiltX: 0, tiltZ: 0, twist: 0, sqX: 1, sqY: 1,
    aLr: 0.15, aLs: 0, aLe: 1, aRr: 0.15, aRs: 0, aRe: 1,
    l0x: 0, l1x: 0, l2x: 0, l3x: 0, l0z: 0, l1z: 0, l2z: 0, l3z: 0,
    lookX: 0, lookY: 0, eyeS: 1,
  };
}
export const POSE_KEYS = Object.keys(basePose());

export function blendPose(a, b, k) {
  const out = {};
  for (const key of POSE_KEYS) out[key] = lerp(a[key], b[key], k);
  return out;
}

// Sol yedek dansçı aynadaki görüntü gibi oynasın diye
export function mirrorPose(p) {
  return {
    ...p,
    x: -p.x, ry: -p.ry, tiltZ: -p.tiltZ, twist: -p.twist, lookX: -p.lookX,
    aLr: p.aRr, aRr: p.aLr, aLs: p.aRs, aRs: p.aLs, aLe: p.aRe, aRe: p.aLe,
    l0x: p.l3x, l1x: p.l2x, l2x: p.l1x, l3x: p.l0x,
    l0z: -p.l3z, l1z: -p.l2z, l2z: -p.l1z, l3z: -p.l0z,
  };
}

const MOVE_FNS = {
  idle(t) {
    const b = Math.sin((TAU * t) / 2);
    return {
      sqY: 1 + 0.03 * b, sqX: 1 - 0.02 * b,
      crouch: 0.06 + 0.05 * b,
      tiltZ: 0.05 * Math.sin((TAU * t) / 4),
      aLr: 0.2 + 0.12 * b, aRr: 0.2 + 0.12 * Math.sin((TAU * t) / 2 + 1),
      lookX: seq([0, 0.9, 0.9, 0, -0.9, -0.9, 0, 0], t, 0.5, 3),
      lookY: seq([0, 0, 0.4, 0], t, 0.25, 3),
    };
  },

  bounce(t) {
    const ph = fr(t);
    const up = Math.pow(arc(ph), 0.9);
    const land = hit(ph, 10);
    const s = Math.sin(PI * t);
    return {
      lift: 0.5 * up, crouch: 0.32 * land,
      sqY: 1 + 0.1 * up - 0.13 * land, sqX: 1 - 0.05 * up + 0.1 * land,
      aLr: 0.7 + 0.85 * s, aRr: 0.7 - 0.85 * s,
      l0z: -0.35 * up, l1z: -0.15 * up, l2z: 0.15 * up, l3z: 0.35 * up,
      tiltZ: 0.08 * s, lookY: 0.2 * up,
    };
  },

  crab(t) {
    const w = Math.sin((PI * t) / 4);
    const dir = Math.cos((PI * t) / 4);
    const snap = hit(fr(t * 2), 9);
    const o = {
      x: 1.8 * w, crouch: 0.14,
      lift: 0.06 * Math.abs(Math.sin(TAU * 2 * t)),
      tiltZ: -0.12 * dir,
      aLr: 0.6 + 0.25 * Math.sin(TAU * t), aRr: 0.6 + 0.25 * Math.sin(TAU * t + PI),
      aLs: 0.45, aRs: 0.45, aLe: 1 + 0.45 * snap, aRe: 1 + 0.45 * snap,
      lookX: dir * 0.9,
    };
    for (let i = 0; i < 4; i++) o[`l${i}z`] = 0.42 * Math.sin(TAU * 2 * t + (i * PI) / 2);
    return o;
  },

  robot(t) {
    return {
      ry: seq([0, 0, 0.6, 0.6, -0.6, -0.6, 0, 0], t, 2, 5),
      aLr: seq([0, 1.57, 1.57, 0, 0, -0.4, 0, 1.57], t, 2, 6),
      aRr: seq([0, 0, 1.57, 1.57, 1.57, 0, -0.4, 0], t, 2, 6),
      aLs: seq([0, 0, 0, 0.9, 0.9, 0, 0, 0], t, 2, 6),
      aRs: seq([0, 0, 0, 0, 0, 0.9, 0.9, 0], t, 2, 6),
      tiltZ: seq([0, 0.1, 0, -0.1], t, 1, 6),
      twist: seq([0, 0.3, 0, -0.3], t, 1, 6),
      crouch: 0.1 + 0.12 * seq([0, 1], t, 2, 6),
      lookX: seq([0, 0.8, 0.8, -0.8, -0.8, 0, 0, 0], t, 2, 8),
      lookY: seq([0, 0, 0.5, 0, 0, -0.3, 0, 0], t, 2, 8),
      l0z: seq([0, -0.3, 0, 0], t, 1, 6), l3z: seq([0, 0, 0, 0.3], t, 1, 6),
    };
  },

  shuffle(t) {
    const s = Math.sin(TAU * t);
    const c = Math.abs(Math.cos(TAU * t));
    return {
      l0x: 0.7 * s, l2x: 0.7 * s, l1x: -0.7 * s, l3x: -0.7 * s,
      crouch: 0.15 + 0.12 * c, lift: 0.12 * Math.abs(s),
      x: 0.6 * Math.sin((PI * t) / 4), ry: 0.3 * Math.sin((PI * t) / 4),
      aLs: -0.7 * s, aRs: 0.7 * s, aLr: 0.35, aRr: 0.35,
      tiltX: 0.1, sqY: 1 - 0.05 * c,
    };
  },

  headbang(t) {
    const h = hit(fr(t), 6);
    return {
      tiltX: 0.42 * h - 0.08,
      crouch: 0.25 + 0.15 * h, sqY: 1 - 0.08 * h, sqX: 1 + 0.04 * h,
      aLr: 2.0 + 0.15 * Math.sin(TAU * t * 2), aRr: 2.0 + 0.15 * Math.sin(TAU * t * 2 + 1),
      aLe: 1 + 0.2 * h, aRe: 1 + 0.2 * h,
      eyeS: 0.45, l0z: -0.22, l3z: 0.22, l1z: -0.08, l2z: 0.08,
    };
  },

  spin(t) {
    const c = fr(t / 4) * 4;
    if (c < 1) {
      const k = smooth(c);
      return {
        crouch: 0.45 * k, aLr: 0.15 - 0.65 * k, aRr: 0.15 - 0.65 * k,
        sqY: 1 - 0.12 * k, sqX: 1 + 0.08 * k, ry: -0.3 * k, lookY: -0.2 * k,
      };
    }
    if (c < 2) {
      const u = c - 1;
      const a = arc(u);
      return {
        lift: 1.6 * a, ry: -0.3 + (TAU + 0.3) * easeInOut(u),
        crouch: 0.45 * (1 - smooth(u * 4)),
        aLr: -0.5 + 2.9 * smooth(u * 3), aRr: -0.5 + 2.9 * smooth(u * 3),
        sqY: 1 + 0.15 * a, sqX: 1 - 0.06 * a,
        l0z: -0.5 * a, l1z: -0.25 * a, l2z: 0.25 * a, l3z: 0.5 * a,
        eyeS: 1 + 0.25 * a,
      };
    }
    const v = c - 2;
    const h = hit(v, 5);
    const b = arc(fr(v));
    return {
      crouch: 0.4 * h, sqY: 1 - 0.15 * h + 0.05 * b, sqX: 1 + 0.1 * h,
      lift: 0.15 * b * (1 - h),
      aLr: 0.6 + 0.8 * Math.sin(PI * v), aRr: 0.6 - 0.8 * Math.sin(PI * v),
    };
  },

  wave(t) {
    const p = (TAU * t) / 2;
    const o = {
      aLr: 0.6 + 1.0 * Math.sin(p), aRr: 0.6 + 1.0 * Math.sin(p - 1.8),
      tiltZ: 0.15 * Math.sin(p - 0.9), x: 0.3 * Math.sin(p - 0.9),
      twist: 0.15 * Math.sin(p),
      sqY: 1 + 0.05 * Math.sin(2 * p), crouch: 0.1 + 0.08 * Math.sin(2 * p),
      lookX: 0.5 * Math.sin(p - 0.9),
    };
    for (let i = 0; i < 4; i++) o[`l${i}z`] = 0.25 * Math.sin(p - i * 0.7);
    return o;
  },

  disco(t) {
    const pt = seq([1, 0], t, 1, 5);
    const ph = fr(t);
    return {
      aRr: lerp(-0.7, 2.3, pt), aRs: lerp(0.9, -0.2, pt), aRe: lerp(1, 1.3, pt),
      aLr: -0.5, aLs: -0.6,
      x: 0.25 * Math.sin(PI * t), tiltZ: -0.12 * Math.sin(PI * t), ry: 0.35,
      lift: 0.08 * arc(ph), crouch: 0.1 + 0.1 * hit(ph, 8),
      lookX: lerp(-0.2, 0.8, pt), lookY: lerp(-0.3, 0.5, pt),
      l3z: 0.3 * pt, l2z: 0.1 * pt,
    };
  },

  halay(t) {
    const dip = hit(fr(t), 6);
    const k = fr(t / 4) * 4;
    const kick = k >= 2 && k < 3 ? arc(k - 2) : 0;
    const hop = k >= 3 ? arc(k - 3) : 0;
    const shim = Math.sin(TAU * t * 4) * (0.5 + 0.5 * dip);
    return {
      crouch: 0.12 + 0.22 * dip, lift: 0.22 * hop,
      l0x: -0.8 * kick, l1x: -0.8 * kick,
      x: 0.7 * Math.sin((PI * t) / 8),
      tiltZ: 0.05 * shim, twist: 0.08 * shim,
      aLr: 1.25 + 0.12 * Math.sin(TAU * t), aRr: 1.25 + 0.12 * Math.sin(TAU * t),
      aLs: 0.2, aRs: 0.2, aLe: 1.35, aRe: 1.35,
      lookX: 0.3 * Math.sin((PI * t) / 8),
    };
  },

  star(t) {
    const u = fr(t / 2);
    const jump = u > 0.15 && u < 0.75 ? arc((u - 0.15) / 0.6) : 0;
    const crouch = u < 0.15 ? 0.4 * smooth(u / 0.15) : u > 0.75 ? 0.4 * hit((u - 0.75) * 2, 6) : 0;
    const st = smooth(jump * 2);
    return {
      lift: 1.3 * jump, crouch,
      aLr: 0.1 + 2.3 * st, aRr: 0.1 + 2.3 * st,
      l0z: -0.6 * st, l1z: -0.3 * st, l2z: 0.3 * st, l3z: 0.6 * st,
      sqY: 1 + 0.15 * jump - crouch * 0.3, sqX: 1 - 0.06 * jump + crouch * 0.2,
      tiltZ: 0.1 * Math.sin((PI * t) / 2) * jump,
      eyeS: 1 + 0.25 * jump, lookY: 0.4 * jump,
    };
  },

  // Build-up boyunca gerilim: çömelir, titrer, kollar yavaş yavaş havaya kalkar
  charge(t, ctx) {
    const p = clamp(ctx.prog ?? 0.5, 0, 1);
    const rate = p < 0.5 ? 1 : p < 0.75 ? 2 : 4;
    const shake = (0.01 + 0.07 * p * p) * Math.sin(t * 90);
    const b = arc(fr(t * rate));
    return {
      crouch: 0.1 + 0.32 * p + 0.06 * b,
      x: shake, tiltZ: shake * 2,
      aLr: -0.3 + 2.2 * p + 0.15 * b, aRr: -0.3 + 2.2 * p + 0.15 * b,
      sqY: 1 - 0.1 * p + 0.04 * b, sqX: 1 + 0.05 * p,
      eyeS: 1 + 0.3 * p, lookY: 0.6 * p,
    };
  },
};

export const MOVES = {
  idle: { name: 'Chill' },
  bounce: { name: 'Zıplama' },
  crab: { name: 'Yengeç' },
  robot: { name: 'Robot' },
  shuffle: { name: 'Shuffle' },
  headbang: { name: 'Headbang' },
  spin: { name: 'Fırıldak' },
  wave: { name: 'Dalga' },
  disco: { name: 'Disko' },
  halay: { name: 'Halay' },
  star: { name: 'Yıldız' },
  charge: { name: 'Gerilim', hidden: true },
};
for (const id of Object.keys(MOVES)) MOVES[id].fn = MOVE_FNS[id];

export function evalMove(id, t, ctx) {
  return Object.assign(basePose(), MOVES[id].fn(t, ctx));
}

export const hash = (n) => {
  let x = (n | 0) * 374761393 + 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  return (x ^ (x >>> 16)) >>> 0;
};

const GROOVE_POOL = ['bounce', 'crab', 'disco', 'robot', 'shuffle', 'halay', 'wave'];
const DROP_POOL = ['spin', 'shuffle', 'headbang', 'disco', 'crab', 'robot', 'halay', 'star'];

function pick(pool, k, salt) {
  const a = pool[hash(k * 7 + salt) % pool.length];
  const prev = pool[hash((k - 1) * 7 + salt) % pool.length];
  return a === prev ? pool[(pool.indexOf(a) + 1) % pool.length] : a;
}

// Otomatik koreograf: şarkının bölümüne göre her 4 ölçüde bir hareket seçer
export function autoMove(bar, sec) {
  const chunk = Math.floor(bar / 4);
  switch (sec.name) {
    case 'intro': return sec.i < 4 ? 'idle' : 'wave';
    case 'groove': return pick(GROOVE_POOL, chunk, 1);
    case 'build': return 'charge';
    case 'drop': return sec.i < 4 ? 'star' : pick(DROP_POOL, chunk, 2);
    case 'break': return 'wave';
  }
  return 'idle';
}
