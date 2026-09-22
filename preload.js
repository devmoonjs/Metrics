const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  searchSymbol: (query) => ipcRenderer.invoke('search-symbol', query),
  fetchQuotes: (list) => ipcRenderer.invoke('fetch-quotes', list),
  resizeWindow: (size) => ipcRenderer.send('resize-window', size),
  notify: (payload) => ipcRenderer.send('notify', payload),
  quit: () => ipcRenderer.send('quit-app'),
  copyText: (text) => ipcRenderer.send('copy-text', text),

  // 캐릭터 레이어
  openPet: (config) => ipcRenderer.send('open-pet', config),
  closePet: () => ipcRenderer.send('close-pet'),
  getPetConfig: () => ipcRenderer.invoke('get-pet-config'),
  setPetInteractive: (on) => ipcRenderer.send('pet-interactive', on),
  setPetControl: (on) => ipcRenderer.send('pet-control', on),
  onCursor: (fn) => ipcRenderer.on('pet-cursor', (_e, pos) => fn(pos)),
  onPetConfig: (fn) => ipcRenderer.on('pet-config', (_e, cfg) => fn(cfg)),
  onPetClosed: (fn) => ipcRenderer.on('pet-closed', () => fn()),

  // 친구 연결
  netConnect: (opts) => ipcRenderer.invoke('net-connect', opts),
  netDisconnect: () => ipcRenderer.send('net-disconnect'),
  netSend: (event, payload) => ipcRenderer.send('net-send', { event, payload }),
  netStatus: () => ipcRenderer.invoke('net-status'),
  netMakeInvite: (opts) => ipcRenderer.invoke('net-make-invite', opts),
  onNet: (fn) => ipcRenderer.on('pet-net', (_e, msg) => fn(msg)),
});
