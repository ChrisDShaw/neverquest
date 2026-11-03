const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', Object.freeze({
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openAppLink: kind => ipcRenderer.invoke('app:link', kind),
  exportDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  onUpdateStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  },
  getSnapshot: () => ipcRenderer.invoke('ledger:get'),
  chooseFolder: () => ipcRenderer.invoke('ledger:choose'),
  discover: () => ipcRenderer.invoke('ledger:discover'),
  selectCharacter: id => ipcRenderer.invoke('ledger:select', id),
  useDemo: () => ipcRenderer.invoke('ledger:demo'),
  pin: enabled => ipcRenderer.invoke('window:pin', enabled),
  action: (command, payload, sourceId) => ipcRenderer.invoke('companion:action', command, payload, sourceId),
  selectHistory: id => ipcRenderer.invoke('history:select', id),
  copyReport: scope => ipcRenderer.invoke('report:copy', scope),
  copyHunt: (id, part, expectedText, sourceId) => ipcRenderer.invoke('hunt:copy', id, part, expectedText, sourceId),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  previewSettings: () => ipcRenderer.invoke('settings:preview'),
  applySettings: () => ipcRenderer.invoke('settings:apply'),
  chooseSound: () => ipcRenderer.invoke('sound:choose'),
  openMap: zone => ipcRenderer.invoke('map:open', zone),
  openPanel: kind => ipcRenderer.invoke('panel:open', kind),
  configurePanel: (kind, background, pinned) => ipcRenderer.invoke('panel:configure', kind, background, pinned),
  closePanel: kind => ipcRenderer.invoke('panel:close', kind),
  resizePanel: (kind, width, height) => ipcRenderer.invoke('panel:resize', kind, width, height),
  showMain: () => ipcRenderer.invoke('window:show-main'),
  showHunt: (id, sourceId) => ipcRenderer.invoke('window:show-hunt', id, sourceId),
  onShowHunt: callback => { ipcRenderer.on('hunt:show', (_event, request) => callback(request)); },
  getMarket: manual => ipcRenderer.invoke('market:get', manual),
  openMarket: item => ipcRenderer.invoke('market:open', item),
  openItemWiki: item => ipcRenderer.invoke('wiki:item', item),
  copyMarket: (item, server) => ipcRenderer.invoke('market:copy', item, server),
  mapCatalogue: () => ipcRenderer.invoke('maps:list'),
  setMapDownloads: enabled => ipcRenderer.invoke('maps:network', enabled),
  mapZone: key => ipcRenderer.invoke('maps:zone', key),
  resolveMapZone: raw => ipcRenderer.invoke('maps:resolve', raw),
  saveMapPin: pin => ipcRenderer.invoke('maps:pin', pin),
  removeMapPin: id => ipcRenderer.invoke('maps:remove-pin', id)
}));
