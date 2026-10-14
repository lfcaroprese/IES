"""
Módulo de mercado laboral (EPH, base Personas / usu_individual).

Tasas (criterio INDEC, ponderadas con PONDERA):
  actividad   = PEA / población total            PEA = ESTADO 1 o 2
  empleo      = ocupados / población total       ocupados = ESTADO 1
  desocupación= desocupados / PEA                desocupados = ESTADO 2
  subocupación= subocupados / PEA                subocupados = ESTADO 1 e INTENSI 1
  sub. demandante    = subocupados con PP03J = 1 / PEA
  sub. no demandante = (subocupados - demandantes) / PEA   (incluye PP03J = 2, 9 y faltantes)
"""
import io
import math
import unicodedata

import numpy as np
import pandas as pd
from flask import Blueprint, jsonify, request

bp = Blueprint("lab", __name__)

AGLOS = {2: "Gran La Plata", 3: "Bahía Blanca-Cerri", 4: "Gran Rosario", 5: "Gran Santa Fe", 6: "Gran Paraná",
         7: "Posadas", 8: "Gran Resistencia", 9: "Comodoro Rivadavia-Rada Tilly", 10: "Gran Mendoza",
         12: "Corrientes", 13: "Gran Córdoba", 14: "Concordia", 15: "Formosa", 17: "Neuquén-Plottier",
         18: "Santiago del Estero-La Banda", 19: "Jujuy-Palpalá", 20: "Río Gallegos", 22: "Gran Catamarca",
         23: "Gran Salta", 25: "La Rioja", 26: "Gran San Luis", 27: "Gran San Juan",
         29: "Gran Tucumán-Tafí Viejo", 30: "Santa Rosa-Toay", 31: "Ushuaia-Río Grande",
         32: "Ciudad Autónoma de Buenos Aires", 33: "Partidos del GBA", 34: "Mar del Plata", 36: "Río Cuarto",
         38: "San Nicolás-Villa Constitución", 91: "Rawson-Trelew", 93: "Viedma-Carmen de Patagones"}

REQ = ["CODUSU", "ANO4", "TRIMESTRE", "AGLOMERADO", "PONDERA", "ESTADO", "INTENSI", "PP03J"]
OPT = ["EMPLEO", "SECTOR", "PP02E", "PP02A", "PP02B"]

IND = ["pob", "pea", "ocu", "des", "sub", "subdem", "subnodem", "plen", "sobre", "notrab", "inact", "desm",
       "formal", "informal", "emp_valid"]
RATE_KEYS = ["act", "emp", "des", "sub", "subdem", "subnodem", "sub_ocu", "plen_ocu", "sobre_ocu", "notrab_ocu",
             "informal_ocu", "emp_formal", "emp_informal", "desm_pob", "desm_inact", "act_amp", "des_amp",
             "emp_pleno", "brecha_emp", "emp_pleno_amp", "brecha_emp_amp", "identidad"]

LS = {"parts": {}, "demo": False, "cache": None}


# ----------------------------------------------------------------------------
# Lectura
# ----------------------------------------------------------------------------
def num(s):
    return pd.to_numeric(s, errors="coerce")


def leer(nombre, raw):
    ext = nombre.lower().rsplit(".", 1)[-1]
    if ext in ("xlsx", "xlsm", "xls"):
        hojas = [h for h in pd.read_excel(io.BytesIO(raw), sheet_name=None).values() if h.shape[1] > 5]
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
        raise ValueError("faltan columnas de la base Personas: " + ", ".join(faltan) +
                         " (¿subiste la base Hogar por error?)")
    out = pd.DataFrame({"CODUSU": df["CODUSU"].astype(str), "ANO4": num(df["ANO4"]), "TRIM": num(df["TRIMESTRE"]),
                        "AGL": num(df["AGLOMERADO"]), "W": num(df["PONDERA"]), "ESTADO": num(df["ESTADO"]),
                        "INTENSI": num(df["INTENSI"]), "PP03J": num(df["PP03J"])})
    for c in OPT:
        out[c] = num(df[c]) if c in df.columns else np.nan
    out = out.dropna(subset=["ANO4", "TRIM", "AGL", "W", "ESTADO"])
    out["ANO4"] = out["ANO4"].astype(int)
    out["TRIM"] = out["TRIM"].astype(int)
    out["AGL"] = out["AGL"].astype(int)
    return out


