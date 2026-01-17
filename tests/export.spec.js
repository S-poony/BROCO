import { test, expect } from '@playwright/test';

test('export layout modal opens and triggers download', async ({ page }) => {
    await page.goto('/');

    // 1. Check if the page loads
    await expect(page.locator('h1')).toContainText('Interactive Document Layout');

    // 2. Open Export Modal
    const exportBtn = page.locator('#export-layout-btn');
    await exportBtn.click();

    const modal = page.locator('#export-modal');
    await expect(modal).toHaveClass(/active/);

    // 3. Confirm Export (Download)
    const confirmBtn = page.locator('#confirm-export');

    // Prepare to catch the download event
    const downloadPromise = page.waitForEvent('download');

    await confirmBtn.click();

    // 4. Verify download started
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/layout-export-.*\.zip/);

    // 5. Verify modal closed
    await expect(modal).not.toHaveClass(/active/);
});

test('export format selection works', async ({ page }) => {
    await page.goto('/');

    await page.locator('#export-layout-btn').click();

    // Select JPEG
    await page.locator('input[value="jpeg"]').click();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#confirm-export').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/layout-export-.*\.zip/);
});
