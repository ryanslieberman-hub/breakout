// Firebase Cloud Messaging service worker. Required for web push to work at all -
// this is what enablePushNotifications() in index.html registers via
// navigator.serviceWorker.register('/firebase-messaging-sw.js'), and what lets
// notifications show up while the app isn't in the foreground (the case that
// matters most for the "Add to Home Screen" iOS flow).
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC79hW_C4ZLIX5bkQ1YNuib9wd8ysQthJQ",
  authDomain: "athletex-ae63d.firebaseapp.com",
  projectId: "athletex-ae63d",
  storageBucket: "athletex-ae63d.firebasestorage.app",
  messagingSenderId: "825352939951",
  appId: "1:825352939951:web:5c4bdc19434e1f6d6da75a",
});

const messaging = firebase.messaging();

// Without this, a new version of this file sits "waiting" in the background
// until every open tab is fully closed - so a fix shipped here (like the
// notificationclick deep-link below) silently doesn't apply to a tab/PWA
// instance that was already open when it deployed, even after a refresh.
// skipWaiting + clients.claim make a new SW take over immediately.
//
// The same worker now also owns the offline app shell (one service worker per
// scope, so push and caching have to live together). Bump SHELL_CACHE to drop
// old entries on the next deploy.
const SHELL_CACHE = 'breakout-shell-v1';
const SHELL_URLS = ['/', '/icon-192.png', '/icon-512.png', '/icon.svg', '/apple-touch-icon.png', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).catch(() => {}).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('breakout-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => clients.claim())
  );
});

// Same-origin GETs only - Firestore, the pricing/payments workers, ESPN and
// every other API are cross-origin and are never touched here, so prices and
// balances can never be served stale from this cache.
//  - Page loads: network first, fall back to the last good shell, so the app
//    opens (and says it is offline) with no signal instead of a dino page.
//  - Icons / manifest: stale-while-revalidate.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok && url.pathname === '/') { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put('/', copy)); }
        return res;
      }).catch(() => caches.match('/').then((r) => r || Response.error()))
    );
    return;
  }
  if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }))
    );
  }
});

// Data-only messages, deliberately - if the FCM payload also carried a
// `notification` field, the browser auto-displays it in the background AND
// this handler fires, showing every push twice. One source of truth: the
// server sends data-only, this handler is the only thing that ever calls
// showNotification().
messaging.onBackgroundMessage((payload) => {
  const title = payload.data?.title || 'Breakout';
  self.registration.showNotification(title, {
    body: payload.data?.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data || {},
  });
});

// Tapping a notification focuses an already-open tab instead of opening a
// duplicate. A mover alert's data.rank (see worker-pricing-engine's
// announceMovers) becomes an ?openPlayer=<rank> deep link - index.html's
// boot sequence reads that param and opens straight to that player's detail
// view (see handleOpenPlayerDeepLink).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rank = event.notification.data?.rank;
  const url = rank ? `/?openPlayer=${encodeURIComponent(rank)}` : (event.notification.data?.url || '/');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // Navigate the already-open tab too, not just focus it - otherwise
          // tapping a mover alert while the app is already open does nothing.
          if ('navigate' in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
