import { SNAP_POINTS, SNAP_THRESHOLD, MIN_AREA_PERCENT } from '../../core/constants.js';
import { state, getCurrentPage } from '../../core/state.js';
import { saveState } from '../../io/history.js';
import { findNodeById, findParentNode, countParallelLeaves } from './treeUtils.js';

/**
 * Recursively collects all node sizes from a tree.
 * @param {Object} node 
 * @param {Set<number>} sizes 
 */
function collectAllNodeSizes(node, sizes = new Set()) {
    if (node.size) {
        const val = parseFloat(node.size);
        if (!isNaN(val)) {
            sizes.add(val);
        }
    }
    if (node.children) {
        for (const child of node.children) {
            collectAllNodeSizes(child, sizes);
        }
    }
    return sizes;
}

/**
 * Snaps the divider adjacent to the focused rectangle in the given direction.
 * This function handles both calculating snap points and updating state.
 * @param {HTMLElement} focusedRect 
 * @param {string} direction 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
 * @param {Function} deleteCallback (node) => void
 * @param {Function} renderCallback (page, focusId) => void
 */
/**
 * Pure function to find the next snap point.
 * @param {number} currentPct Current percentage (0-100)
 * @param {number[]} candidates Standard candidates (subject to MIN_JUMP)
 * @param {number[]} priorityCandidates Priority candidates (subject to EPSILON, e.g. global alignment)
 * @param {string} direction 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
 * @returns {number|undefined} The best snap point or undefined if none found
 */
export function findNextSnapPoint(currentPct, candidates, priorityCandidates, direction) {
    const MIN_JUMP = 1.2;
    const EPSILON = 0.01;
    const isForward = (direction === 'ArrowRight' || direction === 'ArrowDown');

    let bestPoint = undefined;
    let minDiff = Infinity;

    // Helper to process a list with a specific threshold
    const processCandidates = (list, threshold) => {
        list.forEach(pt => {
            const diff = pt - currentPct;

            // Check direction and threshold
            // Forward: diff must be positive (pt > current)
            // Backward: diff must be negative (pt < current)
            if (isForward) {
                if (diff >= threshold) { // Must be at least threshold away
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestPoint = pt;
                    }
                }
            } else {
                if (diff <= -threshold) { // Must be at least threshold away (negative)
                    // We want the point closest to current, so largest negative diff (closest to 0)
                    // e.g. current=50, pt=40 (diff=-10), pt=45 (diff=-5). We want 45.
                    // Math.abs(diff) < minDiff
                    if (Math.abs(diff) < minDiff) {
                        minDiff = Math.abs(diff);
                        bestPoint = pt;
                    }
                }
            }
        });
    };

    // 1. Process standard candidates with MIN_JUMP
    processCandidates(candidates, MIN_JUMP);

    // 2. Process priority candidates with EPSILON (overrides if better/closer is found)
    // Note: Since we want the *closest* valid point, we just run this update.
    // If a priority point is closer than the best standard point found so far, it will take over
    // because minDiff will be smaller.
    processCandidates(priorityCandidates, EPSILON);

    return bestPoint;
}

export function snapDivider(focusedRect, direction, deleteCallback, renderCallback) {
    const page = getCurrentPage();
    let currentNodeId = focusedRect.id;
    let targetParent = null;
    let targetDividerOrientation = (direction === 'ArrowLeft' || direction === 'ArrowRight') ? 'vertical' : 'horizontal';

    // Find the first ancestor that is split in the relevant orientation
    // AND where the current node (or its branch) is adjacent to the divider in that direction
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

    // We found a divider to move!
    const nodeA = targetParent.children[0];
    const nodeB = targetParent.children[1];

    // Get current percentage of nodeA
    const currentPct = parseFloat(nodeA.size);
    if (isNaN(currentPct)) return;

    // Use Sets to organize candidates
    const standardCandidates = new Set();
    const priorityCandidates = new Set();

    const addStandard = (val) => {
        if (val >= 1 && val <= 99) {
            standardCandidates.add(Math.round(val * 10) / 10);
        }
    };

    const addPriority = (val) => {
        if (val >= 1 && val <= 99) {
            // Keep higher precision for priority alignment
            priorityCandidates.add(parseFloat(val.toFixed(2)));
        }
    };

    // 1. Dynamic Snap Points (Leaf Count) -> Standard
    const totalCount = countParallelLeaves(nodeA, targetDividerOrientation) + countParallelLeaves(nodeB, targetDividerOrientation);
    if (totalCount > 1) {
        addStandard(50);
        for (let i = 1; i < totalCount; i++) {
            addStandard((i / totalCount) * 100);
        }
    } else {
        addStandard(50);
    }

    // 1b. Node Size Matching (Page-wide) -> Standard
    const allSizes = collectAllNodeSizes(page);
    allSizes.forEach(s => {
        addStandard(s);
        addStandard(100 - s);
    });

    // 2. Recursive Gap Subdivision -> Standard
    const MIN_GAP_FOR_RECURSION = 10;
    const remainingForward = 100 - currentPct;
    if (remainingForward > MIN_GAP_FOR_RECURSION) {
        SNAP_POINTS.forEach(p => addStandard(currentPct + (remainingForward * p / 100)));
    }
    const remainingBackward = currentPct;
    if (remainingBackward > MIN_GAP_FOR_RECURSION) {
        SNAP_POINTS.forEach(p => addStandard(remainingBackward * p / 100));
    }

    // 3. Global Alignment Snaps -> Priority
    const otherDividers = Array.from(document.querySelectorAll(`.divider[data-orientation="${targetDividerOrientation}"]`));
    const parentEl = document.getElementById(targetParent.id) || document.getElementById('a4-paper'); // Hardcoded ID fallback

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
            otherDividers.forEach(div => {
                if (div === movingDivider) return;
                const divRect = div.getBoundingClientRect();
                const divCenter = (targetDividerOrientation === 'vertical' ? divRect.left + divRect.width / 2 : divRect.top + divRect.height / 2);

                const relCenter = divCenter - parentStart;
                const flexPos = relCenter - startBorder - (movingDivSize / 2);
                const relPct = (flexPos / availableFlexSpace) * 100;

                addPriority(relPct);
            });
        }
    }

    // Convert sets to arrays
    const candidatesArr = Array.from(standardCandidates);
    const priorityArr = Array.from(priorityCandidates);

    let targetPct = findNextSnapPoint(currentPct, candidatesArr, priorityArr, direction);

    // Fallbacks for boundaries if no snap point found (mimicking original behavior)
    // Original: if (targetPct === undefined && currentPct < 99) targetPct = 99;
    if (targetPct === undefined) {
        if ((direction === 'ArrowRight' || direction === 'ArrowDown') && currentPct < 99) {
            targetPct = 99;
        } else if ((direction === 'ArrowLeft' || direction === 'ArrowUp') && currentPct > 1) {
            targetPct = 1;
        }
    }

    if (targetPct !== undefined && targetPct !== null) {
        saveState();

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
    const dynamicSnaps = new Set([50]);
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

            if (totalCount > 1) {
                for (let i = 1; i < totalCount; i++) {
                    dynamicSnaps.add((i / totalCount) * 100);
                }
            }
        }
    }

    // 2. Page-wide Node Size Matching
    const allSizes = collectAllNodeSizes(page);
    allSizes.forEach(s => {
        dynamicSnaps.add(s);
        dynamicSnaps.add(100 - s);
    });

    return Array.from(dynamicSnaps);
}
