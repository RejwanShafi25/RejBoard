const { contextBridge, ipcRenderer } = require('electron');
const EVENTS = ['peers', 'incoming', 'sas', 'received', 'progress'];
contextBridge.exposeInMainWorld('wb', {
  recognize: d => ipcRenderer.invoke('hw', d),
  ocr: (png, lang) => ipcRenderer.invoke('ocr:recognize', png, lang),
  docToPdf: (name, buf) => ipcRenderer.invoke('doc:toPdf', name, buf),
  i18n: { fetch: f => ipcRenderer.invoke('i18n:fetch', f) },
  clearBrowserData: () => ipcRenderer.invoke('browser:clear'),
  sync: {
    get: () => ipcRenderer.invoke('sync:get'),
    choose: () => ipcRenderer.invoke('sync:choose'),
    list: () => ipcRenderer.invoke('sync:list'),
    read: n => ipcRenderer.invoke('sync:read', n),
    write: (n, t) => ipcRenderer.invoke('sync:write', n, t),
    remove: n => ipcRenderer.invoke('sync:remove', n)
  },
  app: {
    ready: () => ipcRenderer.send('app:ready'),
    board: t => ipcRenderer.send('app:board', String(t || ''))
  },
  fetchRemoteImage: url => ipcRenderer.invoke('image:fetch-remote', url),
  updates: {
    getVersion: () => ipcRenderer.invoke('updates:version'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (fn, getActivity) => { const h = (_e, state) => fn(state); const flush = () => fn({ status: 'flush-save' }); ipcRenderer.on('updates:status', h); ipcRenderer.on('updates:flush-save', flush); ipcRenderer.send('updates:renderer-ready'); const timer = typeof getActivity === 'function' ? setInterval(() => { try { ipcRenderer.invoke('updates:activity', getActivity()).catch(() => {}); } catch (_) {} }, 700) : null; return () => { ipcRenderer.removeListener('updates:status', h); ipcRenderer.removeListener('updates:flush-save', flush); if (timer) clearInterval(timer); }; }
  },
  onBrowserAddImage: fn => { const h = (_e, u) => fn(u); ipcRenderer.on('browser:add-image', h); return () => ipcRenderer.removeListener('browser:add-image', h); },
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
