// UI text from _locales/. Outside the extension (unit tests without a chrome stub) it's the key.
export function t(key, ...substitutions) {
    return globalThis.chrome?.i18n?.getMessage(key, substitutions.map(String)) || key;
}

// Sets the text of every [data-i18n] element on an extension page, the title of every
// [data-i18n-title] one, and the page's language
export function localizePage() {
    document.documentElement.lang = chrome.i18n.getUILanguage();
    for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
    for (const element of document.querySelectorAll('[data-i18n-title]')) {
        element.title = t(element.dataset.i18nTitle);
        element.setAttribute('aria-label', element.title);
    }
}
