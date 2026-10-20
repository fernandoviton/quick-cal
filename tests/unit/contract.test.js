// Runs the same API contract against the localStorage mock and the real SQL
// (sql/setup.sql loaded into PGlite, called as Supabase's `anon` role), so the
// mock can't drift from the backend.
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

global.CalUtil = require('../../cal-util');
const { createMockBackend } = require('../../cal-api');

const SQL = fs.readFileSync(path.join(__dirname, '../../sql/setup.sql'), 'utf8');

// SQL types for each RPC argument; everything else is text.
const ARG_TYPES = { p_member_id: 'uuid', p_days: 'date[]' };

function memoryStorage() {
    const data = {};
    return {
        getItem: k => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); }
    };
}

async function pgBackend() {
    const db = new PGlite();
    // Stand-ins for what Supabase provides.
    await db.exec(`
        create role anon; create role authenticated;
    `);
    await db.exec(SQL);
    await db.exec('set role anon');
    return {
        db,
        call: async (name, args) => {
            const keys = Object.keys(args || {});
            const params = keys.map((k, i) => `${k} => $${i + 1}::${ARG_TYPES[k] || 'text'}`);
            try {
                const res = await db.query(`select public.quickcal_${name}(${params.join(', ')}) as r`, keys.map(k => args[k]));
                return res.rows[0].r === undefined ? null : res.rows[0].r;
            } catch (e) {
                const err = new Error(e.message);
                err.code = e.message;
                throw err;
            }
        }
    };
}

const secret = () => CalUtil.randomSecret();
const today = CalUtil.toIso(new Date());

