const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  searchSymbol: (query) => ipcRenderer.invoke('search-symbol', query),
  fetchQuotes: (list) => ipcRenderer.invoke('fetch-quotes', list),
  resizeWindow: (size) => ipcRenderer.send('resize-window', size),
  notify: (payload) => ipcRenderer.send('notify', payload),
  quit: () => ipcRenderer.send('quit-app'),
});
