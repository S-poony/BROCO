/** Paper ID for the main canvas element */
export const A4_PAPER_ID = 'a4-paper';

/** Maximum undo/redo history states */
export const MAX_HISTORY = 50;

/** Max dimension (px) for thumbnail generation - balances quality vs memory */
export const MAX_ASSET_DIMENSION = 800;

/** Ghost element size (px) for drag feedback */
export const GHOST_SIZE = 60;

/** JPEG quality for thumbnails (0-1) */
export const ASSET_THUMBNAIL_QUALITY = 0.6;

/** Maximum file upload size in MB */
export const MAX_FILE_SIZE_MB = 20;

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

    // --- Global / Navigation ---
    {
        keys: ['Arrows'],
        label: 'Navigate',
        group: 'Navigation',
        condition: () => true
    }
];
