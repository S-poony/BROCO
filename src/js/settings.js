import { DIVIDER_SIZE, A4_PAPER_ID } from './constants.js';
import { getCurrentPage } from './state.js';
// import { renderCoverImage } from './renderer.js'; // REMOVED to break circular dependency

/**
 * Default settings configuration
 */
const defaultSettings = {
    layout: {
        ratio: 1.414, // A4 default (approx)
        isLandscape: false
    },
    text: {
        fontFamily: 'sans-serif',
        fontSize: 20, // px
        textColor: '#374151',
        colorAffectsHeaders: false
    },
    paper: {
        backgroundColor: '#ffffff',
        coverImage: null, // data URL
        coverImageOpacity: 0.2,
        showPageNumbers: false
    },
    dividers: {
        width: DIVIDER_SIZE,
        color: '#d1d5db',
        showBorders: true
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
 * @param {string} category - 'layout', 'text', 'paper', or 'dividers'
 * @param {string} key - Setting key within category
 * @param {any} value - New value
 */
export function updateSetting(category, key, value) {
    if (settings[category] && key in settings[category]) {
        settings[category][key] = value;
        applySettings();

        // If we toggled page numbers, we need a full render because it's a DOM change
        // This is now handled by the event listener in main.js to avoid circular dependency


        document.dispatchEvent(new CustomEvent('settingsUpdated'));
    }
}

function calculatePaperDimensions() {
    // Rule: width + height = 2000px
    // Ratio = width / height (if landscape) or height / width (if portrait)?
    // Actually typically ratio is long / short.
    // Let's assume ratio input describes the shape (e.g., 1.618).

    // We treat ratio as LongSide / ShortSide
    const r = Math.max(settings.layout.ratio, 1);

    // h + w = 2000
    // w = r * h (if w is long side)
    // h * r + h = 2000 => h(r+1) = 2000 => h = 2000 / (r+1)

    const shortSide = 2000 / (r + 1);
    const longSide = shortSide * r;

    let width, height;

    if (settings.layout.isLandscape) {
        width = longSide;
        height = shortSide;
    } else {
        width = shortSide;
        height = longSide;
    }

    return { width, height };
}

/**
 * Apply all settings to CSS custom properties
 */
export function applySettings() {
    const root = document.documentElement;

    // Layout
    const { width, height } = calculatePaperDimensions();
    root.style.setProperty('--paper-width', `${width}px`);
    root.style.setProperty('--paper-height', `${height}px`);

    // Set ratio for CSS aspect-ratio support
    // Ensure we use a valid division to avoid infinity, though width/height should be safe
    const ratioVal = width / height;
    root.style.setProperty('--ratio', `${ratioVal}`);

    // Text settings
    root.style.setProperty('--text-font-family', settings.text.fontFamily);
    root.style.setProperty('--text-font-size', `${settings.text.fontSize}px`);
    root.style.setProperty('--text-color', settings.text.textColor);

    // Header color logic
    if (settings.text.colorAffectsHeaders) {
        root.style.setProperty('--header-color', settings.text.textColor);
    } else {
        root.style.removeProperty('--header-color');
    }

    // Paper settings
    root.style.setProperty('--paper-bg-color', settings.paper.backgroundColor);
    root.style.setProperty('--cover-image-opacity', settings.paper.coverImageOpacity);

    // Cover image
    // NOTE: Direct manipulation removed to break circular dependency.
    // Background color is handled by CSS variable updates above.
    // Cover image creation is handled by re-rendering via 'settingsUpdated' event using CSS var for opacity.
    // Divider settings
    root.style.setProperty('--divider-size', `${settings.dividers.width}px`);
    root.style.setProperty('--divider-color', settings.dividers.color);

    // Layout border settings
    if (settings.dividers.showBorders) {
        root.style.setProperty('--layout-border-width', `${settings.dividers.width}px`);
    } else {
        root.style.setProperty('--layout-border-width', '1px');
    }
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
            layout: { ...defaultSettings.layout, ...savedSettings.layout },
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
    const settingsContainer = document.getElementById('settings-container'); // Updated ID
    const closeBtn = document.getElementById('settings-close');
    const closeXBtn = document.getElementById('settings-close-x'); // New close icon
    const resetBtn = document.getElementById('settings-reset');

    if (!settingsBtn || !settingsContainer) return;

    // Open container (Modal or Sidebar)
    settingsBtn.addEventListener('click', () => {
        settingsContainer.classList.toggle('active');
        if (settingsContainer.classList.contains('active')) {
            syncFormWithSettings();
        }
    });

    // Close container
    const closeHandler = () => {
        settingsContainer.classList.remove('active');
    };

    closeBtn?.addEventListener('click', closeHandler);
    closeXBtn?.addEventListener('click', closeHandler);

    // Close on overlay click (only applies in modal mode)
    settingsContainer.addEventListener('click', (e) => {
        if (e.target === settingsContainer) {
            closeHandler();
        }
    });

    // Reset button
    resetBtn?.addEventListener('click', () => {
        resetSettings();
        syncFormWithSettings();
    });

    // Setup individual controls
    setupLayoutControls();
    setupTextControls();
    setupPaperControls();
    setupDividerControls();

    // Re-apply settings on layout updates
    document.addEventListener('layoutUpdated', () => {
        applySettings();
    });

    // Apply settings on load
    applySettings();
}

function syncFormWithSettings() {
    // Layout
    const ratioSelect = document.getElementById('setting-layout-ratio');
    const landscapeToggle = document.getElementById('setting-layout-landscape');

    if (ratioSelect) ratioSelect.value = settings.layout.ratio;
    if (landscapeToggle) landscapeToggle.checked = settings.layout.isLandscape;

    // Text
    const fontSelect = document.getElementById('setting-font-family');
    const fontSizeSlider = document.getElementById('setting-font-size');
    const fontSizeValue = document.getElementById('font-size-value');

    if (fontSelect) {
        fontSelect.value = settings.text.fontFamily;
        fontSelect.style.fontFamily = settings.text.fontFamily;
    }
    if (fontSizeSlider) fontSizeSlider.value = settings.text.fontSize;
    if (fontSizeValue) fontSizeValue.textContent = `${settings.text.fontSize}px`;

    const colorHeadersToggle = document.getElementById('setting-color-headers');
    if (colorHeadersToggle) colorHeadersToggle.checked = settings.text.colorAffectsHeaders;

    updateColorUI('text-color', settings.text.textColor);

    // Paper
    const coverOpacitySlider = document.getElementById('setting-cover-opacity');
    const coverOpacityValue = document.getElementById('cover-opacity-value');
    const pageNumbersToggle = document.getElementById('setting-page-numbers');
    const coverPreview = document.getElementById('cover-image-preview');

    if (coverOpacitySlider) coverOpacitySlider.value = settings.paper.coverImageOpacity * 100;
    if (coverOpacityValue) coverOpacityValue.textContent = `${Math.round(settings.paper.coverImageOpacity * 100)}%`;
    if (pageNumbersToggle) pageNumbersToggle.checked = settings.paper.showPageNumbers;
    updateColorUI('paper-color', settings.paper.backgroundColor);

    if (coverPreview) {
        if (settings.paper.coverImage) {
            coverPreview.innerHTML = `<img src="${settings.paper.coverImage}" alt="Cover preview" style="opacity: ${settings.paper.coverImageOpacity}">`;
        } else {
            coverPreview.innerHTML = '<span>No image selected</span>';
        }
    }

    // Dividers
    const dividerWidthSlider = document.getElementById('setting-divider-width');
    const dividerWidthValue = document.getElementById('divider-width-value');

    if (dividerWidthSlider) dividerWidthSlider.value = settings.dividers.width;
    if (dividerWidthValue) dividerWidthValue.textContent = `${settings.dividers.width}px`;
    updateColorUI('divider-color', settings.dividers.color);

    const showBordersToggle = document.getElementById('setting-show-borders');
    if (showBordersToggle) showBordersToggle.checked = settings.dividers.showBorders;
}

/**
 * Update the custom color selection UI
 * @param {string} type - 'text-color', 'paper-color', or 'divider-color'
 * @param {string} color - Current color value
 */
function updateColorUI(type, color) {
    const container = document.querySelector(`.color-selection-container[data-setting="${type}"]`);
    if (!container) return;

    // Update swatches active state
    const swatches = container.querySelectorAll('.color-swatch');
    let foundMatch = false;
    swatches.forEach(swatch => {
        const swatchColor = swatch.getAttribute('data-color');
        if (swatchColor.toLowerCase() === color.toLowerCase()) {
            swatch.classList.add('active');
            foundMatch = true;
        } else {
            swatch.classList.remove('active');
        }
    });

    // Update hex display
    const hexDisplay = document.getElementById(`${type}-hex`);
    if (hexDisplay) hexDisplay.textContent = color;

    // Update custom preview and hidden input
    const preview = document.getElementById(`custom-${type}-preview`);
    if (preview) preview.style.backgroundColor = color;

    const hiddenInput = document.getElementById(`setting-${type}`);
    if (hiddenInput && hiddenInput.value !== color) {
        hiddenInput.value = color;
    }
}

/**
 * Setup a beautiful color selection tool
 * @param {string} type - 'text-color', 'paper-color', or 'divider-color'
 * @param {string} category - 'text', 'paper', or 'dividers'
 * @param {string} key - 'textColor', 'backgroundColor', or 'color'
 */
function setupColorSelection(type, category, key) {
    const container = document.querySelector(`.color-selection-container[data-setting="${type}"]`);
    if (!container) return;

    // Swatch clicks
    container.addEventListener('click', (e) => {
        const swatch = e.target.closest('.color-swatch');
        if (swatch) {
            const color = swatch.getAttribute('data-color');
            updateSetting(category, key, color);
            updateColorUI(type, color);
        }
    });

    // Custom trigger
    const trigger = document.getElementById(`custom-${type}-trigger`);
    const hiddenInput = document.getElementById(`setting-${type}`);

    trigger?.addEventListener('click', () => {
        hiddenInput?.click();
    });

    hiddenInput?.addEventListener('input', (e) => {
        const color = e.target.value;
        updateSetting(category, key, color);
        updateColorUI(type, color);
    });
}

function setupTextControls() {
    const fontSelect = document.getElementById('setting-font-family');
    const fontSizeSlider = document.getElementById('setting-font-size');
    const fontSizeValue = document.getElementById('font-size-value');

    fontSelect?.addEventListener('change', (e) => {
        const fontFamily = e.target.value;
        updateSetting('text', 'fontFamily', fontFamily);
        if (fontSelect) fontSelect.style.fontFamily = fontFamily;
    });

    fontSizeSlider?.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10);
        if (fontSizeValue) fontSizeValue.textContent = `${value}px`;
        updateSetting('text', 'fontSize', value);
    });

    const colorHeadersToggle = document.getElementById('setting-color-headers');
    colorHeadersToggle?.addEventListener('change', (e) => {
        updateSetting('text', 'colorAffectsHeaders', e.target.checked);
    });

    setupColorSelection('text-color', 'text', 'textColor');
}

