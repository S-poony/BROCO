import { state } from './state.js';

/** Prefix for localStorage keys to avoid conflicts */
const STORAGE_PREFIX = 'layout_splitter:';

export function createRectangle(handleSplitClick) {
    state.currentId++;
    const newRect = document.createElement('div');
    newRect.id = `rect-${state.currentId}`;

    newRect.className = 'splittable-rect rectangle-base flex items-center justify-center';
    newRect.setAttribute('data-split-state', 'unsplit');
    newRect.innerHTML = state.currentId;

    newRect.addEventListener('click', handleSplitClick);

    return newRect;
}

export function createDivider(parentRect, orientation, rectA, rectB, startDrag) {
    const divider = document.createElement('div');
    divider.className = 'divider no-select flex-shrink-0';

    divider.setAttribute('data-orientation', orientation);
    divider.setAttribute('data-rect-a-id', rectA.id);
    divider.setAttribute('data-rect-b-id', rectB.id);
    divider.setAttribute('data-parent-id', parentRect.id);

    divider.addEventListener('mousedown', startDrag);
    divider.addEventListener('touchstart', startDrag, { passive: false });

    return divider;
}

/**
 * Custom replacement for native confirm()
 * @param {string} message 
 * @param {string} title 
 * @param {string} okText
 * @param {string} preferenceKey - Optional key to store the "Don't ask again" preference
 * @returns {Promise<boolean>}
 */
export function showConfirm(message, title = 'Are you sure?', okText = 'Confirm', preferenceKey = null) {
    if (preferenceKey && localStorage.getItem(`${STORAGE_PREFIX}confirm_dont_ask:${preferenceKey}`) === 'true') {
        return Promise.resolve(true);
    }

    const modal = document.getElementById('confirmation-modal');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    const checkboxContainer = document.getElementById('confirm-checkbox-container');
    const checkbox = document.getElementById('confirm-dont-ask-again');

    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
        // Fallback if DOM not fully ready
        return Promise.resolve(window.confirm(message));
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = okText;
    cancelBtn.style.display = 'block'; // Ensure cancel is visible

    if (preferenceKey && checkboxContainer) {
        checkboxContainer.style.display = 'block';
        if (checkbox) checkbox.checked = false;
    } else if (checkboxContainer) {
        checkboxContainer.style.display = 'none';
    }

    modal.classList.add('active');

    return new Promise((resolve) => {
        const cleanup = (result) => {
            if (result && preferenceKey && checkbox && checkbox.checked) {
                localStorage.setItem(`${STORAGE_PREFIX}confirm_dont_ask:${preferenceKey}`, 'true');
            }

            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onOverlay);
            resolve(result);
        };

        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onOverlay = (e) => {
            if (e.target === modal) cleanup(false);
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onOverlay);
    });
}

/**
 * Custom replacement for native alert()
 * @param {string} message 
 * @param {string} title 
 * @returns {Promise<void>}
 */
export function showAlert(message, title = 'Notification') {
    const modal = document.getElementById('confirmation-modal');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
        window.alert(message);
        return Promise.resolve();
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = 'OK';
    cancelBtn.style.display = 'none'; // Hide cancel for alerts
    modal.classList.add('active');

    return new Promise((resolve) => {
        const cleanup = () => {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            modal.removeEventListener('click', onOverlay);
            resolve();
        };

        const onOk = () => cleanup();
        const onOverlay = (e) => {
            if (e.target === modal) cleanup();
        };

        okBtn.addEventListener('click', onOk);
        modal.addEventListener('click', onOverlay);
    });
}

/**
 * Shows the specialized success modal for flipbook publishing
 * @param {string} url 
 * @returns {Promise<void>}
 */
export function showPublishSuccess(url) {
    const modal = document.getElementById('publish-success-modal');
    const urlInput = document.getElementById('success-url-input');
    const copyBtn = document.getElementById('copy-url-btn');
    const openBtn = document.getElementById('success-open-btn');
    const closeBtn = document.getElementById('success-close-btn');

    if (!modal || !urlInput || !copyBtn || !openBtn || !closeBtn) {
        window.alert(`Flipbook published successfully!\n\nURL: ${url}`);
        return Promise.resolve();
    }

    urlInput.value = url;
    modal.classList.add('active');

    return new Promise((resolve) => {
        const cleanup = () => {
            modal.classList.remove('active');
            copyBtn.removeEventListener('click', onCopy);
            openBtn.removeEventListener('click', onOpen);
            closeBtn.removeEventListener('click', onClose);
            modal.removeEventListener('click', onOverlay);
            resolve();
        };

        const onCopy = () => {
            urlInput.select();
            document.execCommand('copy');
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = 'Copied!';
            copyBtn.classList.remove('btn-primary');
            copyBtn.style.backgroundColor = '#10B981'; // Green success
            copyBtn.style.color = 'white';

            setTimeout(() => {
                copyBtn.innerHTML = originalText;
                copyBtn.classList.add('btn-primary');
                copyBtn.style.backgroundColor = '';
                copyBtn.style.color = '';
            }, 2000);
        };

        const onOpen = () => {
            window.open(url, '_blank');
        };

        const onClose = () => cleanup();

        const onOverlay = (e) => {
            if (e.target === modal) cleanup();
        };

        copyBtn.addEventListener('click', onCopy);
        openBtn.addEventListener('click', onOpen);
        closeBtn.addEventListener('click', onClose);
        modal.addEventListener('click', onOverlay);
    });
}
