#!/usr/bin/env python3
"""
Índice de Calidad Habitacional (ICH, escala 1-5) sobre bases EPH Hogar, 1T de cada año.

Uso:
    python ich_eph.py CARPETA_CON_USU_HOGAR [--salida carpeta] [--boot 500]

La carpeta debe contener los usu_hogar_*.txt (o .csv) de los 1T que quieras comparar.
Procesa solo TRIMESTRE==1 y REALIZADA==1. Salidas: ich_serie.csv y ich_serie.png.

Error estándar: bootstrap por CODUSU (vivienda). Es el mejor conglomerado disponible en
la base pública; subestima algo el error real porque la EPH sortea áreas, no viviendas.
"""
import argparse, glob, os, sys
import numpy as np
import pandas as pd

PESOS = dict(mat=0.20, agua=0.15, sanea=0.25, hacin=0.25, energ=0.05, entorno=0.10)
assert abs(sum(PESOS.values()) - 1) < 1e-9

NOMBRES = dict(mat="Materiales", agua="Agua", sanea="Saneamiento",
               hacin="Hacinamiento", energ="Energía cocción", entorno="Entorno")

REQ = ["CODUSU", "ANO4", "TRIMESTRE", "REALIZADA", "PONDERA", "IX_TOT",
       "IV3", "IV4", "IV5", "IV6", "IV7", "IV8", "IV9", "IV10", "IV11",
       "IV12_1", "IV12_2", "IV12_3", "II1", "II8", "II9"]


def leer(path):
    for sep in (";", ","):
        df = pd.read_csv(path, sep=sep, encoding="latin-1", low_memory=False)
        if df.shape[1] > 5:
            break
    df.columns = [c.strip().upper().replace(" ", "") for c in df.columns]
    return df


def num(s):
    return pd.to_numeric(s, errors="coerce")


def calcular_ich(df):
    """Devuelve df con subíndices 0-1 y columna ICH (1-5). Filas con datos faltantes -> NaN."""
    g = lambda c: num(df[c])
    piso = g("IV3").map({1: 1, 2: .5, 3: 0, 4: .5})
    techo = g("IV4").map({1: 1, 2: .75, 3: 1, 4: .5, 5: .5, 6: 0, 7: 0, 9: 1})
    cielo = pd.Series(np.where(g("IV5") == 2, 0.0, 1.0), index=df.index)  # igual que la fórmula Excel
    mat = (piso + techo + cielo) / 3

    agua = (g("IV6").map({1: 1, 2: .5, 3: 0}) + g("IV7").map({1: 1, 2: .5, 3: .25, 4: 0})) / 2

    san_calc = (.2 * g("IV9").map({1: 1, 2: .5, 3: 0}) + .3 * g("IV10").map({1: 1, 2: .5, 3: 0})
                + .3 * g("IV11").map({1: 1, 2: .6, 3: .3, 4: 0}) + .2 * g("II9").map({1: 1, 2: .5, 3: .25, 4: 0}))
    sanea = pd.Series(np.where(g("IV8") == 2, 0.0, san_calc), index=df.index)

    ii1 = g("II1")
    ratio = g("IX_TOT") / ii1.where(ii1 > 0)
    hacin = ((3 - ratio) / 2).clip(0, 1)
    hacin = hacin.where(ii1 != 0, 0.0)  # 0 ambientes -> peor caso

    energ = g("II8").map({1: 1, 2: .5, 3: 0, 4: 0})

    iv = [g("IV12_1"), g("IV12_2"), g("IV12_3")]
    ok = pd.concat(iv, axis=1).isin([1, 2]).all(axis=1)
    entorno = (sum((x == 2).astype(float) for x in iv) / 3).where(ok)

    out = pd.DataFrame(dict(mat=mat, agua=agua, sanea=sanea, hacin=hacin, energ=energ, entorno=entorno))
    out["ICH"] = 1 + 4 * sum(PESOS[k] * out[k] for k in PESOS)
    return out


def cargar(carpeta):
    archivos = sorted(glob.glob(os.path.join(carpeta, "*.txt")) + glob.glob(os.path.join(carpeta, "*.csv")))
    archivos = [a for a in archivos if "hogar" in os.path.basename(a).lower()]
    if not archivos:
        sys.exit(f"No encontré archivos *hogar* en {carpeta}")
    partes, descartes = [], []
    for a in archivos:
        df = leer(a)
        faltan = [c for c in REQ if c not in df.columns]
        if faltan:
            print(f"[AVISO] {os.path.basename(a)}: faltan columnas {faltan}. Se omite (revisar diseño de registro de ese año).")
            continue
        df = df[(num(df["TRIMESTRE"]) == 1) & (num(df["REALIZADA"]) == 1)].copy()
        if df.empty:
            continue
        sc = calcular_ich(df)
        d = pd.concat([df[["CODUSU", "ANO4", "PONDERA", "IX_TOT"]].reset_index(drop=True),
                       sc.reset_index(drop=True)], axis=1)
        for c in ("ANO4", "PONDERA", "IX_TOT"):
            d[c] = num(d[c])
        n0 = len(d)
        d = d.dropna(subset=["ICH", "PONDERA", "IX_TOT"])
        descartes.append((int(d["ANO4"].iloc[0]), n0, n0 - len(d)))
        partes.append(d)
    if not partes:
        sys.exit("Ninguna base utilizable.")
    print("\nHogares por año (total, descartados por datos faltantes):")
    for y, n0, nd in sorted(descartes):
        print(f"  {y}: {n0} hogares, {nd} descartados ({100*nd/n0:.1f}%)")
    return pd.concat(partes, ignore_index=True)


