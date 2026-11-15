// End-to-end tests of the built extension (dist-e2e/, see scripts/build.mjs --e2e) in Chromium
// against local test pages: npm run e2e
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'test/e2e',
    timeout: 60_000,
    workers: 1, // one browser with the extension at a time
    forbidOnly: !!process.env.CI,
    reporter: process.env.CI ? 'github' : 'list',
    webServer: {
        command: 'node test/e2e/server.mjs',
        url: 'http://localhost:8601/other',
        reuseExistingServer: !process.env.CI,
    },
});
