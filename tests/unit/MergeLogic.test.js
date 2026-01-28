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
        const merged = mergeNodesInTree(parent);

        // Children of P are now [Merged(A+B1), B2]
        expect(merged.children[0].size).toBe('58%');
        expect(merged.children[1].size).toBe('42%');
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
        const merged = mergeNodesInTree(parent);

        // P should now be A1 | [ Merged | B2 ]
        // A1 Abs: 20%. New size = 20%
        // Merged Abs: 20% + 18% = 38%. New size = 38%
        // B2 Abs: 42%. New size = 42%

        expect(merged.children[0].id).toBe('rect-A1');
        expect(merged.children[0].size).toBe('20%');

        const inner = merged.children[1];
        expect(inner.splitState).toBe('split');
        expect(inner.children[0].id).toBe('rect-A2'); // Content was merged into A2/B1 identity
        expect(inner.children[0].size).toBe('38%');
        expect(inner.children[1].id).toBe('rect-B2');
        expect(inner.children[1].size).toBe('42%');
    });
});
