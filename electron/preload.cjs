// Runs before the page loads. Exposes only per-launch config, nothing else from Node.
const { contextBridge, ipcRenderer } = require('electron')

const config = ipcRenderer.sendSync('app:config')

contextBridge.exposeInMainWorld('opencodeApp', {
  token: config.token,
  widgetOrigin: config.widgetOrigin,
  openModsFolder: () => ipcRenderer.send('app:open-mods'),
})