def combinado():
    if LS["cache"] is None:
        if not LS["parts"]:
            return None
        d = pd.concat(LS["parts"].values(), ignore_index=True)
        d["PER"] = d["ANO4"] * 10 + d["TRIM"]
        LS["cache"] = d
    return LS["cache"]


def resumen():
    d = combinado()
    if d is None:
        return {"periodos": [], "demo": LS["demo"], "tiene_empleo": False, "tiene_desm": False}
    r = d.groupby("PER").size()
    return {"periodos": [{"periodo": f"{int(p) % 10}T{int(p) // 10}", "personas": int(n)} for p, n in r.items()],
            "demo": LS["demo"], "tiene_empleo": bool(d["EMPLEO"].notna().any()),
            "tiene_desm": bool(d["PP02E"].notna().any())}


@bp.post("/api/lab/upload")
def upload():
    msgs = []
    if LS["demo"]:
        LS["parts"], LS["demo"], LS["cache"] = {}, False, None
    for f in request.files.getlist("files"):
        try:
            df = procesar(leer(f.filename, f.read()))
            if df.empty:
                msgs.append({"archivo": f.filename, "ok": False, "msg": "sin filas válidas"})
                continue
            for per, sub in df.groupby(df["ANO4"] * 10 + df["TRIM"]):
                LS["parts"][int(per)] = sub.reset_index(drop=True)
            LS["cache"] = None
            msgs.append({"archivo": f.filename, "ok": True, "msg": f"{len(df):,} personas"})
        except Exception as e:  # noqa
            msgs.append({"archivo": f.filename, "ok": False, "msg": str(e)})
    return jsonify({"archivos": msgs, **resumen()})


@bp.post("/api/lab/reset")
def reset():
    LS["parts"], LS["demo"], LS["cache"] = {}, False, None
    return jsonify(resumen())


@bp.get("/api/lab/estado")
def estado():
    return jsonify({**resumen(), "aglos": {str(k): v for k, v in AGLOS.items()}})


