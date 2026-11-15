import { localizePage, t } from './i18n.js';
import { depthSupported, PROJECTION_IDS, projectionLabel } from './projections.js';
import {
    loadSettings,
    rememberSiteProjection,
    resetSettings,
    saveSettings,
    siteProjections,
    YOUTUBE_FLAT_PROJECTIONS,
} from './settings.js';

// The options page: every [data-setting] input edits the setting of that name, saved on change

const inputs = [...document.querySelectorAll('[data-setting]')];
const numberFormat = new Intl.NumberFormat(chrome.i18n.getUILanguage());

function showValue(input) {
    const output = input.parentElement.querySelector('output');
    if (output) output.textContent = t(output.dataset.unit, numberFormat.format(Number(input.value)));
}

// greys out the sliders of a switched-off feature
function showDependents() {
    for (const element of document.querySelectorAll('[data-depends]')) {
        const on = document.querySelector(`[data-setting="${element.dataset.depends}"]`).checked;
        element.classList.toggle('off', !on);
        for (const input of element.querySelectorAll('input')) input.disabled = !on;
    }
}

function show(settings) {
    for (const input of inputs) {
        const value = settings[input.dataset.setting];
        if (input.type === 'checkbox') input.checked = value;
        else input.value = value;
        showValue(input);
    }
    showDependents();
}

function inputValue(input) {
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'range') return Number(input.value);
    return input.value;
}

async function showSites() {
    const sites = await siteProjections();
    const list = document.getElementById('sites');
    list.replaceChildren();
    for (const [host, projection] of Object.entries(sites).sort(([a], [b]) => a.localeCompare(b))) {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = host;
        const label = document.createElement('span');
        label.className = 'hint';
        label.textContent = projectionLabel(projection);
        const forget = document.createElement('button');
        forget.type = 'button';
        forget.textContent = '×';
        forget.title = t('forgetSite', host);
        forget.setAttribute('aria-label', forget.title);
        forget.onclick = async () => {
            await rememberSiteProjection(host, null);
            showSites();
        };
        item.append(name, label, forget);
        list.append(item);
    }
    document.getElementById('noSites').hidden = list.children.length > 0;
}

async function init() {
    localizePage();
    const withDepth = await depthSupported();
    const offered = (id) => id !== 'FLAT_AI' || withDepth;
    const defaultSelect = document.getElementById('defaultProjection');
    for (const id of PROJECTION_IDS.filter(offered)) defaultSelect.add(new Option(projectionLabel(id), id));
    const youtubeSelect = document.getElementById('youtubeFlatProjection');
    for (const id of YOUTUBE_FLAT_PROJECTIONS.filter(offered)) youtubeSelect.add(new Option(projectionLabel(id), id));

    show(await loadSettings());
    for (const input of inputs) {
        input.oninput = () => {
            showValue(input);
            showDependents();
        };
        // sliders save when let go, sync storage only allows so many writes a minute
        input.onchange = () => saveSettings({ [input.dataset.setting]: inputValue(input) });
    }
    document.getElementById('reset').onclick = async () => {
        await resetSettings();
        show(await loadSettings());
    };
    showSites();
}

init();
