const fs = require('fs');
const path = require('path');

// Mock crypto.randomUUID
global.crypto = { randomUUID: jest.fn(() => 'mock-uuid-1234') };

// Mock localStorage
const storage = {};
global.localStorage = {
    getItem: jest.fn(k => storage[k] || null),
    setItem: jest.fn((k, v) => { storage[k] = v; }),
    removeItem: jest.fn(k => { delete storage[k]; }),
    get length() { return Object.keys(storage).length; },
    key: jest.fn(i => Object.keys(storage)[i] || null)
};

// Load api.js into global scope
const code = fs.readFileSync(path.join(__dirname, '../../shared/api.js'), 'utf-8');
eval(code.replace('function createApi(', 'global.createApi = function createApi('));

beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    jest.clearAllMocks();
    global.crypto.randomUUID = jest.fn(() => 'mock-uuid-1234');
});

describe('createApi mock mode', () => {
    test('isMock is true when CONFIG has no SUPABASE_URL', () => {
        global.CONFIG = { SUPABASE_URL: null, DB_TABLE: 'myapp' };
        const api = createApi('test');
        expect(api.isMock).toBe(true);
        delete global.CONFIG;
    });

    describe('fetchItems', () => {
        let api;
        beforeEach(() => {
            global.CONFIG = { SUPABASE_URL: null, DB_TABLE: 'myapp' };
            api = createApi('mylist');
        });
        afterEach(() => { delete global.CONFIG; });

        test('returns empty array when no stored data', async () => {
            const result = await api.fetchItems();
            expect(result).toEqual([]);
        });

        test('returns stored items', async () => {
            const items = [
                { id: 'abc', list_name: 'mylist', content: 'hello', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }
            ];
            storage['listlet_myapp_mylist'] = JSON.stringify(items);
            const result = await api.fetchItems();
            expect(result).toEqual(items);
        });
    });

    describe('fetchItems date range', () => {
        let api;
        beforeEach(() => {
            global.CONFIG = { SUPABASE_URL: null, DB_TABLE: 'myapp' };
            api = createApi('mylist');
            storage['listlet_myapp_mylist'] = JSON.stringify([
                { id: 'a', list_name: 'mylist', content: JSON.stringify({ date: '2026-07-01' }), created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
                { id: 'b', list_name: 'mylist', content: JSON.stringify({ date: '2026-07-10' }), created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
                { id: 'c', list_name: 'mylist', content: JSON.stringify({ date: '2026-07-20' }), created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
                { id: 'undated', list_name: 'mylist', content: 'plain text, not JSON', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
                { id: 'nodate', list_name: 'mylist', content: JSON.stringify({ name: 'no date field' }), created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }
            ]);
        });
        afterEach(() => { delete global.CONFIG; });

        test('explicit opts bound the fetch inclusively', async () => {
            const result = await api.fetchItems({ dateFrom: '2026-07-01', dateTo: '2026-07-10' });
            expect(result.map(i => i.id)).toEqual(['a', 'b']);
        });

        test('dateFrom alone drops earlier rows', async () => {
            const result = await api.fetchItems({ dateFrom: '2026-07-05' });
            expect(result.map(i => i.id)).toEqual(['b', 'c']);
        });

        test('rows without a parseable content date are excluded from any range', async () => {
            const result = await api.fetchItems({ dateFrom: '2000-01-01', dateTo: '2099-12-31' });
            expect(result.map(i => i.id)).toEqual(['a', 'b', 'c']);
        });

        test('no range returns all rows, dated or not', async () => {
            const result = await api.fetchItems();
            expect(result).toHaveLength(5);
        });

        test('setDateRange applies to arg-less fetchItems', async () => {
            api.setDateRange('2026-07-10', '2026-07-31');
            const result = await api.fetchItems();
            expect(result.map(i => i.id)).toEqual(['b', 'c']);
        });

        test('explicit opts override the default range', async () => {
            api.setDateRange('2026-07-10', '2026-07-31');
            const result = await api.fetchItems({ dateFrom: '2026-07-01', dateTo: '2026-07-05' });
            expect(result.map(i => i.id)).toEqual(['a']);
        });

        test('setDateRange(null, null) clears the default range', async () => {
            api.setDateRange('2026-07-10', '2026-07-31');
            api.setDateRange(null, null);
            const result = await api.fetchItems();
            expect(result).toHaveLength(5);
        });
    });

    describe('createItem', () => {
        let api;
        beforeEach(() => {
            global.CONFIG = { SUPABASE_URL: null, DB_TABLE: 'myapp' };
            api = createApi('mylist');
        });
        afterEach(() => { delete global.CONFIG; });

        test('creates item with generated id and timestamps', async () => {
            const item = await api.createItem({ content: 'test' });
            expect(item.id).toBe('mock-uuid-1234');
            expect(item.list_name).toBe('mylist');
            expect(item.content).toBe('test');
            expect(item.created_at).toBeDefined();
            expect(item.updated_at).toBeDefined();
        });

        test('persists item to localStorage', async () => {
            await api.createItem({ content: 'test' });
            const stored = JSON.parse(storage['listlet_myapp_mylist']);
            expect(stored).toHaveLength(1);
            expect(stored[0].content).toBe('test');
        });

        test('appends to existing items', async () => {
            storage['listlet_myapp_mylist'] = JSON.stringify([
                { id: 'existing', list_name: 'mylist', content: 'first', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }
            ]);
            await api.createItem({ content: 'second' });
            const stored = JSON.parse(storage['listlet_myapp_mylist']);
            expect(stored).toHaveLength(2);
        });
    });

    describe('updateItem', () => {
        let api;
        beforeEach(() => {
            global.CONFIG = { SUPABASE_URL: null, DB_TABLE: 'myapp' };
            api = createApi('mylist');
            storage['listlet_myapp_mylist'] = JSON.stringify([
                { id: 'item-1', list_name: 'mylist', content: 'old', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }
            ]);
        });
        afterEach(() => { delete global.CONFIG; });

        test('updates content and updated_at', async () => {
            const item = await api.updateItem('item-1', { content: 'new' });
            expect(item.content).toBe('new');
            expect(item.updated_at).not.toBe('2026-01-01T00:00:00.000Z');
        });

        test('persists changes to localStorage', async () => {
            await api.updateItem('item-1', { content: 'new' });
            const stored = JSON.parse(storage['listlet_myapp_mylist']);
            expect(stored[0].content).toBe('new');
        });
    });

    describe('deleteItem', () => {
        let api;
        beforeEach(() => {
            global.CONFIG = { SUPABASE_URL: null, DB_TABLE: 'myapp' };
            api = createApi('mylist');
            storage['listlet_myapp_mylist'] = JSON.stringify([
                { id: 'item-1', list_name: 'mylist', content: 'keep', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
                { id: 'item-2', list_name: 'mylist', content: 'delete', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }
            ]);
        });
        afterEach(() => { delete global.CONFIG; });

        test('removes item by id', async () => {
            await api.deleteItem('item-2');
            const stored = JSON.parse(storage['listlet_myapp_mylist']);
            expect(stored).toHaveLength(1);
            expect(stored[0].id).toBe('item-1');
        });
    });
});

describe('createApi.getAllLists mock mode', () => {
    beforeEach(() => {
        global.CONFIG = { SUPABASE_URL: null, DB_TABLE: 'myapp' };
    });
    afterEach(() => { delete global.CONFIG; });

    test('returns empty array when no matching keys', async () => {
        const result = await createApi.getAllLists();
        expect(result).toEqual([]);
    });

    test('returns lists with count and updated_at', async () => {
        storage['listlet_myapp_list1'] = JSON.stringify([
            { id: '1', list_name: 'list1', content: 'a', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
            { id: '2', list_name: 'list1', content: 'b', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z' }
        ]);
        storage['listlet_myapp_list2'] = JSON.stringify([
            { id: '3', list_name: 'list2', content: 'c', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }
        ]);

        const result = await createApi.getAllLists();
        expect(result).toHaveLength(2);

        const list1 = result.find(r => r.list_name === 'list1');
        expect(list1.count).toBe(2);
        expect(list1.updated_at).toBe('2026-01-03T00:00:00.000Z');

        const list2 = result.find(r => r.list_name === 'list2');
        expect(list2.count).toBe(1);
    });

    test('does not include keys from other tables', async () => {
        storage['listlet_otherapp_list1'] = JSON.stringify([{ id: '1' }]);
        const result = await createApi.getAllLists();
        expect(result).toEqual([]);
    });
});

describe('createApi Supabase mode', () => {
    let api;
    beforeEach(() => {
        global.CONFIG = { SUPABASE_URL: 'https://test.supabase.co', DB_TABLE: 'myapp' };
        global.window = global.window || {};
        global.window.supabaseClient = {
            from: jest.fn(() => ({
                select: jest.fn(() => ({
                    eq: jest.fn(() => ({
                        order: jest.fn(() => Promise.resolve({ data: [], error: null }))
                    }))
                })),
                insert: jest.fn(() => ({
                    select: jest.fn(() => ({
                        single: jest.fn(() => Promise.resolve({ data: { id: 'new-id', list_name: 'mylist', content: 'test', created_at: '2026-01-01', updated_at: '2026-01-01' }, error: null }))
                    }))
                })),
                update: jest.fn(() => ({
                    eq: jest.fn(() => ({
                        select: jest.fn(() => ({
                            single: jest.fn(() => Promise.resolve({ data: { id: 'id1', content: 'updated' }, error: null }))
                        }))
                    }))
                })),
                delete: jest.fn(() => ({
                    eq: jest.fn(() => Promise.resolve({ error: null }))
                }))
            }))
        };
        api = createApi('mylist');
    });
    afterEach(() => {
        delete global.CONFIG;
        delete global.window.supabaseClient;
    });

    test('isMock is false', () => {
        expect(api.isMock).toBe(false);
    });
});

describe('createApi Supabase mode date range', () => {
    // Recording query builder: every chained call is logged so tests can
    // assert which filters fetchItems applied.
    function makeRecordingClient(calls) {
        const builder = {
            select: (...a) => { calls.push(['select', ...a]); return builder; },
            eq: (...a) => { calls.push(['eq', ...a]); return builder; },
            gte: (...a) => { calls.push(['gte', ...a]); return builder; },
            lte: (...a) => { calls.push(['lte', ...a]); return builder; },
            order: (...a) => { calls.push(['order', ...a]); return Promise.resolve({ data: [], error: null }); }
        };
        return { from: (...a) => { calls.push(['from', ...a]); return builder; } };
    }

    let calls;
    beforeEach(() => {
        calls = [];
        global.CONFIG = { SUPABASE_URL: 'https://test.supabase.co', DB_TABLE: 'myapp' };
        global.window = global.window || {};
        global.window.supabaseClient = makeRecordingClient(calls);
    });
    afterEach(() => {
        delete global.CONFIG;
        delete global.window.supabaseClient;
    });

    test('no range applies no date filters', async () => {
        await createApi('mylist').fetchItems();
        expect(calls.filter(c => c[0] === 'gte' || c[0] === 'lte')).toEqual([]);
    });

    test('range filters on content_date by default', async () => {
        await createApi('mylist').fetchItems({ dateFrom: '2026-07-01', dateTo: '2026-07-31' });
        expect(calls).toContainEqual(['gte', 'content_date', '2026-07-01']);
        expect(calls).toContainEqual(['lte', 'content_date', '2026-07-31']);
    });

    test('CONFIG.CONTENT_DATE_COLUMN overrides the column name', async () => {
        global.CONFIG.CONTENT_DATE_COLUMN = 'slot_date';
        await createApi('mylist').fetchItems({ dateFrom: '2026-07-01' });
        expect(calls).toContainEqual(['gte', 'slot_date', '2026-07-01']);
    });

    test('setDateRange bounds a later arg-less fetch', async () => {
        const api = createApi('mylist');
        api.setDateRange('2026-07-01', '2026-07-31');
        await api.fetchItems();
        expect(calls).toContainEqual(['gte', 'content_date', '2026-07-01']);
        expect(calls).toContainEqual(['lte', 'content_date', '2026-07-31']);
    });
});
