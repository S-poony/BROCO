import JSZip from 'jszip';
import { assetManager } from '../assets/AssetManager.js';
import { A4_PAPER_ID } from '../core/constants.js';
import { state } from '../core/state.js';
import { renderLayout } from '../layout/renderer.js';
import { showAlert, showPublishSuccess } from '../core/utils.js';
import { toast } from '../core/errorHandler.js';
import { calculatePaperDimensions, getSettings } from '../ui/settings.js';

const FLIPBOOK_API_ENDPOINT = 'https://content.lojkine.art/api/flipbook';

export function setupExportHandlers() {
    const exportBtn = document.getElementById('export-layout-btn');
    const modal = document.getElementById('export-modal');
    const cancelBtn = document.getElementById('cancel-export');
    const confirmBtn = document.getElementById('confirm-export');
    const publishConfirmBtn = document.getElementById('confirm-publish');
    const qualitySlider = document.getElementById('export-quality');
    const qualityValue = document.getElementById('quality-value');
    const dimensionsText = document.getElementById('export-dimensions');

    if (!exportBtn || !modal) return;

    function updateDimensions() {
        const quality = parseInt(qualitySlider.value);
        qualityValue.textContent = `${quality}%`;
        const multiplier = quality / 100;

        const { width: layoutWidth, height: layoutHeight } = calculatePaperDimensions();
        const width = Math.round(layoutWidth * multiplier);
        const height = Math.round(layoutHeight * multiplier);
        dimensionsText.textContent = `${width} x ${height} px`;
    }

    qualitySlider.addEventListener('input', updateDimensions);
    updateDimensions(); // Initial call

    const downloadModal = document.getElementById('download-app-modal');
    const downloadCloseBtn = document.getElementById('download-app-close');

    exportBtn.addEventListener('click', () => {
        // Check if running in Electron (using the API we exposed)
        if (!window.electronAPI) {
            if (downloadModal) {
                downloadModal.classList.add('active');
            } else {
                alert('Please download the desktop app to export. Visit https://github.com/S-poony/BROCO/releases');
            }
            return;
        }

        modal.classList.add('active');
        updateDimensions();
    });

    // Download Modal Handlers
    if (downloadModal) {
        if (downloadCloseBtn) {
            downloadCloseBtn.addEventListener('click', () => {
                downloadModal.classList.remove('active');
            });
        }
        downloadModal.addEventListener('click', (e) => {
            if (e.target === downloadModal) {
                downloadModal.classList.remove('active');
            }
        });
    }

    // Close button (x) or Footer Close
    cancelBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    confirmBtn.addEventListener('click', async () => {
        // Dropdown value now
        const formatSelect = document.getElementById('export-format-select');
        const format = formatSelect.value;
        const qualityMultiplier = parseInt(qualitySlider.value) / 100;

        confirmBtn.disabled = true;
        const originalText = confirmBtn.textContent;
        confirmBtn.textContent = 'Generating...';

        try {
            await performExport(format, qualityMultiplier);
        } catch (error) {
            console.error('Export failed:', error);
            toast.error('Export failed. Please try again.');
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = originalText;
            modal.classList.remove('active');
        }
    });

    if (publishConfirmBtn) {
        publishConfirmBtn.addEventListener('click', async () => {
            const qualityMultiplier = parseInt(qualitySlider.value) / 100;
            publishConfirmBtn.disabled = true;
            publishConfirmBtn.textContent = 'Publishing...';

            try {
                await performPublishFlipbook(qualityMultiplier);
            } catch (error) {
                console.error('Publish failed:', error);
                toast.error('Publishing failed. Please try again.');
            } finally {
                publishConfirmBtn.disabled = false;
                publishConfirmBtn.textContent = 'Publish Flipbook';
                modal.classList.remove('active');
            }
        });
    }
}

async function performExport(format, qualityMultiplier) {
    const loadingOverlay = document.getElementById('export-loading');
    const loadingStatus = document.getElementById('loading-status');
    const progressText = document.getElementById('loading-progress');

    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
        const formatText = format.toUpperCase();
        loadingStatus.textContent = `Generating ${formatText === 'JPEG' ? 'JPG' : formatText}...`;
    }

    const { width: layoutWidth, height: layoutHeight } = calculatePaperDimensions();
    const width = Math.round(layoutWidth * qualityMultiplier);
    const height = Math.round(layoutHeight * qualityMultiplier);

    const isSingleImageExport = (format === 'png' || format === 'jpeg') && state.pages.length === 1;
    const zip = (format === 'png' || format === 'jpeg') && state.pages.length > 1 ? new JSZip() : null;

    try {
        if (format === 'pdf') {
            if (progressText) progressText.textContent = 'Rendering PDF...';

            // For PDF, we render all pages at once
            const result = await window.electronAPI.renderExport({
                pageLayouts: state.pages,
                width,
                height,
                format: 'pdf',
                settings: getSettings(),
                assets: assetManager.getAssets()
            });

            if (result.error) throw new Error(result.error);

            // Result data is a Buffer (Uint8Array)
            const blob = new Blob([result.data], { type: 'application/pdf' });
            const timestamp = new Date().getTime();
            downloadBlob(blob, `layout-export-${timestamp}.pdf`);

        } else {
            // Image Export
            for (let i = 0; i < state.pages.length; i++) {
                if (progressText) {
                    progressText.textContent = `Processing page ${i + 1} of ${state.pages.length}...`;
                }

                const pageLayout = state.pages[i];
                const result = await window.electronAPI.renderExport({
                    pageLayout,
                    width,
                    height,
                    format: format, // 'png' or 'jpeg'
                    settings: getSettings(), // Pass current settings (colors, borders)
                    assets: assetManager.getAssets() // Pass all current assets
                });

                if (result.error) throw new Error(result.error);

                const ext = format === 'jpeg' ? 'jpg' : 'png';
                const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
                const blob = new Blob([result.data], { type: mime });

                if (isSingleImageExport) {
                    const timestamp = new Date().getTime();
                    downloadBlob(blob, `layout-export-${timestamp}.${ext}`);
                } else if (zip) {
                    zip.file(`page-${i + 1}.${ext}`, blob);
                }
            }

            if (zip) {
                if (progressText) progressText.textContent = 'Creating ZIP archive...';
                const timestamp = new Date().getTime();
                const content = await zip.generateAsync({ type: 'blob' });
                downloadBlob(content, `layout-export-${timestamp}.zip`);
            }
        }
    } finally {
        if (loadingOverlay) loadingOverlay.classList.remove('active');
    }
}

