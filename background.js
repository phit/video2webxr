// Toolbar button: start (or stop) VR on the largest video in the current tab.
// activeTab grants access to the tab's frames only after the user clicks the button.
chrome.action.onClicked.addListener(async (tab) => {
    let frames;
    try {
        frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: measureVideos });
    } catch (e) {
        // some frames are off limits; fall back to the top frame
        frames = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: measureVideos }).catch(() => []);
    }
    const best = frames.filter(frame => frame.result).sort((a, b) => b.result - a.result)[0];
    await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [best ? best.frameId : 0] },
        files: ['generic.js']
    }).catch(e => console.warn("can't start VR in this tab:", e.message));
});

// Runs in each frame: the area of its largest video, or a huge number if VR is already
// running there so that clicking again turns it off
function measureVideos() {
    if (window.__pcvrGeneric) return Number.MAX_SAFE_INTEGER;
    const videos = [];
    const walk = (root) => {
        videos.push(...root.querySelectorAll('video'));
        for (const element of root.querySelectorAll('*')) {
            if (element.shadowRoot) walk(element.shadowRoot);
        }
    };
    walk(document);
    return Math.max(0, ...videos.map(video => {
        const rect = video.getBoundingClientRect();
        return rect.width * rect.height;
    }));
}
