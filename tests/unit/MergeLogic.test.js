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

    it('should return true for [A | [B / C]] (multi-node boundary)', () => {
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
        // Now permissive
        expect(isDividerMergeable(parent)).toBe(true);
    });

    it('should return true for [[A/B] | [C/D]] (multi-leaf boundary)', () => {
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
        expect(isDividerMergeable(parent)).toBe(true);
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
        // Merge from A
        const focusTarget = mergeNodesInTree(parent, 'rect-A');

        // parent (P) children are now [A, B2]
        // A size: 40% + (60% * 30%) = 58%
        // B2 size: 60% * 70% = 42%
        expect(parent.children[0].size).toBe('58%');
        expect(parent.children[1].size).toBe('42%');
        expect(focusTarget.id).toBe('rect-A');
    });

    it('should handle Split-Split merges [ [A1|A2] | [B1|B2] ] by consuming sub-child', () => {
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
                        { id: 'rect-A1', splitState: 'unsplit', size: '50%' },
                        { id: 'rect-A2', splitState: 'unsplit', size: '50%' }
                    ]
                },
                {
                    id: 'B1B2',
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
        // Merge from A2 (Left Side) -> Consumes B1 (Right Side's first child)
        const focusTarget = mergeNodesInTree(parent, 'rect-A2');

        // P (parent) should now be [A1A2, B2]
        // A1A2 size: 40% + (60% * 30%) = 40% + 18% = 58%
        // B2 size: 60% * 70% = 42%

        expect(parent.children[0].id).toBe('A1A2');
        expect(parent.children[0].size).toBe('58%');
        expect(parent.children[1].id).toBe('rect-B2');
        expect(parent.children[1].size).toBe('42%');
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
        // Merge from B -> B expands, parent takes B's state
        const merged = mergeNodesInTree(parent, 'B');
        expect(merged.pizzaType).toBe('Napoli');
        // Structural properties: parent keeps its identity but takes expander's state
        expect(parent.pizzaType).toBe('Napoli');
    });
});