async function performPublishFlipbook(qualityMultiplier) {
    const loadingOverlay = document.getElementById('export-loading');
    const progressText = document.getElementById('loading-progress');
    const loadingStatus = document.getElementById('loading-status');

    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
        loadingStatus.textContent = 'Publishing Flipbook...';
    }

    const { width: layoutWidth, height: layoutHeight } = calculatePaperDimensions();
    const width = Math.round(layoutWidth * qualityMultiplier);
    const height = Math.round(layoutHeight * qualityMultiplier);

    const apiPages = [];
    const bookmarks = extractBookmarksForApi(state.pages); // Keep existing local extraction for bookmarks

    try {
        for (let i = 0; i < state.pages.length; i++) {
            if (progressText) {
                progressText.textContent = `Rendering page ${i + 1} of ${state.pages.length}...`;
            }

            const pageLayout = state.pages[i];

            // Render as JPEG
            const result = await window.electronAPI.renderExport({
                pageLayout,
                width,
                height,
                format: 'jpeg',
                settings: getSettings(),
                assets: assetManager.getAssets()
            });

            if (result.error) throw new Error(result.error);

            // Convert buffer to base64 for upload
            // We can use FileReader or a simple function
            const blob = new Blob([result.data], { type: 'image/jpeg' });
            const base64Data = await blobToBase64(blob);

            // result.links contains the links extracted from the offscreen window
            // Since we render one page at a time here, result.links should be an array of links for this page.
            // Wait, src/main.js returns { links: allLinks } where allLinks is array of array of links.
            // Since we passed single pageLayout, result.links[0] should be the links for this page.
            let links = [];
            if (result.links && result.links.length > 0) {
                links = result.links[0];
            }

            apiPages.push({
                imageData: base64Data, // Data URL
                width,
                height,
                links
            });
        }

        if (progressText) progressText.textContent = 'Uploading to server...';

        // Add timeout for network request (60 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        let response;
        try {
            response = await fetch(FLIPBOOK_API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: document.querySelector('h1')?.textContent || 'My Flipbook',
                    pages: apiPages,
                    bookmarks: bookmarks
                }),
                signal: controller.signal
            });
        } catch (fetchError) {
            console.error('Network or CSP Error during publish:', fetchError);
            if (fetchError.name === 'AbortError') {
                throw new Error('Request timed out after 60s. Your flipbook might be too large or your connection slow.');
            }
            if (fetchError.message === 'Failed to fetch') {
                throw new Error('Network error or request blocked. This can happen if the API domain is blocked by security settings.');
            }
            throw new Error(`Connection failed: ${fetchError.message}`);
        } finally {
            clearTimeout(timeoutId);
        }

        if (!response.ok) {
            let errorMessage = `Server error: ${response.status} ${response.statusText}`;
            try {
                const error = await response.json();
                errorMessage = error.error || errorMessage;
            } catch {
                // Response wasn't JSON
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();
        if (result.url) {
            // Requirement 1: Open in new tab automatically
            window.open(result.url, '_blank');
            // We'll show the success modal AFTER the loading overlay is cleared in finally
            window._pendingSuccessUrl = result.url;
        }
    } finally {
        if (loadingOverlay) loadingOverlay.classList.remove('active');

        // If we have a pending success URL, show the modal now that the loading screen is gone
        if (window._pendingSuccessUrl) {
            const url = window._pendingSuccessUrl;
            delete window._pendingSuccessUrl;
            await showPublishSuccess(url);
        }
    }
}

function extractBookmarksForApi(pages) {
    const bookmarks = [];
    pages.forEach((page, index) => {
        const headings = extractHeadingsFromNode(page);
        headings.forEach(h => {
            bookmarks.push({
                title: h.text,
                page: index + 1
            });
        });
    });
    return bookmarks;
}

function extractHeadingsFromNode(node) {
    const headings = [];

    if (node.text) {
        // Extract headings from Markdown using regex
        const lines = node.text.split('\n');
        lines.forEach(line => {
            const match = line.match(/^(#{1,6})\s+(.+)$/);
            if (match) {
                headings.push({
                    level: match[1].length,
                    text: match[2].trim()
                });
            }
        });
    }

    if (node.children) {
        node.children.forEach(child => {
            headings.push(...extractHeadingsFromNode(child));
        });
    }

    return headings;
}

function downloadBlob(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
