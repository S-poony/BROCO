import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { importedAssets } from './assets.js';
import { A4_PAPER_ID } from './constants.js';
import { state } from './state.js';
import { renderLayout } from './renderer.js';

export function setupExportHandlers() {
    const exportBtn = document.getElementById('export-layout-btn');
    const modal = document.getElementById('export-modal');
    const cancelBtn = document.getElementById('cancel-export');
    const confirmBtn = document.getElementById('confirm-export');

    if (!exportBtn || !modal) return;

    exportBtn.addEventListener('click', () => {
        modal.classList.add('active');
    });

    cancelBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    // Close on click outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    confirmBtn.addEventListener('click', async () => {
        const format = document.querySelector('input[name="export-format"]:checked').value;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Generating...';

        try {
            await performExport(format);
        } catch (error) {
            console.error('Export failed:', error);
            alert('Export failed. Please try again.');
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Download';
            modal.classList.remove('active');
        }
    });
}

async function performExport(format) {
    // We need to render each page to a temporary container, capture it, then move to the next
    // To avoid flashing content on screen, we'll use a hidden container
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'fixed';
    tempContainer.style.top = '-9999px';
    tempContainer.style.left = '0';
    // Match A4 paper dimensions and class
    tempContainer.className = 'a4-paper';
    tempContainer.style.width = '210mm';
    tempContainer.style.height = 'calc(210mm * 1.414)';
    tempContainer.style.zoom = '200%'; // High res capture
    document.body.appendChild(tempContainer);

    const zip = (format === 'png' || format === 'jpeg') ? new JSZip() : null;
    let pdf = null;

    for (let i = 0; i < state.pages.length; i++) {
        const pageLayout = state.pages[i];

        // Render this page to the temp container
        // We need to clear it first similar to renderer logic but applied to this temp node
        tempContainer.innerHTML = '';
        renderLayout(tempContainer, pageLayout);

        // Swap images for high-res
        await swapImagesForHighRes(tempContainer);

        // Capture
        const canvas = await html2canvas(tempContainer, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff'
        });

        const fileName = `page-${i + 1}`;

        if (format === 'pdf') {
            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const imgWidth = canvas.width;
            const imgHeight = canvas.height;

            // If first page, create PDF, else add page
            // Orientation based on dimensions (A4 can be landscape if design dictates, but usually portrait container)
            // But canvas dimensions depend on zoom and scale.
            // Let's standardise to A4 points.
            const pdfWidth = 595.28; // A4 pt width
            const pdfHeight = 841.89; // A4 pt height

            if (!pdf) {
                pdf = new jsPDF({
                    orientation: 'portrait',
                    unit: 'pt',
                    format: 'a4'
                });
            } else {
                pdf.addPage();
            }

            pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

        } else if (zip) {
            const ext = format === 'jpeg' ? 'jpg' : 'png';
            const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
            const dataUrl = canvas.toDataURL(mime, format === 'jpeg' ? 0.9 : 1.0);
            const base64Data = dataUrl.split(',')[1];

            zip.file(`${fileName}.${ext}`, base64Data, { base64: true });
        }
    }

    document.body.removeChild(tempContainer);

    const timestamp = new Date().getTime();
    if (format === 'pdf' && pdf) {
        pdf.save(`layout-export-${timestamp}.pdf`);
    } else if (zip) {
        const content = await zip.generateAsync({ type: 'blob' });
        downloadBlob(content, `layout-export-${timestamp}.zip`);
    }
}

async function swapImagesForHighRes(container) {
    const imageElements = container.querySelectorAll('img[data-asset-id]');
    const swapPromises = Array.from(imageElements).map((img) => {
        const assetId = img.getAttribute('data-asset-id');
        const asset = importedAssets.find(a => a.id === assetId);

        if (asset && asset.fullResData) {
            return new Promise((resolve) => {
                const tempImg = new Image();
                tempImg.onload = () => {
                    // html2canvas object-fit workaround: background image
                    const parent = img.parentElement;
                    if (parent) {
                        parent.style.backgroundImage = `url(${asset.fullResData})`;
                        parent.style.backgroundSize = img.style.objectFit || 'cover';
                        parent.style.backgroundPosition = 'center';
                        parent.style.backgroundRepeat = 'no-repeat';
                        img.style.display = 'none';
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

function downloadImage(dataUrl, filename) {
    // Deprecated for zip/pdf flow but kept if needed
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
