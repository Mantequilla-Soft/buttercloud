// Butter Cloud service worker.
//
// Deliberately does NOT cache the app: the server serves index.html with
// no-cache so every deploy is picked up immediately, and an offline cache here
// would undo that. Its only jobs are making the app installable and receiving
// files shared to it from other apps (Web Share Target, Android).

const DB_NAME = 'buttercloud-share';
const STORE = 'pending';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-target') {
    event.respondWith(receiveShare(event.request));
  }
  // Everything else goes straight to the network as if there were no worker.
});

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter(f => f instanceof File && f.size >= 0);
    if (files.length) await savePending(files);
  } catch {
    // Fall through to the Files page; it simply won't find anything pending.
  }
  return Response.redirect('/files?shared=1', 303);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePending(files) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const file of files) store.add(file);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
