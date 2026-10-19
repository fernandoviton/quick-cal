const CalUtil = require('../../cal-util');

describe('secrets', () => {
    test('randomSecret is 22-char base64url and unique', () => {
        const a = CalUtil.randomSecret();
        expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(CalUtil.isSecret(a)).toBe(true);
        expect(CalUtil.randomSecret()).not.toBe(a);
    });

    test('isSecret rejects short or odd strings', () => {
        expect(CalUtil.isSecret('abc')).toBe(false);
        expect(CalUtil.isSecret('a'.repeat(21) + '!')).toBe(false);
        expect(CalUtil.isSecret(null)).toBe(false);
    });
});

describe('hash links', () => {
    const token = 'A'.repeat(22);
    const key = 'B'.repeat(22);

    test('round-trips invite, personal and admin links', () => {
        expect(CalUtil.parseHash(CalUtil.buildHash(token))).toEqual({ token, me: null, admin: null });
        const me = { memberId: '1234-abcd', memberKey: key };
        expect(CalUtil.parseHash(CalUtil.buildHash(token, { me })).me).toEqual(me);
        expect(CalUtil.parseHash(CalUtil.buildHash(token, { admin: key })).admin).toBe(key);
    });

    test('ignores missing or malformed pieces', () => {
        expect(CalUtil.parseHash('')).toBeNull();
        expect(CalUtil.parseHash('#c=short')).toBeNull();
        expect(CalUtil.parseHash('#c=' + token + '&me=nodot&admin=bad')).toEqual({ token, me: null, admin: null });
    });
});

describe('dates', () => {
    test('addDays crosses month and year boundaries', () => {
        expect(CalUtil.addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(CalUtil.addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    test('daysBetween is inclusive and order-independent', () => {
        expect(CalUtil.daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
        expect(CalUtil.daysBetween('2026-11-02', '2026-10-31')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    });

    test('monthGrid starts on Sunday and covers the month', () => {
        const weeks = CalUtil.monthGrid(2026, 9); // October 2026 starts on a Thursday
        expect(weeks[0][0]).toEqual({ iso: '2026-09-27', inMonth: false });
        expect(weeks[0][4]).toEqual({ iso: '2026-10-01', inMonth: true });
        const flat = weeks.flat();
        expect(flat.filter(c => c.inMonth)).toHaveLength(31);
        expect(flat.length % 7).toBe(0);
        expect(flat[flat.length - 1].iso >= '2026-10-31').toBe(true);
    });
});

describe('stats', () => {
    const availability = [
        { member_id: 'a', day: '2026-10-20', status: 'yes' },
        { member_id: 'b', day: '2026-10-20', status: 'maybe' },
        { member_id: 'a', day: '2026-10-21', status: 'yes' },
        { member_id: 'b', day: '2026-10-21', status: 'yes' },
        { member_id: 'a', day: '2026-10-01', status: 'yes' },
        { member_id: 'b', day: '2026-10-01', status: 'yes' }
    ];

    test('dayStats groups by day and status', () => {
        const stats = CalUtil.dayStats(availability);
        expect(stats['2026-10-20']).toEqual({ yes: ['a'], maybe: ['b'] });
    });

    test('bestDays ranks upcoming days', () => {
        const stats = CalUtil.dayStats(availability);
        expect(CalUtil.bestDays(stats, '2026-10-19', 5)).toEqual(['2026-10-21', '2026-10-20']);
    });
});
