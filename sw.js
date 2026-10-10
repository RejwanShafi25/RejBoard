// Offline cache: app shell first, everything else cached as it is used.
const V='rw-v40';
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(['./','index.html','manifest.json','icon.svg','icon-192.png','icon-512.png'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok||res.type=='opaque'){const cp=res.clone();caches.open(V).then(c=>c.put(e.request,cp))}return res}).catch(()=>caches.match('index.html'))))});
