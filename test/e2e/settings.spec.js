// The options page, and the projections the popup remembers per site
import { expect, openPopup, openVideoPage, test } from './extension.js';

test('the popup remembers a projection per site, and the options page lists and forgets it', async ({
    context,
    worker,
    extensionId,
}) => {
    const page = await openVideoPage(context, '/fixtures/mono.webm');
    let popup = await openPopup(context, extensionId, worker, page);
    await expect(popup.locator('#projection')).toHaveValue('FLAT');
    await popup.locator('#projection').selectOption('180');
    await popup.close();

    popup = await openPopup(context, extensionId, worker, page);
    await expect(popup.locator('#projection')).toHaveValue('180');
    await popup.close();

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const site = options.locator('#sites li', { hasText: 'localhost' });
    await expect(site).toContainText('180°');
    await site.getByRole('button', { name: 'Forget localhost' }).click();
    await expect(options.locator('#noSites')).toBeVisible();

    // the default for other sites applies once nothing is remembered
    await options.locator('#defaultProjection').selectOption('360');
    await expect
        .poll(() => worker.evaluate(() => chrome.storage.sync.get('defaultProjection')))
        .toEqual({ defaultProjection: '360' });
    popup = await openPopup(context, extensionId, worker, page);
    await expect(popup.locator('#projection')).toHaveValue('360');
});

test('the options page saves settings and resets them', async ({ context, worker, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const stored = () => worker.evaluate(() => chrome.storage.sync.get(null));

    await expect(options.locator('[data-setting="orbEnabled"]')).toBeChecked(); // settings shown
    await options.locator('[data-setting="orbEnabled"]').uncheck();
    await expect(options.locator('#orbAngle')).toBeDisabled();
    await options.locator('#laserFadeDelay').fill('7');
    await expect(options.locator('#laserFadeDelay ~ output')).toHaveText('7 s');
    await expect.poll(stored).toEqual({ orbEnabled: false, laserFadeDelay: 7 });

    await options.locator('#reset').click();
    await expect.poll(stored).toEqual({});
    await expect(options.locator('[data-setting="orbEnabled"]')).toBeChecked();
    await expect(options.locator('#laserFadeDelay')).toHaveValue('3');
});
