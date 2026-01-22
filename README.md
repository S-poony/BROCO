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

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Tech Stack

-   **Vite** - Build tool
-   **html2canvas** - DOM to canvas rendering
-   **jsPDF** - PDF generation
-   **JSZip** - ZIP archive creation
-   **marked** - Markdown parsing


## License

MIT
