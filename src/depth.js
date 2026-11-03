import * as ort from 'onnxruntime-web/webgpu';
import * as THREE from 'three';
import { MODEL, MODEL_PORT } from './model.js';

// Estimates depth for video frames with Depth Anything V2 Small on WebGPU. The runtime's WASM
// core ships with the extension (dist/ort/) and is loaded from the extension's own URL;
// single-threaded and without a worker proxy, because a content script can't start workers
// from the extension's origin. The model is data, not code, so it isn't bundled: the service
// worker downloads it from Hugging Face the first time "Flat screen 3D (AI)" is picked, see
// loadModel() and background.js.
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

// only the .wasm path: the JS glue is already in this bundle, and a folder path would make the
// runtime import it from there
ort.env.wasm.wasmPaths = { wasm: chrome.runtime.getURL('ort/ort-wasm-simd-threaded.asyncify.wasm') };
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

// native from Chrome 140; the fallback is much slower
const fromBase64 = (text) => Uint8Array.fromBase64?.(text) ?? Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// The model's bytes, from the service worker (background.js), which downloads it once and
// keeps it for every site. onProgress gets 0-1 while it downloads.
function loadModel(onProgress) {
    return new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: MODEL_PORT });
        const bytes = new Uint8Array(MODEL.size);
        // messages from here keep the worker running through a long download
        const keepAlive = setInterval(() => port.postMessage('keepalive'), 10000);
        const finish = (settle, value) => {
            clearInterval(keepAlive);
            port.disconnect();
            settle(value);
        };
        port.onMessage.addListener(({ progress, offset, chunk, done, error }) => {
            if (error) finish(reject, new Error(error));
            else if (progress !== undefined) onProgress(progress);
            else if (chunk) bytes.set(fromBase64(chunk), offset);
            else if (done) finish(resolve, bytes);
        });
        port.onDisconnect.addListener(() => {
            clearInterval(keepAlive);
            reject(new Error('the model download was interrupted'));
        });
    });
}

export class DepthEstimator {
    // The frame is squashed to size x size, whatever its shape: the model is trained on squares,
    // and its depth is clearly steadier from frame to frame that way than with the video's
    // aspect ratio kept. 364 takes about 18 ms on an RTX 30 series; 518, the training size, is
    // only a little steadier at twice the time, and the screen only moves on to a frame once
    // its depth is ready. The depth comes out square too and is stretched back over the screen.
    constructor(size = 364) {
        this.size = size;
        this.canvas = document.createElement('canvas');
        this.context = this.canvas.getContext('2d', { willReadFrequently: true });
    }

    async load(onProgress) {
        const model = await loadModel(onProgress);
        const started = performance.now();
        this.session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] });
        console.log(
            `video2webxr: depth model loaded in ${Math.round(performance.now() - started)} ms;`,
            'inputs',
            this.session.inputNames,
            'outputs',
            this.session.outputNames,
        );
    }

    // Depth of a frame (a video, or an ImageBitmap of one; flipped: stored upside down):
    // { data (relative inverse depth, larger is closer), width, height }
    async estimate(frame, flipped = false) {
        const width = this.size;
        const height = this.size;
        this.canvas.width = width;
        this.canvas.height = height;
        if (flipped) this.context.setTransform(1, 0, 0, -1, 0, height);
        this.context.drawImage(frame, 0, 0, width, height);
        this.context.setTransform(1, 0, 0, 1, 0, 0);
        const pixels = this.context.getImageData(0, 0, width, height).data;
        const size = width * height;
        const input = new Float32Array(3 * size);
        for (let i = 0; i < size; i++) {
            for (let c = 0; c < 3; c++) input[c * size + i] = (pixels[i * 4 + c] / 255 - MEAN[c]) / STD[c];
        }
        const feeds = { [this.session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, height, width]) };
        const output = (await this.session.run(feeds))[this.session.outputNames[0]];
        return { data: output.data, width: output.dims.at(-1), height: output.dims.at(-2) };
    }

    dispose() {
        this.session?.release();
    }
}

// 3D strength levels for "Flat screen 3D (AI)": how far apart the nearest and farthest points
// of the picture end up, in metres on the 2 m tall screen
export const DEPTH_STRENGTHS = [0.3, 0.6, 1.0];

