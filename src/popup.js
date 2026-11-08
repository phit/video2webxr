import { DEFAULT_PROJECTION, depthSupported, PROJECTION_LABELS } from './projections.js';

// The extension's toolbar popup. Finds the largest video in the tab, injects generic.js into
// its frame and sends it commands. The page gets no controls of its own.

const status = document.getElementById('status');
const projectionSelect = document.getElementById('projection');
const enterButton = document.getElementById('enter');
const stopButton = document.getElementById('stop');

let tab;
let target = null; // { frameId, state } of the frame with the video
// On YouTube the extension's YouTube integration (youtube.js, always in the page) answers the
// same commands as generic.js, with its own projection detection
let onYouTube = false;

function setStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('error', isError);
}

function showState(state) {
    target.state = state;
    enterButton.hidden = state !== 'idle' && state !== 'none';
    stopButton.hidden = !enterButton.hidden;
    if (state === 'armed') setStatus('Click the video in the page to enter VR.');
    else if (state === 'starting')
        setStatus('Starting VR… check that SteamVR is running and no other browser is in VR.');
    else if (state === 'active') setStatus('In VR. Changing the projection applies right away.');
}

// Runs in each frame of the tab: the area of its largest video and the controller state
function probeFrame() {
    const videos = [];
    const walk = (root) => {
        videos.push(...root.querySelectorAll('video'));
        for (const element of root.querySelectorAll('*')) {
            if (element.shadowRoot) walk(element.shadowRoot);
        }
    };
    walk(document);
    const area = Math.max(
        0,
        ...videos.map((video) => video.getBoundingClientRect().width * video.getBoundingClientRect().height),
    );
    return { area, state: window.__video2webxr ? window.__video2webxr.state : 'none' };
}

async function findTarget() {
    let frames;
    try {
        frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: probeFrame });
    } catch {
        // some frames are off limits; fall back to the top frame
        frames = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: probeFrame });
    }
    const results = frames.filter((frame) => frame.result);
    // a frame that's already armed or in VR wins, so the popup can stop it
    const running = results.find((frame) => ['armed', 'starting', 'active'].includes(frame.result.state));
    const largest = results.filter((frame) => frame.result.area > 0).sort((a, b) => b.result.area - a.result.area)[0];
    const frame = running || largest;
    return frame && { frameId: frame.frameId, state: frame.result.state };
}

function send(message) {
    return chrome.tabs.sendMessage(tab.id, message, { frameId: target.frameId });
}

async function enter() {
    enterButton.disabled = true;
    try {
        if (target.state === 'none' && !onYouTube) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id, frameIds: [target.frameId] },
                files: ['generic.js'],
            });
        }
        // on YouTube an empty value means "detect automatically"
        const reply = await send({ type: 'arm', projection: projectionSelect.value || undefined });
        if (reply.error) setStatus(reply.error, true);
        else showState(reply.state);
        if (reply.projection) projectionSelect.value = reply.projection;
    } catch (e) {
        setStatus(`Couldn't start: ${e.message}`, true);
    }
    enterButton.disabled = false;
}

async function stop() {
    const reply = await send({ type: 'stop' }).catch(() => ({ state: 'idle' }));
    showState(reply.state);
    setStatus('Stopped.');
}

async function init() {
    const withDepth = await depthSupported();
    for (const [value, label] of PROJECTION_LABELS) {
        if (value !== 'FLAT_AI' || withDepth) projectionSelect.add(new Option(label, value));
    }
    projectionSelect.value = localStorage.getItem('projection') || DEFAULT_PROJECTION;
    if (!projectionSelect.value) projectionSelect.value = DEFAULT_PROJECTION; // remembered but unavailable
    projectionSelect.onchange = () => {
        // the remembered choice is for other sites; YouTube detects the projection per video
        if (!onYouTube) localStorage.setItem('projection', projectionSelect.value);
        if (target && target.state !== 'none' && projectionSelect.value)
            send({ type: 'setProjection', projection: projectionSelect.value }).catch(() => {});
    };
    enterButton.onclick = enter;
    stopButton.onclick = stop;

    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (/^https?:\/\/([^/]+\.)?youtube\.com\/watch/.test(tab.url || '')) {
        await initYouTube();
        return;
    }
    if (/^https?:\/\/([^/]+\.)?youtube\.com\//.test(tab.url || '')) {
        setStatus('Open a video on YouTube to watch it in VR.');
        projectionSelect.disabled = true;
        return;
    }
    try {
        target = await findTarget();
    } catch {
        setStatus("This page can't be accessed by extensions.", true);
        return;
    }
    if (!target) {
        setStatus('No video found on this page.', true);
        return;
    }
    setStatus('Video found. Enter VR, then click the video in the page.');
    enterButton.disabled = false;
    showState(target.state);
    // tell the user why the last attempt didn't work
    if (target.state === 'idle') {
        const reply = await send({ type: 'state' }).catch(() => ({}));
        if (reply.error) setStatus(reply.error, true);
    }
}

async function initYouTube() {
    onYouTube = true;
    projectionSelect.add(new Option('Detect automatically', ''), 0);
    projectionSelect.value = '';
    target = { frameId: 0, state: 'none' };
    let reply;
    try {
        reply = await send({ type: 'state' });
    } catch {
        setStatus('Reload the page to use video2webxr on it.', true); // opened before the extension
        return;
    }
    enterButton.disabled = false;
    showState(reply.state);
    if (reply.projection) projectionSelect.value = reply.projection;
    if (reply.state === 'none' || reply.state === 'idle') {
        setStatus('Enter VR, then click the video. You can also use the cardboard icon in the player.');
    }
    if (reply.error) setStatus(reply.error, true);
}

init();
