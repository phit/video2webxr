import cardboardSvg from '../icons/cardboard.svg';
import { armClick } from './click-to-enter.js';
import { t } from './i18n.js';
import { debug } from './log.js';
import { createPageControls } from './page-controls.js';
import { answerPopup, COMMANDS } from './popup-protocol.js';
import { youtubeProjection } from './projections.js';
import { detectStereo } from './stereo.js';
import { VRPlayer } from './vr-player.js';

let player = null;
let pageControls = null; // below the video while VR is enabled

function handleCardboardIconClick(event) {
    if (player) return; // already on
    enableVRVideo(event.currentTarget.closest('.html5-video-player'));
}

// A button like the player's own, so it has a tooltip and works from the keyboard
function createCardboardIcon() {
    const button = document.createElement('button');
    button.id = 'cardboardimg';
    button.className = 'ytp-button';
    button.title = t('watchInVR');
    button.setAttribute('aria-label', t('watchInVR'));
    button.style.padding = '12px';
    button.style.boxSizing = 'border-box';
    const image = document.createElement('img');
    image.src = `data:image/svg+xml,${encodeURIComponent(cardboardSvg)}`;
    image.alt = '';
    Object.assign(image.style, { display: 'block', width: '100%', height: '100%' });
    button.append(image);
    button.onclick = handleCardboardIconClick;
    return button;
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

function detectProjection() {
    const info = playerInfo();
    debug('YouTube player info', info);
    return youtubeProjection(info);
}

// Everything is looked up from the player whose icon was clicked: YouTube keeps pages it
// navigated away from in the DOM, hidden, so a channel page's #alerts comes before the
// watch page's in the document. picked: a projection the user chose in the popup, which skips
// the detection
function enableVRVideo(ytPlayer, picked) {
    const videoElement = ytPlayer.querySelector('video');

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

    // the Enter VR button and projection dropdown, below the video, next to YouTube's own notices
    pageControls = createPageControls(player);
    ytPlayer.closest('ytd-watch-flexy')?.querySelector('#alerts')?.appendChild(pageControls);
}

// YouTube switches videos without a page load, so tear everything down when it navigates;
// the cardboard icon can then enable VR again on the next video
document.addEventListener('yt-navigate-start', () => {
    if (!player) return;
    disarm?.();
    disarm = null;
    pageControls?.remove();
    pageControls = null;
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
    else if (player.starting) state = 'starting';
    else if (disarm) state = 'armed';
    return { state, projection: player.projection, error: player.lastError ?? null };
}

function arm(picked) {
    if (!player) {
        const ytPlayer = document.querySelector('#movie_player');
        if (!ytPlayer?.querySelector('video')) return { error: t('noVideo') };
        enableVRVideo(ytPlayer, picked);
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

answerPopup((message) => {
    switch (message.type) {
        case COMMANDS.STATE:
            return popupState();
        case COMMANDS.ARM:
            return arm(message.projection);
        case COMMANDS.SET_PROJECTION:
            player?.setProjection(message.projection);
            return popupState();
        case COMMANDS.STOP:
            disarm?.();
            disarm = null;
            player?.renderer.xr.getSession()?.end();
            return popupState();
    }
});
