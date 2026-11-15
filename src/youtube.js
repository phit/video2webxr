import cardboardSvg from '../icons/cardboard.svg';
import { armClick } from './click-to-enter.js';
import { detectStereo } from './stereo.js';
import { VRPlayer } from './vr-player.js';

let player = null;

function handleCardboardIconClick(event) {
    if (player) return; // already on
    EnableVRVideo(event.currentTarget.closest('.html5-video-player'));
}

function createCardboardIcon() {
    const icon = document.createElement('img');
    icon.src = `data:image/svg+xml,${encodeURIComponent(cardboardSvg)}`;
    icon.style.padding = '12px';
    icon.style.boxSizing = 'border-box';
    icon.id = 'cardboardimg';
    icon.className = 'ytp-button';
    icon.onclick = handleCardboardIconClick;
    return icon;
}

// Puts the icon in the main player's controls (not the home page's hover previews). YouTube
// builds the player late, so the whole page is watched until the controls exist; after that
// only the controls, in case YouTube rebuilds them.
const observer = new MutationObserver(addCardboardIcon);
let watched = null;
function addCardboardIcon() {
    const controls = document.querySelector('#movie_player .ytp-right-controls');
    if (controls && !controls.querySelector('#cardboardimg')) controls.appendChild(createCardboardIcon());
    const target = controls ?? document;
    if (target === watched) return;
    observer.disconnect();
    observer.observe(target, { childList: true, subtree: !controls });
    watched = target;
}
addCardboardIcon();
document.addEventListener('yt-navigate-finish', addCardboardIcon);

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

// Everything is looked up from the player whose icon was clicked: YouTube keeps pages it
// navigated away from in the DOM, hidden, so a channel page's #alerts comes before the
// watch page's in the document. picked: a projection the user chose in the popup, which skips
// the detection
function EnableVRVideo(ytPlayer, picked) {
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

    const projection = picked || detectProjection();
    player = new VRPlayer(videoElement, projection);
    // YouTube doesn't say whether a video is 3D; ads play in the same <video>, so skip those
    const vrPlayer = player;
    if (!picked)
        detectStereo(vrPlayer, {
            isCurrent: () => player === vrPlayer,
            skip: () => !!ytPlayer.classList.contains('ad-showing'),
        });

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
    disarm?.();
    disarm = null;
    player.dispose();
    player = null;
});

// The toolbar popup's commands, the same ones generic.js answers on other sites, so VR can be
// started from there too. YouTube's own player is used either way: the popup turns it on like
// the cardboard icon, then waits for a click on the video, since Chrome only starts VR from a
// click in the page.
let disarm = null; // stops waiting for that click

function popupState() {
    if (!player) return { state: 'none' };
    let state = 'idle';
    if (player.renderer.xr.isPresenting) state = 'active';
    else if (disarm) state = 'armed';
    return { state, projection: player.projection, error: player.lastError ?? null };
}

function arm(picked) {
    if (!player) {
        const ytPlayer = document.querySelector('#movie_player');
        if (!ytPlayer?.querySelector('video')) return { error: 'No video found on this page.' };
        EnableVRVideo(ytPlayer, picked);
    } else if (picked) {
        player.setProjection(picked);
    }
    if (player.renderer.xr.isPresenting) return popupState();
    disarm?.();
    const armed = player;
    disarm = armClick(armed.video, () => {
        disarm = null;
        // YouTube doesn't see this click, so start playback here
        if (armed.video.paused) armed.video.play().catch(() => {});
        armed.startSession();
    });
    return popupState();
}

function handlePopup(message) {
    switch (message.type) {
        case 'state':
            return popupState();
        case 'arm':
            return arm(message.projection);
        case 'setProjection':
            player?.setProjection(message.projection);
            return popupState();
        case 'stop':
            disarm?.();
            disarm = null;
            player?.renderer.xr.getSession()?.end();
            return popupState();
    }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
        sendResponse(handlePopup(message));
    } catch (e) {
        sendResponse({ error: e.message });
    }
});
