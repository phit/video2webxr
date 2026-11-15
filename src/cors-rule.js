// The popup's workaround for a video blocked by CORS (see popup.js): a declarativeNetRequest
// session rule, one per tab with the tab's id, that makes the video's server allow the page to
// read it. blocked is { src, origin } from generic.js: the video's address and the origin of the
// page it plays in. scope 'servers' covers just the video's server; 'all' covers any server,
// for videos that redirect to one that can't be known in advance (often a CDN).

export const ALL_SITES = ['<all_urls>'];

// The host access a scope needs
export function corsOrigins({ src, origin }, scope) {
    return scope === 'all' ? ALL_SITES : [...new Set([`${new URL(src).origin}/*`, `${origin}/*`])];
}

// Sets the CORS headers on media responses in the tab, with cookies allowed so the video loads
// like before. Only for requests from the page's site, so other sites opened in the tab later
// aren't affected; background.js also removes it when the tab leaves that site or is closed.
export function corsRule(tabId, { src, origin }, scope) {
    const condition = { tabIds: [tabId], resourceTypes: ['media'], initiatorDomains: [new URL(origin).hostname] };
    if (scope !== 'all') condition.requestDomains = [new URL(src).hostname];
    return {
        id: tabId,
        priority: 1,
        action: {
            type: 'modifyHeaders',
            responseHeaders: [
                { header: 'Access-Control-Allow-Origin', operation: 'set', value: origin },
                { header: 'Access-Control-Allow-Credentials', operation: 'set', value: 'true' },
            ],
        },
        condition,
    };
}

// The page origin a rule from corsRule() was made for
export function ruleOrigin(rule) {
    return rule.action.responseHeaders?.find((h) => h.header === 'Access-Control-Allow-Origin')?.value;
}
