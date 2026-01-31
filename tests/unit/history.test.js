import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock document for DOM operations
const mockDocument = {
    dispatchEvent: vi.fn()
};
vi.stubGlobal('document', mockDocument);

// Import after mocking
const { saveState, undo, redo, clearHistory } = await import('../../src/js/io/history.js');
const { state, updateCurrentId, getCurrentPage, addPage, deletePage, switchPage } = await import('../../src/js/core/state.js');

describe('History Module', () => {
    beforeEach(() => {
        // Reset state
        state.pages = [{ id: 'rect-1', splitState: 'unsplit', image: null, text: null }];
        state.currentPageIndex = 0;
        state.currentId = 1;
        mockDocument.dispatchEvent.mockClear();
        clearHistory();
    });

    describe('saveState', () => {
        it('should save current state to undo stack', () => {
            saveState();

            // Modify state
            state.pages[0].splitState = 'split';

            // Undo should restore
            undo(() => { });
            expect(state.pages[0].splitState).toBe('unsplit');
        });

        it('should clear redo stack when saving new state', () => {
            saveState();
            state.pages[0].text = 'first change';

            saveState();
            state.pages[0].text = 'second change';

            // Undo once
            undo(() => { });
            expect(state.pages[0].text).toBe('first change');

            // Save new state (should clear redo)
            saveState();
            state.pages[0].text = 'new branch';

            // Redo should do nothing
            redo(() => { });
            expect(state.pages[0].text).toBe('new branch');
        });

        it('should set isDirty to true when saving state', () => {
            state.isDirty = false;
            saveState();
            expect(state.isDirty).toBe(true);
        });
    });

    describe('undo', () => {
        it('should do nothing when undo stack is empty', () => {
            const callback = vi.fn();
            undo(callback);
            expect(callback).not.toHaveBeenCalled();
        });

        it('should restore previous state', () => {
            saveState();
            state.pages[0].text = 'modified';

            const callback = vi.fn();
            undo(callback);

            expect(state.pages[0].text).toBeNull();
            expect(callback).toHaveBeenCalled();
        });

        it('should dispatch stateRestored event', () => {
            saveState();
            state.pages[0].text = 'modified';

            undo(() => { });

            expect(mockDocument.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'stateRestored' })
            );
        });

        it('should push current state to redo stack', () => {
            saveState();
            state.pages[0].text = 'modified';

            undo(() => { });
            expect(state.pages[0].text).toBeNull();

            redo(() => { });
            expect(state.pages[0].text).toBe('modified');
        });
    });

    describe('redo', () => {
        it('should do nothing when redo stack is empty', () => {
            const callback = vi.fn();
            redo(callback);
            expect(callback).not.toHaveBeenCalled();
        });

        it('should restore undone state', () => {
            saveState();
            state.pages[0].text = 'modified';

            undo(() => { });
            expect(state.pages[0].text).toBeNull();

            redo(() => { });
            expect(state.pages[0].text).toBe('modified');
        });
    });

    describe('multiple undo/redo', () => {
        it('should handle multiple undo operations', () => {
            saveState();
            state.pages[0].text = 'change 1';

            saveState();
            state.pages[0].text = 'change 2';

            saveState();
            state.pages[0].text = 'change 3';

            undo(() => { });
            expect(state.pages[0].text).toBe('change 2');

            undo(() => { });
            expect(state.pages[0].text).toBe('change 1');

            undo(() => { });
            expect(state.pages[0].text).toBeNull();
        });

        it('should handle undo then redo sequence', () => {
            saveState();
            state.pages[0].text = 'step 1';

            saveState();
            state.pages[0].text = 'step 2';

            undo(() => { });
            undo(() => { });

            redo(() => { });
            expect(state.pages[0].text).toBe('step 1');

            redo(() => { });
            expect(state.pages[0].text).toBe('step 2');
        });
    });
});

describe('State Module', () => {
    beforeEach(() => {
        // Reset to initial state
        state.pages = [{ id: 'rect-1', splitState: 'unsplit', image: null, text: null }];
        state.currentPageIndex = 0;
        state.currentId = 1;
    });

    describe('getCurrentPage', () => {
        it('should return the active page', () => {
            const page = getCurrentPage();
            expect(page.id).toBe('rect-1');
        });
    });

    describe('addPage', () => {
        it('should add a new page and switch to it', () => {
            const newIndex = addPage();

            expect(state.pages).toHaveLength(2);
            expect(newIndex).toBe(1);
            expect(state.currentPageIndex).toBe(1);
        });

        it('should increment currentId for new page', () => {
            const oldId = state.currentId;
            addPage();
            expect(state.currentId).toBeGreaterThan(oldId);
        });
    });

    describe('switchPage', () => {
        it('should switch to valid page index', () => {
            addPage();
            switchPage(0);
            expect(state.currentPageIndex).toBe(0);
        });

        it('should ignore invalid page index', () => {
            switchPage(999);
            expect(state.currentPageIndex).toBe(0);

            switchPage(-1);
            expect(state.currentPageIndex).toBe(0);
        });
    });

    describe('deletePage', () => {
        it('should not delete last remaining page', () => {
            deletePage(0);
            expect(state.pages).toHaveLength(1);
        });

        it('should delete page and adjust index', () => {
            addPage();
            addPage();
            expect(state.pages).toHaveLength(3);

            deletePage(1);
            expect(state.pages).toHaveLength(2);
        });

        it('should adjust currentPageIndex when needed', () => {
            addPage();
            addPage();
            state.currentPageIndex = 2;

            deletePage(2);
            expect(state.currentPageIndex).toBe(1);
        });
    });

    describe('updateCurrentId', () => {
        it('should update the currentId', () => {
            updateCurrentId(100);
            expect(state.currentId).toBe(100);
        });
    });
});
