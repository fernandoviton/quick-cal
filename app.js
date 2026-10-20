// Quick Cal: a shared availability calendar for friends, with no accounts.
// Routes on the URL fragment: none → home (create a calendar), #c=<token> →
// calendar view. See CalUtil.parseHash for the link formats.

var App = (function() {
    var STORE_KEY = 'quickcal_identities';
    var POLL_MS = 15000;
    var STATUS_LABEL = { busy: 'Busy', maybe: 'Maybe' };
    var FIND_HORIZON_DAYS = 180;
    var FIND_LIMIT = 8;
    var FIND_DEFAULTS = { mode: 'weekend', minDays: 2, allowMaybe: false };
    var WEEKEND_LENGTHS = [[2, 'Sat–Sun'], [3, 'Long weekend (3 days)'], [4, 'Fri–Mon']];

    var headerEl = null;
    var container = null;
    var state = null; // calendar view state, null on the home page
    var pollTimer = null;
    var savingCount = 0;

    // ---------------------------------------------------------------------
    // Per-device identity store: { token: { title, name, memberId, memberKey,
    // adminKey, lastVisited } }. Never leaves this browser.
    // ---------------------------------------------------------------------

    function loadStore() {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function getEntry(token) {
        return loadStore()[token] || {};
    }

    function updateEntry(token, changes) {
        var store = loadStore();
        store[token] = Object.assign({}, store[token], changes);
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
    }

    function forgetEntry(token) {
        var store = loadStore();
        delete store[token];
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
    }

    // ---------------------------------------------------------------------
    // Routing
    // ---------------------------------------------------------------------

    function init(headerElement, appElement) {
        headerEl = headerElement;
        container = appElement;
        window.addEventListener('hashchange', route);
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) poll();
        });
        container.addEventListener('click', onClick);
        container.addEventListener('submit', onSubmit);
        container.addEventListener('change', onChange);
        container.addEventListener('pointerdown', onPointerDown);
        container.addEventListener('pointermove', onPointerMove);
        container.addEventListener('pointerup', onPointerUp);
        container.addEventListener('pointercancel', onPointerUp);
        route();
    }

    function route() {
        stopPolling();
        state = null;
        var link = CalUtil.parseHash(location.hash);
        if (!link) {
            renderHome();
            return;
        }
        // Personal and organizer secrets are absorbed into this device and
        // stripped from the address bar so they don't get shared by accident.
        if (link.me || link.admin) {
            var changes = {};
            if (link.me) {
                changes.memberId = link.me.memberId;
                changes.memberKey = link.me.memberKey;
            }
            if (link.admin) changes.adminKey = link.admin;
            updateEntry(link.token, changes);
            history.replaceState(null, '', CalUtil.buildHash(link.token));
        }
        openCalendar(link.token);
    }

    function goHome() {
        history.pushState(null, '', location.pathname + location.search);
        route();
    }

    function linkTo(hash) {
        return location.origin + location.pathname + location.search + hash;
    }

    // ---------------------------------------------------------------------
    // Shared bits: header, toasts, saving indicator, dialogs
    // ---------------------------------------------------------------------

    function renderHeader(title) {
        headerEl.innerHTML =
            '<div class="header-bar">' +
                '<div class="header-left">' +
                    '<a href="./" class="header-home-btn" title="Home">&#8962;</a>' +
                    '<span class="header-title">' + escapeHtml(title) + '</span>' +
                '</div>' +
                '<div class="header-right"><span id="syncStatus"></span></div>' +
            '</div>';
        headerEl.querySelector('.header-home-btn').addEventListener('click', function(e) {
            e.preventDefault();
            goHome();
        });
        document.getElementById('syncStatus').addEventListener('click', function() {
            refresh();
        });
    }

    function setSyncStatus(text, isError) {
        var el = document.getElementById('syncStatus');
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('paused', !!isError);
        el.title = isError ? 'Click to retry' : 'Updates every few seconds. Click to refresh now.';
    }

    function toast(message, isError) {
        var el = document.createElement('div');
        el.className = 'qc-toast' + (isError ? ' error' : '');
        el.setAttribute('role', 'status');
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(function() { el.remove(); }, 4000);
    }

    function showSaving() {
        savingCount++;
        document.getElementById('savingIndicator').classList.add('visible');
    }

    function hideSaving() {
        savingCount = Math.max(0, savingCount - 1);
        if (!savingCount) document.getElementById('savingIndicator').classList.remove('visible');
    }

    function errorMessage(err) {
        switch (err && err.code) {
            case 'not_found': return 'This calendar doesn\'t exist. It may have been deleted, or the link is incomplete.';
            case 'forbidden': return 'You don\'t have permission to do that from this device.';
            case 'invalid_name': return 'Names must be 1–40 characters, and calendar names 1–80.';
            case 'invalid_days': return 'Those dates are outside the allowed range.';
            case 'limit': return 'This calendar has reached its limit.';
            default: return (err && err.message) || 'Something went wrong.';
        }
    }

    // Minimal modal built on the shared .modal styles. Resolves with the
    // entered text (or true for confirms), or null when cancelled.
    function dialog(opts) {
        return new Promise(function(resolve) {
            var overlay = document.createElement('div');
            overlay.className = 'modal-overlay visible';
            overlay.innerHTML =
                '<form class="modal" role="dialog" aria-modal="true">' +
                    '<h3>' + escapeHtml(opts.title) + '</h3>' +
                    (opts.message ? '<p class="qc-dialog-msg">' + escapeHtml(opts.message) + '</p>' : '') +
                    (opts.input ? '<input name="value" maxlength="' + opts.maxLength + '" value="' + escapeHtml(opts.value || '') + '" required>' : '') +
                    '<div class="modal-buttons">' +
                        '<button type="button" class="modal-btn secondary" data-cancel>Cancel</button>' +
                        '<button type="submit" class="modal-btn primary' + (opts.danger ? ' danger' : '') + '">' + escapeHtml(opts.ok || 'OK') + '</button>' +
                    '</div>' +
                '</form>';
            document.body.appendChild(overlay);
            var form = overlay.querySelector('form');
            var input = form.querySelector('input');
            (input || form.querySelector('[type=submit]')).focus();
            if (input) input.select();

            function close(value) {
                overlay.remove();
                resolve(value);
            }
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                close(input ? input.value : true);
            });
            form.querySelector('[data-cancel]').addEventListener('click', function() { close(null); });
            overlay.addEventListener('keydown', function(e) { if (e.key === 'Escape') close(null); });
            overlay.addEventListener('click', function(e) { if (e.target === overlay) close(null); });
        });
    }

    async function copyText(text, message) {
        try {
            await navigator.clipboard.writeText(text);
            toast(message);
        } catch (e) {
            window.prompt('Copy this link:', text);
        }
    }

    function formatDay(iso, long) {
        return CalUtil.parseIso(iso).toLocaleDateString(undefined, long
            ? { weekday: 'long', month: 'long', day: 'numeric' }
            : { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function todayIso() {
        return CalUtil.toIso(new Date());
    }

    // ---------------------------------------------------------------------
    // Home
    // ---------------------------------------------------------------------

    function renderHome() {
        renderHeader((typeof CONFIG !== 'undefined' && CONFIG.APP_TITLE) || 'Quick Cal');
        var store = loadStore();
        var tokens = Object.keys(store).sort(function(a, b) {
            return (store[b].lastVisited || 0) - (store[a].lastVisited || 0);
        });

        var recent = '';
        if (tokens.length) {
            recent = '<section class="qc-card"><h2>On this device</h2><ul class="qc-recent">';
            tokens.forEach(function(t) {
                var e = store[t];
                var who = [];
                if (e.memberId && e.name) who.push('as ' + e.name);
                if (e.adminKey) who.push('organizer');
                recent += '<li>' +
                    '<a href="' + escapeHtml(CalUtil.buildHash(t)) + '">' + escapeHtml(e.title || 'Untitled calendar') + '</a>' +
                    '<span class="qc-muted">' + escapeHtml(who.join(' · ')) + '</span>' +
                    '<button class="qc-link-btn" data-forget="' + escapeHtml(t) + '">Forget</button>' +
                '</li>';
            });
            recent += '</ul></section>';
        }

        container.innerHTML =
            '<div class="qc-page">' +
                '<section class="qc-card">' +
                    '<h1>Find a date that works</h1>' +
                    '<p class="qc-muted">Make a calendar, send the link to your friends, and everyone blocks out the days they can\'t make. Every other day counts as free. No accounts needed.</p>' +
                    '<form id="createForm" class="qc-form">' +
                        '<label>Calendar name<input class="input" id="createTitle" maxlength="80" placeholder="Ski trip" required></label>' +
                        '<label>Your name or nickname<input class="input" id="createName" maxlength="40" placeholder="Sam" required></label>' +
                        '<button class="btn btn-primary" type="submit">Create calendar</button>' +
                        '<div class="qc-error" id="createError" role="alert"></div>' +
                    '</form>' +
                '</section>' +
                recent +
                '<section class="qc-card qc-privacy">' +
                    '<h2>How private is this?</h2>' +
                    '<ul>' +
                        '<li>There are no accounts. Anyone with a calendar\'s link can see it, so only share it with the people you\'re planning with.</li>' +
                        '<li>People only show up under the name they type. Nicknames are fine.</li>' +
                        '<li>Only you can change your dates. This device keeps a secret key for you. To edit from another device, use <em>Copy my personal link</em>.</li>' +
                        '<li>Links are random and can\'t be guessed. The secret part after <code>#</code> is never sent to the web host or in referrer headers.</li>' +
                    '</ul>' +
                '</section>' +
            '</div>';
    }

    async function createCalendar() {
        var title = document.getElementById('createTitle').value;
        var name = document.getElementById('createName').value;
        var errorEl = document.getElementById('createError');
        var token = CalUtil.randomSecret();
        var adminKey = CalUtil.randomSecret();
        var memberKey = CalUtil.randomSecret();
        errorEl.textContent = '';
        showSaving();
        try {
            await CalApi.call('create', { p_token: token, p_admin_key: adminKey, p_title: title });
            var memberId = await CalApi.call('join', { p_token: token, p_name: name, p_member_key: memberKey });
            updateEntry(token, {
                title: title.trim(), name: name.trim(), memberId: memberId, memberKey: memberKey,
                adminKey: adminKey, lastVisited: Date.now()
            });
            location.hash = CalUtil.buildHash(token);
        } catch (err) {
            errorEl.textContent = errorMessage(err);
        }
        hideSaving();
    }

    // ---------------------------------------------------------------------
    // Calendar view: loading and syncing
    // ---------------------------------------------------------------------

    async function openCalendar(token) {
        var now = new Date();
        state = {
            token: token, data: null, version: null, stats: {}, me: null, isAdmin: false,
            month: { y: now.getFullYear(), m: now.getMonth() },
            selected: todayIso(), paint: 'busy', drag: null, highlight: null,
            find: Object.assign({}, FIND_DEFAULTS, getEntry(token).find),
            pending: 0, queue: Promise.resolve()
        };
        var s = state;
        renderHeader(getEntry(token).title || 'Calendar');
        container.innerHTML = '<div class="loading">Loading...</div>';
        try {
            var data = await CalApi.call('get', { p_token: token });
            var adminKey = getEntry(token).adminKey;
            var isAdmin = adminKey ? await CalApi.call('admin_check', { p_token: token, p_admin_key: adminKey }) : false;
            if (state !== s) return;
            state.isAdmin = isAdmin;
            applyData(data);
            renderCalendarPage();
            startPolling();
        } catch (err) {
            if (state !== s) return;
            renderLoadError(err);
        }
    }

    function renderLoadError(err) {
        stopPolling();
        var known = !!loadStore()[state.token];
        container.innerHTML =
            '<div class="qc-page"><section class="qc-card">' +
                '<h1>Can\'t open this calendar</h1>' +
                '<p>' + escapeHtml(errorMessage(err)) + '</p>' +
                '<p>' +
                    (err.code === 'not_found' && known ? '<button class="btn btn-secondary" data-forget="' + escapeHtml(state.token) + '">Remove from this device</button> ' : '') +
                    '<button class="btn btn-primary" data-action="home">Go home</button>' +
                '</p>' +
            '</section></div>';
    }

    function applyData(data) {
        state.data = data;
        state.version = data.updated_at;
        state.stats = CalUtil.dayStats(data.availability);
        var entry = getEntry(state.token);
        var me = null;
        for (var i = 0; i < data.members.length; i++) {
            if (data.members[i].id === entry.memberId) me = data.members[i];
        }
        // A member removed by the organizer just becomes a viewer again.
        state.me = me && entry.memberKey ? { id: me.id, name: me.name, key: entry.memberKey } : null;
        updateEntry(state.token, { title: data.title, name: me ? me.name : entry.name, lastVisited: Date.now() });
    }

    function startPolling() {
        stopPolling();
        pollTimer = setInterval(poll, POLL_MS);
        setSyncStatus('Synced');
    }

    function stopPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    async function poll() {
        if (!state || !state.data || document.hidden) return;
        var s = state;
        try {
            var version = await CalApi.call('version', { p_token: s.token });
            if (state !== s) return;
            if (version !== s.version) await refresh();
            setSyncStatus('Synced');
        } catch (err) {
            if (state !== s) return;
            if (err.code === 'not_found') renderLoadError(err);
            else setSyncStatus('Offline, retrying', true);
        }
    }

    // Refetch and re-render, unless the user is mid-drag or has writes in
    // flight (their optimistic state would be clobbered).
    async function refresh() {
        if (!state || !state.data || state.drag || state.pending) return;
        var s = state;
        var hadMe = !!s.me;
        var oldTitle = s.data.title;
        try {
            var data = await CalApi.call('get', { p_token: s.token });
            if (state !== s || s.drag || s.pending) return;
            applyData(data);
            if (hadMe !== !!s.me || oldTitle !== data.title) {
                renderHeader(data.title);
                renderTop();
                renderToolbar();
            }
            renderDynamic();
            setSyncStatus('Synced');
        } catch (err) {
            if (state !== s) return;
            if (err.code === 'not_found') renderLoadError(err);
            else setSyncStatus('Offline, retrying', true);
        }
    }

    // ---------------------------------------------------------------------
    // Calendar view: rendering
    // ---------------------------------------------------------------------

    function renderCalendarPage() {
        renderHeader(state.data.title);
        container.innerHTML =
            '<div class="qc-page qc-wide">' +
                '<div id="qcTop"></div>' +
                '<div class="qc-layout">' +
                    '<div class="qc-main qc-card">' +
                        '<div id="qcToolbar"></div>' +
                        '<div id="qcGrid"></div>' +
                        '<div class="qc-legend">' +
                            '<span><i class="qc-swatch" style="background:#2e7d32"></i>Everyone free</span>' +
                            '<span><i class="qc-swatch" style="background:#a5d6a7"></i>Some free</span>' +
                            '<span><i class="qc-swatch" style="background:#fff"></i>Nobody free</span>' +
                            '<span><i class="qc-swatch qc-swatch-busy"></i>You\'re busy</span>' +
                            '<span><i class="qc-swatch qc-swatch-maybe"></i>You: maybe</span>' +
                        '</div>' +
                    '</div>' +
                    '<aside class="qc-side">' +
                        '<section id="qcDetail" class="qc-card"></section>' +
                        '<section class="qc-card">' +
                            '<h2>Dates that work</h2>' +
                            '<div id="qcFind"></div>' +
                            '<div id="qcBest"></div>' +
                        '</section>' +
                        '<section id="qcMembers" class="qc-card"></section>' +
                        '<div id="qcAdmin"></div>' +
                    '</aside>' +
                '</div>' +
            '</div>';
        renderTop();
        renderToolbar();
        renderFind();
        renderDynamic();
    }

    function renderDynamic() {
        renderGrid();
        renderDetail();
        renderBest();
        renderMembers();
        renderAdmin();
    }

    function renderTop() {
        var me = state.me;
        var html = '<div class="qc-top">' +
            '<div class="qc-top-row">' +
                '<h1 class="qc-title">' + escapeHtml(state.data.title) + '</h1>' +
                '<div class="qc-share">' +
                    '<button class="btn btn-primary qc-small" data-action="copy-invite">Copy invite link</button>' +
                    (me ? '<button class="btn btn-secondary qc-small" data-action="copy-personal" title="Opens this calendar as you on another device. Keep it to yourself.">Copy my personal link</button>' : '') +
                '</div>' +
            '</div>';
        if (me) {
            html += '<p class="qc-muted qc-identity">You\'re marking dates as <strong>' + escapeHtml(me.name) + '</strong>. ' +
                '<button class="qc-link-btn" data-action="rename-me">Change name</button> · ' +
                '<button class="qc-link-btn" data-action="leave">Leave calendar</button></p>';
        } else {
            html += '<form id="joinForm" class="qc-join">' +
                    '<label for="joinName">Join to block out the days you can\'t make. What should we call you?</label>' +
                    '<div class="qc-join-row">' +
                        '<input class="input" id="joinName" maxlength="40" placeholder="Name or nickname" required>' +
                        '<button class="btn btn-primary" type="submit">Join</button>' +
                    '</div>' +
                    '<p class="qc-muted">Already joined on another device? Open your personal link here instead.</p>' +
                '</form>';
        }
        document.getElementById('qcTop').innerHTML = html + '</div>';
    }

    function renderToolbar() {
        var first = new Date(state.month.y, state.month.m, 1);
        var label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        var html = '<div class="qc-toolbar">' +
            '<div class="qc-monthnav">' +
                '<button class="qc-icon-btn" data-action="prev" aria-label="Previous month">&#8249;</button>' +
                '<span class="qc-month-label" aria-live="polite">' + escapeHtml(label) + '</span>' +
                '<button class="qc-icon-btn" data-action="next" aria-label="Next month">&#8250;</button>' +
                '<button class="qc-link-btn" data-action="today">Today</button>' +
            '</div>';
        if (state.me) {
            html += '<div class="qc-paint" role="radiogroup" aria-label="Mark days as">';
            [['busy', 'Busy'], ['maybe', 'Maybe'], ['clear', 'Free']].forEach(function(p) {
                var active = state.paint === p[0];
                html += '<button class="qc-paint-btn ' + p[0] + (active ? ' active' : '') + '" role="radio" aria-checked="' + active + '" data-paint="' + p[0] + '">' + p[1] + '</button>';
            });
            html += '</div>';
        }
        html += '</div><p class="qc-hint">' + (state.me
            ? 'Tap or drag across the days you can\'t make. Unmarked days count as free. Tap a marked day again to clear it.'
            : 'Join above to block out your dates. Tap any day to see who\'s free.') + '</p>';
        document.getElementById('qcToolbar').innerHTML = html;
    }

    function myStatus(day) {
        if (!state.me) return null;
        var s = state.stats[day];
        if (!s) return null;
        if (s.busy.indexOf(state.me.id) >= 0) return 'busy';
        if (s.maybe.indexOf(state.me.id) >= 0) return 'maybe';
        return null;
    }

    // White → green by share of people free (maybe counts half). Squared so
    // "everyone free" stands out clearly from "almost everyone".
    function heatColor(score) {
        var from = [255, 255, 255];
        var to = [46, 125, 50];
        var t = score * score;
        var rgb = from.map(function(f, i) { return Math.round(f + (to[i] - f) * t); });
        return 'rgb(' + rgb.join(',') + ')';
    }

    function renderGrid() {
        var weeks = CalUtil.monthGrid(state.month.y, state.month.m);
        var n = state.data.members.length;
        var today = todayIso();
        var html = '<div class="qc-grid" role="grid">';
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function(d) {
            html += '<div class="qc-dow" role="columnheader">' + d + '</div>';
        });
        weeks.forEach(function(week) {
            week.forEach(function(cell) {
                var s = state.stats[cell.iso] || { busy: [], maybe: [] };
                var maybe = s.maybe.length;
                var free = n - s.busy.length - maybe;
                var score = n ? (free + maybe / 2) / n : 0;
                var mine = myStatus(cell.iso);
                var classes = ['qc-day'];
                if (!cell.inMonth) classes.push('out');
                if (cell.iso < today) classes.push('past');
                if (cell.iso === today) classes.push('today');
                if (cell.iso === state.selected) classes.push('selected');
                if (state.highlight && cell.iso >= state.highlight.start && cell.iso <= state.highlight.end) classes.push('highlight');
                if (mine) classes.push('mine-' + mine);
                if (score * score > 0.55) classes.push('dark');
                var aria = formatDay(cell.iso, true) + ': ' + free + ' of ' + n + ' free' +
                    (maybe ? ', ' + maybe + ' maybe' : '') + (mine ? ', you: ' + STATUS_LABEL[mine].toLowerCase() : '');
                html += '<button class="' + classes.join(' ') + '" data-day="' + cell.iso + '" role="gridcell" ' +
                    'style="background:' + heatColor(score) + '" aria-label="' + escapeHtml(aria) + '">' +
                    '<span class="qc-num">' + CalUtil.parseIso(cell.iso).getDate() + '</span>' +
                    (free < n ? '<span class="qc-count" aria-hidden="true">' + free + '/' + n + (maybe ? ' <small>+' + maybe + '?</small>' : '') + '</span>' : '') +
                '</button>';
            });
        });
        document.getElementById('qcGrid').innerHTML = html + '</div>';
    }

    function namesFor(ids) {
        var byId = {};
        state.data.members.forEach(function(m) { byId[m.id] = m.name; });
        return ids.map(function(id) { return byId[id]; }).filter(Boolean);
    }

    function nameList(title, names, cls) {
        if (!names.length) return '';
        return '<h3 class="' + cls + '">' + title + ' (' + names.length + ')</h3>' +
            '<ul class="qc-names">' + names.map(function(nm) { return '<li>' + escapeHtml(nm) + '</li>'; }).join('') + '</ul>';
    }

    function renderDetail() {
        var day = state.selected;
        var el = document.getElementById('qcDetail');
        if (!day) {
            el.innerHTML = '<p class="qc-muted">Tap a day to see who\'s free.</p>';
            return;
        }
        var s = state.stats[day] || { busy: [], maybe: [] };
        var marked = s.busy.concat(s.maybe);
        var free = state.data.members.filter(function(m) { return marked.indexOf(m.id) < 0; })
            .map(function(m) { return m.name; });
        var html = '<h2>' + escapeHtml(formatDay(day, true)) + '</h2>';
        if (state.me && day >= todayIso()) {
            var mine = myStatus(day);
            html += '<div class="qc-mine" role="group" aria-label="Your answer for this day">';
            [['busy', 'Busy'], ['maybe', 'Maybe'], ['clear', 'Free']].forEach(function(p) {
                var on = (mine || 'clear') === p[0];
                html += '<button class="qc-paint-btn ' + p[0] + (on ? ' active' : '') + '" aria-pressed="' + on + '" data-set-day="' + p[0] + '">' + p[1] + '</button>';
            });
            html += '</div>';
        }
        html += nameList('Free', free, 'free') +
            nameList('Maybe', namesFor(s.maybe), 'maybe') +
            nameList('Busy', namesFor(s.busy), 'busy');
        if (!state.data.members.length) html += '<p class="qc-muted">Nobody has joined yet.</p>';
        el.innerHTML = html;
    }

    // The search settings (static, so polling doesn't reset the inputs).
    function renderFind() {
        var f = state.find;
        var lengths = f.mode === 'weekend' ? WEEKEND_LENGTHS : [];
        if (f.mode !== 'weekend') {
            for (var i = 1; i <= 14; i++) lengths.push([i, i === 1 ? 'Any single day' : 'At least ' + i + ' days in a row']);
        }
        var html = '<div class="qc-find">' +
            '<div class="qc-paint" role="radiogroup" aria-label="Looking for">';
        [['weekend', 'Weekends'], ['any', 'Any days']].forEach(function(m) {
            var on = f.mode === m[0];
            html += '<button class="qc-paint-btn clear' + (on ? ' active' : '') + '" role="radio" aria-checked="' + on + '" data-find-mode="' + m[0] + '">' + m[1] + '</button>';
        });
        html += '</div>' +
            '<select class="input" id="findLen" aria-label="Length">' +
                lengths.map(function(l) {
                    return '<option value="' + l[0] + '"' + (l[0] === f.minDays ? ' selected' : '') + '>' + escapeHtml(l[1]) + '</option>';
                }).join('') +
            '</select>' +
            '<label class="qc-check"><input type="checkbox" id="findMaybe"' + (f.allowMaybe ? ' checked' : '') + '> Count "maybe" as free</label>' +
        '</div>';
        document.getElementById('qcFind').innerHTML = html;
    }

    function setFind(changes) {
        Object.assign(state.find, changes);
        if (state.find.mode === 'weekend') state.find.minDays = Math.min(4, Math.max(2, state.find.minDays));
        updateEntry(state.token, { find: state.find });
        state.highlight = null;
        renderFind();
        renderBest();
        renderGrid();
    }

    function formatRange(start, end) {
        return formatDay(start) + (end !== start ? ' – ' + formatDay(end) : '');
    }

    function renderBest() {
        var members = state.data.members;
        var results = CalUtil.findDates(state.stats, members.length, todayIso(), FIND_HORIZON_DAYS, state.find);
        var html = '';
        if (!members.length) {
            html += '<p class="qc-muted">Nobody has joined yet.</p>';
        } else if (!results.length) {
            html += '<p class="qc-muted">No dates where everyone\'s free in the next 6 months. Try a shorter length' +
                (state.find.allowMaybe ? '' : ' or counting "maybe" as free') + '.</p>';
        } else {
            html += '<ol class="qc-best">';
            results.slice(0, FIND_LIMIT).forEach(function(r) {
                var on = state.highlight && state.highlight.start === r.start && state.highlight.end === r.end;
                html += '<li><button class="qc-link-btn' + (on ? ' active' : '') + '" data-goto-range="' + r.start + '|' + r.end + '">' +
                        escapeHtml(formatRange(r.start, r.end)) + '</button>' +
                    '<span class="qc-muted">' + r.days + (r.days === 1 ? ' day' : ' days') +
                        (r.maybeDays ? ' · ' + r.maybeDays + (r.maybeDays === 1 ? ' maybe day' : ' maybe days') : '') + '</span></li>';
            });
            html += '</ol>';
            if (results.length > FIND_LIMIT) {
                html += '<p class="qc-muted">' + (results.length - FIND_LIMIT) + ' more in the next 6 months.</p>';
            }
        }
        // Unmarked days count as free, so flag people who haven't marked anything.
        var marked = {};
        state.data.availability.forEach(function(a) { marked[a.member_id] = true; });
        var blank = members.filter(function(m) { return !marked[m.id]; }).map(function(m) { return m.name; });
        if (blank.length && members.length > 1) {
            html += '<p class="qc-note">' + escapeHtml(blank.join(', ')) + (blank.length === 1 ? ' hasn\'t' : ' haven\'t') +
                ' blocked any days yet, so ' + (blank.length === 1 ? 'they count' : 'they all count') + ' as free everywhere.</p>';
        }
        document.getElementById('qcBest').innerHTML = html;
    }

    function renderMembers() {
        var counts = {};
        var today = todayIso();
        state.data.availability.forEach(function(a) {
            if (a.day >= today) counts[a.member_id] = (counts[a.member_id] || 0) + 1;
        });
        var html = '<h2>People (' + state.data.members.length + ')</h2><ul class="qc-members">';
        state.data.members.forEach(function(m) {
            var isMe = state.me && state.me.id === m.id;
            html += '<li><span>' + escapeHtml(m.name) + (isMe ? ' <span class="qc-tag">you</span>' : '') + '</span>' +
                '<span class="qc-muted">' + (counts[m.id] ? counts[m.id] + ' upcoming ' + (counts[m.id] === 1 ? 'day' : 'days') + ' blocked' : 'nothing blocked yet') + '</span>' +
                (state.isAdmin && !isMe ? '<button class="qc-remove-btn" data-remove="' + escapeHtml(m.id) + '" title="Remove ' + escapeHtml(m.name) + '" aria-label="Remove ' + escapeHtml(m.name) + '">&#10005;</button>' : '') +
            '</li>';
        });
        document.getElementById('qcMembers').innerHTML = html + '</ul>';
    }

    function renderAdmin() {
        var el = document.getElementById('qcAdmin');
        if (!state.isAdmin) {
            el.innerHTML = '';
            return;
        }
        if (el.firstChild) return; // static, and keeps the <details> open state
        el.innerHTML =
            '<details class="qc-card qc-admin">' +
                '<summary>Organizer tools</summary>' +
                '<p class="qc-muted">You created this calendar. If the invite link reached the wrong people, delete it and start a new one.</p>' +
                '<div class="qc-admin-actions">' +
                    '<button class="btn btn-secondary qc-small" data-action="rename-cal">Rename calendar</button>' +
                    '<button class="btn btn-secondary qc-small" data-action="copy-admin" title="Manage this calendar from another device. Don\'t share it.">Copy organizer link</button>' +
                    '<button class="btn btn-danger qc-small" data-action="delete-cal">Delete calendar</button>' +
                '</div>' +
            '</details>';
    }

    function selectDay(day) {
        state.selected = day;
        var cells = container.querySelectorAll('.qc-day');
        for (var i = 0; i < cells.length; i++) {
            cells[i].classList.toggle('selected', cells[i].dataset.day === day);
        }
        renderDetail();
    }

    function gotoDay(day) {
        var d = CalUtil.parseIso(day);
        state.month = { y: d.getFullYear(), m: d.getMonth() };
        state.selected = day;
        renderToolbar();
        renderGrid();
        renderDetail();
    }

    // ---------------------------------------------------------------------
    // Calendar view: painting days
    // ---------------------------------------------------------------------

    function canPaint(day) {
        return !!state.me && day >= todayIso();
    }

    // Tapping a day that already has the active status clears it instead.
    function targetStatus(day) {
        var target = state.paint === 'clear' ? null : state.paint;
        return myStatus(day) === target ? null : target;
    }

    function onPointerDown(e) {
        var cell = e.target.closest('.qc-day');
        if (!cell || !state || e.button !== 0) return;
        var day = cell.dataset.day;
        selectDay(day);
        if (!canPaint(day)) return;
        e.preventDefault();
        state.drag = { start: day, end: day, status: targetStatus(day) };
        renderDragPreview();
    }

    function onPointerMove(e) {
        if (!state || !state.drag) return;
        var el = document.elementFromPoint(e.clientX, e.clientY);
        var cell = el && el.closest('.qc-day');
        if (cell && cell.dataset.day !== state.drag.end) {
            state.drag.end = cell.dataset.day;
            renderDragPreview();
        }
    }

    function onPointerUp() {
        if (!state || !state.drag) return;
        var drag = state.drag;
        state.drag = null;
        renderDragPreview();
        var days = CalUtil.daysBetween(drag.start, drag.end).filter(canPaint);
        setDays(days, drag.status);
    }

    function renderDragPreview() {
        var range = state.drag ? CalUtil.daysBetween(state.drag.start, state.drag.end) : [];
        var cls = state.drag ? 'preview-' + (state.drag.status || 'clear') : '';
        var cells = container.querySelectorAll('.qc-day');
        for (var i = 0; i < cells.length; i++) {
            var c = cells[i];
            c.classList.remove('preview-busy', 'preview-maybe', 'preview-clear');
            if (range.indexOf(c.dataset.day) >= 0 && canPaint(c.dataset.day)) c.classList.add(cls);
        }
    }

    // Optimistic local update, then a queued (serialized) save.
    function setDays(days, status) {
        if (!days.length || !state.me) return;
        var s = state;
        var me = s.me;
        var avail = s.data.availability.filter(function(a) {
            return !(a.member_id === me.id && days.indexOf(a.day) >= 0);
        });
        if (status) days.forEach(function(d) { avail.push({ member_id: me.id, day: d, status: status }); });
        s.data.availability = avail;
        s.stats = CalUtil.dayStats(avail);
        renderDynamic();

        s.pending++;
        showSaving();
        s.queue = s.queue.then(async function() {
            try {
                await CalApi.call('set_days', {
                    p_token: s.token, p_member_id: me.id, p_member_key: me.key, p_days: days, p_status: status
                });
            } catch (err) {
                toast(errorMessage(err), true);
            }
            s.pending--;
            hideSaving();
            if (!s.pending && state === s) await refresh();
        });
    }

    // ---------------------------------------------------------------------
    // Event handling
    // ---------------------------------------------------------------------

    function onChange(e) {
        if (!state || !state.data) return;
        if (e.target.id === 'findLen') setFind({ minDays: parseInt(e.target.value, 10) });
        if (e.target.id === 'findMaybe') setFind({ allowMaybe: e.target.checked });
    }

    function onSubmit(e) {
        e.preventDefault();
        if (e.target.id === 'createForm') createCalendar();
        if (e.target.id === 'joinForm') joinCalendar();
    }

    async function onClick(e) {
        var t = e.target.closest('button, a');
        if (!t) return;

        if (t.dataset.forget) {
            forgetEntry(t.dataset.forget);
            if (state) goHome(); else renderHome();
            return;
        }
        if (t.dataset.action === 'home') return goHome();
        if (!state || !state.data) return;

        // Keyboard activation of a day (pointer taps are handled on pointerdown).
        if (t.classList.contains('qc-day')) {
            if (e.detail !== 0) return;
            selectDay(t.dataset.day);
            if (canPaint(t.dataset.day)) setDays([t.dataset.day], targetStatus(t.dataset.day));
            return;
        }
        if (t.dataset.paint) {
            state.paint = t.dataset.paint;
            renderToolbar();
            return;
        }
        if (t.dataset.setDay) {
            setDays([state.selected], t.dataset.setDay === 'clear' ? null : t.dataset.setDay);
            return;
        }
        if (t.dataset.gotoRange) {
            var range = t.dataset.gotoRange.split('|');
            state.highlight = { start: range[0], end: range[1] };
            gotoDay(range[0]);
            renderBest();
            return;
        }
        if (t.dataset.findMode) return setFind({ mode: t.dataset.findMode });
        if (t.dataset.remove) return removeMember(t.dataset.remove);

        switch (t.dataset.action) {
            case 'prev':
            case 'next':
                var d = new Date(state.month.y, state.month.m + (t.dataset.action === 'next' ? 1 : -1), 1);
                state.month = { y: d.getFullYear(), m: d.getMonth() };
                renderToolbar();
                renderGrid();
                return;
            case 'today':
                return gotoDay(todayIso());
            case 'copy-invite':
                return copyText(linkTo(CalUtil.buildHash(state.token)), 'Invite link copied. Send it to your friends.');
            case 'copy-personal':
                return copyText(linkTo(CalUtil.buildHash(state.token, { me: { memberId: state.me.id, memberKey: state.me.key } })),
                    'Personal link copied. Keep it to yourself: it lets anyone edit your dates.');
            case 'copy-admin':
                return copyText(linkTo(CalUtil.buildHash(state.token, { admin: getEntry(state.token).adminKey })),
                    'Organizer link copied. Keep it to yourself.');
            case 'rename-me': return renameMe();
            case 'leave': return leave();
            case 'rename-cal': return renameCalendar();
            case 'delete-cal': return deleteCalendar();
        }
    }

    // Runs a mutating call with the saving indicator, then refreshes.
    async function mutate(name, args) {
        showSaving();
        try {
            var result = await CalApi.call(name, args);
            hideSaving();
            return result;
        } catch (err) {
            hideSaving();
            toast(errorMessage(err), true);
            throw err;
        }
    }

    async function joinCalendar() {
        var name = document.getElementById('joinName').value;
        var key = CalUtil.randomSecret();
        var s = state;
        try {
            var id = await mutate('join', { p_token: s.token, p_name: name, p_member_key: key });
            updateEntry(s.token, { memberId: id, memberKey: key, name: name.trim() });
            await refresh();
            toast('You\'re in. Tap or drag across the days you can\'t make.');
        } catch (e) {}
    }

    async function renameMe() {
        var name = await dialog({ title: 'Change your name', input: true, maxLength: 40, value: state.me.name, ok: 'Save' });
        if (name === null) return;
        try {
            await mutate('rename_member', { p_token: state.token, p_member_id: state.me.id, p_member_key: state.me.key, p_name: name });
            await refresh();
            renderTop();
        } catch (e) {}
    }

    async function leave() {
        var ok = await dialog({ title: 'Leave this calendar?', message: 'Your name and all your dates will be removed.', ok: 'Leave', danger: true });
        if (!ok) return;
        try {
            await mutate('leave', { p_token: state.token, p_member_id: state.me.id, p_member_key: state.me.key });
            updateEntry(state.token, { memberId: null, memberKey: null });
            await refresh();
        } catch (e) {}
    }

    function adminKey() {
        return getEntry(state.token).adminKey;
    }

    async function removeMember(id) {
        var names = namesFor([id]);
        var ok = await dialog({ title: 'Remove ' + (names[0] || 'this person') + '?', message: 'Their dates will be deleted. They can rejoin if they still have the link.', ok: 'Remove', danger: true });
        if (!ok) return;
        try {
            await mutate('admin_remove_member', { p_token: state.token, p_admin_key: adminKey(), p_member_id: id });
            await refresh();
        } catch (e) {}
    }

    async function renameCalendar() {
        var title = await dialog({ title: 'Rename calendar', input: true, maxLength: 80, value: state.data.title, ok: 'Save' });
        if (title === null) return;
        try {
            await mutate('admin_rename', { p_token: state.token, p_admin_key: adminKey(), p_title: title });
            await refresh();
        } catch (e) {}
    }

    async function deleteCalendar() {
        var ok = await dialog({ title: 'Delete this calendar?', message: 'Everyone\'s dates are deleted and the link stops working. This can\'t be undone.', ok: 'Delete', danger: true });
        if (!ok) return;
        try {
            await mutate('admin_delete', { p_token: state.token, p_admin_key: adminKey() });
            forgetEntry(state.token);
            toast('Calendar deleted.');
            goHome();
        } catch (e) {}
    }

    return { init: init };
})();
