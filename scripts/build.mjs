// Builds the extension into dist/, ready to load unpacked or zip for release.
//   node scripts/build.mjs          production build (minified)
//   node scripts/build.mjs --watch  unminified with inline source maps, rebuilt on change
//   node scripts/build.mjs --e2e    into dist-e2e/ for the Playwright tests, see E2E_XR_STUB

import fs from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const e2e = process.argv.includes('--e2e');
const outdir = e2e ? 'dist-e2e' : 'dist';
const debugLogs = watch || e2e || !!process.env.DEBUG; // see src/log.js

// The e2e build (test/e2e/) differs from a release in two ways the tests can't do themselves:
// access to the test servers is granted up front, since permission prompts can't be clicked, and
// WebXR is stubbed in the extension's own script world, which the tests can't reach: sessions
// never start (so the player stays up for 3D detection) and the requested mode is noted on the
// page's <html> as data-xr-requested.
const E2E_HOSTS = ['http://localhost/*', 'http://127.0.0.1/*'];
const E2E_XR_STUB = `if (globalThis.navigator?.xr) {
    navigator.xr.isSessionSupported = async () => false;
    navigator.xr.requestSession = (mode) => {
        document.documentElement.dataset.xrRequested = mode;
        return new Promise(() => {});
    };
}`;

// Files the extension loads as-is
const STATIC_FILES = [
    'manifest.json',
    'LICENSE',
    'src/popup.html',
    'src/popup.css',
    'src/options.html',
    'src/options.css',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'icons/tabler-icons.LICENSE',
];

// The ONNX runtime's WASM core, loaded from the extension's URL (source: target); the depth
// model itself is downloaded on first use, see src/depth.js
const DEPTH_FILES = {
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm':
        'ort/ort-wasm-simd-threaded.asyncify.wasm',
    'licenses/onnxruntime-web.LICENSE': 'ort/onnxruntime-web.LICENSE',
};

function copy(source, target) {
    target = `${outdir}/${target}`;
    fs.mkdirSync(target.slice(0, target.lastIndexOf('/')) || outdir, { recursive: true });
    fs.copyFileSync(source, target);
}

fs.rmSync(outdir, { recursive: true, force: true });
for (const file of STATIC_FILES) copy(file, file.replace(/^src\//, ''));
if (e2e) {
    const manifest = JSON.parse(fs.readFileSync(`${outdir}/manifest.json`, 'utf8'));
    manifest.host_permissions = E2E_HOSTS;
    fs.writeFileSync(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 4));
}
for (const [source, target] of Object.entries(DEPTH_FILES)) copy(source, target);
fs.cpSync('_locales', `${outdir}/_locales`, { recursive: true });

const context = await esbuild.context({
    entryPoints: {
        script: 'src/youtube.js',
        'youtube-page': 'src/youtube-page.js',
        generic: 'src/generic.js',
        popup: 'src/popup.js',
        options: 'src/options.js',
        background: 'src/background.js',
    },
    outdir,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    loader: { '.svg': 'text' },
    // debug logging, see src/log.js
    define: { DEBUG: String(debugLogs) },
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    legalComments: 'eof', // keeps three.js' license header in the bundles
    banner: e2e ? { js: E2E_XR_STUB } : undefined,
    logLevel: 'info',
});

if (watch) {
    await context.watch();
} else {
    await context.rebuild();
    await context.dispose();
}
