import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANVAS_H, CANVAS_W, formatTime, layoutAreas } from '../src/vr-controls.js';

test('formatTime shows minutes:seconds, hours when needed, --:-- when unknown', () => {
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(65.9), '1:05');
    assert.equal(formatTime(3600 + 62), '1:01:02');
    assert.equal(formatTime(Number.NaN), '--:--');
    assert.equal(formatTime(Number.POSITIVE_INFINITY), '--:--');
});

// every combination of the optional buttons that can show together: distance is for 180°
// videos, depthStrength for the AI depth, passthrough in AR sessions
const combinations = [
    [],
    ['distance'],
    ['depthStrength'],
    ['passthrough'],
    ['distance', 'passthrough'],
    ['depthStrength', 'passthrough'],
];

test('the panel layout fits the canvas with every combination of optional buttons', () => {
    for (const extras of combinations) {
        for (const [name, { x, y, w, h }] of Object.entries(layoutAreas(extras))) {
            assert.ok(x >= 0 && y >= 0 && x + w <= CANVAS_W && y + h <= CANVAS_H, `${name} with ${extras}`);
        }
    }
});

test('no two controls on the panel overlap', () => {
    for (const extras of combinations) {
        const areas = Object.entries(layoutAreas(extras));
        for (const [i, [a, r]] of areas.entries()) {
            for (const [b, s] of areas.slice(i + 1)) {
                const apart = r.x + r.w <= s.x || s.x + s.w <= r.x || r.y + r.h <= s.y || s.y + s.h <= r.y;
                assert.ok(apart, `${a} and ${b} overlap with ${extras}`);
            }
        }
    }
});

// With distance and passthrough, "180° 3D side by side" (the longest label when the most buttons
// show) fits the 144 px between the arrows at the smallest label size, seen with
// debug-scripts/panel-preview.mjs
test('the projection switcher keeps room for its label', () => {
    for (const extras of combinations) {
        const { previousProjection, nextProjection } = layoutAreas(extras);
        assert.ok(nextProjection.x - (previousProjection.x + previousProjection.w) >= 144, `with ${extras}`);
    }
});
