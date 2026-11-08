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
const STEREO_THRESHOLD = 0.85;

// Neither YouTube nor other sites say whether a video is 3D, so look at the frame: the two eyes'
// views sit side by side (or above each other) and look nearly the same. Keyed by the mono
// projection the video is shown with. Each entry: the split, the 3D projection, and for flat
// videos how far the halves may be shifted sideways to match, as a fraction of an eye's width,
// since the eyes' views differ more there
const FLAT_SHIFT = 0.1;
const STEREO_VARIANTS = {
    EAC: [['LR', 'EAC_LR']],
    360: [
        ['TB', '360_TB'],
        ['LR', '360_LR'],
    ],
    180: [['LR', '180_LR']],
    FLAT: [
        ['LR', 'FLAT_LR', FLAT_SHIFT],
        ['TB', 'FLAT_TB', FLAT_SHIFT],
    ],
};
// Frames that must agree before the projection is settled. Most flat videos are mono, and a
// symmetric shot could pass for 3D, so they need one more.
const VOTES_NEEDED = { FLAT: 3 };
// Flat 3D halves match less well even with the shift (squeezed to half height, older footage);
// mono flat videos score below 0.5 even so
const THRESHOLDS = { FLAT: 0.7 };

const STEREO_CHECK_MS = 200; // a check scales one frame down to 64x64, so it's cheap
const STEREO_MAX_CHECKS = 60000 / STEREO_CHECK_MS;

// Switches a VRPlayer showing a mono projection to its 3D variant if the frames have that
// layout. Samples frames until enough agree, skipping frames too dark or plain to tell.
// isCurrent: whether the player is still in use; skip: whether to ignore the current frame
// (YouTube's ads). Stops when the projection is changed by anything else, e.g. the user.
export function detectStereo(
    vrPlayer,
    { isCurrent, skip = () => false },
    mono = vrPlayer.projection,
    votes = {},
    attempt = 0,
) {
    const variants = STEREO_VARIANTS[mono];
    if (!variants || !isCurrent() || vrPlayer.projection !== mono) return;
    const skipped = skip();
    if (!skipped) {
        // the layout whose halves match best, if it's close enough; one layout's eyes can look
        // somewhat alike split the other way too
        let vote = null;
        let best = -1;
        for (const [split, stereo, shift] of variants) {
            const similarity = halvesCorrelation(vrPlayer.video, split, shift);
            if (similarity === null) continue;
            console.log(`video2webxr: ${split} halves correlation ${similarity.toFixed(2)}`);
            vote ??= mono;
            if (similarity > (THRESHOLDS[mono] ?? STEREO_THRESHOLD) && similarity > best) {
                vote = stereo;
                best = similarity;
            }
        }
        if (vote) {
            votes[vote] = (votes[vote] || 0) + 1;
            if (votes[vote] === (VOTES_NEEDED[mono] ?? 2)) {
                vrPlayer.setProjection(vote);
                return;
            }
        }
    }
    // give up after a minute of the actual video (skipped frames don't count) without a clear answer
    const checked = skipped ? attempt : attempt + 1;
    if (checked < STEREO_MAX_CHECKS)
        setTimeout(() => detectStereo(vrPlayer, { isCurrent, skip }, mono, votes, checked), STEREO_CHECK_MS);
}
