import { toast } from '../core/errorHandler.js';
import { state, switchPage, getCurrentPage } from '../core/state.js';
import { renderAndRestoreFocus } from '../layout/layout.js';
import { renderPageList } from '../layout/pages.js';

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

    // --- Presentation Navigation ---

    function updateView() {
        renderAndRestoreFocus(getCurrentPage());
        renderPageList();
        
        // Prevent layout element auto-focus from triggering edit-state UI
        if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
        }
    }

    function goToNextPage() {
        if (state.currentPageIndex < state.pages.length - 1) {
            switchPage(state.currentPageIndex + 1);
            updateView();
        }
    }

    function goToPrevPage() {
        if (state.currentPageIndex > 0) {
            switchPage(state.currentPageIndex - 1);
            updateView();
        }
    }

    // Mouse Sliding: clicking the glass overlay advances the page
    overlay.addEventListener('click', (e) => {
        if (e.button === 0) {
            goToNextPage();
        }
    });

    // Keyboard Control & Bulletproof Blocking
    window.addEventListener('keydown', (e) => {
        if (!document.body.classList.contains('presentation-mode')) return;

        // Allow Escape for exiting native fullscreen API or manually exit for fallback
        if (e.key === 'Escape') {
            if (!document.fullscreenElement) {
                exitPresentationState();
            }
            return;
        }

        // BLOCK ALL OTHER KEYPRESSES from trickling down into the editor engine
        e.preventDefault();
        e.stopPropagation();

        if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
            goToNextPage();
        } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
            goToPrevPage();
        }
    }, { capture: true });
}
