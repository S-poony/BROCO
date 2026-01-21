import { GHOST_SIZE } from './constants.js';

/**
 * @typedef {Object} DragData
 * @property {import('./AssetManager.js').Asset} [asset]
 * @property {string} [text]
 * @property {number} [pageIndex]
 * @property {HTMLElement} [sourceRect]
 * @property {Object} [sourceTextNode]
 */

export class DragDropService {
    constructor() {
        /** @type {import('./AssetManager.js').Asset|null} */
        this.draggedAsset = null;
        /** @type {string|undefined} */
        this.draggedText = undefined;
        /** @type {number|undefined} */
        this.draggedPageIndex = undefined;
        /** @type {HTMLElement|null} */
        this.sourceRect = null;
        /** @type {Object|null} */
        this.sourceTextNode = null;
        /** @type {string|undefined} */
        this.draggedTextAlign = undefined;
        /** @type {HTMLElement|null} */
        this.touchGhost = null;
        /** @type {number|null} Timer for touch hold delay */
        this.touchHoldTimer = null;
        /** @type {DragData|null} Pending drag data waiting for hold completion */
        this.pendingTouchData = null;
        /** @type {Touch|null} Pending touch waiting for hold completion */
        this.pendingTouch = null;

        // Cleanup on page visibility change to prevent ghost leaks
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isDragging()) {
                this.endDrag();
            }
        });
    }

    /**
     * @param {DragData} data 
     */
    startDrag(data) {
        this.draggedAsset = data.asset || null;
        this.draggedText = data.text !== undefined ? data.text : undefined;
        this.draggedPageIndex = data.pageIndex !== undefined ? data.pageIndex : undefined;
        this.sourceRect = data.sourceRect || null;
        this.sourceTextNode = data.sourceTextNode || null;
        this.draggedTextAlign = data.textAlign || undefined;

        if (this.sourceRect) {
            this.sourceRect.classList.add(this.draggedAsset ? 'moving-image' : 'moving-text');
        }
    }

    /**
     * @param {TouchEvent} e 
     * @param {DragData} data 
     */
    startTouchDrag(e, data) {
        // Cancel any pending drag
        if (this.touchHoldTimer) {
            clearTimeout(this.touchHoldTimer);
            this.touchHoldTimer = null;
        }

        // Store the pending drag data
        this.pendingTouchData = data;
        this.pendingTouch = e.touches && e.touches.length > 0 ? e.touches[0] : null;

        // Require holding for 200ms before starting drag
        this.touchHoldTimer = setTimeout(() => {
            if (this.pendingTouchData && this.pendingTouch) {
                this.startDrag(this.pendingTouchData);
                this.createGhost(this.pendingTouch, this.pendingTouchData);
            }
            this.touchHoldTimer = null;
            this.pendingTouchData = null;
            this.pendingTouch = null;
        }, 200);
    }

    /**
     * Cancel pending touch drag if touch ends before hold completes
     */
    cancelPendingTouch() {
        if (this.touchHoldTimer) {
            clearTimeout(this.touchHoldTimer);
            this.touchHoldTimer = null;
            this.pendingTouchData = null;
            this.pendingTouch = null;
        }
    }

    /**
     * @param {Touch} touch 
     * @param {DragData} data 
     */
    createGhost(touch, data) {
        if (this.touchGhost) this.touchGhost.remove();

        const ghost = document.createElement('div');
        ghost.id = 'drag-ghost';
        ghost.style.position = 'fixed';
        ghost.style.width = `${GHOST_SIZE}px`;
        ghost.style.height = `${GHOST_SIZE}px`;
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '10000';
        ghost.style.opacity = '0.8';
        ghost.style.borderRadius = '8px';
        ghost.style.boxShadow = '0 8px 16px rgba(0,0,0,0.3)';
        ghost.style.border = '2px solid #4f46e5';
        ghost.style.display = 'flex';
        ghost.style.alignItems = 'center';
        ghost.style.justifyContent = 'center';
        ghost.style.backgroundColor = 'white';

        if (data.asset) {
            const img = document.createElement('img');
            img.src = data.asset.lowResData;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '6px';
            ghost.appendChild(img);
        } else if (data.text !== undefined) {
            ghost.innerHTML = '📝';
            ghost.style.fontSize = '24px';
        } else if (data.pageIndex !== undefined) {
            ghost.innerHTML = '📄';
            ghost.style.fontSize = '24px';
        }

        ghost.style.left = `${touch.clientX - GHOST_SIZE / 2}px`;
        ghost.style.top = `${touch.clientY - GHOST_SIZE / 2}px`;

        document.body.appendChild(ghost);
        this.touchGhost = ghost;
    }

    /**
     * @param {TouchEvent} e 
     */
    handleTouchMove(e) {
        // If we're still waiting for hold, cancel the pending drag  
        if (this.touchHoldTimer) {
            this.cancelPendingTouch();
            return;
        }

        if (!this.isDragging() || !this.touchGhost) return;
        if (e.cancelable) e.preventDefault();

        const touch = e.touches && e.touches.length > 0 ? e.touches[0] : null;
        if (!touch) return;
        this.touchGhost.style.left = `${touch.clientX - GHOST_SIZE / 2}px`;
        this.touchGhost.style.top = `${touch.clientY - GHOST_SIZE / 2}px`;

        return {
            x: touch.clientX,
            y: touch.clientY,
            target: document.elementFromPoint(touch.clientX, touch.clientY)
        };
    }

    endDrag() {
        // Cancel any pending touch drag
        this.cancelPendingTouch();

        if (this.sourceRect) {
            this.sourceRect.classList.remove('moving-image', 'moving-text');
        }
        if (this.touchGhost) {
            this.touchGhost.remove();
            this.touchGhost = null;
        }

        const finalData = {
            asset: this.draggedAsset,
            text: this.draggedText,
            pageIndex: this.draggedPageIndex,
            sourceRect: this.sourceRect,
            sourceTextNode: this.sourceTextNode
        };

        this.draggedAsset = null;
        this.draggedText = undefined;
        this.draggedPageIndex = undefined;
        this.sourceRect = null;
        this.sourceTextNode = null;

        return finalData;
    }

    isDragging() {
        return this.draggedAsset !== null || this.draggedText !== undefined || this.draggedPageIndex !== undefined;
    }
}

export const dragDropService = new DragDropService();
