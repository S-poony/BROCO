/**
 * Error Handler Module
 * Provides centralized error handling with user-facing toast notifications.
 */

/** @typedef {'success' | 'warning' | 'error' | 'info'} ToastType */

/** @type {HTMLElement|null} */
let toastContainer = null;

/** Default toast duration in ms */
const DEFAULT_DURATION = 4000;

/**
 * Initialize toast container if not exists
 */
function ensureContainer() {
    if (toastContainer && document.body.contains(toastContainer)) return;

    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toastContainer);
}

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {ToastType} type - Type of toast (affects styling)
 * @param {number} duration - Duration in ms (0 for persistent)
 * @returns {HTMLElement} The toast element
 */
export function showToast(message, type = 'info', duration = DEFAULT_DURATION) {
    ensureContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = getIconForType(type);

    const text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.onclick = () => removeToast(toast);

    if (type === 'error') {
        toast.style.cursor = 'pointer';
        toast.title = 'Click to open developer tools for debugging';
        toast.onclick = (e) => {
            // Only trigger if we didn't click the close button
            if (!e.target.closest('.toast-close')) {
                if (window.electronAPI && window.electronAPI.openDevTools) {
                    window.electronAPI.openDevTools();
                }
                removeToast(toast);
            }
        };
    }

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(closeBtn);

    toastContainer.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    if (duration > 0) {
        setTimeout(() => removeToast(toast), duration);
    }

    return toast;
}

/**
 * Remove a toast with animation
 * @param {HTMLElement} toast 
 */
function removeToast(toast) {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // Fallback if transition doesn't fire
    setTimeout(() => toast.remove(), 300);
}

/**
 * Get icon SVG for toast type
 * @param {ToastType} type 
 * @returns {string}
 */
function getIconForType(type) {
    const icons = {
        success: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
        error: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
        warning: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
        info: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'
    };
    return icons[type] || icons.info;
}

/**
 * Convenience methods
 */
export const toast = {
    success: (msg, duration) => showToast(msg, 'success', duration),
    error: (msg, duration) => showToast(msg, 'error', duration ?? 6000),
    warning: (msg, duration) => showToast(msg, 'warning', duration),
    info: (msg, duration) => showToast(msg, 'info', duration)
};

/**
 * Global error handler - catches unhandled errors and promise rejections
 * @param {boolean} enable - Whether to enable global error catching
 */
export function setupGlobalErrorHandler(enable = true) {
    if (!enable) return;

    window.addEventListener('error', (event) => {
        console.error('Unhandled error:', event.error);
        toast.error('An unexpected error occurred. Please try again.');
    });

    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
        // Only show user-facing toast for non-internal errors
        if (event.reason?.message && !event.reason.message.includes('internal')) {
            toast.error(event.reason.message);
        }
    });
}

/**
 * Wrap an async function with error handling
 * @template T
 * @param {() => Promise<T>} fn - Async function to wrap
 * @param {string} errorMessage - User-facing error message on failure
 * @returns {Promise<T|null>}
 */
export async function withErrorHandling(fn, errorMessage = 'Operation failed') {
    try {
        return await fn();
    } catch (error) {
        console.error(errorMessage, error);
        toast.error(errorMessage);
        return null;
    }
}

/**
 * Asserts that data matches a required shape, throwing an error if it doesn't.
 * @param {any} data - Data to check
 * @param {(d: any) => boolean} validator - Validation function
 * @param {string} errorMsg - Error message if validation fails
 */
export function assertShape(data, validator, errorMsg = 'Invalid data received') {
    if (data === null || data === undefined) return data; // Allow optionalish nulls, caller handles
    if (!validator(data)) {
        const err = new Error(errorMsg);
        err.name = 'ValidationError';
        throw err;
    }
    return data;
}

/**
 * Ensures data is an array, throwing a useful error if not.
 * @param {any} data 
 * @param {string} context - Context for the error message
 */
export function ensureArray(data, context = 'Data') {
    if (data === null || data === undefined) return [];
    if (!Array.isArray(data)) {
        console.error(`${context} is not an array:`, data);
        throw new Error(`${context} failed: expected a list of items but received something else.`);
    }
    return data;
}
