import JSZip from 'jszip';
import { assetManager } from '../assets/AssetManager.js';
import { renderLayout } from '../layout/renderer.js';
import { loadSettings, applySettings, calculatePaperDimensions, getSettings } from '../ui/settings.js';
import { state } from '../core/state.js';
import { showPublishSuccess, showAlert } from '../core/utils.js';
import { toast } from '../core/errorHandler.js';

const FLIPBOOK_API_ENDPOINT = 'https://content.lojkine.art/api/flipbook';

/**
 * Specialized initialization for off-screen rendering (Export mode)
 */
export async function initializeExportMode() {
    // Specialized initialization for off-screen rendering
    document.body.innerHTML = '';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    // Allow scrolling/growing for multi-page PDF
    document.body.style.overflow = 'visible';

    // Create the paper container
    const paper = document.createElement('div');
    paper.id = 'export-root';
    paper.style.margin = '0';
    paper.style.padding = '0';
    paper.style.width = '100%';
    paper.style.minHeight = '100vh';
    paper.style.display = 'flex';
    paper.style.flexDirection = 'column';

    document.body.appendChild(paper);

    // Initial ready signal to main process
    const urlParams = new URLSearchParams(window.location.search);
    const requestId = urlParams.get('rid');
    if (window.electronAPI && window.electronAPI.sendReadyToRender) {
        window.electronAPI.sendReadyToRender(requestId);
    }

    // Listen for content to render
    if (window.electronAPI && window.electronAPI.onRenderContent) {
        window.electronAPI.onRenderContent(async (data) => {
            const { requestId, pageLayout, pageLayouts, width, height, settings, assets } = data;
            try {
                // Clear existing content for window reuse case
                paper.innerHTML = '';

                // 1. Apply Settings
                if (settings) {
                    loadSettings(settings);
                    applySettings();
                }

                // 2. Hydrate Assets
                if (assets && Array.isArray(assets)) {
                    assetManager.dispose();
                    assets.forEach(asset => {
                        assetManager.addAsset(asset);
                    });
                }

                // Inject dynamic page size CSS for PDF export
                // This corresponds to preferCSSPageSize: true in Electron
                const pageStyle = document.createElement('style');
                pageStyle.innerHTML = `@page { size: ${width}px ${height}px; margin: 0; }`;
                document.head.appendChild(pageStyle);

                const layouts = pageLayouts || [pageLayout];

                // Render each page
                for (let i = 0; i < layouts.length; i++) {
                    const layout = layouts[i];
                    const pageWrapper = document.createElement('div');
                    pageWrapper.className = 'a4-paper is-exporting';
                    pageWrapper.id = `export-page-${i}`;

                    // Set explicit dimensions
                    pageWrapper.style.width = width + 'px';
                    pageWrapper.style.height = height + 'px';
                    pageWrapper.style.setProperty('--paper-current-width', `${width}px`);
                    pageWrapper.style.setProperty('--paper-current-height', `${height}px`);
                    // Specifically set the ratio to ensure aspect-ratio CSS rule works correctly
                    pageWrapper.style.setProperty('--ratio', `${width / height}`);

                    pageWrapper.style.position = 'relative';
                    pageWrapper.style.margin = '0';
                    pageWrapper.style.boxShadow = 'none';

                    if (i < layouts.length - 1) {
                        pageWrapper.style.breakAfter = 'page';
                        pageWrapper.style.pageBreakAfter = 'always';
                    }

                    paper.appendChild(pageWrapper);

                    await renderLayout(pageWrapper, layout, {
                        useHighResImages: true,
                        hideControls: true,
                        pageNumber: i + 1
                    });
                }

                await waitForImages(paper);
                await document.fonts.ready;

                // Extract links for Flipbook if needed
                const allLinks = [];
                const wrappers = paper.querySelectorAll('.a4-paper');
                wrappers.forEach((wrapper) => {
                    const links = extractLinksForExport(wrapper);
                    allLinks.push(links);
                });

                window.electronAPI.sendRenderComplete({ requestId, links: allLinks });
            } catch (err) {
                console.error('Export render failed:', err);
                window.electronAPI.sendRenderComplete({ requestId, error: err.message });
            }
        });
    }
}

