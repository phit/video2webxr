// The depth model for "Flat screen 3D (AI)", shared by the content scripts (depth.js) and the
// service worker that downloads it (background.js), kept free of the ONNX runtime.
// Depth Anything V2 Small (Apache 2.0) in onnx-community's ONNX conversion, 16-bit floats. The
// 19 MB 4-bit version measures the same, but felt less steady in the headset. Pinned to a
// commit, and checked against its hash, so the file can't change under us.
export const MODEL = {
    url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_fp16.onnx',
    size: 49642442,
    sha256: '2df6223f206b5164e21f664ace61dabeb9bb6a49b8b5a3e00510b4807d0f5b04',
};

// The port content scripts open to the service worker to get the model
export const MODEL_PORT = 'depth-model';
