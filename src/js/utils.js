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
