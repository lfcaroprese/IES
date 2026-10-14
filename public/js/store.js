/* Persistencia en el navegador (IndexedDB). Se guardan las columnas ya leídas de cada período
   (sin fórmulas aplicadas), así que cambiar el código y volver a desplegar no obliga a recargar las bases. */
(function (root) {
  const S = {};
  const DB = "ies-eph", STORE = "raw";
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB no disponible"));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

  S.available = async () => { try { await open(); return true; } catch (e) { return false; } };

  S.put = async function (key, value) {
    const db = await open(), tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    await done(tx);
  };

  S.loadModule = async function (mod) {
    const db = await open(), tx = db.transaction(STORE, "readonly"), st = tx.objectStore(STORE);
    const out = [];
    await new Promise((res, rej) => {
      const req = st.openCursor(IDBKeyRange.bound(mod + ":", mod + ":￿"));
      req.onsuccess = () => { const c = req.result; if (c) { out.push(c.value); c.continue(); } else res(); };
      req.onerror = () => rej(req.error);
    });
    return out;
  };

  S.clearModule = async function (mod) {
    const db = await open(), tx = db.transaction(STORE, "readwrite"), st = tx.objectStore(STORE);
    st.delete(IDBKeyRange.bound(mod + ":", mod + ":￿"));
    await done(tx);
  };

  root.Store = S;
  if (typeof module !== "undefined" && module.exports) module.exports = S;
})(typeof self !== "undefined" ? self : globalThis);
