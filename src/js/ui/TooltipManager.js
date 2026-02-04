import { getSettings } from './settings.js';

/**
 * Tooltip Manager
 * Manages a single global tooltip element for the application.
 */
export class TooltipManager {
    constructor() {
        this.element = this.createTooltipElement();
        document.body.appendChild(this.element);
        this.isVisible = false;

        this.setupEventListeners();
    }

    createTooltipElement() {
        const el = document.createElement('div');
        el.id = 'global-tooltip';
        el.setAttribute('role', 'tooltip');
        return el;
    }

    setupEventListeners() {
        document.addEventListener('mouseover', (e) => {
            // Priority 1: Elements with explicit data-tooltip
            // Priority 2: Dividers (dynamic)
            let target = e.target.closest('[data-tooltip]');
            let text = target ? target.getAttribute('data-tooltip') : null;

            if (!target) {
                const divider = e.target.closest('.divider');
                if (divider) {
                    target = divider;
                    text = 'Hold Shift to snap';
                }
            }

            if (target && text) {
                // DON'T show tooltip if the rectangle is being edited
                if (target.classList.contains('is-editing') || target.closest('.is-editing')) {
                    return;
                }
                // DON'T show tooltip if we are currently dragging (indicated by no-select)
                if (document.body.classList.contains('no-select')) {
                    return;
                }

                this.show(target, text);
            }
        });

        document.addEventListener('mouseout', (e) => {
            // Handle both data-tooltip and divider targets
            if (e.target.closest('[data-tooltip], .divider')) {
                this.hide();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isVisible) {
                const target = e.target.closest('[data-tooltip], .divider');
                // Hide if we're no longer over a tooltip-enabled element, if we've entered edit mode, or if a drag started
                if (!target ||
                    target.classList.contains('is-editing') ||
                    target.closest('.is-editing') ||
                    document.body.classList.contains('no-select')) {
                    this.hide();
                } else {
                    this.updatePosition(e.clientX, e.clientY);
                }
            }
        });

        // Hide tooltip immediately when starting to drag/click
        document.addEventListener('mousedown', () => {
            this.hide();
        });
    }

    show(target, text) {
        const settings = getSettings();
        if (!settings.electron.enableTooltips) return;

        this.element.textContent = text;
        this.element.classList.add('visible');
        this.isVisible = true;
    }

    hide() {
        this.element.classList.remove('visible');
        this.isVisible = false;
    }

    updatePosition(x, y) {
        const offset = 15;
        let finalX = x + offset;
        let finalY = y + offset;

        // Ensure tooltip stays within viewport
        const rect = this.element.getBoundingClientRect();
        if (finalX + rect.width > window.innerWidth) {
            finalX = x - rect.width - offset;
        }
        if (finalY + rect.height > window.innerHeight) {
            finalY = y - rect.height - offset;
        }

        this.element.style.left = `${finalX}px`;
        this.element.style.top = `${finalY}px`;
    }
}

// Singleton instance
export const tooltipManager = new TooltipManager();
