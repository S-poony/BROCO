import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { assetManager } from './AssetManager.js';
import { A4_PAPER_ID } from './constants.js';
import { state } from './state.js';
import { renderLayout } from './renderer.js';
import { showAlert } from './utils.js';

const BASE_A4_WIDTH = 794;
const BASE_A4_HEIGHT = 1123;

export function setupExportHandlers() {
    const exportBtn = document.getElementById('export-layout-btn');
    const modal = document.getElementById('export-modal');
    const cancelBtn = document.getElementById('cancel-export');
    const confirmBtn = document.getElementById('confirm-export');
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

    cancelBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    confirmBtn.addEventListener('click', async () => {
        const format = document.querySelector('input[name="export-format"]:checked').value;
        const qualityMultiplier = parseInt(qualitySlider.value) / 100;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Generating...';

        try {
            await performExport(format, qualityMultiplier);
        } catch (error) {
            console.error('Export failed:', error);
            showAlert('Export failed. Please try again.', 'Export Error');
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Download';
            modal.classList.remove('active');
        }
    });
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

            const exportRoot = document.createElement('div');
            exportRoot.id = pageLayout.id;
            exportRoot.className = 'splittable-rect rectangle-base flex items-center justify-center w-full h-full';
            exportRoot.style.width = '100%';
            exportRoot.style.height = '100%';
            paperWrapper.appendChild(exportRoot);

            renderLayout(exportRoot, pageLayout);

            await swapImagesForHighRes(paperWrapper);

            const removeBtns = paperWrapper.querySelectorAll('.remove-image-btn');
            removeBtns.forEach(btn => btn.remove());

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
