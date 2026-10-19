const { test, expect } = require('./fixtures');

test.describe('Auth', () => {
    test('mock mode bypasses login and shows app', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        await page.goto('/');
        // In mock mode, login page should be hidden, app container visible
        await expect(page.locator('#app-container')).toBeVisible();
        await expect(page.locator('#login-page')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('login page has Google sign-in button', async ({ page }) => {
        await page.goto('/');
        // Button exists in DOM even if hidden in mock mode
        await expect(page.locator('#googleLoginBtn')).toBeAttached();
    });

    test('header is rendered after auth', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.header-bar')).toBeVisible();
    });
});
