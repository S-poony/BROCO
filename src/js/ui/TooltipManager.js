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
            const target = e.target.closest('[data-tooltip]');
            if (target) {
                // DON'T show tooltip if the rectangle is being edited
                if (target.classList.contains('is-editing') || target.closest('.is-editing')) {
                    return;
                }
                this.show(target, target.getAttribute('data-tooltip'));
            }
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest('[data-tooltip]');
            if (target) {
                this.hide();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isVisible) {
                const target = e.target.closest('[data-tooltip]');
                // Hide if we're no longer over a tooltip-enabled element or if we've entered edit mode
                if (!target || target.classList.contains('is-editing') || target.closest('.is-editing')) {
                    this.hide();
                } else {
                    this.updatePosition(e.clientX, e.clientY);
                }
            }
        });
    }

    show(target, text) {
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
