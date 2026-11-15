// Diagnostics for development: logged in `npm run watch` and `DEBUG=1 npm run build` builds,
// silent in release builds (scripts/build.mjs defines DEBUG). Failures use console.warn directly.
export function debug(...args) {
    if (DEBUG) console.log('video2webxr:', ...args);
}
