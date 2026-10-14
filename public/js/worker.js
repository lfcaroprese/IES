/* Web Worker: lee las bases, las guarda en IndexedDB y hace todos los cálculos.
   La página le habla con js/api.js (mismos "endpoints" que tenía la versión con servidor). */
importScripts("common.js", "parse.js", "store.js", "ich-core.js", "lab-core.js", "../vendor/xlsx.full.min.js");

const { clean } = Common;
const SCHEMA = 1;

const MODS = {
  ich: { core: IchCore, real: new Map(), meta: new Map(), demoParts: null, cache: null, cacheKey: null },
  lab: { core: LabCore, real: new Map(), meta: new Map(), demoParts: null, cache: null, cacheKey: null },
};
let storeOk = false;
const warnings = [];

const progress = (id, text) => self.postMessage({ id, progress: text });

const ready = (async () => {
  storeOk = await Store.available();
  if (!storeOk) { warnings.push("Este navegador no permite guardar datos (IndexedDB): se pierden al cerrar la pestaña."); return; }
  for (const mod of Object.keys(MODS)) {
    const M = MODS[mod];
    let recs = [];
    try { recs = await Store.loadModule(mod); } catch (e) { warnings.push(`No pude leer los datos guardados de ${mod}: ${e.message}`); }
    for (const r of recs) {
      try {
        const cols = {};
        for (const k of Object.keys(r.cols)) cols[k] = Float64Array.from(r.cols[k]);
        M.real.set(r.per, M.core.procesar(cols));
        M.meta.set(r.per, { archivo: r.archivo, fecha: r.fecha });
      } catch (e) { warnings.push(`El período ${r.per} guardado no se pudo cargar: ${e.message}`); }
    }
  }
})();

function active(M) { return M.demoParts || M.real; }
function combined(M) {
  const parts = active(M);
  const key = (M.demoParts ? "d" : "r") + [...parts.keys()].sort().join(",") + "|" + [...parts.values()].reduce((a, p) => a + p.n, 0);
  if (M.cacheKey !== key) { M.cache = M.core.combine([...parts.keys()].sort((a, b) => a - b).map((k) => parts.get(k))); M.cacheKey = key; }
  return M.cache;
}
const invalidate = (M) => { M.cache = null; M.cacheKey = null; };

async function doUpload(mod, files, id) {
  const M = MODS[mod];
  if (M.demoParts) { M.demoParts = null; invalidate(M); }   // al subir datos reales se descarta el ejemplo
  const msgs = [];
  for (const f of files) {
    try {
      progress(id, `Leyendo ${f.name}…`);
      const df = await Parse.parseFile(f, M.core.WANTED);
      const per = M.core.splitPeriods(df);
      let total = 0;
      for (const [p, raw] of per) {
        progress(id, `Procesando ${f.name} · período ${p}…`);
        const part = M.core.procesar(raw);   // valida y aplica filtros
        if (!part.n) continue;
        total += part.n;
        M.real.set(p, part);
        const cols = {};
        for (const k of Object.keys(raw)) cols[k] = k === "CODUSU" ? raw[k] : Float32Array.from(raw[k]);
        const rec = { mod, per: p, cols, n: raw.ANO4.length, archivo: f.name, fecha: new Date().toISOString(), schema: SCHEMA };
        M.meta.set(p, { archivo: f.name, fecha: rec.fecha });
        if (storeOk) await Store.put(`${mod}:${p}`, rec);
      }
      invalidate(M);
      msgs.push(total ? { archivo: f.name, ok: true, msg: `${total.toLocaleString("es-AR")} ${mod === "ich" ? "hogares" : "personas"}` }
        : { archivo: f.name, ok: false, msg: mod === "ich" ? "sin hogares con entrevista realizada" : "sin filas válidas" });
    } catch (e) { msgs.push({ archivo: f.name, ok: false, msg: e.message }); }
  }
  return msgs;
}

async function doReset(mod) {
  const M = MODS[mod];
  M.real = new Map(); M.meta = new Map(); M.demoParts = null; invalidate(M);
  if (storeOk) await Store.clearModule(mod);
}

const common = (mod) => {
  const M = MODS[mod];
  return { demo: !!M.demoParts, guardado: storeOk && !M.demoParts && M.real.size > 0, almacenamiento: storeOk, avisos: warnings.slice() };
};
const ichEstado = () => ({ periodos: IchCore.resumenCarga(combined(MODS.ich)), ...common("ich") });
const labEstado = () => ({ ...LabCore.resumen(combined(MODS.lab), !!MODS.lab.demoParts), ...common("lab") });

function cuadros(buffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  const nombres = wb.SheetNames;
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const pick = nombres.filter((n) => ["1.1", "3.2", "1,1", "3,2", "1_1", "3_2"].some((t) => norm(n).includes(t)));
  const txt = (x) => (x === "" || x === null || x === undefined ? "" : typeof x === "number" ? String(Number(x.toFixed(4))) : String(x).trim());
  const tablas = pick.slice(0, 4).map((n) => {
    let rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" });
    rows = rows.filter((r) => r.some((c) => c !== "" && c !== null));
    const width = Math.max(0, ...rows.map((r) => r.length));
    const keepCol = [];
    for (let c = 0; c < width; c++) if (rows.some((r) => r[c] !== "" && r[c] !== undefined && r[c] !== null)) keepCol.push(c);
    return { hoja: n, filas: rows.slice(0, 90).map((r) => keepCol.map((c) => txt(r[c]))) };
  });
  return { hojas: nombres, tablas };
}

const HANDLERS = {
  "/api/estado": async () => ichEstado(),
  "/api/upload": async (p, id) => { const archivos = await doUpload("ich", p.files, id); return { archivos, ...ichEstado() }; },
  "/api/reset": async () => { await doReset("ich"); return ichEstado(); },
  "/api/demo": async (p, id) => { progress(id, "Generando datos de ejemplo…"); MODS.ich.demoParts = IchCore.demo(); invalidate(MODS.ich); return ichEstado(); },
  "/api/compute": async (p, id) => { progress(id, "Calculando…"); return clean(IchCore.compute(combined(MODS.ich), p)); },

  "/api/lab/estado": async () => ({ ...labEstado(), aglos: LabCore.AGLOS }),
  "/api/lab/upload": async (p, id) => { const archivos = await doUpload("lab", p.files, id); return { archivos, ...labEstado() }; },
  "/api/lab/reset": async () => { await doReset("lab"); return labEstado(); },
  "/api/lab/demo": async (p, id) => { progress(id, "Generando datos de ejemplo…"); MODS.lab.demoParts = LabCore.demo(); invalidate(MODS.lab); return labEstado(); },
  "/api/lab/compute": async (p, id) => { progress(id, "Calculando (con intervalos puede tardar unos segundos)…"); return clean(LabCore.compute(combined(MODS.lab), p)); },
  "/api/lab/cuadros": async (p) => cuadros(await p.file.arrayBuffer()),
};

self.onmessage = async (ev) => {
  const { id, url, payload } = ev.data;
  try {
    await ready;
    const h = HANDLERS[url];
    if (!h) throw new Error("operación desconocida: " + url);
    self.postMessage({ id, result: await h(payload || {}, id) });
  } catch (e) {
    self.postMessage({ id, result: { error: e.message || String(e) } });
  }
};
