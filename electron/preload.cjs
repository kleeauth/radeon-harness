// Runs before the page loads. Exposes only per-launch config and a few app actions, nothing else from Node.
const { contextBridge, ipcRenderer } = require('electron')

const config = ipcRenderer.sendSync('app:config')

contextBridge.exposeInMainWorld('opencodeApp', {
  token: config.token,
  widgetOrigin: config.widgetOrigin,
  workspace: config.workspace,
  modsDir: config.modsDir,
  platform: process.platform,
  openModsFolder: () => ipcRenderer.send('app:open-mods'),
  chooseWorkspace: () => ipcRenderer.invoke('app:choose-workspace'),
  // { maximized, fullscreen } now, and a subscription that returns its own unsubscribe
  getWindowState: () => ipcRenderer.sendSync('app:get-window-state'),
  onWindowState: (fn) => {
    const listener = (_e, state) => fn(state)
    ipcRenderer.on('app:window-state', listener)
    return () => ipcRenderer.removeListener('app:window-state', listener)
  },
})
