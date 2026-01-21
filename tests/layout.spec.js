import { test, expect } from '@playwright/test';

test.describe('Layout Operations', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5173');
        // Wait for initial render
        await page.waitForSelector('#rect-1');
    });

    test.describe('Splitting', () => {
        test('should split rectangle horizontally on click', async ({ page }) => {
            const rect = page.locator('#rect-1');

            // Click to split (default is horizontal on first click)
            await rect.click();

            // Should now have two child rectangles
            await expect(page.locator('#rect-1').locator('.splittable-rect')).toHaveCount(2);

            // Parent should be marked as split
            await expect(rect).toHaveAttribute('data-split-state', 'split');
        });

        test('should split rectangle vertically with Alt+Click', async ({ page }) => {
            const rect = page.locator('#rect-1');

            // Alt+click for vertical split
            await rect.click({ modifiers: ['Alt'] });

            // Check orientation (should have flex-row for vertical split)
            await expect(rect).toHaveClass(/flex-row/);
            await expect(page.locator('#rect-1').locator('.splittable-rect')).toHaveCount(2);
        });

        test('should split nested rectangles', async ({ page }) => {
            // Split first rect
            await page.locator('#rect-1').click();

            // Get the first child and split it too
            const firstChild = page.locator('#rect-1 > .splittable-rect').first();
            await firstChild.click();

            // Should now have 3 leaf rectangles total (1 from first split, 2 from nested split)
            const leafRects = page.locator('.splittable-rect[data-split-state="unsplit"]');
            await expect(leafRects).toHaveCount(3);
        });
    });

    test.describe('Deleting', () => {
        test('should delete rectangle with Ctrl+Click', async ({ page }) => {
            // First split to have something to delete
            await page.locator('#rect-1').click();

            // Get child rectangles
            const children = page.locator('#rect-1 > .splittable-rect');
            await expect(children).toHaveCount(2);

            // Ctrl+click the first child to delete it
            const firstChild = children.first();
            await firstChild.click({ modifiers: ['Control'] });

            // Parent should collapse back to unsplit state
            await expect(page.locator('#rect-1')).toHaveAttribute('data-split-state', 'unsplit');
        });
    });

    test.describe('Divider Resizing', () => {
        test('should resize sections by dragging divider', async ({ page }) => {
            // Split to create a divider
            await page.locator('#rect-1').click();

            const divider = page.locator('.divider').first();
            await expect(divider).toBeVisible();

            // Get initial positions
            const children = page.locator('#rect-1 > .splittable-rect');
            const firstChildBefore = await children.first().boundingBox();

            // Drag the divider
            const dividerBox = await divider.boundingBox();
            if (dividerBox && firstChildBefore) {
                await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2);
                await page.mouse.down();
                await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + 50); // Move down 50px
                await page.mouse.up();
            }

            // Verify resize happened (first child should be bigger)
            const firstChildAfter = await children.first().boundingBox();
            expect(firstChildAfter?.height).toBeGreaterThan(firstChildBefore?.height ?? 0);
        });
    });

    test.describe('Edge Splitting', () => {
        test.skip('should create new section by dragging from edge', async ({ page }) => {
            const paper = page.locator('#a4-paper');

            // Find top edge handle
            const topEdge = page.locator('.edge-top');
            await expect(topEdge).toBeVisible();

            // Drag from edge inward
            const edgeBox = await topEdge.boundingBox();
            if (edgeBox) {
                await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2);
                await page.mouse.down();
                await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + 100); // Drag down
                await page.mouse.up();
            }

            // Should now have split root
            await expect(page.locator('#rect-1')).toHaveAttribute('data-split-state', 'split');
        });
    });
});

test.describe('Multi-Page Operations', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5173');
    });

    test('should add a new page', async ({ page }) => {
        const addPageBtn = page.locator('#add-page-btn');
        const pagesList = page.locator('#pages-list');

        // Initially should have 1 page thumbnail
        await expect(pagesList.locator('.page-thumbnail-item')).toHaveCount(1);

        // Add a page
        await addPageBtn.click();

        // Should now have 2 thumbnails
        await expect(pagesList.locator('.page-thumbnail-item')).toHaveCount(2);
    });

    test('should switch between pages', async ({ page }) => {
        // Add a second page
        await page.locator('#add-page-btn').click();

        // Modify second page (split it)
        await page.locator('#a4-paper .splittable-rect[data-split-state="unsplit"]').first().click();

        // Switch to first page
        await page.locator('.page-thumbnail-item').first().click();

        // First page should still be unsplit
        await expect(page.locator('#a4-paper > .splittable-rect').first()).toHaveAttribute('data-split-state', 'unsplit');

        // Switch back to second page
        await page.locator('.page-thumbnail-item').nth(1).click();

        // Second page should be split
        await expect(page.locator('#a4-paper > .splittable-rect').first()).toHaveAttribute('data-split-state', 'split');
    });

    test('should delete a page', async ({ page }) => {
        // Add a second page
        await page.locator('#add-page-btn').click();
        await expect(page.locator('#pages-list .page-thumbnail-item')).toHaveCount(2);

        // Hover over first thumbnail to show delete button
        const firstThumbnail = page.locator('.page-thumbnail-item').first();
        await firstThumbnail.hover();

        // Click delete
        await firstThumbnail.locator('.delete-page-btn').click();

        // Confirm deletion
        await page.locator('#confirm-ok').click();

        // Should now have 1 page
        await expect(page.locator('#pages-list .page-thumbnail-item')).toHaveCount(1);
    });
});
