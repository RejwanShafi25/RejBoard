const { contextBridge, ipcRenderer } = require('electron');
const EVENTS = ['peers', 'incoming', 'sas', 'received', 'progress'];
contextBridge.exposeInMainWorld('wb', {
  recognize: d => ipcRenderer.invoke('hw', d),
  docToPdf: (name, buf) => ipcRenderer.invoke('doc:toPdf', name, buf),
  clearBrowserData: () => ipcRenderer.invoke('browser:clear'),
  fetchRemoteImage: url => ipcRenderer.invoke('image:fetch-remote', url),
  lan: {
    info: () => ipcRenderer.invoke('lan:info'),
    start: () => ipcRenderer.invoke('lan:start'),
    stop: () => ipcRenderer.invoke('lan:stop'),
    peers: () => ipcRenderer.invoke('lan:peers'),
    send: (peer, payload, count) => ipcRenderer.invoke('lan:send', peer, payload, count),
    respond: (sid, ok) => ipcRenderer.invoke('lan:respond', sid, !!ok),
    on: (ch, fn) => {
      if (!EVENTS.includes(ch)) return () => {};
      const h = (_e, d) => fn(d);
      ipcRenderer.on('lan:' + ch, h);
      return () => ipcRenderer.removeListener('lan:' + ch, h);
    }
  }
});
