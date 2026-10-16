// Runs in YouTube's own JavaScript world, where the player's API is reachable, and answers
// youtube.js' requests for the current video's projection data. Content scripts can't see
// page objects, so the two sides talk through DOM events; the data goes as a JSON string
// because objects don't cross between the worlds.

document.addEventListener('video2webxr-info-request', () => {
    let info = null;
    try {
        const player = document.getElementById('movie_player');
        const response = player?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
        if (response) {
            const formats = response.streamingData?.adaptiveFormats || [];
            info = {
                videoId: response.videoDetails?.videoId,
                projections: [...new Set(formats.map((f) => f.projectionType).filter(Boolean))],
                partialSpherical: !!response.playerConfig?.vrConfig?.partialSpherical,
            };
        }
    } catch {
        // no player yet; youtube.js falls back to its default
    }
    document.dispatchEvent(new CustomEvent('video2webxr-info', { detail: JSON.stringify(info) }));
});
