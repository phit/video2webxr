import { DEFAULT_PROJECTION, depthSupported, PROJECTION_LABELS } from './projections.js';

// The extension's toolbar popup. Finds the largest video in the tab, injects generic.js into
// its frame and sends it commands. The page gets no controls of its own.

const status = document.getElementById('status');
const projectionSelect = document.getElementById('projection');
const enterButton = document.getElementById('enter');
const stopButton = document.getElementById('stop');
const allowButton = document.getElementById('allow');

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

// A video whose server doesn't allow reading it: { src, origin } from generic.js, the video's
// address and the origin of the page it plays in
let blocked = null;
// The access the next "Allow" asks for: 'servers' for just the video's server and the page,
// 'all' for every site, needed when the video's server redirects to another one (often a CDN)
// that can't be known in advance: a redirect's target can't be read without access to it
let allowScope = 'servers';
const ALL_SITES = ['<all_urls>'];

// The access a scope needs for a blocked video
function corsOrigins({ src, origin }, scope) {
    return scope === 'all' ? ALL_SITES : [...new Set([`${new URL(src).origin}/*`, `${origin}/*`])];
}

// Makes the video's server allow the page to read it: a session rule for this tab only that
// sets the CORS headers on media responses (from that server, or with 'all' from any, to cover
// redirects), with cookies allowed so the video loads like before. Only for requests from the
// page's site, so other sites opened in the tab later aren't affected; background.js removes it
// when the tab leaves that site or is closed.
async function allowReading({ src, origin }, scope) {
    const condition = { tabIds: [tab.id], resourceTypes: ['media'], initiatorDomains: [new URL(origin).hostname] };
    if (scope !== 'all') condition.requestDomains = [new URL(src).hostname];
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [tab.id],
        addRules: [
            {
                id: tab.id,
                priority: 1,
                action: {
                    type: 'modifyHeaders',
                    responseHeaders: [
                        { header: 'Access-Control-Allow-Origin', operation: 'set', value: origin },
                        { header: 'Access-Control-Allow-Credentials', operation: 'set', value: 'true' },
                    ],
                },
                condition,
            },
        ],
    });
}

// Asks for the access, then tries again. Chrome may close the popup while it asks; clicking
// Enter VR again then uses the access granted.
async function allow() {
    const granted = await chrome.permissions.request({ origins: corsOrigins(blocked, allowScope) }).catch(() => false);
    if (!granted) {
        setStatus("Without that access the video can't be read, so it can't be shown in VR.", true);
        return;
    }
    allowButton.hidden = true;
    await enter();
}

// Offers the next "Allow" for a blocked video, with why
function offerAllow(cors, scope, error) {
    blocked = cors;
    allowScope = scope;
    allowButton.textContent = scope === 'all' ? 'Allow on all sites and retry' : 'Allow and retry';
    allowButton.hidden = false;
    const host = new URL(cors.src).hostname;
    return scope === 'all'
        ? `${host} passes the video on to another server, which video2webxr can't know in advance, so it still can't be read. It can work around this if you allow it on all sites; it still only changes video responses in this tab.`
        : `${error} video2webxr can work around this if you allow it to access ${host}.`;
}

// Works around a video blocked by CORS with the widest access already granted, or offers to ask
// for (more) access. Returns the player's reply to the retry, or the reply with the offer.
async function workAround(reply, projection) {
    const tryWith = async (scope) => {
        await allowReading(reply.cors, scope);
        return send({ type: 'arm', projection, withHeader: true });
    };
    if (await chrome.permissions.contains({ origins: ALL_SITES })) return tryWith('all');
    if (!(await chrome.permissions.contains({ origins: corsOrigins(reply.cors, 'servers') }))) {
        return { ...reply, error: offerAllow(reply.cors, 'servers', reply.error) };
    }
    const retried = await tryWith('servers');
    return retried.cors ? { ...retried, error: offerAllow(retried.cors, 'all', retried.error) } : retried;
}

async function enter() {
    enterButton.disabled = true;
    allowButton.hidden = true;
    try {
        if (target.state === 'none' && !onYouTube) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id, frameIds: [target.frameId] },
                files: ['generic.js'],
            });
        }
        // on YouTube an empty value means "detect automatically"
        const projection = projectionSelect.value || undefined;
        let reply = await send({ type: 'arm', projection });
        if (reply.cors) reply = await workAround(reply, projection);
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
    allowButton.onclick = allow;

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
    if (target.state === 'none') return;
    const reply = await send({ type: 'state' }).catch(() => ({}));
    // in VR, the projection shown, which may have been detected as 3D
    if (target.state === 'active' && reply.projection) projectionSelect.value = reply.projection;
    // tell the user why the last attempt didn't work, and for a video blocked by CORS (found when
    // the video was clicked), how to get past it
    if (target.state === 'idle' && reply.error) setStatus(await explainBlocked(reply), true);
}

// The error for a blocked video, with what to do: Enter VR applies the workaround if the access
// is there already, otherwise "Allow and retry" asks for it
async function explainBlocked(reply) {
    if (!reply.cors) return reply.error;
    const granted = (scope) => chrome.permissions.contains({ origins: corsOrigins(reply.cors, scope) });
    if ((await granted('all')) || (await granted('servers'))) return `${reply.error} Click Enter VR to work around it.`;
    return offerAllow(reply.cors, 'servers', reply.error);
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
