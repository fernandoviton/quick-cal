const fs = require('fs');
const path = require('path');

// Load sync.js
const code = fs.readFileSync(path.join(__dirname, '../../shared/sync.js'), 'utf-8');
eval(code.replace('var Sync = (function()', 'global.Sync = (function()'));

beforeEach(() => {
    jest.useFakeTimers();
    // Mock document for status UI
    global.document = {
        getElementById: jest.fn(() => null)
    };
});

afterEach(() => {
    Sync.stop();
    jest.useRealTimers();
    delete global.document;
});

describe('Sync', () => {
    test('init starts polling', () => {
        const api = { fetchItems: jest.fn(() => Promise.resolve([])) };
        const onSync = jest.fn();

        Sync.init(api, onSync);
        expect(Sync.isPaused()).toBe(false);
    });

    test('polling calls fetchItems at interval', async () => {
        const api = { fetchItems: jest.fn(() => Promise.resolve([{ id: '1' }])) };
        const onSync = jest.fn();

        Sync.init(api, onSync);

        // Advance past one poll interval (30s)
        jest.advanceTimersByTime(30000);
        await Promise.resolve(); // flush microtasks

        expect(api.fetchItems).toHaveBeenCalled();
    });

    test('pauses after inactivity', () => {
        const api = { fetchItems: jest.fn(() => Promise.resolve([])) };
        Sync.init(api, jest.fn());

        // Advance past pause threshold (5 minutes)
        jest.advanceTimersByTime(5 * 60 * 1000 + 30000);

        expect(Sync.isPaused()).toBe(true);
    });

    test('resetActivity resumes when paused', () => {
        const api = { fetchItems: jest.fn(() => Promise.resolve([])) };
        Sync.init(api, jest.fn());

        Sync.pausePolling();
        expect(Sync.isPaused()).toBe(true);

        Sync.resetActivity();
        expect(Sync.isPaused()).toBe(false);
    });

    test('stop clears polling', () => {
        const api = { fetchItems: jest.fn(() => Promise.resolve([])) };
        Sync.init(api, jest.fn());

        Sync.stop();
        expect(Sync.isPaused()).toBe(true);
    });

    test('manualRefresh calls fetchItems and resets activity', async () => {
        const api = { fetchItems: jest.fn(() => Promise.resolve([{ id: '1' }])) };
        const onSync = jest.fn();
        Sync.init(api, onSync);

        Sync.pausePolling();
        await Sync.manualRefresh();

        expect(api.fetchItems).toHaveBeenCalled();
        expect(Sync.isPaused()).toBe(false);
    });
});
