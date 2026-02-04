import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    // Mock Electron API for testing in standard browser
    await page.addInitScript(() => {
        window.electronAPI = {
            isElectron: true,
            renderExport: async () => ({ success: true, data: new Uint8Array([1, 2, 3]) }),
            saveFileDialog: async () => ({ success: true }),
        };
    });
});

test('export layout modal opens and triggers download', async ({ page }) => {
    await page.goto('/');

    // 1. Check if the page loads
    await expect(page).toHaveTitle(/BROCO/);

    // 2. Open Export Modal
    const exportBtn = page.locator('#export-layout-btn');
    await exportBtn.click();

    const modal = page.locator('#export-modal');
    await expect(modal).toHaveClass(/active/);

    // 3. Confirm Export (Download)
    const confirmBtn = page.locator('#confirm-export');
    await page.locator('#export-format-select').selectOption('png');

    // Prepare to catch the download event
    const downloadPromise = page.waitForEvent('download');

    await confirmBtn.click();

    // 4. Verify download started
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/layout-export-.*\.png/);

    // 5. Verify modal closed
    await expect(modal).not.toHaveClass(/active/);
});

test('export format selection works', async ({ page }) => {
    await page.goto('/');

    await page.locator('#export-layout-btn').click();

    // Select JPEG
    await page.locator('#export-format-select').selectOption('jpeg');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#confirm-export').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/layout-export-.*\.jpg/);
});
