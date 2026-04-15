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

    const exitBtn = document.createElement('button');
    exitBtn.className = 'presentation-exit-btn';
    exitBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 15L15 12M15 12L12 9M15 12H4M4 7.24802V7.2002C4 6.08009 4 5.51962 4.21799 5.0918C4.40973 4.71547 4.71547 4.40973 5.0918 4.21799C5.51962 4 6.08009 4 7.2002 4H16.8002C17.9203 4 18.4796 4 18.9074 4.21799C19.2837 4.40973 19.5905 4.71547 19.7822 5.0918C20 5.5192 20 6.07899 20 7.19691V16.8036C20 17.9215 20 18.4805 19.7822 18.9079C19.5905 19.2842 19.2837 19.5905 18.9074 19.7822C18.48 20 17.921 20 16.8031 20H7.19691C6.07899 20 5.5192 20 5.0918 19.7822C4.71547 19.5905 4.40973 19.2839 4.21799 18.9076C4 18.4798 4 17.9201 4 16.8V16.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    exitBtn.title = 'Exit Presentation Mode';
    exitBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        if (document.fullscreenElement && document.exitFullscreen) {
            await document.exitFullscreen();
        } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
            await document.webkitExitFullscreen();
        } else if (document.msFullscreenElement && document.msExitFullscreen) {
            await document.msExitFullscreen();
        } else {
            // Because the function is accessed asynchronously in the click, it's safe to call here
            exitPresentationState();
        }
    });
    overlay.appendChild(exitBtn);

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
                
                // Hydrate assets
                renderAndRestoreFocus(getCurrentPage(), null, { useHighResImages: true });
                
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
                
                // Hydrate assets
                renderAndRestoreFocus(getCurrentPage(), null, { useHighResImages: true });
                
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
        
        // De-hydrate assets safely back to memory-efficient thumbnails
        renderAndRestoreFocus(getCurrentPage(), null, { useHighResImages: false });
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
        // Hydrate the newly requested page natively
        renderAndRestoreFocus(getCurrentPage(), null, { useHighResImages: true });
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

    // Screen Tapping: Left half goes back, Right half advances
    overlay.addEventListener('click', (e) => {
        if (e.button === 0) {
            if (e.clientX < window.innerWidth / 2) {
                goToPrevPage();
            } else {
                goToNextPage();
            }
        }
    });

    // Keyboard Control & Bulletproof Blocking
    window.addEventListener('keydown', (e) => {
        if (!document.body.classList.contains('presentation-mode')) return;

        // Allow F5 to toggle presentation mode off without reloading the page
        if (e.key === 'F5') {
            e.preventDefault();
            e.stopPropagation();
            const fullscreenBtn = document.getElementById('fullscreen-btn');
            if (fullscreenBtn) fullscreenBtn.click();
            return;
        }

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
