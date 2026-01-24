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
        service.startDrag({ asset }, { clientX: 10, clientY: 10 });
        expect(service.draggedAsset).toBe(asset);
        expect(service.isDragging()).toBe(false); // Threshold not met yet
    });

    it('should start drag with text', () => {
        service.startDrag({ text: 'hello' }, { clientX: 10, clientY: 10 });
        expect(service.draggedText).toBe('hello');
        expect(service.isDragging()).toBe(false);
    });

    it('should handle touch drag and create ghost', () => {
        const asset = { id: '1', name: 'test.png', lowResData: 'data' };
        const event = { clientX: 100, clientY: 100, pointerType: 'touch' };

        // We use pendingData + threshold in actual logic, 
        // but test checks if createGhost works.
        service.createGhost(event, { asset });

        expect(service.touchGhost).not.toBeNull();
        expect(document.getElementById('drag-ghost')).not.toBeNull();
    });

    it('should clean up after endDrag', () => {
        service.startDrag({ text: 'hello' }, { clientX: 10, clientY: 10 });
        const data = service.endDrag();

        expect(data.text).toBe('hello');
        expect(service.draggedText).toBeUndefined();
        expect(service.isDragging()).toBe(false);
    });

    it('should move ghost during touch move', () => {
        const asset = { id: '1', name: 'test.png', lowResData: 'data' };
        const startEvent = { clientX: 100, clientY: 100, pointerType: 'touch' };
        service.startDrag({ asset }, startEvent);

        // Force dragging state for test
        service.dragging = true;
        service.createGhost(startEvent, { asset });

        // Mock elementFromPoint since JSDOM doesn't implement layout
        document.elementFromPoint = vi.fn().mockReturnValue(document.body);

        const moveEvent = {
            clientX: 150,
            clientY: 150,
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