describe.each([
    ['mock', async () => createMockBackend(memoryStorage())],
    ['postgres', pgBackend]
])('contract (%s)', (label, makeBackend) => {
    let api, token, adminKey;

    beforeEach(async () => {
        api = await makeBackend();
        token = secret();
        adminKey = secret();
        await api.call('create', { p_token: token, p_admin_key: adminKey, p_title: '  Ski trip  ' });
    });

    afterEach(async () => {
        if (api.db) await api.db.close();
    });

    test('new calendar is empty with trimmed title', async () => {
        const cal = await api.call('get', { p_token: token });
        expect(cal.title).toBe('Ski trip');
        expect(cal.members).toEqual([]);
        expect(cal.availability).toEqual([]);
        expect(typeof cal.updated_at).toBe('string');
        expect(await api.call('version', { p_token: token })).toBe(cal.updated_at);
    });

    test('unknown or malformed tokens are rejected', async () => {
        await expect(api.call('get', { p_token: secret() })).rejects.toMatchObject({ code: 'not_found' });
        await expect(api.call('get', { p_token: 'short' })).rejects.toMatchObject({ code: 'invalid_token' });
        await expect(api.call('create', { p_token: 'weak', p_admin_key: secret(), p_title: 'x' }))
            .rejects.toMatchObject({ code: 'invalid_token' });
    });

    test('titles and names are validated', async () => {
        await expect(api.call('create', { p_token: secret(), p_admin_key: secret(), p_title: '   ' }))
            .rejects.toMatchObject({ code: 'invalid_name' });
        await expect(api.call('join', { p_token: token, p_name: 'x'.repeat(41), p_member_key: secret() }))
            .rejects.toMatchObject({ code: 'invalid_name' });
    });

    test('join, set, change and clear days', async () => {
        const key = secret();
        const id = await api.call('join', { p_token: token, p_name: 'Sam', p_member_key: key });
        const before = await api.call('version', { p_token: token });
        const d1 = CalUtil.addDays(today, 3);
        const d2 = CalUtil.addDays(today, 4);

        await api.call('set_days', { p_token: token, p_member_id: id, p_member_key: key, p_days: [d1, d2, d1], p_status: 'busy' });
        await api.call('set_days', { p_token: token, p_member_id: id, p_member_key: key, p_days: [d2], p_status: 'maybe' });
        let cal = await api.call('get', { p_token: token });
        expect(cal.members).toEqual([{ id, name: 'Sam' }]);
        expect(cal.availability).toEqual([
            { member_id: id, day: d1, status: 'busy' },
            { member_id: id, day: d2, status: 'maybe' }
        ]);
        expect(cal.updated_at).not.toBe(before);

        await api.call('set_days', { p_token: token, p_member_id: id, p_member_key: key, p_days: [d1], p_status: null });
        cal = await api.call('get', { p_token: token });
        expect(cal.availability).toEqual([{ member_id: id, day: d2, status: 'maybe' }]);
    });

    test('members cannot edit each other', async () => {
        const aliceKey = secret();
        const alice = await api.call('join', { p_token: token, p_name: 'Alice', p_member_key: aliceKey });
        const bobKey = secret();
        await api.call('join', { p_token: token, p_name: 'Bob', p_member_key: bobKey });

        const args = { p_token: token, p_member_id: alice, p_member_key: bobKey, p_days: [today], p_status: 'busy' };
        await expect(api.call('set_days', args)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(api.call('rename_member', { p_token: token, p_member_id: alice, p_member_key: bobKey, p_name: 'x' }))
            .rejects.toMatchObject({ code: 'forbidden' });
        await expect(api.call('leave', { p_token: token, p_member_id: alice, p_member_key: bobKey }))
            .rejects.toMatchObject({ code: 'forbidden' });
    });

    test('a member key only works on its own calendar', async () => {
        const key = secret();
        const id = await api.call('join', { p_token: token, p_name: 'Sam', p_member_key: key });
        const other = secret();
        await api.call('create', { p_token: other, p_admin_key: secret(), p_title: 'Other' });
        await expect(api.call('set_days', { p_token: other, p_member_id: id, p_member_key: key, p_days: [today], p_status: 'busy' }))
            .rejects.toMatchObject({ code: 'forbidden' });
    });

    test('day batches are validated', async () => {
        const key = secret();
        const id = await api.call('join', { p_token: token, p_name: 'Sam', p_member_key: key });
        const base = { p_token: token, p_member_id: id, p_member_key: key, p_status: 'busy' };
        await expect(api.call('set_days', { ...base, p_days: [] })).rejects.toMatchObject({ code: 'invalid_days' });
        await expect(api.call('set_days', { ...base, p_days: [CalUtil.addDays(today, 900)] }))
            .rejects.toMatchObject({ code: 'invalid_days' });
        await expect(api.call('set_days', { ...base, p_days: [today], p_status: 'no' }))
            .rejects.toMatchObject({ code: 'invalid_status' });
        // 'yes' was the old "available" status, before marks meant "blocked".
        await expect(api.call('set_days', { ...base, p_days: [today], p_status: 'yes' }))
            .rejects.toMatchObject({ code: 'invalid_status' });
    });

    test('rename and leave', async () => {
        const key = secret();
        const id = await api.call('join', { p_token: token, p_name: 'Sam', p_member_key: key });
        await api.call('set_days', { p_token: token, p_member_id: id, p_member_key: key, p_days: [today], p_status: 'busy' });
        await api.call('rename_member', { p_token: token, p_member_id: id, p_member_key: key, p_name: 'Samwise' });
        expect((await api.call('get', { p_token: token })).members[0].name).toBe('Samwise');
        await api.call('leave', { p_token: token, p_member_id: id, p_member_key: key });
        const cal = await api.call('get', { p_token: token });
        expect(cal.members).toEqual([]);
        expect(cal.availability).toEqual([]);
    });

    test('admin actions require the admin key', async () => {
        const id = await api.call('join', { p_token: token, p_name: 'Spam', p_member_key: secret() });
        expect(await api.call('admin_check', { p_token: token, p_admin_key: adminKey })).toBe(true);
        expect(await api.call('admin_check', { p_token: token, p_admin_key: secret() })).toBe(false);

        const wrong = secret();
        await expect(api.call('admin_rename', { p_token: token, p_admin_key: wrong, p_title: 'x' }))
            .rejects.toMatchObject({ code: 'forbidden' });
        await expect(api.call('admin_remove_member', { p_token: token, p_admin_key: wrong, p_member_id: id }))
            .rejects.toMatchObject({ code: 'forbidden' });
        await expect(api.call('admin_delete', { p_token: token, p_admin_key: wrong }))
            .rejects.toMatchObject({ code: 'forbidden' });

        await api.call('admin_rename', { p_token: token, p_admin_key: adminKey, p_title: 'Cabin' });
        await api.call('admin_remove_member', { p_token: token, p_admin_key: adminKey, p_member_id: id });
        const cal = await api.call('get', { p_token: token });
        expect(cal.title).toBe('Cabin');
        expect(cal.members).toEqual([]);

        await api.call('admin_delete', { p_token: token, p_admin_key: adminKey });
        await expect(api.call('get', { p_token: token })).rejects.toMatchObject({ code: 'not_found' });
    });

    test('member cap', async () => {
        for (let i = 0; i < 50; i++) {
            await api.call('join', { p_token: token, p_name: 'm' + i, p_member_key: secret() });
        }
        await expect(api.call('join', { p_token: token, p_name: 'one too many', p_member_key: secret() }))
            .rejects.toMatchObject({ code: 'limit' });
    });
});

describe('postgres lockdown (anon role)', () => {
    let api;
    beforeAll(async () => { api = await pgBackend(); });
    afterAll(async () => { await api.db.close(); });

    test.each(['quickcal_calendars', 'quickcal_members', 'quickcal_availability'])('cannot read %s directly', async table => {
        await expect(api.db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
    });

    test('cannot write tables directly', async () => {
        await expect(api.db.query(`insert into quickcal_calendars (token_hash, admin_hash, title) values ('\\x00', '\\x00', 'x')`))
            .rejects.toThrow(/permission denied/);
    });

    test('cannot call internal helpers', async () => {
        await expect(api.db.query(`select quickcal_touch(gen_random_uuid())`)).rejects.toThrow(/permission denied/);
        await expect(api.db.query(`select quickcal_calendar_id('aaaaaaaaaaaaaaaaaaaaaa')`)).rejects.toThrow(/permission denied/);
    });

    test('stores only hashes of secrets', async () => {
        const token = secret();
        const adminKey = secret();
        await api.call('create', { p_token: token, p_admin_key: adminKey, p_title: 'x' });
        await api.call('join', { p_token: token, p_name: 'Sam', p_member_key: secret() });
        await api.db.exec('reset role');
        const dump = JSON.stringify((await api.db.query(`
            select c.*, m.* from quickcal_calendars c join quickcal_members m on m.calendar_id = c.id
        `)).rows);
        await api.db.exec('set role anon');
        expect(dump).not.toContain(token);
        expect(dump).not.toContain(adminKey);
    });
});

describe('migration 001 (available -> blocked dates)', () => {
    test('drops old "available" marks, keeps maybes, then accepts busy', async () => {
        const api = await pgBackend();
        const token = secret();
        const key = secret();
        await api.call('create', { p_token: token, p_admin_key: secret(), p_title: 'x' });
        const id = await api.call('join', { p_token: token, p_name: 'Sam', p_member_key: key });
        // Roll the table back to the old rules and add old-style rows.
        await api.db.exec('reset role');
        await api.db.exec(`
            alter table quickcal_availability drop constraint quickcal_availability_status_check,
                add constraint quickcal_availability_status_check check (status in ('yes', 'maybe'));
            insert into quickcal_availability values ('${id}', current_date, 'yes'), ('${id}', current_date + 1, 'maybe');
        `);
        await api.db.exec(fs.readFileSync(path.join(__dirname, '../../sql/migrations/001_blocked_dates.sql'), 'utf8'));
        await api.db.exec('set role anon');

        const after = await api.call('get', { p_token: token });
        expect(after.availability).toEqual([{ member_id: id, day: CalUtil.addDays(today, 1), status: 'maybe' }]);
        await api.call('set_days', { p_token: token, p_member_id: id, p_member_key: key, p_days: [today], p_status: 'busy' });
        expect((await api.call('get', { p_token: token })).availability).toHaveLength(2);
        await api.db.close();
    });
});
