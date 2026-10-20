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
    // Two people, a and b. Unmarked days are free.
    const availability = [
        { member_id: 'a', day: '2026-10-20', status: 'busy' },
        { member_id: 'b', day: '2026-10-20', status: 'maybe' },
        { member_id: 'a', day: '2026-10-21', status: 'busy' },
        { member_id: 'b', day: '2026-10-21', status: 'busy' },
        { member_id: 'a', day: '2026-10-22', status: 'maybe' },
        { member_id: 'a', day: '2026-10-01', status: 'busy' }
    ];
    const stats = CalUtil.dayStats(availability);

    test('dayStats groups by day and status', () => {
        expect(stats['2026-10-20']).toEqual({ busy: ['a'], maybe: ['b'] });
        expect(stats['2026-10-19']).toBeUndefined();
    });
});

// October 2026: Fri 23, Sat 24, Sun 25, Mon 26 ... Fri 30, Sat 31, Sun Nov 1, Mon 2.
describe('findDates', () => {
    const marks = CalUtil.dayStats([
        { member_id: 'a', day: '2026-10-23', status: 'maybe' }, // Fri
        { member_id: 'b', day: '2026-10-27', status: 'busy' },  // Tue
        { member_id: 'a', day: '2026-10-30', status: 'busy' },  // Fri
        { member_id: 'b', day: '2026-11-07', status: 'busy' }   // Sat
    ]);
    const find = opts => CalUtil.findDates(marks, 2, '2026-10-22', 21, opts)
        .map(r => `${r.start}..${r.end}/${r.maybeDays}`);

    test('weekends widen to a free Friday and Monday', () => {
        expect(find({ mode: 'weekend', minDays: 2 })).toEqual([
            '2026-10-24..2026-10-26/0', // Fri is a maybe
            '2026-10-31..2026-11-02/0'  // Fri busy; the Nov 7 weekend is blocked
        ]);
        expect(find({ mode: 'weekend', minDays: 2, allowMaybe: true })[0]).toBe('2026-10-23..2026-10-26/1');
    });

    test('weekends shorter than minDays are dropped', () => {
        expect(find({ mode: 'weekend', minDays: 4, allowMaybe: true })).toEqual(['2026-10-23..2026-10-26/1']);
        expect(find({ mode: 'weekend', minDays: 4 })).toEqual([]);
    });

    test('any mode returns runs of at least minDays', () => {
        expect(find({ mode: 'any', minDays: 1 })).toEqual([
            '2026-10-22..2026-10-22/0',
            '2026-10-24..2026-10-26/0',
            '2026-10-28..2026-10-29/0',
            '2026-10-31..2026-11-06/0',
            '2026-11-08..2026-11-11/0' // cut off at the horizon
        ]);
        expect(find({ mode: 'any', minDays: 4 })).toEqual(['2026-10-31..2026-11-06/0', '2026-11-08..2026-11-11/0']);
        expect(find({ mode: 'any', minDays: 3, allowMaybe: true })[0]).toBe('2026-10-22..2026-10-26/1');
    });

    test('never starts before fromIso, and needs people', () => {
        // From a Sunday, that weekend's Saturday is already past, so the first result is the next Friday.
        expect(CalUtil.findDates({}, 1, '2026-10-25', 7, { mode: 'weekend', minDays: 2 }).map(r => r.start)).toEqual(['2026-10-30']);
        expect(CalUtil.findDates({}, 0, '2026-10-22', 30, { mode: 'any', minDays: 1 })).toEqual([]);
    });
});