export function extractLinksForExport(container) {
    const links = [];
    const containerRect = container.getBoundingClientRect();
    const anchorElements = container.querySelectorAll('a');

    anchorElements.forEach(a => {
        const href = a.getAttribute('href') || '';
        const rects = a.getClientRects();

        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const x = ((r.left - containerRect.left) / containerRect.width) * 100;
            const y = ((r.top - containerRect.top) / containerRect.height) * 100;
            const w = (r.width / containerRect.width) * 100;
            const h = (r.height / containerRect.height) * 100;

            const linkData = {
                title: a.textContent.trim(),
                rect: { x, y, width: w, height: h }
            };

            if (href.startsWith('#page=')) {
                linkData.type = 'internal';
                linkData.targetPage = parseInt(href.replace('#page=', ''));
            } else {
                linkData.type = 'external';
                linkData.url = href;
            }
            links.push(linkData);
        }
    });

    return links;
}

export function waitForImages(container) {
    const promises = [];
    const elements = container.querySelectorAll('*');
    for (let el of elements) {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundImage;
        if (bg && bg !== 'none') {
            const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
            if (match && match[1]) {
                promises.push(new Promise((resolve) => {
                    const img = new Image();
                    img.src = match[1];
                    if (img.complete) resolve();
                    else {
                        img.onload = resolve;
                        img.onerror = resolve;
                    }
                }));
            }
        }
        if (el.tagName === 'IMG' && el.src) {
            promises.push(new Promise((resolve) => {
                if (el.complete) resolve();
                else {
                    el.onload = resolve;
                    el.onerror = resolve;
                }
            }));
        }
    }
    return Promise.all(promises);
}

