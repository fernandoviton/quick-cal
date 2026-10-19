// Quick Cal API: thin wrapper over the quickcal_* Supabase RPCs (sql/setup.sql),
// with a localStorage mock that implements the same contract for local dev.
//
// Every call takes the same named args as the SQL function and rejects with an
// Error whose .code is the SQL exception message ('not_found', 'forbidden',
// 'invalid_name', 'invalid_token', 'invalid_days', 'invalid_status', 'limit').

function createMockBackend(storage, today) {
    var KEY = 'quickcal_mockdb';
    var MAX_MEMBERS = 50;
    var MAX_DAYS_PER_MEMBER = 1000;

    function load() {
        return JSON.parse(storage.getItem(KEY) || '{"calendars":{}}');
    }

    function save(db) {
        storage.setItem(KEY, JSON.stringify(db));
    }

    function fail(code) {
        var err = new Error(code);
        err.code = code;
        throw err;
    }

    function checkSecret(s) {
        if (!CalUtil.isSecret(s)) fail('invalid_token');
    }

    function clean(s, maxLen) {
        var v = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim();
        if (!v || v.length > maxLen) fail('invalid_name');
        return v;
    }

    function calendar(db, token) {
        checkSecret(token);
        var cal = db.calendars[token];
        if (!cal) fail('not_found');
        return cal;
    }

    function member(cal, memberId, memberKey) {
        var m = cal.members.find(function(x) { return x.id === memberId; });
        if (!m || !memberKey || m.key !== memberKey) fail('forbidden');
        return m;
    }

    function admin(cal, adminKey) {
        if (!adminKey || cal.adminKey !== adminKey) fail('forbidden');
    }

    // Strictly increasing, like clock_timestamp() across calls.
    var lastMs = 0;
    function touch(cal) {
        lastMs = Math.max(Date.now(), lastMs + 1);
        cal.updatedAt = new Date(lastMs).toISOString();
    }

    function todayIso() {
        return today ? today() : CalUtil.toIso(new Date());
    }

    var handlers = {
        create: function(db, a) {
            checkSecret(a.p_token);
            checkSecret(a.p_admin_key);
            var title = clean(a.p_title, 80);
            if (db.calendars[a.p_token]) fail('duplicate');
            db.calendars[a.p_token] = { title: title, adminKey: a.p_admin_key, members: [], availability: {} };
            touch(db.calendars[a.p_token]);
        },

        version: function(db, a) {
            return calendar(db, a.p_token).updatedAt;
        },

        get: function(db, a) {
            var cal = calendar(db, a.p_token);
            var availability = [];
            cal.members.forEach(function(m) {
                var days = cal.availability[m.id] || {};
                Object.keys(days).forEach(function(day) {
                    availability.push({ member_id: m.id, day: day, status: days[day] });
                });
            });
            availability.sort(function(x, y) {
                return x.day < y.day ? -1 : x.day > y.day ? 1 : (x.member_id < y.member_id ? -1 : 1);
            });
            return {
                title: cal.title,
                updated_at: cal.updatedAt,
                members: cal.members.map(function(m) { return { id: m.id, name: m.name }; }),
                availability: availability
            };
        },

        join: function(db, a) {
            var cal = calendar(db, a.p_token);
            checkSecret(a.p_member_key);
            if (cal.members.length >= MAX_MEMBERS) fail('limit');
            var id = crypto.randomUUID();
            cal.members.push({ id: id, name: clean(a.p_name, 40), key: a.p_member_key });
            touch(cal);
            return id;
        },

        rename_member: function(db, a) {
            var cal = calendar(db, a.p_token);
            member(cal, a.p_member_id, a.p_member_key).name = clean(a.p_name, 40);
            touch(cal);
        },

        leave: function(db, a) {
            var cal = calendar(db, a.p_token);
            member(cal, a.p_member_id, a.p_member_key);
            cal.members = cal.members.filter(function(m) { return m.id !== a.p_member_id; });
            delete cal.availability[a.p_member_id];
            touch(cal);
        },

        set_days: function(db, a) {
            var cal = calendar(db, a.p_token);
            member(cal, a.p_member_id, a.p_member_key);
            var days = a.p_days;
            var today = todayIso();
            var min = CalUtil.addDays(today, -400);
            var max = CalUtil.addDays(today, 800);
            if (!Array.isArray(days) || days.length === 0 || days.length > 366 ||
                days.some(function(d) { return !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < min || d > max; })) {
                fail('invalid_days');
            }
            var mine = Object.assign({}, cal.availability[a.p_member_id]);
            if (a.p_status == null) {
                days.forEach(function(d) { delete mine[d]; });
            } else if (a.p_status === 'yes' || a.p_status === 'maybe') {
                days.forEach(function(d) { mine[d] = a.p_status; });
                if (Object.keys(mine).length > MAX_DAYS_PER_MEMBER) fail('limit');
            } else {
                fail('invalid_status');
            }
            cal.availability[a.p_member_id] = mine;
            touch(cal);
        },

        admin_check: function(db, a) {
            var cal = calendar(db, a.p_token);
            return !!a.p_admin_key && cal.adminKey === a.p_admin_key;
        },

        admin_rename: function(db, a) {
            var cal = calendar(db, a.p_token);
            admin(cal, a.p_admin_key);
            cal.title = clean(a.p_title, 80);
            touch(cal);
        },

        admin_remove_member: function(db, a) {
            var cal = calendar(db, a.p_token);
            admin(cal, a.p_admin_key);
            cal.members = cal.members.filter(function(m) { return m.id !== a.p_member_id; });
            delete cal.availability[a.p_member_id];
            touch(cal);
        },

        admin_delete: function(db, a) {
            var cal = calendar(db, a.p_token);
            admin(cal, a.p_admin_key);
            delete db.calendars[a.p_token];
        }
    };

    return {
        call: async function(name, args) {
            var db = load();
            var result = handlers[name](db, args || {});
            save(db);
            return result === undefined ? null : JSON.parse(JSON.stringify(result));
        }
    };
}

var CalApi = (function() {
    var mock = null;

    function isMock() {
        return typeof window === 'undefined' || !window.supabaseClient;
    }

    async function call(name, args) {
        if (isMock()) {
            mock = mock || createMockBackend(localStorage);
            return mock.call(name, args);
        }
        var result = await window.supabaseClient.rpc('quickcal_' + name, args);
        if (result.error) {
            var err = new Error(result.error.message);
            err.code = result.error.message;
            throw err;
        }
        return result.data;
    }

    return { call: call, isMock: isMock };
})();

if (typeof module !== 'undefined') module.exports = { createMockBackend: createMockBackend, CalApi: CalApi };
