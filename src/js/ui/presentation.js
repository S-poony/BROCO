import { toast } from '../core/errorHandler.js';

export function setupPresentationHandlers() {
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (!fullscreenBtn) return;

    const workspaceWrapper = document.querySelector('.workspace-wrapper');

    // Create the overlay once
    const overlay = document.createElement('div');
    overlay.id = 'presentation-overlay';
    overlay.className = 'presentation-overlay';

    fullscreenBtn.addEventListener('click', async () => {
        try {
            if (!document.fullscreenElement) {
                // Pre-enter Cleanup: Blur any active text editors
                document.querySelectorAll('.text-editor:not(.hidden)').forEach(editor => {
                    editor.blur();
                });
                
                // Clear active layout focus
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.blur();
                }

                // Enter fullscreen natively
                if (document.documentElement.requestFullscreen) {
                    await document.documentElement.requestFullscreen();
                } else if (document.documentElement.webkitRequestFullscreen) { /* Safari */
                    await document.documentElement.webkitRequestFullscreen();
                } else if (document.documentElement.msRequestFullscreen) { /* IE11 */
                    await document.documentElement.msRequestFullscreen();
                }
                
                // Apply State and Overlay
                document.body.classList.add('presentation-mode');
                if (workspaceWrapper && !workspaceWrapper.contains(overlay)) {
                    workspaceWrapper.appendChild(overlay);
                }
                
                toast.info('Press ESC to leave presentation mode', 4000);
            } else {
                // Exit fullscreen natively
                if (document.exitFullscreen) {
                    await document.exitFullscreen();
                } else if (document.webkitExitFullscreen) { /* Safari */
                    await document.webkitExitFullscreen();
                } else if (document.msExitFullscreen) { /* IE11 */
                    await document.msExitFullscreen();
                }
            }
        } catch (err) {
            console.error('Error attempting to enable fullscreen:', err);
            // Fallback for isolated environments without fullscreen API
            if (!document.body.classList.contains('presentation-mode')) {
                document.querySelectorAll('.text-editor:not(.hidden)').forEach(e => e.blur());
                document.body.classList.add('presentation-mode');
                if (workspaceWrapper && !workspaceWrapper.contains(overlay)) {
                    workspaceWrapper.appendChild(overlay);
                }
                toast.info('Press ESC to leave presentation mode', 4000);
            } else {
                exitPresentationState();
            }
        }
    });

    const exitPresentationState = () => {
        document.body.classList.remove('presentation-mode');
        if (overlay.parentElement) {
            overlay.parentElement.removeChild(overlay);
        }
    };

    // Listen to native fullscreen changes (e.g. when user presses ESC natively)
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            exitPresentationState();
        } else {
            // Apply overlay robustly
            document.body.classList.add('presentation-mode');
            if (workspaceWrapper && !workspaceWrapper.contains(overlay)) {
                workspaceWrapper.appendChild(overlay);
            }
        }
    });

    document.addEventListener('webkitfullscreenchange', () => {
        if (!document.webkitFullscreenElement) {
            exitPresentationState();
        } else {
            document.body.classList.add('presentation-mode');
            if (workspaceWrapper && !workspaceWrapper.contains(overlay)) {
                workspaceWrapper.appendChild(overlay);
            }
        }
    });
}
