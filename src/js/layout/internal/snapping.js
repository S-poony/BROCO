import { SNAP_POINTS, SNAP_THRESHOLD, MIN_AREA_PERCENT } from '../../core/constants.js';
import { state, getCurrentPage } from '../../core/state.js';
import { saveState } from '../../io/history.js';
import { findNodeById, findParentNode, countParallelLeaves } from './treeUtils.js';
import { toast } from '../../core/errorHandler.js';

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
 * Collects physical dimensions (width and height) of all leaf nodes on the page.
 * @returns {number[]}
 */
function collectAllLeafDimensions() {
    const dims = new Set();
    const rects = document.querySelectorAll('.splittable-rect');
    rects.forEach(el => {
        // Only consider leaf nodes (no nested rectangles)
        if (!el.querySelector('.splittable-rect')) {
            const r = el.getBoundingClientRect();
            if (r.width > 1) dims.add(Math.round(r.width * 10) / 10);
            if (r.height > 1) dims.add(Math.round(r.height * 10) / 10);
        }
    });
    return Array.from(dims);
}

/**
 * Pure function to find the next snap point.
 * @param {number} currentPct Current percentage (0-100)
 * @param {Array<{value: number, type: string}>} candidates Standard candidates
 * @param {Array<{value: number, type: string}>} priorityCandidates Priority candidates
 * @param {string} direction 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
 * @returns {{value: number, type: string}|undefined} The best snap point or undefined if none found
 */
