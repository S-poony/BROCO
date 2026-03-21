import { test, expect } from '@playwright/test';

test.describe('Presentation Mode', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5173');
        await page.waitForSelector('#rect-1');
    });

    test('should enter presentation mode on button click', async ({ page }) => {
        const presentBtn = page.locator('#fullscreen-btn');
        await presentBtn.click();

        // Check if body has presentation-mode class
        await expect(page.locator('body')).toHaveClass(/presentation-mode/);

        // Check overlay exists
        const overlay = page.locator('#presentation-overlay');
        await expect(overlay).toBeVisible();

        // Check sidebars and toolbars are hidden natively via CSS Overrides
        await expect(page.locator('.file-actions')).toBeHidden();
        await expect(page.locator('#left-sidebars-container')).toBeHidden();
    });

    test('should navigate slides using arrow keys and overlay clicks', async ({ page }) => {
        // Add a second page natively via UI
        await page.locator('#add-page-btn').click();
        
        // Ensure there are 2 pages
        await expect(page.locator('.page-thumbnail-item')).toHaveCount(2);

        // Since we just clicked "add page", we are automatically on page index 1
        await expect(page.locator('.page-thumbnail-item').nth(1)).toHaveClass(/active/);

        // Start presentation
        await page.locator('#fullscreen-btn').click();
        await expect(page.locator('body')).toHaveClass(/presentation-mode/);

        // Press Left to go to page 0
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('.page-thumbnail-item').nth(0)).toHaveClass(/active/);

        // Click on the overlay to forcefully advance to the next slide (page 1)
        const overlay = page.locator('#presentation-overlay');
        await overlay.click({ position: { x: 100, y: 100 } });
        await expect(page.locator('.page-thumbnail-item').nth(1)).toHaveClass(/active/);
        
        // Press Escape to exit Playwright's emulated Fullscreen
        await page.keyboard.press('Escape');

        // Verify exit is successful
        await expect(page.locator('body')).not.toHaveClass(/presentation-mode/);
    });

    test('should block layout edits', async ({ page }) => {
        await page.locator('#fullscreen-btn').click();
        await expect(page.locator('body')).toHaveClass(/presentation-mode/);

        // Normally clicking a rect splits it. With overlay, it should be intercepted.
        const overlay = page.locator('#presentation-overlay');
        
        // Click on coordinates that would otherwise hit #rect-1 natively.
        // It hits the overlay instead, attempting to go next (fails safe since it's 1 page).
        await overlay.click({ position: { x: 10, y: 10 } });

        // Verify we still have exactly 1 unsplit rect -- no layout changes occurred!
        await expect(page.locator('.splittable-rect[data-split-state="unsplit"]')).toHaveCount(1);
    });
});
