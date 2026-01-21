import { SHORTCUTS } from './constants.js';

export class ShortcutsOverlay {
    constructor() {
        this.element = this.createOverlayElement();
        document.body.appendChild(this.element);
        this.visible = false;
        this.currentHints = '';
    }

    createOverlayElement() {
        const el = document.createElement('div');
        el.id = 'shortcut-overlay';
        return el;
    }

    update(node) {
        if (!node) {
            this.hide();
            return;
        }

        // Filter valid shortcuts for this node
        const validShortcuts = SHORTCUTS.filter(s => {
            try {
                return s.condition(node);
            } catch (e) {
                console.warn('Error checking shortcut condition:', e);
                return false;
            }
        });

        if (validShortcuts.length === 0) {
            this.hide();
            return;
        }

        // Generate HTML
        const html = validShortcuts.map((s, index) => {
            const keysHtml = s.keys.map(k => `<span class="shortcut-key">${k}</span>`).join('');

            return `
                <div class="shortcut-pill">
                    <div class="shortcut-keys">${keysHtml}</div>
                    <span class="shortcut-label">${s.label}</span>
                </div>
                ${index < validShortcuts.length - 1 ? '<div class="shortcut-separator"></div>' : ''}
            `;
        }).join('');

        // Only update DOM if changed to avoid thrashing
        if (html !== this.currentHints) {
            this.element.innerHTML = html;
            this.currentHints = html;
        }

        this.show();
    }

    show() {
        if (!this.visible) {
            this.element.classList.add('visible');
            this.visible = true;
        }
    }

    hide() {
        if (this.visible) {
            this.element.classList.remove('visible');
            this.visible = false;
        }
    }
}

// Singleton instance
export const shortcutsOverlay = new ShortcutsOverlay();
