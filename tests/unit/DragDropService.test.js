import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DragDropService } from '../../src/js/DragDropService.js';

describe('DragDropService', () => {
    let service;

    beforeEach(() => {
        service = new DragDropService();
        document.body.innerHTML = '';
    });

    it('should initialize with empty state', () => {
        expect(service.draggedAsset).toBeNull();
        expect(service.draggedText).toBeUndefined();
        expect(service.isDragging()).toBe(false);
    });

    it('should start drag with asset', () => {
        const asset = { id: '1', name: 'test.png' };
        service.startDrag({ asset });
        expect(service.draggedAsset).toBe(asset);
        expect(service.isDragging()).toBe(true);
    });

    it('should start drag with text', () => {
        service.startDrag({ text: 'hello' });
        expect(service.draggedText).toBe('hello');
        expect(service.isDragging()).toBe(true);
    });

    it('should handle touch drag and create ghost', () => {
        const asset = { id: '1', name: 'test.png', lowResData: 'data' };
        const touch = { clientX: 100, clientY: 100 };
        const event = { touches: [touch] };

        service.startTouchDrag(event, { asset });

        expect(service.isDragging()).toBe(true);
        expect(service.touchGhost).not.toBeNull();
        expect(document.getElementById('drag-ghost')).not.toBeNull();
    });

    it('should clean up after endDrag', () => {
        service.startDrag({ text: 'hello' });
        const data = service.endDrag();

        expect(data.text).toBe('hello');
        expect(service.draggedText).toBeUndefined();
        expect(service.isDragging()).toBe(false);
    });

    it('should move ghost during touch move', () => {
        const asset = { id: '1', name: 'test.png', lowResData: 'data' };
        service.startTouchDrag({ touches: [{ clientX: 100, clientY: 100 }] }, { asset });

        // Mock elementFromPoint since JSDOM doesn't implement layout
        document.elementFromPoint = vi.fn().mockReturnValue(document.body);

        const moveEvent = {
            touches: [{ clientX: 150, clientY: 150 }],
            cancelable: true,
            preventDefault: vi.fn()
        };

        const result = service.handleTouchMove(moveEvent);

        // Ghost size is 60, so center offset is 30
        expect(service.touchGhost.style.left).toBe('120px'); // 150 - 30
        expect(service.touchGhost.style.top).toBe('120px'); // 150 - 30
        expect(result.target).toBe(document.body);
    });
});
