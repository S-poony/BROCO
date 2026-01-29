import { describe, it, expect } from 'vitest';
import { findNextSnapPoint } from '../../src/js/layout/internal/snapping.js';

describe('findNextSnapPoint', () => {
    // Standard candidates: subject to MIN_JUMP (1.2)
    // Priority candidates: subject to EPSILON (0.01)

    it('should select the closest standard candidate if it is far enough', () => {
        const current = 50;
        const candidates = [60];
        const priority = [];
        const result = findNextSnapPoint(current, candidates, priority, 'ArrowRight');
        expect(result).toBe(60);
    });

    it('should skip standard candidate if it is too close (< 1.2)', () => {
        const current = 50;
        const candidates = [51]; // diff 1.0
        const priority = [];
        const result = findNextSnapPoint(current, candidates, priority, 'ArrowRight');
        // Should find nothing or a fallback if provided? Function returns targetPct or null/undefined
        expect(result).toBeUndefined();
    });

    it('should select priority candidate even if it is very close', () => {
        const current = 50;
        const candidates = [];
        const priority = [50.5]; // diff 0.5
        const result = findNextSnapPoint(current, candidates, priority, 'ArrowRight');
        expect(result).toBe(50.5);
    });

    it('should prefer priority candidate over standard candidate if priority is closer and valid', () => {
        const current = 50;
        const candidates = [60];
        const priority = [55];
        const result = findNextSnapPoint(current, candidates, priority, 'ArrowRight');
        expect(result).toBe(55);
    });

    it('should ignore priority candidate if it is BEHIND the direction', () => {
        const current = 50;
        const candidates = [];
        const priority = [40];
        const result = findNextSnapPoint(current, candidates, priority, 'ArrowRight');
        expect(result).toBeUndefined();
    });

    it('should handle ArrowLeft (reverse direction)', () => {
        const current = 50;
        const candidates = [40];
        const priority = [];
        const result = findNextSnapPoint(current, candidates, priority, 'ArrowLeft');
        expect(result).toBe(40);
    });

    it('should skip standard candidate too close in reverse direction', () => {
        const current = 50;
        const candidates = [49]; // diff 1.0
        const priority = [];
        const result = findNextSnapPoint(current, candidates, priority, 'ArrowLeft');
        expect(result).toBeUndefined();
    });

    it('should select priority candidate close in reverse direction', () => {
        const current = 50;
        const candidates = [];
        const priority = [49.5];
        const result = findNextSnapPoint(current, candidates, priority, 'ArrowLeft');
        expect(result).toBe(49.5);
    });

    it('should correctly prioritize closer valid snap point among mixed types', () => {
        const current = 50;
        // Standard at 55 (valid, diff 5)
        // Priority at 52 (valid, diff 2) - Closer!
        const candidates = [55];
        const priority = [52];
        const result = findNextSnapPoint(current, candidates, priority, 'ArrowRight');
        expect(result).toBe(52);
    });

    it('should correctly prioritize closer valid snap point among mixed types (case 2)', () => {
        const current = 50;
        // Standard at 52 (valid, diff 2) - Closer!
        // Priority at 55 (valid, diff 5)
        const candidates = [52];
        const priority = [55];
        const result = findNextSnapPoint(current, candidates, priority, 'ArrowRight');
        expect(result).toBe(52);
    });

    it('should respect boundaries (1 and 99)', () => {
        // Assuming fallback logic handles 1 and 99 if they are not in candidates, 
        // but if findNextSnapPoint is pure, we might expect it to return undefined if not passed.
        // However, the original logic had fallbacks. 
        // Let's assume the caller passes boundaries if they want them, OR the function handles them.
        // Based on plan, we pass candidates/priority. 
        // If we want to test boundary fallback, we might need to check if function implements it or caller.
        // Looking at original code: `if (targetPct === undefined && currentPct < 99) targetPct = 99;`
        // So the function might need to handle this fallback or return undefined and let caller handle it.
        // I'll implement the function to return the BEST candidate found. 
        // If I want the fallback logic inside, I'll add it.

        // Let's test what happens if I pass 99 as a standard candidate
        const current = 98;
        const candidates = [99];
        const priority = [];
        // Diff is 1.0 < 1.2, so standard check fails.
        // But 99 is usually a hard boundary.
        // The original code had: `if (targetPct === undefined && currentPct < 99) targetPct = 99;`
        // So 99 is a fallback if nothing else is found.

        const result = findNextSnapPoint(current, candidates, priority, 'ArrowRight');
        expect(result).toBeUndefined(); // Assuming standard rule applies to 99 if passed as standard.
    });

});
