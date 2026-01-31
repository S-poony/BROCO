import { describe, it, expect } from 'vitest';
import { isDividerMergeable, mergeNodesInTree } from '../../src/js/layout/internal/treeUtils.js';

describe('Advanced Merge Logic (isDividerMergeable)', () => {
    it('should return true for simple sibling leaf nodes', () => {
        const parent = {
            splitState: 'split',
            orientation: 'vertical',
            children: [
                { id: 'A', splitState: 'unsplit' },
                { id: 'B', splitState: 'unsplit' }
            ]
        };
        expect(isDividerMergeable(parent)).toBe(true);
    });

    it('should return true for [A | [B | C]] (merging A and B)', () => {
        const parent = {
            splitState: 'split',
            orientation: 'vertical',
            children: [
                { id: 'A', splitState: 'unsplit' },
                {
                    id: 'BC',
                    splitState: 'split',
                    orientation: 'vertical',
                    children: [
                        { id: 'B', splitState: 'unsplit' },
                        { id: 'C', splitState: 'unsplit' }
                    ]
                }
            ]
        };
        // Divider is vertical. Trailing edge of Child 0 (A) is a leaf.
        // Leading edge of Child 1 (BC) is Child B (a leaf).
        // Total 2 leaves touch. -> Mergeable.
        expect(isDividerMergeable(parent)).toBe(true);
    });

    it('should return false for [A | [B / C]] (A touches both B and C)', () => {
        const parent = {
            splitState: 'split',
            orientation: 'vertical',
            children: [
                { id: 'A', splitState: 'unsplit' },
                {
                    id: 'BC',
                    splitState: 'split',
                    orientation: 'horizontal',
                    children: [
                        { id: 'B', splitState: 'unsplit' },
                        { id: 'C', splitState: 'unsplit' }
                    ]
                }
            ]
        };
        // Divider is vertical. 
        // Trailing edge of Child 0 (A) is 1 leaf.
        // Leading edge of Child 1 (BC) is ORTHOGONAL split -> Both B and C touch the divider.
        // Total 3 leaves touch. -> NOT Mergeable.
        expect(isDividerMergeable(parent)).toBe(false);
    });

    it('should return false for [[A/B] | [C/D]] (multi-leaf boundary)', () => {
        const parent = {
            splitState: 'split',
            orientation: 'vertical',
            children: [
                {
                    id: 'AB',
                    splitState: 'split',
                    orientation: 'horizontal',
                    children: [
                        { id: 'A', splitState: 'unsplit' },
                        { id: 'B', splitState: 'unsplit' }
                    ]
                },
                {
                    id: 'CD',
                    splitState: 'split',
                    orientation: 'horizontal',
                    children: [
                        { id: 'C', splitState: 'unsplit' },
                        { id: 'D', splitState: 'unsplit' }
                    ]
                }
            ]
        };
        // Both sides are orthogonal splits. Each contributes 2 leaves to the boundary.
        // Total 4 leaves touch. -> NOT Mergeable.
    });

    it('should preserve absolute positions in [A(40) | [B1(30) | B2(70)](60)]', () => {
        const parent = {
            id: 'P',
            splitState: 'split',
            orientation: 'vertical',
            size: '100%',
            children: [
                { id: 'rect-A', splitState: 'unsplit', size: '40%' },
                {
                    id: 'BC',
                    splitState: 'split',
                    orientation: 'vertical',
                    size: '60%',
                    children: [
                        { id: 'rect-B1', splitState: 'unsplit', size: '30%' },
                        { id: 'rect-B2', splitState: 'unsplit', size: '70%' }
                    ]
                }
            ]
        };
        // Merge A and B1.
        // childA is A, childB is BC. orientation is vertical.
        // leafA is A, leafB is B1.
        const focusTarget = mergeNodesInTree(parent, 'rect-A');

        // parent (P) children are now [Merged(A+B1), B2]
        // Note: In this specific case, rect-B1 survives and rect-A is removed
        expect(parent.children[0].size).toBe('58%');
        expect(parent.children[1].size).toBe('42%');
        expect(focusTarget.id).toBe('rect-B1');
    });

    it('should handle Split-Split merges [ [A1|A2] | [B1|B2] ]', () => {
        const parent = {
            id: 'P',
            splitState: 'split',
            orientation: 'vertical',
            size: '100%',
            children: [
                {
                    id: 'A1A2',
                    splitState: 'split',
                    orientation: 'vertical',
                    size: '40%',
                    children: [
                        { id: 'rect-A1', splitState: 'unsplit', size: '50%' }, // Abs 20%
                        { id: 'rect-A2', splitState: 'unsplit', size: '50%' }  // Abs 20%
                    ]
                },
                {
                    id: 'B1B2',
                    splitState: 'split',
                    orientation: 'vertical',
                    size: '60%',
                    children: [
                        { id: 'rect-B1', splitState: 'unsplit', size: '30%' }, // Abs 18%
                        { id: 'rect-B2', splitState: 'unsplit', size: '70%' }  // Abs 42%
                    ]
                }
            ]
        };
        // Merge A2 and B1.
        expect(isDividerMergeable(parent)).toBe(true);
        const focusTarget = mergeNodesInTree(parent, 'rect-A2');

        // P (parent) should now be A1 | [ Merged | B2 ]
        // A1 Abs: 20%. New size = 20%
        // Merged Abs: 20% + 18% = 38%. New size = 38%
        // B2 Abs: 42%. New size = 42%

        expect(parent.children[0].id).toBe('rect-A1');
        expect(parent.children[0].size).toBe('20%');

        const inner = parent.children[1];
        expect(inner.splitState).toBe('split');
        expect(inner.children[0].id).toBe('rect-A2'); // Content was merged into A2/B1 identity
        expect(inner.children[0].size).toBe('38%');
        expect(inner.children[1].id).toBe('rect-B2');
        expect(inner.children[1].size).toBe('42%');
        expect(focusTarget.id).toBe('rect-A2');
    });

    it('should prioritize initiating node content in merge', () => {
        const parent = {
            splitState: 'split',
            orientation: 'vertical',
            children: [
                { id: 'A', splitState: 'unsplit', text: 'Content A' },
                { id: 'B', splitState: 'unsplit', text: 'Content B' }
            ]
        };
        // Merge from A
        const mergedFromA = mergeNodesInTree(JSON.parse(JSON.stringify(parent)), 'A');
        expect(mergedFromA.text).toBe('Content A');

        // Merge from B
        const mergedFromB = mergeNodesInTree(JSON.parse(JSON.stringify(parent)), 'B');
        expect(mergedFromB.text).toBe('Content B');
    });

    it('should handle arbitrary future content types', () => {
        const parent = {
            splitState: 'split',
            orientation: 'vertical',
            children: [
                { id: 'A', splitState: 'unsplit', pizzaType: 'Marguerita' },
                { id: 'B', splitState: 'unsplit', pizzaType: 'Napoli' }
            ]
        };
        // Merge from B
        const merged = mergeNodesInTree(parent, 'B');
        expect(merged.pizzaType).toBe('Napoli');
        // Structural properties should be clean
        expect(merged.id).toBeUndefined(); // parentNode's ID is usually preserved or promoted elsewhere, but mergedContent itself has no ID
    });
});
