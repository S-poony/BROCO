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
