const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nexusAgent", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  getPresets: () => ipcRenderer.invoke("settings:presets"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  chooseFolder: () => ipcRenderer.invoke("settings:chooseFolder"),
  testCommand: (args) => ipcRenderer.invoke("settings:test", args),
  getAuthStatus: () => ipcRenderer.invoke("auth:status"),
  login: () => ipcRenderer.invoke("auth:login"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getRecentJobs: () => ipcRenderer.invoke("jobs:recent"),
  cancelJob: (id) => ipcRenderer.invoke("jobs:cancel", id),
  retryJob: (id) => ipcRenderer.invoke("jobs:retry", id),
  getStatus: () => ipcRenderer.invoke("status:get"),
  onStatusUpdate: (cb) => ipcRenderer.on("status:update", (_e, data) => cb(data)),
  openLog: () => ipcRenderer.invoke("log:open"),
  onJobNew: (cb) => ipcRenderer.on("job:new", (_e, job) => cb(job)),
  onJobLine: (cb) => ipcRenderer.on("job:line", (_e, data) => cb(data)),
  onJobDone: (cb) => ipcRenderer.on("job:done", (_e, data) => cb(data)),
});
