import cardboardSvg from '../icons/cardboard.svg';
import { halvesCorrelation, STEREO_THRESHOLD } from './stereo.js';
import { VRPlayer } from './vr-player.js';

let player = null;

// Function to be executed when the cardboard icon is clicked
function handleCardboardIconClick(event) {
    console.log('clicked cardboard button');
    if (player) {
        console.log('VR already enabled, ignoring click');
        return;
    }
    EnableVRVideo(event.currentTarget.closest('.html5-video-player'));
}

// Function to add the cardboard icon to a video element
function addCardboardIconToVideo() {
    // Check if the img has already been added
    const iconCheck = document.querySelector('#movie_player #cardboardimg');
    if (iconCheck) {
        return;
    }
    // Create a new <img> element for the cardboard icon
    const iconImg = document.createElement('img');
    iconImg.src = `data:image/svg+xml,${encodeURIComponent(cardboardSvg)}`;
    iconImg.style.padding = '12px';
    iconImg.style.boxSizing = 'border-box';
    iconImg.id = 'cardboardimg';
    iconImg.className = 'ytp-button';

    // Attach the onclick event to the cardboard icon
    iconImg.onclick = handleCardboardIconClick;

    // the main player, not the home page's hover previews
    const rightControls = document.querySelector('#movie_player .ytp-right-controls');
    if (rightControls) {
        // Append the image to the div element
        rightControls.appendChild(iconImg);
    }
}

// Create a MutationObserver to watch for new video elements
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((addedNode) => {
            // Check if the added node is a video element
            if (addedNode instanceof HTMLVideoElement) {
                addCardboardIconToVideo(addedNode);
            }
        });
    });
});

// Attach the cardboard icon to each video element
const videoElements = document.querySelectorAll('video');
videoElements.forEach((video) => {
    addCardboardIconToVideo(video);
});

// Start observing the entire document for changes
observer.observe(document, { childList: true, subtree: true });

// Asks youtube-page.js, which can reach YouTube's player, for the video's projection data.
// DOM events are dispatched synchronously, so the answer is there when dispatchEvent returns.
function playerInfo() {
    let info = null;
    const onInfo = (event) => {
        info = JSON.parse(event.detail);
    };
    document.addEventListener('video2webxr-info', onInfo);
    document.dispatchEvent(new CustomEvent('video2webxr-info-request'));
    document.removeEventListener('video2webxr-info', onInfo);
    return info;
}

// The projection YouTube says the video has. YouTube serves both 360° and VR180 videos as
// "MESH" on desktop; VR180 ones are marked partialSpherical.
function detectProjection() {
    const info = playerInfo();
    console.log('video2webxr: YouTube player info', info);
    if (!info) return 'EAC';
    const is180 = info.partialSpherical;
    if (info.projections.includes('MESH')) return is180 ? '180' : 'EAC';
    if (info.projections.includes('EQUIRECTANGULAR')) return is180 ? '180' : '360';
    return 'FLAT';
}

// YouTube doesn't say whether a video is 3D, so look at the frame: the two eyes' views sit
// side by side (or above each other) and look nearly the same. Each entry: the split, the 3D
// projection, and for flat videos how far the halves may be shifted sideways to match, as a
// fraction of an eye's width, since the eyes' views differ more there
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

// Samples frames until two agree on the layout, skipping ads (they play in the same <video>)
// and frames too dark or plain to tell
function detectStereo(vrPlayer, mono, votes = {}, attempt = 0) {
    const variants = STEREO_VARIANTS[mono];
    // stop once the player is gone or the user picked a projection themselves
    if (!variants || player !== vrPlayer || vrPlayer.projection !== mono) return;
    const adShowing = document.querySelector('#movie_player')?.classList.contains('ad-showing');
    if (!adShowing) {
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
    // give up after a minute of the actual video (ads don't count) without a clear answer
    const checked = adShowing ? attempt : attempt + 1;
    if (checked < STEREO_MAX_CHECKS) setTimeout(() => detectStereo(vrPlayer, mono, votes, checked), STEREO_CHECK_MS);
}

// Everything is looked up from the player whose icon was clicked: YouTube keeps pages it
// navigated away from in the DOM, hidden, so a channel page's #alerts comes before the
// watch page's in the document
function EnableVRVideo(ytPlayer) {
    const videoElement = ytPlayer.querySelector('video');
    console.log(`enabling VR on ${videoElement}`);

    // remove the webgl viewer of the 360 video
    const webgl = ytPlayer.querySelector('.webgl');
    if (webgl) {
        webgl.remove();
    }
    const spherecontrol = ytPlayer.querySelector('.ytp-webgl-spherical-control');
    if (spherecontrol) {
        spherecontrol.remove();
    }

    const projection = detectProjection();
    player = new VRPlayer(videoElement, projection);
    detectStereo(player, projection);

    const container = ytPlayer.querySelector('.html5-video-container');
    container.appendChild(player.canvas);

    // clean alerts box and add VR button
    const alertsbox = ytPlayer.closest('ytd-watch-flexy')?.querySelector('#alerts');
    if (alertsbox) {
        if (alertsbox.firstChild) {
            alertsbox.removeChild(alertsbox.firstChild);
        }
        alertsbox.appendChild(player.createControls());
    }
}

// YouTube switches videos without a page load, so tear everything down when it navigates;
// the cardboard icon can then enable VR again on the next video
document.addEventListener('yt-navigate-start', () => {
    if (!player) return;
    console.log('disabling VR');
    player.dispose();
    player = null;
});
