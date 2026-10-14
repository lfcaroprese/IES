/* Utilidades comunes: números, percentiles, RNG con semilla, hash de CODUSU, limpieza JSON.
   Funciona en el Web Worker y en Node (tests). */
(function (root) {
  const C = {};

  C.isNum = (x) => typeof x === "number" && !isNaN(x);

  /** Percentil con interpolación lineal (igual que numpy.percentile). Ignora NaN/Inf. */
  C.percentile = function (values, q) {
    const v = [];
    for (let i = 0; i < values.length; i++) if (isFinite(values[i])) v.push(values[i]);
    if (!v.length) return NaN;
    v.sort((a, b) => a - b);
    const pos = (q / 100) * (v.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };

  /** Generador pseudoaleatorio con semilla (mulberry32). */
  C.rng = function (seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const R = { next };
    R.int = (lo, hi) => lo + Math.floor(next() * (hi - lo));            // hi excluido
    R.normal = (mu = 0, sd = 1) => {
      let u = 0;
      while (u === 0) u = next();
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    };
    R.gamma = (shape, scale) => {                                        // Marsaglia-Tsang (shape >= 1)
      const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
      for (;;) {
        let x, v;
        do { x = R.normal(); v = 1 + c * x; } while (v <= 0);
        v = v * v * v;
        const u = next();
        if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v * scale;
      }
    };
    R.choice = (arr, p) => {
      if (!p) return arr[Math.floor(next() * arr.length)];
      let u = next(), acc = 0;
      for (let i = 0; i < arr.length; i++) { acc += p[i]; if (u < acc) return arr[i]; }
      return arr[arr.length - 1];
    };
    return R;
  };

  /** Hash de 53 bits de un texto (dos FNV-1a de 32 bits). Identifica viviendas (CODUSU) sin guardar el texto. */
  C.hash53 = function (s) {
    let h1 = 0x811c9dc5, h2 = 0x9747b28c;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x85ebca6b);
      h2 ^= h2 >>> 13;
    }
    return (h1 >>> 0) * 2097152 + ((h2 >>> 0) >>> 11);
  };

  /** NaN/Infinity -> null, arreglos tipados -> arreglos, claves a texto. */
  C.clean = function clean(o) {
    if (o === null || o === undefined) return null;
    if (typeof o === "number") return isFinite(o) ? o : null;
    if (Array.isArray(o)) return o.map(clean);
    if (ArrayBuffer.isView(o)) return Array.from(o, (x) => (isFinite(x) ? x : null));
    if (typeof o === "object") {
      const r = {};
      for (const k of Object.keys(o)) r[k] = clean(o[k]);
      return r;
    }
    return o;
  };

  /** Media ponderada ignorando NaN en x (igual que wmean del backend en Python). */
  C.wmean = function (x, w) {
    let s = 0, sw = 0, any = false;
    for (let i = 0; i < x.length; i++) {
      if (!isNaN(x[i])) { s += x[i] * w[i]; sw += w[i]; any = true; }
    }
    return any && sw > 0 ? s / sw : NaN;
  };

  /** Concatena arreglos tipados del mismo tipo. */
  C.concat = function (arrs, Type) {
    let n = 0;
    for (const a of arrs) n += a.length;
    const out = new Type(n);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  };

  /** Índices de los elementos distintos (devuelve Int32Array de códigos 0..k-1 y k). */
  C.factorize = function (arr, idx) {
    const m = new Map();
    const codes = new Int32Array(idx.length);
    for (let t = 0; t < idx.length; t++) {
      const v = arr[idx[t]];
      let c = m.get(v);
      if (c === undefined) { c = m.size; m.set(v, c); }
      codes[t] = c;
    }
    return { codes, n: m.size };
  };

  root.Common = C;
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof self !== "undefined" ? self : globalThis);
