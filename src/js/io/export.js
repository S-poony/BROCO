import { assetManager } from '../assets/AssetManager.js';
import { renderLayout } from '../layout/renderer.js';
import { loadSettings, applySettings } from '../ui/settings.js';

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
    // Ensure it fills the window for capture or flows for PDF
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

                // 1. Apply Settings (Restores CSS variables for borders, colors, fonts)
                if (settings) {
                    loadSettings(settings);
                    // Force apply just in case
                    applySettings();
                }

                // 2. Hydrate Assets (Restores images)
                if (assets && Array.isArray(assets)) {
                    // Clear existing (though should be empty)
                    assetManager.dispose();
                    assets.forEach(asset => {
                        // Direct hydration since we trust the source
                        assetManager.addAsset(asset);
                    });
                }

                const layouts = pageLayouts || [pageLayout];

                // Render each page
                for (let i = 0; i < layouts.length; i++) {
                    const layout = layouts[i];

                    // Create a wrapper for the page
                    // This wrapper MUST act as the 'a4-paper' for layout.css styles to apply
                    const pageWrapper = document.createElement('div');
                    pageWrapper.className = 'a4-paper is-exporting';
                    pageWrapper.id = `export-page-${i}`;

                    // Set explicit dimensions for CSS variables to pick up
                    pageWrapper.style.width = width + 'px';
                    pageWrapper.style.height = height + 'px';
                    pageWrapper.style.setProperty('--paper-current-width', `${width}px`);
                    pageWrapper.style.setProperty('--paper-current-height', `${height}px`);

                    // Ensure basic positioning
                    pageWrapper.style.position = 'relative';
                    pageWrapper.style.margin = '0'; // No auto margin during export
                    pageWrapper.style.boxShadow = 'none'; // Optional: remove shadow for clean export

                    if (i < layouts.length - 1) {
                        pageWrapper.style.breakAfter = 'page'; // Standard
                        pageWrapper.style.pageBreakAfter = 'always'; // Legacy
                    }

                    paper.appendChild(pageWrapper);

                    // Render the layout into the wrapper
                    await renderLayout(pageWrapper, layout, {
                        useHighResImages: true,
                        hideControls: true,
                        pageNumber: i + 1
                    });
                }
                // Wait for all images
                await waitForImages(paper);
                await document.fonts.ready;

                // Extract links for Flipbook if needed
                const allLinks = [];
                // We need to query wrappers we created
                const wrappers = paper.querySelectorAll('.a4-paper'); // Changed selector to matches class
                wrappers.forEach((wrapper, index) => {
                    const links = extractLinksForExport(wrapper);
                    allLinks.push(links);
                });

                // Signal completion with requestId
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
