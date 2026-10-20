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
        { member_id: 'b', day: '2026-10-20', status: 'maybe' }, // ignored
        { member_id: 'a', day: '2026-10-21', status: 'busy' },
        { member_id: 'b', day: '2026-10-21', status: 'busy' },
        { member_id: 'a', day: '2026-10-22', status: 'maybe' },
        { member_id: 'a', day: '2026-10-01', status: 'busy' }
    ];
    const stats = CalUtil.dayStats(availability);

    test('dayStats lists who is busy each day and ignores leftover maybes', () => {
        expect(stats['2026-10-20']).toEqual({ busy: ['a'] });
        expect(stats['2026-10-21']).toEqual({ busy: ['a', 'b'] });
        expect(stats['2026-10-22']).toBeUndefined(); // only a maybe
        expect(stats['2026-10-19']).toBeUndefined();
    });
});

test('minSpan is the shortest run that covers the weekdays', () => {
    expect(CalUtil.minSpan([])).toBe(0);
    expect(CalUtil.minSpan([6, 0])).toBe(2);    // Sat, Sun
    expect(CalUtil.minSpan([5, 1])).toBe(4);    // Fri .. Mon
    expect(CalUtil.minSpan([1, 3, 5])).toBe(5); // Mon .. Fri
});

// October 2026: Thu 22, Fri 23, Sat 24, Sun 25, Mon 26, Tue 27 ... Sat 31, Sun Nov 1.
describe('findDates', () => {
    const marks = CalUtil.dayStats([
        { member_id: 'b', day: '2026-10-27', status: 'busy' },  // Tue
        { member_id: 'a', day: '2026-10-29', status: 'busy' },  // Thu
        { member_id: 'b', day: '2026-11-07', status: 'busy' }   // Sat
    ]);
    // Stretches may start up to Nov 4 (14 days).
    const find = (weekdays, length) => CalUtil.findDates(marks, 2, '2026-10-22', 14, { weekdays, length })
        .map(r => `${r.start}..${r.end}`);

    test('merges the stretches around each weekend into one result', () => {
        // Oct 24/25: Thu–Sun and Fri–Mon (Tue is busy). Oct 31/Nov 1: Fri–Mon
        // and Sat–Tue (Thu is busy).
        expect(find([6, 0], 4)).toEqual(['2026-10-22..2026-10-26', '2026-10-30..2026-11-03']);
        expect(CalUtil.findDates(marks, 2, '2026-10-22', 14, { weekdays: [6, 0], length: 4 })[0].days).toBe(5);
    });

    test('a long stretch must fit between blocked days', () => {
        expect(find([6, 0], 5)).toEqual(['2026-10-22..2026-10-26', '2026-10-30..2026-11-04']);
        expect(find([6, 0], 6)).toEqual(['2026-10-30..2026-11-05']);
        expect(find([6, 0], 8)).toEqual(['2026-10-30..2026-11-06']); // Sat Nov 7 is busy
        expect(find([6, 0], 9)).toEqual([]);
    });

    test('other required days', () => {
        expect(find([5, 1], 4)).toEqual(['2026-10-23..2026-10-26', '2026-10-30..2026-11-02']); // Fri–Mon only
        expect(find([5, 1], 3)).toEqual([]); // can't fit
    });

    test('no required days gives free runs of at least the length', () => {
        expect(find([], 3)).toEqual(['2026-10-22..2026-10-26', '2026-10-30..2026-11-06']);
    });

    test('never starts before fromIso, and needs people', () => {
        // From a Sunday: that weekend's Saturday is in the past.
        expect(CalUtil.findDates({}, 1, '2026-10-25', 7, { weekdays: [6, 0], length: 2 }).map(r => r.start)).toEqual(['2026-10-31']);
        expect(CalUtil.findDates({}, 0, '2026-10-22', 30, { weekdays: [], length: 1 })).toEqual([]);
    });
});
