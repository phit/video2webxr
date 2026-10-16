// Tells 3D videos from mono ones by their pixels: a 3D frame holds the two eyes' views next to
// each other (or above each other), and those are nearly the same picture.

const SIZE = 64; // the frame is scaled down to SIZE x SIZE, which is plenty to compare halves

// Correlation of two equally long brightness arrays, from -1 to 1; null if either is flat
function correlation(a, b) {
    const n = a.length;
    let meanA = 0;
    let meanB = 0;
    for (let i = 0; i < n; i++) {
        meanA += a[i];
        meanB += b[i];
    }
    meanA /= n;
    meanB /= n;
    let cov = 0;
    let varA = 0;
    let varB = 0;
    for (let i = 0; i < n; i++) {
        const da = a[i] - meanA;
        const db = b[i] - meanB;
        cov += da * db;
        varA += da * da;
        varB += db * db;
    }
    // a black or single-coloured frame (fades, intros) says nothing
    if (varA / n < 25 || varB / n < 25) return null;
    return cov / Math.sqrt(varA * varB);
}

// How alike the two halves of the current frame are, split 'LR' (left/right) or 'TB'
// (top/bottom); null if the frame can't be read or is too plain to tell
export function halvesCorrelation(video, split) {
    if (video.readyState < video.HAVE_CURRENT_DATA) return null;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let pixels;
    try {
        context.drawImage(video, 0, 0, SIZE, SIZE);
        pixels = context.getImageData(0, 0, SIZE, SIZE).data;
    } catch {
        return null; // not readable (CORS)
    }
    const half = SIZE / 2;
    const a = new Float32Array(half * SIZE);
    const b = new Float32Array(half * SIZE);
    let i = 0;
    for (let y = 0; y < (split === 'LR' ? SIZE : half); y++) {
        for (let x = 0; x < (split === 'LR' ? half : SIZE); x++) {
            const other = split === 'LR' ? (y * SIZE + x + half) * 4 : ((y + half) * SIZE + x) * 4;
            const own = (y * SIZE + x) * 4;
            a[i] = pixels[own] * 0.3 + pixels[own + 1] * 0.59 + pixels[own + 2] * 0.11;
            b[i] = pixels[other] * 0.3 + pixels[other + 1] * 0.59 + pixels[other + 2] * 0.11;
            i++;
        }
    }
    return correlation(a, b);
}

// Above this the halves are taken to be the two eyes of one picture
export const STEREO_THRESHOLD = 0.85;
