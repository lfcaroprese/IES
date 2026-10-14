#!/usr/bin/env python3
"""
Dashboard local del Índice de Calidad Habitacional (ICH) sobre la EPH (base Hogar).

    pip install -r requirements.txt
    python app.py          ->  http://127.0.0.1:5000
"""
import io
import math
import os

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 ** 3
app.json.sort_keys = False

# ----------------------------------------------------------------------------
# Definiciones
# ----------------------------------------------------------------------------
DIMS = ["mat", "agua", "sanea", "hacin", "energ", "entorno", "sjt"]
LABELS = {"mat": "Materiales", "agua": "Agua", "sanea": "Saneamiento", "hacin": "Hacinamiento",
          "energ": "Energía de cocción", "entorno": "Entorno", "sjt": "Seguridad jurídica"}
PESOS_DEFAULT = {"mat": 20, "agua": 15, "sanea": 25, "hacin": 25, "energ": 5, "entorno": 10, "sjt": 0}

REQ = ["CODUSU", "ANO4", "TRIMESTRE", "PONDERA", "IX_TOT", "IV3", "IV4", "IV5", "IV6", "IV7", "IV8",
       "IV9", "IV10", "IV11", "IV12_1", "IV12_2", "IV12_3", "II1", "II8", "II9"]
OPT = ["REALIZADA", "II7", "REGION", "AGLOMERADO", "DECIFR"]

TENENCIA = {1: "Propietario de vivienda y terreno", 2: "Propietario solo de la vivienda",
            3: "Inquilino/arrendatario", 4: "Ocupante por pago de impuestos/expensas",
            5: "Ocupante en relación de dependencia", 6: "Ocupante gratuito (con permiso)",
            7: "Ocupante de hecho (sin permiso)", 8: "En sucesión", 9: "Otra situación"}
SJT_DEFAULT = {1: 1.0, 2: 0.8, 3: 0.6, 4: 0.5, 5: 0.3, 6: 0.3, 7: 0.0, 8: 0.5, 9: 0.3}

REGIONES = {1: "GBA", 40: "Noroeste", 41: "Noreste", 42: "Cuyo", 43: "Pampeana", 44: "Patagonia"}
# En los gráficos el GBA se abre en CABA (aglomerado 32) y Partidos del GBA (aglomerado 33)
TERR = {32: "CABA", 33: "Partidos del GBA", 40: "Noroeste", 41: "Noreste", 42: "Cuyo", 43: "Pampeana", 44: "Patagonia"}
# Respaldo: asignación oficial aglomerado -> región (diseño de registro EPH), si la base no trae REGION
REGION_AGLOS = {1: [32, 33], 40: [18, 19, 22, 23, 25, 29], 41: [7, 8, 12, 15], 42: [10, 26, 27],
                43: [2, 3, 4, 5, 6, 13, 14, 30, 34, 36, 38], 44: [9, 17, 20, 31, 91, 93]}
AGLOS = {2: "Gran La Plata", 3: "Bahía Blanca-Cerri", 4: "Gran Rosario", 5: "Gran Santa Fe", 6: "Gran Paraná",
         7: "Posadas", 8: "Gran Resistencia", 9: "Comodoro Rivadavia-Rada Tilly", 10: "Gran Mendoza",
         12: "Corrientes", 13: "Gran Córdoba", 14: "Concordia", 15: "Formosa", 17: "Neuquén-Plottier",
         18: "Santiago del Estero-La Banda", 19: "Jujuy-Palpalá", 20: "Río Gallegos", 22: "Gran Catamarca",
         23: "Gran Salta", 25: "La Rioja", 26: "Gran San Luis", 27: "Gran San Juan",
         29: "Gran Tucumán-Tafí Viejo", 30: "Santa Rosa-Toay", 31: "Ushuaia-Río Grande",
         32: "CABA", 33: "Partidos del GBA", 34: "Mar del Plata", 36: "Río Cuarto",
         38: "San Nicolás-Villa Constitución", 91: "Rawson-Trelew", 93: "Viedma-Carmen de Patagones"}

STORE = {"parts": {}, "demo": False, "cache": None}


# ----------------------------------------------------------------------------
# Subíndices (0-1) por hogar. Reglas fijas: ver /api/meta
# ----------------------------------------------------------------------------
def num(s):
    return pd.to_numeric(s, errors="coerce")


