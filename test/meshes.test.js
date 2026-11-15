import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { remapUV, videoAspect } from '../src/meshes.js';

const video = { videoWidth: 1000, videoHeight: 500 };

// [min, max] of a geometry's u and v
function uvRange(geometry) {
    const uv = geometry.attributes.uv;
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    return { u: [Math.min(...us), Math.max(...us)], v: [Math.min(...vs), Math.max(...vs)] };
}
// uvs are 32-bit floats
const close = (actual, expected) =>
    assert.ok(
        actual.every((a, i) => Math.abs(a - expected[i]) < 1e-6),
        `${actual} vs ${expected}`,
    );
const remapped = (region) => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    remapUV(geometry, region, video);
    return uvRange(geometry);
};

test('remapUV leaves a full frame as it is', () => {
    const { u, v } = remapped([0, 0, 1, 1]);
    close(u, [0, 1]);
    close(v, [0, 1]);
});

test('remapUV trims each eye 2 px at the edge it shares with the other', () => {
    close(remapped([0, 0, 0.5, 1]).u, [0, 0.5 - 2 / 1000]); // left
    close(remapped([0, 0, 0.5, 1]).v, [0, 1]);
    close(remapped([0.5, 0, 0.5, 1]).u, [0.5 + 2 / 1000, 1]); // right
    close(remapped([0, 0.5, 1, 0.5]).v, [0.5 + 2 / 500, 1]); // top
    close(remapped([0, 0, 1, 0.5]).v, [0, 0.5 - 2 / 500]); // bottom
});

test('videoAspect falls back to 16:9 until the size is known', () => {
    assert.equal(videoAspect(video), 2);
    assert.equal(videoAspect({ videoWidth: 0, videoHeight: 0 }), 16 / 9);
});
