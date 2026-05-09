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

    // Cache of last-applied asset signature, so we skip re-hydration
    // when the same assets are sent across many page renders.
    let lastAssetsSig = null;

    // Initial ready signal to main process
    const urlParams = new URLSearchParams(window.location.search);
    const requestId = urlParams.get('rid');
    if (window.electronAPI && window.electronAPI.sendReadyToRender) {
        window.electronAPI.sendReadyToRender(requestId);
    }

    // Listen for content to render. The export window is a long-lived singleton,
    // so this handler may be invoked many times for many different pages without
    // any URL reload. Each call replaces the DOM atomically.
    if (window.electronAPI && window.electronAPI.onRenderContent) {
        window.electronAPI.onRenderContent(async (data) => {
            const { requestId, pageLayout, pageLayouts, width, height, settings, assets, pageNumber: explicitPageNumber } = data;
            try {
                // Clear existing content for window reuse case
                paper.innerHTML = '';

                // 1. Apply Settings
                if (settings) {
                    loadSettings(settings);
                    applySettings();
                }

                // 2. Hydrate Assets - but skip if signature matches the last hydration.
                // This is a major win when rendering many pages back-to-back, since
                // hydration is expensive (data URLs, image decode, etc).
                if (assets && Array.isArray(assets)) {
                    const sig = assets.length === 0
                        ? 'empty'
                        : assets.map(a => `${a.id || a.assetId || a.name || ''}:${(a.fullResData || a.lowResData || a.data || '').length}`).join('|');
                    if (sig !== lastAssetsSig) {
                        assetManager.dispose();
                        assets.forEach(asset => {
                            assetManager.addAsset(asset);
                        });
                        lastAssetsSig = sig;
                    }
                }

                // Inject dynamic page size CSS for PDF export.
                // We re-create the @page rule each call (it may have changed dimensions).
                let pageStyle = document.getElementById('export-page-style');
                if (!pageStyle) {
                    pageStyle = document.createElement('style');
                    pageStyle.id = 'export-page-style';
                    document.head.appendChild(pageStyle);
                }
                pageStyle.innerHTML = `@page { size: ${width}px ${height}px; margin: 0; }`;

                const layouts = pageLayouts || [pageLayout];

                // Render each page
                for (let i = 0; i < layouts.length; i++) {
                    const layout = layouts[i];
                    const pageWrapper = document.createElement('div');
                    pageWrapper.className = 'a4-paper is-exporting';
                    pageWrapper.id = `export-page-${i}`;

                    // Set explicit dimensions (integer pixels)
                    const intW = Math.round(width);
                    const intH = Math.round(height);
                    pageWrapper.style.width = intW + 'px';
                    pageWrapper.style.height = intH + 'px';
                    pageWrapper.style.setProperty('--paper-current-width', `${intW}px`);
                    pageWrapper.style.setProperty('--paper-current-height', `${intH}px`);
                    // Specifically set the ratio to ensure aspect-ratio CSS rule works correctly
                    pageWrapper.style.setProperty('--ratio', `${intW / intH}`);

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
                        pageNumber: explicitPageNumber !== undefined ? explicitPageNumber : (i + 1)
                    });
                }

                await waitForImages(paper);
                await document.fonts.ready;

                // CRITICAL: Snap all flex layout to integer pixel boundaries.
                // This eliminates sub-pixel rendering artifacts at divider intersections
                // (1px gaps, overlaps, fuzzy edges) that Chromium otherwise produces
                // when rasterizing percentage-based flex layouts at high resolution.
                const wrappers = paper.querySelectorAll('.a4-paper');
                wrappers.forEach((wrapper) => {
                    snapLayoutToIntegerPixels(wrapper);
                });

                // Force a reflow + extra paint frame so the snapped layout is committed
                // before the main process captures.
                void paper.offsetHeight;
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

                // Extract links for Flipbook if needed
                const allLinks = [];
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

/**
 * Walk the rendered layout tree and snap every flex split to integer pixels.
 *
 * Why: the editor uses `flex-grow: <percent>` with `flex-basis: 0` for split
 * children and `flex-basis: <thickness>` for dividers. At export resolutions,
 * Chromium computes fractional widths/heights for percentage-grow children
 * (e.g. 387.6px), and its rasterizer rounds these inconsistently across
 * siblings, producing 1px gaps or overlaps at divider intersections.
 *
 * We fix this by measuring each split container's actual content size,
 * subtracting integer divider thicknesses, and distributing the remaining
 * pixels among children using largest-remainder rounding (so the integer
 * sum equals the parent dimension exactly). We then set children to
 * `flex: 0 0 <integer>px`, which makes Chromium paint pixel-perfect edges.
 *
 * @param {HTMLElement} root - The .a4-paper wrapper (export page)
 */
export function snapLayoutToIntegerPixels(root) {
    if (!root) return;

    // First, snap all divider thicknesses to integers (CSS already uses round(),
    // but we make it explicit here as well to avoid any rounding races).
    const dividers = root.querySelectorAll('.divider');
    dividers.forEach(d => {
        const cs = window.getComputedStyle(d);
        const isVertical = d.classList.contains('vertical-divider');
        const thickness = isVertical ? parseFloat(cs.width) : parseFloat(cs.height);
        const intThickness = Math.max(1, Math.round(thickness));
        if (isVertical) {
            d.style.width = `${intThickness}px`;
            d.style.minWidth = `${intThickness}px`;
            d.style.maxWidth = `${intThickness}px`;
        } else {
            d.style.height = `${intThickness}px`;
            d.style.minHeight = `${intThickness}px`;
            d.style.maxHeight = `${intThickness}px`;
        }
        d.style.flexBasis = `${intThickness}px`;
        d.style.flexShrink = '0';
        d.style.flexGrow = '0';
    });

    // Recursively snap each split container's children to integer pixels.
    // We walk top-down so parent sizes are already final integers when we
    // distribute pixels among children.
    function processContainer(container) {
        const splitState = container.getAttribute && container.getAttribute('data-split-state');
        if (splitState !== 'split') return;

        // Determine orientation from the divider class on a child
        const dividerChild = Array.from(container.children).find(c => c.classList && c.classList.contains('divider'));
        if (!dividerChild) return;
        const isVerticalSplit = dividerChild.classList.contains('vertical-divider');
        // 'vertical-divider' = vertical line => container is flex-row (children side-by-side)
        // 'horizontal-divider' = horizontal line => container is flex-col (children stacked)
        const axis = isVerticalSplit ? 'width' : 'height';

        const contRect = container.getBoundingClientRect();
        const totalSize = Math.round(axis === 'width' ? contRect.width : contRect.height);

        // Sum all divider sizes (children of this container that are dividers)
        const dividerKids = Array.from(container.children).filter(c => c.classList && c.classList.contains('divider'));
        let dividerTotal = 0;
        dividerKids.forEach(d => {
            const ds = d.getBoundingClientRect();
            dividerTotal += Math.round(axis === 'width' ? ds.width : ds.height);
        });

        const available = Math.max(0, totalSize - dividerTotal);

        // Identify rect children (non-dividers)
        const rectKids = Array.from(container.children).filter(c => !c.classList || !c.classList.contains('divider'));
        if (rectKids.length === 0) return;

        // Read each rect's current desired share. We use its current rendered
        // size (which is what flex resolved) as the target proportion.
        const sizes = rectKids.map(r => {
            const rs = r.getBoundingClientRect();
            return axis === 'width' ? rs.width : rs.height;
        });
        const sumSizes = sizes.reduce((a, b) => a + b, 0) || 1;

        // Largest-remainder rounding so integer sum exactly equals `available`.
        const exact = sizes.map(s => (s / sumSizes) * available);
        const floored = exact.map(v => Math.floor(v));
        let remainder = available - floored.reduce((a, b) => a + b, 0);
        const remainders = exact.map((v, i) => ({ i, frac: v - Math.floor(v) }));
        remainders.sort((a, b) => b.frac - a.frac);
        for (let k = 0; k < remainder; k++) {
            floored[remainders[k % remainders.length].i] += 1;
        }

        // Apply integer pixel sizes to children.
        rectKids.forEach((r, i) => {
            const px = floored[i];
            // Override flex completely with explicit pixels.
            r.style.flex = `0 0 ${px}px`;
            r.style.flexBasis = `${px}px`;
            r.style.flexGrow = '0';
            r.style.flexShrink = '0';
            if (axis === 'width') {
                r.style.width = `${px}px`;
                r.style.minWidth = `${px}px`;
                r.style.maxWidth = `${px}px`;
            } else {
                r.style.height = `${px}px`;
                r.style.minHeight = `${px}px`;
                r.style.maxHeight = `${px}px`;
            }
        });

        // Force a reflow before recursing into children, so their getBoundingClientRect
        // reflects the new integer sizing.
        void container.offsetHeight;

        // Recurse into rect kids (which may themselves be split containers)
        rectKids.forEach(r => processContainer(r));
    }

    // Find the root rect inside the .a4-paper wrapper (the rect-1 that is the
    // direct child) and start processing from there.
    Array.from(root.children).forEach(child => {
        if (child.classList && child.classList.contains('splittable-rect')) {
            processContainer(child);
        }
    });
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

    const { width: layoutWidth, height: layoutHeight } = calculatePaperDimensions();
    const width = Math.round(layoutWidth * qualityMultiplier);
    const height = Math.round(layoutHeight * qualityMultiplier);

    if (!state.pages || state.pages.length === 0) {
        toast.error('No pages to export.');
        return;
    }

    // Derive export filename from the saved layout name, or fall back to timestamped default
    const baseName = state.currentFilePath
        ? state.currentFilePath.replace(/\\/g, '/').split('/').pop().replace(/\.broco$/i, '')
        : `layout-export-${Date.now()}`;

    const isSingleImageExport = (format === 'png' || format === 'jpeg') && state.pages.length === 1;
    const isZipExport = (format === 'png' || format === 'jpeg') && state.pages.length > 1;
    const zip = isZipExport ? new JSZip() : null;
    let exportPath = null;

    if (window.electronAPI && window.electronAPI.isElectron) {
        let filters = [];
        let defaultExtension = '';
        if (format === 'pdf') {
            filters = [{ name: 'PDF Document', extensions: ['pdf'] }];
            defaultExtension = '.pdf';
        } else if (isZipExport) {
            filters = [{ name: 'ZIP Archive', extensions: ['zip'] }];
            defaultExtension = '.zip';
        } else if (format === 'png') {
            filters = [{ name: 'PNG Image', extensions: ['png'] }];
            defaultExtension = '.png';
        } else if (format === 'jpeg') {
            filters = [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }];
            defaultExtension = '.jpg';
        }

        const dialogResult = await window.electronAPI.showSaveDialog({
            title: 'Export Layout',
            defaultPath: `${baseName}${defaultExtension}`,
            filters: filters
        });

        if (dialogResult.canceled || !dialogResult.path) {
            return;
        }
        exportPath = dialogResult.path;
    }

    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
        const formatText = format.toUpperCase();
        if (loadingStatus) loadingStatus.textContent = `Generating ${formatText === 'JPEG' ? 'JPG' : formatText}...`;
    }

    // Now that we have the path, let the UI update the loading state
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        if (format === 'pdf') {
            if (progressText) progressText.textContent = 'Rendering PDF...';

            // Hook up incremental progress reporting from the main process.
            // For multi-page PDFs we render page-by-page in the export window
            // and merge via pdf-lib in the main process. This bounds memory
            // usage to a single page regardless of total page count, which
            // is what makes the app handle hundreds of image-heavy pages.
            let unsubscribeProgress = null;
            if (window.electronAPI.onExportProgress) {
                unsubscribeProgress = window.electronAPI.onExportProgress(({ current, total }) => {
                    if (progressText) progressText.textContent = `Rendering page ${current} of ${total}...`;
                });
            }

            let result;
            try {
                if (state.pages.length > 1 && window.electronAPI.renderExportPdfStreaming) {
                    // Streaming path - bounded memory, per-page rendering.
                    result = await window.electronAPI.renderExportPdfStreaming({
                        pageLayouts: state.pages,
                        width,
                        height,
                        settings: getSettings(),
                        assets: assetManager.getAssets()
                    });
                } else {
                    // Single-page or fallback path.
                    result = await window.electronAPI.renderExport({
                        pageLayouts: state.pages,
                        width,
                        height,
                        format: 'pdf',
                        settings: getSettings(),
                        assets: assetManager.getAssets()
                    });
                }
            } finally {
                if (typeof unsubscribeProgress === 'function') unsubscribeProgress();
            }

            if (result.error) throw new Error(result.error);

            if (exportPath) {
                await window.electronAPI.saveBinaryFile(result.data, exportPath);
                toast.success('Export saved successfully', 4000, () => {
                    if (exportPath && window.electronAPI && window.electronAPI.showItemInFolder) {
                        window.electronAPI.showItemInFolder(exportPath);
                    }
                });
            } else {
                const blob = new Blob([result.data], { type: 'application/pdf' });
                downloadBlob(blob, `${baseName}.pdf`);
            }


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
                    assets: assetManager.getAssets(),
                    pageNumber: i + 1
                });

                if (result.error) throw new Error(result.error);

                const ext = format === 'jpeg' ? 'jpg' : 'png';
                const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
                
                if (isSingleImageExport) {
                    if (exportPath) {
                        await window.electronAPI.saveBinaryFile(result.data, exportPath);
                        toast.success('Export saved successfully', 4000, () => {
                            if (exportPath && window.electronAPI && window.electronAPI.showItemInFolder) {
                                window.electronAPI.showItemInFolder(exportPath);
                            }
                        });
                    } else {
                        const blob = new Blob([result.data], { type: mime });
                        downloadBlob(blob, `${baseName}.${ext}`);
                    }
                } else if (zip) {
                    const blob = new Blob([result.data], { type: mime });
                    zip.file(`page-${i + 1}.${ext}`, blob);
                }
            }

            if (zip) {
                if (progressText) progressText.textContent = 'Creating ZIP archive...';
                if (exportPath) {
                    const content = await zip.generateAsync({ type: 'uint8array' });
                    await window.electronAPI.saveBinaryFile(content, exportPath);
                    toast.success('Export saved successfully', 4000, () => {
                        if (exportPath && window.electronAPI && window.electronAPI.showItemInFolder) {
                            window.electronAPI.showItemInFolder(exportPath);
                        }
                    });
                } else {
                    const content = await zip.generateAsync({ type: 'blob' });
                    downloadBlob(content, `${baseName}.zip`);
                }
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
                assets: assetManager.getAssets(),
                    pageNumber: i + 1
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
