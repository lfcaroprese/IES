/* Lectura de bases EPH (.txt/.csv/.xlsx/.xls) quedándose solo con las columnas necesarias.
   Devuelve { COLUMNA: Float64Array }. CODUSU se guarda como hash numérico (ver Common.hash53). */
(function (root) {
  const P = {};
  const norm = (s) => String(s).trim().toUpperCase().replace(/ /g, "");
  const toNum = (s) => {
    if (typeof s === "number") return s;
    if (s === null || s === undefined) return NaN;
    const t = String(s).trim();
    return t === "" ? NaN : Number(t);
  };
  P.norm = norm;

  function splitQuoted(line, sep) {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  /** Texto delimitado. wanted: arreglo de nombres de columna. */
  P.parseText = function (text, wanted) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    let e = text.indexOf("\n");
    if (e < 0) e = text.length;
    const headerLine = text.slice(0, e).replace(/\r$/, "");
    let sep = null, header = null;
    for (const s of [";", ",", "\t"]) {
      const h = splitQuoted(headerLine, s);
      if (h.length > 5) { sep = s; header = h.map(norm); break; }
    }
    if (!sep) throw new Error("no pude interpretar el separador del archivo");
    const want = new Set(wanted);
    const colIdx = []; // [índice en el archivo, nombre]
    header.forEach((h, i) => { if (want.has(h)) colIdx.push([i, h]); });
    const maxIdx = colIdx.length ? Math.max(...colIdx.map((c) => c[0])) : -1;
    const store = {};
    colIdx.forEach(([, h]) => (store[h] = []));
    const pos = new Map(colIdx.map(([i, h]) => [i, h]));
    let n = 0;
    let p = e + 1;
    const L = text.length;
    while (p < L) {
      let q = text.indexOf("\n", p);
      if (q < 0) q = L;
      let end = q;
      if (end > p && text.charCodeAt(end - 1) === 13) end--;
      if (end > p) {
        const line = text.slice(p, end);
        if (line.indexOf('"') >= 0) {
          const f = splitQuoted(line, sep);
          for (const [i, h] of colIdx) store[h].push(i < f.length ? f[i] : "");
        } else {
          let start = 0, idx = 0;
          while (idx <= maxIdx) {
            let nx = line.indexOf(sep, start);
            if (nx < 0) nx = line.length;
            const h = pos.get(idx);
            if (h !== undefined) store[h].push(line.slice(start, nx));
            idx++;
            if (nx >= line.length) break;
            start = nx + 1;
          }
          // fila corta: completar con vacío
          for (const [i, h] of colIdx) if (i >= idx && store[h].length === n) store[h].push("");
        }
        n++;
      }
      p = q + 1;
    }
    return finalize(store, n);
  };

  function finalize(store, n) {
    const out = {};
    for (const h of Object.keys(store)) {
      const raw = store[h];
      const a = new Float64Array(n);
      if (h === "CODUSU") for (let i = 0; i < n; i++) a[i] = root.Common.hash53(String(raw[i]).trim());
      else for (let i = 0; i < n; i++) a[i] = toNum(raw[i]);
      out[h] = a;
    }
    return out;
  }

  /** Excel (.xlsx/.xls) con SheetJS. Une todas las hojas que tengan más de 5 columnas. */
  P.parseExcel = function (buffer, wanted) {
    if (typeof root.XLSX === "undefined") throw new Error("no se cargó el lector de Excel");
    const wb = root.XLSX.read(buffer, { type: "array", dense: true });
    const want = new Set(wanted);
    const store = {};
    let n = 0, any = false;
    for (const name of wb.SheetNames) {
      const rows = root.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
      if (!rows.length || rows[0].length <= 5) continue;
      any = true;
      const header = rows[0].map(norm);
      const cols = [];
      header.forEach((h, i) => { if (want.has(h)) cols.push([i, h]); });
      for (const [, h] of cols) if (!store[h]) store[h] = new Array(n).fill("");
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row.length) continue;
        for (const h of Object.keys(store)) {
          const c = cols.find((x) => x[1] === h);
          store[h].push(c ? row[c[0]] : "");
        }
        n++;
      }
    }
    if (!any) throw new Error("el Excel no tiene ninguna hoja con datos");
    return finalize(store, n);
  };

  /** Lee un File/Blob según su extensión. */
  P.parseFile = async function (file, wanted) {
    const ext = file.name.toLowerCase().split(".").pop();
    const buf = await file.arrayBuffer();
    if (["xlsx", "xlsm", "xls"].includes(ext)) return P.parseExcel(buf, wanted);
    const text = new TextDecoder("windows-1252").decode(buf);
    return P.parseText(text, wanted);
  };

  root.Parse = P;
  if (typeof module !== "undefined" && module.exports) module.exports = P;
})(typeof self !== "undefined" ? self : globalThis);
