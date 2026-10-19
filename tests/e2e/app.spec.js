const { test, expect } = require('./fixtures');

test.describe('Table editor', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await page.goto('/?list=test-table');
    });

    test('shows add row button', async ({ page }) => {
        await expect(page.locator('#addRowBtn')).toBeVisible();
    });

    test('add row creates an editable input', async ({ page }) => {
        await page.click('#addRowBtn');
        await expect(page.locator('.table-input')).toBeVisible();
    });

    test('edit row text persists', async ({ page }) => {
        await page.click('#addRowBtn');
        const input = page.locator('.table-input').first();
        await input.fill('Hello world');
        // Wait for debounced save
        await page.waitForTimeout(600);

        // Reload and check persistence
        await page.goto('/?list=test-table');
        await expect(page.locator('.table-input').first()).toHaveValue('Hello world');
    });

    test('delete row removes it', async ({ page }) => {
        await page.click('#addRowBtn');
        await expect(page.locator('.table-input')).toHaveCount(1);

        await page.click('.delete-btn');
        await expect(page.locator('.table-input')).toHaveCount(0);
    });

    test('multiple rows work', async ({ page }) => {
        await page.click('#addRowBtn');
        await page.click('#addRowBtn');
        await page.click('#addRowBtn');
        await expect(page.locator('.table-input')).toHaveCount(3);
    });

    test('no console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        await page.goto('/?list=console-test');
        await page.click('#addRowBtn');
        expect(errors).toEqual([]);
    });
});
