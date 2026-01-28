import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
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

    exportBtn.addEventListener('click', () => {
        modal.classList.add('active');
        updateDimensions();
    });

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
            showAlert('Export failed. Please try again.', 'Error');
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
                showAlert('Publishing failed. Please try again.', 'Error');
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
        // Dynamic status text based on format
        const formatText = format.toUpperCase();
        loadingStatus.textContent = `Generating ${formatText === 'JPEG' ? 'JPG' : formatText}...`;
    }

    const tempContainer = document.createElement('div');
    const { width: layoutWidth, height: layoutHeight } = calculatePaperDimensions();

    tempContainer.style.position = 'fixed';
    tempContainer.style.top = '0';
    tempContainer.style.left = '0';
    tempContainer.style.zIndex = '-9999';
    tempContainer.style.width = `${layoutWidth}px`;
    tempContainer.style.height = `${layoutHeight}px`;
    tempContainer.style.backgroundColor = '#ffffff';
    tempContainer.style.boxSizing = 'border-box';
    tempContainer.style.margin = '0';
    tempContainer.style.padding = '0';
    tempContainer.style.border = 'none';
    tempContainer.style.boxShadow = 'none';

    tempContainer.className = 'export-container';
    // Fix: Ensure container queries (cqw/cqh) resolve correctly against this container
    tempContainer.style.containerType = 'size';
    document.body.appendChild(tempContainer);

    const isSingleImageExport = (format === 'png' || format === 'jpeg') && state.pages.length === 1;
    const zip = (format === 'png' || format === 'jpeg') && state.pages.length > 1 ? new JSZip() : null;
    let pdf = null;

    try {
        for (let i = 0; i < state.pages.length; i++) {
            if (progressText) {
                progressText.textContent = `Processing page ${i + 1} of ${state.pages.length}...`;
            }

            const pageLayout = state.pages[i];

            tempContainer.innerHTML = '';
            const paperWrapper = document.createElement('div');
            paperWrapper.className = 'a4-paper';
            paperWrapper.style.width = '100%';
            paperWrapper.style.height = '100%';
            paperWrapper.style.boxShadow = 'none';
            paperWrapper.style.margin = '0';
            paperWrapper.style.zoom = '1';
            // PROPORTIONAL EXPORT: Set the fixed base width so calculations are stable
            paperWrapper.style.setProperty('--paper-current-width', `${layoutWidth}px`);
            tempContainer.appendChild(paperWrapper);

            renderLayout(paperWrapper, pageLayout, {
                useHighResImages: true,
                hideControls: true
            });

            // Wait for high-res images and fonts to be ready for capture
            await waitForBackgroundImages(paperWrapper);
            await document.fonts.ready;

            // SVG Overlay Injection
            const svgOverlay = generateSvgOverlay(paperWrapper, layoutWidth, layoutHeight);
            if (svgOverlay) {
                paperWrapper.appendChild(svgOverlay);
            }

            const canvas = await html2canvas(tempContainer, {
                scale: qualityMultiplier,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
                width: layoutWidth,
                height: layoutHeight,
                windowWidth: layoutWidth,
                windowHeight: layoutHeight
            });

            const timestampForFile = new Date().getTime();
            const exportFileName = `layout-export-${timestampForFile}`;

            if (format === 'pdf') {
                const imgData = canvas.toDataURL('image/jpeg', 0.95);

                // Calculate PDF dimensions (maintain aspect ratio)
                // Default PDF unit is 'pt' (1 pt = 1/72 inch). 
                // We'll use points but match the pixel aspect ratio directly.
                // Optionally we could just use 'px' unit in jsPDF but strict 'pt' is standar.
                // Let's map 1px = 0.75pt (approx) or just use the layout dimensions directly as points 
                // to keep it simple and perfectly proportional.
                const pdfWidth = layoutWidth * 0.75;
                const pdfHeight = layoutHeight * 0.75;
                const orientation = pdfWidth > pdfHeight ? 'landscape' : 'portrait';

                if (!pdf) {
                    pdf = new jsPDF({
                        orientation: orientation,
                        unit: 'pt',
                        format: [pdfWidth, pdfHeight]
                    });
                } else {
                    pdf.addPage([pdfWidth, pdfHeight], orientation);
                }

                pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

                // Add interactive links
                // Scale factor for links: PDF dimensions / Layout dimensions
                addLinksToPdf(pdf, paperWrapper, pdfWidth / layoutWidth);

            } else if (isSingleImageExport) {
                const ext = format === 'jpeg' ? 'jpg' : 'png';
                const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
                const dataUrl = canvas.toDataURL(mime, format === 'jpeg' ? 0.95 : 1.0);
                const link = document.createElement('a');
                link.href = dataUrl;
                link.download = `${exportFileName}.${ext}`;
                link.click();
            } else if (zip) {
                const ext = format === 'jpeg' ? 'jpg' : 'png';
                const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
                const dataUrl = canvas.toDataURL(mime, format === 'jpeg' ? 0.95 : 1.0);
                const base64Data = dataUrl.split(',')[1];
                zip.file(`page-${i + 1}.${ext}`, base64Data, { base64: true });
            }
        }

        const timestamp = new Date().getTime();
        if (format === 'pdf' && pdf) {
            // Add bookmarks for headings from text content
            addPdfBookmarks(pdf, state.pages);
            pdf.save(`layout-export-${timestamp}.pdf`);
        } else if (zip) {
            const content = await zip.generateAsync({ type: 'blob' });
            downloadBlob(content, `layout-export-${timestamp}.zip`);
        }
    } finally {
        document.body.removeChild(tempContainer);
        if (loadingOverlay) loadingOverlay.classList.remove('active');
    }
}

