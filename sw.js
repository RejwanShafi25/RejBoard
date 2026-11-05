// Offline cache. The page comes from the cache at once and is checked against the server in the background; a newer page is stored only
// after the app scripts and translations were fetched again, so a cached index.html is never paired with an older script. Libraries,
// fonts and images stay cache-first. V only needs a bump to force a full refresh (the shell list below is pre-cached on install).
const V='rw-v19';
const SHELL=['index.html','board-core.js','versions-core.js','md-core.js','pptx-core.js','qr-core.js','vault-core.js','diagram-core.js','templates-core.js','schema-core.js','interop-core.js','scanner-core.js','math-engine.js','graph-core.js','mfr-core.js','mfr-worker.js','manifest.json'];
const ICONS=['icon.svg','icon-192.png','icon-512.png'];
/* The shell is fetched with cache:'reload' so a new version never pairs a fresh index.html with an older script left in the browser's HTTP cache. */
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll([...SHELL,...ICONS].map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
const scope=()=>new URL(self.registration.scope);
const shellName=url=>{const u=new URL(url);if(u.origin!==scope().origin)return null;const p=u.pathname.slice(scope().pathname.length);
  if(p===''||p==='index.html')return 'index.html';if(SHELL.includes(p)||/^locales\/[a-z]{2}(-[A-Za-z]+)?\.json$|^locales\/index\.json$/.test(p))return p;return null};
const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),ms))]);
/* a newer page on the server: fetch every cached script and translation again (past all caches) first, and only then the page,
   so the cached set always belongs together; open tabs are told an update is ready */
async function refresh(c){const res=await fetch('index.html',{cache:'no-cache',credentials:'same-origin'});if(!res.ok)return res;
  const text=await res.clone().text(),old=await c.match('index.html'),before=old?await old.text():null;
  if(before!==text){if(before!==null){const keys=await c.keys(),names=new Set(SHELL.filter(u=>u!=='index.html'));for(const k of keys){const n=shellName(k.url);if(n&&n!=='index.html')names.add(n)}
      await Promise.all([...names].map(n=>fetch(n,{cache:'reload',credentials:'same-origin'}).then(r=>r.ok?c.put(n,r):c.delete(n)).catch(()=>c.delete(n))))}
    await c.put('index.html',res.clone());
    if(before!==null)(await self.clients.matchAll({type:'window'})).forEach(w=>w.postMessage('rb-updated'))}
  return res}
let checking=null;
/* the page: straight from the cache (instant start, works offline), while the check for a newer version runs in the background */
async function page(req,e){const c=await caches.open(V),hit=await c.match('index.html');
  if(!checking)checking=refresh(c).catch(()=>null).finally(()=>{checking=null});
  if(hit){e.waitUntil(checking);return hit}
  try{const r=await withTimeout(checking,8000);if(r&&r.ok)return r}catch(err){}
  return (await c.match('index.html'))||Response.error()}
/* app scripts and translations: cache, else the network (bypassing the HTTP cache), kept for next time */
async function shell(req,name){const c=await caches.open(V),hit=await c.match(name);if(hit)return hit;
  try{const res=await fetch(req.url,{cache:'no-cache',credentials:'same-origin'});if(res.ok)await c.put(name,res.clone());return res}catch(e){return (await c.match(name))||Response.error()}}
self.addEventListener('fetch',e=>{if(e.request.method!='GET'||e.request.cache==='no-store')return;const req=e.request; /* no-store: the math model download, already kept in IndexedDB - never a second copy here */
  if(req.mode==='navigate'){e.respondWith(page(req,e));return}
  const name=shellName(req.url);if(name){e.respondWith(name==='index.html'?page(req,e):shell(req,name));return}
  e.respondWith(caches.match(req).then(r=>r||fetch(req).then(res=>{if(res.ok||res.type=='opaque'){const cp=res.clone();caches.open(V).then(c=>c.put(req,cp))}return res}).catch(()=>caches.match('index.html'))))});
