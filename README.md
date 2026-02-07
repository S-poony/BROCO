# BROCO: Beautiful Rows and Columns

A visual tool for designing multi-page document layouts with drag-and-drop image placement. Perfect for creating photo albums, portfolios, and print-ready designs.

Fast like excel, beautiful like canva, and powerful like obsidian.

**[Live Demo](https://s-poony.github.io/BROCO/)**
**[Youtube Demo](https://youtu.be/cvfVd9Yq398)**

## Features

-   **Recursive Layout**: Click any rectangle to split it vertically or horizontally, drag edges of the canvas to create new sections.
-   **Image Management**: Import images and drag them into any slot. Click an image to toggle between `cover` and `contain` fit. Images are instances of imported assets.
-   **Multi-Page Support**: Add, switch, and delete pages via the left sidebar.
-   **Keyboard Shortcuts**: Use keyboard shortcuts to navigate and edit your layout without a mouse.
-   **Markdown**: Add markdown content to your layout with automatic input completion for headers, lists, bold, italic, etc.
-   **Customization**: Customize the layout by changing font, background color, and more. All settings affect all the pages of the layout.
- **File system**: Save your layouts as json files (.broco for convenience) to edit them later. You can choose to contain all the assets in the file as binaries or use file references.
-   **Export**: Download your layouts in different formats or publish them online as flipbooks.

## Keyboard controls

BROCO features a powerful, keyboard-first layout engine that allows for rapid reorganization without a mouse. 
You can find a list of all the keyboard shortcuts in [shortcuts.md](public/assets/shortcuts.md).

## App

The github pages website is a demo that does not allow exporting layouts (but you can still save them as .brocofiles). Please have a looks at the releases for the full electron app.


## Getting started contributing to the app

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Tests
npm run test

# Build for Desktop (Windows .exe)
npm run electron:build
```
