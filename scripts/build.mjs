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
    'src/background.js',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'icons/tabler-icons.LICENSE',
];

fs.rmSync(outdir, { recursive: true, force: true });
for (const file of STATIC_FILES) {
    const target = `${outdir}/${file.replace(/^src\//, '')}`;
    fs.mkdirSync(target.slice(0, target.lastIndexOf('/')) || outdir, { recursive: true });
    fs.copyFileSync(file, target);
}

const context = await esbuild.context({
    entryPoints: { script: 'src/youtube.js', generic: 'src/generic.js' },
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
