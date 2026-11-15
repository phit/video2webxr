// Projection ids and labels, in dropdown order. Kept free of three.js so the popup can use it.
export const PROJECTION_LABELS = [
    ['EAC', '360° EAC'],
    ['EAC_LR', '360° EAC 3D'],
    ['CUBE', '360° cubemap'],
    ['360', '360° equirectangular'],
    ['360_TB', '360° 3D top/bottom'],
    ['360_LR', '360° 3D side by side'],
    ['180', '180°'],
    ['180_LR', '180° 3D side by side'],
    ['FLAT', 'Flat screen'],
    ['FLAT_LR', 'Flat screen 3D side by side'],
    ['FLAT_TB', 'Flat screen 3D top/bottom'],
    // only offered where depth estimation runs, see depthSupported()
    ['FLAT_AI', 'Flat screen 3D (AI)'],
];

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
    return e.name === 'NotSupportedError'
        ? "The VR runtime couldn't start a session. Another browser or app may be using the headset: close it, or restart SteamVR, and try again."
        : `Entering VR failed: ${e.message}`;
}

// Most videos on the web are plain flat videos
export const DEFAULT_PROJECTION = 'FLAT';

// How far behind the centre of a 180° video the viewer sits, as a fraction of the sphere's
// radius. The hemisphere then becomes a big curved screen in front of you instead of
// wrapping around you: at these steps it spans about 150°, 127° and 103°, so close-ups feel
// less in your face, at the cost of some stretching towards the edges. Only a sizeable
// fraction of the radius makes a difference, which is why this isn't just a step back.
export const DISTANCES = [0, 0.25, 0.5, 0.8];
