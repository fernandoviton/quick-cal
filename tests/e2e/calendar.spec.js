const { test, expect } = require('./fixtures');

// Three consecutive days in next month, so they're always in the future and
// on the visible grid after clicking "next".
function nextMonthDays() {
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const iso = n => `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    return [iso(10), iso(11), iso(12)];
}

const day = (page, iso) => page.locator(`.qc-day[data-day="${iso}"]`);

async function createCalendar(page, title = 'Ski trip', name = 'Sam') {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/');
    await page.fill('#createTitle', title);
    await page.fill('#createName', name);
    await page.click('button[type=submit]');
    await expect(page.locator('.qc-title')).toHaveText(title);
}

// Simulates a different person on the same (mock) backend by dropping this
// browser's identities but keeping the shared localStorage database.
async function becomeStranger(page) {
    await page.evaluate(() => localStorage.removeItem('quickcal_identities'));
    await page.reload();
}

test.describe('Quick Cal', () => {
    let errors;
    test.beforeEach(({ page }) => {
        errors = [];
        page.on('pageerror', err => errors.push(err.message));
    });
    test.afterEach(() => expect(errors).toEqual([]));

    test('create a calendar and paint days', async ({ page }) => {
        await createCalendar(page);
        expect(page.url()).toMatch(/#c=[A-Za-z0-9_-]{22}$/);
        await expect(page.locator('.qc-identity')).toContainText('Sam');
        await expect(page.locator('.qc-members li')).toHaveCount(1);

        const [d1, d2, d3] = nextMonthDays();
        await page.click('[data-action=next]');

        // Tap marks, tap again clears.
        await day(page, d1).click();
        await expect(day(page, d1)).toHaveClass(/mine-yes/);
        await expect(day(page, d1).locator('.qc-count')).toHaveText('1/1');
        await day(page, d1).click();
        await expect(day(page, d1)).not.toHaveClass(/mine-yes/);

        // Drag across three days in "maybe" mode.
        await page.click('[data-paint=maybe]');
        const a = await day(page, d1).boundingBox();
        const c = await day(page, d3).boundingBox();
        await page.mouse.move(a.x + 10, a.y + 10);
        await page.mouse.down();
        await page.mouse.move(c.x + 10, c.y + 10, { steps: 5 });
        await page.mouse.up();
        for (const d of [d1, d2, d3]) await expect(day(page, d)).toHaveClass(/mine-maybe/);

        // Persists across reload.
        await page.reload();
        await page.click('[data-action=next]');
        await expect(day(page, d2)).toHaveClass(/mine-maybe/);
        await expect(page.locator('#qcBest li')).toHaveCount(3);
    });

    test('keyboard can mark a day', async ({ page }) => {
        await createCalendar(page);
        const [d1] = nextMonthDays();
        await page.click('[data-action=next]');
        await day(page, d1).focus();
        await page.keyboard.press('Enter');
        await expect(day(page, d1)).toHaveClass(/mine-yes/);
    });

    test('a friend joins from the invite link and both show up', async ({ page }) => {
        await createCalendar(page);
        const [d1] = nextMonthDays();
        await page.click('[data-action=next]');
        await day(page, d1).click();
        await expect(day(page, d1)).toHaveClass(/mine-yes/);

        await page.click('[data-action=copy-invite]');
        const invite = await page.evaluate(() => navigator.clipboard.readText());
        expect(invite).toBe(page.url());

        await becomeStranger(page);
        // Viewers can look but not paint.
        await expect(page.locator('#joinForm')).toBeVisible();
        await expect(page.locator('.qc-paint')).toHaveCount(0);
        await page.click('[data-action=next]');
        await day(page, d1).click();
        await expect(day(page, d1)).not.toHaveClass(/mine-/);
        await expect(page.locator('#qcDetail')).toContainText('Sam');

        await page.fill('#joinName', 'Alex');
        await page.click('#joinForm button[type=submit]');
        await expect(page.locator('.qc-identity')).toContainText('Alex');
        await expect(page.locator('#qcAdmin')).toBeEmpty();

        await day(page, d1).click();
        await expect(day(page, d1).locator('.qc-count')).toHaveText('2/2');
        await expect(day(page, d1).locator('.qc-star')).toHaveCount(1);
        await expect(page.locator('#qcDetail h3.yes')).toHaveText('Available (2)');
    });

    test('personal link restores identity on another device and is stripped from the URL', async ({ page }) => {
        await createCalendar(page);
        await page.click('[data-action=copy-personal]');
        const personal = await page.evaluate(() => navigator.clipboard.readText());
        expect(personal).toMatch(/&me=/);
        const invite = page.url();

        await becomeStranger(page);
        await expect(page.locator('#joinForm')).toBeVisible();
        await page.goto(personal);
        await expect(page.locator('.qc-identity')).toContainText('Sam');
        expect(page.url()).toBe(invite);
    });

    test('organizer can remove people and delete the calendar', async ({ page }) => {
        await createCalendar(page);
        const identities = await page.evaluate(() => localStorage.getItem('quickcal_identities'));

        await becomeStranger(page);
        await page.fill('#joinName', 'Spammer');
        await page.click('#joinForm button[type=submit]');
        await expect(page.locator('.qc-members li')).toHaveCount(2);

        await page.evaluate(v => localStorage.setItem('quickcal_identities', v), identities);
        await page.reload();
        await page.click('.qc-admin summary');
        await page.click('[data-remove]');
        await page.click('.modal button[type=submit]');
        await expect(page.locator('.qc-members li')).toHaveCount(1);

        const url = page.url();
        await page.click('[data-action=delete-cal]');
        await page.click('.modal button[type=submit]');
        await expect(page.locator('#createForm')).toBeVisible();
        await page.goto(url);
        await expect(page.locator('h1')).toHaveText('Can\'t open this calendar');
    });

    test('unknown links show an error', async ({ page }) => {
        await page.goto('/#c=AAAAAAAAAAAAAAAAAAAAAA');
        await expect(page.locator('h1')).toHaveText('Can\'t open this calendar');
    });
});
