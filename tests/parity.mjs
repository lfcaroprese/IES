// Compara los resultados del núcleo JavaScript contra los de la versión Python de referencia.
// Uso: node tests/parity.mjs DIR_FIXTURE   (DIR generado por gen_fixture.py)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const js = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../public/js");
const Common = require(js + "/common.js"), Parse = require(js + "/parse.js"), Ich = require(js + "/ich-core.js"), Lab = require(js + "/lab-core.js");
const dir = process.argv[2];
const bad = [];
let checked = 0;

const near = (a, b, tol = 1e-8) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
function pairCheck(p, lo, hi, glo, ghi) {
  if (lo == null || hi == null) { return; }
  if (glo == null || ghi == null) { bad.push(`${p}: CI ausente en JS`); return; }
  const we = hi - lo, wg = ghi - glo; checked++;
  if (we < 1e-12 && wg < 1e-12) return;
  const ratio = wg / we, mid = Math.abs((glo + ghi) / 2 - (lo + hi) / 2);
  if (ratio < 0.65 || ratio > 1.55 || mid > 0.4 * we) bad.push(`${p}: IC esperado [${lo.toFixed(4)},${hi.toFixed(4)}] obtenido [${glo.toFixed(4)},${ghi.toFixed(4)}]`);
}
function walk(e, g, p) {
  if (e === null || e === undefined) { if (g !== null && g !== undefined) bad.push(`${p}: esperado null, obtenido ${g}`); checked++; return; }
  if (typeof e === "number") {
    checked++;
    if (typeof g !== "number" || !near(e, g)) bad.push(`${p}: esperado ${e}, obtenido ${g}`);
    return;
  }
  if (typeof e === "string" || typeof e === "boolean") { checked++; if (e !== g) bad.push(`${p}: esperado ${e}, obtenido ${g}`); return; }
  if (Array.isArray(e)) {
    if (!Array.isArray(g) || g.length !== e.length) { bad.push(`${p}: largo ${g && g.length} vs ${e.length}`); return; }
    e.forEach((v, i) => walk(v, g[i], `${p}[${i}]`));
    return;
  }
  if (!g || typeof g !== "object") { bad.push(`${p}: falta objeto`); return; }
  const skip = new Set();
  for (const k of Object.keys(e)) {
    const pairs = [["lo", "hi"]];
    if (k.endsWith("_lo")) pairs.push([k, k.slice(0, -3) + "_hi"]);
    const pr = pairs.find(([a, b]) => a === k && b in e);
    if (pr) {
      const [a, b] = pr; skip.add(a); skip.add(b);
      const E1 = e[a], E2 = e[b], G1 = g[a], G2 = g[b];
      if (Array.isArray(E1)) E1.forEach((v, i) => pairCheck(`${p}.${a}[${i}]`, v, E2[i], G1 && G1[i], G2 && G2[i]));
      else pairCheck(`${p}.${a}`, E1, E2, G1, G2);
    }
  }
  for (const k of Object.keys(e)) {
    if (skip.has(k) || k === "lo" || k === "hi") continue;
    if (!(k in g) && e[k] !== null) bad.push(`${p}.${k}: clave ausente en JS`);
    else walk(e[k], g[k], `${p}.${k}`);
  }
}

function load(file, wanted) { return Parse.parseText(fs.readFileSync(path.join(dir, file), "latin1"), wanted); }
function report(name, t0) { console.log(`${name}: ${bad.length ? "FALLA" : "ok"} (${((performance.now() - t0) / 1000).toFixed(1)} s)`); }

// ---- ICH
let t0 = performance.now();
let df = load("hogar.csv", Ich.WANTED);
let parts = [...Ich.splitPeriods(df)].map(([, raw]) => Ich.procesar(raw));
let full = Ich.combine(parts);
const ichCases = JSON.parse(fs.readFileSync(path.join(dir, "ich_expected.json")));
ichCases.forEach((c, i) => {
  const got = Common.clean(Ich.compute(full, c.body));
  const before = bad.length;
  walk(c.out, got, `ich[${i}]`);
  console.log(`  caso ICH ${i}: ${bad.length === before ? "ok" : bad.length - before + " diferencias"}`);
});
report("ICH", t0);

// ---- Laboral
t0 = performance.now();
df = load("personas.csv", Lab.WANTED);
parts = [...Lab.splitPeriods(df)].map(([, raw]) => Lab.procesar(raw));
full = Lab.combine(parts);
const labCases = JSON.parse(fs.readFileSync(path.join(dir, "lab_expected.json")));
labCases.forEach((c, i) => {
  const t1 = performance.now();
  const got = Common.clean(Lab.compute(full, c.body));
  const before = bad.length;
  walk(c.out, got, `lab[${i}]`);
  console.log(`  caso laboral ${i}: ${bad.length === before ? "ok" : bad.length - before + " diferencias"} (${((performance.now() - t1) / 1000).toFixed(1)} s)`);
});
report("Laboral", t0);

console.log(`\nValores comparados: ${checked}. Diferencias: ${bad.length}`);
bad.slice(0, 25).forEach((b) => console.log("  -", b));
process.exit(bad.length ? 1 : 0);
