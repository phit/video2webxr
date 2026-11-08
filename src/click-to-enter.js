// "Click the video to enter VR", for when VR is started from the toolbar popup. Chrome only
// starts a VR session from a user gesture in the page, so the popup can't do it itself: this
// waits for the next click on the video, keeps every event of that click from the site (or it
// may pause the video, close its lightbox or start a drag) and calls onClick from it.

// All events of the click that enters VR
const GESTURE_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click'];

// Chrome only starts VR from events that count as user activation
function activatesUser(event) {
    if (event.type === 'pointerdown') return event.pointerType !== 'touch';
    if (event.type === 'pointerup') return event.pointerType === 'touch';
    return event.type === 'mousedown' || event.type === 'touchend' || event.type === 'click';
}

// Shows a hint over the video and waits for the click. Returns a function that stops waiting.
export function armClick(video, onClick, hintText = 'Click the video to enter VR') {
    let gestureStarted = false;
    let called = false;
    let gestureTimeout = null;
    let hint = showHint(video, hintText);

    function isOnVideo(event) {
        const { clientX, clientY } = event.changedTouches?.[0] ?? event;
        const rect = video.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    // capture phase on window, so this runs before the site's own handlers
    function onGestureEvent(event) {
        if (!gestureStarted) {
            if (!isOnVideo(event)) return;
            gestureStarted = true;
            hint?.remove();
            hint = null;
            // swallow the rest of this click wherever it ends, then stop listening
            gestureTimeout = setTimeout(disarm, 1000);
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!called && activatesUser(event)) {
            called = true;
            onClick();
        }
        if (event.type === 'click') disarm();
    }

    function disarm() {
        clearTimeout(gestureTimeout);
        for (const type of GESTURE_EVENTS) window.removeEventListener(type, onGestureEvent, true);
        hint?.remove();
        hint = null;
    }

    for (const type of GESTURE_EVENTS) window.addEventListener(type, onGestureEvent, { capture: true, passive: false });
    return disarm;
}

function showHint(video, text) {
    const rect = video.getBoundingClientRect();
    const hint = document.createElement('div');
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
    return hint;
}
