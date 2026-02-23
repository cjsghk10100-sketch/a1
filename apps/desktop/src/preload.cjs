const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopRuntime", {
  getStatus: () => ipcRenderer.invoke("desktop.runtime.getStatus"),
  subscribe: (listener) => {
    if (typeof listener !== "function") return () => {};
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    ipcRenderer.on("desktop.runtime.status", wrapped);
    return () => {
      ipcRenderer.removeListener("desktop.runtime.status", wrapped);
    };
  },
});
