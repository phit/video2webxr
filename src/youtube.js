import cardboardSvg from '../icons/cardboard.svg';
import { VRPlayer } from './vr-player.js';

let player = null;

// Function to be executed when the cardboard icon is clicked
function handleCardboardIconClick() {
    const videoElement = document.querySelectorAll('video')[0];
    console.log('clicked cardboard button');
    if (player) {
        console.log('VR already enabled, ignoring click');
        return;
    }
    EnableVRVideo(videoElement);
}

// Function to add the cardboard icon to a video element
function addCardboardIconToVideo() {
    // Check if the img has already been added
    const iconCheck = document.querySelector('#cardboardimg');
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

    const rightControls = document.querySelector('.ytp-right-controls');
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

function EnableVRVideo(videoElement) {
    console.log(`enabling VR on ${videoElement}`);

    // remove the webgl viewer of the 360 video
    const webgl = document.querySelector('.webgl');
    if (webgl) {
        webgl.remove();
    }
    const spherecontrol = document.querySelector('.ytp-webgl-spherical-control');
    if (spherecontrol) {
        spherecontrol.remove();
    }

    // EAC is what YouTube serves 360° videos as on desktop
    player = new VRPlayer(videoElement, 'EAC');

    const container = document.querySelector('.html5-video-container');
    container.appendChild(player.canvas);

    // clean alerts box and add VR button
    const alertsbox = document.querySelector('#alerts');
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
