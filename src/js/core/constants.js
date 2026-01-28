import { state } from './state.js';

/** Paper ID for the main canvas element */
export const A4_PAPER_ID = 'a4-paper';

/** Snap points for divider dragging (%) */
export const SNAP_POINTS = [50];

/** Responsive Breakpoint (match with CSS --breakpoint-laptop) */
export const LAPTOP_BREAKPOINT = 1024;

/** Snap threshold for divider dragging (px) */
export const SNAP_THRESHOLD = 20;

/** Maximum undo/redo history states */
export const MAX_HISTORY = 50;

/** Minimum size percentage before a rectangle is automatically deleted */
export const MIN_AREA_PERCENT = 1;

/** Max dimension (px) for thumbnail generation - balances quality vs memory */
export const MAX_ASSET_DIMENSION = 800;

/** Ghost element size (px) for drag feedback */
export const GHOST_SIZE = 60;

/** JPEG quality for thumbnails (0-1) */
export const ASSET_THUMBNAIL_QUALITY = 0.6;

/** Maximum file upload size in MB */
export const MAX_FILE_SIZE_MB = 50;

/** Width/Height of dividers and hit areas (px) */
export const DIVIDER_SIZE = 5;

/** 
 * Centralized Shortcut Registry 
 * used to generate UI hints and (optionally) validate actions 
 */
export const SHORTCUTS = [

    // --- Image Specific ---
    {
        keys: ['Click'],
        label: 'Toggle Fit',
        group: 'Content',
        condition: (node) => !!node.image
    },

    // --- Text Specific ---
    {
        keys: ['Enter'],
        label: 'Edit',
        group: 'Content',
        condition: (node) => node.text !== null && node.text !== undefined
    },

    {
        keys: ['esc'],
        label: 'Exit Edit',
        group: 'Content',
        condition: (node) => node.text !== null && node.text !== undefined
    },

    // --- Content Presence (Image or Text) ---
    {
        keys: ['Cmd/Ctrl', 'Click'],
        label: 'Delete Content',
        group: 'Content',
        condition: (node) => node.image || (node.text !== null && node.text !== undefined)
    },
    {
        keys: ['Shift', 'Click'],
        label: 'Split (Top/Left)',
        group: 'Structure',
        condition: (node) => node.image || (node.text !== null && node.text !== undefined)
    },
    {
        keys: ['Ctrl', 'Shift', 'Click'],
        label: 'Split (Btm/Right)',
        group: 'Structure',
        condition: (node) => node.image || (node.text !== null && node.text !== undefined)
    },

    // --- Universal Split ---
    {
        keys: ['Alt', 'Click'],
        label: 'Long Split',
        group: 'Structure',
        // Always available for splittable rects
        condition: () => true
    },
    {
        keys: ['Shift', 'Drag'],
        label: 'Snap Divider',
        group: 'Structure',
        condition: () => !!state.activeDivider
    },

    // --- Empty Rectangle ---
    {
        keys: ['Any'],
        label: 'Write',
        group: 'Content',
        condition: (node) => !node.image && (node.text === null || node.text === undefined)
    },
    {
        keys: ['Click/Space'], // Implicitly split via bubble up
        label: 'Split',
        group: 'Structure',
        condition: (node) => !node.image && (node.text === null || node.text === undefined)
    },

    {
        keys: ['Alt', 'Arrows'],
        label: 'Snap Divider',
        group: 'Structure',
        condition: () => true
    },

    // --- Global / Navigation ---
    {
        keys: ['Arrows'],
        label: 'Navigate',
        group: 'Navigation',
        condition: () => true
    },

    // --- Electron Shortcuts ---
    {
        keys: ['Alt', 'Space'],
        label: 'Long Split',
        group: 'Electron Shortcuts',
        // Available for all splittable rects in Electron
        condition: (node) => {
            const isElectron = (window.electronAPI && window.electronAPI.isElectron) || /Electron/i.test(navigator.userAgent);
            return isElectron;
        }
    },
    {
        keys: ['Ctrl', 'I'],
        label: 'Import Folder',
        group: 'Electron Shortcuts',
        condition: () => false // Hidden from layout-specific context hints
    }
];
