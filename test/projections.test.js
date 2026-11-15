import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enterVRError, youtubeProjection } from '../src/projections.js';

test('youtubeProjection maps YouTube player info to a projection', () => {
    const info = (projections, partialSpherical = false) => ({ projections, partialSpherical });
    assert.equal(youtubeProjection(null), 'EAC');
    assert.equal(youtubeProjection(info(['MESH', 'RECTANGULAR'])), 'EAC');
    assert.equal(youtubeProjection(info(['MESH', 'RECTANGULAR'], true)), '180');
    assert.equal(youtubeProjection(info(['EQUIRECTANGULAR'])), '360');
    assert.equal(youtubeProjection(info(['EQUIRECTANGULAR'], true)), '180');
    assert.equal(youtubeProjection(info(['RECTANGULAR'])), 'FLAT');
    assert.equal(youtubeProjection(info([])), 'FLAT');
});

test('enterVRError explains a refused session and passes other errors on', () => {
    const refused = Object.assign(new Error('x'), { name: 'NotSupportedError' });
    assert.match(enterVRError(refused), /Another browser or app may be using the headset/);
    assert.equal(enterVRError(new Error('boom')), 'Entering VR failed: boom');
});
