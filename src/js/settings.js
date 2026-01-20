import { DIVIDER_SIZE } from './constants.js';

/**
 * Default settings configuration
 */
const defaultSettings = {
    text: {
        fontFamily: 'sans-serif',
        fontSize: 14, // px
        textColor: '#374151'
    },
    paper: {
        backgroundColor: '#ffffff',
        coverImage: null, // data URL
        coverImageOpacity: 0.2,
        showPageNumbers: false
    },
    dividers: {
        width: DIVIDER_SIZE,
        color: '#d1d5db'
    }
};

/**
 * Current settings state (deep cloned from defaults)
 */
let settings = JSON.parse(JSON.stringify(defaultSettings));

/**
 * Get current settings
 * @returns {object} Current settings object
 */
export function getSettings() {
    return settings;
}

/**
 * Update a specific setting
 * @param {string} category - 'text', 'paper', or 'dividers'
 * @param {string} key - Setting key within category
 * @param {any} value - New value
 */
export function updateSetting(category, key, value) {
    if (settings[category] && key in settings[category]) {
        settings[category][key] = value;
        applySettings();
        document.dispatchEvent(new CustomEvent('settingsUpdated'));
    }
}

/**
 * Apply all settings to CSS custom properties
 */
export function applySettings() {
    const root = document.documentElement;

    // Text settings
    root.style.setProperty('--text-font-family', settings.text.fontFamily);
    root.style.setProperty('--text-font-size', `${settings.text.fontSize}px`);
    root.style.setProperty('--text-color', settings.text.textColor);

    // Paper settings
    root.style.setProperty('--paper-bg-color', settings.paper.backgroundColor);
    root.style.setProperty('--cover-image-opacity', settings.paper.coverImageOpacity);

    // Cover image
    const paper = document.getElementById('a4-paper');
    if (paper) {
        if (settings.paper.coverImage) {
            paper.style.setProperty('--cover-image', `url(${settings.paper.coverImage})`);
            paper.classList.add('has-cover-image');
        } else {
            paper.style.removeProperty('--cover-image');
            paper.classList.remove('has-cover-image');
        }
    }

    // Divider settings
    root.style.setProperty('--divider-size', `${settings.dividers.width}px`);
    root.style.setProperty('--divider-color', settings.dividers.color);
}

/**
 * Reset settings to defaults
 */
export function resetSettings() {
    settings = JSON.parse(JSON.stringify(defaultSettings));
    applySettings();
    document.dispatchEvent(new CustomEvent('settingsUpdated'));
}

/**
 * Load settings from a saved object
 * @param {object} savedSettings - Settings object from file
 */
export function loadSettings(savedSettings) {
    if (savedSettings) {
        // Deep merge with defaults to handle missing keys
        settings = {
            text: { ...defaultSettings.text, ...savedSettings.text },
            paper: { ...defaultSettings.paper, ...savedSettings.paper },
            dividers: { ...defaultSettings.dividers, ...savedSettings.dividers }
        };
        applySettings();
    }
}

/**
 * Export settings for saving
 * @returns {object} Settings object for serialization
 */
export function exportSettings() {
    return JSON.parse(JSON.stringify(settings));
}

/**
 * Available font families
 */
export const FONT_OPTIONS = [
    { value: 'sans-serif', label: 'Sans Serif (Default)' },
    { value: "'Inter', sans-serif", label: 'Inter' },
    { value: "'Roboto', sans-serif", label: 'Roboto' },
    { value: "'Open Sans', sans-serif", label: 'Open Sans' },
    { value: "'Lato', sans-serif", label: 'Lato' },
    { value: "'Montserrat', sans-serif", label: 'Montserrat' },
    { value: "'Playfair Display', serif", label: 'Playfair Display' },
    { value: "'Merriweather', serif", label: 'Merriweather' },
    { value: "'Georgia', serif", label: 'Georgia' },
    { value: "serif", label: 'Serif' },
    { value: "'Courier New', monospace", label: 'Courier New' },
    { value: "monospace", label: 'Monospace' }
];

/**
 * Setup settings modal handlers
 */
export function setupSettingsHandlers() {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeBtn = document.getElementById('settings-close');
    const resetBtn = document.getElementById('settings-reset');

    if (!settingsBtn || !settingsModal) return;

    // Open modal
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('active');
        syncFormWithSettings();
    });

    // Close modal
    closeBtn?.addEventListener('click', () => {
        settingsModal.classList.remove('active');
    });

    // Close on overlay click
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('active');
        }
    });

    // Reset button
    resetBtn?.addEventListener('click', () => {
        resetSettings();
        syncFormWithSettings();
    });

    // Setup individual controls
    setupTextControls();
    setupPaperControls();
    setupDividerControls();

    // Apply settings on load
    applySettings();
}