def subindices(df):
    g = lambda c: num(df[c])
    piso = g("IV3").map({1: 1, 2: .5, 3: 0, 4: .5})
    techo = g("IV4").map({1: 1, 2: .75, 3: 1, 4: .5, 5: .5, 6: 0, 7: 0, 9: 1})
    cielo = pd.Series(np.where(g("IV5") == 2, 0.0, 1.0), index=df.index)
    mat = (piso + techo + cielo) / 3
    agua = (g("IV6").map({1: 1, 2: .5, 3: 0}) + g("IV7").map({1: 1, 2: .5, 3: .25, 4: 0})) / 2
    san = (.2 * g("IV9").map({1: 1, 2: .5, 3: 0}) + .3 * g("IV10").map({1: 1, 2: .5, 3: 0})
           + .3 * g("IV11").map({1: 1, 2: .6, 3: .3, 4: 0}) + .2 * g("II9").map({1: 1, 2: .5, 3: .25, 4: 0}))
    sanea = pd.Series(np.where(g("IV8") == 2, 0.0, san), index=df.index)
    ii1 = g("II1")
    hacin = ((3 - g("IX_TOT") / ii1.where(ii1 > 0)) / 2).clip(0, 1).where(ii1 != 0, 0.0)
    energ = g("II8").map({1: 1, 2: .5, 3: 0, 4: 0})
    iv = [g("IV12_1"), g("IV12_2"), g("IV12_3")]
    ok = pd.concat(iv, axis=1).isin([1, 2]).all(axis=1)
    entorno = (sum((x == 2).astype(float) for x in iv) / 3).where(ok)
    return pd.DataFrame({"mat": mat, "agua": agua, "sanea": sanea, "hacin": hacin,
                         "energ": energ, "entorno": entorno})


# ----------------------------------------------------------------------------
# Lectura de archivos
# ----------------------------------------------------------------------------
def leer_archivo(nombre, raw):
    ext = nombre.lower().rsplit(".", 1)[-1]
    if ext in ("xlsx", "xlsm", "xls"):
        hojas = pd.read_excel(io.BytesIO(raw), sheet_name=None)
        hojas = [h for h in hojas.values() if h.shape[1] > 5]
        if not hojas:
            raise ValueError("el Excel no tiene ninguna hoja con datos")
        df = pd.concat(hojas, ignore_index=True)
    else:
        df = None
        for sep in (";", ",", "\t"):
            try:
                df = pd.read_csv(io.BytesIO(raw), sep=sep, encoding="latin-1", low_memory=False)
            except Exception:
                continue
            if df.shape[1] > 5:
                break
        if df is None or df.shape[1] <= 5:
            raise ValueError("no pude interpretar el separador del archivo")
    df.columns = [str(c).strip().upper().replace(" ", "") for c in df.columns]
    return df


def procesar(df):
    faltan = [c for c in REQ if c not in df.columns]
    if faltan:
        raise ValueError("faltan columnas de la base Hogar: " + ", ".join(faltan) +
                         " (¿subiste la base Individual por error?)")
    if "REALIZADA" in df.columns:
        df = df[num(df["REALIZADA"]) == 1]
    out = pd.DataFrame({"ANO4": num(df["ANO4"]), "TRIM": num(df["TRIMESTRE"]),
                        "CODUSU": df["CODUSU"].astype(str),
                        "PONDERA": num(df["PONDERA"]), "IX_TOT": num(df["IX_TOT"])})
    out = pd.concat([out, subindices(df)], axis=1)
    out["II7"] = num(df["II7"]) if "II7" in df.columns else np.nan
    out["REGION"] = num(df["REGION"]) if "REGION" in df.columns else np.nan
    out["AGL"] = num(df["AGLOMERADO"]) if "AGLOMERADO" in df.columns else np.nan
    out["DEC"] = num(df["DECIFR"]) if "DECIFR" in df.columns else np.nan
    out = out.dropna(subset=["ANO4", "TRIM", "PONDERA", "IX_TOT"])
    out["ANO4"] = out["ANO4"].astype(int)
    out["TRIM"] = out["TRIM"].astype(int)
    return out


def combinado():
    if STORE["cache"] is None:
        if not STORE["parts"]:
            return None
        STORE["cache"] = pd.concat(STORE["parts"].values(), ignore_index=True)
        STORE["cache"]["PER"] = STORE["cache"]["ANO4"] * 10 + STORE["cache"]["TRIM"]
    return STORE["cache"]


