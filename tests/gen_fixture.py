"""Genera datos sintéticos con la versión Python de referencia y guarda sus resultados.
Uso:  python tests/gen_fixture.py SALIDA_DIR      (necesita flask, pandas, numpy)
Después:  node tests/parity.mjs SALIDA_DIR
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "reference"))
import pandas as pd
import app as A
import laboral as L

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
cap = {"ich": [], "lab": []}
op_a, op_l = A.procesar, L.procesar
A.procesar = lambda d: (cap["ich"].append(d.copy()), op_a(d))[1]
L.procesar = lambda d: (cap["lab"].append(d.copy()), op_l(d))[1]
c = A.app.test_client()

c.post("/api/demo")
pd.concat(cap["ich"]).to_csv(f"{out}/hogar.csv", sep=";", index=False, encoding="latin-1")
ich_cases = [
    {"pesos": A.PESOS_DEFAULT, "trimestres": [1, 2], "agregacion": "anio", "boot": 0},
    {"pesos": A.PESOS_DEFAULT, "trimestres": [1], "agregacion": "trimestre", "ponderar": "hogares", "boot": 200},
    {"pesos": {"mat": 10, "agua": 10, "sanea": 10, "hacin": 10, "energ": 10, "entorno": 10, "sjt": 30}, "trimestres": [1, 2], "agregacion": "anio", "boot": 200, "umbral_bajo": 2.5, "umbral_alto": 3.5},
]
json.dump([{"body": b, "out": c.post("/api/compute", json=b).get_json()} for b in ich_cases], open(f"{out}/ich_expected.json", "w"))

c.post("/api/lab/demo")
pd.concat(cap["lab"]).to_csv(f"{out}/personas.csv", sep=";", index=False, encoding="latin-1")
lab_cases = [
    {"trimestres": [1, 2], "agregacion": "anio", "boot": 0, "aglos": []},
    {"trimestres": [1], "agregacion": "trimestre", "boot": 200, "aglos": [13], "base": "yoy", "ustar": 5},
    {"trimestres": [1, 2], "agregacion": "anio", "boot": 0, "aglos": [13, 4, 2], "separado": True, "base": "first", "ustar": 6, "desm_disp": True},
    {"trimestres": [1, 2], "agregacion": "anio", "boot": 200, "aglos": [32, 33], "base": "2020", "desm_disp": False},
]
json.dump([{"body": b, "out": c.post("/api/lab/compute", json=b).get_json()} for b in lab_cases], open(f"{out}/lab_expected.json", "w"))
print("fixture ok en", out)
