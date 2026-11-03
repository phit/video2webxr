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
export const FLAT_PROJECTIONS = new Set(['FLAT', 'FLAT_AI']);

// Most videos on the web are plain flat videos
export const DEFAULT_PROJECTION = 'FLAT';