// How quickly the smoothed depth follows new estimates, per estimate (0-1): the depth range
// moves slowly so the whole picture doesn't pump; each pixel follows almost at once, since
// any lag there shows as depth trailing behind moving objects
const RANGE_EASE = 0.1;
const PIXEL_EASE = 0.85;

// While started, keeps two textures in step: the depth of the video (0 the farthest point of
// the picture, 1 the nearest) and the exact video frame it was estimated from, so the relief
// never lags behind moving objects. picture is a uniform for the screen's colour: the live
// video until the first estimate, then those frames. The depth starts flat (0.5 everywhere).
export class DepthSource {
    constructor(video, videoTexture) {
        this.video = video;
        this.texture = new THREE.DataTexture(new Uint8Array([128]), 1, 1, THREE.RedFormat);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.needsUpdate = true;
        this.picture = { value: videoTexture };
        // frames are ImageBitmaps stored upside down, the way the video texture is uploaded
        this.frameTexture = new THREE.Texture();
        this.frameTexture.colorSpace = THREE.SRGBColorSpace;
        this.frameTexture.minFilter = THREE.LinearFilter;
        this.frameTexture.magFilter = THREE.LinearFilter;
        this.frameTexture.generateMipmaps = false;
        this.frameTexture.flipY = false;
        this.running = false;
        // what's holding the depth up, for the controls panel; empty once it's running
        this.status = '';
    }

    start() {
        if (this.running || this.failed) return;
        this.running = true;
        this.loop();
    }

    stop() {
        this.running = false;
    }

    async loop() {
        try {
            if (!this.estimator) {
                this.estimator = new DepthEstimator();
                this.status = 'Starting…';
                await this.estimator.load((progress) => {
                    this.status = progress < 1 ? `Downloading ${Math.floor(progress * 100)}%` : 'Starting…';
                });
                this.status = '';
            }
            let lastTime = -1;
            while (this.running) {
                const video = this.video;
                // a paused video keeps its depth
                if (video.readyState >= video.HAVE_CURRENT_DATA && video.currentTime !== lastTime) {
                    lastTime = video.currentTime;
                    const frame = await createImageBitmap(video, { imageOrientation: 'flipY' });
                    this.update(await this.estimator.estimate(frame, true));
                    this.show(frame);
                }
                await new Promise((resolve) => setTimeout(resolve, 4));
            }
        } catch (e) {
            // stays flat
            console.warn('video2webxr: depth estimation failed:', e);
            this.status = 'Unavailable';
            this.failed = true;
            this.running = false;
        }
    }

    update({ data, width, height }) {
        let min = Infinity;
        let max = -Infinity;
        for (const value of data) {
            if (value < min) min = value;
            if (value > max) max = value;
        }
        const fresh = !this.smoothed || this.smoothed.length !== data.length;
        if (fresh) {
            this.smoothed = new Float32Array(data.length);
            this.min = min;
            this.max = max;
        } else {
            this.min += (min - this.min) * RANGE_EASE;
            this.max += (max - this.max) * RANGE_EASE;
        }
        const image = this.texture.image;
        if (image.width !== width || image.height !== height) {
            this.texture.image = { data: new Uint8Array(width * height), width, height };
            this.texture.dispose(); // the GPU copy has the old size
        }
        const bytes = this.texture.image.data;
        const range = this.max - this.min || 1;
        for (let i = 0; i < data.length; i++) {
            const value = Math.min(1, Math.max(0, (data[i] - this.min) / range));
            const smoothed = fresh ? value : this.smoothed[i] + (value - this.smoothed[i]) * PIXEL_EASE;
            this.smoothed[i] = smoothed;
            bytes[i] = smoothed * 255;
        }
        this.texture.needsUpdate = true;
    }

    // Puts the frame the latest depth belongs to on the screen
    show(frame) {
        const previous = this.frameTexture.image;
        if (previous && (previous.width !== frame.width || previous.height !== frame.height)) {
            this.frameTexture.dispose(); // the GPU copy has the old size
        }
        this.frameTexture.image = frame;
        this.frameTexture.needsUpdate = true;
        this.picture.value = this.frameTexture;
        previous?.close();
    }

    dispose() {
        this.stop();
        this.estimator?.dispose();
        this.texture.dispose();
        this.frameTexture.image?.close();
        this.frameTexture.dispose();
    }
}
