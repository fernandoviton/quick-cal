const { test, expect } = require('./fixtures');

test.describe('Header', () => {
    test('shows app title', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.header-title')).toContainText('Listlet');
    });

    test('shows mock user email', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.header-email')).toContainText('local@mock');
    });

    test('has home button', async ({ page }) => {
        await page.goto('/?list=test');
        await expect(page.locator('.header-home-btn')).toBeVisible();
    });

    test('has logout button', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#logoutBtn')).toBeVisible();
    });
});
