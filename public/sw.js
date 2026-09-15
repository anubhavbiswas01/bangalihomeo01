// Service Worker for Bangali Homeopathic Clinic PWA
const CACHE_NAME = 'bangali-homeo-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/admin.html',
    '/prescription.html',
    '/print.html',
    '/css/style.css',
    '/css/patient.css',
    '/js/app.js',
    '/js/patient.js',
    '/images/logo.jpg',
    '/images/icon-180.png',
    '/images/icon-192.png',
    '/images/icon-512.png',
    '/manifest.json'
];

// Install Event — Cache Core Assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate Event — Clean up outdated caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event — Network First for API calls, Cache First with Network Fallback for static assets
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API calls always go to network first (so live patient/prescription data is always fresh)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() => {
                return new Response(JSON.stringify({ error: 'You are currently offline. Please reconnect to access live clinic records.' }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // Static assets & Pages: Stale-While-Revalidate
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                }
                return networkResponse;
            }).catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});