def resumen_carga():
    d = combinado()
    if d is None:
        return []
    r = d.groupby("PER").size()
    return [{"periodo": f"{int(p) // 10}-{int(p) % 10}T", "hogares": int(n)} for p, n in r.items()]


@app.post("/api/upload")
def upload():
    msgs = []
    if STORE["demo"]:
        STORE["parts"], STORE["demo"], STORE["cache"] = {}, False, None
    for f in request.files.getlist("files"):
        try:
            df = procesar(leer_archivo(f.filename, f.read()))
            if df.empty:
                msgs.append({"archivo": f.filename, "ok": False, "msg": "sin hogares con entrevista realizada"})
                continue
            for per, sub in df.groupby(df["ANO4"] * 10 + df["TRIM"]):
                STORE["parts"][int(per)] = sub.reset_index(drop=True)
            STORE["cache"] = None
            msgs.append({"archivo": f.filename, "ok": True, "msg": f"{len(df)} hogares"})
        except Exception as e:  # noqa
            msgs.append({"archivo": f.filename, "ok": False, "msg": str(e)})
    return jsonify({"archivos": msgs, "periodos": resumen_carga(), "demo": STORE["demo"]})


@app.post("/api/reset")
def reset():
    STORE["parts"], STORE["demo"], STORE["cache"] = {}, False, None
    return jsonify({"periodos": [], "demo": False})


@app.get("/api/estado")
def estado():
    return jsonify({"periodos": resumen_carga(), "demo": STORE["demo"]})


