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

test('remapUV trims each eye 2 px at both edges on the split axis', () => {
    close(remapped([0, 0, 0.5, 1]).u, [2 / 1000, 0.5 - 2 / 1000]); // left
    close(remapped([0, 0, 0.5, 1]).v, [0, 1]);
    close(remapped([0.5, 0, 0.5, 1]).u, [0.5 + 2 / 1000, 1 - 2 / 1000]); // right
    close(remapped([0, 0.5, 1, 0.5]).v, [0.5 + 2 / 500, 1 - 2 / 500]); // top
    close(remapped([0, 0, 1, 0.5]).v, [2 / 500, 0.5 - 2 / 500]); // bottom
});

// Any offset between the eyes' pictures would read as depth (or as a vertical offset top/bottom)
test("remapUV keeps both eyes' pictures aligned: same centre in each half, same scale", () => {
    const centre = ([a, b]) => (a + b) / 2;
    const width = ([a, b]) => b - a;
    const left = remapped([0, 0, 0.5, 1]).u;
    const right = remapped([0.5, 0, 0.5, 1]).u;
    close([centre(left), centre(right)], [0.25, 0.75]);
    close([width(left)], [width(right)]);
    const top = remapped([0, 0.5, 1, 0.5]).v;
    const bottom = remapped([0, 0, 1, 0.5]).v;
    close([centre(top), centre(bottom)], [0.75, 0.25]);
    close([width(top)], [width(bottom)]);
});

test('videoAspect falls back to 16:9 until the size is known', () => {
    assert.equal(videoAspect(video), 2);
    assert.equal(videoAspect({ videoWidth: 0, videoHeight: 0 }), 16 / 9);
});
