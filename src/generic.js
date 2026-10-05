import { VRPlayer, styleControl } from './vr-player.js';

// Injected by background.js into the frame with the largest video when the toolbar button is
// clicked. Running it again in the same frame turns VR off.

// Most VR videos on other sites are 180° side by side
const DEFAULT_PROJECTION = '180_LR';

function findVideos(root = document) {
    const videos = [...root.querySelectorAll('video')];
    for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) videos.push(...findVideos(element.shadowRoot));
    }
    return videos;
}

function largestVideo() {
    const area = (video) => { const r = video.getBoundingClientRect(); return r.width * r.height; };
    return findVideos().sort((a, b) => area(b) - area(a))[0];
}

// WebGL can only use video frames the page is allowed to read
function whyUnusable(video) {
    if (video.mediaKeys) {
        return "This video is DRM-protected, so the browser won't let it be shown in VR.";
    }
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
        try {
            const context = document.createElement('canvas').getContext('2d');
            context.drawImage(video, 0, 0, 1, 1);
            context.getImageData(0, 0, 1, 1);
        } catch (e) {
            if (e.name === 'SecurityError') {
                return "This site serves the video from another domain without allowing it to be read (CORS), so it can't be shown in VR.";
            }
        }
    }
    return null;
}

function start(video) {
    const player = new VRPlayer(video, DEFAULT_PROJECTION);

    const closeButton = document.createElement('button');
    closeButton.textContent = 'CLOSE';
    styleControl(closeButton);

    const panel = document.createElement('div');
    Object.assign(panel.style, {
        position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647',
        padding: '8px', borderRadius: '6px', background: 'rgba(0,0,0,0.7)'
    });
    panel.appendChild(player.createControls(closeButton));
    (document.fullscreenElement || document.body).appendChild(panel);

    const close = () => {
        console.log("disabling VR");
        clearInterval(removedCheck);
        video.removeEventListener('emptied', close);
        player.dispose();
        panel.remove();
        delete window.__pcvrGeneric;
    };
    closeButton.onclick = close;
    // stop when the site swaps or removes the video
    video.addEventListener('emptied', close);
    const removedCheck = setInterval(() => { if (!video.isConnected) close(); }, 1000);

    window.__pcvrGeneric = { close };
}

function main() {
    if (window.__pcvrGeneric) {
        window.__pcvrGeneric.close();
        return;
    }
    // YouTube has its own integration behind the cardboard icon
    const cardboard = document.querySelector('#cardboardimg');
    if (cardboard) {
        cardboard.click();
        return;
    }
    const video = largestVideo();
    if (!video) {
        alert('No video found on this page.');
        return;
    }
    const problem = whyUnusable(video);
    if (problem) {
        alert(problem);
        return;
    }
    console.log("enabling VR on " + video.currentSrc);
    start(video);
}

main();