function generateSvgOverlay(paperWrapper, layoutWidth, layoutHeight) {
    const settings = getSettings();
    const borderThickness = settings.dividers.width;
    const borderColor = settings.dividers.color;

    // If thickness is 0, no dividers or borders should be rendered
    if (borderThickness <= 0) return null;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', layoutWidth);
    svg.setAttribute('height', layoutHeight);
    svg.setAttribute('viewBox', `0 0 ${layoutWidth} ${layoutHeight}`);

    // Position SVG precisely over the paper
    Object.assign(svg.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '9999'
    });

    // 1. Draw Paper Border
    if (settings.dividers.showBorders) {
        const borderRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const halfWidth = borderThickness / 2;

        // Inset the rect by half the stroke width to match CSS border behavior
        borderRect.setAttribute('x', halfWidth);
        borderRect.setAttribute('y', halfWidth);
        borderRect.setAttribute('width', layoutWidth - borderThickness);
        borderRect.setAttribute('height', layoutHeight - borderThickness);
        borderRect.setAttribute('fill', 'none');
        borderRect.setAttribute('stroke', borderColor);
        borderRect.setAttribute('stroke-width', borderThickness);
        svg.appendChild(borderRect);
    }

    // 2. Draw Dividers
    const dividers = paperWrapper.querySelectorAll('.divider');
    const paperRect = paperWrapper.getBoundingClientRect();

    // Support varying export resolutions by mapping DOM coordinates to SVG viewBox
    const scaleX = layoutWidth / paperRect.width;
    const scaleY = layoutHeight / paperRect.height;

    dividers.forEach(div => {
        const r = div.getBoundingClientRect();

        const x = (r.left - paperRect.left) * scaleX;
        const y = (r.top - paperRect.top) * scaleY;
        const w = r.width * scaleX;
        const h = r.height * scaleY;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');

        // Bleed strategy: Expand the rect slightly (0.5px) to prevent sub-pixel white slivers
        const bleed = 0.5;
        rect.setAttribute('x', x - bleed);
        rect.setAttribute('y', y - bleed);
        rect.setAttribute('width', w + (bleed * 2));
        rect.setAttribute('height', h + (bleed * 2));

        rect.setAttribute('fill', borderColor);
        // crispEdges disables anti-aliasing which is critical for perfect gaps-free rendering
        rect.setAttribute('shape-rendering', 'crispEdges');

        svg.appendChild(rect);

        // Hide original DOM divider while preserving layout
        div.style.opacity = '0';
    });

    // Hide original DOM border
    paperWrapper.style.border = 'none';

    return svg;
}