def serie(base, B, seed=42):
    rng = np.random.default_rng(seed)
    base = base.copy()
    base["w"] = base["PONDERA"] * base["IX_TOT"]          # ponderación por personas
    base["bajo"] = (base["ICH"] < 2).astype(float)
    base["alto"] = (base["ICH"] >= 4).astype(float)
    filas, boots = [], {}
    for y, d in base.groupby("ANO4"):
        cl = d.groupby("CODUSU").apply(lambda x: pd.Series({
            "w": x["w"].sum(), "ich": (x["w"] * x["ICH"]).sum(),
            "bajo": (x["w"] * x["bajo"]).sum(), "alto": (x["w"] * x["alto"]).sum()}), include_groups=False)
        W, I, L, H = (cl[c].to_numpy() for c in ("w", "ich", "bajo", "alto"))
        n = len(W)
        cnt = rng.multinomial(n, np.ones(n) / n, size=B)
        ich_b = cnt @ I / (cnt @ W)
        low_b = cnt @ L / (cnt @ W)
        high_b = cnt @ H / (cnt @ W)
        boots[int(y)] = ich_b
        fila = dict(anio=int(y), n_hogares=len(d),
                    ICH=I.sum() / W.sum(),
                    ICH_lo=np.percentile(ich_b, 2.5), ICH_hi=np.percentile(ich_b, 97.5),
                    pct_ICH_menor_2=100 * L.sum() / W.sum(),
                    pct_lo=100 * np.percentile(low_b, 2.5), pct_hi=100 * np.percentile(low_b, 97.5),
                    pct_ICH_mayor_igual_4=100 * H.sum() / W.sum())
        for k in PESOS:
            fila[NOMBRES[k]] = (d["w"] * d[k]).sum() / d["w"].sum()
        filas.append(fila)
    res = pd.DataFrame(filas).sort_values("anio").reset_index(drop=True)
    return res, boots


def tendencia(res, boots):
    años = res["anio"].to_numpy(dtype=float)
    if len(años) < 3:
        return None
    sl_b = np.array([np.polyfit(años, np.array([boots[int(a)][i] for a in años]), 1)[0]
                     for i in range(len(next(iter(boots.values()))))])
    sl = np.polyfit(años, res["ICH"].to_numpy(), 1)[0]
    d_b = boots[int(años[-1])] - boots[int(años[0])]
    return dict(pend=sl, pend_lo=np.percentile(sl_b, 2.5), pend_hi=np.percentile(sl_b, 97.5),
                dif=res["ICH"].iloc[-1] - res["ICH"].iloc[0],
                dif_lo=np.percentile(d_b, 2.5), dif_hi=np.percentile(d_b, 97.5))


def grafico(res, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 2, figsize=(12, 4.2))
    ax[0].plot(res["anio"], res["ICH"], marker="o", color="#1f6f8b")
    ax[0].fill_between(res["anio"], res["ICH_lo"], res["ICH_hi"], alpha=.2, color="#1f6f8b")
    ax[0].set_title("ICH medio (1-5), 1T de cada año\nbanda: IC 95% bootstrap")
    ax[1].plot(res["anio"], res["pct_ICH_menor_2"], marker="o", color="#b5443c")
    ax[1].fill_between(res["anio"], res["pct_lo"], res["pct_hi"], alpha=.2, color="#b5443c")
    ax[1].set_title("% de personas en hogares con ICH < 2")
    for a in ax:
        a.set_xticks(res["anio"]); a.grid(alpha=.3); a.tick_params(axis="x", rotation=45)
    fig.tight_layout()
    fig.savefig(path, dpi=150)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("carpeta")
    ap.add_argument("--salida", default=".")
    ap.add_argument("--boot", type=int, default=500)
    a = ap.parse_args()
    base = cargar(a.carpeta)
    res, boots = serie(base, a.boot)
    os.makedirs(a.salida, exist_ok=True)
    res.to_csv(os.path.join(a.salida, "ich_serie.csv"), index=False, float_format="%.4f")
    grafico(res, os.path.join(a.salida, "ich_serie.png"))
    pd.set_option("display.width", 200)
    print("\n", res.round(3).to_string(index=False))
    t = tendencia(res, boots)
    if t:
        print(f"\nPendiente anual del ICH: {t['pend']:+.4f}  IC95% [{t['pend_lo']:+.4f} ; {t['pend_hi']:+.4f}]")
        print(f"Diferencia {int(res['anio'].iloc[0])}->{int(res['anio'].iloc[-1])}: {t['dif']:+.4f}  IC95% [{t['dif_lo']:+.4f} ; {t['dif_hi']:+.4f}]")
        print("Si el IC incluye 0, el cambio no se distingue del ruido muestral.")
