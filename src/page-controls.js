import { PROJECTION_LABELS } from './projections.js';

// YouTube's in-page controls for a VRPlayer, below the video: an Enter VR button and the
// projection dropdown side by side, with a line below for why entering VR failed. They follow
// the player through its events.
export function createPageControls(player) {
    const controls = document.createElement('div');
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', justifyContent: 'center', gap: '8px' });
    const errorLine = document.createElement('div');
    errorLine.hidden = true;
    Object.assign(errorLine.style, {
        margin: '8px auto 0',
        maxWidth: '640px',
        padding: '8px 12px',
        borderRadius: '12px',
        background: CONTROL_BACKGROUND,
        color: CONTROL_TEXT,
        textAlign: 'center',
        font: '13px/1.4 Roboto, Arial, sans-serif',
    });
    player.addEventListener('vrerror', () => {
        errorLine.textContent = player.lastError ?? '';
        errorLine.hidden = !player.lastError;
    });
    row.append(createVRButton(player), createProjectionSelect(player));
    controls.append(row, errorLine);
    return controls;
}

// Like three.js' VRButton, but enters through the player, which picks AR when available
function createVRButton(player) {
    const button = document.createElement('button');
    styleControl(button);
    button.style.minWidth = '110px';
    button.textContent = 'ENTER VR';
    button.disabled = true;
    const supported = (mode) => navigator.xr?.isSessionSupported(mode).catch(() => false) ?? false;
    Promise.all([supported('immersive-vr'), supported('immersive-ar')]).then(([vr, ar]) => {
        button.disabled = !vr && !ar;
        if (button.disabled) {
            button.textContent = 'VR NOT SUPPORTED';
            button.style.cursor = 'default';
        }
    });
    button.onclick = () => {
        const session = player.renderer.xr.getSession();
        if (session) session.end();
        else player.startSession();
    };
    player.renderer.xr.addEventListener('sessionstart', () => {
        button.textContent = 'EXIT VR';
    });
    player.renderer.xr.addEventListener('sessionend', () => {
        button.textContent = 'ENTER VR';
    });
    return button;
}

function createProjectionSelect(player) {
    const select = document.createElement('select');
    select.id = 'VRProjectionSelect';
    select.title = 'Video projection';
    for (const id of player.projectionIds) select.appendChild(projectionOption(id));
    select.value = player.projection;
    styleControl(select);
    // its own arrow, clear of the rounded end, instead of the browser's at the very edge
    Object.assign(select.style, {
        appearance: 'none',
        paddingRight: '36px',
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(SELECT_ARROW)}")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 14px center',
    });
    select.onchange = () => player.setProjection(select.value);
    // changed by the in-VR panel, 3D detection or the toolbar popup
    player.addEventListener('projectionchange', () => {
        select.value = player.projection;
    });
    player.addEventListener('depthsupported', () => {
        if (!select.querySelector('option[value="FLAT_AI"]')) select.add(projectionOption('FLAT_AI'));
    });
    return select;
}

function projectionOption(id) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = PROJECTION_LABELS.find(([value]) => value === id)[1];
    // the open dropdown list
    Object.assign(option.style, { background: CONTROL_BACKGROUND, color: CONTROL_TEXT });
    return option;
}

// Shaped like YouTube's chip buttons, in fixed colours that read on both its light and dark
// theme: YouTube's dark-theme chip grey, like its black Subscribe button in the light theme.
// (YouTube's own theme variables aren't reachable from here.)
const CONTROL_BACKGROUND = '#272727';
const CONTROL_HOVER = '#3f3f3f';
const CONTROL_TEXT = '#f1f1f1';
const SELECT_ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8"><path d="M1 1.5l5 5 5-5" fill="none" stroke="${CONTROL_TEXT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function styleControl(element) {
    Object.assign(element.style, {
        height: '36px',
        padding: '0 16px',
        border: 'none',
        borderRadius: '18px',
        backgroundColor: CONTROL_BACKGROUND,
        color: CONTROL_TEXT,
        font: '500 14px Roboto, Arial, sans-serif',
        cursor: 'pointer',
    });
    element.onmouseenter = () => {
        if (!element.disabled) element.style.backgroundColor = CONTROL_HOVER;
    };
    element.onmouseleave = () => {
        element.style.backgroundColor = CONTROL_BACKGROUND;
    };
}
