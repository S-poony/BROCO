/**
 * Platform-specific compatibility layer
 * Handles behavior differences between Web and Electron Desktop versions
 */

export function setupPlatformAdapters() {
    const isElectron = window.electronAPI && window.electronAPI.isElectron;
    const body = document.body;

    if (isElectron) {
        body.classList.add('platform-desktop');
        handleDesktopSetup();
    } else {
        body.classList.add('platform-web');
        handleWebSetup();
    }
}

function handleWebSetup() {
    // Inject Download Button for Web Users
    injectDownloadButton();
}

function handleDesktopSetup() {
    // Desktop specific setup (e.g. no-op for now)
    console.log('Running in Desktop mode');
}

function injectDownloadButton() {
    // Find the file actions area (top row)
    const fileActionsLeft = document.querySelector('.file-actions-left');

    if (fileActionsLeft) {
        // Create separator
        const buffer = document.createElement('div');
        buffer.style.width = '1px';
        buffer.style.height = '24px';
        buffer.style.backgroundColor = 'var(--divider-color)';
        buffer.style.margin = '0 8px';
        buffer.style.display = 'inline-block';
        buffer.style.verticalAlign = 'middle';
        buffer.style.opacity = '0.5';

        // Create Download Button
        const downloadBtn = document.createElement('a'); // Use anchor for link
        downloadBtn.href = 'https://github.com/S-poony/BROCO/releases/latest';
        downloadBtn.target = '_blank';
        downloadBtn.className = 'btn-file'; // Reuse existing class for consistent look
        downloadBtn.title = 'Download Desktop App';
        downloadBtn.ariaLabel = 'Download Desktop App';
        downloadBtn.style.textDecoration = 'none';

        // Icon (Download)
        downloadBtn.innerHTML = `
            <span class="icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            </span>
            <span>App</span>
        `;

        // Add hover effect style inline or rely on btn-file? 
        // btn-file usually expects a button, but <a> should work if css targets class
        // Let's ensure it looks right.

        fileActionsLeft.appendChild(buffer);
        fileActionsLeft.appendChild(downloadBtn);
    }
}