# ----------------------------------------------------------------------------
# Datos sintéticos
# ----------------------------------------------------------------------------
@bp.post("/api/lab/demo")
def demo():
    rng = np.random.default_rng(11)
    ags = list(AGLOS)
    a0 = {a: rng.uniform(.44, .53) for a in ags}          # actividad base por aglomerado
    u0 = {a: rng.uniform(.04, .09) for a in ags}          # desocupación base
    inf0 = {a: rng.uniform(.30, .50) for a in ags}        # informalidad base
    parts = {}
    for y in range(2017, 2027):
        t = y - 2017
        for q in (1, 2):
            rows = []
            for a in ags:
                nh = rng.integers(110, 190)
                hog = np.repeat(np.arange(nh), rng.integers(1, 6, nh))
                n = len(hog)
                age = np.clip(rng.gamma(2.2, 17, n), 0, 90).astype(int)
                cod = np.array([f"P{y}-{a}-{h}" for h in hog])
                act = a0[a] + 0.002 * t - (0.03 if y == 2020 else 0)
                p_act = np.where(age < 10, 0, np.where(age < 18, .12, np.where(age > 65, .15, act / .62)))
                esta = np.where(age < 10, 4, 3)
                isact = rng.random(n) < np.clip(p_act, 0, .95)
                u = u0[a] + (0.03 if y in (2020, 2021) else 0) - 0.002 * t
                des = isact & (rng.random(n) < u)
                esta = np.where(isact, np.where(des, 2, 1), esta)
                ocu = esta == 1
                it = np.full(n, np.nan)
                it[ocu] = rng.choice([1, 2, 3, 4], ocu.sum(), p=[.10, .60, .27, .03])
                pj = np.full(n, np.nan)
                sub = ocu & (it == 1)
                pj[ocu] = np.where(rng.random(ocu.sum()) < .08, 1, 2)
                pj[sub] = rng.choice([1, 2, 9], sub.sum(), p=[.55, .43, .02])
                emp = np.full(n, np.nan)
                emp[ocu] = np.where(rng.random(ocu.sum()) < inf0[a] - 0.004 * t, 2, 1)
                ina = esta == 3
                p3 = .05 + (.06 if y in (2019, 2020, 2021) else 0) + .004 * t
                pe = np.full(n, np.nan)
                pe[ina] = np.where(rng.random(ina.sum()) < p3, 3, rng.choice([1, 2, 4, 5], ina.sum()))
                pa = np.full(n, np.nan)
                pa[ina] = rng.choice([1, 2, 3, 4], ina.sum(), p=[.25, .15, .30, .30])
                rows.append(pd.DataFrame({"CODUSU": cod, "ANO4": y, "TRIMESTRE": q, "AGLOMERADO": a,
                                          "PONDERA": rng.integers(250, 900, n), "ESTADO": esta, "INTENSI": it,
                                          "PP03J": pj, "EMPLEO": emp, "PP02E": pe, "PP02A": pa}))
            parts[y * 10 + q] = procesar(pd.concat(rows, ignore_index=True)).reset_index(drop=True)
    LS["parts"], LS["demo"], LS["cache"] = parts, True, None
    return jsonify(resumen())


# ----------------------------------------------------------------------------
# Cálculo
# ----------------------------------------------------------------------------
def indicadores(d, desm_disp):
    e = d["ESTADO"].to_numpy(float)
    it, pj = d["INTENSI"].to_numpy(float), d["PP03J"].to_numpy(float)
    emp = d["EMPLEO"].to_numpy(float)
    ocu, des, ina = e == 1, e == 2, e == 3
    sub = ocu & (it == 1)
    subdem = sub & (pj == 1)
    disp = np.isin(d["PP02A"].to_numpy(float), [1, 2]) if desm_disp else np.ones(len(d), bool)
    cols = {"pob": np.ones(len(d), bool), "pea": ocu | des, "ocu": ocu, "des": des, "sub": sub, "subdem": subdem,
            "subnodem": sub & ~subdem,   # subocupados menos demandantes (incluye PP03J = 2, 9 y faltantes)
            "plen": ocu & (it == 2), "sobre": ocu & (it == 3), "notrab": ocu & (it == 4), "inact": ina,
            "desm": ina & (d["PP02E"].to_numpy(float) == 3) & disp,
            "formal": ocu & (emp == 1), "informal": ocu & (emp == 2), "emp_valid": ocu & np.isin(emp, [1, 2])}
    return np.column_stack([cols[k] for k in IND]).astype(float)


