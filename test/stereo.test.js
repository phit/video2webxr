import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correlation, pixelHalvesCorrelation, SIZE } from '../src/stereo.js';

// A SIZE x SIZE RGBA frame whose grey value at (x, y) comes from shade(x, y)
function frame(shade) {
    const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const v = shade(x, y);
            pixels.set([v, v, v, 255], (y * SIZE + x) * 4);
        }
    }
    return pixels;
}
// a repeatable pseudo-random picture with plenty of contrast
const picture = (x, y) => Math.floor(Math.abs((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 255);

test('correlation is 1 for identical arrays, -1 for inverted ones, null for flat ones', () => {
    const a = Float32Array.from([10, 80, 30, 200, 120]);
    assert.ok(Math.abs(correlation(a, a) - 1) < 1e-6);
    const inverted = a.map((v) => 255 - v);
    assert.ok(Math.abs(correlation(a, inverted) + 1) < 1e-6);
    assert.equal(correlation(a, new Float32Array(5).fill(50)), null);
});

test('side-by-side halves of the same picture match, a mono picture does not', () => {
    const sideBySide = frame((x, y) => picture(x % (SIZE / 2), y));
    assert.ok(pixelHalvesCorrelation(sideBySide, 'LR') > 0.99);
    assert.ok(pixelHalvesCorrelation(sideBySide, 'TB') < 0.5);
    assert.ok(pixelHalvesCorrelation(frame(picture), 'LR') < 0.5);
});

test('top/bottom halves of the same picture match', () => {
    const topBottom = frame((x, y) => picture(x, y % (SIZE / 2)));
    assert.ok(pixelHalvesCorrelation(topBottom, 'TB') > 0.99);
});

test('maxShift finds eyes shifted sideways against each other', () => {
    const shifted = frame((x, y) => (x < SIZE / 2 ? picture(x, y) : picture(x - SIZE / 2 + 2, y)));
    assert.ok(pixelHalvesCorrelation(shifted, 'LR') < 0.5);
    assert.ok(pixelHalvesCorrelation(shifted, 'LR', 0.1) > 0.99);
});

test('a black frame tells nothing', () => {
    const black = frame(() => 0);
    assert.equal(pixelHalvesCorrelation(black, 'LR'), null);
});
