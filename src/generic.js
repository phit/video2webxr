import { DEFAULT_PROJECTION } from './projections.js';
import { VRPlayer } from './vr-player.js';

// Injected by the popup into the frame with the largest video. The popup sends commands; the
// page itself gets no controls, so sites with lightboxes or focus traps aren't disturbed.
// Chrome only starts a VR session from a user gesture in the page, so "arm" waits for the next
// click on the video and enters VR from there.

const NOT_READABLE_CORS =
    "This site serves the video from another domain without allowing it to be read (CORS), so it can't be shown in VR.";

function findVideos(root = document) {
    const videos = [...root.querySelectorAll('video')];
    for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) videos.push(...findVideos(element.shadowRoot));
    }
    return videos;
}

function largestVideo() {
    const area = (video) => {
        const r = video.getBoundingClientRect();
        return r.width * r.height;
    };
    return findVideos().sort((a, b) => area(b) - area(a))[0];
}

function waitFor(video, event, timeout) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${event}`)), timeout);
        video.addEventListener(
            event,
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
        video.addEventListener('error', () => reject(new Error('video error')), { once: true });
    });
}

// WebGL can only use video frames the page is allowed to read
function isReadable(video) {
    try {
        const context = document.createElement('canvas').getContext('2d');
        context.drawImage(video, 0, 0, 1, 1);
        context.getImageData(0, 0, 1, 1);
        return true;
    } catch (e) {
        if (e.name === 'SecurityError') return false;
        throw e;
    }
}

// Reloads the video in CORS mode, keeping its position, for sites whose video server allows
// cross-origin reads but whose <video> element doesn't ask for them (e.g. Wikimedia Commons)
async function reloadWithCors(video, crossOrigin) {
    const time = video.currentTime;
    const playing = !video.paused;
    if (crossOrigin) video.crossOrigin = crossOrigin;
    else video.removeAttribute('crossorigin');
    video.load();
    await waitFor(video, 'loadeddata', 10000);
    video.currentTime = time;
    if (playing) video.play().catch(() => {});
}

// Returns why the video can't be used in VR, or null if it can
async function whyUnusable(video) {
    if (video.mediaKeys) {
        return "This video is DRM-protected, so the browser won't let it be shown in VR.";
    }
    if (video.readyState < video.HAVE_CURRENT_DATA) {
        await waitFor(video, 'loadeddata', 5000).catch(() => {});
        if (video.readyState < video.HAVE_CURRENT_DATA) return null; // can't tell yet
    }
    if (isReadable(video)) return null;
    if (video.crossOrigin !== null || video.currentSrc.startsWith('blob:')) return NOT_READABLE_CORS;
    try {
        await reloadWithCors(video, 'anonymous');
        if (isReadable(video)) return null;
    } catch {
        // the server doesn't allow CORS after all; put the site's video back as it was
        await reloadWithCors(video, null).catch(() => {});
    }
    return NOT_READABLE_CORS;
}

function createController() {
    let state = 'idle'; // idle | armed | starting | active
    let lastError = null;
    let projection = DEFAULT_PROJECTION;
    let video = null;
    let player = null;
    let hint = null;
    let removedCheck = null;

    function showHint(text) {
        hideHint();
        const rect = video.getBoundingClientRect();
        hint = document.createElement('div');
        hint.textContent = text;
        Object.assign(hint.style, {
            position: 'fixed',
            left: `${rect.left + rect.width / 2}px`,
            top: `${rect.top + rect.height / 2}px`,
            transform: 'translate(-50%, -50%)',
            zIndex: '2147483647',
            pointerEvents: 'none', // clicks go through to the video
            padding: '12px 18px',
            borderRadius: '6px',
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            font: 'normal 15px sans-serif',
        });
        // next to the video, so it shows inside lightboxes and fullscreen elements too
        (video.parentElement || document.body).appendChild(hint);
    }

    function hideHint() {
        hint?.remove();
        hint = null;
    }

    // All events of the click that enters VR. The site must see none of them, or it may pause the
    // video, close its lightbox or start a drag.
    const GESTURE_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click'];
    let gestureStarted = false;
    let vrRequested = false;
    let gestureTimeout = null;

    function isOnVideo(event) {
        const { clientX, clientY } = event.changedTouches?.[0] ?? event;
        const rect = video.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    // Chrome only starts VR from events that count as user activation
    function activatesUser(event) {
        if (event.type === 'pointerdown') return event.pointerType !== 'touch';
        if (event.type === 'pointerup') return event.pointerType === 'touch';
        return event.type === 'mousedown' || event.type === 'touchend' || event.type === 'click';
    }

    function listenToGesture(listen) {
        for (const type of GESTURE_EVENTS) {
            if (listen) window.addEventListener(type, onGestureEvent, { capture: true, passive: false });
            else window.removeEventListener(type, onGestureEvent, true);
        }
    }

    // capture phase on window, so this runs before the site's own handlers
    function onGestureEvent(event) {
        if (!gestureStarted) {
            if (!isOnVideo(event)) return;
            gestureStarted = true;
            // swallow the rest of this click wherever it ends, then stop listening
            gestureTimeout = setTimeout(endGesture, 1000);
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!vrRequested && activatesUser(event)) {
            vrRequested = true;
            startVR();
        }
        if (event.type === 'click') endGesture();
    }

    function endGesture() {
        clearTimeout(gestureTimeout);
        listenToGesture(false);
        gestureStarted = false;
        vrRequested = false;
    }

    function startVR() {
        hideHint();
        // the site doesn't see this click, so start playback ourselves
        if (video.paused) video.play().catch(() => {});
        player = new VRPlayer(video, projection);
        state = 'starting';
        console.log('video2webxr: entering VR');
        player
            .enterVR()
            .then((session) => {
                console.log('video2webxr: in VR');
                state = 'active';
                session.addEventListener('end', stop);
            })
            .catch((e) => {
                console.warn('video2webxr: entering VR failed:', e);
                stop();
                lastError = `Entering VR failed: ${e.message}`;
            });
    }

    function stop() {
        endGesture();
        hideHint();
        clearInterval(removedCheck);
        video?.removeEventListener('emptied', stop);
        player?.dispose();
        player = null;
        state = 'idle';
    }

    async function arm(newProjection) {
        projection = newProjection;
        lastError = null;
        if (state === 'active') {
            player.setProjection(projection);
            return { state };
        }
        stop();
        video = largestVideo();
        if (!video) return { error: 'No video found on this page.' };
        const problem = await whyUnusable(video);
        if (problem) return { error: problem };
        // stop when the site swaps or removes the video
        video.addEventListener('emptied', stop);
        removedCheck = setInterval(() => {
            if (!video.isConnected) stop();
        }, 1000);
        listenToGesture(true);
        showHint('Click the video to enter VR');
        state = 'armed';
        return { state };
    }

    return {
        get state() {
            return state;
        },
        async handle(message) {
            switch (message.type) {
                case 'state':
                    return { state, projection, error: lastError };
                case 'arm':
                    return arm(message.projection);
                case 'setProjection':
                    projection = message.projection;
                    player?.setProjection(projection);
                    return { state };
                case 'stop':
                    stop();
                    return { state };
            }
        },
    };
}

// the popup may inject this script more than once
if (!window.__video2webxr) {
    window.__video2webxr = createController();
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        window.__video2webxr.handle(message).then(sendResponse, (e) => sendResponse({ error: e.message }));
        return true; // responds asynchronously
    });
}
