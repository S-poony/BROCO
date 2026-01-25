# BROCO: Beautiful Rows and Columns

A visual tool for designing multi-page document layouts with drag-and-drop image placement. Perfect for creating photo albums, portfolios, and print-ready designs.

Fast like excel, beautiful like canva, and powerful like obsidian.

**[Live Demo](https://s-poony.github.io/BROCO/)**

## Features

-   **Recursive Layout**: Click any rectangle to split it vertically or horizontally, drag edges of the canvas to create new sections.
-   **Image Management**: Import images and drag them into any slot. Click an image to toggle between `cover` and `contain` fit. Images are instances of imported assets.
-   **Multi-Page Support**: Add, switch, and delete pages via the left sidebar.
-   **Undo/Redo**: Full history support with `Ctrl+Z` / `Ctrl+Y`.
-   **Keyboard Shortcuts**: Use keyboard shortcuts to navigate and edit your layout without a mouse.
-   **Markdown**: Add markdown content to your layout with automatic input completion for headers, lists, bold, italic, etc.
-   **Customization**: Customize the layout by changing font, background color, and more.
- **File system**: Save your layouts as json files to edit them later.
-   **Export**: Download your layouts in different formats or publish them online as flipbooks.

## Advanced Keyboard Controls

BROCO features a powerful, keyboard-first layout engine that allows for rapid reorganization without a mouse.

### Content Movement (`Shift + Arrows`)
Move or swap images and text between adjacent rectangles. If a destination is already occupied, the contents and their settings (alignment, flip state) are swapped. The selection focus follows the content, allowing for rapid repositioning across the page.

### Recursive Divider Snapping (`Alt + Arrows`)
Adjust structural dividers with mathematical precision:
- **Recursive Subdivision**: Instead of fixed milestones, the system calculates snap points relative to the *remaining* space. If you're at 66%, the next snap will be a subdivision of the last 33%, allowing for infinite nesting of proportions.
- **Global Alignment**: The engine scans every other divider in your layout. It will automatically "catch" and align perfectly with them, ensuring visual continuity even across different parent containers.
- **Milestone Priority**: Standard ratios (1/3, 1/2, 2/3) are always prioritized as snap candidates.
- **Snap Protection**: A minimum jump distance ensures that every keypress results in a significant structural change, preventing "micro-jumps."

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production (Web)
npm run build

# Build for Desktop (Windows .exe)
npm run electron:build
```

## Tech Stack

-   **Vite** - Build tool
-   **html2canvas** - DOM to canvas rendering
-   **jsPDF** - PDF generation
-   **JSZip** - ZIP archive creation
-   **marked** - Markdown parsing



## Releasing Updates (Desktop App)

To push a new version to users:
1.  **Bump Version**: Open `package.json` and increase the `"version"` (e.g., `"1.0.0"` -> `"1.0.1"`).
2.  **Build**: Run `npm run electron:build`.
3.  **GitHub Release**:
    *   Go to GitHub > Releases > "Draft a new release".
    *   Tag the release (e.g., `v1.0.1`).
    *   **Upload Assets**: You MUST upload these files from `dist_electron/`:
        *   `BROCO Setup X.X.X.exe` (The installer)
        *   `latest.yml` (Critical for auto-updates to work)
        *   `latest.yml.blockmap` (Optional, optimizes update size)
    *   Publish the release.
4.  Users will receive the update automatically next time they open the app.