function syncFormWithSettings() {
    // Text
    const fontSelect = document.getElementById('setting-font-family');
    const fontSizeSlider = document.getElementById('setting-font-size');
    const fontSizeValue = document.getElementById('font-size-value');
    const textColorInput = document.getElementById('setting-text-color');

    if (fontSelect) fontSelect.value = settings.text.fontFamily;
    if (fontSizeSlider) fontSizeSlider.value = settings.text.fontSize;
    if (fontSizeValue) fontSizeValue.textContent = `${settings.text.fontSize}px`;
    if (textColorInput) {
        textColorInput.value = settings.text.textColor;
        updateColorValueDisplay(textColorInput);
    }

    // Paper
    const bgColorInput = document.getElementById('setting-paper-color');
    const coverOpacitySlider = document.getElementById('setting-cover-opacity');
    const coverOpacityValue = document.getElementById('cover-opacity-value');
    const pageNumbersToggle = document.getElementById('setting-page-numbers');
    const coverPreview = document.getElementById('cover-image-preview');

    if (bgColorInput) {
        bgColorInput.value = settings.paper.backgroundColor;
        updateColorValueDisplay(bgColorInput);
    }
    if (coverOpacitySlider) coverOpacitySlider.value = settings.paper.coverImageOpacity * 100;
    if (coverOpacityValue) coverOpacityValue.textContent = `${Math.round(settings.paper.coverImageOpacity * 100)}%`;
    if (pageNumbersToggle) pageNumbersToggle.checked = settings.paper.showPageNumbers;

    if (coverPreview) {
        if (settings.paper.coverImage) {
            coverPreview.innerHTML = `<img src="${settings.paper.coverImage}" alt="Cover preview">`;
        } else {
            coverPreview.innerHTML = '<span>No image selected</span>';
        }
    }

    // Dividers
    const dividerWidthSlider = document.getElementById('setting-divider-width');
    const dividerWidthValue = document.getElementById('divider-width-value');
    const dividerColorInput = document.getElementById('setting-divider-color');

    if (dividerWidthSlider) dividerWidthSlider.value = settings.dividers.width;
    if (dividerWidthValue) dividerWidthValue.textContent = `${settings.dividers.width}px`;
    if (dividerColorInput) {
        dividerColorInput.value = settings.dividers.color;
        updateColorValueDisplay(dividerColorInput);
    }
}

function updateColorValueDisplay(colorInput) {
    const wrapper = colorInput.closest('.color-input-wrapper');
    const valueSpan = wrapper?.querySelector('.color-value');
    if (valueSpan) {
        valueSpan.textContent = colorInput.value;
    }
}

function setupTextControls() {
    const fontSelect = document.getElementById('setting-font-family');
    const fontSizeSlider = document.getElementById('setting-font-size');
    const fontSizeValue = document.getElementById('font-size-value');
    const textColorInput = document.getElementById('setting-text-color');

    fontSelect?.addEventListener('change', (e) => {
        updateSetting('text', 'fontFamily', e.target.value);
    });

    fontSizeSlider?.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10);
        if (fontSizeValue) fontSizeValue.textContent = `${value}px`;
        updateSetting('text', 'fontSize', value);
    });

    textColorInput?.addEventListener('input', (e) => {
        updateSetting('text', 'textColor', e.target.value);
        updateColorValueDisplay(e.target);
    });
}

function setupPaperControls() {
    const bgColorInput = document.getElementById('setting-paper-color');
    const coverImageInput = document.getElementById('setting-cover-image');
    const coverOpacitySlider = document.getElementById('setting-cover-opacity');
    const coverOpacityValue = document.getElementById('cover-opacity-value');
    const pageNumbersToggle = document.getElementById('setting-page-numbers');
    const removeCoverBtn = document.getElementById('remove-cover-image');

    bgColorInput?.addEventListener('input', (e) => {
        updateSetting('paper', 'backgroundColor', e.target.value);
        updateColorValueDisplay(e.target);
    });

    coverImageInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            updateSetting('paper', 'coverImage', event.target.result);
            syncFormWithSettings();
        };
        reader.readAsDataURL(file);
    });

    removeCoverBtn?.addEventListener('click', () => {
        updateSetting('paper', 'coverImage', null);
        syncFormWithSettings();
        // Reset file input
        if (coverImageInput) coverImageInput.value = '';
    });

    coverOpacitySlider?.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10) / 100;
        if (coverOpacityValue) coverOpacityValue.textContent = `${Math.round(value * 100)}%`;
        updateSetting('paper', 'coverImageOpacity', value);
    });

    pageNumbersToggle?.addEventListener('change', (e) => {
        updateSetting('paper', 'showPageNumbers', e.target.checked);
    });
}

function setupDividerControls() {
    const dividerWidthSlider = document.getElementById('setting-divider-width');
    const dividerWidthValue = document.getElementById('divider-width-value');
    const dividerColorInput = document.getElementById('setting-divider-color');

    dividerWidthSlider?.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10);
        if (dividerWidthValue) dividerWidthValue.textContent = `${value}px`;
        updateSetting('dividers', 'width', value);
    });

    dividerColorInput?.addEventListener('input', (e) => {
        updateSetting('dividers', 'color', e.target.value);
        updateColorValueDisplay(e.target);
    });
}
