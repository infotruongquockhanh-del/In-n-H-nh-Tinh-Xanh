const CACHE_NAME="htx-v27-3-temp-no-login-shell";
const APP_SHELL=["/app.html","/manifest.webmanifest","/realtime.js","/icons/icon-192.png","/icons/icon-512.png","/icons/apple-touch-icon.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)));self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.pathname.startsWith("/api/")){event.respondWith(fetch(event.request));return}
  if(event.request.mode==="navigate"||url.pathname==="/"||url.pathname==="/app.html"){
    event.respondWith(fetch(event.request,{cache:"no-store"}).then(response=>{if(response?.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put("/app.html",copy))}return response}).catch(()=>caches.match("/app.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
