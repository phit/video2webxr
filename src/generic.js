import { armClick, showMessage } from './click-to-enter.js';
import { t } from './i18n.js';
import { debug } from './log.js';
import { answerPopup, COMMANDS } from './popup-protocol.js';
import { DEFAULT_PROJECTION, enterVRError } from './projections.js';
import { detectStereo } from './stereo.js';
import { checkARSupport, VRPlayer } from './vr-player.js';

// Injected by the popup into the frame with the largest video. The popup sends commands; the
// page itself gets no controls, so sites with lightboxes or focus traps aren't disturbed.
// Chrome only starts a VR session from a user gesture in the page, so "arm" waits for the next
// click on the video and enters VR from there.

const NOT_READABLE_CORS = t('corsBlocked');
const NOT_READABLE_EVEN_ALLOWED = t('corsStillBlocked');

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

// Resolves on the video's next event, rejects on an error or after timeout ms; either way
// both listeners go
function waitFor(video, event, timeout) {
    const done = new AbortController();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${event}`)), timeout);
        video.addEventListener(event, resolve, { signal: done.signal });
        video.addEventListener('error', () => reject(new Error('video error')), { signal: done.signal });
        done.signal.addEventListener('abort', () => clearTimeout(timer));
    }).finally(() => done.abort());
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

// Where the video comes from, if the extension can make its server allow reading it: the
// popup then asks for access to that server and adds the missing CORS header (see popup.js).
// Not for blob: videos (fed by the page's own script) or data: URLs.
function corsFixable(video) {
    return /^https?:/.test(video.currentSrc) ? { src: video.currentSrc, origin: location.origin } : null;
}

// Returns why the video can't be used in VR, or null if it can. withHeader: the popup has made
// the video's server allow this page to read it, so reload the video in CORS mode, with the
// site's cookies like before.
async function whyUnusable(video, withHeader = false) {
    if (video.mediaKeys) {
        return t('drmProtected');
    }
    if (video.readyState < video.HAVE_CURRENT_DATA) {
        await waitFor(video, 'loadeddata', 5000).catch(() => {});
        if (video.readyState < video.HAVE_CURRENT_DATA) return null; // can't tell yet
    }
    if (isReadable(video)) return null;
    if (withHeader && corsFixable(video)) {
        try {
            await reloadWithCors(video, video.crossOrigin ?? 'use-credentials');
            if (isReadable(video)) return null;
        } catch {
            await reloadWithCors(video, null).catch(() => {});
        }
        return NOT_READABLE_EVEN_ALLOWED;
    }
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
    let lastCors = null; // the blocked video's source, for the popup's workaround
    let projection = DEFAULT_PROJECTION;
    let video = null;
    let player = null;
    let removedCheck = null;
    let disarm = null; // stops waiting for the click on the video

    // The video turned out to be blocked by CORS after arming: stop, and leave the popup what it
    // needs to offer the workaround
    function blocked() {
        const blockedVideo = video;
        stop();
        lastError = NOT_READABLE_CORS;
        lastCors = corsFixable(blockedVideo);
        showMessage(blockedVideo, t('cantReadYet'));
    }

    function startVR() {
        // arming can't tell a video that hasn't loaded a frame yet (some sites only load it on
        // play), so check again now: blocked by CORS, VR would only show black
        if (!isReadable(video)) {
            blocked();
            return;
        }
        // no frame even now: check the first one when it arrives
        if (video.readyState < video.HAVE_CURRENT_DATA) {
            const clicked = video;
            clicked.addEventListener(
                'loadeddata',
                () => {
                    if (video === clicked && player && !isReadable(clicked)) blocked();
                },
                { once: true },
            );
        }
        // the site doesn't see this click, so start playback ourselves
        if (video.paused) video.play().catch(() => {});
        player = new VRPlayer(video, projection);
        // a mono projection switches to its 3D variant if the frames turn out to be 3D
        const vrPlayer = player;
        detectStereo(vrPlayer, { isCurrent: () => player === vrPlayer });
        state = 'starting';
        debug('entering VR');
        player
            .enterVR()
            .then((session) => {
                debug('in VR');
                state = 'active';
                session.addEventListener('end', stop);
            })
            .catch((e) => {
                console.warn('video2webxr: entering VR failed:', e);
                stop();
                lastError = enterVRError(e);
            });
    }

    function stop() {
        disarm?.();
        disarm = null;
        clearInterval(removedCheck);
        video?.removeEventListener('emptied', stop);
        player?.dispose();
        player = null;
        state = 'idle';
    }

    // withHeader: see whyUnusable()
    async function arm(newProjection, withHeader) {
        projection = newProjection;
        lastError = null;
        lastCors = null;
        if (state === 'active') {
            player.setProjection(projection);
            return { state };
        }
        stop();
        checkARSupport();
        video = largestVideo();
        if (!video) return { error: t('noVideo') };
        const problem = await whyUnusable(video, withHeader);
        if (problem === NOT_READABLE_CORS || problem === NOT_READABLE_EVEN_ALLOWED)
            return { error: problem, cors: corsFixable(video) };
        if (problem) return { error: problem };
        // stop when the site swaps or removes the video
        video.addEventListener('emptied', stop);
        removedCheck = setInterval(() => {
            if (!video.isConnected) stop();
        }, 1000);
        disarm = armClick(video, startVR);
        state = 'armed';
        return { state };
    }

    return {
        get state() {
            return state;
        },
        async handle(message) {
            switch (message.type) {
                case COMMANDS.STATE:
                    return { state, projection: player?.projection ?? projection, error: lastError, cors: lastCors };
                case COMMANDS.ARM:
                    return arm(message.projection, message.withHeader);
                case COMMANDS.SET_PROJECTION:
                    projection = message.projection;
                    player?.setProjection(projection);
                    return { state };
                case COMMANDS.STOP:
                    stop();
                    return { state };
            }
        },
    };
}

// the popup may inject this script more than once
if (!window.__video2webxr) {
    window.__video2webxr = createController();
    answerPopup((message) => window.__video2webxr.handle(message));
}
