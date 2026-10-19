const { test, expect } = require('./fixtures');

test.describe('Home page', () => {
    test.beforeEach(async ({ page }) => {
        // Clear localStorage
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await page.goto('/');
    });

    test('shows create list button', async ({ page }) => {
        await expect(page.locator('#createListBtn')).toBeVisible();
    });

    test('shows open by name input', async ({ page }) => {
        await expect(page.locator('#openListInput')).toBeVisible();
        await expect(page.locator('#openListBtn')).toBeVisible();
    });

    test('shows empty state when no lists', async ({ page }) => {
        await expect(page.locator('.home-empty')).toBeVisible();
    });

    test('create list navigates to new list', async ({ page }) => {
        await page.click('#createListBtn');
        await page.waitForURL(/\?list=/);
        expect(page.url()).toContain('?list=');
    });

    test('open by name navigates correctly', async ({ page }) => {
        await page.fill('#openListInput', 'mytest');
        await page.click('#openListBtn');
        await page.waitForURL(/\?list=mytest/);
        expect(page.url()).toContain('?list=mytest');
    });

    test('open by name works with Enter key', async ({ page }) => {
        await page.fill('#openListInput', 'entertest');
        await page.press('#openListInput', 'Enter');
        await page.waitForURL(/\?list=entertest/);
    });

    test('shows item count next to list name', async ({ page }) => {
        // Create a list with items
        await page.goto('/?list=counttest');
        await page.click('#addRowBtn');
        await page.click('#addRowBtn');
        await page.waitForTimeout(200);

        // Go home
        await page.goto('/');
        const listItem = page.locator('.home-list-item', { hasText: 'counttest' });
        await expect(listItem).toBeVisible();
        await expect(listItem).toContainText('2 items');
    });
});
