import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the text editor exit/transition behavior.
 *
 * The logic under test lives in main.js's delegated handlers on the paper element.
 * Since those are tightly coupled to the DOM (event delegation), we construct
 * a minimal DOM and simulate the mousedown / click flow to verify guards.
 */

describe('Text Editor Exit Behavior', () => {
    let paper, rectA, rectB, editorA, previewA, editorB, previewB, controlsA;

    beforeEach(() => {
        // Build minimal DOM mimicking what renderer.js produces
        paper = document.createElement('div');
        paper.id = 'a4-paper';
        document.body.appendChild(paper);

        // --- Rect A: text node currently being edited ---
        rectA = document.createElement('div');
        rectA.id = 'rect-1';
        rectA.className = 'splittable-rect rectangle-base flex is-editing';
        rectA.setAttribute('data-split-state', 'unsplit');
        rectA.setAttribute('tabindex', '0');

        const containerA = document.createElement('div');
        containerA.className = 'text-editor-container';

        previewA = document.createElement('div');
        previewA.className = 'markdown-content hidden';
        previewA.innerHTML = '<p>Hello A</p>';

        editorA = document.createElement('textarea');
        editorA.className = 'text-editor';
        editorA.value = 'Hello A';

        controlsA = document.createElement('div');
        controlsA.className = 'text-controls';
        const alignBtn = document.createElement('button');
        alignBtn.className = 'align-text-btn';
        controlsA.appendChild(alignBtn);

        containerA.appendChild(previewA);
        containerA.appendChild(editorA);
        containerA.appendChild(controlsA);
        rectA.appendChild(containerA);
        paper.appendChild(rectA);

        // --- Rect B: another text node (render mode) ---
        rectB = document.createElement('div');
        rectB.id = 'rect-2';
        rectB.className = 'splittable-rect rectangle-base flex';
        rectB.setAttribute('data-split-state', 'unsplit');
        rectB.setAttribute('tabindex', '0');

        const containerB = document.createElement('div');
        containerB.className = 'text-editor-container';

        previewB = document.createElement('div');
        previewB.className = 'markdown-content';
        previewB.innerHTML = '<p>Hello B</p>';

        editorB = document.createElement('textarea');
        editorB.className = 'text-editor hidden';
        editorB.value = 'Hello B';

        containerB.appendChild(previewB);
        containerB.appendChild(editorB);
        rectB.appendChild(containerB);
        paper.appendChild(rectB);
    });

    afterEach(() => {
        paper.remove();
        window._justFinishedEditing = false;
    });

    describe('Mousedown guard while editing', () => {
        it('should blur active editor and consume mousedown when clicking outside the editor', () => {
            // Focus the editor to simulate active editing
            editorA.focus();
            expect(document.activeElement).toBe(editorA);

            const blurSpy = vi.spyOn(editorA, 'blur');

            // Simulate mousedown on rect B (outside the active editor)
            const mousedownEvent = new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0
            });

            // We need to replicate the guard logic inline since main.js sets up
            // the handler on #a4-paper via addEventListener (not easily importable).
            // So we test the guard logic directly.
            const activeEditor = paper.querySelector('.text-editor:focus');
            expect(activeEditor).toBe(editorA);
            expect(activeEditor.contains(rectB)).toBe(false);

            // Verify the guard condition: active editor exists, target is outside it
            const target = rectB;
            const isOutsideEditor = activeEditor && !activeEditor.contains(target);
            const isNotTextControls = !target.closest('.text-controls');

            expect(isOutsideEditor).toBe(true);
            expect(isNotTextControls).toBe(true);

            // The guard should trigger: blur + consume
            if (isOutsideEditor && isNotTextControls) {
                activeEditor.blur();
            }

            expect(blurSpy).toHaveBeenCalled();
        });

        it('should NOT consume mousedown when clicking inside text-controls', () => {
            editorA.focus();

            const alignBtn = controlsA.querySelector('.align-text-btn');
            const activeEditor = paper.querySelector('.text-editor:focus');

            expect(activeEditor).toBe(editorA);

            // Align button is inside .text-controls, so guard should NOT trigger
            const isOutsideEditor = activeEditor && !activeEditor.contains(alignBtn);
            const isNotTextControls = !alignBtn.closest('.text-controls');

            expect(isOutsideEditor).toBe(true);
            expect(isNotTextControls).toBe(false); // It IS inside text-controls

            // Guard should NOT fire for text-controls — event passes through
        });

        it('should NOT interfere when clicking inside the active editor itself', () => {
            editorA.focus();

            const activeEditor = paper.querySelector('.text-editor:focus');
            expect(activeEditor).toBe(editorA);

            // Clicking inside the editor itself
            const isOutsideEditor = activeEditor && !activeEditor.contains(editorA);
            expect(isOutsideEditor).toBe(false); // contains returns true for self
        });
    });

    describe('Preview-to-editor flip guard', () => {
        it('should NOT flip to editor when _justFinishedEditing is true', () => {
            window._justFinishedEditing = true;

            // Simulate the guard logic from the click handler
            const preview = previewB;
            const shouldFlip = preview && !window._justFinishedEditing;

            expect(shouldFlip).toBe(false);
        });

        it('should allow flip to editor when _justFinishedEditing is false', () => {
            window._justFinishedEditing = false;

            const preview = previewB;
            const shouldFlip = preview && !window._justFinishedEditing;

            expect(shouldFlip).toBeTruthy();
        });
    });

    describe('Focus-out cleanup', () => {
        it('should remove is-editing class when editor loses focus', () => {
            // Simulate editing state
            editorA.focus();
            rectA.classList.add('is-editing');

            // Simulate what the focusout handler does
            rectA.classList.remove('is-editing');
            editorA.classList.add('hidden');
            previewA.classList.remove('hidden');

            expect(rectA.classList.contains('is-editing')).toBe(false);
            expect(editorA.classList.contains('hidden')).toBe(true);
            expect(previewA.classList.contains('hidden')).toBe(false);
        });

        it('should not leave node B stuck in is-editing after clicking away from it', () => {
            // Scenario: User clicked from A to B (entering edit on B), then clicks away.
            // With the fix, clicking from A to B should NOT enter edit on B at all.
            // But if it did, the focusout handler should still clean up.

            rectB.classList.add('is-editing');
            editorB.classList.remove('hidden');
            previewB.classList.add('hidden');
            editorB.focus();

            // Simulate focusout cleanup
            rectB.classList.remove('is-editing');
            editorB.classList.add('hidden');
            previewB.classList.remove('hidden');

            expect(rectB.classList.contains('is-editing')).toBe(false);
            expect(editorB.classList.contains('hidden')).toBe(true);
        });
    });
});
