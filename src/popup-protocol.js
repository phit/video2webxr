// The commands the toolbar popup sends to the page, answered by youtube.js on YouTube and by
// generic.js elsewhere. Every reply is { state, projection, error, cors } (all but state
// optional), with state one of:
//   none      no player yet (YouTube: VR not enabled on this video)
//   idle      a player, not in VR
//   armed     waiting for the click on the video that enters VR
//   starting  the VR session is being started
//   active    in VR
// cors (other sites only) is { src, origin } of a video blocked by CORS, see popup.js.
export const COMMANDS = {
    STATE: 'state',
    ARM: 'arm', // { projection, withHeader }: wait for the click on the video
    SET_PROJECTION: 'setProjection', // { projection }
    STOP: 'stop',
};

// Answers the popup's messages with handle(message), which may return a promise; a thrown
// error becomes { error }
export function answerPopup(handle) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        Promise.resolve()
            .then(() => handle(message))
            .then(sendResponse, (e) => sendResponse({ error: e.message }));
        return true; // the reply may come later
    });
}