def tasas(S, ustar):
    """S: dict clave -> escalar o arreglo con sumas ponderadas. Devuelve dict de tasas (%)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        g = lambda k: np.asarray(S[k], float)
        pob, pea, ocu = g("pob"), g("pea"), g("ocu")
        r = {"act": 100 * pea / pob, "emp": 100 * ocu / pob, "des": 100 * g("des") / pea,
             "sub": 100 * g("sub") / pea, "subdem": 100 * g("subdem") / pea, "subnodem": 100 * g("subnodem") / pea,
             "sub_ocu": 100 * g("sub") / ocu, "plen_ocu": 100 * g("plen") / ocu, "sobre_ocu": 100 * g("sobre") / ocu,
             "notrab_ocu": 100 * g("notrab") / ocu,
             "informal_ocu": 100 * g("informal") / g("emp_valid"),
             "emp_formal": 100 * g("formal") / pob, "emp_informal": 100 * g("informal") / pob,
             "desm_pob": 100 * g("desm") / pob, "desm_inact": 100 * g("desm") / g("inact"),
             "act_amp": 100 * (pea + g("desm")) / pob,
             "des_amp": 100 * (g("des") + g("desm")) / (pea + g("desm"))}
        r["emp_pleno"] = r["act"] * (1 - ustar / 100)
        r["brecha_emp"] = r["emp_pleno"] - r["emp"]
        r["emp_pleno_amp"] = r["act_amp"] * (1 - ustar / 100)
        r["brecha_emp_amp"] = r["emp_pleno_amp"] - r["emp"]
        r["identidad"] = r["act"] * (1 - r["des"] / 100) - r["emp"]
    return r


def contrafactual(rt, rb):
    """Si la tasa de desmotivados se hubiera mantenido en el nivel base y esas personas fueran desocupadas."""
    with np.errstate(divide="ignore", invalid="ignore"):
        dd = rt["desm_pob"] - rb["desm_pob"]
        act_cf = rt["act"] + dd
        des_cf = 100 * (rt["des"] / 100 * rt["act"] + dd) / act_cf
    return {"dd": dd, "act_cf": act_cf, "des_cf": des_cf}


def cl(o):
    if isinstance(o, dict):
        return {str(k): cl(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [cl(v) for v in o]
    if isinstance(o, np.ndarray):
        return cl(o.tolist())
    if isinstance(o, (np.floating, float)):
        return None if (math.isnan(o) or math.isinf(o)) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    return o


def one(a):
    return float(np.asarray(a).reshape(-1)[0])


@bp.post("/api/lab/compute")
def compute():
    full = combinado()
    if full is None:
        return jsonify({"error": "No hay datos cargados."}), 400
    b = request.get_json(force=True)
    trims = [int(t) for t in b.get("trimestres", [1])] or [1]
    anual = b.get("agregacion", "anio") == "anio"
    ustar = float(b.get("ustar", 5))
    B = int(b.get("boot", 200))
    sel = [int(a) for a in b.get("aglos", [])]
    separado = bool(b.get("separado", False))
    base = b.get("base", "yoy")
    rng = np.random.default_rng(42)

    d = full[full["TRIM"].isin(trims)].reset_index(drop=True)
    if d.empty:
        return jsonify({"error": "No hay datos para los trimestres elegidos."}), 400
    per_q = d["PER"].to_numpy()
    key = d["ANO4"].to_numpy() if anual else per_q
    keys = sorted(np.unique(key).tolist())
    lab = [str(k) if anual else f"{k % 10}T{k // 10}" for k in keys]
    nq = {k: len(np.unique(per_q[key == k])) for k in keys}
    X = indicadores(d, bool(b.get("desm_disp", False)))
    WX = X * d["W"].to_numpy(float)[:, None]
    ag = d["AGL"].to_numpy()
    clus = d["CODUSU"].to_numpy()

    groups = [("total", "Total 31 aglomerados", np.ones(len(d), bool))]
    if sel and set(sel) != set(ag.tolist()) and len(sel) < len(AGLOS):
        nombre = AGLOS.get(sel[0], str(sel[0])) if len(sel) == 1 else f"Selección ({len(sel)} aglomerados)"
        groups.append(("sel", nombre, np.isin(ag, sel)))
        if separado and len(sel) > 1:
            groups += [(f"a{a}", AGLOS.get(a, str(a)), ag == a) for a in sel]
    elif sel and separado:
        groups += [(f"a{a}", AGLOS.get(a, str(a)), ag == a) for a in sorted(set(ag.tolist()))]
    do_boot_all = len([g for g in groups]) <= 12

    series, ci, niveles, boots, casos = {}, {}, {}, {}, {}
    for gid, glab, mask in groups:
        series[gid] = {k: [] for k in RATE_KEYS}
        ci[gid] = {k: {"lo": [], "hi": []} for k in RATE_KEYS}
        niveles[gid] = {k: [] for k in IND}
        casos[gid] = []
        for k_ in keys:
            idx = np.where(mask & (key == k_))[0]
            casos[gid].append(int(len(idx)))
            if len(idx) == 0:
                for k in RATE_KEYS:
                    series[gid][k].append(None)
                    ci[gid][k]["lo"].append(None)
                    ci[gid][k]["hi"].append(None)
                for k in IND:
                    niveles[gid][k].append(None)
                boots[(gid, k_)] = None
                continue
            S = WX[idx].sum(0) / nq[k_]
            Sd = {n: S[j] for j, n in enumerate(IND)}
            r = tasas(Sd, ustar)
            for k in RATE_KEYS:
                series[gid][k].append(one(r[k]))
            for j, n in enumerate(IND):
                niveles[gid][n].append(float(S[j] / 1000))
            if B > 0 and (do_boot_all or gid in ("total", "sel")):
                codes = pd.factorize(clus[idx])[0]
                nc = int(codes.max()) + 1
                M = np.column_stack([np.bincount(codes, WX[idx, j], nc) for j in range(len(IND))])
                cnt = rng.multinomial(nc, np.full(nc, 1.0 / nc), size=B).astype(float)
                Sb = cnt @ M
                rb = tasas({n: Sb[:, j] for j, n in enumerate(IND)}, ustar)
                boots[(gid, k_)] = rb
                for k in RATE_KEYS:
                    v = rb[k][np.isfinite(rb[k])]
                    ci[gid][k]["lo"].append(float(np.percentile(v, 2.5)) if len(v) else None)
                    ci[gid][k]["hi"].append(float(np.percentile(v, 97.5)) if len(v) else None)
            else:
                boots[(gid, k_)] = None
                for k in RATE_KEYS:
                    ci[gid][k]["lo"].append(None)
                    ci[gid][k]["hi"].append(None)

    # Variaciones respecto de un período base
    def base_idx(i):
        if base == "first":
            return 0 if i != 0 else None
        if base == "yoy":
            tgt = keys[i] - (1 if anual else 10)
            return keys.index(tgt) if tgt in keys else None
        return lab.index(base) if base in lab and lab.index(base) != i else None

    yoy, cf = {}, {}
    for gid, _, _ in groups:
        yoy[gid] = {k: {"dif": [], "lo": [], "hi": [], "base": []} for k in RATE_KEYS if k != "identidad"}
        cf[gid] = {"dd": [], "act_cf": [], "des_cf": [], "pea_desm_miles": [], "act_cf_lo": [], "act_cf_hi": [],
                   "des_cf_lo": [], "des_cf_hi": [], "dd_lo": [], "dd_hi": []}
        for i in range(len(keys)):
            j = base_idx(i)
            ok = j is not None and series[gid]["act"][i] is not None and series[gid]["act"][j] is not None
            for k in yoy[gid]:
                if not ok:
                    for f in ("dif", "lo", "hi", "base"):
                        yoy[gid][k][f].append(None)
                    continue
                a, bb = series[gid][k][i], series[gid][k][j]
                yoy[gid][k]["dif"].append(None if a is None or bb is None else a - bb)
                yoy[gid][k]["base"].append(lab[j])
                bt, bb_ = boots.get((gid, keys[i])), boots.get((gid, keys[j])) if j is not None else None
                if bt is not None and bb_ is not None:
                    dv = bt[k] - bb_[k]
                    dv = dv[np.isfinite(dv)]
                    yoy[gid][k]["lo"].append(float(np.percentile(dv, 2.5)) if len(dv) else None)
                    yoy[gid][k]["hi"].append(float(np.percentile(dv, 97.5)) if len(dv) else None)
                else:
                    yoy[gid][k]["lo"].append(None)
                    yoy[gid][k]["hi"].append(None)
            if not ok:
                for k in cf[gid]:
                    cf[gid][k].append(None)
                continue
            rt = {k: np.array([series[gid][k][i]]) for k in ("act", "des", "desm_pob")}
            rb0 = {k: np.array([series[gid][k][j]]) for k in ("act", "des", "desm_pob")}
            c = contrafactual(rt, rb0)
            pobm = niveles[gid]["pob"][i]
            cf[gid]["dd"].append(one(c["dd"]))
            cf[gid]["act_cf"].append(one(c["act_cf"]))
            cf[gid]["des_cf"].append(one(c["des_cf"]))
            cf[gid]["pea_desm_miles"].append(one(c["dd"]) / 100 * pobm)
            bt, bb_ = boots.get((gid, keys[i])), boots.get((gid, keys[j]))
            if bt is not None and bb_ is not None:
                cb = contrafactual(bt, bb_)
                for kk in ("dd", "act_cf", "des_cf"):
                    v = cb[kk][np.isfinite(cb[kk])]
                    cf[gid][kk + "_lo"].append(float(np.percentile(v, 2.5)) if len(v) else None)
                    cf[gid][kk + "_hi"].append(float(np.percentile(v, 97.5)) if len(v) else None)
            else:
                for kk in ("dd", "act_cf", "des_cf"):
                    cf[gid][kk + "_lo"].append(None)
                    cf[gid][kk + "_hi"].append(None)

    # Territorio: todos los aglomerados, solo valores puntuales
    kk = pd.Series(key)
    terr = {}
    df_w = pd.DataFrame(WX, columns=IND)
    df_w["k"], df_w["ag"] = key, ag
    gsum = df_w.groupby(["k", "ag"]).sum()
    ncas = pd.Series(1, index=range(len(d))).groupby([key, ag]).sum()
    for (k_, a), row in gsum.iterrows():
        S = row.to_numpy() / nq[k_]
        r = tasas({n: S[j] for j, n in enumerate(IND)}, ustar)
        rec = {k: one(r[k]) for k in RATE_KEYS}
        rec.update({"n_" + n: float(S[j] / 1000) for j, n in enumerate(IND)})
        rec["casos"] = int(ncas.loc[(k_, a)])
        terr.setdefault(lab[keys.index(k_)], {})[int(a)] = rec

    out = {"periodos": lab, "anual": anual, "grupos": [{"id": g, "label": l} for g, l, _ in groups],
           "series": series, "ci": ci, "niveles": niveles, "casos": casos, "yoy": yoy, "cf": cf,
           "territorio": terr, "aglos": {str(k): v for k, v in AGLOS.items()},
           "ustar": ustar, "trims_por_periodo": [nq[k] for k in keys],
           "tiene_empleo": bool(d["EMPLEO"].notna().any()), "tiene_desm": bool(d["PP02E"].notna().any())}
    return jsonify(cl(out))


# ----------------------------------------------------------------------------
# Vista previa de los cuadros de INDEC (para los controles)
# ----------------------------------------------------------------------------
def _txt(x):
    return "" if pd.isna(x) else (f"{x:.10g}" if isinstance(x, float) else str(x).strip())


@bp.post("/api/lab/cuadros")
def cuadros():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "sin archivo"}), 400
    try:
        hojas = pd.read_excel(io.BytesIO(f.read()), sheet_name=None, header=None)
    except Exception as e:  # noqa
        return jsonify({"error": f"no pude leer el Excel: {e}"}), 400
    nombres = list(hojas)
    norm = lambda s: "".join(c for c in unicodedata.normalize("NFD", str(s).lower()) if unicodedata.category(c) != "Mn")
    pick = [n for n in nombres if any(t in norm(n) for t in ("1.1", "3.2", "1,1", "3,2", "1_1", "3_2"))]
    out = []
    for n in pick[:4]:
        g = hojas[n].dropna(how="all").dropna(axis=1, how="all").head(90)
        out.append({"hoja": n, "filas": [[_txt(v) for v in r] for r in g.itertuples(index=False)]})
    return jsonify({"hojas": nombres, "tablas": out})
