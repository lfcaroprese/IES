/* Índice de Calidad Habitacional (ICH) sobre la base Hogar de la EPH.
   Port a JavaScript de reference/app.py. Las fórmulas se aplican al cargar los datos guardados,
   no al subir los archivos: cambiar una regla no obliga a volver a subir nada. */
(function (root) {
  const { percentile, wmean, factorize, concat, rng } = root.Common;
  const K = {};

  K.DIMS = ["mat", "agua", "sanea", "hacin", "energ", "entorno", "sjt"];
  K.LABELS = { mat: "Materiales", agua: "Agua", sanea: "Saneamiento", hacin: "Hacinamiento", energ: "Energía de cocción", entorno: "Entorno", sjt: "Seguridad jurídica" };
  K.PESOS_DEFAULT = { mat: 20, agua: 15, sanea: 25, hacin: 25, energ: 5, entorno: 10, sjt: 0 };
  K.REQ = ["CODUSU", "ANO4", "TRIMESTRE", "PONDERA", "IX_TOT", "IV3", "IV4", "IV5", "IV6", "IV7", "IV8",
    "IV9", "IV10", "IV11", "IV12_1", "IV12_2", "IV12_3", "II1", "II8", "II9"];
  K.OPT = ["REALIZADA", "II7", "REGION", "AGLOMERADO", "DECIFR"];
  K.WANTED = K.REQ.concat(K.OPT);
  K.TENENCIA = { 1: "Propietario de vivienda y terreno", 2: "Propietario solo de la vivienda", 3: "Inquilino/arrendatario", 4: "Ocupante por pago de impuestos/expensas", 5: "Ocupante en relación de dependencia", 6: "Ocupante gratuito (con permiso)", 7: "Ocupante de hecho (sin permiso)", 8: "En sucesión", 9: "Otra situación" };
  K.SJT_DEFAULT = { 1: 1.0, 2: 0.8, 3: 0.6, 4: 0.5, 5: 0.3, 6: 0.3, 7: 0.0, 8: 0.5, 9: 0.3 };
  K.REGIONES = { 1: "GBA", 40: "Noroeste", 41: "Noreste", 42: "Cuyo", 43: "Pampeana", 44: "Patagonia" };
  K.TERR = { 32: "CABA", 33: "Partidos del GBA", 40: "Noroeste", 41: "Noreste", 42: "Cuyo", 43: "Pampeana", 44: "Patagonia" };
  K.REGION_AGLOS = { 1: [32, 33], 40: [18, 19, 22, 23, 25, 29], 41: [7, 8, 12, 15], 42: [10, 26, 27], 43: [2, 3, 4, 5, 6, 13, 14, 30, 34, 36, 38], 44: [9, 17, 20, 31, 91, 93] };
  K.AGLOS = { 2: "Gran La Plata", 3: "Bahía Blanca-Cerri", 4: "Gran Rosario", 5: "Gran Santa Fe", 6: "Gran Paraná", 7: "Posadas", 8: "Gran Resistencia", 9: "Comodoro Rivadavia-Rada Tilly", 10: "Gran Mendoza", 12: "Corrientes", 13: "Gran Córdoba", 14: "Concordia", 15: "Formosa", 17: "Neuquén-Plottier", 18: "Santiago del Estero-La Banda", 19: "Jujuy-Palpalá", 20: "Río Gallegos", 22: "Gran Catamarca", 23: "Gran Salta", 25: "La Rioja", 26: "Gran San Luis", 27: "Gran San Juan", 29: "Gran Tucumán-Tafí Viejo", 30: "Santa Rosa-Toay", 31: "Ushuaia-Río Grande", 32: "CABA", 33: "Partidos del GBA", 34: "Mar del Plata", 36: "Río Cuarto", 38: "San Nicolás-Villa Constitución", 91: "Rawson-Trelew", 93: "Viedma-Carmen de Patagones" };

  const MAP = {
    iv3: { 1: 1, 2: .5, 3: 0, 4: .5 },
    iv4: { 1: 1, 2: .75, 3: 1, 4: .5, 5: .5, 6: 0, 7: 0, 9: 1 },
    iv6: { 1: 1, 2: .5, 3: 0 }, iv7: { 1: 1, 2: .5, 3: .25, 4: 0 },
    iv9: { 1: 1, 2: .5, 3: 0 }, iv10: { 1: 1, 2: .5, 3: 0 },
    iv11: { 1: 1, 2: .6, 3: .3, 4: 0 }, ii9: { 1: 1, 2: .5, 3: .25, 4: 0 },
    ii8: { 1: 1, 2: .5, 3: 0, 4: 0 },
  };
  const mp = (m, v) => { const r = m[v]; return r === undefined ? NaN : r; };

  /** Subíndices 0-1 por hogar (reglas fijas; ver Metodología en la página). */
  K.subindices = function (c) {
    const n = c.ANO4.length;
    const o = { mat: new Float64Array(n), agua: new Float64Array(n), sanea: new Float64Array(n), hacin: new Float64Array(n), energ: new Float64Array(n), entorno: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
      const piso = mp(MAP.iv3, c.IV3[i]), techo = mp(MAP.iv4, c.IV4[i]);
      const cielo = c.IV5[i] === 2 ? 0 : 1;
      o.mat[i] = (piso + techo + cielo) / 3;
      o.agua[i] = (mp(MAP.iv6, c.IV6[i]) + mp(MAP.iv7, c.IV7[i])) / 2;
      const san = .2 * mp(MAP.iv9, c.IV9[i]) + .3 * mp(MAP.iv10, c.IV10[i]) + .3 * mp(MAP.iv11, c.IV11[i]) + .2 * mp(MAP.ii9, c.II9[i]);
      o.sanea[i] = c.IV8[i] === 2 ? 0 : san;
      const ii1 = c.II1[i];
      let h;
      if (ii1 === 0) h = 0;
      else if (ii1 > 0) h = Math.min(1, Math.max(0, (3 - c.IX_TOT[i] / ii1) / 2));
      else h = NaN;
      o.hacin[i] = h;
      o.energ[i] = mp(MAP.ii8, c.II8[i]);
      const a = c.IV12_1[i], b = c.IV12_2[i], d = c.IV12_3[i];
      const ok = (a === 1 || a === 2) && (b === 1 || b === 2) && (d === 1 || d === 2);
      o.entorno[i] = ok ? ((a === 2) + (b === 2) + (d === 2)) / 3 : NaN;
    }
    return o;
  };

  const gather = (df, idx) => {
    const o = {};
    for (const name of Object.keys(df)) { const a = df[name], r = new Float64Array(idx.length); for (let j = 0; j < idx.length; j++) r[j] = a[idx[j]]; o[name] = r; }
    return o;
  };

  /** Divide la base leída por período (ANO4*10+TRIMESTRE). No filtra nada más: eso lo hace procesar(). */
  K.splitPeriods = function (df) {
    const faltan = K.REQ.filter((c) => !df[c]);
    if (faltan.length) throw new Error("faltan columnas de la base Hogar: " + faltan.join(", ") + " (¿subiste la base Individual por error?)");
    const n = df.ANO4.length, groups = new Map();
    for (let i = 0; i < n; i++) {
      const y = df.ANO4[i], t = df.TRIMESTRE[i];
      if (isNaN(y) || isNaN(t)) continue;
      const per = y * 10 + t;
      if (!groups.has(per)) groups.set(per, []);
      groups.get(per).push(i);
    }
    const out = new Map();
    for (const [per, idx] of groups) out.set(per, gather(df, idx));
    return out;
  };

  /** Columnas guardadas -> parte lista para calcular (filtra entrevistas no realizadas y aplica las fórmulas). */
  K.procesar = function (rawAll) {
    const m = rawAll.ANO4.length, keep = [];
    for (let i = 0; i < m; i++) {
      if (rawAll.REALIZADA && rawAll.REALIZADA[i] !== 1) continue;
      if (isNaN(rawAll.PONDERA[i]) || isNaN(rawAll.IX_TOT[i])) continue;
      keep.push(i);
    }
    const raw = keep.length === m ? rawAll : gather(rawAll, keep);
    const sub = K.subindices(raw), n = raw.ANO4.length;
    const nanCol = () => new Float64Array(n).fill(NaN);
    const part = {
      n, ANO4: raw.ANO4, TRIM: raw.TRIMESTRE, COD: raw.CODUSU, PONDERA: raw.PONDERA, IX_TOT: raw.IX_TOT,
      ...sub,
      II7: raw.II7 || nanCol(), REGION: raw.REGION || nanCol(), AGL: raw.AGLOMERADO || nanCol(), DEC: raw.DECIFR || nanCol(),
    };
    part.PER = new Float64Array(n);
    for (let i = 0; i < n; i++) part.PER[i] = part.ANO4[i] * 10 + part.TRIM[i];
    return part;
  };

  const FIELDS = ["ANO4", "TRIM", "COD", "PONDERA", "IX_TOT", "mat", "agua", "sanea", "hacin", "energ", "entorno", "II7", "REGION", "AGL", "DEC", "PER"];
  K.combine = function (parts) {
    if (!parts.length) return null;
    const d = {};
    for (const f of FIELDS) d[f] = concat(parts.map((p) => p[f]), Float64Array);
    d.n = d.PER.length;
    return d;
  };
  const take = (d, idx) => {
    const o = {};
    for (const f of FIELDS) { const a = d[f], r = new Float64Array(idx.length); for (let j = 0; j < idx.length; j++) r[j] = a[idx[j]]; o[f] = r; }
    o.n = idx.length;
    return o;
  };

  const plabel = (p, anual) => (anual ? String(Math.trunc(p)) : `${p % 10}T${Math.floor(p / 10)}`);

  K.resumenCarga = function (d) {
    if (!d) return [];
    const m = new Map();
    for (let i = 0; i < d.n; i++) m.set(d.PER[i], (m.get(d.PER[i]) || 0) + 1);
    return [...m.keys()].sort((a, b) => a - b).map((p) => ({ periodo: `${Math.floor(p / 10)}-${p % 10}T`, hogares: m.get(p) }));
  };

  // ---------------------------------------------------------------------------
  // Cálculo principal
  // ---------------------------------------------------------------------------
  K.compute = function (full, body) {
    if (!full) return { error: "No hay datos cargados." };
    const DIMS = K.DIMS;
    const pesos = {};
    for (const k of DIMS) pesos[k] = Number((body.pesos || {})[k] || 0) || 0;
    if (DIMS.reduce((a, k) => a + pesos[k], 0) <= 0) return { error: "La suma de pesos debe ser mayor que 0." };
    const trims = (body.trimestres && body.trimestres.length ? body.trimestres : [1]).map(Number);
    const porPersonas = (body.ponderar || "personas") === "personas";
    const thrLo = body.umbral_bajo == null ? 2 : +body.umbral_bajo, thrHi = body.umbral_alto == null ? 4 : +body.umbral_alto;
    const B = body.boot == null ? 200 : Math.trunc(+body.boot);
    const sjtScores = {};
    const src = body.sjt_scores || K.SJT_DEFAULT;
    for (const k of Object.keys(src)) sjtScores[+k] = +src[k];
    const R = rng(42);

    const keep = [];
    for (let i = 0; i < full.n; i++) if (trims.includes(full.TRIM[i])) keep.push(i);
    if (!keep.length) return { error: "No hay datos para los trimestres seleccionados." };
    const d = take(full, keep), n = d.n;

    const S = { mat: d.mat, agua: d.agua, sanea: d.sanea, hacin: d.hacin, energ: d.energ, entorno: d.entorno };
    S.sjt = new Float64Array(n);
    for (let i = 0; i < n; i++) { const v = sjtScores[d.II7[i]]; S.sjt[i] = v === undefined ? NaN : v; }
    let w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = d.PONDERA[i] * (porPersonas ? d.IX_TOT[i] : 1);
    const perQ = d.PER;
    const anual = (body.agregacion || "anio") === "anio";
    let per = perQ;
    if (anual) {
      // Cada trimestre pesa igual: el ponderador se normaliza dentro de su trimestre.
      const tot = new Map();
      for (let i = 0; i < n; i++) tot.set(perQ[i], (tot.get(perQ[i]) || 0) + w[i]);
      for (let i = 0; i < n; i++) w[i] = w[i] / tot.get(perQ[i]);
      per = d.ANO4;
    }

    const act = DIMS.filter((k) => pesos[k] > 0);
    const wsum = act.reduce((a, k) => a + pesos[k], 0);
    const ich = new Float64Array(n).fill(NaN);
    let nValid = 0;
    const valid = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let ok = true, s = 0;
      for (const k of act) { const v = S[k][i]; if (isNaN(v)) { ok = false; break; } s += pesos[k] * v; }
      if (ok) { valid[i] = 1; nValid++; ich[i] = 1 + 4 * s / wsum; }
    }
    // ICH físico (sin seguridad jurídica) para cruzar con tenencia
    let fw = {};
    for (const k of DIMS.slice(0, -1)) if (pesos[k] > 0) fw[k] = pesos[k];
    if (!Object.keys(fw).length) for (const k of DIMS.slice(0, -1)) fw[k] = 1;
    const wf = Object.values(fw).reduce((a, b) => a + b, 0);
    const ichF = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      let ok = true, s = 0;
      for (const k of Object.keys(fw)) { const v = S[k][i]; if (isNaN(v)) { ok = false; break; } s += fw[k] * v; }
      if (ok) ichF[i] = 1 + 4 * s / wf;
    }

    const byPer = new Map();
    for (let i = 0; i < n; i++) { if (!byPer.has(per[i])) byPer.set(per[i], []); byPer.get(per[i]).push(i); }
    const periodos = [...byPer.keys()].sort((a, b) => a - b);
    const cols = periodos.map((p) => plabel(p, anual));
    const x = periodos.map((p) => (anual ? p : Math.floor(p / 10) + ((p % 10) - 1) / 4));

    const serie = [], boots = [];
    for (const p of periodos) {
      const idx = byPer.get(p);
      const iv = idx.filter((i) => valid[i]);
      const row = { periodo: plabel(p, anual), n: idx.length, n_validos: iv.length, trims: new Set(idx.map((i) => perQ[i])).size };
      if (!iv.length) { serie.push(row); boots.push(new Float64Array(Math.max(B, 1)).fill(NaN)); continue; }
      let W = 0, WI = 0, WL = 0, WH = 0;
      const bandas = [0, 0, 0, 0];
      for (const i of iv) {
        const v = ich[i], wi = w[i];
        W += wi; WI += wi * v;
        if (v < thrLo) WL += wi;
        if (v >= thrHi) WH += wi;
        if (v >= 0 && v < 2) bandas[0] += wi; else if (v >= 2 && v < 3) bandas[1] += wi; else if (v >= 3 && v < 4) bandas[2] += wi; else if (v >= 4 && v < 6) bandas[3] += wi;
      }
      row.ich = WI / W;
      row.pct_bajo = 100 * WL / W;
      row.pct_alto = 100 * WH / W;
      row.bandas = bandas.map((b) => 100 * b / W);
      const wp = idx.map((i) => w[i]);
      for (const k of DIMS) row["dim_" + k] = wmean(idx.map((i) => S[k][i]), wp);
      row.sjt_idx = isNaN(row.dim_sjt) ? NaN : 1 + 4 * row.dim_sjt;
      let ws = 0, wsi = 0, wb = 0, wbd = 0;
      for (const i of idx) {
        const sj = S.sjt[i];
        if (!isNaN(sj)) { ws += w[i]; if (sj < .5) wsi += w[i]; if (!isNaN(ichF[i])) { wb += w[i]; if (sj < .5 && ichF[i] < 3) wbd += w[i]; } }
      }
      row.pct_tenencia_insegura = ws > 0 ? 100 * wsi / ws : NaN;
      row.pct_doble_deficit = wb > 0 ? 100 * wbd / wb : NaN;
      if (B > 0) {
        const { codes, n: nc } = factorize(d.COD, iv);
        const Wc = new Float64Array(nc), Ic = new Float64Array(nc), Lc = new Float64Array(nc);
        for (let t = 0; t < iv.length; t++) {
          const i = iv[t], c = codes[t];
          Wc[c] += w[i]; Ic[c] += w[i] * ich[i]; if (ich[i] < thrLo) Lc[c] += w[i];
        }
        const ib = new Float64Array(B), lb = new Float64Array(B);
        for (let r = 0; r < B; r++) {
          let den = 0, a = 0, l = 0;
          for (let t = 0; t < nc; t++) { const j = Math.floor(R.next() * nc); den += Wc[j]; a += Ic[j]; l += Lc[j]; }
          ib[r] = a / den; lb[r] = 100 * l / den;
        }
        row.ich_lo = percentile(ib, 2.5); row.ich_hi = percentile(ib, 97.5);
        row.pct_bajo_lo = percentile(lb, 2.5); row.pct_bajo_hi = percentile(lb, 97.5);
        boots.push(ib);
      } else boots.push(new Float64Array(1).fill(NaN));
      serie.push(row);
    }

    let nOk = 0;
    for (let i = 0; i < n; i++) nOk += valid[i];
    const out = { periodos: cols, anual, serie, descartados_pct: 100 * (1 - nOk / n) };

    // Tendencia y diferencia primero-último
    const ichs = serie.map((r) => (r.ich === undefined ? NaN : r.ich));
    const okIdx = [];
    ichs.forEach((v, j) => { if (!isNaN(v)) okIdx.push(j); });
    if (okIdx.length >= 3) {
      const xs = okIdx.map((j) => x[j]), ys = okIdx.map((j) => ichs[j]);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const sxx = xs.reduce((a, v) => a + (v - mx) ** 2, 0);
      const tend = { pend: xs.reduce((a, v, t) => a + (v - mx) * (ys[t] - my), 0) / sxx };
      if (B > 0) {
        const xc = xs.map((v) => v - mx), sl = new Float64Array(B);
        for (let r = 0; r < B; r++) {
          let mean = 0;
          for (const j of okIdx) mean += boots[j][r];
          mean /= okIdx.length;
          let s = 0;
          okIdx.forEach((j, t) => { s += xc[t] * (boots[j][r] - mean); });
          sl[r] = s / sxx;
        }
        tend.pend_lo = percentile(sl, 2.5); tend.pend_hi = percentile(sl, 97.5);
      }
      out.tendencia = tend;
    }
    if (okIdx.length >= 2) {
      const i0 = okIdx[0], i1 = okIdx[okIdx.length - 1];
      const dif = { desde: cols[i0], hasta: cols[i1], dif: ichs[i1] - ichs[i0] };
      if (B > 0) {
        const db = new Float64Array(B);
        for (let r = 0; r < B; r++) db[r] = boots[i1][r] - boots[i0][r];
        dif.lo = percentile(db, 2.5); dif.hi = percentile(db, 97.5);
      }
      const contrib = {};
      for (const k of act) {
        const a = serie[i0]["dim_" + k], b = serie[i1]["dim_" + k];
        contrib[k] = (a !== undefined && b !== undefined && !isNaN(a) && !isNaN(b)) ? 4 * pesos[k] / wsum * (b - a) : 0;
      }
      dif.contrib = contrib;
      dif.residuo = dif.dif - Object.values(contrib).reduce((a, b) => a + b, 0);
      dif.ich0 = ichs[i0]; dif.ich1 = ichs[i1];
      out.diferencia = dif;
    }

    // Regiones, aglomerados, deciles
    const tabla = (arr, claves) => {
      const res = {};
      for (const p of periodos) {
        const fila = {};
        for (const c of claves) {
          const m = byPer.get(p).filter((i) => arr[i] === c && !isNaN(ich[i]));
          if (m.length >= 15) fila[c] = { v: wmean(m.map((i) => ich[i]), m.map((i) => w[i])), n: m.length };
        }
        res[plabel(p, anual)] = fila;
      }
      return res;
    };
    const terr = new Float64Array(n);
    for (let i = 0; i < n; i++) terr[i] = (d.AGL[i] === 32 || d.AGL[i] === 33) ? d.AGL[i] : d.REGION[i];

    const comp = {};
    for (const [code, name] of Object.entries(K.REGIONES)) {
      const set = new Set();
      for (let i = 0; i < full.n; i++) if (full.REGION[i] === +code && !isNaN(full.AGL[i])) set.add(full.AGL[i]);
      let ag = [...set].sort((a, b) => a - b), origen = "datos cargados";
      if (!ag.length) { ag = K.REGION_AGLOS[code]; origen = "asignación oficial (la base no trae REGION)"; }
      comp[name] = { origen, aglomerados: ag.map((a) => ({ cod: a, nombre: K.AGLOS[a] || String(a) })) };
    }
    out.regiones = { nombres: K.TERR, datos: tabla(terr, Object.keys(K.TERR).map(Number)), composicion: comp };
    out.aglomerados = { nombres: K.AGLOS, datos: tabla(d.AGL, Object.keys(K.AGLOS).map(Number)) };
    out.deciles = tabla(d.DEC, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Seguridad jurídica / tenencia
    const ten = {};
    for (const p of periodos) {
      const idx = byPer.get(p).filter((i) => !isNaN(d.II7[i]));
      const tot = idx.reduce((a, i) => a + w[i], 0);
      const fila = {};
      for (const c of Object.keys(K.TENENCIA)) {
        const m = idx.filter((i) => d.II7[i] === +c);
        fila[c] = {
          pct: tot > 0 ? 100 * m.reduce((a, i) => a + w[i], 0) / tot : NaN,
          ich: m.length >= 15 ? wmean(m.map((i) => ichF[i]), m.map((i) => w[i])) : NaN,
        };
      }
      ten[plabel(p, anual)] = fila;
    }
    let hayII7 = false;
    for (let i = 0; i < n; i++) if (!isNaN(d.II7[i])) { hayII7 = true; break; }
    out.tenencia = { nombres: K.TENENCIA, datos: ten, disponible: hayII7 };
    const pn = {};
    for (const k of DIMS) pn[k] = act.includes(k) ? pesos[k] / wsum : 0;
    out.info = { hogares: n, pesos_norm: pn };
    return out;
  };

  // ---------------------------------------------------------------------------
  // Datos sintéticos (solo para probar el tablero)
  // ---------------------------------------------------------------------------
  K.demo = function () {
    const R = rng(7), sig = (v) => 1 / (1 + Math.exp(-v));
    const regEff = { 1: .2, 40: -.5, 41: -.8, 42: -.1, 43: .1, 44: .2 };
    const aglReg = { 2: 43, 3: 43, 4: 43, 5: 43, 6: 43, 7: 41, 8: 41, 9: 44, 10: 42, 12: 41, 13: 43, 14: 43, 15: 41, 17: 44, 18: 40, 19: 40, 20: 44, 22: 40, 23: 40, 25: 40, 26: 42, 27: 42, 29: 40, 30: 43, 31: 44, 32: 1, 33: 1, 34: 43, 36: 43, 38: 43, 91: 44, 93: 44 };
    const aglos = Object.keys(aglReg).map(Number);
    const parts = new Map();
    for (let y = 2017; y <= 2026; y++) {
      for (let q = 1; q <= 2; q++) {
        const n = 2200, df = {};
        const names = ["CODUSU", "ANO4", "TRIMESTRE", "REALIZADA", "PONDERA", "IX_TOT", "IV3", "IV4", "IV5", "IV6", "IV7", "IV8", "IV9", "IV10", "IV11", "IV12_1", "IV12_2", "IV12_3", "II1", "II8", "II9", "II7", "REGION", "AGLOMERADO", "DECIFR"];
        for (const nm of names) df[nm] = new Float64Array(n);
        const tr = (y - 2017) * 0.06 - (y === 2020 ? 0.15 : 0);
        for (let i = 0; i < n; i++) {
          const a = aglos[R.int(0, aglos.length)], reg = aglReg[a];
          const z = R.normal() + regEff[reg];
          const p = (b, c = 0) => sig(c + b * z + tr);
          const pick = (pg, good, mid, bad) => (R.next() < pg ? good : (R.next() < .6 ? mid : bad));
          df.CODUSU[i] = root.Common.hash53(`D${y}-${R.int(0, n / 2)}`);
          df.ANO4[i] = y; df.TRIMESTRE[i] = q; df.REALIZADA[i] = 1; df.PONDERA[i] = R.int(150, 1200);
          df.IV3[i] = pick(p(1.1, 1.2), 1, 2, 3);
          df.IV4[i] = R.next() < p(.9, 1.0) ? R.choice([1, 3, 9]) : R.choice([2, 4, 5, 6, 7], [.2, .3, .3, .1, .1]);
          df.IV5[i] = R.next() < p(.8, .6) ? 1 : 2;
          df.IV6[i] = pick(p(1.2, 2.0), 1, 2, 3);
          df.IV7[i] = R.next() < p(1.0, 1.8) ? 1 : R.choice([2, 3, 4], [.5, .3, .2]);
          df.IV8[i] = R.next() < p(.6, 3.6) ? 1 : 2;
          df.IV9[i] = pick(p(1.0, 2.0), 1, 2, 3);
          df.IV10[i] = pick(p(1.0, 2.0), 1, 2, 3);
          df.IV11[i] = R.next() < p(1.2, 0.2) ? 1 : R.choice([2, 3, 4], [.55, .35, .1]);
          df.II9[i] = R.next() < p(.8, 1.8) ? 1 : R.choice([2, 3], [.7, .3]);
          df.IV12_1[i] = R.next() < p(-.7, -1.4) ? 1 : 2;
          df.IV12_2[i] = R.next() < p(-.7, -1.4) ? 1 : 2;
          df.IV12_3[i] = R.next() < p(-.7, -1.4) ? 1 : 2;
          df.II1[i] = Math.min(8, Math.max(1, Math.round(2.6 + .5 * z + R.normal())));
          df.IX_TOT[i] = Math.min(10, Math.max(1, Math.round(3.4 - .3 * z + R.normal(0, 1.4))));
          df.II8[i] = R.next() < p(1.0, 0.7) ? 1 : R.choice([2, 3], [.8, .2]);
          df.II7[i] = R.next() < p(.8, .4) ? R.choice([1, 2], [.93, .07]) : R.choice([3, 4, 5, 6, 7, 8, 9], [.5, .04, .04, .22, .12, .04, .04]);
          df.DECIFR[i] = Math.min(10, Math.max(1, Math.floor(sig(z * 1.4) * 10) + 1));
          df.REGION[i] = reg; df.AGLOMERADO[i] = a;
          if (df.IV8[i] === 2) { df.IV9[i] = NaN; df.IV10[i] = NaN; df.IV11[i] = NaN; df.II9[i] = 4; }
        }
        for (const [per, sub] of K.splitPeriods(df)) parts.set(per, K.procesar(sub));
      }
    }
    return parts;
  };

  root.IchCore = K;
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})(typeof self !== "undefined" ? self : globalThis);