async function performPublishFlipbook(qualityMultiplier) {
    const loadingOverlay = document.getElementById('export-loading');
    const progressText = document.getElementById('loading-progress');
    const loadingStatus = document.getElementById('loading-status');

    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
        loadingStatus.textContent = 'Publishing Flipbook...';
    }

    // STRICT ALIGNMENT WITH performExport
    const tempContainer = document.createElement('div');
    // Basic resets
    const { width: layoutWidth, height: layoutHeight } = calculatePaperDimensions();

    tempContainer.style.position = 'fixed';
    tempContainer.style.top = '0';
    tempContainer.style.left = '0';
    tempContainer.style.zIndex = '-9999';
    tempContainer.style.width = `${layoutWidth}px`;
    tempContainer.style.height = `${layoutHeight}px`;
    tempContainer.style.backgroundColor = '#ffffff';
    // CRITICAL: Copy styles from performExport that affect layout/wrapping
    tempContainer.style.boxSizing = 'border-box';
    tempContainer.style.margin = '0';
    tempContainer.style.padding = '0';
    tempContainer.style.border = 'none';
    tempContainer.style.boxShadow = 'none';

    // CRITICAL: Add the class that might provide CSS resets
    tempContainer.className = 'export-container';
    // Fix: Ensure container queries (cqw/cqh) resolve correctly against this container
    tempContainer.style.containerType = 'size';
    document.body.appendChild(tempContainer);

    const apiPages = [];

    try {
        for (let i = 0; i < state.pages.length; i++) {
            if (progressText) {
                progressText.textContent = `Rendering page ${i + 1} of ${state.pages.length}...`;
            }

            const pageLayout = state.pages[i];
            tempContainer.innerHTML = '';
            const paperWrapper = document.createElement('div');
            paperWrapper.className = 'a4-paper';
            paperWrapper.style.width = '100%';
            paperWrapper.style.height = '100%';
            paperWrapper.style.boxShadow = 'none';
            paperWrapper.style.margin = '0';
            // CRITICAL: Layout consistency
            paperWrapper.style.zoom = '1';
            // PROPORTIONAL EXPORT: Set the fixed base width so calculations are stable
            paperWrapper.style.setProperty('--paper-current-width', `${layoutWidth}px`);
            tempContainer.appendChild(paperWrapper);

            renderLayout(paperWrapper, pageLayout, {
                useHighResImages: true,
                hideControls: true
            });

            await waitForBackgroundImages(paperWrapper);
            await document.fonts.ready;

            // SVG Overlay Injection
            const svgOverlay = generateSvgOverlay(paperWrapper, layoutWidth, layoutHeight);
            if (svgOverlay) {
                paperWrapper.appendChild(svgOverlay);
            }

            // Remove UI elements logic is now handled by renderLayout options

            // Ensure all links are extracted based on the rendered DOM
            const { width: layoutWidth, height: layoutHeight } = calculatePaperDimensions();

            const canvas = await html2canvas(tempContainer, {
                scale: qualityMultiplier,
                useCORS: true,
                width: layoutWidth,
                height: layoutHeight,
                windowWidth: layoutWidth,
                windowHeight: layoutHeight,
                backgroundColor: '#ffffff'
            });

            const imageData = canvas.toDataURL('image/jpeg', 0.9);
            const links = extractLinksForApi(paperWrapper);

            apiPages.push({
                imageData,
                width: layoutWidth,
                height: layoutHeight,
                links
            });
        }

        if (progressText) progressText.textContent = 'Uploading to server...';

        const bookmarks = extractBookmarksForApi(state.pages);

        // Add timeout for network request (30 seconds)
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
        document.body.removeChild(tempContainer);
        if (loadingOverlay) loadingOverlay.classList.remove('active');

        // If we have a pending success URL, show the modal now that the loading screen is gone
        if (window._pendingSuccessUrl) {
            const url = window._pendingSuccessUrl;
            delete window._pendingSuccessUrl;
            await showPublishSuccess(url);
        }
    }
}


function extractLinksForApi(container) {
    const links = [];
    const containerRect = container.getBoundingClientRect();
    const anchorElements = container.querySelectorAll('a');

    anchorElements.forEach(a => {
        const href = a.getAttribute('href') || '';
        const rects = a.getClientRects();

        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];

            // Convert to percentages relative to paper container
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
            } else if (href.startsWith('http') || href.startsWith('mailto:')) {
                linkData.type = 'external';
                linkData.url = href;
            } else {
                // Default to external if it starts with anything else (like www.)
                linkData.type = 'external';
                linkData.url = href;
            }

            links.push(linkData);
        }
    });

    return links;
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

function waitForBackgroundImages(container) {
    const promises = [];
    const elements = container.querySelectorAll('*');
    for (let el of elements) {
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
            const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
            if (match && match[1]) {
                promises.push(new Promise((resolve) => {
                    const img = new Image();
                    img.src = match[1];
                    if (img.complete) {
                        resolve();
                    } else {
                        img.onload = resolve;
                        img.onerror = resolve; // Resolve anyway to avoid hanging
                    }
                }));
            }
        }
    }
    return Promise.all(promises);
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
function addPdfBookmarks(pdf, pages) {
    // Extract headings from all text nodes across pages
    pages.forEach((page, pageIndex) => {
        const headings = extractHeadingsFromNode(page);
        headings.forEach(heading => {
            try {
                // jsPDF outline API: pdf.outline.add(parent, title, options)
                // Page numbers are 1-indexed in jsPDF
                pdf.outline.add(null, heading.text, { pageNumber: pageIndex + 1 });
            } catch (e) {
                // Outline API may not be available in all jsPDF versions
                console.warn('PDF bookmark not added:', e.message);
            }
        });
    });
}

function addLinksToPdf(pdf, container, scale) {
    const links = container.querySelectorAll('a');
    const containerRect = container.getBoundingClientRect();

    links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;

        const rects = link.getClientRects(); // Using getClientRects for multi-line links
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];

            // Calculate coordinates relative to container
            const x = (rect.left - containerRect.left) * scale;
            const y = (rect.top - containerRect.top) * scale;
            const w = rect.width * scale;
            const h = rect.height * scale;

            // Add link to PDF
            pdf.link(x, y, w, h, { url: href });
        }
    });
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
