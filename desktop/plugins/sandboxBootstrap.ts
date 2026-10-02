export const SANDBOX_BOOTSTRAP = `(() => {
  const pending = new Map();
  let loading = false;
  let started = false;
  let runtimeFailureReported = false;
  const sendFailure = (message) => parent.postMessage({ kind: "failed", message: message.slice(0, 240) }, "*");
  const reportRuntimeFailure = () => {
    if (!started || runtimeFailureReported) return;
    runtimeFailureReported = true;
    parent.postMessage({ kind: "runtime-failed" }, "*");
  };
  window.addEventListener("error", reportRuntimeFailure);
  window.addEventListener("unhandledrejection", reportRuntimeFailure);
  const request = (method, key, value) => {
    if (pending.size >= 32) return Promise.reject(new Error("Zu viele offene Speicheranfragen."));
    if (typeof key !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(key)) return Promise.reject(new Error("Ungültiger Speicher-Schlüssel."));
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      pending.set(id, resolve);
      parent.postMessage({ kind: "request", id, method, key, ...(method === "storage.set" ? { value } : {}) }, "*");
    });
  };
  window.addEventListener("message", async (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (message?.kind === "response") {
      const resolve = pending.get(message.id);
      if (resolve) { pending.delete(message.id); resolve(message.response); }
      return;
    }
    if (message?.kind !== "load" || loading) return;
    loading = true;
    const config = message.manifest;
    if (!config || typeof config.id !== "string" || typeof config.name !== "string" || typeof config.version !== "string" || config.apiVersion !== 1 || typeof message.entrypoint !== "string") {
      sendFailure("Ungültiges Plugin-Artefakt.");
      return;
    }
    const scriptUrl = URL.createObjectURL(new Blob([message.entrypoint], { type: "text/javascript" }));
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.onload = async () => {
      URL.revokeObjectURL(scriptUrl);
      try {
        const plugin = window.WorkshopPlugin;
        if (!plugin || typeof plugin.activate !== "function" || plugin.manifest?.id !== config.id || plugin.manifest?.version !== config.version || plugin.manifest?.apiVersion !== config.apiVersion) throw new Error("Ungültiger Plugin-Einstieg.");
        const storage = Object.freeze({
          get: (key) => request("storage.get", key).then((result) => {
            if (!result.ok) throw new Error(result.error);
            return result.value;
          }),
          set: (key, value) => request("storage.set", key, value).then((result) => { if (!result.ok) throw new Error(result.error); }),
          remove: (key) => request("storage.remove", key).then((result) => { if (!result.ok) throw new Error(result.error); }),
        });
        const api = Object.freeze({
          manifest: Object.freeze(config),
          ...(config.permissions?.includes("storage") ? { storage } : {}),
          root: document.getElementById("plugin-root"),
        });
        await plugin.activate(api);
        started = true;
        parent.postMessage({ kind: "ready", pluginId: config.id }, "*");
      } catch (error) {
        sendFailure(error instanceof Error ? error.message : "Plugin-Start fehlgeschlagen.");
      }
    };
    script.onerror = () => {
      URL.revokeObjectURL(scriptUrl);
      sendFailure("Der Plugin-Einstieg konnte nicht ausgeführt werden.");
    };
    document.head.append(script);
  });
  parent.postMessage({ kind: "bootstrap-ready" }, "*");
})();
`
