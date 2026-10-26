// =============================================================
// sw.js — Service worker: guarda una copia de la web en el móvil
// -------------------------------------------------------------
// Estrategia "primero red, si falla la copia":
//  · Con internet siempre se descarga la versión más nueva
//    (así los cambios que subas a GitHub se ven enseguida).
//  · Sin internet se usa la última copia → la web abre igual.
// Las peticiones a Supabase NO se tocan (los datos se cachean en
// localStorage desde store.js).
// =============================================================

const CACHE = 'calendario-dani-eva-v2';

// Archivos de la web que se guardan al instalar
const ARCHIVOS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/utils.js',
  './js/turnos.js',
  './js/store.js',
  './js/calendario.js',
  './js/modales.js',
  './js/ocr.js',
  './js/importar.js',
  './js/excel.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
];

// Instalación: descarga y guarda los archivos
self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(ARCHIVOS.map(a => cache.add(a))))
      .then(() => self.skipWaiting()),
  );
});

// Activación: borra cachés de versiones antiguas
self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(c => c !== CACHE).map(c => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

// Peticiones: primero red, si falla la copia guardada
self.addEventListener('fetch', evento => {
  const { request } = evento;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  const esPropia = url.origin === self.location.origin;
  const esLibreriaSupabase = url.href.includes('@supabase/supabase-js');
  if (!esPropia && !esLibreriaSupabase) return; // Supabase API, Tesseract, etc.: sin tocar

  evento.respondWith(
    fetch(request)
      .then(respuesta => {
        if (respuesta.ok || respuesta.type === 'opaque') {
          const copia = respuesta.clone();
          caches.open(CACHE).then(cache => cache.put(request, copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then(r => r || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
