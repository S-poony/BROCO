import { SNAP_POINTS, SNAP_THRESHOLD, MIN_AREA_PERCENT } from '../../core/constants.js';
import { state, getCurrentPage } from '../../core/state.js';
import { saveState } from '../../io/history.js';
import { findNodeById, findParentNode, countParallelLeaves } from './treeUtils.js';
import { toast } from '../../core/errorHandler.js';
import { getSettings } from '../../ui/settings.js';

/**
 * Snap point category labels
 */
export const SNAP_TYPES = {
    GRID: 'Grid Alignment',
    SIZE_MATCH: 'Size Match',
    SUBDIVISION: 'Proportional',
    GLOBAL: 'Global Alignment',
    BOUNDARY: 'Edge Limit'
};

/**
 * Ensures strict uniform precision for all calculations.
 */
function roundDecimals(val) {
    return Math.round(val * 100) / 100;
}

/**
 * Collects physical dimensions (width and height) of all leaf nodes within the main paper.
 * @param {string} excludeRootId - Optional ID of a branch to ignore (e.g. the one being resized)
 * @param {string} orientation - 'horizontal' or 'vertical' divider orientation
 * @returns {number[]}
 */
function collectAllLeafDimensions(excludeRootId = null, dividerOrientation = 'vertical') {
    const dims = new Set();
    const paper = document.getElementById('a4-paper');
    if (!paper) return [];

    const rects = paper.querySelectorAll('.splittable-rect');
    rects.forEach(el => {
        // 1. Only consider leaf nodes (no nested rectangles)
        if (!el.querySelector('.splittable-rect')) {
            // 2. Exclude the current resizing branch to avoid "snapping to yourself"
            if (excludeRootId && (el.id === excludeRootId || el.closest(`#${excludeRootId}`))) {
                return;
            }

            const r = el.getBoundingClientRect();
            // A vertical divider moves horizontally, splitting widths.
            // A horizontal divider moves vertically, splitting heights.
            if (dividerOrientation === 'vertical') {
                if (r.width > 5) dims.add(roundDecimals(r.width));
            } else {
                if (r.height > 5) dims.add(roundDecimals(r.height));
            }
        }
    });
    return Array.from(dims);
}

/**
 * Pure function to find the next snap point.
 * @param {number} currentPct Current percentage (0-100)
 * @param {Array<{value: number, type: string}>} coarseCandidates Standard candidates
 * @param {Array<{value: number, type: string}>} fineCandidates Priority candidates with small minimum jump
 * @param {string} direction 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
 * @returns {{value: number, type: string}|undefined} The best snap point or undefined if none found
 */
export function findNextSnapPoint(currentPct, coarseCandidates, fineCandidates, direction) {
    const MIN_JUMP = 1.2;
    const EPSILON = 0.01;
    const isForward = (direction === 'ArrowRight' || direction === 'ArrowDown');

    let bestPoint = undefined;
    let bestType = undefined;
    let minDiff = Infinity;

    // Helper to process a list with a specific threshold filter
    const processCandidates = (list, threshold) => {
        list.forEach(item => {
            const pt = item.value;
            const diff = pt - currentPct;

            if (isForward) {
                if (diff >= threshold && diff < minDiff) {
                    minDiff = diff;
                    bestPoint = pt;
                    bestType = item.type;
                }
            } else {
                if (diff <= -threshold && Math.abs(diff) < minDiff) {
                    minDiff = Math.abs(diff);
                    bestPoint = pt;
                    bestType = item.type;
                }
            }
        });
    };

    processCandidates(coarseCandidates, MIN_JUMP);
    processCandidates(fineCandidates, EPSILON);

    return bestPoint !== undefined ? { value: bestPoint, type: bestType } : undefined;
}

/**
 * Calculates dynamic snap points based on grid sizes, global alignments, and element sizes.
 * Used by DragHandler and internally by keyboard snapping.
 */
