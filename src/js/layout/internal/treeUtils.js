import { state, getCurrentPage } from '../../core/state.js';

/**
 * Helper to find node in the layout tree
 * @param {Object} root
 * @param {string} id
 * @returns {Object|null}
 */
/**
 * Helper to find node in the layout tree
 * @param {Object} root
 * @param {string} id
 * @returns {Object|null}
 */
export function findNodeById(root, id) {
    // O(1) optimization for current page top-level search
    if (state.nodeMap && state.nodeMap.has(id)) {
        const cached = state.nodeMap.get(id);
        // Verify we are searching the whole page (common) or if this node is the page root
        const page = getCurrentPage();
        if (root === page || root.id === page.id) return cached;
    }

    return _findNodeRecursive(root, id);
}

function _findNodeRecursive(node, id) {
    if (node.id === id) return node;
    if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
            const found = _findNodeRecursive(node.children[i], id);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Helper to find parent node in the layout tree
 * @param {Object} root
 * @param {string} childId
 * @returns {Object|null}
 */
/**
 * Helper to find parent node in the layout tree
 * @param {Object} root
 * @param {string} childId
 * @returns {Object|null}
 */
export function findParentNode(root, childId) {
    if (root.children) {
        for (let i = 0; i < root.children.length; i++) {
            const child = root.children[i];
            if (child.id === childId) return root;
            const found = findParentNode(child, childId);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Recursive function to count leaf nodes that are parallel to a given orientation within a subtree.
 * @param {Object} node
 * @param {string} orientation 'vertical' | 'horizontal'
 * @returns {number}
 */
export function countParallelLeaves(node, orientation) {
    if (!node || node.splitState === 'unsplit') {
        return 1;
    }
    // If the node is split in the SAME orientation, sum the children
    if (node.orientation === orientation) {
        let sum = 0;
        if (node.children) {
            for (const child of node.children) {
                sum += countParallelLeaves(child, orientation);
            }
        }
        return sum;
    }
    // If split in ORTHOGONAL orientation, it counts as 1 block in this dimension
    return 1;
}
/**
 * Core logic to delete a node from the layout tree.
 * Removes the node and merges its sibling into the parent.
 * @param {Object} root The root node of the tree (or subtree)
 * @param {string} nodeId The ID of the node to delete
 * @returns {Object|null} The node that should receive focus, or null if not found
 */
export function deleteNodeFromTree(root, nodeId) {
    const parentNode = findParentNode(root, nodeId);
    if (!parentNode || !parentNode.children) return null;

    const siblingNode = parentNode.children.find(c => c.id !== nodeId);
    if (!siblingNode) return null;

    // Merge sibling into parent
    parentNode.splitState = siblingNode.splitState;
    if (siblingNode.splitState === 'split') {
        parentNode.children = siblingNode.children;
        parentNode.orientation = siblingNode.orientation;
    } else {
        parentNode.children = null;
        parentNode.image = siblingNode.image;
        parentNode.text = siblingNode.text;
        parentNode.textAlign = siblingNode.textAlign;
        parentNode.orientation = null;
    }

    return parentNode;
}

/**
 * Determines if a divider (represented by its parent node) is mergeable.
 * Now permissive to allow multi-node merges.
 * @param {Object} parentNode
 * @returns {boolean}
 */
export function isDividerMergeable(parentNode) {
    return parentNode && parentNode.splitState === 'split' && parentNode.children && parentNode.children.length === 2;
}

/**
 * Counts how many leaf nodes within a subtree touch a specific boundary.
 * @param {Object} node Subtree root
 * @param {string} splitOrientation The orientation of the split that created this boundary ('vertical' | 'horizontal')
 * @param {boolean} isLeading Whether we are checking the leading edge (top/left) or trailing (bottom/right)
 * @returns {number}
 */
function countNodesAlongBoundary(node, splitOrientation, isLeading) {
    if (node.splitState === 'unsplit') return 1;

    if (node.orientation === splitOrientation) {
        // Parallel split: only the child adjacent to the boundary contributes.
        // If we want the leading edge of a vertical split [A|B], we pick A.
        // If we want the trailing edge, we pick B.
        const targetIndex = isLeading ? 0 : 1;
        return countNodesAlongBoundary(node.children[targetIndex], splitOrientation, isLeading);
    } else {
        // Orthogonal split: BOTH children contribute to the shared boundary.
        return countNodesAlongBoundary(node.children[0], splitOrientation, isLeading) +
            countNodesAlongBoundary(node.children[1], splitOrientation, isLeading);
    }
}

/**
 * Merges nodes separated by a specific divider using directional expansion.
 * @param {Object} parentNode The parent node of the divider
 * @param {string} focusedNodeId The ID of the node initiating the merge (expander)
 * @returns {Object} The node that was expanded or the new parent
 */
export function mergeNodesInTree(parentNode, focusedNodeId) {
    const [childA, childB] = parentNode.children;
    const orientation = parentNode.orientation;

    // 1. Determine direction: which side contains the focused node?
    // If focusedNodeId is null (e.g. from mouse click), we can default to childA expanding or use context.
    // For now, if null, we'll try to find any content to preserve, but keyboard always passes it.
    const isExpanderA = (childA.id === focusedNodeId || (childA.children && findNodeById(childA, focusedNodeId)));
    const isExpanderB = (childB.id === focusedNodeId || (childB.children && findNodeById(childB, focusedNodeId)));

    // Fallback if neither (e.g. click on divider with no focus)
    if (!isExpanderA && !isExpanderB) {
        // Default to A expanding if it has content, else B
        // This is a sensible default for mouse-initiated merges
        return mergeNodesInTree(parentNode, childA.id);
    }

    const expander = isExpanderA ? childA : childB;
    const neighbor = isExpanderA ? childB : childA;

    // 2. Determine Neighbor Consumption
    if (neighbor.splitState === 'split' && neighbor.orientation === orientation) {
        // Case A: Neighbor split in SAME orientation -> Consume touching sub-child
        const neighborChildA = neighbor.children[0];
        const neighborChildB = neighbor.children[1];

        // If expander is on the left (A), we consume the left part of neighbor (neighborChildA)
        const consumed = isExpanderA ? neighborChildA : neighborChildB;
        const remaining = isExpanderA ? neighborChildB : neighborChildA;

        // Combine sizes
        const expanderSize = parseFloat(expander.size) || 50;
        const neighborSize = parseFloat(neighbor.size) || 50;
        const consumedRelSize = parseFloat(consumed.size) || 50;

        // The expander now takes its old size + (neighborSize * consumedRelSize / 100)
        const newExpanderSize = expanderSize + (neighborSize * consumedRelSize / 100);
        const newRemainingSize = 100 - newExpanderSize;

        expander.size = `${newExpanderSize}%`;
        remaining.size = `${newRemainingSize}%`;

        // Update parent's children
        parentNode.children = isExpanderA ? [expander, remaining] : [remaining, expander];

        // Return a leaf within the expanded side for focus restoration
        return findNodeById(expander, focusedNodeId) || expander;
    }

    // Case B: Neighbor is a leaf OR split ORTHOGONALLY -> Consume entirely
    // Parent becomes the expander (promote expander)
    const structuralKeys = ['id', 'size'];
    const newState = {};

    // Collect all properties from expander
    Object.keys(expander).forEach(key => {
        if (!structuralKeys.includes(key)) {
            newState[key] = (typeof expander[key] === 'object' && expander[key] !== null) ?
                JSON.parse(JSON.stringify(expander[key])) : expander[key];
        }
    });

    // Clean up parentNode before assigning new state (preserving ID and Size)
    Object.keys(parentNode).forEach(key => {
        if (!structuralKeys.includes(key)) {
            delete parentNode[key];
        }
    });

    Object.assign(parentNode, newState);

    return findNodeById(parentNode, focusedNodeId) || parentNode;
}