export function findNextSnapPoint(currentPct, candidates, priorityCandidates, direction) {
    const MIN_JUMP = 1.2;
    const EPSILON = 0.01;
    const isForward = (direction === 'ArrowRight' || direction === 'ArrowDown');

    let bestPoint = undefined;
    let bestType = undefined;
    let minDiff = Infinity;

    // Helper to process a list with a specific threshold
    const processCandidates = (list, threshold) => {
        list.forEach(item => {
            const pt = item.value;
            const diff = pt - currentPct;

            if (isForward) {
                if (diff >= threshold) {
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestPoint = pt;
                        bestType = item.type;
                    }
                }
            } else {
                if (diff <= -threshold) {
                    if (Math.abs(diff) < minDiff) {
                        minDiff = Math.abs(diff);
                        bestPoint = pt;
                        bestType = item.type;
                    }
                }
            }
        });
    };

    processCandidates(candidates, MIN_JUMP);
    processCandidates(priorityCandidates, EPSILON);

    return bestPoint !== undefined ? { value: bestPoint, type: bestType } : undefined;
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

    // Candidates are now objects with metadata
    const standardCandidates = [];
    const priorityCandidates = [];

    const addStandard = (val, type) => {
        if (val >= 1 && val <= 99) {
            standardCandidates.push({ value: Math.round(val * 10) / 10, type });
        }
    };

    const addPriority = (val, type) => {
        if (val >= 1 && val <= 99) {
            priorityCandidates.push({ value: parseFloat(val.toFixed(2)), type });
        }
    };

    // 1. Grid Alignment (Leaf Count)
    const totalCount = countParallelLeaves(nodeA, targetDividerOrientation) + countParallelLeaves(nodeB, targetDividerOrientation);
    if (totalCount > 1) {
        addStandard(50, SNAP_TYPES.GRID);
        for (let i = 1; i < totalCount; i++) {
            addStandard((i / totalCount) * 100, SNAP_TYPES.GRID);
        }
    } else {
        addStandard(50, SNAP_TYPES.GRID);
    }

    // 2. Recursive Gap Subdivision
    const MIN_GAP_FOR_RECURSION = 10;
    const remainingForward = 100 - currentPct;
    if (remainingForward > MIN_GAP_FOR_RECURSION) {
        SNAP_POINTS.forEach(p => addStandard(currentPct + (remainingForward * p / 100), SNAP_TYPES.SUBDIVISION));
    }
    const remainingBackward = currentPct;
    if (remainingBackward > MIN_GAP_FOR_RECURSION) {
        SNAP_POINTS.forEach(p => addStandard(remainingBackward * p / 100, SNAP_TYPES.SUBDIVISION));
    }

    // 3. Physical Context for Priority Snaps (Size Match & Global Alignment)
    const parentEl = document.getElementById(targetParent.id) || document.getElementById('a4-paper');
    if (parentEl) {
        const parentRect = parentEl.getBoundingClientRect();
        const parentStyle = window.getComputedStyle(parentEl);
        const movingDivider = document.querySelector(`.divider[data-parent-id="${targetParent.id}"][data-rect-a-id="${nodeA.id}"]`);
        const movingDivSize = movingDivider ? (targetDividerOrientation === 'vertical' ? movingDivider.offsetWidth : movingDivider.offsetHeight) : 0;

        const parentStart = (targetDividerOrientation === 'vertical' ? parentRect.left : parentRect.top);
        const parentSize = (targetDividerOrientation === 'vertical' ? parentRect.width : parentRect.height);
        const startBorder = (targetDividerOrientation === 'vertical' ? parseFloat(parentStyle.borderLeftWidth) : parseFloat(parentStyle.borderTopWidth)) || 0;
        const endBorder = (targetDividerOrientation === 'vertical' ? parseFloat(parentStyle.borderRightWidth) : parseFloat(parentStyle.borderBottomWidth)) || 0;

        const availableFlexSpace = parentSize - startBorder - endBorder - movingDivSize;

        if (availableFlexSpace > 0) {
            // 3a. Global Alignment Snaps
            const otherDividers = Array.from(document.querySelectorAll(`.divider[data-orientation="${targetDividerOrientation}"]`));
            otherDividers.forEach(div => {
                if (div === movingDivider) return;
                const divRect = div.getBoundingClientRect();
                const divCenter = (targetDividerOrientation === 'vertical' ? divRect.left + divRect.width / 2 : divRect.top + divRect.height / 2);
                const relCenter = divCenter - parentStart;
                const flexPos = relCenter - startBorder - (movingDivSize / 2);
                addPriority((flexPos / availableFlexSpace) * 100, SNAP_TYPES.GLOBAL);
            });

            // 3b. Size Match Snaps (Matched physical dimensions)
            const physicalDims = collectAllLeafDimensions();
            physicalDims.forEach(dim => {
                const relPct = (dim / availableFlexSpace) * 100;
                addPriority(relPct, SNAP_TYPES.SIZE_MATCH);
                addPriority(100 - relPct, SNAP_TYPES.SIZE_MATCH);
            });
        }
    }

    let snapResult = findNextSnapPoint(currentPct, standardCandidates, priorityCandidates, direction);
    let targetPct = snapResult ? snapResult.value : undefined;
    let snapType = snapResult ? snapResult.type : undefined;

    // Fallbacks
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

        if (snapType) {
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

/**
 * Calculates dynamic snap points based on parallel leaf counts.
 * Useful for both onDrag and snapDivider logic.
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
                    dynamicSnaps.push({ value: (i / totalCount) * 100, type: SNAP_TYPES.GRID });
                }
            }
        }
    } else {
        dynamicSnaps.push({ value: 50, type: SNAP_TYPES.GRID });
    }

    // 2. Physical Size Match Logic
    const parentEl = divider.parentElement;
    if (parentEl) {
        const parentRect = parentEl.getBoundingClientRect();
        const parentStyle = window.getComputedStyle(parentEl);
        const movingDivSize = (orientation === 'vertical' ? divider.offsetWidth : divider.offsetHeight);
        const parentSize = (orientation === 'vertical' ? parentRect.width : parentRect.height);
        const startBorder = (orientation === 'vertical' ? parseFloat(parentStyle.borderLeftWidth) : parseFloat(parentStyle.borderTopWidth)) || 0;
        const endBorder = (orientation === 'vertical' ? parseFloat(parentStyle.borderRightWidth) : parseFloat(parentStyle.borderBottomWidth)) || 0;

        const availableFlexSpace = parentSize - startBorder - endBorder - movingDivSize;

        if (availableFlexSpace > 0) {
            const physicalDims = collectAllLeafDimensions();
            physicalDims.forEach(dim => {
                const relPct = parseFloat(((dim / availableFlexSpace) * 100).toFixed(2));
                dynamicSnaps.push({ value: relPct, type: SNAP_TYPES.SIZE_MATCH });
                dynamicSnaps.push({ value: parseFloat((100 - relPct).toFixed(2)), type: SNAP_TYPES.SIZE_MATCH });
            });
        }
    }

    return dynamicSnaps;
}
