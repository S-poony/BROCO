import { state } from '../../core/state.js';

/**
 * Helper to find node in the layout tree
 * @param {Object} root
 * @param {string} id
 * @returns {Object|null}
 */
export function findNodeById(root, id) {
    if (root.id === id) return root;
    if (root.children) {
        for (const child of root.children) {
            const found = findNodeById(child, id);
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
export function findParentNode(root, childId) {
    if (root.children) {
        if (root.children.some(c => c.id === childId)) return root;
        for (const child of root.children) {
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
 * A divider is mergeable if it separates EXACTLY one leaf node from each child subtree
 * along its entire length.
 * @param {Object} parentNode
 * @returns {boolean}
 */
export function isDividerMergeable(parentNode) {
    if (!parentNode || parentNode.splitState !== 'split' || !parentNode.children) return false;

    const [childA, childB] = parentNode.children;
    const orientation = parentNode.orientation;

    // We check the "trailing" edge of the first child and "leading" edge of the second.
    const countA = countNodesAlongBoundary(childA, orientation, false); // Trailing edge of Child A
    const countB = countNodesAlongBoundary(childB, orientation, true);  // Leading edge of Child B

    return countA === 1 && countB === 1;
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
 * Merges nodes separated by a specific divider using surgical Tree Contraction.
 * Assumes isDividerMergeable(parentNode) is true.
 * @param {Object} parentNode The parent node of the divider
 * @returns {Object} The updated node that replaces parentNode
 */
export function mergeNodesInTree(parentNode) {
    const [childA, childB] = parentNode.children;
    const orientation = parentNode.orientation;

    // 1. Identify the touching leaf nodes
    const getTouchingLeaf = (node, splitOrientation, isLeading) => {
        if (node.splitState === 'unsplit') return node;
        const targetIndex = isLeading ? 0 : 1;
        return getTouchingLeaf(node.children[targetIndex], splitOrientation, isLeading);
    };

    const leafA = getTouchingLeaf(childA, orientation, false); // Trailing edge
    const leafB = getTouchingLeaf(childB, orientation, true);  // Leading edge

    // 2. Combine content
    const hasContent = (n) => n && (n.image || (n.text !== null && n.text !== undefined));
    const winner = hasContent(leafA) ? leafA : leafB;

    const mergedContent = {
        splitState: 'unsplit',
        children: null,
        orientation: null,
        image: winner.image ? { ...winner.image } : null,
        text: winner.text,
        textAlign: winner.textAlign
    };

    // 3. Tree Contraction Logic
    // Recursive helper to update leaf within a subtree
    const contract = (node, targetLeafId, newNode) => {
        if (node.id === targetLeafId) {
            Object.assign(node, newNode);
            return node;
        }
        if (node.children) {
            node.children = node.children.map(c => contract(c, targetLeafId, newNode));
        }
        return node;
    };

    // Update childA and childB structures
    contract(childA, leafA.id, mergedContent);
    contract(childB, leafB.id, mergedContent);

    // 4. Update parentNode and Recalculate Sizes
    const parseSize = (s) => parseFloat(s) || 50;
    const sizeA = parseSize(childA.size);
    const sizeB = parseSize(childB.size);

    const isParallelA = childA.splitState === 'split' && childA.orientation === orientation;
    const isParallelB = childB.splitState === 'split' && childB.orientation === orientation;

    if (isParallelA && isParallelB) {
        // [ [A1|A2] | [B1|B2] ] -> Merge A2 and B1.
        // Result is [ A1 | [Merged(A2,B1) | B2] ] (nested binary tree)
        // New structure for parentNode: 
        // P { split, children: [A1, NewParent { children: [Merged, B2] }] }

        const factorA = sizeA / 100;
        const factorB = sizeB / 100;

        // Adjust A1
        childA.children[0].size = `${parseSize(childA.children[0].size) * factorA}%`;

        // Adjust A2 (it will be merged, it takes sizeA*ratio2 + sizeB*ratio1)
        const a2Abs = parseSize(childA.children[1].size) * factorA;
        const b1Abs = parseSize(childB.children[0].size) * factorB;
        childA.children[1].size = `${a2Abs + b1Abs}%`;

        // Adjust B2
        childB.children[1].size = `${parseSize(childB.children[1].size) * factorB}%`;

        // We can structure the result as A1 | [Merged | B2]
        // leafA already shares content with leafB due to earlier contract() calls.
        // leafA IS childA.children[1].
        // leafB IS childB.children[0].

        const newInnerParent = {
            id: `rect-${++state.currentId}`,
            splitState: 'split',
            orientation: orientation,
            size: `${100 - parseSize(childA.children[0].size)}%`,
            children: [
                childA.children[1], // The merged node (A2 + B1 content)
                childB.children[1]  // B2
            ]
        };

        parentNode.splitState = 'split';
        parentNode.children = [
            childA.children[0], // A1
            newInnerParent
        ];
    } else if (isParallelA) {
        // [ [A1|A2] | B ] -> Merge A2 and B
        const factor = sizeA / 100;
        childA.children.forEach(c => {
            const innerSize = parseSize(c.size);
            const absoluteSize = innerSize * factor;
            if (c.id === leafA.id || (c.children && findNodeById(c, leafA.id))) {
                c.size = `${absoluteSize + sizeB}%`;
            } else {
                c.size = `${absoluteSize}%`;
            }
        });
        parentNode.splitState = 'split';
        parentNode.children = childA.children;
        parentNode.orientation = childA.orientation;
    } else if (isParallelB) {
        // [ A | [B1|B2] ] -> Merge A and B1
        const factor = sizeB / 100;
        childB.children.forEach(c => {
            const innerSize = parseSize(c.size);
            const absoluteSize = innerSize * factor;
            if (c.id === leafB.id || (c.children && findNodeById(c, leafB.id))) {
                c.size = `${absoluteSize + sizeA}%`;
            } else {
                c.size = `${absoluteSize}%`;
            }
        });
        parentNode.splitState = 'split';
        parentNode.children = childB.children;
        parentNode.orientation = childB.orientation;
    } else {
        // Simple case: A | B
        Object.assign(parentNode, mergedContent);
    }

    return parentNode;
}
