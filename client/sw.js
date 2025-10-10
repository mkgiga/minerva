const CACHE_NAME = 'minerva-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/client.js',
    '/manifest.json',
    '/assets/images/minerva_icon_192.png',
    '/assets/images/minerva_icon_512.png',
    '/assets/images/default_avatar.svg',
    '/assets/images/assistant_icon.svg',
    '/assets/images/system_icon.svg',
    '/assets/images/user_icon.svg',
    'https://fonts.googleapis.com/icon?family=Material+Icons',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap'
];

self.addEventListener('install', event => {
    // Perform install steps
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response
                if (response) {
                    return response;
                }
                // Not in cache - fetch from network
                return fetch(event.request);
            })
    );
});