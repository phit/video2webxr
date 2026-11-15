import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, normalize } from '../src/settings.js';

test('normalize fills in the defaults', () => {
    assert.deepEqual(normalize(), DEFAULTS);
    assert.deepEqual(normalize({ unknown: 1 }), DEFAULTS);
});

test('normalize keeps valid values and drops invalid ones', () => {
    const stored = { laserColor: '#FF0000', laserFades: false, orbAngle: 45, defaultProjection: '180_LR' };
    assert.deepEqual(normalize(stored), { ...DEFAULTS, ...stored });
    assert.equal(normalize({ laserColor: 'red' }).laserColor, DEFAULTS.laserColor);
    assert.equal(normalize({ laserFades: 'no' }).laserFades, true);
    assert.equal(normalize({ orbAngle: Number.NaN }).orbAngle, DEFAULTS.orbAngle);
    assert.equal(normalize({ defaultProjection: 'NOPE' }).defaultProjection, DEFAULTS.defaultProjection);
    assert.equal(normalize({ youtubeFlatProjection: '360' }).youtubeFlatProjection, 'FLAT');
});

test('normalize clamps numbers to their range', () => {
    assert.equal(normalize({ laserFadeDelay: 0 }).laserFadeDelay, 1);
    assert.equal(normalize({ laserFadeDuration: 9 }).laserFadeDuration, 2);
    assert.equal(normalize({ orbAngle: 90 }).orbAngle, 60);
});
