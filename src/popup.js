import { ALL_SITES, corsOrigins, corsRule } from './cors-rule.js';
import { localizePage, t } from './i18n.js';
import { COMMANDS } from './popup-protocol.js';
import { DEFAULT_PROJECTION, depthSupported, PROJECTION_IDS, projectionLabel } from './projections.js';
import { loadSettings, rememberSiteProjection, saveSettings, siteProjections } from './settings.js';

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
    if (state === 'armed') setStatus(t('statusArmed'));
    else if (state === 'starting') setStatus(t('statusStarting'));
    else if (state === 'active') setStatus(t('statusActive'));
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

// Applies the workaround for this tab, see cors-rule.js
async function allowReading(cors, scope) {
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [tab.id],
        addRules: [corsRule(tab.id, cors, scope)],
    });
}

// Asks for the access, then tries again. Chrome may close the popup while it asks; clicking
// Enter VR again then uses the access granted.
async function allow() {
    const granted = await chrome.permissions.request({ origins: corsOrigins(blocked, allowScope) }).catch(() => false);
    if (!granted) {
        setStatus(t('accessDenied'), true);
        return;
    }
    allowButton.hidden = true;
    await enter();
}

// Offers the next "Allow" for a blocked video, with why
function offerAllow(cors, scope, error) {
    blocked = cors;
    allowScope = scope;
    allowButton.textContent = t(scope === 'all' ? 'allowAllRetry' : 'allowRetry');
    allowButton.hidden = false;
    const host = new URL(cors.src).hostname;
    return scope === 'all' ? t('corsRedirect', host) : t('corsOffer', error, host);
}

// Works around a video blocked by CORS with the widest access already granted, or offers to ask
// for (more) access. Returns the player's reply to the retry, or the reply with the offer.
async function workAround(reply, projection) {
    const tryWith = async (scope) => {
        await allowReading(reply.cors, scope);
        return send({ type: COMMANDS.ARM, projection, withHeader: true });
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
        let reply = await send({ type: COMMANDS.ARM, projection });
        if (reply.cors) reply = await workAround(reply, projection);
        if (reply.error) setStatus(reply.error, true);
        else showState(reply.state);
        if (reply.projection) projectionSelect.value = reply.projection;
    } catch (e) {
        setStatus(t('couldntStart', e.message), true);
    }
    enterButton.disabled = false;
}

async function stop() {
    const reply = await send({ type: COMMANDS.STOP }).catch(() => ({ state: 'idle' }));
    showState(reply.state);
    setStatus(t('stopped'));
}

async function init() {
    localizePage();
    const withDepth = await depthSupported();
    for (const id of PROJECTION_IDS) {
        if (id !== 'FLAT_AI' || withDepth) projectionSelect.add(new Option(projectionLabel(id), id));
    }
    document.getElementById('settings').onclick = () => chrome.runtime.openOptionsPage();
    enterButton.onclick = enter;
    stopButton.onclick = stop;
    allowButton.onclick = allow;

    // the e2e tests open the popup as a page and name the tab: popup.html?tab=<id>
    const testTab = Number(new URLSearchParams(location.search).get('tab'));
    [tab] = testTab ? [await chrome.tabs.get(testTab)] : await chrome.tabs.query({ active: true, currentWindow: true });
    let host = '';
    try {
        host = new URL(tab.url).hostname;
    } catch {} // no access to the tab's address

    // the projection remembered for this site, else the default from the settings
    await migrateRememberedProjection();
    const [settings, sites] = await Promise.all([loadSettings(), siteProjections()]);
    projectionSelect.value = sites[host] || settings.defaultProjection;
    if (!projectionSelect.value) projectionSelect.value = DEFAULT_PROJECTION; // remembered but unavailable
    projectionSelect.onchange = () => {
        // remembered for other sites; YouTube detects the projection per video
        if (!onYouTube && host) rememberSiteProjection(host, projectionSelect.value);
        if (target && target.state !== 'none' && projectionSelect.value)
            send({ type: COMMANDS.SET_PROJECTION, projection: projectionSelect.value }).catch(() => {});
    };
    // live streams also play at /live/<id>
    if (/^https?:\/\/([^/]+\.)?youtube\.com\/(watch|live\/)/.test(tab.url || '')) {
        await initYouTube();
        return;
    }
    if (/^https?:\/\/([^/]+\.)?youtube\.com\//.test(tab.url || '')) {
        setStatus(t('openYouTubeVideo'));
        projectionSelect.disabled = true;
        return;
    }
    try {
        target = await findTarget();
    } catch {
        setStatus(t('pageInaccessible'), true);
        return;
    }
    if (!target) {
        setStatus(t('noVideo'), true);
        return;
    }
    setStatus(t('videoFound'));
    enterButton.disabled = false;
    showState(target.state);
    if (target.state === 'none') return;
    const reply = await send({ type: COMMANDS.STATE }).catch(() => ({}));
    // in VR, the projection shown, which may have been detected as 3D
    if (target.state === 'active' && reply.projection) projectionSelect.value = reply.projection;
    // tell the user why the last attempt didn't work, and for a video blocked by CORS (found when
    // the video was clicked), how to get past it
    if (target.state === 'idle' && reply.error) setStatus(await explainBlocked(reply), true);
}

// Before the settings, the popup remembered one projection for all sites; that's the default now
async function migrateRememberedProjection() {
    const remembered = localStorage.getItem('projection');
    if (!remembered) return;
    await saveSettings({ defaultProjection: remembered });
    localStorage.removeItem('projection');
}

// The error for a blocked video, with what to do: Enter VR applies the workaround if the access
// is there already, otherwise "Allow and retry" asks for it
async function explainBlocked(reply) {
    if (!reply.cors) return reply.error;
    const granted = (scope) => chrome.permissions.contains({ origins: corsOrigins(reply.cors, scope) });
    if ((await granted('all')) || (await granted('servers'))) return t('corsGranted', reply.error);
    return offerAllow(reply.cors, 'servers', reply.error);
}

async function initYouTube() {
    onYouTube = true;
    projectionSelect.add(new Option(t('detectAutomatically'), ''), 0);
    projectionSelect.value = '';
    target = { frameId: 0, state: 'none' };
    let reply;
    try {
        reply = await send({ type: COMMANDS.STATE });
    } catch {
        setStatus(t('reloadPage'), true); // opened before the extension
        return;
    }
    enterButton.disabled = false;
    showState(reply.state);
    if (reply.projection) projectionSelect.value = reply.projection;
    if (reply.state === 'none' || reply.state === 'idle') {
        setStatus(t('youtubeHint'));
    }
    if (reply.error) setStatus(reply.error, true);
}

init();