export function calculateDynamicSnaps(divider, orientation) {
    const dynamicSnaps = [];
    const page = getCurrentPage();
    const parentNodeId = divider.getAttribute('data-parent-id');
    const parentNode = findNodeById(page, parentNodeId);

    // 1. Existing Leaf-count fractions
    if (parentNode) {
        const nodeA = findNodeById(parentNode, divider.getAttribute('data-rect-a-id'));
        const nodeB = findNodeById(parentNode, divider.getAttribute('data-rect-b-id'));

        if (nodeA && nodeB) {
            const leftCount = countParallelLeaves(nodeA, orientation);
            const rightCount = countParallelLeaves(nodeB, orientation);
            const totalCount = leftCount + rightCount;

            dynamicSnaps.push({ value: 50, type: SNAP_TYPES.GRID });
            if (totalCount > 1) {
                for (let i = 1; i < totalCount; i++) {
                    dynamicSnaps.push({ value: roundDecimals((i / totalCount) * 100), type: SNAP_TYPES.GRID });
                }
            }
        }
    } else {
        dynamicSnaps.push({ value: 50, type: SNAP_TYPES.GRID });
    }

    // Physical bounds for size/global match logic
    const parentEl = divider.parentElement;
    if (parentEl) {
        const parentRect = parentEl.getBoundingClientRect();
        const parentStyle = window.getComputedStyle(parentEl);
        const movingDivSize = (orientation === 'vertical' ? divider.offsetWidth : divider.offsetHeight);
        const parentSize = (orientation === 'vertical' ? parentRect.width : parentRect.height);
        const startBorder = (orientation === 'vertical' ? parseFloat(parentStyle.borderLeftWidth) : parseFloat(parentStyle.borderTopWidth)) || 0;
        const endBorder = (orientation === 'vertical' ? parseFloat(parentStyle.borderRightWidth) : parseFloat(parentStyle.borderBottomWidth)) || 0;
        const parentStart = (orientation === 'vertical' ? parentRect.left : parentRect.top);

        const availableFlexSpace = parentSize - startBorder - endBorder - movingDivSize;

        if (availableFlexSpace > 0) {
            // 2. Global Alignment Snaps
            const otherDividers = Array.from(document.querySelectorAll(`.divider[data-orientation="${orientation}"]`));
            otherDividers.forEach(div => {
                if (div === divider) return;
                const divRect = div.getBoundingClientRect();
                const divCenter = (orientation === 'vertical' ? divRect.left + divRect.width / 2 : divRect.top + divRect.height / 2);
                const relCenter = divCenter - parentStart;
                const flexPos = relCenter - startBorder - (movingDivSize / 2);
                const relPct = roundDecimals((flexPos / availableFlexSpace) * 100);
                if (relPct >= 0 && relPct <= 100) {
                    dynamicSnaps.push({ value: relPct, type: SNAP_TYPES.GLOBAL });
                }
            });

            // 3. Physical Size Match Logic
            const physicalDims = collectAllLeafDimensions(parentNodeId, orientation);
            physicalDims.forEach(dim => {
                const relPct = roundDecimals((dim / availableFlexSpace) * 100);
                if (relPct >= 0 && relPct <= 100) {
                    dynamicSnaps.push({ value: relPct, type: SNAP_TYPES.SIZE_MATCH });
                    dynamicSnaps.push({ value: roundDecimals(100 - relPct), type: SNAP_TYPES.SIZE_MATCH });
                }
            });
        }
    }

    return dynamicSnaps;
}

