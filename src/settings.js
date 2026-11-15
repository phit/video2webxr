// The user's settings, edited on the options page. Synced settings live in chrome.storage.sync;
// the projections remembered per site stay on this device (chrome.storage.local).
import { DEFAULT_PROJECTION, PROJECTION_IDS } from './projections.js';

export const DEFAULTS = {
    defaultProjection: DEFAULT_PROJECTION, // other sites, unless one is remembered for the site
    youtubeFlatProjection: 'FLAT', // YouTube videos detected as plain flat: FLAT or FLAT_AI
    accentColor: '#1a9fff', // the panel's highlights
    laserColor: '#1a9fff', // lasers and controller orbs
    laserFades: true,
    laserFadeDelay: 3, // seconds a controller lies still before its laser fades
    laserFadeDuration: 0.4, // seconds
    orbEnabled: true,
    orbAngle: 30, // degrees: the orb shows when looked at within this
};

export const LIMITS = {
    laserFadeDelay: [1, 10],
    laserFadeDuration: [0.1, 2],
    orbAngle: [10, 60],
};
export const YOUTUBE_FLAT_PROJECTIONS = ['FLAT', 'FLAT_AI'];

// Stored values merged over the defaults; anything missing or invalid is the default
export function normalize(stored = {}) {
    const settings = { ...DEFAULTS };
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
        const value = stored[key];
        if (typeof value !== typeof fallback) continue;
        if (typeof value === 'number') {
            const [min, max] = LIMITS[key];
            if (Number.isFinite(value)) settings[key] = Math.min(max, Math.max(min, value));
        } else if (key.endsWith('Color')) {
            if (/^#[0-9a-f]{6}$/i.test(value)) settings[key] = value;
        } else {
            settings[key] = value;
        }
    }
    if (!PROJECTION_IDS.includes(settings.defaultProjection)) settings.defaultProjection = DEFAULTS.defaultProjection;
    if (!YOUTUBE_FLAT_PROJECTIONS.includes(settings.youtubeFlatProjection))
        settings.youtubeFlatProjection = DEFAULTS.youtubeFlatProjection;
    return settings;
}

// The current settings, kept up to date once watchSettings() ran; the defaults until then and
// outside the extension (unit tests, the panel preview)
export const settings = { ...DEFAULTS };
const listeners = new Set();

export async function loadSettings() {
    return normalize(await chrome.storage.sync.get(null));
}

// Loads the settings into `settings` and keeps them current; resolves once loaded
export async function watchSettings() {
    chrome.storage.onChanged.addListener(async (_changes, area) => {
        if (area !== 'sync') return;
        Object.assign(settings, await loadSettings());
        for (const listener of listeners) listener(settings);
    });
    Object.assign(settings, await loadSettings());
}

// Calls listener(settings) after every change; returns a function that stops it
export function onSettingsChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function saveSettings(changes) {
    return chrome.storage.sync.set(changes);
}

export function resetSettings() {
    return chrome.storage.sync.clear();
}

// Projections remembered per site: { hostname: projection }
const SITE_PROJECTIONS = 'siteProjections';
export async function siteProjections() {
    return (await chrome.storage.local.get(SITE_PROJECTIONS))[SITE_PROJECTIONS] ?? {};
}
export async function rememberSiteProjection(host, projection) {
    const sites = await siteProjections();
    if (projection) sites[host] = projection;
    else delete sites[host];
    await chrome.storage.local.set({ [SITE_PROJECTIONS]: sites });
}
