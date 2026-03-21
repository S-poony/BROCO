import { toast } from '../core/errorHandler.js';

export function setupPresentationHandlers() {
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (!fullscreenBtn) return;

    // Toggle presentation mode when button is clicked
    fullscreenBtn.addEventListener('click', async () => {
        try {
            if (!document.fullscreenElement) {
                // Enter fullscreen natively
                if (document.documentElement.requestFullscreen) {
                    await document.documentElement.requestFullscreen();
                } else if (document.documentElement.webkitRequestFullscreen) { /* Safari */
                    await document.documentElement.webkitRequestFullscreen();
                } else if (document.documentElement.msRequestFullscreen) { /* IE11 */
                    await document.documentElement.msRequestFullscreen();
                }
                
                // Add the class for our internal layout overrides
                document.body.classList.add('presentation-mode');
                
                // Notify the user how to exit
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
                // The fullscreenchange event removes the class
            }
        } catch (err) {
            console.error('Error attempting to enable fullscreen:', err);
            // Fallback: Just toggle class if native fullscreen fails (e.g. in some iframe or unsupported)
            document.body.classList.toggle('presentation-mode');
            
            if (document.body.classList.contains('presentation-mode')) {
                toast.info('Press ESC to leave presentation mode', 4000);
            }
        }
    });

    // Listen to native fullscreen changes (e.g. when user presses ESC natively)
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            // Exited fullscreen natively
            document.body.classList.remove('presentation-mode');
        } else {
            // Entered fullscreen natively
            document.body.classList.add('presentation-mode');
        }
    });

    // Also handle webkit and ms prefixes for the event
    document.addEventListener('webkitfullscreenchange', () => {
        if (!document.webkitFullscreenElement) {
            document.body.classList.remove('presentation-mode');
        } else {
            document.body.classList.add('presentation-mode');
        }
    });
}
