import { state } from './state.js';

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
 * @returns {Promise<boolean>}
 */
export function showConfirm(message, title = 'Are you sure?', okText = 'Confirm') {
    const modal = document.getElementById('confirmation-modal');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
        // Fallback if DOM not fully ready
        return Promise.resolve(window.confirm(message));
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = okText;
    cancelBtn.style.display = 'block'; // Ensure cancel is visible
    modal.classList.add('active');

    return new Promise((resolve) => {
        const cleanup = (result) => {
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
