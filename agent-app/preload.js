const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nexusAgent", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  getPresets: () => ipcRenderer.invoke("settings:presets"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  chooseFolder: () => ipcRenderer.invoke("settings:chooseFolder"),
  testCommand: (args) => ipcRenderer.invoke("settings:test", args),
  resolveIdentity: () => ipcRenderer.invoke("identity:resolve"),
  getRecentJobs: () => ipcRenderer.invoke("jobs:recent"),
  onJobNew: (cb) => ipcRenderer.on("job:new", (_e, job) => cb(job)),
  onJobLine: (cb) => ipcRenderer.on("job:line", (_e, data) => cb(data)),
  onJobDone: (cb) => ipcRenderer.on("job:done", (_e, data) => cb(data)),
});
