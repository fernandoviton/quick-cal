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

const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Thu..Tue around the first weekend in next month that has its Thursday in next month too.
function nextMonthWeekend() {
    const now = new Date();
    const sat = new Date(now.getFullYear(), now.getMonth() + 1, 4);
    while (sat.getDay() !== 6) sat.setDate(sat.getDate() + 1);
    const at = n => isoOf(new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + n));
    return { thu: at(-2), fri: at(-1), sat: at(0), sun: at(1), mon: at(2), tue: at(3) };
}

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

    test('create a calendar and block out days', async ({ page }) => {
        await createCalendar(page);
        expect(page.url()).toMatch(/#c=[A-Za-z0-9_-]{22}$/);
        await expect(page.locator('.qc-identity')).toContainText('Sam');
        await expect(page.locator('.qc-members li')).toHaveCount(1);

        const [d1, d2, d3] = nextMonthDays();
        await page.click('[data-action=next]');

        // Unmarked days count as free, so there's no count on them.
        await expect(day(page, d1).locator('.qc-count')).toHaveCount(0);
        // Tap marks busy, tap again clears.
        await day(page, d1).click();
        await expect(day(page, d1)).toHaveClass(/mine-busy/);
        await expect(day(page, d1).locator('.qc-count')).toHaveText('0/1');
        await day(page, d1).click();
        await expect(day(page, d1)).not.toHaveClass(/mine-busy/);
        await expect(day(page, d1).locator('.qc-count')).toHaveCount(0);

        // Drag across three days.
        const a = await day(page, d1).boundingBox();
        const c = await day(page, d3).boundingBox();
        await page.mouse.move(a.x + 10, a.y + 10);
        await page.mouse.down();
        await page.mouse.move(c.x + 10, c.y + 10, { steps: 5 });
        await page.mouse.up();
        for (const d of [d1, d2, d3]) await expect(day(page, d)).toHaveClass(/mine-busy/);
        // Only Busy and Free are offered.
        await expect(page.locator('#qcToolbar [data-paint]')).toHaveCount(2);

        // Persists across reload.
        await page.reload();
        await page.click('[data-action=next]');
        await expect(day(page, d2)).toHaveClass(/mine-busy/);

        // The API still accepts "maybe", but the app ignores those rows: the day counts as free.
        await page.evaluate(async d => {
            const token = location.hash.slice(3);
            const me = JSON.parse(localStorage.getItem('quickcal_identities'))[token];
            await CalApi.call('set_days', { p_token: token, p_member_id: me.memberId, p_member_key: me.memberKey, p_days: [d], p_status: 'maybe' });
        }, d1);
        await page.reload();
        await page.click('[data-action=next]');
        await expect(day(page, d2)).toHaveClass(/mine-busy/);
        await expect(day(page, d1)).not.toHaveClass(/mine-/);
        await expect(day(page, d1).locator('.qc-count')).toHaveCount(0);
    });

    test('dates that work: required weekdays and days in a row', async ({ page }) => {
        await createCalendar(page);
        const w = nextMonthWeekend();
        const range = (a, b) => page.locator(`#qcBest [data-goto-range="${a}|${b}"]`);
        const weekday = name => page.locator('.qc-wd', { hasText: name });
        await page.click('[data-action=next]');

        // Defaults: Sat + Sun, 4 days in a row. Thu–Sun, Fri–Mon and Sat–Tue
        // all fit, so they show as one Thu–Tue result.
        await expect(page.locator('.qc-wd input:checked')).toHaveCount(2);
        await expect(page.locator('#findLen')).toHaveValue('4');
        await expect(range(w.thu, w.tue).locator('..')).toContainText('6 days free');

        // Busy Thursday and Tuesday leave exactly Fri–Mon.
        await day(page, w.thu).click();
        await day(page, w.tue).click();
        await expect(range(w.fri, w.mon).locator('..')).toContainText('4 days');
        await range(w.fri, w.mon).click();
        await expect(page.locator('.qc-day.highlight')).toHaveCount(4);

        // Require Fri and Mon too: Fri–Mon still fits in 4 days, not in 3.
        await weekday('Fri').click();
        await weekday('Mon').click();
        await expect(range(w.fri, w.mon)).toBeVisible();
        await page.selectOption('#findLen', '3');
        await expect(page.locator('#qcBest')).toContainText('can\'t include all the checked days');

        // A busy Monday blocks the weekend too.
        await page.selectOption('#findLen', '4');
        await day(page, w.mon).click();
        await expect(page.locator(`#qcBest [data-goto-range*="${w.fri}"]`)).toHaveCount(0);

        // Settings are remembered on this device.
        await page.reload();
        await expect(page.locator('.qc-wd input:checked')).toHaveCount(4);
        await expect(page.locator('#findLen')).toHaveValue('4');
    });

    test('keyboard can mark a day', async ({ page }) => {
        await createCalendar(page);
        const [d1] = nextMonthDays();
        await page.click('[data-action=next]');
        await day(page, d1).focus();
        await page.keyboard.press('Enter');
        await expect(day(page, d1)).toHaveClass(/mine-busy/);
    });

    test('a friend joins from the invite link and both show up', async ({ page }) => {
        await createCalendar(page);
        const [d1] = nextMonthDays();
        await page.click('[data-action=next]');
        await day(page, d1).click();
        await expect(day(page, d1)).toHaveClass(/mine-busy/);

        await page.click('[data-action=copy-invite]');
        const invite = await page.evaluate(() => navigator.clipboard.readText());
        expect(invite).toBe(page.url());

        await becomeStranger(page);
        // Viewers can look but not paint.
        await expect(page.locator('#joinForm')).toBeVisible();
        await expect(page.locator('#qcToolbar .qc-paint')).toHaveCount(0);
        // Privacy explainer is collapsed under the join form.
        const privacy = page.locator('#joinForm .qc-join-privacy');
        await expect(privacy.locator('summary')).toContainText('Everyone with this link sees the name you pick');
        await expect(privacy.locator('li').first()).toBeHidden();
        await privacy.locator('summary').click();
        await expect(privacy.locator('li').first()).toContainText('There are no accounts');
        await page.click('[data-action=next]');
        await day(page, d1).click();
        await expect(day(page, d1)).not.toHaveClass(/mine-/);
        await expect(page.locator('#qcDetail h3.busy')).toHaveText('Busy (1)');
        await expect(page.locator('#qcDetail')).toContainText('Sam');

        await page.fill('#joinName', 'Alex');
        await page.click('#joinForm button[type=submit]');
        await expect(page.locator('.qc-identity')).toContainText('Alex');
        await expect(page.locator('#qcAdmin')).toBeEmpty();

        await expect(page.locator('.qc-members')).toContainText('nothing blocked yet');
        await expect(page.locator('.qc-note')).toContainText('Alex hasn\'t blocked any days yet');
        // Alex hasn't blocked anything, so they count as free on Sam's busy day.
        await expect(day(page, d1).locator('.qc-count')).toHaveText('1/2');
        await day(page, d1).click();
        await expect(day(page, d1)).toHaveClass(/mine-busy/);
        await expect(day(page, d1).locator('.qc-count')).toHaveText('0/2');
        await expect(page.locator('#qcDetail h3.busy')).toHaveText('Busy (2)');
        await expect(page.locator('.qc-members')).not.toContainText('nothing blocked yet');

        const [, d2] = nextMonthDays();
        await page.click('[data-paint=clear]');
        await day(page, d2).click();
        await expect(page.locator('#qcDetail h3.free')).toHaveText('Free (2)');
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
