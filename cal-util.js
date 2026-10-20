// Pure helpers for Quick Cal: secrets, URL fragments, dates, day stats.
// Loaded as a script tag in the browser and required directly by Jest.

var CalUtil = (function() {
    var SECRET_RE = /^[A-Za-z0-9_-]{22,64}$/;

    // 128 bits of CSPRNG output as base64url (22 chars).
    function randomSecret() {
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function isSecret(s) {
        return typeof s === 'string' && SECRET_RE.test(s);
    }

    // Links live entirely in the fragment (#c=...), which browsers never send
    // to servers or put in Referer headers.
    //   #c=<token>                       invite link
    //   #c=<token>&me=<memberId>.<key>   personal link (edit your own dates)
    //   #c=<token>&admin=<key>           organizer link
    function parseHash(hash) {
        var params = new URLSearchParams((hash || '').replace(/^#/, ''));
        var token = params.get('c');
        if (!isSecret(token)) return null;
        var result = { token: token, me: null, admin: null };
        var me = params.get('me');
        if (me) {
            var dot = me.indexOf('.');
            var memberId = me.substring(0, dot);
            var key = me.substring(dot + 1);
            if (dot > 0 && isSecret(key)) result.me = { memberId: memberId, memberKey: key };
        }
        var admin = params.get('admin');
        if (isSecret(admin)) result.admin = admin;
        return result;
    }

    function buildHash(token, extra) {
        var hash = '#c=' + token;
        if (extra && extra.me) hash += '&me=' + extra.me.memberId + '.' + extra.me.memberKey;
        if (extra && extra.admin) hash += '&admin=' + extra.admin;
        return hash;
    }

    function pad(n) {
        return (n < 10 ? '0' : '') + n;
    }

    // Local-calendar ISO date (YYYY-MM-DD), not UTC.
    function toIso(date) {
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    }

    function parseIso(iso) {
        var p = iso.split('-');
        return new Date(+p[0], +p[1] - 1, +p[2]);
    }

    function addDays(iso, n) {
        var d = parseIso(iso);
        d.setDate(d.getDate() + n);
        return toIso(d);
    }

    // Inclusive list of ISO dates between a and b, in either order.
    function daysBetween(a, b) {
        if (a > b) { var t = a; a = b; b = t; }
        var out = [];
        for (var d = a; d <= b; d = addDays(d, 1)) out.push(d);
        return out;
    }

    // Weeks (Sunday-first) covering the given month; each cell is
    // { iso, inMonth }. month is 0-based.
    function monthGrid(year, month) {
        var first = new Date(year, month, 1);
        var start = addDays(toIso(first), -first.getDay());
        var last = toIso(new Date(year, month + 1, 0));
        var weeks = [];
        var d = start;
        while (d <= last) {
            var week = [];
            for (var i = 0; i < 7; i++) {
                week.push({ iso: d, inMonth: parseIso(d).getMonth() === month });
                d = addDays(d, 1);
            }
            weeks.push(week);
        }
        return weeks;
    }

    // Only blocked days are stored, so this lists who's busy or maybe on each
    // marked day. Anyone not listed is free. { iso: { busy: [memberId], maybe: [memberId] } }
    function dayStats(availability) {
        var stats = {};
        for (var i = 0; i < availability.length; i++) {
            var a = availability[i];
            if (!stats[a.day]) stats[a.day] = { busy: [], maybe: [] };
            stats[a.day][a.status].push(a.member_id);
        }
        return stats;
    }

    // Smallest number of consecutive days that can include every weekday in
    // `weekdays` (0 = Sun .. 6 = Sat). 0 when none are required.
    function minSpan(weekdays) {
        if (!weekdays.length) return 0;
        var best = 7;
        weekdays.forEach(function(start) {
            var span = 0;
            weekdays.forEach(function(w) { span = Math.max(span, (w - start + 7) % 7 + 1); });
            best = Math.min(best, span);
        });
        return best;
    }

    // Stretches of `opts.length` consecutive days, within the `horizon` days
    // from fromIso, when all `n` people are free (no busy or maybe marks) and
    // that include every weekday in `opts.weekdays`.
    // Overlapping stretches around the same occurrence of the required days
    // (e.g. Thu–Sun, Fri–Mon and Sat–Tue for one weekend) are merged into a
    // single result. With no required days, overlapping stretches merge into
    // one free run.
    // Returns [{ start, end, days }] in date order.
    function findDates(stats, n, fromIso, horizon, opts) {
        var length = Math.max(1, opts.length || 1);
        var weekdays = opts.weekdays || [];
        if (!n || length < minSpan(weekdays)) return [];
        var lastStart = addDays(fromIso, horizon - 1);
        function free(day) {
            var s = stats[day];
            return !s || (!s.busy.length && !s.maybe.length);
        }

        var groups = [];
        var byAnchor = {};
        for (var start = fromIso; start <= lastStart; start = addDays(start, 1)) {
            var window = daysBetween(start, addDays(start, length - 1));
            if (!window.every(free)) continue;
            var seen = window.map(function(d) { return parseIso(d).getDay(); });
            if (!weekdays.every(function(w) { return seen.indexOf(w) >= 0; })) continue;
            var end = window[window.length - 1];
            var last = groups[groups.length - 1];
            if (weekdays.length) {
                // Group by the first required day in the stretch.
                var anchor = window.filter(function(d) { return weekdays.indexOf(parseIso(d).getDay()) >= 0; })[0];
                if (byAnchor[anchor]) {
                    byAnchor[anchor].end = end;
                } else {
                    byAnchor[anchor] = { start: start, end: end };
                    groups.push(byAnchor[anchor]);
                }
            } else if (last && start <= last.end) {
                last.end = end;
            } else {
                groups.push({ start: start, end: end });
            }
        }
        return groups.map(function(g) {
            return { start: g.start, end: g.end, days: daysBetween(g.start, g.end).length };
        });
    }

    return {
        randomSecret: randomSecret,
        isSecret: isSecret,
        parseHash: parseHash,
        buildHash: buildHash,
        toIso: toIso,
        parseIso: parseIso,
        addDays: addDays,
        daysBetween: daysBetween,
        monthGrid: monthGrid,
        dayStats: dayStats,
        minSpan: minSpan,
        findDates: findDates
    };
})();

if (typeof module !== 'undefined') module.exports = CalUtil;
