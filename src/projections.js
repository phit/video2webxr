import { t } from './i18n.js';

// Projection ids in dropdown order. Kept free of three.js so the popup can use it.
export const PROJECTION_IDS = [
    'EAC',
    'EAC_LR',
    'CUBE',
    '360',
    '360_TB',
    '360_LR',
    '180',
    '180_LR',
    'FLAT',
    'FLAT_LR',
    'FLAT_TB',
    'FLAT_AI', // only offered where depth estimation runs, see depthSupported()
];

export function projectionLabel(id) {
    return t(`projection_${id}`);
}

// WebGPU adapter vendors of phone-class GPUs. On the Steam Frame's Adreno the model either
// loses the GPU (4-bit weights) or takes 50-200 ms a frame (16-bit), too slow to be worth it.
const MOBILE_GPUS = ['qualcomm', 'arm', 'apple', 'imagination'];

// Whether this browser can run the depth model for "Flat screen 3D (AI)": a desktop GPU with
// WebGPU and 16-bit float shaders. Here rather than in depth.js so the popup can check without
// loading the ONNX runtime.
export async function depthSupported() {
    try {
        const adapter = await navigator.gpu?.requestAdapter();
        return !!adapter?.features.has('shader-f16') && !MOBILE_GPUS.includes(adapter.info?.vendor);
    } catch {
        return false;
    }
}

// Projections that are shown on the movable flat screen
export const FLAT_PROJECTIONS = new Set(['FLAT', 'FLAT_LR', 'FLAT_TB', 'FLAT_AI']);

// What Chrome reports when SteamVR refuses the session, usually because another browser or app
// already holds the headset
export function enterVRError(e) {
    return e.name === 'NotSupportedError' ? t('runtimeRefused') : t('enterFailed', e.message);
}

// Most videos on the web are plain flat videos
export const DEFAULT_PROJECTION = 'FLAT';

// How far behind the centre of a 180° video the viewer sits, as a fraction of the sphere's
// radius. The hemisphere then becomes a big curved screen in front of you instead of
// wrapping around you: at these steps it spans about 150°, 127° and 103°, so close-ups feel
// less in your face, at the cost of some stretching towards the edges. Only a sizeable
// fraction of the radius makes a difference, which is why this isn't just a step back.
export const DISTANCES = [0, 0.25, 0.5, 0.8];

// 3D strength levels for "Flat screen 3D (AI)": how far apart the nearest and farthest points
// of the picture end up, in metres on the 2 m tall screen
export const DEPTH_STRENGTHS = [0.3, 0.6, 1.0];

// The projection YouTube's player info (from youtube-page.js) says a video has. YouTube serves
// both 360° and VR180 videos as "MESH" on desktop; VR180 ones are marked partialSpherical.
// Without info (no player yet) it guesses 360°, what the cardboard icon is mostly used for.
export function youtubeProjection(info) {
    if (!info) return 'EAC';
    const is180 = info.partialSpherical;
    if (info.projections.includes('MESH')) return is180 ? '180' : 'EAC';
    if (info.projections.includes('EQUIRECTANGULAR')) return is180 ? '180' : '360';
    return 'FLAT';
}
