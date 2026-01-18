import { test, expect } from '@playwright/test';

test.describe('Assets Management Regression Tests', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5173');
    });

    test('should import an asset', async ({ page }) => {
        // Mock a file input to import an image
        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.click('#import-assets-btn'),
        ]);

        await fileChooser.setFiles([{
            name: 'test-image.png',
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
        }]);

        // Verify asset appears in the list
        const assetItem = page.locator('#asset-list .asset-item');
        await expect(assetItem).toBeVisible();
        await expect(assetItem.locator('img')).toHaveAttribute('alt', 'test-image.png');
    });

    test('should drag and drop asset into layout', async ({ page }) => {
        // 1. Import asset
        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.click('#import-assets-btn'),
        ]);
        await fileChooser.setFiles([{
            name: 'test-image.png',
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
        }]);

        const assetItem = page.locator('#asset-list .asset-item').first();
        const targetRect = page.locator('#rect-1');

        // 2. Drag and drop
        await assetItem.dragTo(targetRect);

        // 3. Verify image is in layout
        const layoutImg = targetRect.locator('img');
        await expect(layoutImg).toBeVisible();
        await expect(layoutImg).toHaveAttribute('data-asset-id', /asset-.+/);
    });

    test('should remove image from layout by clicking X', async ({ page }) => {
        // 1. Import and drag
        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.click('#import-assets-btn'),
        ]);
        await fileChooser.setFiles([{
            name: 'test-image.png',
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
        }]);
        await page.locator('#asset-list .asset-item').first().dragTo(page.locator('#rect-1'));

        // 2. Click X on the layout image
        const removeBtn = page.locator('.remove-image-btn');
        await removeBtn.click();

        // 3. Verify image is gone from layout but still in sidebar
        await expect(page.locator('#rect-1 img')).not.toBeVisible();
        await expect(page.locator('#asset-list .asset-item')).toBeVisible();
    });

    test('should remove asset from sidebar', async ({ page }) => {
        // 1. Import asset
        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.click('#import-assets-btn'),
        ]);
        await fileChooser.setFiles([{
            name: 'test-image.png',
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
        }]);

        const assetItem = page.locator('#asset-list .asset-item');

        // 2. Hover to show actions and click remove
        await assetItem.hover();
        await assetItem.locator('.remove').click();

        // 3. Confirm in modal
        await page.click('#confirm-ok');

        // 4. Verify gone from sidebar
        await expect(assetItem).not.toBeVisible();
    });
});
