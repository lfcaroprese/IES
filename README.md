# IES · Indicadores económicos y sociales (EPH)

Dos tableros sobre la Encuesta Permanente de Hogares (INDEC), que corren **100 % en el navegador**:

- **ICH · Calidad habitacional** (`public/index.html`, base Hogar): índice propio de 1 a 5 con ponderación editable.
- **Mercado laboral** (`public/laboral.html`, base Personas): actividad, empleo, desocupación, subocupación (total, demandante y no demandante), desmotivados, empleo pleno, formal/informal, comparaciones interanuales y controles contra los cuadros 1.1 y 3.2 de INDEC.

No hay servidor ni base de datos. Los microdatos de la EPH **no se suben a ningún lado**: se leen y calculan en tu navegador (Web Worker).

## Publicar en Vercel
1. Subí este repo a GitHub.
2. En Vercel: *Add New → Project → Import* del repo. No hace falta configurar nada: `vercel.json` ya indica que es un sitio estático que sirve la carpeta `public/` (sin build).
3. Deploy. Cada `git push` a `main` actualiza el sitio.

## Qué se guarda y dónde
- Al cargar una base, se guardan en **IndexedDB de tu navegador** las columnas leídas de cada período (no los resultados). Las fórmulas se aplican cada vez que se abre la página.
- Consecuencia: si cambiás el código (una regla del ICH, una tasa, un gráfico) y volvés a desplegar, **no tenés que volver a cargar ni reprocesar las bases**.
- Los datos pertenecen a un navegador y a un dominio. Otro navegador, otro dispositivo, una URL de *preview* de Vercel o un dominio nuevo empiezan vacíos. Safari puede borrar datos de sitios que no se usan por varios días.
- «Vaciar datos» en la pestaña Carga borra también lo guardado.
- Si hace falta cambiar qué columnas se leen (por ejemplo, sumar una variable nueva), esas bases hay que volver a cargarlas una vez.

## Correr en local
```
python3 -m http.server 8000 -d public      # o: npx serve public
```
Abrir http://localhost:8000. (No abrir los `.html` con doble clic: los Web Workers necesitan http.)

## Estructura
```
public/                 sitio estático (lo que sirve Vercel)
  index.html            ICH
  laboral.html          mercado laboral
  js/common.js          utilidades, RNG con semilla, percentiles
  js/parse.js           lectura de .txt/.csv/.xlsx/.xls (solo columnas necesarias)
  js/store.js           persistencia en IndexedDB
  js/ich-core.js        subíndices, ICH, bootstrap, tendencia, territorio, tenencia
  js/lab-core.js        tasas, bootstrap, interanual, desmotivados, empleo pleno, formal/informal
  js/worker.js          Web Worker (lee, guarda y calcula)
  js/api.js             puente página ↔ worker
  vendor/               Chart.js 4.4.1 y SheetJS 0.18.5 (incluidos, sin CDN)
reference/              implementación original en Python/Flask (referencia y validación)
tests/                  paridad JavaScript vs Python
vercel.json
```

## Tests de paridad (opcional)
Comparan el cálculo en JavaScript contra la versión de referencia en Python con datos sintéticos (tasas, niveles, ICH, variaciones, contrafactual: iguales a 1e-8; intervalos de confianza: mismo ancho y centro dentro de tolerancia, porque el sorteo bootstrap usa otra semilla).
```
pip install flask pandas numpy openpyxl xlrd
python3 tests/gen_fixture.py /tmp/fx
node tests/parity.mjs /tmp/fx
```

## Uso
**Carga** → subí `usu_hogar` o `usu_individual` (uno o varios trimestres/años a la vez; el período sale de `ANO4` y `TRIMESTRE`). Sin datos propios, «Cargar datos de ejemplo» muestra todo con datos **sintéticos**.

Columnas requeridas, base Hogar: CODUSU, ANO4, TRIMESTRE, PONDERA, IX_TOT, IV3–IV11, IV12_1–3, II1, II8, II9. Opcionales: II7, REGION, AGLOMERADO, DECIFR, REALIZADA.
Base Personas: CODUSU, ANO4, TRIMESTRE, AGLOMERADO, PONDERA, ESTADO, INTENSI, PP03J. Opcionales: EMPLEO, PP02E, PP02A.

Los intervalos de confianza son bootstrap por vivienda (CODUSU), 200 réplicas. La base pública no trae el área de muestreo: el intervalo es un piso del error real.
