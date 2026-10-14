/* Puente página <-> Web Worker. Mantiene las mismas llamadas que tenía la versión con servidor:
     API.post("/api/compute", body)      API.upload("/api/upload", files)      API.file("/api/lab/cuadros", file)
   Todo el procesamiento ocurre en tu navegador; no se envía ningún dato a ningún servidor. */
(function () {
  let worker = null, seq = 0;
  const pending = new Map();
  const API = { onProgress: null };

  function start() {
    if (worker) return worker;
    worker = new Worker("js/worker.js");
    worker.onmessage = (ev) => {
      const { id, result, progress } = ev.data;
      if (progress !== undefined) { if (API.onProgress) API.onProgress(progress); return; }
      const p = pending.get(id);
      if (p) { pending.delete(id); p(result); }
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p({ error: "Error interno: " + (e.message || "worker") });
      pending.clear();
    };
    return worker;
  }
  function call(url, payload) {
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      start().postMessage({ id, url, payload });
    });
  }
  API.post = (url, body) => call(url, body || {});
  API.upload = async (url, files) => {
    const r = await call(url, { files: [...files] });
    // Pedimos al navegador que no borre lo guardado cuando haya poco espacio.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* opcional */ }
    return r;
  };
  API.file = (url, file) => call(url, { file });
  window.API = API;
})();
