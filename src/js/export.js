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
    // 1. Create a Clean Export Container

    const EXPORT_WIDTH = 794; // Standard screen A4 width
    const EXPORT_HEIGHT = 1123; // Standard screen A4 height

    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'fixed';
    tempContainer.style.top = '0';
    tempContainer.style.left = '0';
    tempContainer.style.zIndex = '-9999'; // Behind everything but rendered
    tempContainer.style.width = `${EXPORT_WIDTH}px`;
    tempContainer.style.height = `${EXPORT_HEIGHT}px`;
    tempContainer.style.backgroundColor = '#ffffff';
    tempContainer.style.boxSizing = 'border-box';
    // CRITICAL: Remove any external styles that might affect it
    tempContainer.style.margin = '0';
    tempContainer.style.padding = '0';
    tempContainer.style.border = 'none';
    tempContainer.style.boxShadow = 'none';

    tempContainer.className = 'export-container';
    document.body.appendChild(tempContainer);

    const zip = (format === 'png' || format === 'jpeg') ? new JSZip() : null;
    let pdf = null;

    for (let i = 0; i < state.pages.length; i++) {
        const pageLayout = state.pages[i];

        // 2. Render Page
        tempContainer.innerHTML = '';
        // We create a wrapper that mimics the A4 paper styling but WITHOUT the unwanted external layout props (shadows)
        const paperWrapper = document.createElement('div');
        paperWrapper.className = 'a4-paper'; // Keeps internal styling
        paperWrapper.style.width = '100%';
        paperWrapper.style.height = '100%';
        paperWrapper.style.boxShadow = 'none'; // Force remove shadow
        paperWrapper.style.border = 'none'; // Force remove border
        paperWrapper.style.margin = '0';
        paperWrapper.style.zoom = '1'; // Force zoom reset
        tempContainer.appendChild(paperWrapper);


        // Create a root div inside paperWrapper that matches the root style
        paperWrapper.innerHTML = '';
        const exportRoot = document.createElement('div');
        exportRoot.id = pageLayout.id;
        exportRoot.className = 'splittable-rect rectangle-base flex items-center justify-center w-full h-full';
        exportRoot.style.width = '100%';
        exportRoot.style.height = '100%';
        paperWrapper.appendChild(exportRoot);

        // Render the actual layout into the export root
        renderLayout(exportRoot, pageLayout);

        // 3. Image Swap
        await swapImagesForHighRes(paperWrapper);

        // 4. Clean up UI elements (Remove buttons)
        const removeBtns = paperWrapper.querySelectorAll('.remove-image-btn');
        removeBtns.forEach(btn => btn.remove());

        // 5. Capture
        // Scale 3 gives ~300 DPI effectively (794 * 3 / 8.27in ~ 288 DPI)
        const canvas = await html2canvas(tempContainer, {
            scale: 3,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            width: EXPORT_WIDTH,
            height: EXPORT_HEIGHT,
            windowWidth: EXPORT_WIDTH,
            windowHeight: EXPORT_HEIGHT
        });

        const fileName = `page-${i + 1}`;

        if (format === 'pdf') {
            const imgData = canvas.toDataURL('image/jpeg', 0.95);

            // PDF A4 Dimensions (Points)
            const PDF_W = 595.28;
            const PDF_H = 841.89;

            if (!pdf) {
                pdf = new jsPDF({
                    orientation: 'portrait', // A4 is portrait
                    unit: 'pt',
                    format: 'a4'
                });
            } else {
                pdf.addPage();
            }

            pdf.addImage(imgData, 'JPEG', 0, 0, PDF_W, PDF_H);

        } else if (zip) {
            const ext = format === 'jpeg' ? 'jpg' : 'png';
            const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
            const dataUrl = canvas.toDataURL(mime, format === 'jpeg' ? 0.95 : 1.0);
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