function setupPaperControls() {
    const coverImageInput = document.getElementById('setting-cover-image');
    const coverOpacitySlider = document.getElementById('setting-cover-opacity');
    const coverOpacityValue = document.getElementById('cover-opacity-value');
    const pageNumbersToggle = document.getElementById('setting-page-numbers');
    const removeCoverBtn = document.getElementById('remove-cover-image');

    setupColorSelection('paper-color', 'paper', 'backgroundColor');

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
        if (coverImageInput) coverImageInput.value = '';
    });

    coverOpacitySlider?.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10) / 100;
        if (coverOpacityValue) coverOpacityValue.textContent = `${Math.round(value * 100)}%`;
        updateSetting('paper', 'coverImageOpacity', value);

        // Update preview opacity in real-time
        const previewImg = document.querySelector('#cover-image-preview img');
        if (previewImg) {
            previewImg.style.opacity = value;
        }
    });

    pageNumbersToggle?.addEventListener('change', (e) => {
        updateSetting('paper', 'showPageNumbers', e.target.checked);
    });
}

function setupDividerControls() {
    const dividerWidthSlider = document.getElementById('setting-divider-width');
    const dividerWidthValue = document.getElementById('divider-width-value');

    dividerWidthSlider?.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10);
        if (dividerWidthValue) dividerWidthValue.textContent = `${value}px`;
        updateSetting('dividers', 'width', value);
    });

    setupColorSelection('divider-color', 'dividers', 'color');

    const showBordersToggle = document.getElementById('setting-show-borders');
    showBordersToggle?.addEventListener('change', (e) => {
        updateSetting('dividers', 'showBorders', e.target.checked);
    });
}

function setupLayoutControls() {
    const ratioSelect = document.getElementById('setting-layout-ratio');
    if (ratioSelect) {
        ratioSelect.value = settings.layout.ratio;
        ratioSelect.addEventListener('change', (e) => {
            updateSetting('layout', 'ratio', parseFloat(e.target.value));
        });
    }

    const landscapeToggle = document.getElementById('setting-layout-landscape');
    if (landscapeToggle) {
        landscapeToggle.checked = settings.layout.isLandscape;
        landscapeToggle.addEventListener('change', (e) => {
            updateSetting('layout', 'isLandscape', e.target.checked);
        });
    }
}
