const { contextBridge, ipcRenderer } = require("electron");
// Narrow actions; folder opening accepts directories only. The main process also verifies sender/frame.
contextBridge.exposeInMainWorld("siaasDesktop", {
  chooseKnowledgeFolder: () => ipcRenderer.invoke("siaas:choose-knowledge-folder"),
  openKnowledgeFolder: (path) => ipcRenderer.invoke("siaas:open-knowledge-folder", path),
  openDataDirectory: () => ipcRenderer.invoke("siaas:open-data-directory"),
  updateState: () => ipcRenderer.invoke("siaas:update-state"),
  checkUpdate: () => ipcRenderer.invoke("siaas:check-update"),
  installUpdate: () => ipcRenderer.invoke("siaas:install-update"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("siaas:update-state", listener);
    return () => ipcRenderer.removeListener("siaas:update-state", listener);
  },
  getSetupError: () => ipcRenderer.invoke("siaas:setup-error"),
  setupOllama: () => ipcRenderer.invoke("siaas:setup-ollama"),
  cancelSetup: () => ipcRenderer.invoke("siaas:cancel-setup"),
  onSetupProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on("siaas:setup-progress", handler);
    return () => ipcRenderer.removeListener("siaas:setup-progress", handler);
  },
});
