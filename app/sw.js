/* Minimal service worker so Chrome offers "Install app" (opens full screen). It does not cache anything. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
