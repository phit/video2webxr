// A chrome.i18n stub serving _locales/<locale>/messages.json, for tests of code that calls t()
import fs from 'node:fs';

export function readMessages(locale) {
    return JSON.parse(fs.readFileSync(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'));
}

export function getMessage(messages, key, substitutions = []) {
    const entry = messages[key];
    if (!entry) return '';
    return entry.message.replace(/\$(\w+)\$/g, (_, name) => {
        const content = entry.placeholders[name.toLowerCase()].content;
        return content.replace(/\$(\d)/, (__, i) => substitutions[i - 1] ?? '');
    });
}

export function installChromeI18n(locale = 'en') {
    const messages = readMessages(locale);
    globalThis.chrome = {
        i18n: {
            getMessage: (key, substitutions) => getMessage(messages, key, substitutions),
            getUILanguage: () => locale.replace('_', '-'),
        },
    };
}
