// Shared test fixtures — forces mock mode for E2E tests
const base = require('@playwright/test');

// Extend the base test to inject mock CONFIG before every page load.
// This overrides config.local.js so tests always run in localStorage mock mode.
exports.test = base.test.extend({
    page: async ({ page, context }, use) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8000' });
        await page.addInitScript(() => {
            window.CONFIG = {
                SUPABASE_URL: null,
                SUPABASE_PUBLISHABLE_KEY: null,
                APP_TITLE: 'Quick Cal'
            };
        });
        await use(page);
    }
});

exports.expect = base.expect;
