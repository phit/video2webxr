import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_SITES, corsOrigins, corsRule, ruleOrigin } from '../src/cors-rule.js';

const blocked = { src: 'https://cdn.example.net/v/clip.mp4?sig=1', origin: 'https://www.example.com' };

test('corsOrigins asks for the video server and the page, or all sites', () => {
    assert.deepEqual(corsOrigins(blocked, 'servers'), ['https://cdn.example.net/*', 'https://www.example.com/*']);
    const sameServer = { src: 'https://example.com/a.mp4', origin: 'https://example.com' };
    assert.deepEqual(corsOrigins(sameServer, 'servers'), ['https://example.com/*']);
    assert.equal(corsOrigins(blocked, 'all'), ALL_SITES);
});

test("corsRule only applies to the tab's media requests from the page's site", () => {
    const rule = corsRule(42, blocked, 'servers');
    assert.equal(rule.id, 42);
    assert.deepEqual(rule.condition, {
        tabIds: [42],
        resourceTypes: ['media'],
        initiatorDomains: ['www.example.com'],
        requestDomains: ['cdn.example.net'],
    });
    assert.equal(ruleOrigin(rule), 'https://www.example.com');
});

test("corsRule with scope 'all' covers any server but still only the page's site", () => {
    const { condition } = corsRule(7, blocked, 'all');
    assert.equal(condition.requestDomains, undefined);
    assert.deepEqual(condition.initiatorDomains, ['www.example.com']);
});
