import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEditorKeydown } from '../../src/js/ui/editor.js';

import { toast } from '../../src/js/core/errorHandler.js';

// Mock toast to avoid side effects
vi.mock('../../src/js/core/errorHandler.js', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
        info: vi.fn()
    }
}));

describe('Editor Keydown Handler', () => {
    let mockEditor;

    beforeEach(() => {
        // Simple mock textarea
        mockEditor = {
            value: '',
            selectionStart: 0,
            selectionEnd: 0,
            setRangeText: vi.fn(function (text, start, end, mode) {
                this.value = this.value.substring(0, start) + text + this.value.substring(end);
            }),
            setSelectionRange: vi.fn(function (start, end) {
                this.selectionStart = start;
                this.selectionEnd = end;
            }),
            dispatchEvent: vi.fn(),
            blur: vi.fn()
        };
        vi.clearAllMocks();
    });

    const createEvent = (key, options = {}) => ({
        key,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ctrlKey: options.ctrlKey || false,
        metaKey: options.metaKey || false,
        shiftKey: options.shiftKey || false,
        ...options
    });

    describe('Auto-pairing', () => {
        it('pairs parentheses', () => {
            const event = createEvent('(');
            handleEditorKeydown(event, mockEditor);
            expect(mockEditor.value).toBe('()');
            expect(event.preventDefault).toHaveBeenCalled();
            expect(event._brocoProcessed).toBe(true);
        });

        it('pairs brackets', () => {
            const event = createEvent('[');
            handleEditorKeydown(event, mockEditor);
            expect(mockEditor.value).toBe('[]');
        });

        it('wraps selection with pairs', () => {
            mockEditor.value = 'hello';
            mockEditor.selectionStart = 0;
            mockEditor.selectionEnd = 5;
            const event = createEvent('"');
            handleEditorKeydown(event, mockEditor);
            expect(mockEditor.value).toBe('"hello"');
        });
    });

    describe('List Continuation', () => {
        it('continues unordered list on Enter', () => {
            mockEditor.value = '- item';
            mockEditor.selectionStart = 6;
            mockEditor.selectionEnd = 6;
            const event = createEvent('Enter');
            handleEditorKeydown(event, mockEditor);
            expect(mockEditor.value).toBe('- item\n- ');
            expect(event.preventDefault).toHaveBeenCalled();
        });

        it('increments ordered list on Enter', () => {
            mockEditor.value = '1. first';
            mockEditor.selectionStart = 8;
            mockEditor.selectionEnd = 8;
            const event = createEvent('Enter');
            handleEditorKeydown(event, mockEditor);
            expect(mockEditor.value).toBe('1. first\n2. ');
        });

        it('preserves sublist indentation', () => {
            mockEditor.value = '  - sub';
            mockEditor.selectionStart = 7;
            mockEditor.selectionEnd = 7;
            const event = createEvent('Enter');
            handleEditorKeydown(event, mockEditor);
            expect(mockEditor.value).toBe('  - sub\n  - ');
        });
    });

    describe('Smart Outdenting', () => {
        it('outdents empty sub-item to parent level', () => {
            mockEditor.value = '  - ';
            mockEditor.selectionStart = 4;
            mockEditor.selectionEnd = 4;
            const event = createEvent('Enter');
            handleEditorKeydown(event, mockEditor);
            expect(mockEditor.value).toBe('- ');
            expect(event.preventDefault).toHaveBeenCalled();
        });

        it('ends root list on Enter if empty', () => {
            mockEditor.value = '- ';
            mockEditor.selectionStart = 2;
            mockEditor.selectionEnd = 2;
            const event = createEvent('Enter');
            handleEditorKeydown(event, mockEditor);
            expect(mockEditor.value).toBe('\n');
        });
    });

    describe('Indentation', () => {
        it('indents list item on Tab', () => {
            mockEditor.value = '- ';
            mockEditor.selectionStart = 2;
            mockEditor.selectionEnd = 2;
            const event = createEvent('Tab');
            handleEditorKeydown(event, mockEditor);
            expect(mockEditor.value).toBe('  - ');
        });

        it('outdents list item on Shift+Tab', () => {
            mockEditor.value = '  - ';
            mockEditor.selectionStart = 4;
            mockEditor.selectionEnd = 4;
            const event = createEvent('Tab', { shiftKey: true });
            handleEditorKeydown(event, mockEditor);
            expect(mockEditor.value).toBe('- ');
        });
    });

    describe('Error Handling', () => {
        it('triggers toast on unexpected error', () => {
            // Force a definitive throw by making editor.value null
            mockEditor.value = null;
            const event = createEvent('(');
            handleEditorKeydown(event, mockEditor);

            expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('failed'));
        });
    });
});