export function snapDivider(focusedRect, direction, deleteCallback, renderCallback) {
    const page = getCurrentPage();
    let currentNodeId = focusedRect.id;
    let targetParent = null;
    let targetDividerOrientation = (direction === 'ArrowLeft' || direction === 'ArrowRight') ? 'vertical' : 'horizontal';

    let searchNodeId = currentNodeId;
    while (searchNodeId) {
        const parent = findParentNode(page, searchNodeId);
        if (!parent) break;

        if (parent.orientation === targetDividerOrientation) {
            const isFirstChild = parent.children[0].id === searchNodeId ||
                (parent.children[0].children && findNodeById(parent.children[0], searchNodeId));

            const isSecondChild = parent.children[1].id === searchNodeId ||
                (parent.children[1].children && findNodeById(parent.children[1], searchNodeId));

            if ((isFirstChild && (direction === 'ArrowRight' || direction === 'ArrowDown')) ||
                (isSecondChild && (direction === 'ArrowLeft' || direction === 'ArrowUp'))) {
                targetParent = parent;
                break;
            }
        }
        searchNodeId = parent.id;
    }

    if (!targetParent) return;

    const nodeA = targetParent.children[0];
    const nodeB = targetParent.children[1];

    const currentPct = parseFloat(nodeA.size);
    if (isNaN(currentPct)) return;

    const coarseCandidates = [];
    const fineCandidates = [];

    const addCoarse = (val, type) => {
        val = roundDecimals(val);
        if (val >= 1 && val <= 99) coarseCandidates.push({ value: val, type });
    };

    const addFine = (val, type) => {
        val = roundDecimals(val);
        if (val >= 1 && val <= 99) fineCandidates.push({ value: val, type });
    };

    // 1. Gather all shared snaps (Grid, Global, Size) from universal function
    const movingDivider = document.querySelector(`.divider[data-parent-id="${targetParent.id}"][data-rect-a-id="${nodeA.id}"]`);
    if (movingDivider) {
        const dynamicSnaps = calculateDynamicSnaps(movingDivider, targetDividerOrientation);
        dynamicSnaps.forEach(snap => {
            if (snap.type === SNAP_TYPES.GLOBAL) {
                addFine(snap.value, snap.type);
            } else {
                addCoarse(snap.value, snap.type);
            }
        });
    } else {
        // Fallback for grid logic if DOM is disconnected (e.g. testing context)
        const leftCount = countParallelLeaves(nodeA, targetDividerOrientation);
        const rightCount = countParallelLeaves(nodeB, targetDividerOrientation);
        const totalCount = leftCount + rightCount;
        if (totalCount > 1) {
            addCoarse(50, SNAP_TYPES.GRID);
            for (let i = 1; i < totalCount; i++) {
                addCoarse((i / totalCount) * 100, SNAP_TYPES.GRID);
            }
        } else {
            addCoarse(50, SNAP_TYPES.GRID);
        }
    }

    // 2. Recursive Gap Subdivision (Keyboard exclusive)
    const MIN_GAP_FOR_RECURSION = 10;
    const remainingForward = 100 - currentPct;
    if (remainingForward > MIN_GAP_FOR_RECURSION) {
        SNAP_POINTS.forEach(p => addCoarse(currentPct + (remainingForward * p / 100), SNAP_TYPES.SUBDIVISION));
    }
    const remainingBackward = currentPct;
    if (remainingBackward > MIN_GAP_FOR_RECURSION) {
        SNAP_POINTS.forEach(p => addCoarse(remainingBackward * p / 100, SNAP_TYPES.SUBDIVISION));
    }

    let snapResult = findNextSnapPoint(currentPct, coarseCandidates, fineCandidates, direction);
    let targetPct = snapResult ? snapResult.value : undefined;
    let snapType = snapResult ? snapResult.type : undefined;

    // Fallbacks to bounds
    if (targetPct === undefined) {
        if ((direction === 'ArrowRight' || direction === 'ArrowDown') && currentPct < 99) {
            targetPct = 99;
            snapType = SNAP_TYPES.BOUNDARY;
        } else if ((direction === 'ArrowLeft' || direction === 'ArrowUp') && currentPct > 1) {
            targetPct = 1;
            snapType = SNAP_TYPES.BOUNDARY;
        }
    }

    if (targetPct !== undefined && targetPct !== null) {
        saveState();

        if (snapType && getSettings().electron.showSnapToasts) {
            toast.info(`Snapped: ${snapType}`, 1500);
        }

        if (targetPct <= MIN_AREA_PERCENT) {
            deleteCallback(document.getElementById(nodeA.id));
        } else if ((100 - targetPct) <= MIN_AREA_PERCENT) {
            deleteCallback(document.getElementById(nodeB.id));
        } else {
            nodeA.size = `${targetPct}%`;
            nodeB.size = `${100 - targetPct}%`;
            renderCallback(page, focusedRect.id);
        }
    }
}
