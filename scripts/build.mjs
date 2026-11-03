// Builds the extension into dist/, ready to load unpacked or zip for release.
//   node scripts/build.mjs          production build (minified)
//   node scripts/build.mjs --watch  unminified with inline source maps, rebuilt on change

import fs from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

// Files the extension loads as-is
const STATIC_FILES = [
    'manifest.json',
    'LICENSE',
    'src/popup.html',
    'src/popup.css',
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
for (const [source, target] of Object.entries(DEPTH_FILES)) copy(source, target);

const context = await esbuild.context({
    entryPoints: {
        script: 'src/youtube.js',
        'youtube-page': 'src/youtube-page.js',
        generic: 'src/generic.js',
        popup: 'src/popup.js',
        background: 'src/background.js',
    },
    outdir,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    loader: { '.svg': 'text' },
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    legalComments: 'eof', // keeps three.js' license header in the bundles
    logLevel: 'info',
});

if (watch) {
    await context.watch();
} else {
    await context.rebuild();
    await context.dispose();
}
