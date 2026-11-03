import { MODEL, MODEL_PORT } from './model.js';

// The extension's service worker. It downloads the depth model for the content scripts: from
// here the request comes from the extension's own origin, which Hugging Face's CORS headers
// allow, so Chrome doesn't log the "Unsafe attempt to load URL" error it logs for every
// cross-origin request a content script makes. The model is kept in the extension's Cache
// Storage, so it's downloaded once for every site.
//
// A content script connects a port named MODEL_PORT and gets { progress } (0-1) while it
// downloads, then the file as { offset, chunk } messages (base64, since extension messages are
// JSON), then { done }, or { error }. It sends 'keepalive' now and then, which keeps this
// worker from being stopped in the middle of a long download.

const CACHE = 'video2webxr-models';
const CHUNK = 4 * 1024 * 1024;

// The model's bytes, from the cache or downloaded, checked and cached
async function model(onProgress) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(MODEL.url);
    if (cached) return new Uint8Array(await cached.arrayBuffer());

    const response = await fetch(MODEL.url);
    if (!response.ok) throw new Error(`model download failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(MODEL.size);
    let received = 0;
    let percent = 0;
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > MODEL.size) throw new Error('model download is larger than expected');
        bytes.set(value, received);
        received += value.length;
        // once per percent: the network hands over thousands of small pieces
        if (Math.floor((received / MODEL.size) * 100) > percent) {
            percent = Math.floor((received / MODEL.size) * 100);
            onProgress(percent / 100);
        }
    }
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hex = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (received !== MODEL.size || hex !== MODEL.sha256) throw new Error('model download is corrupt');
    await cache.put(MODEL.url, new Response(bytes)).catch(() => {}); // e.g. storage full: download again next time
    return bytes;
}

function toBase64(bytes) {
    if (bytes.toBase64) return bytes.toBase64(); // native from Chrome 140, much faster
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

// One download for all the ports that ask while it runs
let pending = null;
const listeners = new Set();

chrome.runtime.onConnect.addListener(async (port) => {
    if (port.name !== MODEL_PORT) return;
    let open = true;
    const progress = (value) => open && port.postMessage({ progress: value });
    port.onDisconnect.addListener(() => {
        open = false;
        listeners.delete(progress);
    });
    listeners.add(progress);
    try {
        pending ??= model((value) => {
            for (const listener of listeners) listener(value);
        }).finally(() => {
            pending = null;
        });
        const bytes = await pending;
        listeners.delete(progress);
        for (let offset = 0; offset < bytes.length && open; offset += CHUNK) {
            port.postMessage({ offset, chunk: toBase64(bytes.subarray(offset, offset + CHUNK)) });
        }
        if (open) port.postMessage({ done: true });
    } catch (e) {
        if (open) port.postMessage({ error: String(e.message || e) });
    }
});
