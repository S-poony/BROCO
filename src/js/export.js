import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { assetManager } from './AssetManager.js';
import { A4_PAPER_ID } from './constants.js';
import { state } from './state.js';
import { renderLayout } from './renderer.js';
import { showAlert, showPublishSuccess } from './utils.js';
import { toast } from './errorHandler.js';

const BASE_A4_WIDTH = 794;
const BASE_A4_HEIGHT = 1123;

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
        const width = Math.round(BASE_A4_WIDTH * multiplier);
        const height = Math.round(BASE_A4_HEIGHT * multiplier);
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
    const progressText = document.getElementById('loading-progress');

    if (loadingOverlay) loadingOverlay.classList.add('active');

    const tempContainer = document.createElement('div');
    // ... existing style setup ...
    tempContainer.style.position = 'fixed';
    tempContainer.style.top = '0';
    tempContainer.style.left = '0';
    tempContainer.style.zIndex = '-9999';
    tempContainer.style.width = `${BASE_A4_WIDTH}px`;
    tempContainer.style.height = `${BASE_A4_HEIGHT}px`;
    tempContainer.style.backgroundColor = '#ffffff';
    tempContainer.style.boxSizing = 'border-box';
    tempContainer.style.margin = '0';
    tempContainer.style.padding = '0';
    tempContainer.style.border = 'none';
    tempContainer.style.boxShadow = 'none';

    tempContainer.className = 'export-container';
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
            paperWrapper.style.border = 'none';
            paperWrapper.style.margin = '0';
            paperWrapper.style.zoom = '1';
            tempContainer.appendChild(paperWrapper);

            renderLayout(paperWrapper, pageLayout);

            await swapImagesForHighRes(paperWrapper);
            await document.fonts.ready;

            paperWrapper.querySelectorAll('.remove-image-btn, .remove-text-btn, .text-prompt, .align-text-btn, .text-editor, .edge-handle').forEach(el => el.remove());

            const canvas = await html2canvas(tempContainer, {
                scale: qualityMultiplier,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
                width: BASE_A4_WIDTH,
                height: BASE_A4_HEIGHT,
                windowWidth: BASE_A4_WIDTH,
                windowHeight: BASE_A4_HEIGHT
            });

            const timestampForFile = new Date().getTime();
            const exportFileName = `layout-export-${timestampForFile}`;

            if (format === 'pdf') {
                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                const PDF_W = 595.28;
                const PDF_H = 841.89;

                if (!pdf) {
                    pdf = new jsPDF({
                        orientation: 'portrait',
                        unit: 'pt',
                        format: 'a4'
                    });
                } else {
                    pdf.addPage();
                }
                pdf.addImage(imgData, 'JPEG', 0, 0, PDF_W, PDF_H);

                // Add interactive links
                addLinksToPdf(pdf, paperWrapper, PDF_W / BASE_A4_WIDTH);

            } else if (isSingleImageExport) {
                const ext = format === 'jpeg' ? 'jpg' : 'png';
                const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
                // Using toDataURL for direct download to ensure it happens synchronously with the loop or before cleanup
                // Actually toBlob is fine if we wait for it, but toDataURL is easier for immediate download logic
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

async function performPublishFlipbook(qualityMultiplier) {
    const loadingOverlay = document.getElementById('export-loading');
    const progressText = document.getElementById('loading-progress');
    const loadingStatus = document.getElementById('loading-status');

    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
        loadingStatus.textContent = 'Publishing Flipbook...';
    }

    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'fixed';
    tempContainer.style.top = '0';
    tempContainer.style.left = '0';
    tempContainer.style.zIndex = '-9999';
    tempContainer.style.width = `${BASE_A4_WIDTH}px`;
    tempContainer.style.height = `${BASE_A4_HEIGHT}px`;
    tempContainer.style.backgroundColor = '#ffffff';

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
            paperWrapper.style.border = 'none';
            paperWrapper.style.margin = '0';
            tempContainer.appendChild(paperWrapper);

            renderLayout(paperWrapper, pageLayout);
            await swapImagesForHighRes(paperWrapper);
            await document.fonts.ready;

            // Remove UI elements
            paperWrapper.querySelectorAll('.remove-image-btn, .remove-text-btn, .text-prompt, .align-text-btn, .text-editor, .edge-handle').forEach(el => el.remove());

            const canvas = await html2canvas(tempContainer, {
                scale: qualityMultiplier,
                useCORS: true,
                width: BASE_A4_WIDTH,
                height: BASE_A4_HEIGHT
            });

            const imageData = canvas.toDataURL('image/jpeg', 0.9);
            const links = extractLinksForApi(paperWrapper);

            apiPages.push({
                imageData,
                width: BASE_A4_WIDTH,
                height: BASE_A4_HEIGHT,
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

async function swapImagesForHighRes(container) {
    const imageElements = container.querySelectorAll('img[data-asset-id]');
    const swapPromises = Array.from(imageElements).map((img) => {
        const assetId = img.getAttribute('data-asset-id');
        const asset = assetManager.getAsset(assetId);

        if (asset && asset.fullResData) {
            return new Promise((resolve) => {
                const tempImg = new Image();
                tempImg.onload = () => {
                    const parent = img.parentElement;
                    if (parent) {
                        // Apply background image to parent div
                        parent.style.backgroundImage = `url(${asset.fullResData})`;
                        // Use inline style object-fit if present, else cover
                        parent.style.backgroundSize = img.style.objectFit || 'cover';
                        parent.style.backgroundPosition = 'center';
                        parent.style.backgroundRepeat = 'no-repeat';
                        img.style.display = 'none'; // Hide original
                    }
                    resolve();
                };
                tempImg.onerror = resolve;
                tempImg.src = asset.fullResData;
            });
        }
        return Promise.resolve();
    });

    // Also await the cover image background if it exists
    const coverImage = container.querySelector('.paper-cover-image');
    if (coverImage) {
        const bgImage = getComputedStyle(coverImage).backgroundImage;
        if (bgImage && bgImage !== 'none') {
            const url = bgImage.match(/url\(['"]?(.*?)['"]?\)/)?.[1];
            if (url) {
                swapPromises.push(new Promise((resolve) => {
                    const tempImg = new Image();
                    tempImg.onload = resolve;
                    tempImg.onerror = resolve;
                    tempImg.src = url;
                }));
            }
        }
    }

    await Promise.all(swapPromises);
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