# ----------------------------------------------------------------------------
# Datos sintéticos para probar el dashboard
# ----------------------------------------------------------------------------
@app.post("/api/demo")
def demo():
    rng = np.random.default_rng(7)
    sig = lambda x: 1 / (1 + np.exp(-x))
    reg_eff = {1: .2, 40: -.5, 41: -.8, 42: -.1, 43: .1, 44: .2}
    agl_reg = {2: 43, 3: 43, 4: 43, 5: 43, 6: 43, 7: 41, 8: 41, 9: 44, 10: 42, 12: 41, 13: 43, 14: 43, 15: 41,
               17: 44, 18: 40, 19: 40, 20: 44, 22: 40, 23: 40, 25: 40, 26: 42, 27: 42, 29: 40, 30: 43,
               31: 44, 32: 1, 33: 1, 34: 43, 36: 43, 38: 43, 91: 44, 93: 44}
    aglos = list(agl_reg)
    parts = {}
    for y in range(2017, 2027):
        for q in (1, 2):
            n = 2200
            agl = rng.choice(aglos, n)
            reg = np.array([agl_reg[a] for a in agl])
            z = rng.normal(0, 1, n) + np.array([reg_eff[r] for r in reg])
            tr = (y - 2017) * 0.06 - (0.15 if y == 2020 else 0)
            p = lambda b=1.0, a=0.0: sig(a + b * z + tr)
            u = lambda: rng.random(n)
            pick = lambda pg, good, mid, bad: np.where(u() < pg, good, np.where(u() < .6, mid, bad))
            iv3 = pick(p(1.1, 1.2), 1, 2, 3)
            iv4 = np.where(u() < p(.9, 1.0), rng.choice([1, 3, 9], n), rng.choice([2, 4, 5, 6, 7], n, p=[.2, .3, .3, .1, .1]))
            iv5 = np.where(u() < p(.8, .6), 1, 2)
            iv6 = pick(p(1.2, 2.0), 1, 2, 3)
            iv7 = np.where(u() < p(1.0, 1.8), 1, rng.choice([2, 3, 4], n, p=[.5, .3, .2]))
            iv8 = np.where(u() < p(.6, 3.6), 1, 2)
            iv9 = pick(p(1.0, 2.0), 1, 2, 3)
            iv10 = pick(p(1.0, 2.0), 1, 2, 3)
            iv11 = np.where(u() < p(1.2, 0.2), 1, rng.choice([2, 3, 4], n, p=[.55, .35, .1]))
            ii9 = np.where(u() < p(.8, 1.8), 1, rng.choice([2, 3], n, p=[.7, .3]))
            i12 = lambda: np.where(u() < p(-.7, -1.4), 1, 2)
            ii1 = np.clip(np.round(2.6 + .5 * z + rng.normal(0, 1, n)), 1, 8).astype(int)
            ixt = np.clip(np.round(3.4 - .3 * z + rng.normal(0, 1.4, n)), 1, 10).astype(int)
            ii8 = np.where(u() < p(1.0, 0.7), 1, rng.choice([2, 3], n, p=[.8, .2]))
            ii7 = np.where(u() < p(.8, .4), rng.choice([1, 2], n, p=[.93, .07]),
                           rng.choice([3, 4, 5, 6, 7, 8, 9], n, p=[.5, .04, .04, .22, .12, .04, .04]))
            dec = np.clip(np.floor(sig(z * 1.4) * 10) + 1, 1, 10).astype(int)
            d = pd.DataFrame({"CODUSU": [f"D{y}-{i}" for i in rng.integers(0, n // 2, n)],
                              "ANO4": y, "TRIMESTRE": q, "REALIZADA": 1, "PONDERA": rng.integers(150, 1200, n),
                              "IX_TOT": ixt, "IV3": iv3, "IV4": iv4, "IV5": iv5, "IV6": iv6, "IV7": iv7,
                              "IV8": iv8, "IV9": iv9, "IV10": iv10, "IV11": iv11, "IV12_1": i12(),
                              "IV12_2": i12(), "IV12_3": i12(), "II1": ii1, "II8": ii8, "II9": ii9,
                              "II7": ii7, "REGION": reg, "AGLOMERADO": agl, "DECIFR": dec})
            sin = d["IV8"] == 2
            d.loc[sin, ["IV9", "IV10", "IV11"]] = np.nan
            d.loc[sin, "II9"] = 4
            parts[y * 10 + q] = procesar(d).reset_index(drop=True)
    STORE["parts"], STORE["demo"], STORE["cache"] = parts, True, None
    return jsonify({"periodos": resumen_carga(), "demo": True})


# ----------------------------------------------------------------------------
# Cálculo
# ----------------------------------------------------------------------------
def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if (math.isnan(o) or math.isinf(o)) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    return o


def wmean(x, w):
    m = ~np.isnan(x)
    return float((x[m] * w[m]).sum() / w[m].sum()) if m.any() and w[m].sum() > 0 else float("nan")


def plabel(p, anual=False):
    return str(int(p)) if anual else f"{p % 10}T{p // 10}"


@app.post("/api/compute")
def compute():
    d = combinado()
    if d is None:
        return jsonify({"error": "No hay datos cargados."}), 400
    body = request.get_json(force=True)
    pesos = {k: float(body.get("pesos", {}).get(k, 0) or 0) for k in DIMS}
    if sum(pesos.values()) <= 0:
        return jsonify({"error": "La suma de pesos debe ser mayor que 0."}), 400
    trims = [int(t) for t in body.get("trimestres", [1])] or [1]
    por_personas = body.get("ponderar", "personas") == "personas"
    thr_lo, thr_hi = float(body.get("umbral_bajo", 2)), float(body.get("umbral_alto", 4))
    B = int(body.get("boot", 200))
    sjt_scores = {int(k): float(v) for k, v in (body.get("sjt_scores") or SJT_DEFAULT).items()}
    rng = np.random.default_rng(42)

    d = d[d["TRIM"].isin(trims)]
    if d.empty:
        return jsonify({"error": "No hay datos para los trimestres seleccionados."}), 400

    S = {k: d[k].to_numpy(float) for k in DIMS[:-1]}
    S["sjt"] = d["II7"].map(sjt_scores).to_numpy(float)
    w_all = (d["PONDERA"] * (d["IX_TOT"] if por_personas else 1)).to_numpy(float)
    per_q = d["PER"].to_numpy()
    anual = body.get("agregacion", "anio") == "anio"
    if anual:
        # Promedio anual: se juntan los trimestres elegidos de cada año y cada trimestre pesa igual
        # (el ponderador se normaliza por trimestre). El bootstrap agrupa por vivienda a través de
        # todos los trimestres del año, así que respeta la repetición de hogares del panel.
        w_all = w_all / pd.Series(w_all).groupby(per_q).transform("sum").to_numpy()
        per = d["ANO4"].to_numpy()
    else:
        per = per_q

    act = [k for k in DIMS if pesos[k] > 0]
    wsum = sum(pesos[k] for k in act)
    valid = np.ones(len(d), bool)
    for k in act:
        valid &= ~np.isnan(S[k])
    ich = np.full(len(d), np.nan)
    ich[valid] = 1 + 4 * sum(pesos[k] * S[k][valid] for k in act) / wsum
    # ICH físico (sin seguridad jurídica) para cruces con tenencia
    fw = {k: pesos[k] for k in DIMS[:-1] if pesos[k] > 0} or {k: 1.0 for k in DIMS[:-1]}
    wf = sum(fw.values())
    vf = np.ones(len(d), bool)
    for k in fw:
        vf &= ~np.isnan(S[k])
    ich_f = np.full(len(d), np.nan)
    ich_f[vf] = 1 + 4 * sum(fw[k] * S[k][vf] for k in fw) / wf

    periodos = sorted(np.unique(per))
    cols = [plabel(int(p), anual) for p in periodos]
    x = np.array([float(p) if anual else (p // 10) + ((p % 10) - 1) / 4 for p in periodos])

    serie, boots_ich = [], []
    for p in periodos:
        m = per == p
        w, i = w_all[m], ich[m]
        v = ~np.isnan(i)
        n_tot, n_val = int(m.sum()), int(v.sum())
        row = {"periodo": plabel(int(p), anual), "n": n_tot, "n_validos": n_val,
               "trims": int(len(np.unique(per_q[m])))}
        if n_val == 0:
            serie.append(row)
            boots_ich.append(np.full(max(B, 1), np.nan))
            continue
        wv, iv = w[v], i[v]
        row["ich"] = float((wv * iv).sum() / wv.sum())
        row["pct_bajo"] = float(100 * wv[iv < thr_lo].sum() / wv.sum())
        row["pct_alto"] = float(100 * wv[iv >= thr_hi].sum() / wv.sum())
        row["bandas"] = [float(100 * wv[(iv >= a) & (iv < b)].sum() / wv.sum())
                         for a, b in ((0, 2), (2, 3), (3, 4), (4, 6))]
        for k in DIMS:
            row["dim_" + k] = wmean(S[k][m], w)
        sj = S["sjt"][m]
        row["sjt_idx"] = 1 + 4 * row["dim_sjt"] if not math.isnan(row["dim_sjt"]) else float("nan")
        ok = ~np.isnan(sj)
        row["pct_tenencia_insegura"] = float(100 * w[ok & (sj < .5)].sum() / w[ok].sum()) if ok.any() else float("nan")
        both = ok & ~np.isnan(ich_f[m])
        row["pct_doble_deficit"] = float(100 * w[both & (sj < .5) & (ich_f[m] < 3)].sum() / w[both].sum()) if both.any() else float("nan")
        if B > 0:
            codes = pd.factorize(d["CODUSU"].to_numpy()[m][v])[0]
            nc = codes.max() + 1
            Wc = np.bincount(codes, wv, nc)
            Ic = np.bincount(codes, wv * iv, nc)
            Lc = np.bincount(codes, wv * (iv < thr_lo), nc)
            cnt = rng.multinomial(nc, np.ones(nc) / nc, size=B).astype(float)
            den = cnt @ Wc
            ib, lb = cnt @ Ic / den, 100 * cnt @ Lc / den
            row["ich_lo"], row["ich_hi"] = float(np.percentile(ib, 2.5)), float(np.percentile(ib, 97.5))
            row["pct_bajo_lo"], row["pct_bajo_hi"] = float(np.percentile(lb, 2.5)), float(np.percentile(lb, 97.5))
            boots_ich.append(ib)
        else:
            boots_ich.append(np.full(1, np.nan))
        serie.append(row)

    out = {"periodos": cols, "anual": anual, "serie": serie, "descartados_pct": float(100 * (1 - valid.mean()))}

    # Tendencia y diferencia primero-último
    ichs = np.array([r.get("ich", np.nan) for r in serie])
    okp = ~np.isnan(ichs)
    if okp.sum() >= 3:
        slope = float(np.polyfit(x[okp], ichs[okp], 1)[0])
        tend = {"pend": slope}
        if B > 0:
            Y = np.array([boots_ich[j] for j in range(len(periodos)) if okp[j]])
            xc = x[okp] - x[okp].mean()
            sl_b = (xc[:, None] * (Y - Y.mean(0))).sum(0) / (xc ** 2).sum()
            tend["pend_lo"], tend["pend_hi"] = float(np.percentile(sl_b, 2.5)), float(np.percentile(sl_b, 97.5))
        out["tendencia"] = tend
    if okp.sum() >= 2:
        i0, i1 = np.where(okp)[0][[0, -1]]
        dif = {"desde": cols[i0], "hasta": cols[i1], "dif": float(ichs[i1] - ichs[i0])}
        if B > 0:
            db = boots_ich[i1] - boots_ich[i0]
            dif["lo"], dif["hi"] = float(np.percentile(db, 2.5)), float(np.percentile(db, 97.5))
        # descomposición por dimensión
        contrib = {}
        for k in act:
            a, b = serie[i0].get("dim_" + k), serie[i1].get("dim_" + k)
            contrib[k] = float(4 * pesos[k] / wsum * (b - a)) if a is not None and b is not None and not (math.isnan(a) or math.isnan(b)) else 0.0
        dif["contrib"] = contrib
        dif["residuo"] = dif["dif"] - sum(contrib.values())
        dif["ich0"], dif["ich1"] = float(ichs[i0]), float(ichs[i1])
        out["diferencia"] = dif

    # Regiones, aglomerados, deciles (ICH con los pesos actuales)
    def tabla(arr, claves):
        res = {}
        for p in periodos:
            mp = per == p
            fila = {}
            for c in claves:
                m = mp & (arr == c) & ~np.isnan(ich)
                if m.sum() >= 15:
                    fila[int(c)] = {"v": wmean(ich[m], w_all[m]), "n": int(m.sum())}
            res[plabel(int(p), anual)] = fila
        return res

    agl_arr, reg_arr = d["AGL"].to_numpy(float), d["REGION"].to_numpy(float)
    terr = np.where(np.isin(agl_arr, [32, 33]), agl_arr, reg_arr)   # CABA y Partidos del GBA por separado

    # Composición región -> aglomerados, leída de los datos cargados (con respaldo oficial)
    full = combinado()
    comp = {}
    for code, name in REGIONES.items():
        ag = sorted(set(int(a) for a in full.loc[full["REGION"] == code, "AGL"].dropna()))
        origen = "datos cargados"
        if not ag:
            ag, origen = REGION_AGLOS[code], "asignación oficial (la base no trae REGION)"
        comp[name] = {"origen": origen, "aglomerados": [{"cod": a, "nombre": AGLOS.get(a, str(a))} for a in ag]}

    out["regiones"] = {"nombres": {str(k): v for k, v in TERR.items()}, "datos": tabla(terr, list(TERR)),
                       "composicion": comp}
    out["aglomerados"] = {"nombres": {str(k): v for k, v in AGLOS.items()}, "datos": tabla(agl_arr, list(AGLOS))}
    out["deciles"] = tabla(d["DEC"].to_numpy(float), list(range(1, 11)))

    # Seguridad jurídica / tenencia
    ten = {}
    ii7 = d["II7"].to_numpy(float)
    for p in periodos:
        mp = (per == p) & ~np.isnan(ii7)
        tot = w_all[mp].sum()
        fila = {}
        for c in TENENCIA:
            m = mp & (ii7 == c)
            fila[c] = {"pct": float(100 * w_all[m].sum() / tot) if tot > 0 else float("nan"),
                       "ich": wmean(ich_f[m], w_all[m]) if m.sum() >= 15 else float("nan")}
        ten[plabel(int(p), anual)] = fila
    out["tenencia"] = {"nombres": {str(k): v for k, v in TENENCIA.items()}, "datos": ten,
                       "disponible": bool((~np.isnan(ii7)).any())}
    out["info"] = {"hogares": int(len(d)), "pesos_norm": {k: (pesos[k] / wsum if k in act else 0) for k in DIMS}}
    return jsonify(clean(out))


@app.get("/api/meta")
def meta():
    return jsonify({"dims": DIMS, "labels": LABELS, "pesos": PESOS_DEFAULT, "tenencia": TENENCIA,
                    "sjt": SJT_DEFAULT})


from laboral import bp as lab_bp  # noqa: E402
app.register_blueprint(lab_bp)


@app.get("/")
def home():
    return app.send_static_file("index.html")


if __name__ == "__main__":
    print("\n  ICH · EPH  →  http://127.0.0.1:5000\n")
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=False)
