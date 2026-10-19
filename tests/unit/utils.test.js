const fs = require('fs');
const path = require('path');

// Load utils.js into global scope
const code = fs.readFileSync(path.join(__dirname, '../../shared/utils.js'), 'utf-8');
eval(code.replace('function escapeHtml(', 'global.escapeHtml = function escapeHtml(')
         .replace('function generateListId(', 'global.generateListId = function generateListId(')
         .replace('function getListName(', 'global.getListName = function getListName(')
         .replace('function hasExplicitListName(', 'global.hasExplicitListName = function hasExplicitListName('));

describe('escapeHtml', () => {
    test('escapes ampersands', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('escapes angle brackets', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    test('escapes quotes', () => {
        expect(escapeHtml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#39;world&#39;');
    });

    test('returns empty string for empty input', () => {
        expect(escapeHtml('')).toBe('');
    });

    test('returns plain text unchanged', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });
});

describe('generateListId', () => {
    test('returns string of default length 8', () => {
        const id = generateListId();
        expect(id).toHaveLength(8);
        expect(typeof id).toBe('string');
    });

    test('returns string of specified length', () => {
        expect(generateListId(12)).toHaveLength(12);
        expect(generateListId(4)).toHaveLength(4);
    });

    test('contains only lowercase alphanumeric chars', () => {
        for (let i = 0; i < 20; i++) {
            expect(generateListId()).toMatch(/^[a-z0-9]+$/);
        }
    });
});

describe('getListName', () => {
    beforeEach(() => {
        global.CONFIG = { DEFAULT_LIST_NAME: 'demo' };
    });

    afterEach(() => {
        delete global.CONFIG;
    });

    test('returns list param from URL', () => {
        global.window = { location: { search: '?list=mylist' } };
        expect(getListName()).toBe('mylist');
        delete global.window;
    });

    test('returns default when no list param', () => {
        global.window = { location: { search: '' } };
        expect(getListName()).toBe('demo');
        delete global.window;
    });

    test('returns default when list param is empty', () => {
        global.window = { location: { search: '?list=' } };
        expect(getListName()).toBe('demo');
        delete global.window;
    });

    test('returns default when list param is whitespace', () => {
        global.window = { location: { search: '?list=%20%20' } };
        expect(getListName()).toBe('demo');
        delete global.window;
    });
});

describe('hasExplicitListName', () => {
    test('returns true when list param exists', () => {
        global.window = { location: { search: '?list=mylist' } };
        expect(hasExplicitListName()).toBe(true);
        delete global.window;
    });

    test('returns false when no list param', () => {
        global.window = { location: { search: '' } };
        expect(hasExplicitListName()).toBe(false);
        delete global.window;
    });

    test('returns false when list param is empty', () => {
        global.window = { location: { search: '?list=' } };
        expect(hasExplicitListName()).toBe(false);
        delete global.window;
    });
});
