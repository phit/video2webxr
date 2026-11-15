// Playwright fixtures for the e2e tests: Chromium with the e2e build of the extension loaded, its
// service worker, and helpers that do what the toolbar popup does.
import path from 'node:path';
import { test as base, chromium } from '@playwright/test';

export { expect } from '@playwright/test';

export const PAGES = 'http://localhost:8601';
export const VIDEOS = 'http://127.0.0.1:8602'; // another origin, without CORS headers

const DIST = path.resolve('dist-e2e');

export const test = base.extend({
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures take their dependencies this way
    context: async ({}, use) => {
        const context = await chromium.launchPersistentContext('', {
            channel: 'chromium', // the full browser, which can run extensions headless
            args: [
                `--disable-extensions-except=${DIST}`,
                `--load-extension=${DIST}`,
                '--autoplay-policy=no-user-gesture-required',
            ],
        });
        await use(context);
        await context.close();
    },
    worker: async ({ context }, use) => {
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
        await use(worker);
    },
    extensionId: async ({ worker }, use) => {
        await use(new URL(worker.url()).host);
    },
});

// Opens a test page playing src and waits until its main video has a frame
export async function openVideoPage(context, src) {
    const page = await context.newPage();
    await page.goto(`${PAGES}/video?src=${encodeURIComponent(src)}`);
    await page.waitForFunction(() => document.getElementById('main').readyState >= 2);
    return page;
}

// The extension's id for a page's tab
export function tabId(worker, page) {
    return worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
}

// The toolbar popup, opened as a page and pointed at the given page's tab
export async function openPopup(context, extensionId, worker, page) {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${await tabId(worker, page)}`);
    return popup;
}

// What the page's player tells the popup (see src/popup-protocol.js)
export async function playerState(worker, page) {
    const id = await tabId(worker, page);
    return worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'state' }, { frameId: 0 }), id);
}
