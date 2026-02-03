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
