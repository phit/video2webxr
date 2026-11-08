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
// (top/bottom); null if the frame can't be read or is too plain to tell. With maxShift, the
// halves are also compared shifted sideways by up to that fraction of an eye's width, and the
// best match counts: flat 3D videos have more parallax between the eyes than 360° ones.
export function halvesCorrelation(video, split, maxShift = 0) {
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
    const luma = (p) => pixels[p] * 0.3 + pixels[p + 1] * 0.59 + pixels[p + 2] * 0.11;
    // each eye's size in the scaled frame, and where the second eye starts
    const width = split === 'LR' ? SIZE / 2 : SIZE;
    const height = split === 'LR' ? SIZE : SIZE / 2;
    const second = split === 'LR' ? SIZE / 2 : (SIZE / 2) * SIZE;
    const shift = Math.round(maxShift * width);
    // the same pixels of both eyes, the second shifted by s, leaving out the shift at each side
    let best = null;
    const columns = width - 2 * shift;
    for (let s = -shift; s <= shift; s++) {
        const a = new Float32Array(columns * height);
        const b = new Float32Array(columns * height);
        let i = 0;
        for (let y = 0; y < height; y++) {
            for (let x = shift; x < width - shift; x++) {
                a[i] = luma((y * SIZE + x) * 4);
                b[i] = luma((y * SIZE + x + s + second) * 4);
                i++;
            }
        }
        const c = correlation(a, b);
        if (c !== null && (best === null || c > best)) best = c;
    }
    return best;
}

// Above this the halves are taken to be the two eyes of one picture
export const STEREO_THRESHOLD = 0.85;
