import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Asset Rehydration Error Handling', () => {
    const fakeLayoutPath = path.join(__dirname, 'fake_layout_error_test.broco');

    test.beforeAll(() => {
        // Create a mocked layout structure containing a forced missing reference.
        // Opening this in standard Chromium triggers the "Web mode" failure state
        // instantly due to the lack of Electron IPC privileges.
        const fakeLayout = {
            version: '1.0',
            pages: [
                {
                    id: 'page_1',
                    layout: { type: 'rect', id: 'rect-1', isImage: true, assetId: 'fake-asset-123' }
                }
            ],
            currentPageIndex: 0,
            currentId: 1,
            assets: [
                {
                    id: 'fake-asset-123',
                    name: 'missing_image.jpg',
                    isReference: true,
                    absolutePath: 'C:\\totally\\fake\\missing_image.jpg',
                    fullResData: null,
                    lowResData: null
                }
            ]
        };
        fs.writeFileSync(fakeLayoutPath, JSON.stringify(fakeLayout));
    });

    test.afterAll(() => {
        // Cleanup the mocked layout payload
        if (fs.existsSync(fakeLayoutPath)) {
            fs.unlinkSync(fakeLayoutPath);
        }
    });

    test('should show toast error when linked asset fails to load', async ({ page }) => {
        await page.goto('http://localhost:5173');
        await page.waitForSelector('#rect-1');

        // Playwright listens for Javascript programmatic clicks on `<input type="file">`
        const fileChooserPromise = page.waitForEvent('filechooser');
        
        await page.locator('#open-layout-btn').click();

        const fileChooser = await fileChooserPromise;
        // Inject our heavily modified mock payload
        await fileChooser.setFiles(fakeLayoutPath);

        // Verify the layout was partially accepted via the success toast
        // (This verifies the processData function ran successfully)
        await expect(page.locator('.toast.toast-success')).toHaveCount(1);
        
        // Critically, we MUST assert that the newly piped Promise.all() block triggers 
        // the specialized Failure Toast for the 1 dead image node directly!
        const errorToast = page.locator('.toast.toast-error');
        await expect(errorToast).toBeVisible({ timeout: 5000 });
        await expect(errorToast).toContainText('Failed to load 1 linked asset(s)');
    });
});
