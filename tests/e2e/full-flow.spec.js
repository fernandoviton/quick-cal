const { test, expect } = require('./fixtures');

test.describe('Full flow', () => {
    test('auth -> home -> create -> edit -> back to home', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        // Clear state
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());

        // 1. Start at home (mock auth bypassed)
        await page.goto('/');
        await expect(page.locator('#app-container')).toBeVisible();
        await expect(page.locator('.header-bar')).toBeVisible();
        await expect(page.locator('#createListBtn')).toBeVisible();

        // 2. Create new list
        await page.click('#createListBtn');
        await page.waitForURL(/\?list=/);

        // 3. Should see the table editor
        await expect(page.locator('#addRowBtn')).toBeVisible();

        // 4. Add a row and type something
        await page.click('#addRowBtn');
        const input = page.locator('.table-input').first();
        await input.fill('Full flow test');
        await page.waitForTimeout(600); // debounce save

        // 5. Navigate home
        await page.click('.header-home-btn');
        await page.waitForURL(url => !url.search.includes('list='));

        // 6. Home should show the list we created
        await expect(page.locator('.home-list-item')).toHaveCount(1);

        // 7. Click the list to go back
        await page.click('.home-list-item a');
        await page.waitForURL(/\?list=/);

        // 8. Data should persist
        await expect(page.locator('.table-input').first()).toHaveValue('Full flow test');

        expect(errors).toEqual([]);
    });
});
