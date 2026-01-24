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
        /** @type {boolean} Whether we are currently in a drag operation (past threshold) */
        this.dragging = false;
        /** @type {DragData|null} Data stored on pointerdown */
        this.pendingData = null;
        /** @type {number|null} Initial x on pointerdown */
        this.startX = null;
        /** @type {number|null} Initial y on pointerdown */
        this.startY = null;
        /** @type {number} The threshold in pixels to consider movement a drag */
        this.dragThreshold = 5;

        // Global pointer handlers
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);

        // Cleanup on page visibility change to prevent ghost leaks
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isDragging()) {
                this.endDrag();
            }
        });
    }

    /**
     * @param {DragData} data 
     * @param {PointerEvent} event
     */
    startDrag(data, event) {
        this.pendingData = data;
        this.draggedAsset = data.asset || null;
        this.draggedText = data.text !== undefined ? data.text : undefined;
        this.draggedPageIndex = data.pageIndex !== undefined ? data.pageIndex : undefined;
        this.sourceRect = data.sourceRect || null;
        this.sourceTextNode = data.sourceTextNode || null;
        this.draggedTextAlign = data.textAlign || undefined;

        this.startX = event.clientX;
        this.startY = event.clientY;
        this.dragging = false; // Not dragging until threshold exceeded

        // Add document-level listeners for pointer movement
        document.addEventListener('pointermove', this.onPointerMove);
        document.addEventListener('pointerup', this.onPointerUp);
        document.addEventListener('pointercancel', this.onPointerUp);
    }

    /**
     * Legacy touch support - now redirected to unified Pointer Events logic via caller
     * @param {TouchEvent} e 
     * @param {DragData} data 
     */
    startTouchDrag(e, data) {
        if (e.touches && e.touches.length > 0) {
            // We'll let the newer Pointer Event handlers take precedence if available,
            // but for older mobile browsers we'd need this. 
            // However, modern apps should use pointerdown.
            // I will update the callers to use pointerdown instead.
        }
    }

    /**
     * @param {PointerEvent} e
     */
    onPointerMove(e) {
        if (!this.pendingData) return;

        if (!this.dragging) {
            const dx = e.clientX - this.startX;
            const dy = e.clientY - this.startY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Calculate threshold based on paper scale
            const paper = document.getElementById('a4-paper');
            let threshold = 5; // Default fallback
            if (paper) {
                const scale = parseFloat(getComputedStyle(paper).getPropertyValue('--paper-scale-ref')) || 1000;
                threshold = Math.max(3, scale * 0.008); // Approx 8px at 1000px scale
            }

            if (distance > threshold) {
                this.dragging = true;
                if (this.sourceRect) {
                    this.sourceRect.classList.add(this.draggedAsset ? 'moving-image' : 'moving-text');
                }
                this.createGhost(e, this.pendingData);
            }
        }

        if (this.dragging) {
            // Once dragging, we prevent default to stop scrolling/native behavior
            if (e.cancelable) e.preventDefault();
            this.updateGhostPosition(e.clientX, e.clientY);

            const target = document.elementFromPoint(e.clientX, e.clientY);
            document.dispatchEvent(new CustomEvent('custom-drag-move', {
                detail: { target, x: e.clientX, y: e.clientY }
            }));
            return { target };
        }
    }

    /**
     * @param {PointerEvent} e
     */
    onPointerUp(e) {
        if (!this.pendingData) return;

        if (this.dragging) {
            // Only finalize if we actually started a drag
            const target = document.elementFromPoint(e.clientX, e.clientY);
            const dropEvent = new CustomEvent('custom-drop', {
                detail: { target, clientX: e.clientX, clientY: e.clientY }
            });
            document.dispatchEvent(dropEvent);
        }

        this.endDrag();
    }

    /**
     * @param {MouseEvent|Touch} e 
     * @param {DragData} data 
     */
    createGhost(e, data) {
        if (this.touchGhost) this.touchGhost.remove();

        const ghost = document.createElement('div');
        ghost.id = 'drag-ghost';
        ghost.style.position = 'fixed';
        ghost.style.width = `${GHOST_SIZE}px`;
        ghost.style.height = `${GHOST_SIZE}px`;
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '100000'; // Even higher
        ghost.style.opacity = '0.8';
        ghost.style.borderRadius = '8px';
        ghost.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';
        ghost.style.border = '2px solid var(--color-primary, #4f46e5)';
        ghost.style.display = 'flex';
        ghost.style.alignItems = 'center';
        ghost.style.justifyContent = 'center';
        ghost.style.backgroundColor = 'white';
        ghost.style.transition = 'transform 0.05s linear'; // Smoother movement

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

        this.updateGhostPosition(e.clientX, e.clientY, ghost);

        document.body.appendChild(ghost);
        this.touchGhost = ghost;
    }

    updateGhostPosition(x, y, ghost = this.touchGhost) {
        if (!ghost) return;
        ghost.style.left = `${x - GHOST_SIZE / 2}px`;
        ghost.style.top = `${y - GHOST_SIZE / 2}px`;
    }

    /**
     * @param {PointerEvent} e 
     */
    handleTouchMove(e) {
        // Redirection for callers still using this
        return this.onPointerMove(e);
    }

    endDrag() {
        this.dragging = false;
        this.pendingData = null;

        document.removeEventListener('pointermove', this.onPointerMove);
        document.removeEventListener('pointerup', this.onPointerUp);
        document.removeEventListener('pointercancel', this.onPointerUp);

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
        return this.dragging;
    }
}

export const dragDropService = new DragDropService();
