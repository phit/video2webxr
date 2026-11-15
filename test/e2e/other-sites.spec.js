// Watching a video on a site other than YouTube, started from the toolbar popup
import { expect, openPopup, openVideoPage, playerState, tabId, test, VIDEOS } from './extension.js';

test('the popup arms the largest video, and clicking it enters VR', async ({ context, worker, extensionId }) => {
    const page = await openVideoPage(context, '/fixtures/mono.webm');
    const popup = await openPopup(context, extensionId, worker, page);
    await expect(popup.locator('#status')).toHaveText('Video found. Enter VR, then click the video in the page.');

    await popup.locator('#enter').click();
    await expect(popup.locator('#status')).toHaveText('Click the video in the page to enter VR.');

    // the hint is centred on the main video, not the smaller one above it
    const hint = page.getByText('Click the video to enter VR');
    await expect(hint).toBeVisible();
    const video = await page.locator('#main').boundingBox();
    const box = await hint.boundingBox();
    expect(Math.abs(box.x + box.width / 2 - (video.x + video.width / 2))).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - (video.y + video.height / 2))).toBeLessThan(2);

    await page.bringToFront();
    await page.locator('#main').click();
    await expect(page.locator('html')).toHaveAttribute('data-xr-requested', 'immersive-vr');
    await expect(hint).toBeHidden();
    expect(await playerState(worker, page)).toMatchObject({ state: 'starting', projection: 'FLAT' });
});

// The halves correlations stereo.js logs (debug builds), to know detection has looked
function countChecks(page) {
    const checks = { count: 0 };
    page.on('console', (message) => {
        if (message.text().includes('halves correlation')) checks.count++;
    });
    return checks;
}

for (const [video, expected] of [
    ['mono', 'FLAT'],
    ['sbs', 'FLAT_LR'],
    ['tb', 'FLAT_TB'],
]) {
    test(`a ${video} video is shown as ${expected}`, async ({ context, worker, extensionId }) => {
        const page = await openVideoPage(context, `/fixtures/${video}.webm`);
        const checks = countChecks(page);
        const popup = await openPopup(context, extensionId, worker, page);
        await popup.locator('#enter').click();
        await expect(popup.locator('#status')).toHaveText('Click the video in the page to enter VR.');
        await page.bringToFront();
        await page.locator('#main').click();
        // a few checks each way (mono needs three votes too)
        await expect.poll(() => checks.count, { timeout: 15_000 }).toBeGreaterThanOrEqual(6);
        await expect.poll(async () => (await playerState(worker, page)).projection).toBe(expected);
    });
}

test('a video blocked by CORS is worked around, and only for its site', async ({ context, worker, extensionId }) => {
    const page = await openVideoPage(context, `${VIDEOS}/fixtures/mono.webm`);
    const id = await tabId(worker, page);
    const popup = await openPopup(context, extensionId, worker, page);
    await popup.locator('#enter').click();
    // the e2e build has access to both servers, so no "Allow" step: the workaround applies at once
    await expect(popup.locator('#status')).toHaveText('Click the video in the page to enter VR.', { timeout: 30_000 });

    const rules = () => worker.evaluate((id) => chrome.declarativeNetRequest.getSessionRules({ ruleIds: [id] }), id);
    const [rule] = await rules();
    expect(rule.condition).toMatchObject({
        tabIds: [id],
        initiatorDomains: ['localhost'],
        requestDomains: ['127.0.0.1'],
    });
    // the video can be read now: a frame drawn from it doesn't taint a canvas
    const readable = await page.evaluate(() => {
        const context = document.createElement('canvas').getContext('2d');
        context.drawImage(document.getElementById('main'), 0, 0, 1, 1);
        try {
            context.getImageData(0, 0, 1, 1);
            return true;
        } catch {
            return false;
        }
    });
    expect(readable).toBe(true);

    // another site in the same tab: the rule goes
    await page.goto(`${VIDEOS}/other`);
    await expect.poll(rules).toHaveLength(0);
});
