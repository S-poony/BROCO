import { A4_PAPER_ID } from './constants.js';
import { state } from './state.js';
import { saveState } from './history.js';
import { createRectangle, createDivider } from './utils.js';

export function handleSplitClick(event) {
    const rectElement = event.currentTarget;

    if (event.ctrlKey) {
        event.stopPropagation();
        saveState();
        deleteRectangle(rectElement);
        return;
    }

    if (rectElement.getAttribute('data-split-state') === 'split') {
        return;
    }

    saveState();
    rectElement.setAttribute('data-split-state', 'split');

    const rect = rectElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    let orientation;
    if (width >= height) {
        orientation = 'vertical';
        rectElement.classList.add('flex', 'flex-row');
    } else {
        orientation = 'horizontal';
        rectElement.classList.add('flex', 'flex-col');
    }

    const rectA = createRectangle(handleSplitClick);
    const rectB = createRectangle(handleSplitClick);
    const divider = createDivider(rectElement, orientation, rectA, rectB, startDrag);

    if (orientation === 'vertical') {
        rectA.style.width = '50%';
        rectB.style.width = '50%';
        rectA.style.height = '100%';
        rectB.style.height = '100%';
        rectA.classList.add('h-full');
        rectB.classList.add('h-full');
        divider.classList.add('vertical-divider');
    } else {
        rectA.style.height = '50%';
        rectB.style.height = '50%';
        rectA.style.width = '100%';
        rectB.style.width = '100%';
        rectA.classList.add('w-full');
        rectB.classList.add('w-full');
        divider.classList.add('horizontal-divider');
    }

    rectElement.innerHTML = '';
    rectElement.appendChild(rectA);
    rectElement.appendChild(divider);
    rectElement.appendChild(rectB);
}

export function deleteRectangle(rectElement) {
    if (rectElement.id === A4_PAPER_ID || rectElement.id === 'rect-1') {
        return;
    }

    const parent = rectElement.parentElement;
    if (!parent) return;

    const children = Array.from(parent.children);
    const sibling = children.find(child => child.classList.contains('splittable-rect') && child !== rectElement);
    const divider = children.find(child => child.classList.contains('divider'));

    if (!sibling) return;

    const isSiblingSplit = sibling.getAttribute('data-split-state') === 'split';
    rectElement.remove();
    if (divider) divider.remove();
    parent.classList.remove('flex-row', 'flex-col');

    if (isSiblingSplit) {
        const siblingOrientation = sibling.classList.contains('flex-row') ? 'flex-row' : 'flex-col';
        parent.classList.add('flex', siblingOrientation);
        parent.setAttribute('data-split-state', 'split');

        while (sibling.firstChild) {
            const child = sibling.firstChild;
            if (child.nodeType === 1 && child.classList.contains('divider')) {
                child.setAttribute('data-parent-id', parent.id);
            }
            parent.appendChild(child);
        }
        sibling.remove();
    } else {
        parent.setAttribute('data-split-state', 'unsplit');
        parent.innerHTML = sibling.innerHTML;
        sibling.remove();
    }

    if (!parent.classList.contains('flex')) {
        parent.classList.add('flex', 'items-center', 'justify-center');
    }

    parent.addEventListener('click', handleSplitClick);
}

export function startDrag(event) {
    event.preventDefault();
    saveState();

    state.activeDivider = event.currentTarget;
    const rectA = document.getElementById(state.activeDivider.getAttribute('data-rect-a-id'));
    const rectB = document.getElementById(state.activeDivider.getAttribute('data-rect-b-id'));
    const parent = document.getElementById(state.activeDivider.getAttribute('data-parent-id'));

    const orientation = state.activeDivider.getAttribute('data-orientation');
    state.startX = event.clientX || event.touches[0].clientX;
    state.startY = event.clientY || event.touches[0].clientY;

    const parentRect = parent.getBoundingClientRect();
    const rectARect = rectA.getBoundingClientRect();
    const rectBRect = rectB.getBoundingClientRect();

    if (orientation === 'vertical') {
        state.startSizeA = rectARect.width;
        state.startSizeB = rectBRect.width;
        state.activeDivider.totalSize = parentRect.width;
    } else {
        state.startSizeA = rectARect.height;
        state.startSizeB = rectBRect.height;
        state.activeDivider.totalSize = parentRect.height;
    }

    state.activeDivider.rectA = rectA;
    state.activeDivider.rectB = rectB;

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
    document.body.classList.add('no-select');
}

function onDrag(event) {
    if (!state.activeDivider) return;
    event.preventDefault();

    const orientation = state.activeDivider.getAttribute('data-orientation');
    const rectA = state.activeDivider.rectA;
    const rectB = state.activeDivider.rectB;

    const clientX = event.clientX || event.touches[0].clientX;
    const clientY = event.clientY || event.touches[0].clientY;

    let delta;
    if (orientation === 'vertical') {
        delta = clientX - state.startX;
    } else {
        delta = clientY - state.startY;
    }

    let newSizeA = state.startSizeA + delta;
    let newSizeB = state.startSizeB - delta;
    const minSize = 0;

    if (newSizeA < minSize) {
        newSizeA = minSize;
        newSizeB = state.activeDivider.totalSize - newSizeA;
    } else if (newSizeB < minSize) {
        newSizeB = minSize;
        newSizeA = state.activeDivider.totalSize - newSizeB;
    }

    const percentA = (newSizeA / state.activeDivider.totalSize) * 100;
    const percentB = (newSizeB / state.activeDivider.totalSize) * 100;

    if (orientation === 'vertical') {
        rectA.style.width = `${percentA}%`;
        rectB.style.width = `${percentB}%`;
    } else {
        rectA.style.height = `${percentA}%`;
        rectB.style.height = `${percentB}%`;
    }
}

function stopDrag() {
    if (!state.activeDivider) return;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('touchend', stopDrag);
    document.body.classList.remove('no-select');
    state.activeDivider = null;
}

export function rebindEvents() {
    document.querySelectorAll('.splittable-rect').forEach(rect => {
        rect.removeEventListener('click', handleSplitClick);
        rect.addEventListener('click', handleSplitClick);
    });
    document.querySelectorAll('.divider').forEach(divider => {
        divider.removeEventListener('mousedown', startDrag);
        divider.addEventListener('mousedown', startDrag);
        divider.removeEventListener('touchstart', startDrag);
        divider.addEventListener('touchstart', startDrag, { passive: false });
    });
}