/**
 * Sets up the export UI handlers for the main application
 * LOGIC RESTORED FROM oldExport.js
 */
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
        if (qualityValue) qualityValue.textContent = `${quality}%`;
        const multiplier = quality / 100;

        const { width: layoutWidth, height: layoutHeight } = calculatePaperDimensions();
        const width = Math.round(layoutWidth * multiplier);
        const height = Math.round(layoutHeight * multiplier);
        if (dimensionsText) dimensionsText.textContent = `${width} x ${height} px`;
    }

    qualitySlider?.addEventListener('input', updateDimensions);
    updateDimensions(); // Initial call

    const downloadModal = document.getElementById('download-app-modal');
    const downloadCloseBtn = document.getElementById('download-app-close');

    exportBtn.addEventListener('click', () => {
        try {
            // Check if running in Electron (using the API we exposed)
            if (!window.electronAPI) {
                if (downloadModal) {
                    downloadModal.classList.add('active');
                } else {
                    toast.error('Export is only available in the desktop app. Please download it from GitHub.');
                }
                return;
            }

            modal.classList.add('active');
            updateDimensions();
        } catch (error) {
            console.error('Failed to open export modal:', error);
            toast.error('Failed to open export options. Please refresh and try again.');
        }
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
    cancelBtn?.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    confirmBtn?.addEventListener('click', async () => {
        try {
            const formatSelect = document.getElementById('export-format-select');
            const format = formatSelect.value;
            const qualityMultiplier = parseInt(qualitySlider.value) / 100;

            confirmBtn.disabled = true;
            const originalText = confirmBtn.textContent;
            confirmBtn.textContent = 'Generating...';

            await performExport(format, qualityMultiplier);
        } catch (error) {
            console.error('Export failed:', error);
            toast.error(`Export failed: ${error.message}`);
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Export'; // Reset to default text, checking variable scope
            }
            modal.classList.remove('active');
        }
    });

    if (publishConfirmBtn) {
        publishConfirmBtn.addEventListener('click', async () => {
            try {
                const qualityMultiplier = parseInt(qualitySlider.value) / 100;
                publishConfirmBtn.disabled = true;
                publishConfirmBtn.textContent = 'Publishing...';

                await performPublishFlipbook(qualityMultiplier);
            } catch (error) {
                console.error('Publish failed:', error);
                toast.error(`Publishing failed: ${error.message}`);
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
        if (loadingStatus) loadingStatus.textContent = `Generating ${formatText === 'JPEG' ? 'JPG' : formatText}...`;
    }

    const { width: layoutWidth, height: layoutHeight } = calculatePaperDimensions();
    const width = Math.round(layoutWidth * qualityMultiplier);
    const height = Math.round(layoutHeight * qualityMultiplier);

    if (!state.pages || state.pages.length === 0) {
        if (loadingOverlay) loadingOverlay.classList.remove('active');
        toast.error('No pages to export.');
        return;
    }

    const isSingleImageExport = (format === 'png' || format === 'jpeg') && state.pages.length === 1;
    const zip = (format === 'png' || format === 'jpeg') && state.pages.length > 1 ? new JSZip() : null;

    try {
        if (format === 'pdf') {
            if (progressText) progressText.textContent = 'Rendering PDF...';

            const result = await window.electronAPI.renderExport({
                pageLayouts: state.pages,
                width,
                height,
                format: 'pdf',
                settings: getSettings(),
                assets: assetManager.getAssets()
            });

            if (result.error) throw new Error(result.error);

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
                    format: format,
                    settings: getSettings(),
                    assets: assetManager.getAssets()
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
    } catch (error) {
        console.error('Export operation failed:', error);
        toast.error(`Export failed: ${error.message}`);
        throw error; // Re-throw to let caller know failure occurred
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
        if (loadingStatus) loadingStatus.textContent = 'Publishing Flipbook...';
    }

    const { width: layoutWidth, height: layoutHeight } = calculatePaperDimensions();
    const width = Math.round(layoutWidth * qualityMultiplier);
    const height = Math.round(layoutHeight * qualityMultiplier);

    const apiPages = [];
    const bookmarks = extractBookmarksForApi(state.pages);

    try {
        for (let i = 0; i < state.pages.length; i++) {
            if (progressText) {
                progressText.textContent = `Rendering page ${i + 1} of ${state.pages.length}...`;
            }

            const pageLayout = state.pages[i];

            const result = await window.electronAPI.renderExport({
                pageLayout,
                width,
                height,
                format: 'jpeg',
                settings: getSettings(),
                assets: assetManager.getAssets()
            });

            if (result.error) throw new Error(result.error);

            const blob = new Blob([result.data], { type: 'image/jpeg' });
            const base64Data = await blobToBase64(blob);

            let links = [];
            if (result.links && result.links.length > 0) {
                links = result.links[0];
            }

            apiPages.push({
                imageData: base64Data,
                width,
                height,
                links
            });
        }

        if (progressText) progressText.textContent = 'Uploading to server...';

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

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
            if (fetchError.name === 'AbortError') {
                throw new Error('Request timed out. Please check your connection and try again.');
            }
            throw new Error('Network error. Please check your internet connection.');
        } finally {
            clearTimeout(timeoutId);
        }

        if (!response.ok) {
            let errorMessage = 'Failed to publish flipbook';
            try {
                const error = await response.json();
                errorMessage = error.error || errorMessage;
            } catch { /* ignore */ }
            throw new Error(errorMessage);
        }

        const result = await response.json();
        if (result.url) {
            window.open(result.url, '_blank');
            window._pendingSuccessUrl = result.url;
        }
    } catch (error) {
        console.error('Publishing step failed:', error);
        toast.error(error.message || 'Failed to publish flipbook.');
        throw error;
    } finally {
        if (loadingOverlay) loadingOverlay.classList.remove('active');

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
