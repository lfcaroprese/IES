/* Mercado laboral (EPH, base Personas / usu_individual). Port a JavaScript de reference/laboral.py.

   Tasas (criterio INDEC, ponderadas con PONDERA):
     actividad    = PEA / población total          PEA = ESTADO 1 o 2
     empleo       = ocupados / población total     ocupados = ESTADO 1
     desocupación = desocupados / PEA              desocupados = ESTADO 2
     subocupación = subocupados / PEA              subocupados = ESTADO 1 e INTENSI 1
     sub. demandante    = subocupados con PP03J = 1 / PEA
     sub. no demandante = (subocupados - demandantes) / PEA  (incluye PP03J = 2, 9 y faltantes)
*/
(function (root) {
  const { percentile, factorize, concat, rng } = root.Common;
  const L = {};

  L.AGLOS = { 2: "Gran La Plata", 3: "Bahía Blanca-Cerri", 4: "Gran Rosario", 5: "Gran Santa Fe", 6: "Gran Paraná", 7: "Posadas", 8: "Gran Resistencia", 9: "Comodoro Rivadavia-Rada Tilly", 10: "Gran Mendoza", 12: "Corrientes", 13: "Gran Córdoba", 14: "Concordia", 15: "Formosa", 17: "Neuquén-Plottier", 18: "Santiago del Estero-La Banda", 19: "Jujuy-Palpalá", 20: "Río Gallegos", 22: "Gran Catamarca", 23: "Gran Salta", 25: "La Rioja", 26: "Gran San Luis", 27: "Gran San Juan", 29: "Gran Tucumán-Tafí Viejo", 30: "Santa Rosa-Toay", 31: "Ushuaia-Río Grande", 32: "Ciudad Autónoma de Buenos Aires", 33: "Partidos del GBA", 34: "Mar del Plata", 36: "Río Cuarto", 38: "San Nicolás-Villa Constitución", 91: "Rawson-Trelew", 93: "Viedma-Carmen de Patagones" };
  L.REQ = ["CODUSU", "ANO4", "TRIMESTRE", "AGLOMERADO", "PONDERA", "ESTADO", "INTENSI", "PP03J"];
  L.OPT = ["EMPLEO", "SECTOR", "PP02E", "PP02A", "PP02B"];
  L.WANTED = L.REQ.concat(["EMPLEO", "PP02E", "PP02A"]);
  const IND = ["pob", "pea", "ocu", "des", "sub", "subdem", "subnodem", "plen", "sobre", "notrab", "inact", "desm", "formal", "informal", "emp_valid"];
  const RATE_KEYS = ["act", "emp", "des", "sub", "subdem", "subnodem", "sub_ocu", "plen_ocu", "sobre_ocu", "notrab_ocu", "informal_ocu", "emp_formal", "emp_informal", "desm_pob", "desm_inact", "act_amp", "des_amp", "emp_pleno", "brecha_emp", "emp_pleno_amp", "brecha_emp_amp", "identidad"];
  L.IND = IND; L.RATE_KEYS = RATE_KEYS;

  const gather = (df, idx) => {
    const o = {};
    for (const name of Object.keys(df)) { const a = df[name], r = new Float64Array(idx.length); for (let j = 0; j < idx.length; j++) r[j] = a[idx[j]]; o[name] = r; }
    return o;
  };

  /** Divide la base leída por período. No filtra nada más: eso lo hace procesar(). */
  L.splitPeriods = function (df) {
    const faltan = L.REQ.filter((c) => !df[c]);
    if (faltan.length) throw new Error("faltan columnas de la base Personas: " + faltan.join(", ") + " (¿subiste la base Hogar por error?)");
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

  /** Descarta filas sin aglomerado, ponderador o ESTADO y arma la parte lista para calcular. */
  L.procesar = function (rawAll) {
    const m = rawAll.ANO4.length, keep = [];
    for (let i = 0; i < m; i++) {
      if (isNaN(rawAll.AGLOMERADO[i]) || isNaN(rawAll.PONDERA[i]) || isNaN(rawAll.ESTADO[i])) continue;
      keep.push(i);
    }
    const raw = keep.length === m ? rawAll : gather(rawAll, keep);
    const n = raw.ANO4.length, nan = () => new Float64Array(n).fill(NaN);
    const part = {
      n, COD: raw.CODUSU, ANO4: raw.ANO4, TRIM: raw.TRIMESTRE, AGL: raw.AGLOMERADO, W: raw.PONDERA, ESTADO: raw.ESTADO,
      INTENSI: raw.INTENSI, PP03J: raw.PP03J, EMPLEO: raw.EMPLEO || nan(), PP02E: raw.PP02E || nan(), PP02A: raw.PP02A || nan(),
    };
    part.PER = new Float64Array(n);
    for (let i = 0; i < n; i++) part.PER[i] = part.ANO4[i] * 10 + part.TRIM[i];
    return part;
  };

  const FIELDS = ["COD", "ANO4", "TRIM", "AGL", "W", "ESTADO", "INTENSI", "PP03J", "EMPLEO", "PP02E", "PP02A", "PER"];
  L.combine = function (parts) {
    if (!parts.length) return null;
    const d = {};
    for (const f of FIELDS) d[f] = concat(parts.map((p) => p[f]), Float64Array);
    d.n = d.PER.length;
    return d;
  };

  const anyFinite = (a) => { for (let i = 0; i < a.length; i++) if (!isNaN(a[i])) return true; return false; };

  L.resumen = function (d, demo) {
    if (!d) return { periodos: [], demo, tiene_empleo: false, tiene_desm: false };
    const m = new Map();
    for (let i = 0; i < d.n; i++) m.set(d.PER[i], (m.get(d.PER[i]) || 0) + 1);
    return {
      periodos: [...m.keys()].sort((a, b) => a - b).map((p) => ({ periodo: `${p % 10}T${Math.floor(p / 10)}`, personas: m.get(p) })),
      demo, tiene_empleo: anyFinite(d.EMPLEO), tiene_desm: anyFinite(d.PP02E),
    };
  };

  /** Indicadores ponderados: IND.length columnas, cada una con W * (0|1). */
  function indicadores(d, desmDisp) {
    const n = d.n, X = IND.map(() => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      const e = d.ESTADO[i], it = d.INTENSI[i], pj = d.PP03J[i], emp = d.EMPLEO[i], w = d.W[i];
      const ocu = e === 1, des = e === 2, ina = e === 3;
      const sub = ocu && it === 1, subdem = sub && pj === 1;
      const disp = desmDisp ? (d.PP02A[i] === 1 || d.PP02A[i] === 2) : true;
      const v = [true, ocu || des, ocu, des, sub, subdem, sub && !subdem, ocu && it === 2, ocu && it === 3, ocu && it === 4, ina,
        ina && d.PP02E[i] === 3 && disp, ocu && emp === 1, ocu && emp === 2, ocu && (emp === 1 || emp === 2)];
      for (let j = 0; j < IND.length; j++) if (v[j]) X[j][i] = w;
    }
    return X;
  }

  /** S: sumas ponderadas por indicador (objeto). Devuelve tasas en %. */
  function tasas(S, ustar) {
    const pob = S.pob, pea = S.pea, ocu = S.ocu;
    const r = {
      act: 100 * pea / pob, emp: 100 * ocu / pob, des: 100 * S.des / pea,
      sub: 100 * S.sub / pea, subdem: 100 * S.subdem / pea, subnodem: 100 * S.subnodem / pea,
      sub_ocu: 100 * S.sub / ocu, plen_ocu: 100 * S.plen / ocu, sobre_ocu: 100 * S.sobre / ocu, notrab_ocu: 100 * S.notrab / ocu,
      informal_ocu: 100 * S.informal / S.emp_valid,
      emp_formal: 100 * S.formal / pob, emp_informal: 100 * S.informal / pob,
      desm_pob: 100 * S.desm / pob, desm_inact: 100 * S.desm / S.inact,
      act_amp: 100 * (pea + S.desm) / pob,
      des_amp: 100 * (S.des + S.desm) / (pea + S.desm),
    };
    r.emp_pleno = r.act * (1 - ustar / 100);
    r.brecha_emp = r.emp_pleno - r.emp;
    r.emp_pleno_amp = r.act_amp * (1 - ustar / 100);
    r.brecha_emp_amp = r.emp_pleno_amp - r.emp;
    r.identidad = r.act * (1 - r.des / 100) - r.emp;
    return r;
  }
  L.tasas = tasas;

  /** Si la tasa de desmotivados se hubiera mantenido en el nivel base y fueran desocupados. */
  function contrafactual(rt, rb) {
    const dd = rt.desm_pob - rb.desm_pob;
    const actCf = rt.act + dd;
    return { dd, act_cf: actCf, des_cf: 100 * (rt.des / 100 * rt.act + dd) / actCf };
  }

  const fin = (v) => isFinite(v);
  const ciOf = (vals) => { const lo = percentile(vals, 2.5), hi = percentile(vals, 97.5); return [isNaN(lo) ? null : lo, isNaN(hi) ? null : hi]; };

  L.compute = function (full, b) {
    if (!full) return { error: "No hay datos cargados." };
    const trims = (b.trimestres && b.trimestres.length ? b.trimestres : [1]).map(Number);
    const anual = (b.agregacion || "anio") === "anio";
    const ustar = b.ustar == null ? 5 : +b.ustar;
    const B = b.boot == null ? 200 : Math.trunc(+b.boot);
    const sel = (b.aglos || []).map(Number);
    const separado = !!b.separado;
    const base = b.base || "yoy";
    const R = rng(42);

    const keep = [];
    for (let i = 0; i < full.n; i++) if (trims.includes(full.TRIM[i])) keep.push(i);
    if (!keep.length) return { error: "No hay datos para los trimestres elegidos." };
    const d = { n: keep.length };
    for (const f of FIELDS) { const a = full[f], r = new Float64Array(keep.length); for (let j = 0; j < keep.length; j++) r[j] = a[keep[j]]; d[f] = r; }
    const n = d.n, perQ = d.PER;
    const key = anual ? d.ANO4 : perQ;
    const keys = [...new Set(key)].sort((a, c) => a - c);
    const lab = keys.map((k) => (anual ? String(k) : `${k % 10}T${Math.floor(k / 10)}`));
    const nq = new Map(keys.map((k) => [k, new Set()]));
    for (let i = 0; i < n; i++) nq.get(key[i]).add(perQ[i]);
    const nqn = (k) => nq.get(k).size;
    const X = indicadores(d, !!b.desm_disp);
    const ag = d.AGL, clus = d.COD;
    const aglPresent = new Set(ag);

    const groups = [["total", "Total 31 aglomerados", () => true]];
    const selSet = new Set(sel);
    const sameSet = sel.length === aglPresent.size && sel.every((a) => aglPresent.has(a));
    if (sel.length && !sameSet && sel.length < Object.keys(L.AGLOS).length) {
      const nombre = sel.length === 1 ? (L.AGLOS[sel[0]] || String(sel[0])) : `Selección (${sel.length} aglomerados)`;
      groups.push(["sel", nombre, (i) => selSet.has(ag[i])]);
      if (separado && sel.length > 1) for (const a of sel) groups.push([`a${a}`, L.AGLOS[a] || String(a), (i) => ag[i] === a]);
    } else if (sel.length && separado) {
      for (const a of [...aglPresent].sort((x, y) => x - y)) groups.push([`a${a}`, L.AGLOS[a] || String(a), (i) => ag[i] === a]);
    }
    const doBootAll = groups.length <= 12;

    // índices por período
    const idxByKey = new Map(keys.map((k) => [k, []]));
    for (let i = 0; i < n; i++) idxByKey.get(key[i]).push(i);

    const series = {}, ci = {}, niveles = {}, casos = {}, boots = new Map();
    for (const [gid, , inG] of groups) {
      series[gid] = {}; ci[gid] = {}; niveles[gid] = {}; casos[gid] = [];
      RATE_KEYS.forEach((k) => { series[gid][k] = []; ci[gid][k] = { lo: [], hi: [] }; });
      IND.forEach((k) => (niveles[gid][k] = []));
      for (const k_ of keys) {
        const idx = idxByKey.get(k_).filter(inG);
        casos[gid].push(idx.length);
        if (!idx.length) {
          RATE_KEYS.forEach((k) => { series[gid][k].push(null); ci[gid][k].lo.push(null); ci[gid][k].hi.push(null); });
          IND.forEach((k) => niveles[gid][k].push(null));
          boots.set(gid + "|" + k_, null);
          continue;
        }
        const S = {}, nqk = nqn(k_);
        IND.forEach((name, j) => { let s = 0; for (const i of idx) s += X[j][i]; S[name] = s / nqk; });
        const r = tasas(S, ustar);
        RATE_KEYS.forEach((k) => series[gid][k].push(r[k]));
        IND.forEach((name) => niveles[gid][name].push(S[name] / 1000));
        if (B > 0 && (doBootAll || gid === "total" || gid === "sel")) {
          const { codes, n: nc } = factorize(clus, idx);
          const nj = IND.length, M = new Float64Array(nc * nj);
          for (let t = 0; t < idx.length; t++) { const c = codes[t] * nj; for (let j = 0; j < nj; j++) M[c + j] += X[j][idx[t]]; }
          const rb = {};
          RATE_KEYS.forEach((k) => (rb[k] = new Float64Array(B)));
          const acc = new Float64Array(nj), Sb = {};
          for (let rep = 0; rep < B; rep++) {
            acc.fill(0);
            for (let t = 0; t < nc; t++) { const c = Math.floor(R.next() * nc) * nj; for (let j = 0; j < nj; j++) acc[j] += M[c + j]; }
            for (let j = 0; j < nj; j++) Sb[IND[j]] = acc[j];
            const q = tasas(Sb, ustar);
            for (const k of RATE_KEYS) rb[k][rep] = q[k];
          }
          boots.set(gid + "|" + k_, rb);
          for (const k of RATE_KEYS) { const [lo, hi] = ciOf(rb[k]); ci[gid][k].lo.push(lo); ci[gid][k].hi.push(hi); }
        } else {
          boots.set(gid + "|" + k_, null);
          RATE_KEYS.forEach((k) => { ci[gid][k].lo.push(null); ci[gid][k].hi.push(null); });
        }
      }
    }

    // Variaciones respecto de un período base
    const baseIdx = (i) => {
      if (base === "first") return i !== 0 ? 0 : null;
      if (base === "yoy") { const tgt = keys[i] - (anual ? 1 : 10); const j = keys.indexOf(tgt); return j >= 0 ? j : null; }
      const j = lab.indexOf(base);
      return j >= 0 && j !== i ? j : null;
    };
    const yoy = {}, cf = {};
    for (const [gid] of groups) {
      yoy[gid] = {};
      RATE_KEYS.filter((k) => k !== "identidad").forEach((k) => (yoy[gid][k] = { dif: [], lo: [], hi: [], base: [] }));
      cf[gid] = { dd: [], act_cf: [], des_cf: [], pea_desm_miles: [], act_cf_lo: [], act_cf_hi: [], des_cf_lo: [], des_cf_hi: [], dd_lo: [], dd_hi: [] };
      for (let i = 0; i < keys.length; i++) {
        const j = baseIdx(i);
        const ok = j !== null && series[gid].act[i] != null && series[gid].act[j] != null;
        for (const k of Object.keys(yoy[gid])) {
          const Y = yoy[gid][k];
          if (!ok) { Y.dif.push(null); Y.lo.push(null); Y.hi.push(null); Y.base.push(null); continue; }
          const a = series[gid][k][i], bb = series[gid][k][j];
          Y.dif.push(a == null || bb == null ? null : a - bb);
          Y.base.push(lab[j]);
          const bt = boots.get(gid + "|" + keys[i]), bb_ = boots.get(gid + "|" + keys[j]);
          if (bt && bb_) {
            const dv = new Float64Array(B);
            for (let r = 0; r < B; r++) dv[r] = bt[k][r] - bb_[k][r];
            const [lo, hi] = ciOf(dv); Y.lo.push(lo); Y.hi.push(hi);
          } else { Y.lo.push(null); Y.hi.push(null); }
        }
        const C = cf[gid];
        if (!ok) { for (const k of Object.keys(C)) C[k].push(null); continue; }
        const pick = (g, jj) => ({ act: series[g].act[jj], des: series[g].des[jj], desm_pob: series[g].desm_pob[jj] });
        const c = contrafactual(pick(gid, i), pick(gid, j));
        const pobm = niveles[gid].pob[i];
        C.dd.push(c.dd); C.act_cf.push(c.act_cf); C.des_cf.push(c.des_cf); C.pea_desm_miles.push(c.dd / 100 * pobm);
        const bt = boots.get(gid + "|" + keys[i]), bb_ = boots.get(gid + "|" + keys[j]);
        if (bt && bb_) {
          const pk = ["act", "des", "desm_pob"], vecs = { dd: new Float64Array(B), act_cf: new Float64Array(B), des_cf: new Float64Array(B) };
          for (let r = 0; r < B; r++) {
            const rt = {}, rbb = {};
            pk.forEach((k) => { rt[k] = bt[k][r]; rbb[k] = bb_[k][r]; });
            const cb = contrafactual(rt, rbb);
            vecs.dd[r] = cb.dd; vecs.act_cf[r] = cb.act_cf; vecs.des_cf[r] = cb.des_cf;
          }
          for (const kk of ["dd", "act_cf", "des_cf"]) { const [lo, hi] = ciOf(vecs[kk]); C[kk + "_lo"].push(lo); C[kk + "_hi"].push(hi); }
        } else for (const kk of ["dd", "act_cf", "des_cf"]) { C[kk + "_lo"].push(null); C[kk + "_hi"].push(null); }
      }
    }

    // Territorio: todos los aglomerados, solo valores puntuales
    const terr = {};
    const cell = new Map();
    for (let i = 0; i < n; i++) {
      const id = key[i] + "|" + ag[i];
      let c = cell.get(id);
      if (!c) { c = { k: key[i], a: ag[i], s: new Float64Array(IND.length), casos: 0 }; cell.set(id, c); }
      for (let j = 0; j < IND.length; j++) c.s[j] += X[j][i];
      c.casos++;
    }
    for (const c of cell.values()) {
      const S = {}, nqk = nqn(c.k);
      IND.forEach((name, j) => (S[name] = c.s[j] / nqk));
      const r = tasas(S, ustar), rec = {};
      for (const k of RATE_KEYS) rec[k] = r[k];
      IND.forEach((name) => (rec["n_" + name] = S[name] / 1000));
      rec.casos = c.casos;
      const lb = lab[keys.indexOf(c.k)];
      (terr[lb] = terr[lb] || {})[c.a] = rec;
    }

    return {
      periodos: lab, anual, grupos: groups.map(([id, label]) => ({ id, label })),
      series, ci, niveles, casos, yoy, cf, territorio: terr, aglos: L.AGLOS, ustar,
      trims_por_periodo: keys.map(nqn), tiene_empleo: anyFinite(d.EMPLEO), tiene_desm: anyFinite(d.PP02E),
    };
  };

  // ---------------------------------------------------------------------------
  // Datos sintéticos
  // ---------------------------------------------------------------------------
  L.demo = function () {
    const R = rng(11), ags = Object.keys(L.AGLOS).map(Number);
    const u = (a, b) => a + (b - a) * R.next();
    const a0 = {}, u0 = {}, inf0 = {};
    ags.forEach((a) => { a0[a] = u(.44, .53); u0[a] = u(.04, .09); inf0[a] = u(.30, .50); });
    const parts = new Map();
    for (let y = 2017; y <= 2026; y++) {
      const t = y - 2017;
      for (let q = 1; q <= 2; q++) {
        const cols = {}; const rows = [];
        for (const a of ags) {
          const nh = R.int(110, 190), act = a0[a] + 0.002 * t - (y === 2020 ? 0.03 : 0);
          const uu = u0[a] + ((y === 2020 || y === 2021) ? 0.03 : 0) - 0.002 * t;
          const p3 = .05 + ((y >= 2019 && y <= 2021) ? .06 : 0) + .004 * t;
          for (let h = 0; h < nh; h++) {
            const k = R.int(1, 6), code = root.Common.hash53(`P${y}-${a}-${h}`);
            for (let m = 0; m < k; m++) {
              const age = Math.trunc(Math.min(90, Math.max(0, R.gamma(2.2, 17))));
              const pAct = age < 10 ? 0 : age < 18 ? .12 : age > 65 ? .15 : act / .62;
              let estado = age < 10 ? 4 : 3;
              const isact = R.next() < Math.min(Math.max(pAct, 0), .95);
              const des = isact && R.next() < uu;
              if (isact) estado = des ? 2 : 1;
              const ocu = estado === 1;
              let it = NaN, pj = NaN, emp = NaN, pe = NaN, pa = NaN;
              if (ocu) {
                it = R.choice([1, 2, 3, 4], [.10, .60, .27, .03]);
                pj = R.next() < .08 ? 1 : 2;
                if (it === 1) pj = R.choice([1, 2, 9], [.55, .43, .02]);
                emp = R.next() < inf0[a] - 0.004 * t ? 2 : 1;
              }
              if (estado === 3) {
                pe = R.next() < p3 ? 3 : R.choice([1, 2, 4, 5]);
                pa = R.choice([1, 2, 3, 4], [.25, .15, .30, .30]);
              }
              rows.push([code, y, q, a, R.int(250, 900), estado, it, pj, emp, pe, pa]);
            }
          }
        }
        const names = ["CODUSU", "ANO4", "TRIMESTRE", "AGLOMERADO", "PONDERA", "ESTADO", "INTENSI", "PP03J", "EMPLEO", "PP02E", "PP02A"];
        names.forEach((nm, j) => { cols[nm] = Float64Array.from(rows, (r) => r[j]); });
        for (const [per, sub] of L.splitPeriods(cols)) parts.set(per, L.procesar(sub));
      }
    }
    return parts;
  };

  root.LabCore = L;
  if (typeof module !== "undefined" && module.exports) module.exports = L;
})(typeof self !== "undefined" ? self : globalThis);
