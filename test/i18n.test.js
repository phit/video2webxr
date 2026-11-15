import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PROJECTION_IDS } from '../src/projections.js';
import { getMessage, readMessages } from './chrome-i18n.js';

const root = new URL('../', import.meta.url);
const locales = fs.readdirSync(new URL('_locales/', root));
const english = readMessages('en');
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

test('every locale has exactly the English keys and placeholders', () => {
    assert.ok(locales.length > 1);
    for (const locale of locales) {
        const messages = readMessages(locale);
        assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort(), locale);
        for (const [key, { message, placeholders = {} }] of Object.entries(messages)) {
            assert.deepEqual(placeholders, english[key].placeholders ?? {}, `${locale}/${key}`);
            const used = [...message.matchAll(/\$(\w+)\$/g)].map((m) => m[1].toLowerCase()).sort();
            assert.deepEqual(used, Object.keys(placeholders).sort(), `${locale}/${key} uses each placeholder once`);
        }
    }
});

test('every key the code and pages use exists, and every English key is used', () => {
    const sources = fs.readdirSync(new URL('src/', root)).map((file) => read(`src/${file}`));
    const used = new Set([
        ...sources.flatMap((source) => [...source.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1])),
        ...sources.flatMap((source) => [...source.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1])),
        ...[...read('manifest.json').matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]),
        ...PROJECTION_IDS.map((id) => `projection_${id}`),
    ]);
    // built by key in the code: t(scope === 'all' ? 'allowAllRetry' : 'allowRetry')
    used.add('allowAllRetry').add('allowRetry');
    for (const key of used) assert.ok(english[key], `missing message ${key}`);
    for (const key of Object.keys(english)) assert.ok(used.has(key), `unused message ${key}`);
});

test('placeholders are filled in order', () => {
    assert.equal(
        getMessage(english, 'corsOffer', ['Blocked.', 'cdn.example']),
        'Blocked. video2webxr can work around this if you allow it to access cdn.example.',
    );
});
